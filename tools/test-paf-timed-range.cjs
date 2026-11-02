const assert = require('node:assert/strict');
const test = require('node:test');

let mod;
let pounce;
let input;
test.before(async () => {
  mod = await import('../src/core/paf-timed-range.mjs');
  pounce = await import('../src/core/paf-pounce.js');
  input = await import('../src/core/paf-input.js');
});

test('timed round starts, pauses, resumes, and finishes exactly at 120000ms', () => {
  const round = mod.createPafTimedRound();
  assert.equal(round.status, 'idle');
  round.start();
  assert.equal(round.tick(119999).status, 'running');
  assert.equal(round.elapsedMs, 119999);
  round.pause();
  assert.equal(round.tick(5000).elapsedMs, 119999);
  round.resume();
  const end = round.tick(1);
  assert.equal(end.justFinished, true);
  assert.equal(end.status, 'finished');
  assert.equal(end.elapsedMs, 120000);
  assert.equal(end.remainingMs, 0);
  assert.equal(round.tick(1000).justFinished, false);
  assert.equal(round.canScore, false);
});

test('restart clears elapsed state and creates a new running round', () => {
  const round = mod.createPafTimedRound();
  round.start(); round.tick(120000);
  const restarted = round.restart();
  assert.deepEqual(restarted, { status: 'running', elapsedMs: 0, remainingMs: 120000, durationMs: 120000, justFinished: false });
  assert.equal(round.canScore, true);
});

test('round cancellation clears the held attack pointer before a new round', () => {
  const charge = new input.PafPounceCharge();
  assert.equal(charge.press(17), true);
  assert.equal(charge.cancel(), true);
  assert.equal(charge.active, false);
  assert.equal(charge.release(17), false);
  assert.equal(charge.press(18), true);
});

test('vertical attack drag maps to the same bounded range used by preview and actual path', () => {
  const base = mod.PAF_POUNCE_RANGE_DEFAULT;
  const forward = mod.pounceRangeFromDrag(base, -100);
  const backward = mod.pounceRangeFromDrag(base, 100);
  assert.ok(forward > base);
  assert.ok(backward < base);
  assert.equal(mod.pounceRangeFromDrag(base, -100000), mod.PAF_POUNCE_RANGE_MAX);
  assert.equal(mod.pounceRangeFromDrag(base, 100000), mod.PAF_POUNCE_RANGE_MIN);
  assert.equal(mod.pounceRangeFromDrag(base, Number.NaN), base);
  const preview = pounce.pafPouncePreviewSegment({ startX: 0, startZ: 0, yaw: 0, lungeSpeed: forward / 0.42, lungeTime: 0.42, catchRadius: 1 });
  const actual = pounce.pafPouncePathAt({ startX: 0, startZ: 0, yaw: 0, lungeSpeed: forward / 0.42, lungeTime: 0.42, t: 1 });
  assert.deepEqual(preview.end, actual);
  assert.ok(Math.abs(Math.hypot(actual.x, actual.z) - forward) < 1e-9);
});
