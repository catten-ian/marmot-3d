const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
function load(code) {
  return execFileSync(process.execPath, ['--input-type=module', '-e', code], { cwd: root, encoding: 'utf8' });
}
test('paf admin sync contracts', () => {
  const out = load(`import { splitPath, getPath, setPath, applySchemaValues, collectSchemaValues, buildPushPayload, applyServerConfig } from './src/play/paf-admin-sync.mjs';
    const roots = { BETA_TUNE: { speed: 1 }, PLAYER: { jump: { velocity: 4 } } };
    const entries = [
      { id: 'beta.speed', source: 'BETA_TUNE.speed', kind: 'number', def: 1, min: 0, max: 3, step: .1 },
      { id: 'player.jump.velocity', source: 'PLAYER.jump.velocity', kind: 'number', def: 4, min: 0, max: 10, step: .1, toView: (v) => v * 10, toStore: (v) => v / 10 },
      { id: 'missing', source: 'NOPE.value', kind: 'number', def: 2, min: 0, max: 4, step: 1 },
      { id: 'flag', source: 'NOPE.flag', kind: 'boolean', def: false, viewDef: false },
    ];
    const converted = entries[1]; if (converted.toView(0.9) !== 9 || converted.toStore(9) !== 0.9) throw Error('conversion');
    if (splitPath('a.b').join('/') !== 'a/b' || getPath(roots, 'PLAYER.jump.velocity') !== 4) throw Error('path read');
    if (!setPath(roots, 'PLAYER.jump.velocity', 5) || roots.PLAYER.jump.velocity !== 5) throw Error('path write');
    const r = applySchemaValues(entries, { 'beta.speed': 9, 'player.jump.velocity': 0.9, unknown: 1 }, roots);
    if (r.ignored.length !== 1 || r.clamped.length !== 1 || roots.BETA_TUNE.speed !== 3 || roots.PLAYER.jump.velocity !== 0.9) throw Error('apply');
    const values = collectSchemaValues(entries, roots); if (values['player.jump.velocity'] !== 0.9 || values.missing !== 2) throw Error('collect');
    const payload = buildPushPayload(entries, roots, null, '2026-10-27T00:00:00.000Z'); if (payload.values['beta.speed'] !== 3 || payload.schemaVersion !== 1) throw Error('payload');
    const ar = applyServerConfig(entries, { config: { values: { 'beta.speed': 2, nope: 1 } } }, roots); if (!ar.ok || ar.applied.length !== 1 || roots.BETA_TUNE.speed !== 2) throw Error('server apply');
    console.log('ok');`);
  assert.match(out, /ok/);
});
