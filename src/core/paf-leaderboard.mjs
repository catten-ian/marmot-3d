/** Versioned, local-only PAF timed-round leaderboard. */
import { normalizePafName } from './paf-name.mjs';

export const PAF_LEADERBOARD_VERSION = 2;
export const PAF_LEADERBOARD_KEY = 'm3d_paf_leaderboard_v1';
export const PAF_LEADERBOARD_CAPACITY = 10;

const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;

function validRecord(value) {
  if (!value || typeof value !== 'object') return false;
  const score = Number(value.score);
  const timestamp = String(value.timestamp || '');
  const durationMs = Number(value.durationMs);
  const completionMs = value.completionMs === undefined ? 120000 : Number(value.completionMs);
  const name = value.name === undefined ? '' : String(value.name);
  return Number.isInteger(score) && score >= 0 && score <= 100000
    && Number.isFinite(Date.parse(timestamp))
    && Number.isInteger(durationMs) && durationMs > 0
    && Number.isInteger(completionMs) && completionMs >= 0 && completionMs <= durationMs
    && (!name || normalizePafName(name).ok);
}

function normalizeRecord(value) {
  const nameResult = value.name ? normalizePafName(value.name) : { ok: true, value: '' };
  if (!nameResult.ok) throw new TypeError(nameResult.error);
  const durationMs = Math.max(1, Math.trunc(Number(value.durationMs)));
  return {
    ...(nameResult.value ? { name: nameResult.value } : {}),
    score: Math.max(0, Math.min(100000, Math.trunc(Number(value.score)))),
    timestamp: new Date(value.timestamp).toISOString(),
    durationMs,
    completionMs: Math.max(0, Math.min(durationMs, Math.trunc(Number(value.completionMs ?? durationMs)))),
  };
}

export function sortPafLeaderboard(records) {
  return records.slice().sort((a, b) => b.score - a.score
    || (a.completionMs ?? a.durationMs) - (b.completionMs ?? b.durationMs)
    || Date.parse(a.timestamp) - Date.parse(b.timestamp)
    || a.timestamp.localeCompare(b.timestamp)
    || String(a.name || '').localeCompare(String(b.name || '')));
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
      const raw = storage.getItem(key);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (![1, PAF_LEADERBOARD_VERSION].includes(parsed?.version) || !Array.isArray(parsed.records)) return [];
      return sortPafLeaderboard(parsed.records.filter(validRecord).map(normalizeRecord)).slice(0, limit);
    } catch {
      storageError = true;
      return [];
    }
  };
  const write = (records) => {
    try {
      if (!storage || typeof storage.setItem !== 'function') { storageError = true; return false; }
      storage.setItem(key, JSON.stringify({ version: PAF_LEADERBOARD_VERSION, records: sortPafLeaderboard(records).slice(0, limit) }));
      return true;
    } catch {
      storageError = true;
      return false;
    }
  };
  const list = () => read();
  const record = ({ name, score, timestamp = now(), durationMs = 120000, completionMs = durationMs } = {}, { replaceExisting = false } = {}) => {
    let candidate;
    try {
      const parsedName = normalizePafName(name);
      if (!parsedName.ok) return { added: false, needsName: true, error: parsedName.error, records: list() };
      candidate = normalizeRecord({ name: parsedName.value, score, timestamp, durationMs, completionMs });
    } catch (error) { storageError = true; return { added: false, error: String(error?.message || '本机记录无效'), records: list() }; }
    if (!validRecord(candidate)) return { added: false, error: '本机记录无效', records: list() };
    const records = read();
    const sameNameIndex = records.findIndex((row) => String(row.name || '').toLocaleLowerCase() === candidate.name.toLocaleLowerCase());
    if (sameNameIndex >= 0) {
      const existing = records[sameNameIndex];
      const better = candidate.score > existing.score
        || (candidate.score === existing.score && candidate.completionMs < existing.completionMs);
      if (!better) return { added: false, reason: 'not_better', existing, records };
      if (!replaceExisting) return { added: false, needsConfirmation: true, existing, candidate, records };
      const next = records.slice(); next[sameNameIndex] = candidate;
      return { added: write(next), replaced: true, existing, records: sortPafLeaderboard(next).slice(0, limit) };
    }
    const next = sortPafLeaderboard([...records, candidate]).slice(0, limit);
    return { added: write(next), records: next };
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
