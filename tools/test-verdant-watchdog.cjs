const test = require('node:test');
const assert = require('node:assert/strict');
const { createLoadingActivityTracker, watchdogFailure } = require('../src/world/verdant-watchdog.mjs');

test('byte activity prevents a percentage-stall false positive', () => {
  let now = 0;
  const tracker = createLoadingActivityTracker({ now: () => now, stallMs: 25_000, hardLimitMs: 180_000 });
  tracker.noteBytes({ url: 'scene.glb', loaded: 10 }, 0);
  now = 24_000; tracker.noteBytes({ url: 'scene.glb', loaded: 20 }, now);
  now = 40_000;
  assert.equal(tracker.failure(), null);
});

test('zero byte activity stalls while hard limit wins at 180 seconds', () => {
  assert.equal(watchdogFailure({ startedAt: 0, lastByteAt: 0, now: 25_001 }), 'byte-stall');
  assert.equal(watchdogFailure({ startedAt: 0, lastByteAt: 170_000, now: 180_000 }), 'hard-timeout');
});

test('repeated byte offsets do not fake a heartbeat', () => {
  let now = 0;
  const tracker = createLoadingActivityTracker({ now: () => now });
  tracker.noteBytes({ url: 'a', loaded: 100 }, now);
  now = 26_000;
  tracker.noteBytes({ url: 'a', loaded: 100 }, now);
  assert.equal(tracker.failure(), 'byte-stall');
});
