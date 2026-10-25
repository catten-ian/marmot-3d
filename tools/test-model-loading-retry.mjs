import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ModelLoadCache, loadWithRetry, modelTriangleCount, requireUsableModel,
  MODEL_LOAD_ATTEMPTS, MODEL_RETRY_BACKOFF_MS,
} from '../src/models/model-load-retry.mjs';

function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function root(...objects) {
  return { traverse(callback) { for (const object of objects) callback(object); } };
}

function mesh(positionCount = 24, indexCount = null) {
  return {
    isMesh: true,
    geometry: {
      attributes: { position: { count: positionCount } },
      index: indexCount == null ? null : { count: indexCount },
    },
  };
}

test('genuine loader failures retry with deterministic backoff and then succeed', async () => {
  const waits = [];
  const failures = [];
  let calls = 0;
  const value = await loadWithRetry({
    attempt: async () => {
      calls++;
      if (calls < 3) throw new Error(`temporary ${calls}`);
      return { scene: 'valid' };
    },
    wait: async (ms, number) => { waits.push([ms, number]); },
    onError: (error, state) => { failures.push([error.message, state.final]); },
  });
  assert.deepEqual(value, { scene: 'valid' });
  assert.equal(calls, 3);
  assert.deepEqual(waits, MODEL_RETRY_BACKOFF_MS.map((ms, index) => [ms, index + 1]));
  assert.deepEqual(failures, [['temporary 1', false], ['temporary 2', false]]);
});

test('retry sequence is bounded and returns null for procedural fallback', async () => {
  let calls = 0;
  const waits = [];
  const states = [];
  const value = await loadWithRetry({
    attempt: async () => { calls++; throw new Error('offline'); },
    wait: async (ms) => { waits.push(ms); },
    onError: (_error, state) => { states.push(state); },
  });
  assert.equal(value, null);
  assert.equal(calls, MODEL_LOAD_ATTEMPTS);
  assert.deepEqual(waits, MODEL_RETRY_BACKOFF_MS);
  assert.equal(states.length, MODEL_LOAD_ATTEMPTS);
  assert.equal(states.at(-1).final, true);
  assert.equal(states.at(-1).delayMs, 0, 'no timer is scheduled after exhaustion');
});

test('empty scenes and invalid/empty geometry are rejected as retryable assets', async () => {
  assert.throws(() => requireUsableModel(null), (error) => error.code === 'empty');
  assert.throws(() => requireUsableModel(root()), (error) => error.code === 'empty-geometry');
  assert.throws(() => requireUsableModel(root(mesh(3))), (error) => error.code === 'empty-geometry' && error.tris === 1);
  assert.throws(() => requireUsableModel(root(mesh(Number.NaN))), (error) => error.code === 'empty-geometry');
  assert.equal(modelTriangleCount(root(mesh(24), mesh(12, 24))), 16);
  assert.equal(requireUsableModel(root(mesh(24))), 8);

  let calls = 0;
  const result = await loadWithRetry({
    attempt: async () => {
      calls++;
      if (calls === 1) requireUsableModel(root());
      return requireUsableModel(root(mesh(24)));
    },
    wait: async () => {},
  });
  assert.equal(result, 8, 'an empty response can recover on the next attempt');
  assert.equal(calls, 2);
});

test('cache coalesces requests, suppresses failure storms, and recovers after cooldown', async () => {
  let now = 1000;
  let calls = 0;
  const first = deferred();
  const cache = new ModelLoadCache({ now: () => now, failureCooldownMs: 5000 });
  const startFirst = () => { calls++; return first.promise; };
  const pendingA = cache.load('/model.glb', startFirst);
  const pendingB = cache.load('/model.glb', startFirst);
  assert.strictEqual(pendingA, pendingB, 'concurrent callers share the complete retry sequence');
  await Promise.resolve();
  assert.equal(calls, 1);

  first.resolve(null);
  assert.equal(await pendingA, null);
  assert.strictEqual(cache.load('/model.glb', () => { calls++; return 'unexpected'; }), pendingA,
    'terminal fallback is shared during the failure cooldown');
  await Promise.resolve();
  assert.equal(calls, 1, 'additional entities cannot start a retry storm');

  now += 5001;
  const recovered = cache.load('/model.glb', async () => { calls++; return { scene: 'recovered' }; });
  assert.notStrictEqual(recovered, pendingA, 'expired failure does not permanently poison the URL');
  assert.deepEqual(await recovered, { scene: 'recovered' });
  assert.strictEqual(cache.load('/model.glb', () => { calls++; return null; }), recovered);
  await Promise.resolve();
  assert.equal(calls, 2, 'successful recovery is cached without more requests');
});

test('an unexpected loader rejection still resolves null instead of breaking gameplay', async () => {
  const cache = new ModelLoadCache({ now: () => 0 });
  assert.equal(await cache.load('/broken.glb', async () => { throw new Error('decoder crash'); }), null);
});
