import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { BETA_TUNE, resolveMovementCostPerSecond } from '../src/core/beta-tuning.js';
import { encodeRuntimePayload, applyRuntimeConfigWithPrecedence } from '../src/core/runtime-config.mjs';

test('explicit betaConfig query wins over a simultaneously available active config', async () => {
  const target = { ...BETA_TUNE };
  const explicit = { schemaVersion: 1, values: { sprintMoveCost: 0, runMoveCost: 0.25 } };
  const active = { schemaVersion: 1, values: { sprintMoveCost: 3, runMoveCost: 1.1 } };
  let requests = 0;
  const result = await applyRuntimeConfigWithPrecedence({
    locationLike: { pathname: '/marmot3d-beta/index.html', search: `?betaConfig=${encodeRuntimePayload(explicit)}` },
    storageLike: null,
    target,
    fetchActive: async () => { requests++; return { ok: true, payload: active }; },
  });
  assert.equal(requests, 1, 'the active config supplies unaffected values underneath the explicit per-page override');
  assert.equal(result.source, 'explicit');
  assert.equal(target.sprintMoveCost, 0);
  assert.equal(target.runMoveCost, 0.25);
  assert.equal(target.moveSpeedMul, BETA_TUNE.moveSpeedMul, 'missing active values continue to use Beta defaults');
});

test('active beta config applies when no explicit URL or storage payload exists', async () => {
  const target = { ...BETA_TUNE };
  const activePayload = { schemaVersion: 1, values: { sprintMoveCost: 0, runMoveCost: 0 } };
  let requests = 0;
  const result = await applyRuntimeConfigWithPrecedence({
    locationLike: { pathname: '/marmot3d-beta/index.html', search: '' },
    storageLike: { getItem: () => null },
    target,
    fetchActive: async ({ locationLike }) => {
      requests++;
      assert.equal(locationLike.pathname, '/marmot3d-beta/index.html');
      return { ok: true, payload: activePayload };
    },
  });
  assert.equal(requests, 1);
  assert.equal(result.source, 'active');
  assert.equal(target.sprintMoveCost, 0);
  assert.equal(target.runMoveCost, 0);
});

test('invalid explicit query and absent active config leave shipped Beta defaults intact', async () => {
  const invalidTarget = { ...BETA_TUNE };
  let requests = 0;
  const invalid = await applyRuntimeConfigWithPrecedence({
    locationLike: { pathname: '/marmot3d-beta/index.html', search: '?betaConfig=%7Bnot-json' },
    storageLike: null,
    target: invalidTarget,
    fetchActive: async () => { requests++; return { ok: false, absent: true, error: '404' }; },
  });
  assert.equal(invalid.source, 'default');
  assert.equal(requests, 1);
  assert.equal(invalidTarget.sprintMoveCost, BETA_TUNE.sprintMoveCost);

  const absentTarget = { ...BETA_TUNE };
  const absent = await applyRuntimeConfigWithPrecedence({
    locationLike: { pathname: '/marmot3d-beta/index.html', search: '' },
    storageLike: { getItem: () => null },
    target: absentTarget,
    fetchActive: async () => ({ ok: false, absent: true, error: '404' }),
  });
  assert.equal(absent.source, 'default');
  assert.equal(absentTarget.sprintMoveCost, BETA_TUNE.sprintMoveCost);

  const storageFailTarget = { ...BETA_TUNE };
  const storageFail = await applyRuntimeConfigWithPrecedence({
    locationLike: { pathname: '/marmot3d-beta/index.html', search: '' },
    storageLike: { getItem() { throw new Error('blocked'); } },
    target: storageFailTarget,
    fetchActive: async () => ({ ok: true, payload: { schemaVersion: 1, values: { sprintMoveCost: 0 } } }),
  });
  assert.equal(storageFail.source, 'active');
  assert.equal(storageFailTarget.sprintMoveCost, 0, 'storage errors do not block an available active config');
});

test('zero sprint cost produces zero per-frame movement drain, including boost and overdrive', () => {
  const tune = { ...BETA_TUNE, sprintMoveCost: 0 };
  const dt = 1 / 60;
  for (const state of [{}, { boost: 1 }, { overdrive: 1 }, { boost: 1, overdrive: 1 }]) {
    const frameDrain = dt * resolveMovementCostPerSecond({ betaOn: true, sprinting: true, tune, ...state });
    assert.equal(frameDrain, 0, JSON.stringify(state));
  }
});

test('non-Beta movement-cost defaults and boost/overdrive priority are unchanged', () => {
  const tune = { ...BETA_TUNE, sprintMoveCost: 0, runMoveCost: 0 };
  assert.equal(resolveMovementCostPerSecond({ betaOn: false, sprinting: true, tune }), 3.4);
  assert.equal(resolveMovementCostPerSecond({ betaOn: false, sprinting: false, tune }), 1.6);
  assert.equal(resolveMovementCostPerSecond({ betaOn: false, sprinting: true, boost: 1, tune }), 4.8);
  assert.equal(resolveMovementCostPerSecond({ betaOn: false, sprinting: true, overdrive: 1, tune }), 4);
  assert.equal(resolveMovementCostPerSecond({ betaOn: true, sprinting: false, boost: 1, tune }), 4.8);
  assert.equal(resolveMovementCostPerSecond({ betaOn: true, sprinting: false, overdrive: 1, tune }), 4);
});

test('admin exposes separate controls for current unsaved editor values and saved configs', () => {
  const panel = fs.readFileSync(fileURLToPath(new URL('../src/admin/panel.mjs', import.meta.url)), 'utf8');
  assert.match(panel, /class="cloud-apply-current"/);
  assert.match(panel, /async _applyCurrentConfig\(btn\)/);
  assert.match(panel, /runtimePayloadFromAdminConfig\(serializeSavedConfig\(this\.entries, this\.state\)\)/);
  assert.match(panel, /async _applyConfig\(name, btn\)/);
  assert.match(panel, /configItemUrl\(this\.apiBase, name\)/);
  assert.match(panel, /已将当前编辑的 Beta 参数应用到全部 Beta 网站/);
});
