import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AccountsApi, AccountsApiError, buildScorePayload, escapeHtml, formatSeconds,
} from '../src/core/accounts-api.mjs';
import {
  clearSession, readSession, restoreSession, writeSession,
} from '../src/core/accounts-session.mjs';

function memoryStorage() {
  const values = new Map();
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
  };
}

test('buildScorePayload validates time and level, floors counters and defaults missing counters to zero', () => {
  assert.deepEqual(buildScorePayload({ kind: 'level', level: 2, time: 42.5, hits: 3.9, boosts: -2, ultimates: '4', version: 'BETA' }, 5), {
    kind: 'level', level: 2, time: 42.5, hits: 3, boosts: 0, ultimates: 4, version: 'BETA',
  });
  assert.deepEqual(buildScorePayload({ kind: 'full', time: 523.1 }, 5), {
    kind: 'full', time: 523.1, hits: 0, boosts: 0, ultimates: 0, version: 'unknown',
  });
  assert.throws(() => buildScorePayload({ kind: 'full', time: 0 }, 5), RangeError);
  assert.throws(() => buildScorePayload({ kind: 'level', level: -1, time: 1 }, 5), RangeError);
  assert.throws(() => buildScorePayload({ kind: 'level', level: 5, time: 1 }, 5), RangeError);
  assert.throws(() => buildScorePayload({ kind: 'full', time: 86400.1 }, 5), RangeError);
});

test('session round-trips token/user with guest flag; 401 restore clears it', async () => {
  const storage = memoryStorage();
  const key = 'test.session';
  const written = writeSession('secret-token', { id: 7, name: '玩家' }, storage, key);
  assert.deepEqual(written, { token: 'secret-token', user: { id: 7, name: '玩家', guest: false } });
  const guest = writeSession('g-token', { id: 9, name: '游客-abc', guest: true }, storage, 'g.key');
  assert.deepEqual(guest.user, { id: 9, name: '游客-abc', guest: true });
  assert.equal(readSession(storage, key).user.guest, false);

  const restore = await restoreSession({ me: async () => { throw new AccountsApiError(401, 'expired'); } }, storage, key);
  assert.equal(restore.invalid, true);
  assert.equal(restore.session, null);
  assert.equal(readSession(storage, key), null);
  assert.equal(clearSession(storage, 'g.key'), true);
});

test('escapeHtml and time format', () => {
  assert.equal(escapeHtml(`<img src=x onerror='a'>&"`), '&lt;img src=x onerror=&#39;a&#39;&gt;&amp;&quot;');
  assert.equal(formatSeconds(12), '12.0s');
  assert.equal(formatSeconds(12.34), '12.34s');
});

test('API: bearer header, leaderboard filters, guest() and upgrade() routes', async () => {
  const calls = [];
  const api = new AccountsApi({
    basePath: '/marmot3d-beta/api', requestTimeoutMs: 5000,
    fetchFn: async (url, options) => {
      calls.push({ url, options });
      return { ok: true, json: async () => ({ user: { id: 1, name: '甲' }, items: [] }) };
    },
  });
  await api.request('/auth/me', { token: 'private-token', query: { token: 'leak', kind: 'full' } });
  await api.leaderboard('level', { level: 2, limit: 50 });
  await api.guest();
  await api.upgrade({ username: '土拨鼠', password: 'secret1' }, 'guest-token');
  assert.equal(calls[0].url, '/marmot3d-beta/api/auth/me?kind=full');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer private-token');
  assert.equal(calls[0].url.includes('private-token'), false);
  assert.equal(calls[0].url.includes('leak'), false);
  assert.equal(calls[1].url, '/marmot3d-beta/api/leaderboard?kind=level&level=2&limit=50');
  assert.equal(calls[1].options.headers.Authorization, undefined);
  // guest: POST /auth/guest, no auth header, empty object body
  assert.equal(calls[2].url, '/marmot3d-beta/api/auth/guest');
  assert.equal(calls[2].options.method, 'POST');
  assert.equal(calls[2].options.headers.Authorization, undefined);
  assert.deepEqual(JSON.parse(calls[2].options.body), {});
  // upgrade: POST /auth/upgrade with the guest bearer and credentials body
  assert.equal(calls[3].url, '/marmot3d-beta/api/auth/upgrade');
  assert.equal(calls[3].options.method, 'POST');
  assert.equal(calls[3].options.headers.Authorization, 'Bearer guest-token');
  assert.deepEqual(JSON.parse(calls[3].options.body), { username: '土拨鼠', password: 'secret1' });
});
