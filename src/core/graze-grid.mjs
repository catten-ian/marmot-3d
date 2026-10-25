// beta「啃环境草」纯逻辑模块：空间网格查询 + 草株生长度(growth)状态机。
// 不依赖 three / DOM，全部函数可在 node 下单测。
//
// growth 语义：Float64Array，每株环境草一个值，范围 [0,1]。
//   1 = 草叶完好；0 = 被啃光（视觉层据此缩放到 0，画面出现秃斑）；
//   (0,1) = 被啃矮 / 正在慢慢长回来。

function clamp01(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0;
}

function cellKey(x, z, cellSize) {
  return `${Math.floor(x / cellSize)},${Math.floor(z / cellSize)}`;
}

export function buildGrazeGrid(points, cellSize = 2) {
  const size = Number.isFinite(cellSize) && cellSize > 0 ? cellSize : 2;
  const map = new Map();
  const pointsByIndex = new Map();
  for (const point of points || []) {
    if (!point || !Number.isFinite(point.index) || !Number.isFinite(point.x) || !Number.isFinite(point.z)) continue;
    pointsByIndex.set(point.index, point);
    const key = cellKey(point.x, point.z, size);
    const bucket = map.get(key);
    if (bucket) bucket.push(point.index);
    else map.set(key, [point.index]);
  }
  return { cellSize: size, map, points: pointsByIndex };
}

export function inGrazeCone(dx, dz, yaw = 0, halfAngle = Math.PI / 3) {
  const distance = Math.hypot(dx, dz);
  if (distance < 1e-9) return true;
  if (!Number.isFinite(yaw) || !(halfAngle >= 0)) return false;
  // Same convention as FirstPersonController.forwardFlat: (-sin(yaw), -cos(yaw)).
  return (-Math.sin(yaw) * dx - Math.cos(yaw) * dz) / distance >= Math.cos(halfAngle) - 1e-12;
}

export function queryGrazeRadius(grid, x, z, radius, filter = null, cone = null) {
  if (!grid?.map || !Number.isFinite(x) || !Number.isFinite(z) || !Number.isFinite(radius) || radius < 0) return [];
  const r = radius;
  const size = grid.cellSize > 0 ? grid.cellSize : 2;
  const minX = Math.floor((x - r) / size), maxX = Math.floor((x + r) / size);
  const minZ = Math.floor((z - r) / size), maxZ = Math.floor((z + r) / size);
  const out = [];
  for (let cx = minX; cx <= maxX; cx++) for (let cz = minZ; cz <= maxZ; cz++) {
    const bucket = grid.map.get(`${cx},${cz}`);
    if (!bucket) continue;
    for (const index of bucket) {
      const point = grid.points?.get(index);
      if (point && Math.hypot(point.x - x, point.z - z) > r) continue;
      if (point && cone && !inGrazeCone(point.x - x, point.z - z, cone.yaw, cone.halfAngle)) continue;
      if (!filter || filter(index)) out.push(index);
    }
  }
  return out;
}

export function createGrassGrowth(count, initial = 1) {
  const values = new Float64Array(Math.max(0, count | 0));
  values.fill(clamp01(initial));
  const valid = (index) => Number.isInteger(index) && index >= 0 && index < values.length;
  const api = {
    grow(index, amount) {
      if (!valid(index)) return 0;
      values[index] = clamp01(values[index] + (Number.isFinite(amount) ? amount : 0));
      return values[index];
    },
    get(index) { return valid(index) ? values[index] : 0; },
    set(index, value) {
      if (!valid(index)) return 0;
      values[index] = clamp01(value);
      return values[index];
    },
    damaged() {
      const out = [];
      for (let i = 0; i < values.length; i++) if (values[i] < 1) out.push(i);
      return out;
    },
    damagedCount() { let n = 0; for (const value of values) if (value < 1) n++; return n; },
    reset() { values.fill(1); },
    forEachDamaged(fn) { for (let i = 0; i < values.length; i++) if (values[i] < 1) fn(i, values[i]); },
  };
  return api;
}

/**
 * 连续密度：半径内所有草株 growth 的平均值（阈值二值法已取消）。
 *   全草完好 = 1；半径内草被吃掉 40%（或普遍只剩 60% 高度）≈ 0.6；
 *   半径内没有草株（竞技场边缘）或全部被啃光 = 0。
 * 于是「越稀疏 → 每秒回量越少」是平滑关系，不再有跌破阈值瞬间归零的断崖。
 */
export function grassDensity(grid, growth, x, z, radius, cone = null) {
  const indices = queryGrazeRadius(grid, x, z, radius, null, cone);
  if (!indices.length) return 0;
  let sum = 0;
  for (const index of indices) sum += growth?.get?.(index) ?? 0;
  return clamp01(sum / indices.length);
}

/**
 * 距离权重：核心圈(d<=core)权重 1（满速啃），外圈权重线性衰减，
 * 到 halo 边界为 0。替代旧版「核心一律归零 / 外圈一律 0.3」的二值啃法。
 */
export function grazeWeight(distance, coreRadius, haloRadius) {
  if (!(distance >= 0)) return 0;
  if (distance <= coreRadius) return 1;
  if (distance >= haloRadius || haloRadius <= coreRadius) return 0;
  return (haloRadius - distance) / (haloRadius - coreRadius);
}

/**
 * 渐进啃食：按 dt 连续扣减半径内每株草的 growth。
 *   单株扣减量 = rate * dt * weight(distance)
 * 不会一口把范围清零；同一点位被反复啃，growth 才会逐帧降到 0。
 *
 * 返回：
 *   eaten    —— 本帧实际吃掉的 growth 总量（「株当量」，已按各株剩余量截断，
 *                能量/文案收益只与这个真实吃到的量挂钩）
 *   capacity —— 假如圈内草全部完好，本帧能吃掉的 growth 总量
 *                （= rate * dt * Σweight，几何常量）
 *   touched  —— growth 实际发生变化的草株索引（供视觉层更新矩阵）
 * eaten / capacity 即按距离加权的连续密度：草越稀疏，同样按住每秒吃到的越少。
 */
export function grazeGrass(growth, grid, x, z, dt, {
  rate = 0.55, coreRadius = 1.2, haloRadius = 3.0, yaw = null, halfAngle = Math.PI / 3,
} = {}) {
  if (!growth || !grid?.points || !(dt > 0) || !(rate > 0) || !(haloRadius > 0)) {
    return { eaten: 0, capacity: 0, touched: [] };
  }
  const core = Math.min(coreRadius, haloRadius);
  const cone = Number.isFinite(yaw) ? { yaw, halfAngle } : null;
  const indices = queryGrazeRadius(grid, x, z, haloRadius, null, cone);
  let eaten = 0;
  let weightSum = 0;
  const touched = [];
  for (const index of indices) {
    const point = grid.points.get(index);
    const distance = Math.hypot(point.x - x, point.z - z);
    const weight = grazeWeight(distance, core, haloRadius);
    if (weight <= 0) continue;
    weightSum += weight;
    const current = growth.get(index);
    if (current <= 0) continue;
    const decrement = Math.min(current, rate * dt * weight);
    if (decrement <= 0) continue;
    growth.set(index, current - decrement);
    eaten += decrement;
    touched.push(index);
  }
  return { eaten, capacity: rate * dt * weightSum, touched };
}

/**
 * 慢速自长：所有未满 growth 每株每秒加 perSecond（clamp 到 1）。
 * 默认 ~0.012/s，即啃光后约 83 秒才长满，明显慢于啃食速度（rate≈0.55/s）。
 * 密度由 growth 求和得到，所以生长会让连续密度与回量一起平滑回升。
 *
 * 返回 { grown, touched }：grown 是实际增加的 growth 总量（被 clamp 截断的
 * 部分不计），touched 是发生变化的索引，供视觉层批量更新。
 */
export function regrowGrass(growth, dt, perSecond = 0.012) {
  let grown = 0;
  const touched = [];
  if (!growth || !(dt > 0) || !(perSecond > 0)) return { grown, touched };
  const amount = perSecond * dt;
  growth.forEachDamaged((index, value) => {
    const next = growth.grow(index, amount);
    const delta = next - value;
    if (delta > 0) {
      grown += delta;
      touched.push(index);
    }
  });
  return { grown, touched };
}
