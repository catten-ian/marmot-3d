/**
 * splat 贴图版 —— 4 通道权重图（R=grass G=sand B=snow A=rock）。
 *
 * 纯计算部分 generateSplatWeights() 不依赖 DOM：输出 1024×1024 RGBA 的
 * Uint8ClampedArray（每通道 0-255），Node 可直接测试；高度/法线采样器通过
 * 参数注入（heightAt/normalAt），默认接本目录 heightfield。
 * 浏览器侧可传入 createCanvas()，函数会在内存 Canvas2D 上 putImageData；
 * paintSplatCanvas() 也可对已生成缓冲补画一张 canvas（?splatdebug=1）。
 *
 * 分类规则（任务书）：
 *   高度 <0.3m 沙 / 0.3–1.5m 草 / 1.5–3.5m 岩 / >3.5m 雪
 *   坡度 cos<0.7（>45°）岩石优先（哪怕低高度）
 *   2 octave FBM 扰动 + smoothstep 软边，防止硬边
 */

import { splat } from '../core/config.js';
import { terrainHeight, terrainNormal, fbm, FIELD_W, FIELD_H } from './heightfield.js';

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
/** 边缘在 e0→e1 的 smoothstep 隶属度 */
const ss = (x, e0, e1) => {
  const t = clamp01((x - e0) / (e1 - e0 || 1));
  return t * t * (3 - 2 * t);
};

/**
 * 单分类核：给定高度 / 坡面 cos / 噪声扰动，返回归一化权重。
 * 独立成纯函数是为了让 Node 测试与汇报能直接枚举“高度→权重向量”。
 *
 * @returns {{r:number,g:number,b:number,a:number}} r=grass g=sand b=snow a=rock
 */
export function weightsFromHN(h, cosSlope, noise = 0) {
  const he = h + noise * splat.noiseAmp;

  // 高度阈值以配置值为中心，用 bandSoft 做平滑扰动边缘。
  const soft = splat.bandSoft;
  const sandEdge0 = splat.bands.sand - soft, sandEdge1 = splat.bands.sand + soft;
  const grassEdge0 = splat.bands.grass - soft, grassEdge1 = splat.bands.grass + soft;
  const rockEdge0 = splat.bands.rock - soft, rockEdge1 = splat.bands.rock + soft;
  const wSand = 1 - ss(he, sandEdge0, sandEdge1);
  const wGrass = ss(he, sandEdge0, sandEdge1) * (1 - ss(he, grassEdge0, grassEdge1));
  const wRockBelt = ss(he, grassEdge0, grassEdge1) * (1 - ss(he, rockEdge0, rockEdge1));
  const wSnow = ss(he, rockEdge0, rockEdge1);

  // 坡度 → 岩石优先：cos<0.7（>45°）开始转岩，cos<=0.55 时完全岩石。
  // 陡坡覆盖高度带，低高度斜面也会得到岩石权重。
  const wSlopeRock = 1 - ss(cosSlope, splat.slopeRockCos - 0.15, splat.slopeRockCos);
  const wRock = Math.max(wRockBelt, wSlopeRock);

  // 岩石权重优先挤掉其余材质，形成连续、归一化的 RGBA 权重。
  const suppress = 1 - wRock;
  let r = wGrass * suppress;
  let g = wSand * suppress;
  let b = wSnow * suppress;
  let a = wRock;
  const sum = r + g + b + a || 1;
  const out = [r / sum, g / sum, b / sum, a / sum];
  // 数值吸附：纯带里 1e-16 级浮点残差归零，权重再归一，保证纯带严格 0/1。
  for (let i = 0; i < 4; i++) if (out[i] < 1e-10) out[i] = 0;
  const s2 = out[0] + out[1] + out[2] + out[3] || 1;
  for (let i = 0; i < 4; i++) out[i] = Math.round((out[i] / s2) * 1e10) / 1e10;
  return { r: out[0], g: out[1], b: out[2], a: out[3] };
}

/** 世界坐标 → 权重向量（2 octave FBM 扰动） */
export function splatWeightsAt(x, z, heightAt = terrainHeight, normalAt = terrainNormal) {
  const h = heightAt(x, z);
  const n = normalAt(x, z);
  const noise = fbm(x * 0.08 + 40.7, z * 0.08 - 22.4, 2);
  return weightsFromHN(h, n.y, noise);
}

/**
 * 生成全场权重图（契约 API）。
 *
 * @param opts.width     1024
 * @param opts.height    1024
 * @param opts.fieldW    世界宽 130m（默认取 config.splat.fieldW）
 * @param opts.fieldH    世界高 78m
 * @param opts.heightAt  (x,z)=>y 采样器（可注入，默认 heightfield.terrainHeight）
 * @param opts.normalAt  (x,z)=>{x,y,z} 采样器
 * @param opts.createCanvas 浏览器传 () => HTMLCanvasElement 时，
 *                        会在内存 Canvas2D putImageData（Node 测试传 null）
 * @returns {{width:number,height:number,data:Uint8ClampedArray,canvas:object|null,
 *            counts:{r,g,b,a}}}
 */
export function generateSplatWeights({
  width = splat.mapSize,
  height = splat.mapSize,
  fieldW = splat.fieldW || FIELD_W,
  fieldH = splat.fieldH || FIELD_H,
  heightAt = terrainHeight,
  normalAt = terrainNormal,
  createCanvas = typeof document !== 'undefined' && typeof document.createElement === 'function'
    ? (w, h) => { const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h; return canvas; }
    : null,
} = {}) {
  const data = new Uint8ClampedArray(width * height * 4);
  const counts = { r: 0, g: 0, b: 0, a: 0 };

  for (let py = 0; py < height; py++) {
    // DataTexture flipY=false：数据第 0 行对应 v=0；
    // PlaneGeometry rotateX(-90°) 后 v=0 落在世界 +Z 一侧。
    const wz = fieldH / 2 - ((py + 0.5) / height) * fieldH;
    for (let px = 0; px < width; px++) {
      const wx = -fieldW / 2 + ((px + 0.5) / width) * fieldW;
      const w = splatWeightsAt(wx, wz, heightAt, normalAt);
      const i = (py * width + px) * 4;
      // 四舍五入到 0-255；shader 里会再做一次归一化兜底
      data[i] = Math.round(w.r * 255);
      data[i + 1] = Math.round(w.g * 255);
      data[i + 2] = Math.round(w.b * 255);
      data[i + 3] = Math.round(w.a * 255);
      if (data[i] > 0) counts.r++;
      if (data[i + 1] > 0) counts.g++;
      if (data[i + 2] > 0) counts.b++;
      if (data[i + 3] > 0) counts.a++;
    }
  }

  let canvas = null;
  const makeCanvas = typeof createCanvas === 'function'
    ? createCanvas
    : (typeof document !== 'undefined' && typeof document.createElement === 'function'
      ? (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
      : null);
  if (makeCanvas) {
    canvas = makeCanvas(width, height);
    const ctx = canvas?.getContext?.('2d');
    if (ctx?.createImageData && ctx.putImageData) {
      const img = ctx.createImageData(width, height);
      img.data.set(data);
      ctx.putImageData(img, 0, 0);
    } else {
      canvas = null;
    }
  }
  return { width, height, data, canvas, counts };
}

/** 旧名兼容包装：terrain.js 使用。 */
export function paintSplatMap(size = splat.mapSize, fieldW = splat.fieldW, fieldH = splat.fieldH) {
  const out = generateSplatWeights({ width: size, height: size, fieldW, fieldH });
  return { data: out.data, size, fieldW, fieldH, counts: out.counts, canvas: out.canvas };
}

/**
 * 浏览器侧：对已生成缓冲补画一张内存 Canvas2D（不挂 DOM 树）。
 * ?splatdebug=1 时 main.js 挂到 window 便于肉眼检查；Node 下返回 null。
 */
export function paintSplatCanvas(painted) {
  if (typeof document === 'undefined' || !document.createElement) return null;
  const canvas = document.createElement('canvas');
  canvas.width = painted.size || painted.width;
  canvas.height = painted.size || painted.height;
  const ctx = canvas.getContext('2d');
  if (!ctx || typeof ctx.createImageData !== 'function' || typeof ctx.putImageData !== 'function') return null;
  const img = ctx.createImageData(canvas.width, canvas.height);
  img.data.set(painted.data);
  ctx.putImageData(img, 0, 0);
  return canvas;
}
