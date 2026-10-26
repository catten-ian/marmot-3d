import test from 'node:test';
import assert from 'node:assert/strict';
import { BETA_TUNE } from '../src/core/beta-tuning.js';
import { validateRuntimePayload, applyRuntimeValues, encodeRuntimePayload, decodeRuntimePayload, buildGameUrl, runtimePayloadFromAdminConfig, fetchActiveBetaConfig } from '../src/core/runtime-config.mjs';

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


test('schema-added beta values traverse admin projection, active endpoint fetch, validation and runtime application', async () => {
  const override = {
    'beta.runMoveCost': 0.55,
    'beta.sprintMoveCost': 7.25,
    'beta.mouthCapacity': 240,
    'beta.grazeImmediateShare': 0.35,
    'beta.grazeMoveSpeedMul': 0.22,
    'beta.chewPerSec': 6,
    'beta.mainBurrowChewPerSec': 14,
    'beta.temporaryBurrowChewPerSec': 8,
    'beta.staminaFatThreshold': 0.62,
    'beta.flowerHpTotal': 20,
    'beta.flowerStaminaTotal': 32,
    'beta.flowerRecoverySeconds': 9,
    'beta.grazeConeHalfAngle': Math.PI / 4,
    'beta.stunDiminishWindow': 2.7,
    'beta.stunDiminishFactor': 0.6,
    'beta.stunDiminishFloor': 0.12,
    'beta.stunDiminishResetSeconds': 4.5,
  };
  const payload = runtimePayloadFromAdminConfig({ values: override });
  const active = await fetchActiveBetaConfig({
    locationLike: { pathname: '/marmot3d-beta/index.html' },
    fetchFn: async (url) => {
      assert.equal(url, '/marmot3d-beta/api/configs/active');
      return { ok: true, status: 200, json: async () => ({ config: payload }) };
    },
  });
  assert.equal(active.ok, true);
  const target = { ...BETA_TUNE };
  const result = applyRuntimeValues(active.payload.values, target);
  assert.deepEqual(result.applied, Object.keys(override).map((id) => id.slice(5)));
  for (const [id, value] of Object.entries(override)) assert.equal(target[id.slice(5)], value, id);
  assert.equal(target.mouthCapacity, 240);
  assert.equal(BETA_TUNE.mouthCapacity, 120);
});
