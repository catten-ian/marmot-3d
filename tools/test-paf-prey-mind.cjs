/**
 * Stage 1 · A1 多线索察觉 + A2 freeze 中间态 纯逻辑测试。
 * 用法：node tools/test-paf-prey-mind.cjs
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadPafDefaults } = require('./paf-test-helper.cjs');

let pp, P;
test.before(async () => {
  pp = await import('../src/core/predator-prey.js');
  P = loadPafDefaults();
});

test('默认值与建议书参数对齐（视锥/上升率/衰减/freeze 时长与距离带）', () => {
  assert.equal(P.visionHalfAngleDeg, 60);           // 全锥 120°
  assert.equal(P.visionRate, 1.8);
  assert.equal(P.suspicionDecay, 0.6);
  assert.equal(P.detectStalk, 6.2);
  assert.equal(P.detectSprint, 11.5);
  assert.equal(P.detectLunge, 17.0);
  assert.equal(P.freezeMin, 0.25);
  assert.equal(P.freezeMax, 0.45);
  assert.equal(P.freezeBandMin, 0.6);
  assert.equal(P.freezeBandMax, 1.0);
});

test('视锥：猎物前方 120° 内可见，正后方不可见，边界 ±60° 精确', () => {
  const half = pp.deg2rad(60);
  assert.equal(pp.inViewCone(0, 0, 5, half), true);          // 正前 +z
  assert.equal(pp.inViewCone(0, 0, -5, half), false);        // 正后
  assert.equal(pp.inViewCone(0, Math.sin(pp.deg2rad(60)) * 5, Math.cos(pp.deg2rad(60)) * 5, half), true);
  assert.equal(pp.inViewCone(0, Math.sin(pp.deg2rad(61)) * 5, Math.cos(pp.deg2rad(61)) * 5, half), false);
});

test('距离衰减：内圈平台=1，半径外=0，外圈线性', () => {
  assert.equal(pp.distanceFalloff(0, 10, 0.65), 1);
  assert.equal(pp.distanceFalloff(6.5, 10, 0.65), 1);
  assert.equal(pp.distanceFalloff(10, 10, 0.65), 0);
  assert.equal(pp.distanceFalloff(11, 10, 0.65), 0);
  const f = pp.distanceFalloff(8.25, 10, 0.65);
  assert.ok(Math.abs(f - 0.5) < 1e-9);
});

test('视觉贡献：锥内按 距离×速度系数；锥外为 0；档位 潜行<冲刺<扑击', () => {
  const mk = (mode, inCone, dist) => pp.perceptionCue({ dist, inCone, mode }, P);
  const stalk = mk('stalk', true, 1);
  const sprint = mk('sprint', true, 1);
  const lunge = mk('lunge', true, 1);
  assert.ok(stalk.visual < sprint.visual && sprint.visual < lunge.visual);
  // 锥外视觉为 0
  assert.equal(mk('sprint', false, 1).visual, 0);
  // 1m 正前方冲刺：满强度视觉 = 1.8 × 1 × 1.0
  assert.ok(Math.abs(sprint.visual - 1.8) < 1e-9);
});

test('听觉：全向（锥外仍计入），半径外不计，冲刺/扑击噪声高于潜行', () => {
  const behindStalk = pp.perceptionCue({ dist: 2, inCone: false, mode: 'stalk' }, P);
  const behindSprint = pp.perceptionCue({ dist: 2, inCone: false, mode: 'sprint' }, P);
  assert.ok(behindStalk.hearing > 0, '2m 处潜行脚步声应被听到');
  assert.ok(behindSprint.hearing > behindStalk.hearing);
  const far = pp.perceptionCue({ dist: 40, inCone: false, mode: 'lunge' }, P);
  assert.equal(far.hearing, 0);
  assert.equal(far.visual, 0);
  assert.equal(far.perceived, false);
});

test('suspicion 累积：锥内近距离持续暴露后进 alert，离开感知后 0.6/s 衰减', () => {
  const dt = 0.05;
  let mind = { state: 'wander', suspicion: 0, timer: 0 };
  let alertedAt = -1;
  let t = 0;
  while (t < 2) {
    mind = pp.stepPreyMind(mind, { dist: 4, inCone: true, mode: 'stalk', threatening: false }, dt, P, () => 0.5);
    t += dt;
    if (mind.state === 'alert' && alertedAt < 0) alertedAt = t;
  }
  assert.ok(alertedAt > 0 && alertedAt < 0.5, `应在 0.5s 内警觉，实际 ${alertedAt}`);
  // 离开感知：每步增益为 0
  const s0 = mind.suspicion;
  mind = pp.stepPreyMind(mind, { dist: 99, inCone: false, mode: 'stalk', threatening: false }, dt, P);
  assert.ok(Math.abs(mind.suspicion - (s0 - 0.6 * dt)) < 1e-9);
});

test('A2 canFreeze：仅潜行/非威胁/距离带 60%–100% 视觉半径内成立', () => {
  const base = { dist: 5, mode: 'stalk', threatening: false, perceived: true };
  assert.equal(pp.canFreeze(base, P), true);
  assert.equal(pp.canFreeze({ ...base, dist: 3 }, P), false);    // 太近（<3.72）
  assert.equal(pp.canFreeze({ ...base, dist: 7 }, P), false);    // 太远（>6.2）
  assert.equal(pp.canFreeze({ ...base, mode: 'sprint' }, P), false);
  assert.equal(pp.canFreeze({ ...base, threatening: true }, P), false);
  assert.equal(pp.canFreeze({ ...base, perceived: false }, P), false);
});

test('A2 冻结时长始终落在 0.25–0.45s（2000 次随机）', () => {
  for (let i = 0; i < 2000; i++) {
    const d = pp.rollFreezeDuration(P);
    assert.ok(d >= 0.25 - 1e-9 && d <= 0.45 + 1e-9);
  }
});

test('FSM 完整序列：wander → alert → freeze(固定0.35s) → flee', () => {
  const dt = 0.01;
  const rng = () => 0.5; // freeze 时长 = (0.25+0.45)/2 = 0.35
  let mind = { state: 'wander', suspicion: 0, timer: 0 };
  const seen = [];
  let freezeFrames = 0;
  let t = 0;
  while (t < 8) {
    mind = pp.stepPreyMind(mind, { dist: 5.8, inCone: true, mode: 'stalk', threatening: false }, dt, P, rng);
    if (seen[seen.length - 1] !== mind.state) seen.push(mind.state);
    if (mind.state === 'freeze') freezeFrames++;
    t += dt;
    if (mind.state === 'flee') break;
  }
  assert.deepEqual(seen, ['wander', 'alert', 'freeze', 'flee']);
  assert.ok(Math.abs(freezeFrames * dt - 0.35) < 0.03, `freeze ≈0.35s，实际 ${freezeFrames * dt}`);
});

test('wind/lunge 立即 flee（跳过 freeze），且必须在感知半径内', () => {
  // 5m 锥内、wind：立即 flee
  let mind = { state: 'alert', suspicion: 0.5, timer: 0.3 };
  mind = pp.stepPreyMind(mind, { dist: 5, inCone: true, mode: 'lunge', threatening: true }, 0.016, P);
  assert.equal(mind.state, 'flee');
  // 50m 外蓄力：听不到看不见，不触发 flee
  mind = { state: 'wander', suspicion: 0, timer: 0 };
  for (let i = 0; i < 20; i++) {
    mind = pp.stepPreyMind(mind, { dist: 50, inCone: true, mode: 'lunge', threatening: true }, 0.016, P);
    assert.equal(mind.state, 'wander');
  }
});

test('距离 < 视觉半径×fleeCommit 立即 flee（近距离潜行也不冻结）', () => {
  let mind = { state: 'wander', suspicion: 0, timer: 0 };
  mind = pp.stepPreyMind(mind, { dist: 3, inCone: true, mode: 'stalk', threatening: false }, 0.016, P);
  assert.equal(mind.state, 'flee');
});

test('flee 在丢失线索且 suspicion 衰减归零后回到 wander（回滞）', () => {
  let mind = { state: 'flee', suspicion: 0.1, timer: 0 };
  mind = pp.stepPreyMind(mind, { dist: 99, inCone: false, mode: 'stalk', threatening: false }, 0.2, P);
  assert.equal(mind.state, 'wander');
});
