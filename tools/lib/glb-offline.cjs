/**
 * 离线 GLB 解析 + 软件光栅化 + PNG 编码（零依赖，不起浏览器、不用 CDP）。
 *
 * 为什么需要它：
 *   仓库里原有的 `shot-*.cjs` / `qa-*.cjs` 看起来是"脚本渲染"，
 *   但它们底层全是 Chrome DevTools Protocol —— 要连 CDP 端点、要起 headless
 *   Chrome、要 WebGL/GPU。在无 GPU 的机器上会挂起，在有网络命名空间隔离的
 *   环境里又拿不到资源。CDP 只是"传参 + 截图"的一条路，不是唯一一条路。
 *
 *   这里走的是纯离线通路：直接读 GLB 二进制，自己做变换/裁剪/光栅化，
 *   自己写 PNG。任何装了 Node 的机器都能跑，结果逐像素可复现。
 *
 * 用途：
 *   1) 对模型资产做"几何保真"验收（朝向、比例、法线、材质、贴图是否真的可用）；
 *   2) 在没有浏览器的环境里产出可视化证据。
 *
 * 刻意不做的事：不模拟 PBR、不模拟阴影/环境贴图、不做屏幕空间抗锯齿。
 *   目标是**几何与配色可核对**，不是像素级还原引擎画面。
 *   引擎级画面验收仍然属于浏览器流水线（CDP），两者互不替代。
 */
'use strict';

const fs = require('node:fs');
const zlib = require('node:zlib');

// ---------------------------------------------------------------- GLB 解析

const GLB_MAGIC = 0x46546c67; // 'glTF'
const CHUNK_JSON = 0x4e4f534a; // 'JSON'
const CHUNK_BIN = 0x004e4942; // 'BIN\0'

const COMPONENT = {
  5120: { array: Int8Array, size: 1, norm: 127 },
  5121: { array: Uint8Array, size: 1, norm: 255 },
  5122: { array: Int16Array, size: 2, norm: 32767 },
  5123: { array: Uint16Array, size: 2, norm: 65535 },
  5125: { array: Uint32Array, size: 4, norm: 4294967295 },
  5126: { array: Float32Array, size: 4, norm: 1 },
};

const TYPE_COUNT = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };

/** 读取 GLB 容器，返回 { gltf, bin }。 */
function parseGLB(filePath) {
  const buf = fs.readFileSync(filePath);
  if (buf.length < 12) throw new Error(`GLB 过短: ${filePath}`);
  const magic = buf.readUInt32LE(0);
  if (magic !== GLB_MAGIC) throw new Error(`不是 GLB（magic 0x${magic.toString(16)}）: ${filePath}`);
  const total = buf.readUInt32LE(8);
  if (total > buf.length) throw new Error(`GLB 长度声明 ${total} > 实际 ${buf.length}: ${filePath}`);

  let gltf = null;
  let bin = Buffer.alloc(0);
  let off = 12;
  while (off + 8 <= total) {
    const len = buf.readUInt32LE(off);
    const type = buf.readUInt32LE(off + 4);
    const start = off + 8;
    if (start + len > buf.length) throw new Error(`GLB chunk 越界: ${filePath}`);
    if (type === CHUNK_JSON) gltf = JSON.parse(buf.slice(start, start + len).toString('utf8'));
    else if (type === CHUNK_BIN) bin = buf.slice(start, start + len);
    off = start + len + ((4 - (len % 4)) % 4);
  }
  if (!gltf) throw new Error(`GLB 缺少 JSON chunk: ${filePath}`);
  return { gltf, bin };
}

/** 读一个 accessor，返回 { data: Float64Array[], count }。 */
function readAccessor(gltf, bin, index) {
  const acc = gltf.accessors[index];
  if (!acc) throw new Error(`accessor ${index} 不存在`);
  const n = TYPE_COUNT[acc.type];
  if (!n) throw new Error(`未知 accessor type ${acc.type}`);
  const comp = COMPONENT[acc.componentType];
  if (!comp) throw new Error(`未知 componentType ${acc.componentType}`);
  const view = gltf.bufferViews[acc.bufferView];
  if (!view) throw new Error(`accessor ${index} 的 bufferView 缺失`);

  const elemSize = comp.size * n;
  const stride = view.byteStride || elemSize;
  const base = (view.byteOffset || 0) + (acc.byteOffset || 0);
  const out = new Array(n);
  for (let k = 0; k < n; k++) out[k] = new Float64Array(acc.count);

  const read = (i, k) => {
    const p = base + i * stride + k * comp.size;
    switch (acc.componentType) {
      case 5120: return bin.readInt8(p);
      case 5121: return bin.readUInt8(p);
      case 5122: return bin.readInt16LE(p);
      case 5123: return bin.readUInt16LE(p);
      case 5125: return bin.readUInt32LE(p);
      default: return bin.readFloatLE(p);
    }
  };

  for (let i = 0; i < acc.count; i++) {
    for (let k = 0; k < n; k++) {
      let v = read(i, k);
      if (acc.normalized) {
        const max = comp.norm;
        v = v / max;
        if (acc.componentType === 5120 || acc.componentType === 5122) v = Math.max(v, -1);
      }
      out[k][i] = v;
    }
  }
  return { data: out, count: acc.count };
}

// ------------------------------------------------------------ 矩阵与向量

function mat4Identity() {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}

function mat4Multiply(a, b) {
  const o = new Array(16);
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[r * 4 + k] * b[k * 4 + c];
      o[r * 4 + c] = s;
    }
  }
  return o;
}

/** glTF 节点变换：matrix 或 TRS（rotation 为四元数 xyzw）。 */
function nodeMatrix(node) {
  if (Array.isArray(node.matrix) && node.matrix.length === 16) {
    // glTF matrix 是列主序，转成行主序使用。
    const m = node.matrix;
    return [
      m[0], m[4], m[8], m[12],
      m[1], m[5], m[9], m[13],
      m[2], m[6], m[10], m[14],
      m[3], m[7], m[11], m[15],
    ];
  }
  const t = node.translation || [0, 0, 0];
  const s = node.scale || [1, 1, 1];
  const q = node.rotation || [0, 0, 0, 1];
  const [x, y, z, w] = q;
  const x2 = x + x, y2 = y + y, z2 = z + z;
  const xx = x * x2, xy = x * y2, xz = x * z2;
  const yy = y * y2, yz = y * z2, zz = z * z2;
  const wx = w * x2, wy = w * y2, wz = w * z2;
  // 行主序：第 r 行存 A[r*4 .. r*4+3]，平移在 3/7/11。
  // （早先写成列主序，等于把旋转转置了 —— 节点姿态全错。）
  return [
    (1 - (yy + zz)) * s[0], (xy - wz) * s[1], (xz + wy) * s[2], t[0],
    (xy + wz) * s[0], (1 - (xx + zz)) * s[1], (yz - wx) * s[2], t[1],
    (xz - wy) * s[0], (yz + wx) * s[1], (1 - (xx + yy)) * s[2], t[2],
    0, 0, 0, 1,
  ];
}

function transformPoint(m, p) {
  const [x, y, z] = p;
  return [
    m[0] * x + m[1] * y + m[2] * z + m[3],
    m[4] * x + m[5] * y + m[6] * z + m[7],
    m[8] * x + m[9] * y + m[10] * z + m[11],
  ];
}

function transformDir(m, p) {
  const [x, y, z] = p;
  if (m.length === 9) return [
    m[0] * x + m[1] * y + m[2] * z,
    m[3] * x + m[4] * y + m[5] * z,
    m[6] * x + m[7] * y + m[8] * z,
  ];
  return [
    m[0] * x + m[1] * y + m[2] * z,
    m[4] * x + m[5] * y + m[6] * z,
    m[8] * x + m[9] * y + m[10] * z,
  ];
}

/**
 * 3x3 法线矩阵 = 逆转置（伴随矩阵 / det）。
 *
 * 注意：法线要乘 (A^-1)^T，不是 A^-1。
 * 早先版本直接返回 A^-1 的行，符号/非等比缩放下法线会偏。
 */
function normalMatrix3(m) {
  const a = [m[0], m[1], m[2], m[4], m[5], m[6], m[8], m[9], m[10]];
  const det =
    a[0] * (a[4] * a[8] - a[5] * a[7]) -
    a[1] * (a[3] * a[8] - a[5] * a[6]) +
    a[2] * (a[3] * a[7] - a[4] * a[6]);
  if (!det || !Number.isFinite(det)) return [1, 0, 0, 0, 1, 0, 0, 0, 1];
  const inv = 1 / det;
  // 伴随矩阵（行主序）：C[r][c] = 去掉第 r 行第 c 列的子式带符号
  return [
    (a[4] * a[8] - a[5] * a[7]) * inv, (a[5] * a[6] - a[3] * a[8]) * inv, (a[3] * a[7] - a[4] * a[6]) * inv,
    (a[1] * a[8] - a[2] * a[7]) * inv, (a[2] * a[6] - a[0] * a[8]) * inv, (a[0] * a[7] - a[1] * a[6]) * inv,
    (a[1] * a[5] - a[2] * a[4]) * inv, (a[2] * a[3] - a[0] * a[5]) * inv, (a[0] * a[4] - a[1] * a[3]) * inv,
  ];
}

function normalize3(v) {
  const l = Math.hypot(v[0], v[1], v[2]);
  return l > 1e-12 ? [v[0] / l, v[1] / l, v[2] / l] : [0, 1, 0];
}

// ------------------------------------------------------------ 贴图（PNG）

/** 最小 PNG 解码：支持 8bit 的 灰度/RGB/RGBA/灰度A，够用即可解出贴图。 */
function decodePNG(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('不是 PNG');
  let off = 8;
  let width = 0, height = 0, bitDepth = 8, colorType = 6;
  const idat = [];
  let palette = null;
  let trns = null;
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.slice(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
    } else if (type === 'PLTE') palette = data;
    else if (type === 'tRNS') trns = data;
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  if (bitDepth !== 8) throw new Error(`暂不支持 ${bitDepth}bit PNG`);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
  if (!channels) throw new Error(`不支持的 PNG colorType ${colorType}`);
  const bpp = channels;
  const stride = width * bpp;
  const out = Buffer.alloc(height * stride);
  let pos = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[pos++];
    const line = raw.slice(pos, pos + stride);
    pos += stride;
    const cur = out.slice(y * stride, y * stride + stride);
    const prev = y > 0 ? out.slice((y - 1) * stride, (y - 1) * stride + stride) : null;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x - bpp] : 0;
      const b = prev ? prev[x] : 0;
      const c = prev && x >= bpp ? prev[x - bpp] : 0;
      let v = line[x];
      switch (filter) {
        case 0: break;
        case 1: v = v + a; break;
        case 2: v = v + b; break;
        case 3: v = v + ((a + b) >> 1); break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
          v = v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
          break;
        }
        default: throw new Error(`未知 PNG filter ${filter}`);
      }
      cur[x] = v & 0xff;
    }
  }
  // 统一转成 RGBA
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    let r, g, b, a = 255;
    if (colorType === 0) { r = g = b = out[i]; }
    else if (colorType === 2) { r = out[i * 3]; g = out[i * 3 + 1]; b = out[i * 3 + 2]; }
    else if (colorType === 3) {
      const idx = out[i];
      r = palette[idx * 3]; g = palette[idx * 3 + 1]; b = palette[idx * 3 + 2];
      if (trns && idx < trns.length) a = trns[idx];
    } else if (colorType === 4) { r = g = b = out[i * 2]; a = out[i * 2 + 1]; }
    else { r = out[i * 4]; g = out[i * 4 + 1]; b = out[i * 4 + 2]; a = out[i * 4 + 3]; }
    rgba[i * 4] = r; rgba[i * 4 + 1] = g; rgba[i * 4 + 2] = b; rgba[i * 4 + 3] = a;
  }
  return { width, height, data: rgba };
}

// ------------------------------------------------------------ PNG 编码

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

/** rgb: Uint8Array(width*height*3)。 */
function encodePNG(rgb, width, height) {
  const raw = Buffer.alloc(height * (width * 3 + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (width * 3 + 1)] = 0; // filter none
    for (let x = 0; x < width * 3; x++) raw[y * (width * 3 + 1) + 1 + x] = rgb[y * width * 3 + x];
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 2;   // color type RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// ------------------------------------------------------ 场景装配（离线）

const DEFAULT_TINT = { r: 0xa9 / 255, g: 0x83 / 255, b: 0x4e / 255 };

/**
 * 把 GLB 拆成可光栅化的图元列表。
 *
 * opts.tintNearBlack：复刻 props_entities.js 的 tintMarmot —— 近黑材质染成土黄。
 *   不复刻的话尖叫土拨鼠会渲染成纯黑，看不出形状。
 */
function accessorMat4(gltf, bin, index) {
  const raw = readAccessor(gltf, bin, index);
  const mats = [];
  for (let i = 0; i < raw.count; i++) {
    const m = [];
    // glTF MAT4 accessors are column-major; convert to this file's row-major form.
    for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) m[r * 4 + c] = raw.data[c * 4 + r][i];
    mats.push(m);
  }
  return mats;
}

function buildSkinData(gltf, bin, nodeWorlds) {
  return (gltf.skins || []).map((skin, skinIndex) => {
    const joints = skin.joints || [];
    const inverseBind = skin.inverseBindMatrices !== undefined
      ? accessorMat4(gltf, bin, skin.inverseBindMatrices)
      : joints.map(() => mat4Identity());
    if (inverseBind.length !== joints.length) throw new Error(`skin ${skinIndex} joints=${joints.length} inverseBind=${inverseBind.length}`);
    const matrices = joints.map((joint, i) => mat4Multiply(nodeWorlds[joint] || mat4Identity(), inverseBind[i]));
    return { joints, inverseBind, matrices, skeleton: skin.skeleton ?? null, name: skin.name || `skin${skinIndex}` };
  });
}

function skinVertex(skin, joints, weights, index, p, n) {
  if (!skin || !joints || !weights) return { p, n };
  const outP = [0, 0, 0], outN = [0, 0, 0];
  let sum = 0;
  for (let k = 0; k < 4; k++) {
    const w = Number(weights.data[k]?.[index] || 0);
    if (!(w > 0)) continue;
    const ji = Number(joints.data[k]?.[index] || 0);
    const m = skin.matrices[ji];
    if (!m) continue;
    const q = transformPoint(m, p);
    outP[0] += q[0] * w; outP[1] += q[1] * w; outP[2] += q[2] * w;
    if (n) {
      const qn = transformDir(normalMatrix3(m), n);
      outN[0] += qn[0] * w; outN[1] += qn[1] * w; outN[2] += qn[2] * w;
    }
    sum += w;
  }
  if (!(sum > 1e-12)) return { p, n };
  return { p: outP, n: n ? normalize3(outN) : null };
}

/**
 * 把 GLB 拆成可光栅化的图元列表，并在 node.skin 存在时执行 glTF 线性混合蒙皮。
 */
function buildPrimitives(gltf, bin, opts = {}) {
  const out = [];
  const materials = gltf.materials || [];
  const textures = gltf.textures || [];
  const images = gltf.images || [];
  const imageCache = new Map();
  const nodes = gltf.nodes || [];
  const scene = (gltf.scenes || [])[gltf.scene || 0];
  const roots = (scene && scene.nodes) || nodes.map((_, i) => i).filter((i) => !nodes.some((n) => (n.children || []).includes(i)));
  const nodeWorlds = new Array(nodes.length);
  const parentOf = new Array(nodes.length).fill(null);
  for (let i = 0; i < nodes.length; i++) for (const child of nodes[i]?.children || []) parentOf[child] = i;
  const worldMemo = new Set();
  const resolveWorld = (nodeIndex) => {
    if (worldMemo.has(nodeIndex)) return nodeWorlds[nodeIndex];
    const node = nodes[nodeIndex]; if (!node) return mat4Identity();
    const parent = parentOf[nodeIndex] == null ? mat4Identity() : resolveWorld(parentOf[nodeIndex]);
    const world = mat4Multiply(parent, nodeMatrix(node));
    nodeWorlds[nodeIndex] = world; worldMemo.add(nodeIndex);
    return world;
  };
  for (let i = 0; i < nodes.length; i++) resolveWorld(i);
  const renderVisited = new Set();
  const skins = buildSkinData(gltf, bin, nodeWorlds);

  const imageData = (imgIndex) => {
    if (imageCache.has(imgIndex)) return imageCache.get(imgIndex);
    const img = images[imgIndex]; let result = null;
    if (img && img.bufferView !== undefined) {
      const view = gltf.bufferViews[img.bufferView];
      const bytes = bin.slice(view.byteOffset || 0, (view.byteOffset || 0) + view.byteLength);
      if (img.mimeType === 'image/png') { try { result = decodePNG(bytes); } catch { result = null; } }
    }
    imageCache.set(imgIndex, result); return result;
  };

  const visit = (nodeIndex, parent) => {
    if (renderVisited.has(nodeIndex)) return;
    renderVisited.add(nodeIndex);
    const node = nodes[nodeIndex]; if (!node) return;
    const world = nodeWorlds[nodeIndex] || mat4Multiply(parent, nodeMatrix(node));
    if (node.mesh !== undefined) {
      const mesh = gltf.meshes[node.mesh];
      const skin = node.skin !== undefined ? skins[node.skin] : null;
      for (const prim of mesh.primitives || []) {
        const attrs = prim.attributes || {}; if (attrs.POSITION === undefined) continue;
        const pos = readAccessor(gltf, bin, attrs.POSITION), count = pos.count;
        const joints = skin && attrs.JOINTS_0 !== undefined ? readAccessor(gltf, bin, attrs.JOINTS_0) : null;
        const weights = skin && attrs.WEIGHTS_0 !== undefined ? readAccessor(gltf, bin, attrs.WEIGHTS_0) : null;
        const P = [0, 1, 2].map(() => new Float64Array(count));
        let N = null;
        const nrm = attrs.NORMAL !== undefined ? readAccessor(gltf, bin, attrs.NORMAL) : null;
        if (nrm) N = [0, 1, 2].map(() => new Float64Array(count));
        for (let i = 0; i < count; i++) {
          const sp = [pos.data[0][i], pos.data[1][i], pos.data[2][i]];
          const sn = nrm ? [nrm.data[0][i], nrm.data[1][i], nrm.data[2][i]] : null;
          const deformed = opts.applySkin === false ? { p: sp, n: sn } : skinVertex(skin, joints, weights, i, sp, sn);
          P[0][i] = deformed.p[0]; P[1][i] = deformed.p[1]; P[2][i] = deformed.p[2];
          if (N) { N[0][i] = deformed.n[0]; N[1][i] = deformed.n[1]; N[2][i] = deformed.n[2]; }
        }
        let C = null;
        if (attrs.COLOR_0 !== undefined) {
          const col = readAccessor(gltf, bin, attrs.COLOR_0); C = [0, 1, 2].map(() => new Float64Array(count));
          for (let i = 0; i < count; i++) { C[0][i] = col.data[0][i]; C[1][i] = col.data[Math.min(1, col.data.length - 1)][i]; C[2][i] = col.data[Math.min(2, col.data.length - 1)][i]; }
        }
        let UV = null;
        if (attrs.TEXCOORD_0 !== undefined) { const uv = readAccessor(gltf, bin, attrs.TEXCOORD_0); UV = [new Float64Array(count), new Float64Array(count)]; for (let i = 0; i < count; i++) { UV[0][i] = uv.data[0][i]; UV[1][i] = uv.data[1][i]; } }
        let indices;
        if (prim.indices !== undefined) indices = readAccessor(gltf, bin, prim.indices).data[0];
        else { indices = new Float64Array(count); for (let i = 0; i < count; i++) indices[i] = i; }
        const mat = materials[prim.material || 0] || {}, pbr = mat.pbrMetallicRoughness || {};
        let base = pbr.baseColorFactor || [1, 1, 1, 1], tex = null;
        const texRef = pbr.baseColorTexture;
        if (texRef && textures[texRef.index]) tex = imageData(textures[texRef.index].source);
        if (opts.tintNearBlack && base[0] < 0.08 && base[1] < 0.08 && base[2] < 0.08) base = [DEFAULT_TINT.r, DEFAULT_TINT.g, DEFAULT_TINT.b, 1];
        out.push({ P, N, C, UV, indices, world, baseColor: [base[0], base[1], base[2]], alpha: base[3] ?? 1, texture: tex, materialName: mat.name || '', doubleSided: mat.doubleSided !== false, skinIndex: node.skin ?? null, skinName: skin?.name || null, skinMatrices: skin?.matrices || null });
      }
    }
    for (const child of node.children || []) visit(child, world);
  };
  for (const r of roots) visit(r, mat4Identity());
  for (let i = 0; i < nodes.length; i++) if (!renderVisited.has(i)) visit(i, mat4Identity());
  return out;
}

/** 复刻 loader.js normalizeModel 的几何语义：贴地 + 水平居中 + 按目标高度等比缩放。 */
function normalizeBounds(prims, targetHeight) {
  const box = worldBounds(prims);
  const size = [box.max[0] - box.min[0], box.max[1] - box.min[1], box.max[2] - box.min[2]];
  const center = [
    (box.min[0] + box.max[0]) / 2,
    (box.min[1] + box.max[1]) / 2,
    (box.min[2] + box.max[2]) / 2,
  ];
  let scale = 1;
  if (targetHeight && size[1] > 1e-4) scale = targetHeight / size[1];
  return { min: box.min, max: box.max, size, center, scale };
}

/** 图元集合的世界空间包围盒。 */
function worldBounds(prims) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const prim of prims) {
    for (let i = 0; i < prim.P[0].length; i++) {
      const w = transformPoint(prim.world, [prim.P[0][i], prim.P[1][i], prim.P[2][i]]);
      for (let k = 0; k < 3; k++) {
        if (w[k] < min[k]) min[k] = w[k];
        if (w[k] > max[k]) max[k] = w[k];
      }
    }
  }
  return { min, max };
}

/**
 * 把 normalizeModel 的变换真正施加到图元上。
 *
 * 关键：normalizeModel 的最终世界变换是
 *     final = Scale(appliedScale) * Translate(-center.x, -box.min.y, -center.z) * local
 * 所以归一化后的包围盒固定是 x∈[-size.x/2, size.x/2]、y∈[0, height]、z∈[-size.z/2, size.z/2]。
 * 渲染前必须施加这一步，否则模型停留在原始尺寸，而取景按归一化后算 —— 画面会失配。
 */
function applyNormalization(prims, targetHeight) {
  const b = normalizeBounds(prims, targetHeight);
  const { center, min, scale } = b;
  const translate = [
    1, 0, 0, -center[0],
    0, 1, 0, -min[1],
    0, 0, 1, -center[2],
    0, 0, 0, 1,
  ];
  const scaled = [
    scale, 0, 0, 0,
    0, scale, 0, 0,
    0, 0, scale, 0,
    0, 0, 0, 1,
  ];
  const m = mat4Multiply(scaled, translate);
  for (const prim of prims) prim.world = mat4Multiply(m, prim.world);
  return normalizeBounds(prims, null);
}

// ------------------------------------------------------------ 光栅化

function lookAt(eye, target, up) {
  const f = normalize3([target[0] - eye[0], target[1] - eye[1], target[2] - eye[2]]);
  let s = normalize3([
    up[1] * f[2] - up[2] * f[1],
    up[2] * f[0] - up[0] * f[2],
    up[0] * f[1] - up[1] * f[0],
  ]);
  const u = [
    s[1] * f[2] - s[2] * f[1],
    s[2] * f[0] - s[0] * f[2],
    s[0] * f[1] - s[1] * f[0],
  ];
  if (!Number.isFinite(s[0])) s = [1, 0, 0];
  // 行主序（与 transformPoint 一致）：行 r = A[r*4 .. r*4+3]，平移在 3/7/11。
  const view = [
    s[0], s[1], s[2], -(s[0] * eye[0] + s[1] * eye[1] + s[2] * eye[2]),
    u[0], u[1], u[2], -(u[0] * eye[0] + u[1] * eye[1] + u[2] * eye[2]),
    -f[0], -f[1], -f[2], f[0] * eye[0] + f[1] * eye[1] + f[2] * eye[2],
    0, 0, 0, 1,
  ];
  return view;
}

function perspective(fovY, aspect, near, far) {
  const f = 1 / Math.tan(fovY / 2);
  // 行主序：M[2][3]=2fn/(n-f) 在 A[11]，M[3][2]=-1 在 A[14]。
  return [
    f / aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, (far + near) / (near - far), (2 * far * near) / (near - far),
    0, 0, -1, 0,
  ];
}

/**
 * 相机按包围盒自动取景。dir 为相机到目标的单位方向。
 *
 * bounds 必须是**最终世界坐标**的包围盒（applyNormalization 之后）：
 * 那时模型已贴地（y 从 0 起）、x/z 已居中到 0，所以 center/size 就是最终值，
 * 不能再乘 scale —— 早先版本漏了居中偏移，导致相机瞄偏、整张图渲染成背景色。
 */
function frameCamera(bounds, opts = {}) {
  const worldCenter = [bounds.center[0], bounds.center[1], bounds.center[2]];
  const radius = 0.5 * Math.hypot(bounds.size[0], bounds.size[1], bounds.size[2]);
  const fov = opts.fov || Math.PI / 4;
  const dist = (radius / Math.tan(fov / 2)) * (opts.margin || 1.35);
  const dir = opts.dir || normalize3([0.55, 0.35, 0.75]);
  const eye = [
    worldCenter[0] + dir[0] * dist,
    worldCenter[1] + dir[1] * dist,
    worldCenter[2] + dir[2] * dist,
  ];
  // dir 一并返回：调用方要沿 dir 反向推算"相机放进模型内部"的机位。
  return { eye, target: worldCenter, fov, radius, dist, dir };
}

const DEFAULT_LIGHTS = [
  { dir: normalize3([0.5, 0.8, 0.35]), color: [1, 0.97, 0.92], intensity: 1.0 },
  { dir: normalize3([-0.6, 0.25, -0.5]), color: [0.55, 0.62, 0.78], intensity: 0.45 },
];

/**
 * 渲染图元列表为 RGB 像素。
 *
 * 关键实现点：
 *  - 视空间近平面裁剪（相机在模型内部时仍然正确）；
 *  - 透视校正插值（1/w 加权），否则贴图/顶点色会歪；
 *  - 1/z 深度缓冲（越大越近）。
 */
function renderPrimitives(prims, camera, opts = {}) {
  const width = opts.width || 640;
  const height = opts.height || 480;
  const lights = opts.lights || DEFAULT_LIGHTS;
  const ambient = opts.ambient === undefined ? 0.28 : opts.ambient;
  const bg = opts.background || [0.10, 0.12, 0.14];

  const view = lookAt(camera.eye, camera.target, opts.up || [0, 1, 0]);
  const proj = perspective(camera.fov, width / height, opts.near || 0.01, opts.far || 500);

  const colorBuf = new Float32Array(width * height * 3);
  for (let i = 0; i < width * height; i++) {
    colorBuf[i * 3] = bg[0]; colorBuf[i * 3 + 1] = bg[1]; colorBuf[i * 3 + 2] = bg[2];
  }
  const depthBuf = new Float64Array(width * height).fill(0);

  let drawn = 0;
  let culled = 0;

  for (const prim of prims) {
    const nm = normalMatrix3(prim.world);
    const idx = prim.indices;
    const triCount = Math.floor(idx.length / 3);
    for (let t = 0; t < triCount; t++) {
      const i0 = idx[t * 3], i1 = idx[t * 3 + 1], i2 = idx[t * 3 + 2];
      if (i0 === i1 || i1 === i2 || i0 === i2) continue;

      // 顶点着色：世界坐标 + 法线（法线用逆转置）
      const wp = [];
      const wn = [];
      for (const vi of [i0, i1, i2]) {
        const p = transformPoint(prim.world, [prim.P[0][vi], prim.P[1][vi], prim.P[2][vi]]);
        wp.push(p);
        if (prim.N) {
          const n = transformDir(nm, [prim.N[0][vi], prim.N[1][vi], prim.N[2][vi]]);
          wn.push(normalize3(n));
        } else {
          wn.push([0, 1, 0]);
        }
      }

      // 背面剔除（双面材质跳过）
      if (!prim.doubleSided) {
        const e1 = [wp[1][0] - wp[0][0], wp[1][1] - wp[0][1], wp[1][2] - wp[0][2]];
        const e2 = [wp[2][0] - wp[0][0], wp[2][1] - wp[0][1], wp[2][2] - wp[0][2]];
        const nrm = [
          e1[1] * e2[2] - e1[2] * e2[1],
          e1[2] * e2[0] - e1[0] * e2[2],
          e1[0] * e2[1] - e1[1] * e2[0],
        ];
        const toEye = [camera.eye[0] - wp[0][0], camera.eye[1] - wp[0][1], camera.eye[2] - wp[0][2]];
        if (nrm[0] * toEye[0] + nrm[1] * toEye[1] + nrm[2] * toEye[2] > 0) { culled++; continue; }
      }

      // 组装带属性的顶点（法线/颜色/UV 一并携带）
      const verts = [];
      for (const vi of [i0, i1, i2]) {
        let cr = prim.baseColor[0], cg = prim.baseColor[1], cb = prim.baseColor[2];
        if (prim.C) {
          cr *= prim.C[0][vi]; cg *= prim.C[1][vi]; cb *= prim.C[2][vi];
        }
        const uv = prim.UV ? [prim.UV[0][vi], prim.UV[1][vi]] : null;
        verts.push({
          vp: transformPoint(view, wp[verts.length]),
          n: wn[verts.length],
          c: [cr, cg, cb],
          uv,
        });
      }

      // 近平面裁剪：属性必须跟着插值。早先版本只裁了位置，
      // 裁剪出的新顶点拿不到对应法线/顶点色/UV —— 相机在模型内部时
      // （正是洞穴内景验收要看的机位）整片内景会取到错误的属性。
      const clipped = clipNear(verts, opts.near || 0.01);
      if (clipped.length < 3) continue;

      for (let k = 1; k + 1 < clipped.length; k++) {
        rasterizeTriangle(clipped[0], clipped[k], clipped[k + 1], prim, proj, camera,
          width, height, colorBuf, depthBuf, lights, ambient);
        drawn++;
      }
    }
  }

  const rgb = new Uint8Array(width * height * 3);
  for (let i = 0; i < width * height * 3; i++) {
    const v = Math.max(0, Math.min(255, Math.round(colorBuf[i] * 255)));
    rgb[i] = v;
  }

  const measured = measureImage(rgb, width, height, bg);
  return { rgb, width, height, drawn, culled, ...measured };
}

/** 与 QA 共用的截图指标：背景差异覆盖率、精确 RGB 颜色数、非背景且非近黑占比。 */
function measureImage(rgb, width, height, bg = [0.10, 0.12, 0.14]) {
  let covered = 0, nonBackground = 0;
  const colors = new Set();
  const br = bg[0] * 255, bgc = bg[1] * 255, bb = bg[2] * 255;
  for (let i = 0; i < width * height; i++) {
    const r = rgb[i * 3], g = rgb[i * 3 + 1], b = rgb[i * 3 + 2];
    if (Math.max(Math.abs(r - br), Math.abs(g - bgc), Math.abs(b - bb)) > 8) covered++;
    if (r > 0.08 * 255 && g > 0.08 * 255 && b > 0.08 * 255 && Math.max(Math.abs(r - br), Math.abs(g - bgc), Math.abs(b - bb)) > 8) nonBackground++;
    colors.add((r << 16) | (g << 8) | b);
  }
  return { coverage: covered / (width * height), uniqueColors: colors.size, nonBackgroundRatio: nonBackground / (width * height) };
}

/** 近平面裁剪：保留视空间 z <= -near 的部分，属性随位置线性插值。 */
function clipNear(verts, near) {
  const out = [];
  const inside = (v) => v.vp[2] <= -near;
  const lerpVert = (a, b, t) => ({
    vp: [a.vp[0] + (b.vp[0] - a.vp[0]) * t, a.vp[1] + (b.vp[1] - a.vp[1]) * t, a.vp[2] + (b.vp[2] - a.vp[2]) * t],
    n: normalize3([
      a.n[0] + (b.n[0] - a.n[0]) * t,
      a.n[1] + (b.n[1] - a.n[1]) * t,
      a.n[2] + (b.n[2] - a.n[2]) * t,
    ]),
    c: [
      a.c[0] + (b.c[0] - a.c[0]) * t,
      a.c[1] + (b.c[1] - a.c[1]) * t,
      a.c[2] + (b.c[2] - a.c[2]) * t,
    ],
    uv: (a.uv && b.uv)
      ? [a.uv[0] + (b.uv[0] - a.uv[0]) * t, a.uv[1] + (b.uv[1] - a.uv[1]) * t]
      : null,
  });
  for (let i = 0; i < verts.length; i++) {
    const a = verts[i];
    const b = verts[(i + 1) % verts.length];
    const ia = inside(a);
    const ib = inside(b);
    if (ia) out.push(a);
    if (ia !== ib) {
      const t = (-near - a.vp[2]) / (b.vp[2] - a.vp[2]);
      out.push(lerpVert(a, b, t));
    }
  }
  return out;
}

function rasterizeTriangle(v0, v1, v2, prim, proj, camera, width, height,
  colorBuf, depthBuf, lights, ambient) {
  const camTri = [v0, v1, v2];
  const sx = [];
  const sy = [];
  const invw = [];
  for (const v of camTri) {
    // v.vp 是**视空间**坐标：只乘投影矩阵。
    const clip = transformPoint(proj, v.vp);
    const w = -v.vp[2];
    const ndcX = clip[0] / w;
    const ndcY = clip[1] / w;
    sx.push((ndcX * 0.5 + 0.5) * width);
    sy.push((0.5 - ndcY * 0.5) * height);
    invw.push(1 / w);
  }
  const minX = Math.max(0, Math.floor(Math.min(sx[0], sx[1], sx[2])));
  const maxX = Math.min(width - 1, Math.ceil(Math.max(sx[0], sx[1], sx[2])));
  const minY = Math.max(0, Math.floor(Math.min(sy[0], sy[1], sy[2])));
  const maxY = Math.min(height - 1, Math.ceil(Math.max(sy[0], sy[1], sy[2])));
  if (minX > maxX || minY > maxY) return;

  const area = (sx[1] - sx[0]) * (sy[2] - sy[0]) - (sx[2] - sx[0]) * (sy[1] - sy[0]);
  if (!Number.isFinite(area) || Math.abs(area) < 1e-9) return;
  const invArea = 1 / area;

  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const px = x + 0.5, py = y + 0.5;
      let w0 = ((sx[1] - px) * (sy[2] - py) - (sx[2] - px) * (sy[1] - py)) * invArea;
      let w1 = ((sx[2] - px) * (sy[0] - py) - (sx[0] - px) * (sy[2] - py)) * invArea;
      let w2 = 1 - w0 - w1;
      if (w0 < 0 || w1 < 0 || w2 < 0) continue;

      const iw = w0 * invw[0] + w1 * invw[1] + w2 * invw[2];
      const depth = iw;
      const di = y * width + x;
      if (depth <= depthBuf[di]) continue;

      // 透视校正后的属性
      const p0 = w0 * invw[0] / iw, p1 = w1 * invw[1] / iw, p2 = w2 * invw[2] / iw;
      const n = normalize3([
        p0 * v0.n[0] + p1 * v1.n[0] + p2 * v2.n[0],
        p0 * v0.n[1] + p1 * v1.n[1] + p2 * v2.n[1],
        p0 * v0.n[2] + p1 * v1.n[2] + p2 * v2.n[2],
      ]);

      let cr = p0 * v0.c[0] + p1 * v1.c[0] + p2 * v2.c[0];
      let cg = p0 * v0.c[1] + p1 * v1.c[1] + p2 * v2.c[1];
      let cb = p0 * v0.c[2] + p1 * v1.c[2] + p2 * v2.c[2];
      if (prim.texture && v0.uv && v1.uv && v2.uv) {
        const u = p0 * v0.uv[0] + p1 * v1.uv[0] + p2 * v2.uv[0];
        const v = p0 * v0.uv[1] + p1 * v1.uv[1] + p2 * v2.uv[1];
        const tex = prim.texture;
        const tx = Math.min(tex.width - 1, Math.max(0, Math.round((u % 1 + 1) % 1 * (tex.width - 1))));
        const ty = Math.min(tex.height - 1, Math.max(0, Math.round((v % 1 + 1) % 1 * (tex.height - 1))));
        const ti = (ty * tex.width + tx) * 4;
        cr *= tex.data[ti] / 255;
        cg *= tex.data[ti + 1] / 255;
        cb *= tex.data[ti + 2] / 255;
      }

      let lr = ambient * cr, lg = ambient * cg, lb = ambient * cb;
      // CPU fallback has no normal maps or soft shadowing. Preserve readable form by
      // adding a restrained hemisphere term from the transformed normal; this is
      // deliberately geometry-only and keeps the renderer deterministic.
      const hemisphere = 0.58 + 0.42 * Math.max(0, Math.min(1, 0.5 + 0.5 * n[1]));
      for (const light of lights) {
        // 双面材质用 |N·L|：扫描内景是从内部看的，反面法线朝外，
        // 只取 max(0,·) 会让整个内景糊成一片环境色，看不出形状。
        const ndlRaw = n[0] * light.dir[0] + n[1] * light.dir[1] + n[2] * light.dir[2];
        const ndl = prim.doubleSided ? Math.abs(ndlRaw) : Math.max(0, ndlRaw);
        if (ndl <= 0) continue;
        lr += cr * ndl * light.intensity * light.color[0];
        lg += cg * ndl * light.intensity * light.color[1];
        lb += cb * ndl * light.intensity * light.color[2];
      }
      depthBuf[di] = depth;
      colorBuf[di * 3] = lr * hemisphere;
      colorBuf[di * 3 + 1] = lg * hemisphere;
      colorBuf[di * 3 + 2] = lb * hemisphere;
    }
  }
}

/** 统计图元三角形数与包围盒（用于报告，不参与渲染）。 */
function primStats(prims) {
  let tris = 0, verts = 0;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const p of prims) {
    tris += Math.floor(p.indices.length / 3);
    verts += p.P[0].length;
    for (let i = 0; i < p.P[0].length; i++) {
      const w = transformPoint(p.world, [p.P[0][i], p.P[1][i], p.P[2][i]]);
      for (let k = 0; k < 3; k++) {
        if (w[k] < min[k]) min[k] = w[k];
        if (w[k] > max[k]) max[k] = w[k];
      }
    }
  }
  return { tris, verts, min, max, size: [max[0] - min[0], max[1] - min[1], max[2] - min[2]] };
}

module.exports = {
  parseGLB,
  readAccessor,
  buildPrimitives,
  normalizeBounds,
  applyNormalization,
  worldBounds,
  renderPrimitives,
  measureImage,
  encodePNG,
  decodePNG,
  frameCamera,
  normalize3,
  mat4Identity,
  mat4Multiply,
  normalMatrix3,
  transformPoint,
  skinVertex,
  buildSkinData,
  primStats,
};
