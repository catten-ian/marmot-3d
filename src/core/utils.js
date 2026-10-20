/**
 * 通用工具：数学、随机数、地形高度场。
 * 高度场必须是纯函数式确定性采样，玩家/敌人/植被共用同一套，否则会浮空。
 */

import { BURROW, BURROWS, scaleCoord, scaleRadius, scalePoint } from './config.js';

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (t) => t * t * (3 - 2 * t);
export const dist2 = (ax, az, bx, bz) => Math.hypot(ax - bx, az - bz);

/** 确定性伪随机：同一 seed 序列，保证每次刷新关卡地形一致 */
export function makeRng(seed = 9137) {
  let s = seed >>> 0;
  return function rng() {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** 二维值噪声 + 分形叠加，生成平缓起伏的草原 */
function hash2(x, y) {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

export function valueNoise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = smoothstep(xf), v = smoothstep(yf);
  const a = hash2(xi, yi), b = hash2(xi + 1, yi);
  const c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1);
  return lerp(lerp(a, b, u), lerp(c, d, u), v) * 2 - 1;
}

export function fbm(x, y, octaves = 4) {
  let sum = 0, amp = 1, freq = 1, norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += valueNoise(x * freq, y * freq) * amp;
    norm += amp;
    amp *= 0.5;
    freq *= 2.03;
  }
  return sum / norm;
}

/**
 * 地形高度。全场共用：y = f(x, z)。
 * 振幅刻意压低（土拨鼠视角下过大的起伏会遮挡视野），并让洞穴附近趋于平坦。
 */
export const TERRAIN = { amp: 2.6, flatRadius: 16 };

/**
 * 地形高度源（可替换）。
 *
 * 默认是下面的程序化噪声；但 dev 版的「GS 全场景」需要用高斯泼溅点云
 * 建出的真实高度场替换它。
 *
 * 为什么要做成间接层而不是直接改函数：
 *   `terrainHeight` 被 6 个模块静态 import（utils / controls / scene /
 *   props / props_entities / effects），模块一旦求值就无法替换函数绑定。
 *   用一层可变引用，所有调用方都能自动跟随，不需要逐处改。
 *
 * 切换方式：setHeightField(fn) —— 传入 (x,z) => y 即生效；
 * 传 null 恢复程序化地形。
 */
let _heightField = null;

export function setHeightField(fn) {
  _heightField = typeof fn === 'function' ? fn : null;
  return _heightField;
}
export function heightFieldActive() {
  return _heightField !== null;
}
/** 当前使用的高度源名称（UI 展示用） */
export function heightSourceName() {
  return _heightField ? 'gs-field' : 'procedural';
}

export function baseTerrainHeight(x, z) {
  // 外部高度场优先（GS 版）
  if (_heightField) return _heightField(x, z);
  const rolling = fbm(x * 0.022, z * 0.022, 4) * TERRAIN.amp;
  const detail = fbm(x * 0.09, z * 0.09, 2) * 0.32;
  // 洞穴附近压平，保证安全区不歪斜。
  // 洞穴位置与压平半径都走运行时缩放：GS 版洞穴在 BURROW.x*K，
  // 硬编码 (x+52) 会对不上真实洞口，压错一块地。
  const bx = scaleCoord(BURROW.x, 'x');
  const bz = scaleCoord(BURROW.z, 'z');
  const flatInner = scaleRadius(6); // 系数为 1 时即历史值 6
  const flatSpan = scaleRadius(14);
  const dBurrow = Math.hypot(x - bx, z - bz);
  const flat = smoothstep(clamp((dBurrow - flatInner) / flatSpan, 0, 1));
  return (rolling + detail) * flat;
}

// 地下洞穴径向下沉系数（0=地表，1=腔底），两段式：
// d<=opening：1（平的腔室地板）；opening<d<slope：陡壁 smoothstep 回到 0；d>=slope：0。
// 纯函数放这里，供 terrainHeight 与 world/underground 共用，避免循环依赖与两处不一致。
export function depressionAt(d, p) {
  if (d <= p.openingRadius) return 1;
  if (d >= p.slopeRadius) return 0;
  const t = (p.slopeRadius - d) / (p.slopeRadius - p.openingRadius);
  return t * t * (3 - 2 * t);
}

export function terrainHeight(x, z) {
  // 外部高度场优先（GS 版）。
  // 地表网格必须保持完整，不能被压成露天绿碗；真正的地下地板由
  // undergroundFloorY() 单独提供，props.js 的封闭井壁负责遮住开口外地表。
  if (_heightField) return _heightField(x, z);
  return baseTerrainHeight(x, z);
}

/** 地形法线（用于让草丛/石块贴合坡面） */
export function terrainNormal(x, z, out = { x: 0, y: 1, z: 0 }) {
  const e = 0.6;
  const hL = terrainHeight(x - e, z), hR = terrainHeight(x + e, z);
  const hD = terrainHeight(x, z - e), hU = terrainHeight(x, z + e);
  const nx = hL - hR, ny = 2 * e, nz = hD - hU;
  const len = Math.hypot(nx, ny, nz) || 1;
  out.x = nx / len; out.y = ny / len; out.z = nz / len;
  return out;
}

/** 圆形碰撞体之间的推移，player 与敌人共用 */
export function resolveCircle(pos, radius, cx, cz, cr, pushStrength = 1) {
  const dx = pos.x - cx, dz = pos.z - cz;
  const minDist = radius + cr;
  const d = Math.hypot(dx, dz);
  if (d >= minDist || d === 0) return false;
  const nx = dx / d, nz = dz / d;
  const overlap = (minDist - d) * pushStrength;
  pos.x += nx * overlap;
  pos.z += nz * overlap;
  return true;
}
