/**
 * 离线探针：直接解码 assets/splats/scene.spz，判定哪根轴是竖直轴。
 * 复刻 tools/probe-spz-axes.cjs 的判据（分层分布熵 + 最密层占比），但在 Node 里跑，
 * 不依赖浏览器/WebGPU。用法: node tools/probe-spz-axes-node.cjs
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const FILE = path.resolve(__dirname, '..', 'assets', 'splats', 'scene.spz');

const buf = fs.readFileSync(FILE);
const raw = zlib.gunzipSync(buf);           // 文件是 gzip 包裹的 SPZ v1-3
const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);

const magic = view.getUint32(0, true);
const version = view.getUint32(4, true);
const count = view.getUint32(8, true);
const shDegree = view.getUint8(12);
const fractionalBits = view.getUint8(13);
const flags = view.getUint8(14);

console.log(`SPZ: magic=0x${magic.toString(16)} version=${version} count=${count.toLocaleString()} shDegree=${shDegree} fractionalBits=${fractionalBits} flags=${flags}`);
if (magic !== 0x5053474e) { console.error('不是 SPZ（magic 不匹配）'); process.exit(1); }
if (version !== 2 && version !== 3) { console.error('本探针只处理 v2/v3（3 字节定点位置）'); process.exit(1); }

// 位置: count*3 个 int24，scale = 2^-fractionalBits
const posSize = count * 9;
const pOff = 16;
const scale = 1 / (1 << fractionalBits);
const xs = new Float64Array(count), ys = new Float64Array(count), zs = new Float64Array(count);
const readInt24 = (o) => ((raw[o] << 8) | (raw[o + 1] << 16) | (raw[o + 2] << 24)) >> 8;
for (let i = 0; i < count; i++) {
  const o = pOff + i * 9;
  xs[i] = readInt24(o) * scale;
  ys[i] = readInt24(o + 3) * scale;
  zs[i] = readInt24(o + 6) * scale;
}

// —— 判据（与 probe-spz-axes.cjs 一致）：沿轴分 50 层，看分布集中度 ——
function analyze(arr, name) {
  let mn = Infinity, mx = -Infinity;
  for (const v of arr) { if (v < mn) mn = v; if (v > mx) mx = v; }
  const span = mx - mn;
  const L = 50;
  const hist = new Array(L).fill(0);
  for (const v of arr) {
    let k = Math.floor(((v - mn) / (span || 1)) * L);
    if (k < 0) k = 0; if (k >= L) k = L - 1;
    hist[k]++;
  }
  const n = arr.length;
  const top6 = hist.slice().sort((a, b) => b - a).slice(0, 6).reduce((s, v) => s + v, 0) / n;
  let ent = 0;
  for (const c of hist) { const p = c / n; if (p > 0) ent -= p * Math.log(p); }
  return { name, mn, mx, span, top6, ent, hist };
}

const axes = [analyze(xs, 'X'), analyze(ys, 'Y'), analyze(zs, 'Z')];
console.log('\n======== SPZ 轴向分析（离线） ========');
for (const a of axes) {
  console.log(`  轴 ${a.name}: 跨度 ${a.span.toFixed(1)}  范围 [${a.mn.toFixed(1)}, ${a.mx.toFixed(1)}]`);
  console.log(`      最密 6 层占比 ${(a.top6 * 100).toFixed(1)}%   分布熵 ${a.ent.toFixed(3)}`);
  const bars = a.hist.map((v) => {
    const w = Math.min(6, Math.round(v / n2(a)));
    return w > 0 ? '█'.repeat(w) : '·';
  });
  console.log('      ' + bars.join(''));
}
function n2(a) { return a.hist.reduce((s, v) => s + v, 0) / 100; }

const byEnt = [...axes].sort((p, q) => p.ent - q.ent);
const byTop = [...axes].sort((p, q) => q.top6 - p.top6);
const bySpan = [...axes].sort((p, q) => q.span - p.span);
console.log('\n======== 判定 ========');
console.log(`  熵最小 = 轴 ${byEnt[0].name}  → 最可能是竖直轴`);
console.log(`  最密层占比最高 = 轴 ${byTop[0].name}`);
console.log(`  跨度最大 = 轴 ${bySpan[0].name}（地面纵深）`);

// 附加：给 gs/main.js 修复用的包围盒数据
console.log('\n======== 包围盒（供摆放计算） ========');
console.log(`  min: [${axes[0].mn.toFixed(1)}, ${axes[1].mn.toFixed(1)}, ${axes[2].mn.toFixed(1)}]`);
console.log(`  max: [${axes[0].mx.toFixed(1)}, ${axes[1].mx.toFixed(1)}, ${axes[2].mx.toFixed(1)}]`);
console.log(`  center: [${((axes[0].mn + axes[0].mx) / 2).toFixed(1)}, ${((axes[1].mn + axes[1].mx) / 2).toFixed(1)}, ${((axes[2].mn + axes[2].mx) / 2).toFixed(1)}]`);

// 竖直轴的低分位（地面层参考）：把判定出的竖直轴排序取 20% 分位
const vert = byEnt[0].name === 'X' ? xs : byEnt[0].name === 'Y' ? ys : zs;
const sortedVert = Float64Array.from(vert).sort();
console.log(`\n  竖直轴(${byEnt[0].name}) 分位: p10=${sortedVert[Math.floor(count * 0.1)].toFixed(1)} p20=${sortedVert[Math.floor(count * 0.2)].toFixed(1)} p50=${sortedVert[Math.floor(count * 0.5)].toFixed(1)} p90=${sortedVert[Math.floor(count * 0.9)].toFixed(1)}`);
