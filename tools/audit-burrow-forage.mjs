import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BURROWS, BERRY_POINTS, ROCKS, PLAYER, FOX, scalePoint, scaleRadius, fieldHalf } from '../src/core/config.js';

export const SPRINT_MULTIPLIER = 1.42;
export const REACTION_SECONDS = 0.25;
export const APPROACH_SPEED = 7.2;
export const TARGET_BARE_RETURN_SECONDS = 2;

export function scaledBurrowsFromConfig(burrows = BURROWS) {
  return burrows.map((b) => { const [x, z] = scalePoint([b.x, b.z]); return { ...b, x, z, r: scaleRadius(b.r) }; });
}
export function nearestBurrowForPoint(x, z, burrows) {
  let best = null;
  for (const b of burrows) {
    const dCenter = Math.hypot(x - b.x, z - b.z);
    if (!best || dCenter < best.dCenter) best = { id: b.id, type: b.type, dCenter, dEdge: Math.max(0, dCenter - b.r) };
  }
  return best;
}
export function sampleForagePoints() {
  const { hw, hh } = fieldHalf(), points = BERRY_POINTS.map((p, i) => { const [x, z] = scalePoint(p); return { id: `berry-${i + 1}`, kind: 'fixed', x, z }; });
  const rocks = ROCKS.map(([x, z, r]) => { const [sx, sz] = scalePoint([x, z]); return { x: sx, z: sz, r: scaleRadius(r) + 1 }; });
  const step = 4;
  for (let z = -hh; z <= hh; z += step) for (let x = -hw; x <= hw; x += step) {
    if (rocks.some((r) => Math.hypot(x - r.x, z - r.z) < r.r)) continue;
    points.push({ id: `grid-${x}-${z}`, kind: 'grid', x, z });
  }
  return points;
}
export function returnTimeSeconds(d, playerSpeed = PLAYER.speed) { return { bare: d / playerSpeed, sprint: d / (playerSpeed * SPRINT_MULTIPLIER) }; }
// 最坏假设狐已在 windRange，朝洞路线迎面；保守截击下界=min(纯冲刺时间, 接近速度时间)。
export function foxCloseSeconds(playerToBurrow) { return Math.min(FOX.windRange / FOX.dashSpeed, FOX.windRange / APPROACH_SPEED, Math.max(0, playerToBurrow) / APPROACH_SPEED); }
const quantile = (values, q) => values[Math.min(values.length - 1, Math.floor((values.length - 1) * q))];
const stats = (values) => { const a = [...values].sort((x, y) => x - y); return { min: a[0], p50: quantile(a, .5), p90: quantile(a, .9), max: a.at(-1) }; };
const fmt = (n) => `${n.toFixed(2)}s`;
const binsFor = (rows) => [[0, 1], [1, 2], [2, 3], [3, Infinity]].map(([lo, hi]) => ({ label: hi === Infinity ? '>3s' : `${lo}-${hi}s`, count: rows.filter((r) => r.tRun >= lo && r.tRun < hi).length }));

export function buildReport() {
  const burrows = scaledBurrowsFromConfig(), base = burrows.find((b) => b.type === 'base'), rows = sampleForagePoints().map((p) => {
    const near = nearestBurrowForPoint(p.x, p.z, burrows), baseNear = nearestBurrowForPoint(p.x, p.z, [base]), times = returnTimeSeconds(near.dEdge);
    const react = REACTION_SECONDS + foxCloseSeconds(near.dEdge);
    return { ...p, sampleId: p.id, burrowId: near.id, type: near.type, dCenter: near.dCenter, dEdge: near.dEdge, tRun: times.bare, tSprint: times.sprint, margin: times.bare - react, failsSprint: times.bare > react };
  });
  const fixed = rows.filter((r) => r.kind === 'fixed'), grid = rows.filter((r) => r.kind === 'grid'), distant = rows.filter((r) => nearestBurrowForPoint(r.x, r.z, [base]).dEdge > TARGET_BARE_RETURN_SECONDS * PLAYER.speed);
  const before = stats(distant.map((r) => returnTimeSeconds(nearestBurrowForPoint(r.x, r.z, [base]).dEdge).bare)), after = stats(distant.map((r) => r.tRun));
  const failed = rows.filter((r) => r.failsSprint).length;
  const worst = [...fixed].sort((a, b) => b.dEdge - a.dEdge).slice(0, 5);
  const quadrants = ['NW', 'NE', 'SW', 'SE'].map((q) => { const selected = distant.filter((r) => (r.z < 0 ? 'N' : 'S') + (r.x < 0 ? 'W' : 'E') === q); return { q, count: selected.filter((r) => r.tRun > TARGET_BARE_RETURN_SECONDS).length, total: selected.length }; });
  const section = (label, data) => `| ${label} | ${fmt(data.min)} | ${fmt(data.p50)} | ${fmt(data.p90)} | ${fmt(data.max)} |`;
  return `# 避难洞采食回洞空间审计\n\n采样共 ${rows.length} 点：固定采食点 ${fixed.length}，网格点 ${grid.length}（4m 网格，避开岩石 r+1）。仅分析，不自动调整玩法数值。距离按洞口边缘计。\n\n## 1. 回洞时间分布\n\n| 样本 | 最短 | p50 | p90 | 最长 |\n|---|---:|---:|---:|---:|\n${section('固定点裸跑', stats(fixed.map((r) => r.tRun)))}\n${section('网格裸跑', stats(grid.map((r) => r.tRun)))}\n${section('全部裸跑', stats(rows.map((r) => r.tRun)))}\n${section('固定点疾行', stats(fixed.map((r) => r.tSprint)))}\n${section('网格疾行', stats(grid.map((r) => r.tSprint)))}\n${section('全部疾行', stats(rows.map((r) => r.tSprint)))}\n\n裸跑时间桶：${binsFor(rows).map((b) => `${b.label}: ${b.count}`).join('；')}。\n\n## 2. windRange 最坏情况\n\n假设玩家看到预警才跑、反应耗时 ${REACTION_SECONDS}s，狐狸已在 ${FOX.windRange}m 且正朝洞路线。狐截击时间闭式取 min(9.2/14.5, 9.2/${APPROACH_SPEED}, dEdge/${APPROACH_SPEED})，再加玩家反应时间；这把狐狸接近阶段按 ${APPROACH_SPEED}m/s，属于保守上界。纯冲刺 9.2/14.5=${fmt(FOX.windRange / FOX.dashSpeed)}。模型下 ${failed}/${rows.length}（${(100 * failed / rows.length).toFixed(1)}%）的点裸跑时间超过反应+截击时间。该比例说明玩家必须依靠更早的预警线响应；shelter 用于缩短中段草原距离，而不能期待跑赢已启动的冲刺。\n\n## 3. Shelter 覆盖\n\n目标为裸跑 ≤${TARGET_BARE_RETURN_SECONDS.toFixed(1)}s（洞口边缘距 ≤${(TARGET_BARE_RETURN_SECONDS * PLAYER.speed).toFixed(1)}m）。以距 base 边缘超过目标距离的点为远端集合（${distant.length} 点）：加洞前 p90/max ${fmt(before.p90)}/${fmt(before.max)}；加 shelter 后 ${fmt(after.p90)}/${fmt(after.max)}。\n\n| 象限 | 超阈点/远端样本 |\n|---|---:|\n${quadrants.map((q) => `| ${q.q} | ${q.count}/${q.total} |`).join('\n')}\n\n## 最远固定采食点\n\n| 点 | 坐标 | 最近洞 | 类型 | 洞口边缘距 | 裸跑 | 疾行 |\n|---|---|---|---|---:|---:|---:|\n${worst.map((r) => `| ${r.sampleId} | (${r.x}, ${r.z}) | ${r.burrowId} | ${r.type} | ${r.dEdge.toFixed(2)}m | ${fmt(r.tRun)} | ${fmt(r.tSprint)} |`).join('\n')}\n\n## 方法\n\n速度来自 PLAYER.speed=${PLAYER.speed}m/s、疾行倍率 ${SPRINT_MULTIPLIER}；洞位经 config 的 scalePoint/scaleRadius 映射。对照狐狸 FOX.dashSpeed=${FOX.dashSpeed}m/s、windRange=${FOX.windRange}m。该几何模型是上界压力测试，不是遭遇概率或玩法判定。`;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const report = buildReport();
    const writeAt = process.argv.indexOf('--write');
    if (writeAt >= 0) {
      const target = process.argv[writeAt + 1], reportsRoot = path.resolve('reports');
      if (!target || !path.resolve(target).startsWith(`${reportsRoot}${path.sep}`)) throw new Error('--write path must be under reports/');
      fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, `${report}\n`);
    }
    process.stdout.write(`${report}\n`);
  } catch (error) { console.error(error); process.exitCode = 1; }
}
