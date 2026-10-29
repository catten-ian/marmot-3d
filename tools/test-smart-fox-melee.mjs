import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createSmartMeleeState, advanceSmartMelee, consumeSmartMeleeHit,
  smartMeleeContactHit, stepSmartMotion,
} from '../src/entities/smart-fox-core.mjs';
import { BETA_TUNE } from '../src/core/beta-tuning.js';
import { buildTuningEntries, indexEntries, createTuningState, setViewValue, clampStored } from '../src/admin/tuning-schema.mjs';
import { applyRuntimeValues } from '../src/core/runtime-config.mjs';

const DT = 1 / 60;
const closeInput = (extra = {}) => ({
  distance: 1.2, reachable: true, safe: false, alive: true,
  stunned: false, retreating: false, fleeing: false,
  pounceCommitted: false, pouncePending: false, targetYaw: .4,
  ...extra,
});
const strikeInput = (extra = {}) => ({
  phase: 'strike', striking: true, hitConsumed: false,
  distance: 1.2, verticalOverlap: true, safe: false, invulnerable: false, contactCd: 0,
  ...extra,
});

test('近身且可达时启动独立 windup，超范围或不可达不启动', () => {
  const started = advanceSmartMelee(createSmartMeleeState(), closeInput(), DT, BETA_TUNE);
  assert.equal(started.phase, 'windup');
  assert.equal(started.justStarted, true);
  assert.equal(started.phaseTime, BETA_TUNE.smartMeleeWindupTime);
  assert.equal(advanceSmartMelee(createSmartMeleeState(), closeInput({ distance: BETA_TUNE.smartMeleeTriggerRange + .01 }), DT, BETA_TUNE).phase, null);
  assert.equal(advanceSmartMelee(createSmartMeleeState(), closeInput({ reachable: false }), DT, BETA_TUNE).phase, null);
});

test('完整动作严格经过 windup → strike → recover → null，并进入冷却', () => {
  let state = createSmartMeleeState();
  const phases = [];
  for (let frame = 0; frame < 180; frame++) {
    state = advanceSmartMelee(state, closeInput(), DT, BETA_TUNE);
    if (phases.at(-1) !== state.phase) phases.push(state.phase);
    if (state.justEnded) break;
  }
  assert.deepEqual(phases, ['windup', 'strike', 'recover', null]);
  assert.ok(state.cooldown > 0);
  const blocked = advanceSmartMelee(state, closeInput(), DT, BETA_TUNE);
  assert.equal(blocked.phase, null);
});

test('strike 首次命中被消费，后续攻击帧和收招均不能重复命中', () => {
  let state = createSmartMeleeState();
  for (let i = 0; i < 20 && state.phase !== 'strike'; i++) state = advanceSmartMelee(state, closeInput(), DT, BETA_TUNE);
  assert.equal(state.phase, 'strike');
  const contact = () => smartMeleeContactHit(strikeInput({ hitConsumed: state.hitConsumed }), BETA_TUNE);
  assert.equal(contact(), true);
  state = consumeSmartMeleeHit(state);
  assert.equal(state.hitConsumed, true);
  assert.equal(contact(), false);
  assert.equal(consumeSmartMeleeHit(state).hitConsumed, true);
});

test('当前接触命中拒绝超范围、垂直不重叠、洞内、无敌和接触冷却', () => {
  assert.equal(smartMeleeContactHit(strikeInput(), BETA_TUNE), true);
  for (const input of [
    { distance: BETA_TUNE.smartMeleeHitRange }, { verticalOverlap: false },
    { safe: true }, { invulnerable: true }, { contactCd: .1 },
    { phase: 'windup' }, { phase: 'recover' }, { hitConsumed: true },
  ]) assert.equal(smartMeleeContactHit(strikeInput(input), BETA_TUNE), false, JSON.stringify(input));
});

test('安全、死亡、眩晕、撤退和逃跑状态不触发近战', () => {
  for (const input of [
    { safe: true }, { alive: false }, { stunned: true }, { retreating: true }, { fleeing: true },
  ]) assert.equal(advanceSmartMelee(createSmartMeleeState(), closeInput(input), DT, BETA_TUNE).phase, null, JSON.stringify(input));
});

test('近战与 committed/pending pounce 互斥，且不修改既有扑击状态', () => {
  for (const input of [{ pounceCommitted: true }, { pouncePending: true }]) {
    assert.equal(advanceSmartMelee(createSmartMeleeState(), closeInput(input), DT, BETA_TUNE).phase, null);
  }
  let pounce = { x: 0, z: -5, vx: 0, vz: 0, yaw: 0, pounceCooldown: 0, pounceMinDistance: 4.2, pounceMaxDistance: 6.2 };
  pounce = stepSmartMotion(pounce, { x: 0, z: 0 }, DT, 'pounce');
  assert.equal(pounce.pounceCommitted, true);
  const lockedYaw = pounce.pounceYaw;
  pounce = stepSmartMotion(pounce, { x: 20, z: 20 }, DT, 'abandon');
  assert.equal(pounce.pounceCommitted, true);
  assert.equal(pounce.pounceYaw, lockedYaw);
});

test('近战后台项默认值、有限边界和非法值回退', () => {
  const entries = buildTuningEntries();
  const byId = indexEntries(entries);
  const keys = ['TriggerRange', 'HitRange', 'WindupTime', 'StrikeTime', 'RecoverTime', 'Cooldown', 'StrikeSpeed'];
  for (const key of keys) {
    const id = `beta.smartMelee${key}`;
    const entry = byId.get(id);
    assert.ok(entry, id);
    assert.equal(entry.def, BETA_TUNE[`smartMelee${key}`]);
    assert.equal(clampStored(entry, -999), entry.min);
    assert.equal(clampStored(entry, 999), entry.max);
    assert.equal(clampStored(entry, 'invalid'), entry.def);
  }
  const state = createTuningState(entries);
  assert.equal(setViewValue(byId, state, 'beta.smartMeleeWindupTime', 0), .2);
  assert.equal(setViewValue(byId, state, 'beta.smartMeleeCooldown', 99), 4);
});

test('七个近战键通过现有运行时配置白名单应用', () => {
  const target = { ...BETA_TUNE };
  const values = {
    smartMeleeTriggerRange: 2.2, smartMeleeHitRange: 1.4,
    smartMeleeWindupTime: .3, smartMeleeStrikeTime: .2,
    smartMeleeRecoverTime: .5, smartMeleeCooldown: 1.4,
    smartMeleeStrikeSpeed: 2,
  };
  const result = applyRuntimeValues(values, target);
  assert.deepEqual(result.applied.sort(), Object.keys(values).sort());
  for (const [key, value] of Object.entries(values)) assert.equal(target[key], value);
});
