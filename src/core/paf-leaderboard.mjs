/** Versioned, local-only PAF timed-round leaderboard. */

export const PAF_LEADERBOARD_VERSION = 1;
export const PAF_LEADERBOARD_KEY = 'm3d_paf_leaderboard_v1';
export const PAF_LEADERBOARD_CAPACITY = 10;

const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;

function validRecord(value) {
  if (!value || typeof value !== 'object') return false;
  const score = Number(value.score);
  const timestamp = String(value.timestamp || '');
  const durationMs = Number(value.durationMs);
  return Number.isInteger(score) && score >= 0 && score <= 100000
    && Number.isFinite(Date.parse(timestamp))
    && Number.isInteger(durationMs) && durationMs > 0;
}

function normalizeRecord(value) {
  return {
    score: Math.max(0, Math.min(100000, Math.trunc(Number(value.score)))),
    timestamp: new Date(value.timestamp).toISOString(),
    durationMs: Math.max(1, Math.trunc(Number(value.durationMs))),
  };
}

export function sortPafLeaderboard(records) {
  return records.slice().sort((a, b) => b.score - a.score
    || a.durationMs - b.durationMs
    || Date.parse(a.timestamp) - Date.parse(b.timestamp)
    || a.timestamp.localeCompare(b.timestamp));
}

export function createPafLeaderboard({
  storage,
  key = PAF_LEADERBOARD_KEY,
  capacity = PAF_LEADERBOARD_CAPACITY,
  now = () => new Date(),
} = {}) {
  let localStorageRef = storage;
  if (storage === undefined) {
    try { localStorageRef = globalThis.localStorage; } catch { localStorageRef = null; }
  }
  storage = localStorageRef;
  const limit = Math.max(1, Math.min(100, Math.trunc(finite(capacity, PAF_LEADERBOARD_CAPACITY))));
  let storageError = false;

  const read = () => {
    try {
      if (!storage || typeof storage.getItem !== 'function') { storageError = true; return []; }
      const raw = storage?.getItem?.(key);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (parsed?.version !== PAF_LEADERBOARD_VERSION || !Array.isArray(parsed.records)) return [];
      return sortPafLeaderboard(parsed.records.filter(validRecord).map(normalizeRecord)).slice(0, limit);
    } catch {
      storageError = true;
      return [];
    }
  };
  const write = (records) => {
    try {
      if (!storage || typeof storage.setItem !== 'function') { storageError = true; return false; }
      storage?.setItem?.(key, JSON.stringify({ version: PAF_LEADERBOARD_VERSION, records: sortPafLeaderboard(records).slice(0, limit) }));
      return true;
    } catch {
      storageError = true;
      return false;
    }
  };
  const list = () => read();
  const record = ({ score, timestamp = now(), durationMs = 120000 } = {}) => {
    let candidate;
    try { candidate = normalizeRecord({ score, timestamp, durationMs }); } catch { storageError = true; return { added: false, records: list() }; }
    if (!validRecord(candidate)) return { added: false, records: list() };
    const records = sortPafLeaderboard([...read(), candidate]).slice(0, limit);
    return { added: write(records), records };
  };
  const reset = () => {
    try {
      if (!storage || typeof storage.removeItem !== 'function') { storageError = true; return false; }
      storage.removeItem(key); return true;
    } catch { storageError = true; return false; }
  };
  return {
    get storageError() { return storageError; },
    get key() { return key; },
    get capacity() { return limit; },
    list,
    record,
    reset,
  };
}
