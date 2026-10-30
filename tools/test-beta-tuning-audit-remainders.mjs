import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BETA_TUNE } from '../src/core/beta-tuning.js';
import { createSmartPack, debounceIntent } from '../src/entities/smart-fox-core.mjs';
import { applyRuntimeValues, runtimePayloadFromAdminConfig, sanitizeRuntimeValues } from '../src/core/runtime-config.mjs';
import { buildTuningEntries, tuningCapability } from '../src/admin/tuning-schema.mjs';

test('createSmartPack supports injected window, spacing and slot spacing while preserving defaults', () => {
  const defaults = createSmartPack();
  assert.equal(defaults.canCommit(0, 0), true);
  defaults.recordCommit(0, 0);
  assert.equal(defaults.canCommit(0, 0.349), false);
  assert.equal(defaults.canCommit(0, 0.35), true);
  defaults.recordCommit(0, 0.35);
  assert.equal(defaults.canCommit(0, 1.0), false, 'two commits remain inside the default 1.2s window');
  assert.equal(defaults.canCommit(0, 1.551), true, 'the old window boundary remains exclusive');

  const custom = createSmartPack({ window: 2, spacing: 0.5, slotSpacing: 0.1 });
  custom.recordCommit(0, 0);
  assert.equal(custom.canCommit(1, 0.59), false);
  assert.equal(custom.canCommit(1, 0.6), true);
  custom.recordCommit(1, 0.6);
  assert.equal(custom.canCommit(0, 1.2), false, 'custom window keeps two commits');
  assert.equal(custom.canCommit(0, 2.001), true, 'custom window cleanup changes the max-count gate');
});

test('debounceIntent uses injected hold and keeps the default when omitted', () => {
  assert.deepEqual(debounceIntent('observe', 'approach', 0, 0.24), { intent: 'observe', held: 0.24 });
  assert.deepEqual(debounceIntent('observe', 'approach', 0.24, 0.01), { intent: 'approach', held: 0 });
  assert.deepEqual(debounceIntent('observe', 'approach', 0, 0.39, { hold: 0.4 }), { intent: 'observe', held: 0.39 });
  assert.deepEqual(debounceIntent('observe', 'approach', 0.39, 0.01, { hold: 0.4 }), { intent: 'approach', held: 0 });
});

test('admin beta projection sanitizes and applies only BETA_TUNE keys with isolated defaults', () => {
  const payload = runtimePayloadFromAdminConfig({ values: {
    'beta.smartPackWindow': 2,
    'beta.smartPackSpacing': 0.5,
    'beta.smartPackSlotSpacing': 0.1,
    'beta.smartDebounceHold': 0.4,
    'player.speed': 99,
    'beta.noSuchKey': 3,
  }});
  assert.deepEqual(payload.values, { smartPackWindow: 2, smartPackSpacing: 0.5, smartPackSlotSpacing: 0.1, smartDebounceHold: 0.4, noSuchKey: 3 });
  const clean = sanitizeRuntimeValues(payload.values);
  assert.deepEqual(clean.values, { smartPackWindow: 2, smartPackSpacing: 0.5, smartPackSlotSpacing: 0.1, smartDebounceHold: 0.4 });
  assert.deepEqual(clean.ignored, ['noSuchKey']);
  const target = { ...BETA_TUNE };
  const result = applyRuntimeValues(clean.values, target);
  assert.deepEqual(result.applied, ['smartPackWindow', 'smartPackSpacing', 'smartPackSlotSpacing', 'smartDebounceHold']);
  assert.equal(target.smartPackWindow, 2);
  assert.equal(BETA_TUNE.smartPackWindow, 1.2, 'runtime target is isolated from defaults');
});

test('tuning capability is exactly beta id intersected with BETA_TUNE keys', () => {
  const entries = buildTuningEntries();
  const runtimeIds = entries.filter((entry) => tuningCapability(entry) === 'runtime').map((entry) => entry.id);
  const expected = entries.filter((entry) => entry.id.startsWith('beta.') && Object.hasOwn(BETA_TUNE, entry.id.slice(5))).map((entry) => entry.id);
  assert.deepEqual(runtimeIds, expected);
  assert.equal(tuningCapability({ id: 'smart.packWindow' }), 'preview');
  assert.equal(tuningCapability({ id: 'beta.noSuchKey' }), 'preview');
  for (const id of ['beta.smartPackWindow', 'beta.smartPackSpacing', 'beta.smartPackSlotSpacing', 'beta.smartDebounceHold']) assert.equal(tuningCapability({ id }), 'runtime');
});
