/**
 * splat 贴图版 —— 独立程序化高度场（不 import src/gs/*，也不改 src/core/utils.js）。
 *
 * 与 src/gs/heightfield.js 的关系：
 *   gs 版是从高斯泼溅点云“统计”出高度场（buildHeightFieldFromSplat.heightAt）；
 *   本文件是纯程序化 FBM 高度场，但对外保持与 src/core/utils.js 一致的
 *   terrainHeight(x, z) / terrainNormal(x, z, out) 签名，
 *   src/splat/main.js 与 terrain.js / splat-painter.js 共用同一份采样，
 *   保证“几何起伏 / 权重分布 / 相机贴地”三者不会错位。
 *
 * 数据流（任务书）：
 *   Math.seedrandom('marmot3d') 决定 → FBM 4 octave → 主峰 6m、副峰 2m。
 */

import { splat } from '../core/config.js';

// 对外暴露活动场尺寸（测试与 painter 共用，与 core/config 的 FIELD_W/H 同值）
export const FIELD_W = splat.fieldW; // 130
export const FIELD_H = splat.fieldH; // 78

// ————————————————————————————————————————
// seedrandom：经典 Math.seedrandom(seed) 子集
// 返回 () => [0,1)，并挂到 Math.seedrandom（若宿主没有）。
// xmur3 做种子串散列，mulberry32 做主 PRNG。
// ————————————————————————————————————————
function xmur3(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return function next() {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return h >>> 0;
  };
}

function mulberry32(a) {
  return function rng() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seedrandom(seed) {
  return mulberry32(xmur3(String(seed))());
}

if (typeof Math === 'object' && typeof Math.seedrandom !== 'function') {
  Math.seedrandom = seedrandom;
}

// —— 用种子 PRNG 建置换表 + 格点值（同 seed 必出同地形）——
const _rng = Math.seedrandom(splat.seed || 'marmot3d');
const N = 256;
const _perm = new Uint8Array(N * 2);
const _vals = new Float32Array(N);
{
  const p = new Uint8Array(N);
  for (let i = 0; i < N; i++) p[i] = i;
  for (let i = N - 1; i > 0; i--) {
    const j = (_rng() * (i + 1)) | 0;
    const t = p[i]; p[i] = p[j]; p[j] = t;
  }
  for (let i = 0; i < N; i++) {
    _perm[i] = _perm[i + N] = p[i];
    _vals[i] = _rng() * 2 - 1; // -1..1
  }
}

function lattice(ix, iy) {
  return _vals[_perm[(ix & 255)] ^ (iy & 255)];
}

function smooth(t) { return t * t * (3 - 2 * t); }

/** 二维 value noise，输出 -1..1 */
export function valueNoise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = smooth(xf), v = smooth(yf);
  const a = lattice(xi, yi);
  const b = lattice(xi + 1, yi);
  const c = lattice(xi, yi + 1);
  const d = lattice(xi + 1, yi + 1);
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}

/** 分形 value noise，4 octave（默认），归一化到 -1..1 */
export function fbm(x, y, octaves = 4, lacunarity = 2.0, gain = 0.5) {
  let sum = 0, amp = 1, freq = 1, norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += valueNoise(x * freq, y * freq) * amp;
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return sum / norm;
}

// —— 双峰值：主峰 6m / 副峰 2m，四次回落（rim 处导数为 0，无环形断崖）——
function peakField(x, z) {
  let h = 0;
  for (const pk of splat.peaks) {
    const dx = (x - pk.x) / pk.r;
    const dz = (z - pk.z) / pk.r;
    const d2 = dx * dx + dz * dz;
    if (d2 < 1) {
      const f = 1 - d2;
      h += pk.h * f * f;
    }
  }
  return h;
}

/**
 * 地形高度（米）。全场共用纯函数：
 *   双峰值 + FBM4 起伏（amp 1.1m）- 0.15m 基准下沉，
 *   低洼处自然落入 <0.3m 沙地带。
 */
export function terrainHeight(x, z) {
  const rolling = fbm(x * 0.03 + 11.3, z * 0.03 - 7.1, 4) * 1.1;
  return peakField(x, z) + rolling - 0.15;
}

/**
 * 地形法线。签名与 src/core/utils.js 一致：
 * terrainNormal(x, z, out = {x:0,y:1,z:0}) → 单位向量 {x,y,z}
 */
export function terrainNormal(x, z, out = { x: 0, y: 1, z: 0 }) {
  const e = 0.6;
  const hL = terrainHeight(x - e, z), hR = terrainHeight(x + e, z);
  const hD = terrainHeight(x, z - e), hU = terrainHeight(x, z + e);
  // 中心差分：(-dh/dx, 2e, -dh/dz)
  const nx = hL - hR, ny = 2 * e, nz = hD - hU;
  const len = Math.hypot(nx, ny, nz) || 1;
  out.x = nx / len; out.y = ny / len; out.z = nz / len;
  return out;
}
