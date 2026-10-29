import test from 'node:test';
import assert from 'node:assert/strict';
import { PLAYER } from '../src/core/config.js';
import { BETA_TUNE } from '../src/core/beta-tuning.js';
import { chewMouth, resolveMouthChewRate } from '../src/core/stamina.mjs';

const state = { stamina: 20, fat: 3, mouth: 50 };
const threshold = BETA_TUNE.chewRunSpeedThreshold;
const floor = BETA_TUNE.chewPerSec * BETA_TUNE.chewRunRateRatio;
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);

 test('ordinary running threshold is derived from the player base speed and beta movement multiplier', () => {
  near(threshold, PLAYER.speed * BETA_TUNE.moveSpeedMul);
});

test('standing still chews at the existing chewPerSec upper rate', () => {
  near(resolveMouthChewRate(0), BETA_TUNE.chewPerSec);
  near(chewMouth(state, 1, { speed: 0 }).chewed, BETA_TUNE.chewPerSec);
});

test('sub-threshold movement remains chewable and decreases monotonically', () => {
  const slow = resolveMouthChewRate(threshold * 0.25);
  const fast = resolveMouthChewRate(threshold * 0.75);
  assert.ok(slow > fast && fast > floor);
  assert.ok(slow < BETA_TUNE.chewPerSec);
  near(chewMouth(state, 1, { speed: threshold * 0.25 }).chewed, slow);
});

test('exact ordinary running threshold remains chewable at the configured floor ratio', () => {
  near(resolveMouthChewRate(threshold), floor);
  near(chewMouth(state, 1, { speed: threshold }).chewed, floor);
});

test('sprint, boost and overdrive speeds above threshold stop mouth digestion without resource changes', () => {
  for (const speed of [threshold + 0.01, 7.3, 12]) {
    const result = chewMouth(state, 1, { speed });
    assert.equal(result.chewed, 0);
    assert.equal(result.mouth, state.mouth);
    assert.equal(result.stamina, state.stamina);
    assert.equal(result.fat, state.fat);
  }
});

test('base and shelter burrow rates remain independent of outside speed rules', () => {
  const base = chewMouth(state, 1, { speed: threshold + 10, burrowType: 'base' });
  const shelter = chewMouth(state, 1, { speed: threshold + 10, burrowType: 'shelter' });
  near(base.chewed, BETA_TUNE.mainBurrowChewPerSec);
  near(shelter.chewed, BETA_TUNE.temporaryBurrowChewPerSec);
});

test('grazing still pauses outside mouth digestion at every speed', () => {
  for (const speed of [0, threshold * 0.5, threshold + 1]) {
    const result = chewMouth(state, 1, { speed, grazing: true });
    assert.equal(result.chewed, 0);
    assert.equal(result.mouth, state.mouth);
    assert.equal(result.stamina, state.stamina);
    assert.equal(result.fat, state.fat);
  }
});
