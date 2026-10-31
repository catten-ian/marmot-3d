import test from 'node:test';
import assert from 'node:assert/strict';
import { BETA_TUNE, createSmartFoxRetreat, createSmartFoxSpawnState, createSmartFoxVitals } from '../src/core/beta-tuning.js';
import { FOX } from '../src/core/config.js';
import { applyRuntimeConfigSources, applyRuntimeValues, encodeRuntimePayload, sanitizeRuntimeValues, validateRuntimePayload } from '../src/core/runtime-config.mjs';
import { buildTuningEntries, createTuningState, indexEntries, resetGroup, roundTrip, setViewValue } from '../src/admin/tuning-schema.mjs';
import { chooseRestPoint, enterRestSafe, hpDamageMultiplier, hpSpeedMultiplier, shouldRetreat, stepRestSafe, stepStamina } from '../src/core/fox-motion.js';
import { smartPounceStaminaReserve, stepSmartMotion } from '../src/entities/smart-fox-core.mjs';

const GROUP = '智能狐 · 生命/体力/恢复/撤退';
const REQUIRED = [
  'smartMaxHp', 'smartMaxStamina', 'smartStalkStaminaPerSec', 'smartSprintStaminaPerSec',
  'smartPounceStaminaPerSec', 'smartPounceStaminaCost', 'smartMeleeStaminaCost', 'smartHitStaminaCost',
  'smartRestStaminaRegenPerSec', 'smartRecoverStaminaRegenPerSec', 'smartInterceptStaminaRegenPerSec',
  'smartRoamStaminaRegenPerSec', 'smartRestHpRegenRatio', 'smartRestSafeHpRegenRatio', 'smartRestHealTarget',
  'smartStaminaLockSeconds', 'smartLowHpThreshold', 'smartSpeedMulAtZeroHp', 'smartDamageMulAtZeroHp',
  'smartRetreatHpRatio', 'smartRetreatStaminaRatio', 'smartRetreatHitStreak', 'smartHitStreakDecay',
  'smartRetreatSpeed', 'smartRetreatArriveRadius', 'smartRestSeconds', 'smartRestMinPlayerDistance',
  'smartPounceRecoverTime', 'smartPounceCooldown', 'smartMeleeRecoverTime', 'smartMeleeCooldown',
];

test('admin 独立智能狐组完整、可运行时投影、可搜索/复位/导入导出', () => {
  const entries = buildTuningEntries();
  const byId = indexEntries(entries);
  const group = entries.filter((e) => e.group === GROUP);
  for (const key of REQUIRED) {
    const entry = byId.get(`beta.${key}`);
    assert.ok(entry, key);
    assert.equal(entry.group, GROUP, key);
    assert.equal(entry.capability, 'runtime', key);
    assert.ok(entry.step > 0 && entry.max > entry.min && Number.isFinite(entry.def), key);
  }
  assert.equal(new Set(group.map((e) => e.id)).size, group.length);
  const state = createTuningState(entries);
  setViewValue(byId, state, 'beta.smartMaxHp', 9);
  setViewValue(byId, state, 'beta.smartMaxStamina', 180);
  setViewValue(byId, state, 'beta.smartPounceStaminaCost', 0);
  assert.equal(roundTrip(entries, byId, state).ok, true);
  assert.equal(resetGroup(state, entries, GROUP).includes('beta.smartMaxHp'), true);
  assert.equal(state.values['beta.smartMaxHp'], 4);
});

test('admin 默认值与 e9cb773 实际平衡一致', () => {
  assert.equal(BETA_TUNE.smartMaxHp, 4);
  assert.equal(BETA_TUNE.smartMaxStamina, 100);
  assert.equal(BETA_TUNE.smartStalkStaminaPerSec, 0);
  assert.equal(BETA_TUNE.smartSprintStaminaPerSec, 0);
  assert.equal(BETA_TUNE.smartPounceStaminaPerSec, 26);
  assert.equal(BETA_TUNE.smartPounceStaminaCost, 26);
  assert.equal(BETA_TUNE.smartMeleeStaminaCost, 0);
  assert.equal(BETA_TUNE.smartRestStaminaRegenPerSec, 14);
  assert.equal(BETA_TUNE.smartRecoverStaminaRegenPerSec, 4.5);
  assert.equal(BETA_TUNE.smartInterceptStaminaRegenPerSec, 2.5);
  assert.equal(BETA_TUNE.smartRoamStaminaRegenPerSec, 1.2);
  assert.equal(BETA_TUNE.smartRestMinPlayerDistance, 60);
  assert.equal(BETA_TUNE.smartRetreatSpeed, 10.5);
});

test('runtime sanitize 保留合法 0，clamp 比例/上限/阈值并拒绝非有限数', () => {
  const result = sanitizeRuntimeValues({
    smartMaxHp: -4, smartMaxStamina: 0, smartPounceStaminaCost: 0,
    smartMeleeStaminaCost: 0, smartRetreatHpRatio: 4, smartRestHealTarget: -2,
    smartLowHpThreshold: Infinity, smartHitStaminaCost: Number.NaN,
    smartRetreatHitStreak: 0, smartRestMinPlayerDistance: 999,
  });
  assert.equal(result.values.smartMaxHp, 1);
  assert.equal(result.values.smartMaxStamina, 1);
  assert.equal(result.values.smartPounceStaminaCost, 0);
  assert.equal(result.values.smartMeleeStaminaCost, 0);
  assert.equal(result.values.smartRetreatHpRatio, 1);
  assert.equal(result.values.smartRestHealTarget, 0);
  assert.equal(result.values.smartRetreatHitStreak, 1);
  assert.equal(result.values.smartRestMinPlayerDistance, 120);
  assert.equal('smartLowHpThreshold' in result.values, false);
  assert.equal('smartHitStaminaCost' in result.values, false);
  assert.equal(validateRuntimePayload({ schemaVersion: 1, values: { smartMaxHp: 'bad' } }).ok, false);
});

test('显式 URL 覆盖 active，合法 storage 仅作回退，普通 FOX 默认值不被展开改写', () => {
  const original = JSON.stringify(FOX.vitals);
  const target = { ...BETA_TUNE };
  const active = { schemaVersion: 1, values: { smartMaxHp: 7, smartMaxStamina: 140 } };
  const explicit = { schemaVersion: 1, values: { smartMaxHp: 9, smartPounceStaminaCost: 0 } };
  const search = `?betaConfig=${encodeRuntimePayload(explicit)}`;
  const result = applyRuntimeConfigSources({ locationLike: { search }, target, activePayload: active });
  assert.equal(result.source, 'explicit');
  assert.equal(target.smartMaxHp, 9);
  assert.equal(target.smartMaxStamina, 140);
  assert.equal(target.smartPounceStaminaCost, 0);
  assert.equal(JSON.stringify(FOX.vitals), original);
});

test('默认/自定义上限出生满状态，多只状态独立，测试 initialHp 仅为显式伤血语义', () => {
  const a = createSmartFoxSpawnState();
  const b = createSmartFoxSpawnState({}, createSmartFoxVitals({ ...BETA_TUNE, smartMaxHp: 9, smartMaxStamina: 180 }));
  assert.deepEqual([a.hp, a.maxHp, a.stamina, a.maxStamina], [4, 4, 100, 100]);
  assert.deepEqual([b.hp, b.maxHp, b.stamina, b.maxStamina], [9, 9, 180, 180]);
  for (const s of [a, b]) {
    assert.equal(s.staminaLocked, 0); assert.equal(s.hitStreak, 0);
    assert.equal(s.retreating, false); assert.equal(s.dead, false); assert.equal(s.state, 'roam');
    assert.equal(shouldRetreat({ hpRatio: s.hp / s.maxHp, staminaRatio: 1, hitStreak: 0, state: s.state }, createSmartFoxRetreat()), false);
  }
  a.hp = 1; a.stamina = 0;
  assert.equal(b.hp, 9); assert.equal(b.stamina, 180);
  const hurt = createSmartFoxSpawnState({ initialHp: 99 }, createSmartFoxVitals({ ...BETA_TUNE, smartMaxHp: 8 }));
  assert.equal(hurt.hp, 8); assert.equal(hurt.initialHpSource, 'explicit-test-or-replay');
  assert.equal(createSmartFoxSpawnState({ initialHp: -5 }).hp, 0);
  assert.equal(createSmartFoxSpawnState({ initialHp: Number.NaN }).hp, 4);
});

test('自定义消耗/恢复/锁定直接改变纯函数真实收支，0 消耗不是缺省', () => {
  const tune = { ...BETA_TUNE, smartMaxHp: 10, smartMaxStamina: 160, smartPounceStaminaCost: 0,
    smartPounceStaminaPerSec: 0, smartRoamStaminaRegenPerSec: 7, smartRestHpRegenRatio: .1,
    smartStaminaLockSeconds: 2.5 };
  const V = createSmartFoxVitals(tune);
  const zero = stepStamina({ stamina: 50, hp: 10, locked: 0 }, 1, {
    maxStamina: V.maxStamina, maxHp: V.maxHp, drainPerSec: V.pounceStaminaPerSec,
  });
  assert.equal(zero.stamina, 50);
  const roam = stepStamina({ stamina: 50, hp: 5, locked: 0 }, 2, {
    maxStamina: V.maxStamina, maxHp: V.maxHp, regenPerSecByState: { roam: tune.smartRoamStaminaRegenPerSec }, regenState: 'roam',
  });
  assert.equal(roam.stamina, 64); assert.equal(roam.hp, 5);
  const rest = stepStamina({ stamina: 150, hp: 5, locked: 0 }, 1, {
    maxStamina: V.maxStamina, maxHp: V.maxHp, resting: true, regenPerSec: V.restStaminaPerSec, hpRegenRatio: V.restHpRegenRatio,
  });
  assert.equal(rest.stamina, 160); assert.equal(rest.hp, 6);
  const locked = stepStamina({ stamina: 1, hp: 5, locked: 0 }, 1, {
    maxStamina: V.maxStamina, maxHp: V.maxHp, drainPerSec: 18, staminaLockSeconds: V.staminaLockSeconds,
  });
  assert.equal(locked.locked, 2.5);
  assert.equal(smartPounceStaminaReserve(V.pounceStaminaPerSec, { dashDuration: .42, staminaCost: V.pounceStaminaCost }), 0);
});

test('低血速度/伤害倍率读取智能狐快照而非共享 FOX', () => {
  const V = createSmartFoxVitals({ ...BETA_TUNE, smartLowHpThreshold: .8, smartSpeedMulAtZeroHp: .4, smartDamageMulAtZeroHp: .25 });
  assert.equal(hpSpeedMultiplier(.8, V), 1);
  assert.equal(hpSpeedMultiplier(0, V), .4);
  assert.equal(hpDamageMultiplier(0, V), .25);
  assert.equal(FOX.vitals.lowHpThreshold, .5);
});

test('撤退阈值、连击衰减配置、休息时长/回血目标与远撤距离真实生效', () => {
  const R = createSmartFoxRetreat({ ...BETA_TUNE, smartRetreatHpRatio: .7, smartRetreatStaminaRatio: .4,
    smartRetreatHitStreak: 2, smartRestSeconds: 11, smartRestSafeHpRegenRatio: .2, smartRestHealTarget: .8 });
  assert.equal(shouldRetreat({ hpRatio: .65, staminaRatio: 1, hitStreak: 0, state: 'roam' }, R), true);
  assert.equal(shouldRetreat({ hpRatio: 1, staminaRatio: .35, hitStreak: 0, state: 'roam' }, R), true);
  assert.equal(shouldRetreat({ hpRatio: 1, staminaRatio: 1, hitStreak: 2, state: 'roam' }, R), true);
  assert.equal(R.hitStreakDecay, 6);
  const entered = enterRestSafe({}, R.restSeconds.smart);
  assert.equal(entered.timer, 11);
  const healed = stepRestSafe({ timer: 11, hp: 2, maxHp: 10 }, 2, R);
  assert.equal(healed.hp, 6); // 2 + 10 * .2 * 2，目标为 8
  const point = chooseRestPoint({ foxX: 0, foxZ: 0, playerX: 0, playerZ: 0, bounds: { hw: 100, hh: 100 } }, { speed: 10.5, arriveRadius: 1.5, betaSmartMinPlayerDistance: 60 });
  assert.ok(Math.hypot(point.x, point.z) >= 60);
});

test('扑击 recover/cooldown 运行时覆盖进入真实状态机', () => {
  let s = { x: 0, z: -5, yaw: 0, vx: 0, vz: 0, pounceMinDistance: 4.2, pounceMaxDistance: 6.2,
    pounceRecoverTime: .95, pounceCooldownDuration: 2.4, windupRemaining: 0 };
  s = stepSmartMotion(s, { x: 0, z: 0 }, 1 / 60, 'pounce', { commitAllowed: true });
  for (let i = 0; i < 600 && !s.pounceJustEnded; i++) s = stepSmartMotion(s, { x: 0, z: 0 }, 1 / 60, 'pounce');
  assert.equal(s.pounceJustEnded, true);
  assert.ok(Math.abs(s.pounceStageTime - .95) < 1e-9);
  assert.equal(s.pounceCooldown, 2.4);
});

test('局部 active 应用不会改变共享默认或制造越界状态', () => {
  const target = { ...BETA_TUNE };
  applyRuntimeValues({ smartMaxHp: 12, smartMaxStamina: 220, smartRestHealTarget: 99 }, target);
  const spawn = createSmartFoxSpawnState({}, createSmartFoxVitals(target));
  assert.deepEqual([spawn.hp, spawn.maxHp, spawn.stamina, spawn.maxStamina], [12, 12, 220, 220]);
  assert.equal(createSmartFoxRetreat(target).restHealTarget, 1);
  assert.equal(BETA_TUNE.smartMaxHp, 4);
  assert.equal(BETA_TUNE.smartMaxStamina, 100);
});
