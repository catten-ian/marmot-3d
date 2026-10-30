import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  utilityScores,
  updatePerception,
  applyInterruption,
  stepSmartMotion,
  SMART_INTENTS,
  smartPounceDistance,
  habituateDecayRate,
  updateSmartMemory, stepInterruptionTimes, debounceIntent, createSmartPack, foxSeparation,
  trackFeint, RECOVER_LOCK, assembleSmartAim,
} from '../src/entities/smart-fox-core.mjs';
import { stepFoxLocomotion, foxMaxTurnRate, steerGroundDirection } from '../src/core/fox-motion.js';

test('utilityScores 返回全部意图且选出唯一 topIntent', () => {
  const r = utilityScores({ distance: 3, playerFacing: 1, guard: false, suspicion: 0.9 });
  for (const k of SMART_INTENTS) assert.equal(typeof r.scores[k], 'number');
  assert.ok(SMART_INTENTS.includes(r.topIntent));
  const max = Math.max(...Object.values(r.scores));
  assert.equal(r.scores[r.topIntent], max);
});

test('远距离未察觉时偏好 observe，近距离高怀疑时偏好进攻', () => {
  const far = utilityScores({ distance: 22, playerFacing: 0, suspicion: 0 });
  assert.equal(far.topIntent, 'observe');
  const near = utilityScores({ distance: 2.5, playerFacing: 1, suspicion: 1, guard: false, fatigue: 0, health: 1 });
  assert.ok(['approach', 'pounce'].includes(near.topIntent));
});

test('玩家格挡且有记忆时偏好 feint（虚晃）', () => {
  const r = utilityScores({ distance: 5, playerFacing: 0.8, guard: true, memory: 3, interruptions: 2, suspicion: 0.8 });
  assert.equal(r.scores.feint, Math.max(...['observe', 'approach', 'feint', 'pounce'].map((k) => r.scores[k])));
});

test('残血高疲劳时偏好 recover/abandon', () => {
  const r = utilityScores({ distance: 4, health: 0.1, fatigue: 1, suspicion: 0.2 });
  assert.ok(['recover', 'abandon'].includes(r.topIntent));
});

test('感知：进入视野锥且靠近时怀疑度上升，离开后衰减', () => {
  let s = { suspicion: 0 };
  for (let i = 0; i < 60; i++) s = updatePerception(s, { distance: 4, viewDot: 1, guard: false, running: false }, 1 / 60);
  assert.ok(s.suspicion > 0.5, `expected suspicion to rise, got ${s.suspicion}`);
  assert.equal(s.inCone, true);
  for (let i = 0; i < 120; i++) s = updatePerception(s, { distance: 40, viewDot: -1 }, 1 / 60);
  assert.ok(s.suspicion < 0.2, `expected suspicion to decay, got ${s.suspicion}`);
});

test('视野锥外（viewDot<cos60°）不积累怀疑', () => {
  let s = { suspicion: 0 };
  for (let i = 0; i < 60; i++) s = updatePerception(s, { distance: 3, viewDot: 0 }, 1 / 60);
  assert.ok(s.suspicion <= 0.05);
});

test('扑击一旦提交不可取消，并在约 0.72s 后进入冷却', () => {
  let st = { x: 0, z: 0, vx: 0, vz: 0, yaw: 0, maxTurnRate: 2.8, acceleration: 18, pounceCooldown: 0 };
  // 贴近目标使 pounce 意图被提交
  st = stepSmartMotion(st, { x: 0, z: 3 }, 1 / 60, 'pounce');
  assert.equal(st.pounceCommitted, true);
  const yawAtCommit = st.yaw;
  // 即使立刻改意图为 abandon，已提交的扑击仍沿固定 yaw 冲完
  for (let i = 0; i < 30; i++) st = stepSmartMotion(st, { x: -20, z: -20 }, 1 / 60, 'abandon');
  assert.equal(st.pounceCommitted, true);
  assert.ok(Math.abs(st.yaw - yawAtCommit) < 0.05, 'committed pounce must hold yaw');
  // 冲满 0.72s
  for (let i = 0; i < 20; i++) st = stepSmartMotion(st, { x: 0, z: 3 }, 1 / 60, 'pounce');
  assert.equal(st.pounceCommitted, false);
  assert.ok(st.pounceCooldown > 0);
});

test('受击打断累加记忆与打断次数', () => {
  const m = applyInterruption({ memory: 0, interruptions: 0, health: 1 }, 'damage');
  assert.equal(m.interruptions, 1);
  assert.ok(m.memory >= 1);
  assert.ok(m.health < 1);
});

test('统一运动高速转向上限更低且转向时持续前进', () => {
  let slowState = { x: 0, z: 0, yaw: 0, vx: 0, vz: 1 };
  let fastState = { x: 0, z: 0, yaw: 0, vx: 0, vz: 10 };
  for (let i = 0; i < 20; i++) {
    slowState = stepFoxLocomotion(slowState, { x: 100, z: 0 }, .1, { speed: 1 });
    fastState = stepFoxLocomotion(fastState, { x: 100, z: 0 }, .1, { speed: 10 });
  }
  const slow = slowState, fast = fastState;
  assert.ok(foxMaxTurnRate(10) < foxMaxTurnRate(1));
  assert.ok(slow.z > 0 && slow.x > 0);
});

test('pounce distance integrates acceleration and habituation is capped', () => {
  const d0 = smartPounceDistance(0), dNear = smartPounceDistance(8), dFast = smartPounceDistance(10.6);
  assert.ok(d0 < dNear && dNear < dFast);
  assert.equal(habituateDecayRate(.48, 99), .96);
});

test('pounce rejects misaligned intent and uses readable windup', () => {
  let s = { x: 0, z: 0, yaw: Math.PI, vx: 0, vz: 0, windupRemaining: .22 };
  s = stepSmartMotion(s, { x: 0, z: 5 }, 1 / 60, 'pounce');
  assert.equal(s.pounceCommitted, undefined);
  s.yaw = 0; s.windupRemaining = .22;
  s = stepSmartMotion(s, { x: 0, z: 5 }, .1, 'pounce');
  assert.notEqual(s.pounceCommitted, true);
});

test('记忆延迟后按每秒衰减且打断时间窗会过期', () => {
  let s = { memory: 1, lastInterruptionAt: 0 };
  s = updateSmartMemory(s, 1, 9, { memoryDecay: .1 }); assert.equal(s.memory, 1);
  for (let t = 10; t < 20; t++) s = updateSmartMemory(s, 1, t, { memoryDecay: .1 });
  assert.ok(Math.abs(s.memory) < 1e-9);
  assert.deepEqual(stepInterruptionTimes([0, 4, 14], 15), [4, 14]);
  console.log('ASSERT memory-delay-decay/window-expiry OK');
});

test('佯攻习惯化、防抖、群战错峰与分离纯函数', () => {
  assert.equal(habituateDecayRate(.48, 3), .78);
  assert.equal(habituateDecayRate(.48, 6), 1.08);
  assert.equal(habituateDecayRate(.48, 12), .96);
  assert.equal(debounceIntent('observe', 'approach', 0, .1).intent, 'observe');
  assert.equal(debounceIntent('observe', 'recover', 0, .01).intent, 'recover');
  const pack=createSmartPack(); assert.equal(pack.canCommit(0, 0), true); pack.recordCommit(0, 0);
  assert.equal(pack.canCommit(1, .1), false); assert.equal(pack.canCommit(1, .4), true);
  assert.ok(foxSeparation({x:0,z:0},[{x:1,z:0}]).x < 0);
  console.log('ASSERT habituation/debounce/stagger/separation OK');
});

test('权重快照保持原公式数值', () => {
  const r=utilityScores({distance:5,playerFacing:.7,guard:true,fatigue:.2,health:.8,interruptions:2,memory:1.2,suspicion:.6});
  assert.deepEqual(r.scores,{observe:.3935,approach:.581167,feint:.738667,pounce:.189667,recover:.317333,abandon:.204});
  console.log('ASSERT utility-weight-snapshot OK');
});

test('trackFeint 只统计进入佯攻且受击/扑击清零', () => {
  let s = { repeats: 0, side: 1, prevIntent: 'observe' };
  for (let i = 0; i < 3; i++) s = trackFeint(s, 'feint', { side: 1 });
  assert.equal(s.repeats, 1);
  s = trackFeint(s, 'observe', { side: 1 });
  s = trackFeint(s, 'feint', { side: 1 });
  s = trackFeint(s, 'observe', { side: 1 });
  s = trackFeint(s, 'feint', { side: 1 });
  assert.equal(s.repeats, 3);
  s = trackFeint(s, 'observe', { side: -1 });
  s = trackFeint(s, 'feint', { side: -1 });
  assert.deepEqual({ repeats: s.repeats, side: s.side }, { repeats: 1, side: -1 });
  assert.equal(trackFeint(s, 'pounce', { reset: 'pounce' }).repeats, 0);
  assert.equal(trackFeint(s, 'recover', { reset: 'hit' }).repeats, 0);
  assert.ok(habituateDecayRate(.48, 3) > habituateDecayRate(.48, 1));
  assert.equal(habituateDecayRate(.48, 99), .96);
  console.log('ASSERT track-feint/repeat-habituation OK');
});

test('feintScale 按比例作用且默认快照不变', () => {
  const input = { distance: 5, playerFacing: .7, guard: true, fatigue: .2, health: .8, interruptions: 2, memory: 1.2, suspicion: .6 };
  const base = utilityScores(input).scores.feint;
  assert.equal(utilityScores({ ...input, feintScale: 1 }).scores.feint, base);
  const low = utilityScores({ ...input, feintScale: .65 }).scores.feint;
  const high = utilityScores({ ...input, feintScale: 1.3 }).scores.feint;
  assert.ok(Math.abs(low / base - .65) < 2e-6);
  assert.ok(Math.abs(high / base - 1.3) < 2e-6);
  console.log('ASSERT feint-scale/default-equivalence OK');
});

test('扑击自然结束后的 recover 硬直阻止再次 committed', () => {
  let s = { x: 0, z: 0, vx: 0, vz: 0, yaw: 0, pounceCooldown: 0, pounceWindup: 0 };
  s = stepSmartMotion(s, { x: 0, z: 3 }, 1 / 60, 'pounce');
  for (let i = 0; i < 60 && !s.pounceJustEnded; i++) s = stepSmartMotion(s, { x: 0, z: 3 }, 1 / 60, 'recover');
  assert.equal(s.pounceCommitted, false);
  assert.equal(s.pounceJustEnded, true);
  s.pounceCooldown = 0;
  let lock = RECOVER_LOCK;
  for (let i = 0; i < 6; i++) {
    lock -= .1;
    const next = stepSmartMotion(s, { x: 0, z: 3 }, 0, 'recover', { commitAllowed: lock <= 0 });
    assert.equal(next.intent, 'recover');
    assert.notEqual(next.pounceCommitted, true);
    s = next;
  }
  s.windupRemaining = 0;
  s.x = 0; s.z = 0; s.yaw = 0; s.vx = 0; s.vz = 0;
  const ready = stepSmartMotion(s, { x: 0, z: 3 }, .01, 'pounce', { commitAllowed: true });
  assert.equal(ready.pounceCommitted, true);
  console.log('ASSERT recover-lock/recommit-gate OK');
});

test('steerGroundDirection 直冲岩石转为切向且零速返回 null', () => {
  const steer = steerGroundDirection(0, 1, 2, { x: 0, z: 0 }, [{ x: 0, z: 1, r: 1.5 }], { hw: 20, hh: 20 }, 0);
  assert.ok(steer);
  assert.ok(Math.abs(steer.x) > .05 || steer.z < .95);
  assert.equal(steerGroundDirection(1, 0, 0, { x: 0, z: 0 }, [], { hw: 20, hh: 20 }), null);
  console.log('ASSERT ground-steer/zero-speed-null OK');
});


test('Beta 扑击瞄准纯函数在提交态剔除包抄与分离偏移', () => {
  const aim = assembleSmartAim({ player: { x: 0, z: 0 }, self: { x: 1, z: -5 }, intent: 'pounce', separation: { x: 2, z: -1 }, flank: 1, pounceOffsetScale: 0 });
  assert.deepEqual({ x: aim.x, z: aim.z }, { x: 0, z: 0 });
  const approach = assembleSmartAim({ player: { x: 0, z: 0 }, self: { x: 1, z: -5 }, intent: 'observe', separation: { x: 0, z: 0 }, flank: 0, observeRadius: 7.2 });
  assert.ok(Math.hypot(approach.x, approach.z) > 0, '非扑击仍应生成战术目标');
});

test('站立玩家扑击命中率模拟处于可命中但非必中区间', () => {
  const N = 1000, reach = 1.3;
  let hits = 0;
  for (let i = 0; i < N; i++) {
    const distance = 4.2 + ((i + 0.5) / N) * 2;
    let s = { x: 0, z: -distance, vx: 0, vz: 0, yaw: 0, pounceCooldown: 0,
      pounceMinDistance: 4.2, pounceMaxDistance: 6.2, pounceSpeed: 10.6,
      pounceDashSpeedMul: 1.18, pounceStrikeSpeed: 13.5, pounceDashDuration: 0.42,
      pounceCooldownDuration: 1 };
    let hit = false;
    for (let frame = 0; frame < 80; frame++) {
      s = stepSmartMotion(s, { x: 0, z: 0 }, 1 / 60, 'pounce');
      if (s.pounceCommitted && s.pounceStriking && Math.hypot(s.x, s.z) < reach) hit = true;
    }
    if (hit) hits++;
  }
  const rate = hits / N;
  assert.ok(rate >= 0.6 && rate <= 0.95, `expected 60-95% hit rate, got ${rate}`);
  console.log(JSON.stringify({ kind: 'standing-pounce-simulation', attempts: N, hits, rate }));
});

test('提交判定独立于导航扩展目标，并锁定 lead 点', () => {
  let s = { x: 0, z: -5, vx: 0, vz: 0, yaw: 0, pounceCooldown: 0, pounceMinDistance: 4.2, pounceMaxDistance: 6.2 };
  const nav = { x: 0, z: 95 };
  const lead = { x: 0.4, z: 0 };
  s = stepSmartMotion(s, nav, 1 / 60, 'pounce', { commitTarget: lead, commitDistanceTarget: lead });
  assert.equal(s.pounceCommitted, true);
  assert.ok(Math.abs(s.pounceYaw - Math.atan2(lead.x - 0, lead.z + 5)) < 1e-9);
  const committedYaw = s.pounceYaw;
  s = stepSmartMotion(s, { x: -50, z: -50 }, 1 / 60, 'recover', { commitTarget: { x: -50, z: -50 } });
  assert.equal(s.pounceYaw, committedYaw);
});

test('智能狐 contactCd 每帧递减且不低于零', async () => {
  const { stepSmartContactCooldown } = await import('../src/entities/smart-fox-core.mjs');
  assert.equal(stepSmartContactCooldown(0.9, 0.1), 0.8);
  assert.equal(stepSmartContactCooldown(0.1, 0.2), 0);
});

test('Beta 接近环显式拆分 approach/align/backoff 且错过窗口不穿过玩家', async () => {
  const { createSmartPounceApproachState, advanceSmartPounceApproach, SMART_POUNCE_APPROACH_PHASES } = await import('../src/entities/smart-fox-core.mjs');
  const T = { smartPounceMinDistance: 4.2, smartPounceMaxDistance: 6.2 };
  let s = createSmartPounceApproachState();
  s = advanceSmartPounceApproach(s, { distance: 8, angle: 0 }, 1 / 60, T);
  assert.equal(s.phase, 'approach');
  s = advanceSmartPounceApproach(s, { distance: 5.2, angle: 0 }, 1 / 60, T);
  assert.equal(s.phase, 'align'); assert.equal(s.ready, true);
  s = advanceSmartPounceApproach(s, { distance: 2.8, angle: 0 }, 1 / 60, T);
  assert.equal(s.phase, 'backoff'); assert.ok(SMART_POUNCE_APPROACH_PHASES.includes(s.phase));
});

test('Beta 环内但未对正时不得停在 align（否则永远无法提交）', async () => {
  // 回归：旧实现把「环内 + 角度过大」判成 align 并冻结速度，
  // 而冻结时朝向又被导航避让带偏，提交角永远收敛不了 → 智能狐 0 次扑击。
  const { createSmartPounceApproachState, advanceSmartPounceApproach } = await import('../src/entities/smart-fox-core.mjs');
  const T = { smartPounceMinDistance: 4.2, smartPounceMaxDistance: 6.2 };
  let s = createSmartPounceApproachState();
  s = advanceSmartPounceApproach(s, { distance: 5.0, angle: 2.6 }, 1 / 60, T);
  assert.equal(s.phase, 'approach', '未对正时必须继续靠近/转向，不能停在 align');
  assert.equal(s.ready, false);
  // 对正后立刻具备提交条件
  s = advanceSmartPounceApproach(s, { distance: 5.0, angle: 0.1 }, 1 / 60, T);
  assert.equal(s.phase, 'align');
  assert.equal(s.ready, true);
});

test('Beta 前摇进度不得因瞬时未就绪被重置（否则永远无法提交）', async () => {
  // 回归：旧实现里，只要某一帧 pounceReady 为假，windupRemaining 就被重置为满值
  // 0.22s，提交条件 (windupRemaining <= 0) 因此永远无法满足 → 实测 0 次提交。
  const { stepSmartMotion } = await import('../src/entities/smart-fox-core.mjs');
  const base = { x: 0, z: -5.2, yaw: 0, vx: 0, vz: 0, pounceMinDistance: 4.2, pounceMaxDistance: 6.2, windupRemaining: 0.22, pounceWindup: 0.22 };
  let s = { ...base };
  for (let i = 0; i < 8; i++) s = stepSmartMotion(s, { x: 0, z: 0 }, 1 / 60, 'pounce', { commitAllowed: true });
  const afterReady = s.windupRemaining;
  assert.ok(afterReady < base.windupRemaining, '就绪期间前摇应递减');
  s = stepSmartMotion(s, { x: 0, z: 0 }, 1 / 60, 'pounce', { commitAllowed: true, commitTarget: { x: 40, z: 0 } });
  assert.ok(s.windupRemaining <= afterReady + 1e-9, '未就绪的一帧不得把前摇重置为满值');
});

test('Beta 提交与 melee 互斥，提交后仍不可取消', async () => {
  let pounce = { x: 0, z: -5, yaw: 0, vx: 0, vz: 0, pounceMinDistance: 4.2, pounceMaxDistance: 6.2, windupRemaining: 0 };
  const { stepSmartMotion } = await import('../src/entities/smart-fox-core.mjs');
  pounce = stepSmartMotion(pounce, { x: 0, z: 0 }, 1 / 60, 'pounce', { commitAllowed: true });
  assert.equal(pounce.pounceCommitted, true);
  const yaw = pounce.pounceYaw;
  pounce = stepSmartMotion(pounce, { x: 9, z: 9 }, 1 / 60, 'recover', { commitAllowed: false });
  assert.equal(pounce.pounceCommitted, true); assert.equal(pounce.pounceYaw, yaw);
});
