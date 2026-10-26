import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ADMIN_SCHEMA_VERSION,
  buildTuningEntries,
  indexEntries,
  createTuningState,
  setViewValue,
  clampStored,
  serializeConfig,
  parseConfigText,
  applyImport,
  roundTrip,
  resetGroup,
} from '../src/admin/tuning-schema.mjs';

const entries = buildTuningEntries();
const byId = indexEntries(entries);

test('后台 schema 包含唯一 id、合法范围与要求覆盖的关键常量', () => {
  assert.ok(entries.length >= 200);
  assert.equal(byId.size, entries.length);
  for (const e of entries) {
    assert.ok(e.id && e.label && e.source && e.file, `条目元数据缺失：${e.id}`);
    if (e.kind === 'number') {
      assert.ok(Number.isFinite(e.def), `默认值不是有限数：${e.id}`);
      assert.ok(Number.isFinite(e.min) && Number.isFinite(e.max) && e.max > e.min, `范围不合法：${e.id}`);
      assert.ok(e.step > 0, `步长不合法：${e.id}`);
    }
  }
  for (const id of [
    'player.speed', 'wheel.lunge.distance', 'fox.windRange', 'fox.dashSpeed',
    'foxAtk.normal.dashTime', 'smart.pounce.maxDistance', 'smart.pounce.maxAngle',
    'strike.halfAngle', 'strike.lunge.lower', 'strike.lunge.upper',
    'beta.lungeLockRange', 'beta.stunDiminishWindow', 'beta.stunDiminishFactor',
    'beta.stunDiminishFloor', 'beta.stunDiminishResetSeconds', 'beta.sprintMoveCost', 'beta.runMoveCost',
    'beta.mouthCapacity', 'beta.grazeImmediateShare', 'beta.grazeMoveSpeedMul',
    'beta.chewPerSec', 'beta.mainBurrowChewPerSec', 'beta.temporaryBurrowChewPerSec',
    'beta.staminaFatThreshold', 'beta.flowerHpTotal', 'beta.flowerStaminaTotal',
    'beta.flowerRecoverySeconds', 'beta.grazeConeHalfAngle', 'smart.weight.pounceBase',
  ]) assert.ok(byId.has(id), `缺少必需调节项 ${id}`);
});

test('beta tuning 面板新条目默认值与百分比/角度单位换算正确', () => {
  assert.equal(byId.get('beta.runMoveCost').def, 0.8);
  assert.equal(byId.get('beta.mouthCapacity').def, 120);
  assert.equal(byId.get('beta.stunDiminishWindow').def, 3);
  assert.equal(byId.get('beta.stunDiminishFactor').def, 0.55);
  assert.equal(byId.get('beta.stunDiminishFloor').def, 0.15);
  assert.equal(byId.get('beta.stunDiminishResetSeconds').def, 4);
  assert.equal(byId.get('beta.grazeImmediateShare').viewDef, 35);
  assert.equal(byId.get('beta.grazeImmediateShare').unit, '%');
  assert.ok(Math.abs(byId.get('beta.grazeConeHalfAngle').viewDef - 60) < 1e-10);
  assert.equal(byId.get('beta.staminaFatThreshold').viewDef, 60);
});

test('数值钳制处理越界、非数与弧度/角度显示换算', () => {
  const speed = byId.get('player.speed');
  assert.equal(clampStored(speed, -100), speed.min);
  assert.equal(clampStored(speed, 10000), speed.max);
  assert.equal(clampStored(speed, Number.NaN), speed.def);
  assert.equal(clampStored(speed, 'not-a-number'), speed.def);

  const angle = byId.get('smart.pounce.maxAngle');
  const state = createTuningState(entries);
  assert.equal(setViewValue(byId, state, angle.id, 999), angle.def > 0 ? angle.toStore(angle.max) : angle.def);
  assert.ok(state.values[angle.id] <= Math.PI / 2 + 1e-10);
  assert.ok(Math.abs(state.values[angle.id] - Math.PI / 2) < 1e-10);
});

test('导出再导入往返等价，schemaVersion 与来源详情可读', () => {
  const state = createTuningState(entries);
  setViewValue(byId, state, 'player.speed', 8.25);
  setViewValue(byId, state, 'smart.pounce.maxAngle', 31);
  setViewValue(byId, state, 'beta.flowerInstant', false);
  const exported = serializeConfig(entries, state);
  assert.equal(exported.schemaVersion, ADMIN_SCHEMA_VERSION);
  assert.ok(exported.detail['玩家 · 基础']['player.speed'].source.includes('PLAYER.speed'));
  assert.deepEqual(roundTrip(entries, byId, state).ok, true);
  const fresh = createTuningState(entries);
  const parsed = parseConfigText(JSON.stringify(exported));
  assert.equal(parsed.ok, true);
  applyImport(entries, byId, fresh, parsed.data);
  assert.deepEqual(fresh.values, state.values);
});

test('非法 JSON/schema/值和未知字段按约定处理', () => {
  assert.equal(parseConfigText('{').ok, false);
  assert.equal(parseConfigText(JSON.stringify({ schemaVersion: 99, values: {} })).ok, false);
  assert.equal(parseConfigText(JSON.stringify({ schemaVersion: ADMIN_SCHEMA_VERSION, values: [] })).ok, false);

  const state = createTuningState(entries);
  const parsed = parseConfigText(JSON.stringify({
    schemaVersion: ADMIN_SCHEMA_VERSION,
    values: {
      'player.speed': 999,
      'smart.pounce.maxAngle': -100,
      'foxAtk.normal.mode': 'unsupported-mode',
      'beta.flowerInstant': 'nonsense',
      'no.such.field': 42,
    },
  }));
  assert.equal(parsed.ok, true);
  const result = applyImport(entries, byId, state, parsed.data);
  assert.equal(state.values['player.speed'], byId.get('player.speed').max);
  assert.equal(state.values['smart.pounce.maxAngle'], byId.get('smart.pounce.maxAngle').min * Math.PI / 180);
  assert.equal(state.values['foxAtk.normal.mode'], byId.get('foxAtk.normal.mode').def);
  assert.equal(state.values['beta.flowerInstant'], false);
  assert.deepEqual(result.ignored, ['no.such.field']);
  assert.equal(result.clamped.length, 4);
});

test('恢复分组只重置目标分组并清理 dirty 标记', () => {
  const state = createTuningState(entries);
  setViewValue(byId, state, 'player.speed', 9);
  setViewValue(byId, state, 'fox.dashSpeed', 20);
  const group = byId.get('player.speed').group;
  const reset = resetGroup(state, entries, group);
  assert.ok(reset.includes('player.speed'));
  assert.equal(state.values['player.speed'], byId.get('player.speed').def);
  assert.ok(!state.dirty.has('player.speed'));
  assert.notEqual(state.values['fox.dashSpeed'], byId.get('fox.dashSpeed').def);
  assert.ok(state.dirty.has('fox.dashSpeed'));
});
