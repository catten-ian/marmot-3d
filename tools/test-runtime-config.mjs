import test from 'node:test';
import assert from 'node:assert/strict';
import { BETA_TUNE } from '../src/core/beta-tuning.js';
import { validateRuntimePayload, applyRuntimeValues, encodeRuntimePayload, decodeRuntimePayload, buildGameUrl, runtimePayloadFromAdminConfig } from '../src/core/runtime-config.mjs';

test('runtime payload schema validates whitelist and rejects empty/invalid payloads', () => {
  assert.equal(validateRuntimePayload(null).ok, false);
  const r = validateRuntimePayload({ schemaVersion: 1, values: { moveSpeedMul: 1.4, grazeRate: 0.8, nope: 3, grassRegrowPerSec: -2 } });
  assert.equal(r.ok, true); assert.deepEqual(r.values, { moveSpeedMul: 1.4, grazeRate: 0.8, grassRegrowPerSec: 0 });
  assert.deepEqual(r.ignored, ['nope']);
  assert.equal(validateRuntimePayload({ schemaVersion: 1, values: { moveSpeedMul: 'x' }}).ok, false);
});

test('validated runtime override changes actual tuning object, defaults stay intact when absent', () => {
  const target = { ...BETA_TUNE };
  const original = target.moveSpeedMul;
  const r = applyRuntimeValues({ moveSpeedMul: 1.7, sprintMoveCost: 7, grazeRate: 0.9, grassRegrowPerSec: 0.02, grazeRegenPerSec: 12, grassSeconds: 0.4 }, target);
  assert.deepEqual(r.applied, ['moveSpeedMul', 'sprintMoveCost', 'grazeRate', 'grassRegrowPerSec', 'grazeRegenPerSec', 'grassSeconds']);
  assert.equal(target.moveSpeedMul, 1.7); assert.equal(target.grazeRate, 0.9); assert.equal(target.grassSeconds, 0.4);
  assert.notEqual(original, target.moveSpeedMul);
  assert.equal(BETA_TUNE.moveSpeedMul, 1.07);
});

test('URL payload roundtrip and admin beta-only projection', () => {
  const p = { schemaVersion: 1, values: { moveSpeedMul: 1.3, grazeRate: 0.7 } };
  assert.deepEqual(decodeRuntimePayload(encodeRuntimePayload(p)).values, p.values);
  assert.deepEqual(runtimePayloadFromAdminConfig({ values: { 'beta.moveSpeedMul': 1.3, 'beta.grazeRate': 0.7, 'player.speed': 9 } }), p);
  assert.match(buildGameUrl('/marmot3d-beta/admin.html', p), /^\/marmot3d-beta\/index\.html\?betaConfig=/);
});
