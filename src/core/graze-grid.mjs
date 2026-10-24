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

export function queryGrazeRadius(grid, x, z, radius, filter = null) {
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

export function grassDensity(grid, growth, x, z, radius, expectedInRadius) {
  const expected = Number(expectedInRadius);
  if (!(expected > 0)) return 0;
  const indices = queryGrazeRadius(grid, x, z, radius);
  let full = 0;
  for (const index of indices) if (growth?.get(index) > 0.5) full++;
  return Math.max(0, Math.min(1, full / expected));
}
