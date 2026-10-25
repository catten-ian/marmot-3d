/** Shared retry/cache policy for optional GLB assets. No browser or THREE dependency. */
export const MODEL_LOAD_ATTEMPTS = 3;
export const MODEL_RETRY_BACKOFF_MS = Object.freeze([250, 750]);
export const MODEL_FAILURE_COOLDOWN_MS = 30000;

const defaultWait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Run one bounded retry sequence. The attempt callback owns loader-specific
 * validation and must reject empty/invalid assets so they follow the same path
 * as transport and decoder errors.
 */
export async function loadWithRetry({
  attempt,
  onError = () => {},
  maxAttempts = MODEL_LOAD_ATTEMPTS,
  backoffMs = MODEL_RETRY_BACKOFF_MS,
  wait = defaultWait,
} = {}) {
  if (typeof attempt !== 'function') throw new TypeError('attempt must be a function');
  const attempts = Math.max(1, Math.floor(maxAttempts));
  for (let number = 1; number <= attempts; number++) {
    try {
      return await attempt(number);
    } catch (error) {
      const final = number === attempts;
      const delayMs = final ? 0 : Math.max(0, Number(backoffMs[number - 1] ?? backoffMs.at(-1) ?? 0));
      onError(error, { number, attempts, final, delayMs });
      if (final) return null;
      await wait(delayMs, number);
    }
  }
  return null;
}

/**
 * Cache successful assets and coalesce all concurrent requests. A terminal
 * failure is retained only for a short cooldown: callers during that window
 * share null (no request storm), while a later explicit request can recover.
 */
export class ModelLoadCache {
  constructor({ now = Date.now, failureCooldownMs = MODEL_FAILURE_COOLDOWN_MS } = {}) {
    this.now = now;
    this.failureCooldownMs = failureCooldownMs;
    this.entries = new Map();
  }

  load(key, start) {
    const previous = this.entries.get(key);
    if (previous && (!previous.failed || previous.retryAfter > this.now())) return previous.promise;

    const entry = { promise: null, failed: false, retryAfter: 0 };
    // Each entry records only its own outcome. If a failed entry is later
    // replaced, an old awaiter can never overwrite the newer cache entry.
    entry.promise = Promise.resolve().then(start).then((value) => {
      entry.failed = value == null;
      if (entry.failed) entry.retryAfter = this.now() + this.failureCooldownMs;
      return value;
    }, () => {
      entry.failed = true;
      entry.retryAfter = this.now() + this.failureCooldownMs;
      return null;
    });
    this.entries.set(key, entry);
    return entry.promise;
  }

  promises() {
    return [...this.entries.values()].map((entry) => entry.promise);
  }
}

/** Count only finite, well-formed mesh geometry; malformed meshes count as empty. */
export function modelTriangleCount(root) {
  let tris = 0;
  if (!root || typeof root.traverse !== 'function') return 0;
  root.traverse((object) => {
    if (!object?.isMesh) return;
    const geometry = object.geometry;
    const position = geometry?.attributes?.position;
    const count = geometry.index ? geometry.index.count : position?.count;
    if (!position || !Number.isFinite(count) || count < 0) return;
    tris += count / 3;
  });
  return Number.isFinite(tris) ? Math.round(tris) : 0;
}

/** Return the valid triangle count or reject with a retryable empty-asset error. */
export function requireUsableModel(root, minTriangles = 8) {
  if (!root || typeof root.traverse !== 'function') {
    const error = new Error('场景为空');
    error.code = 'empty';
    throw error;
  }
  const tris = modelTriangleCount(root);
  if (tris < minTriangles) {
    const error = new Error(`几何体为空或无效（${tris} 面）`);
    error.code = 'empty-geometry';
    error.tris = tris;
    throw error;
  }
  return tris;
}
