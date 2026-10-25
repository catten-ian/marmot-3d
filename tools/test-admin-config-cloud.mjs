/**
 * Beta 后台「保存到服务器」纯逻辑测试（node:test，无 DOM / 网络）：
 *  - 配置名校验（与服务端规则一致）
 *  - API 基址推导 / URL 拼装（含中文编码）
 *  - 同名覆盖确认判断
 *  - 服务器配置精简结构的序列化/反序列化 + applyImport 往返
 *  - 精简结构必须小于服务端 100KB 单配置上限
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ADMIN_SCHEMA_VERSION,
  buildTuningEntries,
  indexEntries,
  createTuningState,
  setViewValue,
  applyImport,
  validateConfigName,
  deriveApiBase,
  configsIndexUrl,
  configItemUrl,
  needsOverwriteConfirm,
  serializeSavedConfig,
  parseSavedConfig,
  formatConfigSize,
  formatConfigTime,
  CONFIG_NAME_RE,
} from '../src/admin/tuning-schema.mjs';

const entries = buildTuningEntries();
const byId = indexEntries(entries);

test('配置名：中英文/数字/连字符/下划线，trim 后 1-50 位', () => {
  assert.deepEqual(validateConfigName('  啃草方案_v1-2026 '), { ok: true, name: '啃草方案_v1-2026' });
  assert.equal(validateConfigName('a'.repeat(50)).ok, true);
  for (const bad of ['', '   ', 'a'.repeat(51), 'bad name', 'a/b', '点名:号', '配置.json', 123, null]) {
    assert.equal(validateConfigName(bad).ok, false, `应拒绝：${String(bad)}`);
  }
  // 与服务端规则字面一致
  assert.ok(CONFIG_NAME_RE.test('平衡-方案_1'));
  assert.equal(CONFIG_NAME_RE.test('has space'), false);
});

test('API 基址推导：beta 部署 / 本地根路径 / 任意二级前缀', () => {
  assert.equal(deriveApiBase('/marmot3d-beta/admin.html'), '/marmot3d-beta/api');
  assert.equal(deriveApiBase('/marmot3d-beta/'), '/marmot3d-beta/api');
  assert.equal(deriveApiBase('/admin.html'), '/api');
  assert.equal(deriveApiBase('/preview/x/admin.html'), '/preview/x/api');
  assert.equal(deriveApiBase('/'), '/api');
});

test('configs URL 拼装；名字走 encodeURIComponent（中文安全）', () => {
  const base = deriveApiBase('/marmot3d-beta/admin.html');
  assert.equal(configsIndexUrl(base), '/marmot3d-beta/api/configs');
  assert.equal(configItemUrl(base, '啃草方案 v1'), '/marmot3d-beta/api/configs/%E5%95%83%E8%8D%89%E6%96%B9%E6%A1%88%20v1');
  // 注：空格不会通过名字校验，这里只验证编码函数本身；常规名字无空格。
  assert.equal(configItemUrl(base, 'a-b_c1'), '/marmot3d-beta/api/configs/a-b_c1');
});

test('同名覆盖确认：仅当列表已有该名字（trim 后比较）', () => {
  const names = ['方案A', '平衡-v2'];
  assert.equal(needsOverwriteConfirm(names, '方案A'), true);
  assert.equal(needsOverwriteConfirm(names, '  方案A '), true);
  assert.equal(needsOverwriteConfirm(names, '方案B'), false);
  assert.equal(needsOverwriteConfirm(names, ''), false);
  assert.equal(needsOverwriteConfirm([], '方案A'), false);
});

test('服务器配置序列化/反序列化往返：改动能在新 state 上完整还原', () => {
  const state = createTuningState(entries);
  setViewValue(byId, state, 'player.speed', 9.75);
  setViewValue(byId, state, 'smart.pounce.maxAngle', 42);
  setViewValue(byId, state, 'beta.flowerInstant', false);

  const saved = serializeSavedConfig(entries, state, '2026-10-25T00:00:00.000Z');
  assert.equal(saved.schemaVersion, ADMIN_SCHEMA_VERSION);
  assert.equal(saved.app, 'marmot3d-beta-admin');
  assert.equal(saved.savedAt, '2026-10-25T00:00:00.000Z');
  assert.equal(saved.values['player.speed'], 9.75);
  assert.equal(saved.values['beta.flowerInstant'], false);
  assert.equal(saved.detail, undefined); // 服务器通道不带 detail，控制体积

  // 模拟 POST -> GET /configs/:name 回来的 {name, config} 信封
  const envelope = JSON.parse(JSON.stringify({ name: '往返方案', config: saved }));
  const parsed = parseSavedConfig(envelope.config);
  assert.equal(parsed.ok, true, parsed.error);
  const restored = createTuningState(entries);
  const res = applyImport(entries, byId, restored, parsed.data);
  assert.ok(res.applied.includes('player.speed'));
  assert.equal(restored.values['player.speed'], 9.75);
  assert.ok(Math.abs(restored.values['smart.pounce.maxAngle'] - 42 * Math.PI / 180) < 1e-10);
  assert.equal(restored.values['beta.flowerInstant'], false);
  // 未改动项保持默认
  assert.equal(restored.values['fox.windRange'], byId.get('fox.windRange').def);
});

test('服务器精简配置在完整默认值集合下仍远低于 100KB 上限', () => {
  const state = createTuningState(entries);
  const saved = serializeSavedConfig(entries, state);
  const bytes = Buffer.byteLength(JSON.stringify({ name: '体积检查', config: saved }));
  assert.ok(bytes < 100 * 1024, `服务器配置体积 ${bytes} 超过 100KB`);
});

test('反序列化拒绝错误 schemaVersion / 缺 values / 非对象', () => {
  assert.equal(parseSavedConfig(null).ok, false);
  assert.equal(parseSavedConfig({ schemaVersion: 999, values: {} }).ok, false);
  assert.equal(parseSavedConfig({ schemaVersion: ADMIN_SCHEMA_VERSION }).ok, false);
  assert.equal(parseSavedConfig({ schemaVersion: ADMIN_SCHEMA_VERSION, values: [] }).ok, false);
  const cyclic = {}; cyclic.self = cyclic;
  assert.equal(parseSavedConfig(cyclic).ok, false);
});

test('体积与时间展示 fail-soft', () => {
  assert.equal(formatConfigSize(0), '0 B');
  assert.equal(formatConfigSize(512), '512 B');
  assert.equal(formatConfigSize(2048), '2.0 KB');
  assert.equal(formatConfigSize(undefined), '');
  assert.match(formatConfigTime('2026-10-25T08:30:00.000Z'), /2026/);
  assert.equal(formatConfigTime('not-a-date'), 'not-a-date');
});
