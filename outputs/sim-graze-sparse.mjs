// 用真实 BETA_TUNE 常量、按线上实测草口密度（r=3 内 21~25 株）模拟啃食/回量/自长。
import { buildGrazeGrid, createGrassGrowth, grassDensity, grazeGrass, regrowGrass } from '../src/core/graze-grid.mjs';
import { BETA_TUNE } from '../src/core/beta-tuning.js';

const T = BETA_TUNE;
const OPTS = { rate: T.grazeRate, coreRadius: T.grazeCoreRadius, haloRadius: T.grazeHaloRadius };
const dt = 1 / 60;
function mulberry(seed) { return function () { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

function makeSpot(rng, n = 24) {
  const points = [];
  for (let i = 0; i < n; i++) {
    // 均匀落在 r=3 圆盘
    const a = rng() * Math.PI * 2, r = 3 * Math.sqrt(rng());
    points.push({ index: i, x: Math.cos(a) * r, z: Math.sin(a) * r });
  }
  return { points, grid: buildGrazeGrid(points, 2), growth: createGrassGrowth(n, 1) };
}

function holdGraze(grid, growth, seconds) {
  let eaten = 0, energy = 0, wden = 0, frames = 0;
  const steps = Math.round(seconds / dt);
  for (let i = 0; i < steps; i++) {
    const r = grazeGrass(growth, grid, 0, 0, dt, OPTS);
    eaten += r.eaten;
    if (r.capacity > 0) { energy += T.grazeRegenPerSec * (r.eaten / r.capacity) * dt; wden += r.eaten / r.capacity; frames++; }
  }
  return { eaten, energy, meanWeightedDensity: frames ? wden / frames : 0 };
}

// —— 场景 A：原地按住 6s，逐秒记录 ——
const TRIALS = 40;
const perSecond = [];
for (let s = 0; s <= 6; s++) perSecond.push({ density: 0, energyRate: 0, zeros: 0 });
let oneSecEaten = 0, oneSecEnergy = 0, cycleEnergy = 0, coreTimeToZero = [];
for (let trial = 0; trial < TRIALS; trial++) {
  const rng = mulberry(1234 + trial);
  const { grid, growth } = makeSpot(rng);
  const coreIdx = grid.points.size ? queryCore(grid) : [];
  function queryCore(g) { return [...g.points.keys()].filter((i) => Math.hypot(g.points.get(i).x, g.points.get(i).z) <= T.grazeCoreRadius); }
  let cumEnergy = 0;
  for (let sec = 0; sec < 6; sec++) {
    const before = holdGraze(grid, growth, 1);
    cumEnergy += before.energy;
    const d = grassDensity(grid, growth, 0, 0, T.grazeHaloRadius);
    let zeros = 0; growth.forEachDamaged((i, v) => { if (v === 0) zeros++; });
    perSecond[sec + 1].density += d;
    perSecond[sec + 1].energyRate += before.energy; // 这 1 秒内回的储备 = /秒
    perSecond[sec + 1].zeros += zeros;
    if (sec === 0) { oneSecEaten += before.eaten; oneSecEnergy += before.energy; }
  }
  // 0.6s 一轮的能量（全新草位）
  const fresh = makeSpot(rng);
  cycleEnergy += holdGraze(fresh.grid, fresh.growth, T.grassSeconds).energy;
  // 核心株啃光所需时间
  const spot = makeSpot(rng);
  if (coreIdx.length) {
    let t = 0;
    while (growth.get?.(0) !== undefined && false) {} // noop
    const cidx = queryCore(spot.grid)[0];
    while (t < 10 && spot.growth.get(cidx) > 0) { grazeGrass(spot.growth, spot.grid, 0, 0, dt, OPTS); t += dt; }
    coreTimeToZero.push(t);
  }
}
for (const row of perSecond) { row.density /= TRIALS; row.energyRate /= TRIALS; row.zeros = +(row.zeros / TRIALS).toFixed(1); }
console.log('常量:', JSON.stringify({ rate: T.grazeRate, regrow: T.grassRegrowPerSec, regen: T.grazeRegenPerSec, core: T.grazeCoreRadius, halo: T.grazeHaloRadius, grassSeconds: T.grassSeconds }));
console.log('\n场景A：原地持续啃（24 株/圆盘, 40 次随机平均）');
console.log('初始连续密度 = 1.000, 初始回量 = 8.00/s');
perSecond.forEach((r, i) => { if (i) console.log(`啃 ${i}s: 密度=${r.density.toFixed(3)}  该秒回量=${r.energyRate.toFixed(2)} 储备/s  累计秃株≈${r.zeros}`); });
console.log(`\n啃 1 秒：吃掉 growth ${(oneSecEaten / TRIALS).toFixed(2)} 株当量，回储备 ${(oneSecEnergy / TRIALS).toFixed(2)}`);
console.log(`0.6s 一轮飘字数值 ≈ +${Math.round(cycleEnergy / TRIALS)} 储备（全新草位）`);
console.log(`核心圈一株啃光平均耗时 ${(coreTimeToZero.reduce((a, b) => a + b, 0) / coreTimeToZero.length).toFixed(2)}s`);

// —— 场景 B：啃 6s 后离开，慢速自长 ——
console.log('\n场景B：啃 6s 后离开，自长 0.012/s');
const rng = mulberry(99);
const spot = makeSpot(rng);
holdGraze(spot.grid, spot.growth, 6);
const d0 = grassDensity(spot.grid, spot.growth, 0, 0, 3);
for (const wait of [10, 20, 40, 83]) {
  while (Math.abs((regrowAccum(spot, 0)) - wait) > 0.01) break;
}
function regrowAccum(s, target) { return 0; }
const { grid, growth } = spot;
let elapsed = 0;
const checkpoints = [10, 20, 40, 83];
let ci = 0; const results = [`离开时密度=${d0.toFixed(3)}`];
while (ci < checkpoints.length) {
  const target = checkpoints[ci];
  while (elapsed < target) { regrowGrass(growth, dt, T.grassRegrowPerSec); elapsed += dt; }
  results.push(`${target}s 密度=${grassDensity(grid, growth, 0, 0, 3).toFixed(3)}`);
  ci++;
}
console.log(results.join('，'));

// —— 场景 C：原地无限按住（边啃边自长）稳态回量 ——
const eq = makeSpot(mulberry(7));
const warm = 120 / dt, measure = 30 / dt;
for (let i = 0; i < warm; i++) { grazeGrass(eq.growth, eq.grid, 0, 0, dt, OPTS); regrowGrass(eq.growth, dt, T.grassRegrowPerSec); }
let eaten = 0, cap = 0;
for (let i = 0; i < measure; i++) { const r = grazeGrass(eq.growth, eq.grid, 0, 0, dt, OPTS); eaten += r.eaten; cap += r.capacity; regrowGrass(eq.growth, dt, T.grassRegrowPerSec); }
console.log(`\n场景C：原地持续啃 2 分钟后的稳态：加权密度=${(eaten / cap).toFixed(4)}，回量=${(T.grazeRegenPerSec * eaten / cap).toFixed(3)} 储备/s（满草为 8/s），啃/长速度比=${(T.grazeRate / T.grassRegrowPerSec).toFixed(0)}:1`);
