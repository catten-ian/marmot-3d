/**
 * 藏狐体力/血量（FOX.vitals）纯函数测试。
 * 覆盖：canSprint、hpSpeedMultiplier、hpDamageMultiplier、stepStamina。
 * 用法：node tools/test-fox-vitals.cjs
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

let V, canSprint, hpSpeedMultiplier, hpDamageMultiplier, stepStamina;

test.before(async () => {
  const motion = await import('../src/core/fox-motion.js');
  const config = await import('../src/core/config.js');
  V = config.FOX.vitals;
  ({ canSprint, hpSpeedMultiplier, hpDamageMultiplier, stepStamina } = motion);
});

test('FOX.vitals 存在且数值方向正确', () => {
  assert.ok(V);
  assert.equal(V.stalkStaminaPerSec, 0);            // 慢行不耗体力
  assert.ok(V.pounceStaminaPerSec > V.sprintStaminaPerSec); // 扑咬更费
  assert.ok(V.restStaminaPerSec > 0 && V.restHpRegenRatio > 0);
  assert.ok(V.hitStaminaCost > 0);
  assert.ok(V.speedMulAtZeroHp < 1 && V.damageMulAtZeroHp < 1);
});

test('canSprint：体力足够 true，不足 false', () => {
  assert.equal(canSprint(50, V.sprintStaminaPerSec, 0.76), true);
  assert.equal(canSprint(1, V.sprintStaminaPerSec, 0.76), false);
  // dt=0 时按 0.1s 保底消耗
  assert.equal(canSprint(V.sprintStaminaPerSec * 0.1 + 0.01, V.sprintStaminaPerSec, 0), true);
  assert.equal(canSprint(V.sprintStaminaPerSec * 0.1 - 0.01, V.sprintStaminaPerSec, 0), false);
});

test('hpSpeedMultiplier：阈值以上=1，零血=地板，单调递减', () => {
  assert.equal(hpSpeedMultiplier(1, V), 1);
  assert.equal(hpSpeedMultiplier(V.lowHpThreshold, V), 1);
  assert.ok(Math.abs(hpSpeedMultiplier(0, V) - V.speedMulAtZeroHp) < 1e-9);
  const seq = [1, 0.75, 0.5, 0.25, 0].map((r) => hpSpeedMultiplier(r, V));
  for (let i = 1; i < seq.length; i++) assert.ok(seq[i] <= seq[i - 1], `not monotonic: ${seq}`);
  assert.ok(hpSpeedMultiplier(0.25, V) > V.speedMulAtZeroHp);
});

test('hpDamageMultiplier：阈值以上=1，零血=damageMulAtZeroHp，单调递减', () => {
  assert.equal(hpDamageMultiplier(1, V), 1);
  assert.equal(hpDamageMultiplier(V.lowHpThreshold, V), 1);
  assert.ok(Math.abs(hpDamageMultiplier(0, V) - V.damageMulAtZeroHp) < 1e-9);
  const seq = [1, 0.75, 0.5, 0.25, 0].map((r) => hpDamageMultiplier(r, V));
  for (let i = 1; i < seq.length; i++) assert.ok(seq[i] <= seq[i - 1], `not monotonic: ${seq}`);
});

test('stepStamina：冲刺 1 秒按 drainPerSec 消耗', () => {
  const r = stepStamina({ stamina: 100, locked: 0, hp: 10 }, 1, {
    maxStamina: 100, drainPerSec: V.sprintStaminaPerSec, resting: false, hp: 10, maxHp: 10,
  });
  assert.ok(Math.abs(r.stamina - (100 - V.sprintStaminaPerSec)) < 1e-9);
  assert.equal(r.exhausted, false);
  assert.equal(r.hp, 10); // 不休息不回血
});

test('stepStamina：休息 1 秒回体力且按 maxHp 比例回血（封顶）', () => {
  const r = stepStamina({ stamina: 20, locked: 0, hp: 50 }, 1, {
    maxStamina: 100, regenPerSec: V.restStaminaPerSec, resting: true,
    hpRegenRatio: V.restHpRegenRatio, hp: 50, maxHp: 100,
  });
  assert.ok(Math.abs(r.stamina - (20 + V.restStaminaPerSec)) < 1e-9);
  assert.ok(Math.abs(r.hp - (50 + 100 * V.restHpRegenRatio)) < 1e-9);
  // 封顶：满血休息不溢出
  const capped = stepStamina({ stamina: 99, locked: 0, hp: 99 }, 1, {
    maxStamina: 100, regenPerSec: V.restStaminaPerSec, resting: true,
    hpRegenRatio: V.restHpRegenRatio, hp: 99, maxHp: 100,
  });
  assert.equal(capped.stamina, 100);
  assert.equal(capped.hp, 100);
});

test('stepStamina：体力降到 0 → exhausted=true 且 locked>0', () => {
  const r = stepStamina({ stamina: 5, locked: 0, hp: 10 }, 1, {
    maxStamina: 100, drainPerSec: V.sprintStaminaPerSec, resting: false,
    staminaLockSeconds: V.staminaLockSeconds, hp: 10, maxHp: 10,
  });
  assert.equal(r.stamina, 0);
  assert.equal(r.exhausted, true);
  assert.equal(r.locked, V.staminaLockSeconds);
});

test('stepStamina：locked 期间递减且不可冲刺', () => {
  // 锁定期间休息了半秒（回点体力），但 locked 未到 0 → 仍不允许冲刺
  const r = stepStamina({ stamina: 30, locked: V.staminaLockSeconds, hp: 10 }, 0.5, {
    maxStamina: 100, regenPerSec: V.restStaminaPerSec, resting: true,
    staminaLockSeconds: V.staminaLockSeconds, hp: 10, maxHp: 10,
  });
  assert.ok(r.locked > 0);
  const canDash = r.locked <= 0 && canSprint(r.stamina, V.sprintStaminaPerSec, 0.5);
  assert.equal(canDash, false);
});

test('stepStamina：纯函数，不修改传入对象', () => {
  const state = { stamina: 50, locked: 0, hp: 40 };
  const options = { maxStamina: 100, drainPerSec: V.sprintStaminaPerSec, resting: false, hp: 40, maxHp: 100 };
  stepStamina(state, 1, options);
  assert.deepEqual(state, { stamina: 50, locked: 0, hp: 40 });
  assert.equal(options.drainPerSec, V.sprintStaminaPerSec);
});

test('stepStamina：非冲刺/扑击状态按状态恢复体力，只有 rest 回血', () => {
  const base = { stamina: 20, locked: 0, hp: 40 };
  const rates = { rest: 14, recover: 4.5, intercept: 2.5, roam: 1.2 };
  const rest = stepStamina(base, 1, { maxStamina: 100, maxHp: 100, regenPerSec: 14, regenPerSecByState: rates, regenState: 'rest', resting: true, hpRegenRatio: 0.035 });
  const intercept = stepStamina(base, 1, { maxStamina: 100, maxHp: 100, regenPerSecByState: rates, regenState: 'intercept', resting: false, hpRegenRatio: 0.035 });
  const roam = stepStamina(base, 1, { maxStamina: 100, maxHp: 100, regenPerSecByState: rates, regenState: 'roam', resting: false, hpRegenRatio: 0.035 });
  const dash = stepStamina(base, 1, { maxStamina: 100, maxHp: 100, drainPerSec: 18, regenPerSecByState: rates, regenState: 'roam', resting: false, hpRegenRatio: 0.035 });
  assert.equal(rest.stamina, 34); assert.equal(rest.hp, 43.5);
  assert.equal(intercept.stamina, 22.5); assert.equal(intercept.hp, 40);
  assert.equal(roam.stamina, 21.2); assert.equal(roam.hp, 40);
  assert.equal(dash.stamina, 2); assert.equal(dash.hp, 40);
});

test('stepStamina：NaN/负数/超上限均被安全钳制', () => {
  const r = stepStamina({ stamina: NaN, locked: NaN, hp: NaN }, NaN, { maxStamina: 100, maxHp: 50, regenPerSecByState: { roam: NaN }, regenState: 'roam' });
  assert.deepEqual(r, { stamina: 100, locked: 0, exhausted: false, hp: 50 });
});
