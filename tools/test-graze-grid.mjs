import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildGrazeGrid, queryGrazeRadius, createGrassGrowth,
  grassDensity, grazeWeight, grazeGrass, regrowGrass, inGrazeCone,
} from '../src/core/graze-grid.mjs';
import { BETA_TUNE } from '../src/core/beta-tuning.js';

const RATE = BETA_TUNE.grazeRate;           // 0.55 growth/秒（满权重）
const REGROW = BETA_TUNE.grassRegrowPerSec; // 0.012 growth/秒（慢速自长）
const CORE = BETA_TUNE.grazeCoreRadius;
const HALO = BETA_TUNE.grazeHaloRadius;
const OPTS = { rate: RATE, coreRadius: CORE, haloRadius: HALO };

// 构造一圈确定性草点：在 [-3,3] 网格上间距 0.5 布点（仅 r<=halo 内才会被查到）。
function buildPatch(spacing = 0.5) {
  const points = [];
  let index = 0;
  const n = Math.ceil(HALO / spacing);
  for (let ix = -n; ix <= n; ix++) for (let iz = -n; iz <= n; iz++) {
    const x = ix * spacing, z = iz * spacing;
    if (Math.hypot(x, z) <= HALO) points.push({ index: index++, x, z });
  }
  return { points, grid: buildGrazeGrid(points, 2), growth: createGrassGrowth(points.length, 1) };
}

test('grid queries radius boundaries and filters', () => {
  const grid = buildGrazeGrid([{ index: 0, x: 0, z: 0 }, { index: 1, x: 1.9, z: 0 }, { index: 2, x: 2, z: 2 }, { index: 3, x: 5, z: 0 }], 2);
  assert.deepEqual(queryGrazeRadius(grid, 0, 0, 2).sort((a, b) => a - b), [0, 1]);
  assert.deepEqual(queryGrazeRadius(grid, 2, 2, 0), [2]);
  assert.deepEqual(queryGrazeRadius(grid, 0, 0, 10, (i) => i % 2 === 0).sort((a, b) => a - b), [0, 2]);
  assert.deepEqual(queryGrazeRadius(buildGrazeGrid([]), 0, 0, 2), []);
});

test('growth tracks damage and regrowth with clamping', () => {
  const g = createGrassGrowth(3);
  assert.equal(g.get(0), 1);
  g.set(1, 0);
  assert.deepEqual(g.damaged(), [1]);
  assert.equal(g.damagedCount(), 1);
  assert.equal(g.grow(1, .1), .1);
  g.grow(1, 99);
  assert.equal(g.get(1), 1);
  g.set(1, -5);
  assert.equal(g.get(1), 0);
  g.set(1, 99);
  assert.equal(g.get(1), 1);
  g.set(2, 0);
  g.reset();
  assert.equal(g.damagedCount(), 0);
});

test('density is a continuous quantity (no binary 0.5 threshold)', () => {
  // 10 株草沿 x 排开，半径 3 全部覆盖查询中心
  const points = Array.from({ length: 10 }, (_, index) => ({ index, x: -2 + index * 0.5, z: 0 }));
  const grid = buildGrazeGrid(points, 2);
  const g = createGrassGrowth(10);
  assert.equal(grassDensity(grid, g, 0.25, 0, 3), 1);
  // 吃掉 40%（10 株里 4 株啃光）：密度 0.6，下降幅度 ≈40%，绝不是掉到 0。
  for (let i = 0; i < 4; i++) g.set(i, 0);
  const d = grassDensity(grid, g, 0.25, 0, 3);
  assert.ok(Math.abs(d - 0.6) < 1e-12, `expected 0.6 got ${d}`);
  // 普遍啃剩 60% 高度（没有一株为 0）→ 密度仍是 0.6（连续），旧二值法会判 0。
  for (let i = 0; i < 10; i++) g.set(i, 0.6);
  assert.ok(Math.abs(grassDensity(grid, g, 0.25, 0, 3) - 0.6) < 1e-12);
  for (let i = 0; i < 10; i++) g.set(i, 0);
  assert.equal(grassDensity(grid, g, 0.25, 0, 3), 0);
  // 半径内没有草株（竞技场边缘）→ 0。
  assert.equal(grassDensity(grid, g, 50, 50, 3), 0);
});

test('case 1: grazing deducts a continuous amount, never wipes the radius in one bite', () => {
  const { grid, growth } = buildPatch();
  const before = grassDensity(grid, growth, 0, 0, HALO);
  assert.equal(before, 1);
  // 单帧 dt=0.1：核心株只被扣掉 rate*dt=0.055
  const r = grazeGrass(growth, grid, 0, 0, 0.1, OPTS);
  assert.ok(Math.abs(r.eaten - r.capacity) < 1e-12, 'first frame on full grass eats at full capacity');
  const center = queryGrazeRadius(grid, 0, 0, 0.01)[0];
  assert.ok(Math.abs(growth.get(center) - (1 - RATE * 0.1)) < 1e-12);
  assert.ok(growth.get(center) > 0.9, 'one small dt must not clear a blade');
  assert.equal(growth.damagedCount(), r.touched.length);
  // 密度只是小幅下降，绝不像旧版一口归零
  const after = grassDensity(grid, growth, 0, 0, HALO);
  assert.ok(after > 0.9 && after < 1, `density after one frame ${after}`);
  // dt=0 / 非法参数不吃草
  assert.deepEqual(grazeGrass(growth, grid, 0, 0, 0, OPTS), { eaten: 0, capacity: 0, touched: [] });
});

test('case 1b: repeated grazing accumulates and eventually clears blades', () => {
  const { grid, growth } = buildPatch();
  let total = 0;
  for (let i = 0; i < 60; i++) total += grazeGrass(growth, grid, 0, 0, 0.1, OPTS).eaten;
  const center = queryGrazeRadius(grid, 0, 0, 0.01)[0];
  assert.equal(growth.get(center), 0, 'core blade eaten to zero after ~6s of holding');
  assert.ok(total > 0);
  // 被啃秃后继续啃：每帧吃到量相对满圈产能已极低（能量口径同步接近 0）
  const idle = grazeGrass(growth, grid, 0, 0, 0.1, OPTS);
  assert.ok(idle.eaten / idle.capacity < 0.2, 'drained spot yields almost no share of capacity');
  assert.ok(grassDensity(grid, growth, 0, 0, HALO) < 0.25, "core must be bald and patch thinned");
});

test('weight falls off linearly through the halo and is binary-free', () => {
  assert.equal(grazeWeight(0, CORE, HALO), 1);
  assert.equal(grazeWeight(CORE, CORE, HALO), 1);
  assert.ok(Math.abs(grazeWeight((CORE + HALO) / 2, CORE, HALO) - 0.5) < 1e-12);
  assert.equal(grazeWeight(HALO, CORE, HALO), 0);
  assert.equal(grazeWeight(HALO + 1, CORE, HALO), 0);
});

test('case 3: per-second energy return follows continuous density monotonically', () => {
  const { grid, growth } = buildPatch();
  const REGEN = BETA_TUNE.grazeRegenPerSec;
  // 能量/秒 = grazeRegenPerSec * density，且 density = eaten/capacity（实际吃到量占比）。
  let previousDensity = Infinity;
  let previousEnergy = Infinity;
  let observedHalf = null;
  for (let i = 0; i < 40; i++) {
    const r = grazeGrass(growth, grid, 0, 0, 0.1, OPTS);
    const density = r.capacity > 0 ? r.eaten / r.capacity : 0;
    const energyPerSec = REGEN * density;
    assert.ok(density <= previousDensity + 1e-12, `density must not increase while grazing (${density} > ${previousDensity})`);
    assert.ok(energyPerSec <= previousEnergy + 1e-12, 'energy/sec must be monotone non-increasing');
    if (observedHalf === null && density <= 0.55 && density >= 0.45) observedHalf = energyPerSec;
    previousDensity = density;
    previousEnergy = energyPerSec;
  }
  // 草剩约一半时，每秒回量约为满草的一半（旧断崖法这里已经是 0）。
  assert.ok(observedHalf !== null && observedHalf > REGEN * 0.4 && observedHalf < REGEN * 0.6,
    `half-density should yield ~half regen, got ${observedHalf}`);
  // 连续密度查询同样单调
  const d = grassDensity(grid, growth, 0, 0, HALO);
  assert.ok(d > 0, 'still some grass left → density and regen stay positive');
});

test('case 4: slow regrow lifts density back but cannot out-pace grazing (no infinite energy)', () => {
  const { grid, growth } = buildPatch();
  // 先啃 3 秒把核心区啃秃
  for (let i = 0; i < 30; i++) grazeGrass(growth, grid, 0, 0, 0.1, OPTS);
  const grazed = grassDensity(grid, growth, 0, 0, HALO);
  assert.ok(grazed < 0.6, `expected visibly thinned density, got ${grazed}`);
  // 离开 20 秒，只长回来一点点（0.012/s * 20s = 0.24 growth 上限）——慢
  for (let i = 0; i < 20; i++) regrowGrass(growth, 1, REGROW);
  const grown20 = grassDensity(grid, growth, 0, 0, HALO);
  assert.ok(grown20 > grazed, 'density must rise as grass regrows');
  assert.ok(grown20 < 0.95, `20s of slow regrow must not fully restore the patch, got ${grown20}`);
  // 长满需要 ~83s 量级
  for (let i = 0; i < 80; i++) regrowGrass(growth, 1, REGROW);
  assert.ok(grassDensity(grid, growth, 0, 0, HALO) > 0.99);

  // 不变量：原地按住不放（边啃边自长，0.05s 细分），稳态每秒吃到的量远小于满产能，
  // 即生长速度(0.012)远慢于啃食速度(0.55)，不能原地无限刷能量。
  const { grid: g2, growth: gr2 } = buildPatch();
  const dt = 0.05;
  for (let i = 0; i < 60 / dt; i++) { // 预热 60s 到稳态
    grazeGrass(gr2, g2, 0, 0, dt, OPTS);
    regrowGrass(gr2, dt, REGROW);
  }
  let eatenWindow = 0, capacityWindow = 0;
  for (let i = 0; i < 30 / dt; i++) { // 再统计 30s
    const r = grazeGrass(gr2, g2, 0, 0, dt, OPTS);
    eatenWindow += r.eaten;
    capacityWindow += r.capacity;
    regrowGrass(gr2, dt, REGROW);
  }
  // 能量/秒 = 8 * (实际吃到量 / 满圈产能)，与 main.js 的结算同口径
  const equilibriumEnergyPerSec = BETA_TUNE.grazeRegenPerSec * (eatenWindow / capacityWindow);
  // 稳态回量远低于满草 8/s（理论上 ≈ 8 * 0.012/(0.55+0.012) ≈ 0.17/s），
  // 即慢速自长喂不饱持续啃食，不能原地无限刷能量。
  assert.ok(equilibriumEnergyPerSec < 1.0, `equilibrium grazing energy/sec too high: ${equilibriumEnergyPerSec}`);
});

test('case 5: fully eaten blades reach exactly growth 0 (visual layer can hide them)', () => {
  const { grid, growth } = buildPatch();
  const center = queryGrazeRadius(grid, 0, 0, CORE)[0];
  // 啃足核心株从 1 到 0 所需时间
  const steps = Math.ceil(1 / (RATE * 0.05)) + 1;
  for (let i = 0; i < steps; i++) grazeGrass(growth, grid, 0, 0, 0.05, OPTS);
  assert.equal(growth.get(center), 0);
  // 多个核心株都为 0
  const coreIndices = queryGrazeRadius(grid, 0, 0, CORE * 0.5);
  for (const i of coreIndices) assert.equal(growth.get(i), 0);
});

test('beta forage contracts remain fixed', () => {
  assert.equal(BETA_TUNE.grassSeconds, 0.6);
  assert.equal(BETA_TUNE.grazeRegenPerSec, 8.0);
  assert.equal(BETA_TUNE.grazeRate, 0.55);
  assert.equal(BETA_TUNE.grassRegrowPerSec, 0.012);
});

test('front cone uses controller yaw, excludes rear grass, and depleted front grass yields nothing until regrowth', () => {
  const points = [
    { index: 0, x: 0, z: -1 }, { index: 1, x: 0, z: 1 },
    { index: 2, x: 1, z: 0 }, { index: 3, x: -1, z: 0 },
  ];
  const grid = buildGrazeGrid(points, 2), growth = createGrassGrowth(4);
  assert.equal(inGrazeCone(0, -1, 0), true);
  assert.equal(inGrazeCone(0, 1, 0), false);
  const front = grazeGrass(growth, grid, 0, 0, 1, { ...OPTS, yaw: 0, halfAngle: Math.PI / 3 });
  assert.deepEqual(front.touched, [0]);
  assert.equal(growth.get(1), 1, 'rear grass must remain untouched');
  assert.equal(growth.get(2), 1, 'side grass outside cone remains untouched');
  growth.set(0, 0);
  assert.equal(grazeGrass(growth, grid, 0, 0, 1, { ...OPTS, yaw: 0 }).eaten, 0);
  assert.equal(queryGrazeRadius(grid, 0, 0, 3, (i) => growth.get(i) > 0, { yaw: 0, halfAngle: Math.PI / 3 }).length, 0);
  regrowGrass(growth, 1, 0.1);
  assert.ok(grazeGrass(growth, grid, 0, 0, 0.1, { ...OPTS, yaw: 0 }).eaten > 0, 'regrowth makes grass edible again');
});

test('sparse front-only local grass has a monotone harvest-speed falloff', () => {
  const points = [{ index: 0, x: 0, z: -1 }, { index: 1, x: 0, z: -2 }, { index: 2, x: 0, z: 1 }];
  const grid = buildGrazeGrid(points, 2), growth = createGrassGrowth(3);
  const opts = { ...OPTS, yaw: 0 };
  const full = grazeGrass(growth, grid, 0, 0, 0.01, opts).eaten;
  growth.set(0, 0); growth.set(1, 0);
  const empty = grazeGrass(growth, grid, 0, 0, 0.01, opts).eaten;
  growth.set(0, 0.5);
  const sparse = grazeGrass(growth, grid, 0, 0, 0.01, opts).eaten;
  assert.ok(sparse < full && sparse > 0);
  assert.equal(empty, 0);
  assert.equal(growth.get(2), 1);
});
