import { stepSmartMotion } from '../src/entities/smart-fox-core.mjs';
import { BETA_TUNE } from '../src/core/beta-tuning.js';

const dt = 1 / 60;
const pointSeg = (a,b,p) => { const dx=b.x-a.x,dz=b.z-a.z,l=dx*dx+dz*dz; const t=l?Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.z-a.z)*dz)/l)):0; return Math.hypot(a.x+dx*t-p.x,a.z+dz*t-p.z); };
function trial({ moving = false, angleError = 0, distance = 5.2, seed = 0 } = {}) {
  let player = { x: 0, z: 0 }, fox = { x: Math.sin(angleError) * distance, z: -Math.cos(angleError) * distance, vx: 0, vz: 0, yaw: 0, pounceCooldown: 0, pounceCommitted: false, pounceMinDistance: BETA_TUNE.smartPounceMinDistance, pounceMaxDistance: BETA_TUNE.smartPounceMaxDistance, pounceSpeed: 10.6, pounceDashSpeedMul: 1.18, pounceStrikeSpeed: BETA_TUNE.smartPounceStrikeSpeed, pounceStrikeTime: BETA_TUNE.smartPounceStrikeTime, pounceCooldownDuration: 1 };
  let committed = false, hit = false, strikeFrames = [], prev = { ...fox };
  for (let i = 0; i < 180; i++) {
    if (moving) player = { x: Math.sin(seed * .7) * 0.2 + i * dt * 2.4, z: Math.cos(seed * .31) * 0.15 };
    const lead = { x: player.x + (moving ? 2.4 * BETA_TUNE.smartPounceLeadSeconds : 0), z: player.z };
    const next = stepSmartMotion(fox, player, dt, 'pounce', { commitAllowed: true, commitTarget: lead, commitDistanceTarget: lead, stalkSpeed: 2.4, sprintSpeed: 6.5 });
    if (!fox.pounceCommitted && next.pounceCommitted) committed = true;
    if (next.pounceCommitted && next.pounceStriking) { strikeFrames.push({ distance: Math.hypot(next.x - player.x, next.z - player.z) }); if (pointSeg(prev, next, player) <= BETA_TUNE.smartPounceHitRadiusCap) hit = true; }
    prev = { x: next.x, z: next.z }; fox = next;
    if (fox.pounceJustEnded) break;
  }
  return { committed, hit, strikeFrames: strikeFrames.map((f) => f.distance) };
}
function group(name, moving) {
  const attempts = 60, rows = [];
  for (let i = 0; i < attempts; i++) rows.push(trial({ moving, angleError: moving ? (-0.38 + (i % 39) * 0.02) : (-0.48 + (i % 49) * 0.02), distance: moving ? 4.25 + (i % 14) * 0.07 : 4.9 + (i % 16) * 0.08, seed: i }));
  const commits = rows.filter(r => r.committed).length, hits = rows.filter(r => r.hit).length;
  return { name, attempts, commits, hits, submissionRate: commits / attempts, hitRate: commits ? hits / commits : 0, rows: rows.map((r) => ({ committed: r.committed, hit: r.hit, strikeFrames: r.strikeFrames })) };
}
const result = { generatedAt: new Date().toISOString(), betaTune: { ...BETA_TUNE }, groups: [group('single-standing', false), group('single-moving', true), group('multi-fox-proxy', false)] };
console.log(JSON.stringify(result, null, 2));
