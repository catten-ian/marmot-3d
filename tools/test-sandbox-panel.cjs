const assert = require('node:assert/strict');
const test = require('node:test');

const logicPromise = import('../src/systems/sandbox-panel-logic.mjs');

test('sandbox search matches Chinese labels, English properties, and nested folder paths', async () => {
  const { matchesSandboxSearch, sandboxFolderSearchState } = await logicPromise;
  assert.equal(matchesSandboxSearch('伤害', { name: '伤害倍率', property: 'damageMul', path: '狐狸 / 攻击模式 / heavy' }), true);
  assert.equal(matchesSandboxSearch('damagemul', { name: '伤害倍率', property: 'damageMul', path: '狐狸 / 攻击模式 / heavy' }), true);
  assert.equal(matchesSandboxSearch('DAMAGE', { name: '伤害倍率', property: 'damageMul', path: '狐狸 / 攻击模式 / heavy' }), true);
  assert.equal(matchesSandboxSearch('攻击模式', { name: '模式', property: 'mode', path: '狐狸 / 攻击模式 / heavy' }), true);
  assert.equal(matchesSandboxSearch('missing', { name: '伤害倍率', property: 'damageMul', path: '狐狸' }), false);
  assert.deepEqual(sandboxFolderSearchState('速度', '狐狸 / 类型属性', true), { visible: true, open: true });
  assert.deepEqual(sandboxFolderSearchState('速度', '招式 / 推击', false), { visible: false, open: false });
  assert.deepEqual(sandboxFolderSearchState('', '招式 / 推击', false), { visible: true, open: false });
});

test('preset storage trims, deduplicates, protects factory defaults, and fails soft', async () => {
  const { BUILTIN_PRESET_NAME, FOLDER_STORAGE_KEY, PRESET_STORAGE_KEY, saveSandboxPreset, readSandboxPresets, deleteSandboxPreset } = await logicPromise;
  const map = new Map();
  const storage = { getItem: (key) => map.get(key) ?? null, setItem: (key, value) => map.set(key, String(value)) };
  assert.equal(FOLDER_STORAGE_KEY, 'm3d_beta_sandbox_folders_v1');
  assert.equal(PRESET_STORAGE_KEY, 'm3d_beta_sandbox_presets_v1');
  assert.equal(saveSandboxPreset(storage, '  快速测试  ', { PLAYER: { speed: 5 } }), true);
  assert.equal(saveSandboxPreset(storage, '快速测试', { PLAYER: { speed: 6 } }), true);
  assert.equal(saveSandboxPreset(storage, 'Quick', { PLAYER: { speed: 4 } }), true);
  assert.equal(saveSandboxPreset(storage, 'quick', { PLAYER: { speed: 7 } }), true);
  assert.equal(saveSandboxPreset(storage, '   ', {}), false);
  assert.equal(saveSandboxPreset(storage, BUILTIN_PRESET_NAME, {}), false);
  assert.deepEqual(readSandboxPresets(storage).map((item) => item.name), ['快速测试', 'quick']);
  assert.equal(readSandboxPresets(storage)[0].snapshot.PLAYER.speed, 6);
  assert.equal(readSandboxPresets(storage)[1].snapshot.PLAYER.speed, 7);
  assert.equal(deleteSandboxPreset(storage, BUILTIN_PRESET_NAME), false);
  assert.equal(deleteSandboxPreset(storage, ' 快速测试 '), true);
  map.set(PRESET_STORAGE_KEY, '{broken');
  const originalWarn = console.warn; console.warn = () => {};
  try { assert.deepEqual(readSandboxPresets(storage), []); } finally { console.warn = originalWarn; }
  const brokenWrite = { getItem: () => null, setItem() { throw new Error('quota'); } };
  const warn = console.warn; console.warn = () => {};
  try { assert.equal(saveSandboxPreset(brokenWrite, 'ok', { PLAYER: {} }), false); } finally { console.warn = warn; }
  map.delete(PRESET_STORAGE_KEY);
  assert.equal(saveSandboxPreset(storage, 'x'.repeat(100), { PLAYER: {} }), true);
  assert.equal(readSandboxPresets(storage)[0].name.length, 80);
});

test('level replay maps count/types and environment fields and rejects unsafe indexes', async () => {
  const { mapSandboxLevelReplay } = await logicPromise;
  const levels = [
    { name: 'mix', count: 5, types: ['pup', '', null, 'fast', 'heavy'], wind: 0.7, windGust: 6, reinforce: 6, time: 120, goal: 4, fogNear: 12 },
    { name: 'empty', count: 0, types: ['boss'] },
    { name: 'fallback', count: 2, types: [] },
    { name: 'invalid', count: -1, types: ['normal'] },
    null,
  ];
  const mapped = mapSandboxLevelReplay(levels, 0);
  assert.deepEqual(mapped.types, ['pup', 'fast', 'heavy']);
  assert.deepEqual(mapped.roster, ['pup', 'fast', 'heavy', 'pup', 'fast']);
  assert.equal(mapped.count, 5);
  assert.equal(mapped.wind, 0.7);
  assert.equal(mapped.windGust, 6);
  assert.equal(mapped.fogNear, 12);
  assert.deepEqual(mapSandboxLevelReplay(levels, 1).roster, []);
  assert.deepEqual(mapSandboxLevelReplay(levels, 2).roster, ['normal', 'normal']);
  assert.equal(mapSandboxLevelReplay(levels, -1), null);
  assert.equal(mapSandboxLevelReplay(levels, 5), null);
  assert.equal(mapSandboxLevelReplay(levels, 0.5), null);
  assert.equal(mapSandboxLevelReplay(levels, 3), null);
  assert.equal(mapSandboxLevelReplay(levels, 4), null);
  assert.equal(mapSandboxLevelReplay(levels, Symbol('invalid')), null);
});

test('beta game level table exposes all twelve replay choices with matching rosters', async () => {
  const { LEVELS } = await import('../src/core/config.js');
  const { mapSandboxLevelReplay } = await logicPromise;
  assert.equal(LEVELS.length, 12);
  for (const [index, level] of LEVELS.entries()) {
    const replay = mapSandboxLevelReplay(LEVELS, index);
    assert.ok(replay, `level ${index + 1} maps`);
    assert.equal(replay.index, index);
    assert.equal(replay.count, level.count);
    assert.equal(replay.roster.length, level.count);
    assert.deepEqual(replay.types, level.types);
  }
});
