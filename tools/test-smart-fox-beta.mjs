import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  utilityScores,
  updatePerception,
  applyInterruption,
  stepSmartMotion,
  SMART_INTENTS,
} from '../src/entities/smart-fox-core.mjs';

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
