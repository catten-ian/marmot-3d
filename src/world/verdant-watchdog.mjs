/** Byte-based boot watchdog helpers; injected timestamps keep tests deterministic. */
export function createByteHeartbeat(now = () => Date.now(), initialAt = now()) {
  let lastByteAt = initialAt;
  let totalBytes = 0;
  return {
    record(bytes) {
      const amount = Number(bytes);
      if (!Number.isFinite(amount) || amount <= 0) return false;
      totalBytes += amount;
      lastByteAt = now();
      return true;
    },
    snapshot() { return { lastByteAt, totalBytes }; },
  };
}

/** Returns null while active, otherwise a stable reason for the first timeout. */
export function watchdogFailure({ startedAt, lastByteAt, now, stallMs = 25000, hardLimitMs = 180000 }) {
  if (now - startedAt >= hardLimitMs) return 'hard-timeout';
  if (now - lastByteAt > stallMs) return 'byte-stall';
  return null;
}

/** Actual boot tracker: percentage/UI changes never count as network activity. */
export function createLoadingActivityTracker({ now = () => Date.now(), stallMs = 25000, hardLimitMs = 180000 } = {}) {
  const startedAt = now();
  let lastByteAt = startedAt;
  const seenBytes = new Map();
  return {
    noteBytes(payload, at = now()) {
      const p = payload && typeof payload === 'object' ? payload : { loaded: payload };
      const key = String(p.url || '');
      const loaded = Number(p.loaded);
      const previous = seenBytes.get(key) || 0;
      if (Number.isFinite(loaded) && loaded > previous) {
        seenBytes.set(key, loaded);
        lastByteAt = at;
        return true;
      }
      return false;
    },
    failure(at = now()) {
      if (at - startedAt >= hardLimitMs) return 'hard-timeout';
      return at - lastByteAt > stallMs ? 'byte-stall' : null;
    },
    snapshot() { return { startedAt, lastByteAt, stallMs, hardLimitMs }; },
  };
}
