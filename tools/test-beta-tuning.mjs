import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BETA_TUNE,
  betaFlowerCompletesImmediately,
  resolveLungeLockYaw,
} from '../src/core/beta-tuning.js';
import { FORAGE, stepForageProgress } from '../src/core/ecology.js';

const near = (actual, expected, epsilon = 1e-9) => assert.ok(
  Math.abs(actual - expected) <= epsilon,
  `expected ${actual} to be within ${epsilon} of ${expected}`,
);

test('beta tuning constants exceed or match the requested balance thresholds', () => {
  assert.ok(BETA_TUNE.moveSpeedMul > 1);
  assert.ok(BETA_TUNE.sprintMoveCost > 3.4);
  assert.equal(BETA_TUNE.runMoveCost, 0.8);
  assert.equal(BETA_TUNE.grazeImmediateShare, 0.35);
  assert.equal(BETA_TUNE.mouthCapacity, 120);
  assert.equal(BETA_TUNE.flowerCount, 4);
  assert.ok(BETA_TUNE.companionFollowSpeed > 7.2);
  assert.ok(BETA_TUNE.companionFollowGap < 1.5);
  assert.ok(BETA_TUNE.lungeLockRange > 0);
  // 吃草耗时必须比正式版短（用户需求：吃草时间缩短）
  assert.ok(BETA_TUNE.grassSeconds > 0 && BETA_TUNE.grassSeconds < FORAGE.grassSeconds);
});

test('lunge lock points along -Z at yaw zero and chooses the nearest valid target', () => {
  const yaw = resolveLungeLockYaw(0, 0, 0, [
    { x: 1, z: -3, alive: true, hp: 10 },
    { x: 0, z: -2, alive: true, hp: 10 },
  ]);
  near(yaw, 0);
});

test('lunge lock ignores targets outside the forward cone or range', () => {
  assert.equal(resolveLungeLockYaw(0, 0, 0, [{ x: 5, z: 0, alive: true, hp: 10 }]), null);
  assert.equal(resolveLungeLockYaw(0, 0, 0, [{ x: 0, z: 4, alive: true, hp: 10 }]), null);
  assert.equal(resolveLungeLockYaw(0, 0, 0, [{ x: 0, z: -10, alive: true, hp: 10 }]), null);
});

test('lunge lock ignores defeated foxes and returns null for an empty list', () => {
  assert.equal(resolveLungeLockYaw(0, 0, 0, [
    { x: 0, z: -2, alive: true, hp: 0 },
    { x: 0, z: -3, alive: false, hp: 10 },
  ]), null);
  assert.equal(resolveLungeLockYaw(0, 0, 0, []), null);
});

test('flower instant completion is beta-only and does not apply to grass', () => {
  assert.equal(betaFlowerCompletesImmediately('flower', { betaOn: true }), true);
  assert.equal(betaFlowerCompletesImmediately('grass', { betaOn: true }), false);
  assert.equal(betaFlowerCompletesImmediately('flower', { betaOn: false }), false);
});

test('grass forage uses the beta shorter seconds only when an override is passed', () => {
  // 不传 seconds：逐字沿用正式版 FORAGE.grassSeconds（beta 缩短不得泄漏到非 beta 路径）
  let legacy = 0;
  for (let t = 0; t < FORAGE.grassSeconds; t += 0.01) {
    legacy = stepForageProgress(legacy, 0.01, { inRange: true, kind: 'grass', emergency: false });
  }
  assert.ok(legacy >= 0.99);
  // 传 beta 的更短 seconds：在该时长内即可吃满
  let fast = 0;
  for (let t = 0; t < BETA_TUNE.grassSeconds; t += 0.01) {
    fast = stepForageProgress(fast, 0.01, { inRange: true, kind: 'grass', emergency: false, seconds: BETA_TUNE.grassSeconds });
  }
  assert.ok(fast >= 0.99);
  assert.ok(BETA_TUNE.grassSeconds < FORAGE.grassSeconds);
  // 非法 seconds（0/负数）回退默认，不能除以 0
  assert.ok(stepForageProgress(0, 0.5, { inRange: true, kind: 'grass', seconds: 0 }) < 1);
});
