import test from 'node:test';
import assert from 'node:assert/strict';
import { createPafOnlineLeaderboard } from '../src/core/paf-online-leaderboard.mjs';

const entry = { rank: 1, name: 'Player_One', score: 7, durationMs: 120000, completionMs: 120000, submittedAt: '2026-11-03T00:00:00.000Z' };

test('board exposes loading, empty, ready and error/retry states', async () => {
  const calls = [];
  let fail = true;
  const api = { request: async (route, options) => {
    calls.push({ route, options });
    if (fail) throw new Error('offline');
    return { total: 0, items: [] };
  } };
  const board = createPafOnlineLeaderboard({ api });
  assert.equal(board.getState().status, 'idle');
  assert.equal(await board.load(), false);
  assert.equal(board.getState().status, 'error');
  fail = false;
  assert.equal(await board.retry(), true);
  assert.equal(board.getState().status, 'empty');
  assert.equal(calls.length, 2);

  api.request = async () => ({ total: 1, items: [{ ...entry, submittedAt: '<img src=x onerror=alert(1)>' }] });
  assert.equal(await board.load(), false, 'invalid timestamps are rejected rather than rendered');
  api.request = async () => ({ total: 1, items: [entry] });
  assert.equal(await board.load(), true);
  assert.equal(board.getState().status, 'ready');
  assert.deepEqual(Object.keys(board.getState().items[0]).sort(), ['completionMs', 'durationMs', 'name', 'rank', 'score', 'submittedAt']);
});

test('real submission state reports server rank, refreshes board and prevents duplicate concurrent POST', async () => {
  let release;
  const calls = [];
  const api = { request: (route, options) => {
    calls.push({ route, options });
    if (route === '/paf/runs') return Promise.resolve({ ok: true, ticket: 'run-ticket', durationMs: 120000, expiresAt: '2026-11-03T01:00:00.000Z' });
    if (route === '/paf/scores') return new Promise((resolve) => { release = () => resolve({ ok: true, rank: 1, total: 1, entry }); });
    return Promise.resolve({ total: 1, items: [entry] });
  } };
  const board = createPafOnlineLeaderboard({ api });
  await board.beginRun();
  const pending = board.submit({ score: 7, completionMs: 120000, durationMs: 120000 }, 'Player_One');
  assert.equal(board.getState().submission.status, 'submitting');
  assert.equal(await board.submit({ score: 7, completionMs: 120000, durationMs: 120000 }, 'Player_One'), false);
  release();
  assert.equal(await pending, true);
  assert.equal(board.getState().submission.status, 'success');
  assert.equal(board.getState().submission.rank, 1);
  assert.equal(calls.filter((call) => call.route === '/paf/scores').length, 1);
  assert.deepEqual(calls.find((call) => call.route === '/paf/scores').options.body, { name: 'Player_One', score: 7, completionMs: 120000, durationMs: 120000, runTicket: 'run-ticket' });
});

test('failed POST preserves retry payload; successful POST remains successful if later refresh fails', async () => {
  let shouldFail = true;
  let posts = 0;
  const api = { request: async (route) => {
    if (route === '/paf/runs') return { ok: true, ticket: 'run-ticket', durationMs: 120000, expiresAt: '2026-11-03T01:00:00.000Z' };
    if (route === '/paf/scores') {
      posts += 1;
      if (shouldFail && posts === 1) throw new Error('offline');
      return { ok: true, rank: 2, total: 3, entry: { ...entry, rank: 2 } };
    }
    if (shouldFail) throw new Error('refresh offline');
    return { total: 3, items: [] };
  } };
  const board = createPafOnlineLeaderboard({ api });
  await board.beginRun();
  assert.equal(await board.submit({ score: 9, completionMs: 120000, durationMs: 120000 }, 'Player_One'), false);
  assert.equal(board.getState().submission.status, 'error');
  assert.equal(await board.retry(), true);
  assert.equal(board.getState().submission.status, 'success');
  assert.equal(board.getState().status, 'error');
  assert.equal(posts, 2);
  board.resetSubmission();
  assert.equal(board.getState().submission.status, 'idle');
  await assert.rejects(() => board.submit({ score: 1, completionMs: 1, durationMs: 1 }, 'Player_One'), TypeError);
});

test('not-better POST exposes an honest non-record state without retrying', async () => {
  let posts = 0;
  const api = { request: async (route) => {
    if (route === '/paf/runs') return { ok: true, ticket: 'run-ticket', durationMs: 120000, expiresAt: '2026-11-03T01:00:00.000Z' };
    if (route === '/paf/scores') {
      posts += 1;
      return { ok: true, accepted: false, best: 12, rank: 2, total: 3,
        entry: { rank: 2, name: 'Player_One', score: 12, completionMs: 120000, durationMs: 120000, submittedAt: '2026-11-03T00:00:00.000Z' } };
    }
    return { total: 3, items: [] };
  } };
  const board = createPafOnlineLeaderboard({ api });
  await board.beginRun();
  assert.equal(await board.submit({ score: 4, completionMs: 120000, durationMs: 120000 }, 'Player_One'), false);
  assert.deepEqual(board.getState().submission, {
    status: 'not_better', accepted: false, best: 12, rank: 2, total: 3, name: 'Player_One', error: '',
  });
  assert.equal(await board.retry(), true, 'retry refreshes the board, not the rejected submission');
  assert.equal(posts, 1);
});

test('client rejects invalid names and accepts Unicode names', async () => {
  const calls = [];
  const api = { request: async (route, options) => { calls.push({ route, options }); if (route === '/paf/runs') return { ok: true, ticket: 'run-ticket', durationMs: 120000, expiresAt: '2026-11-03T01:00:00.000Z' }; return { ok: true, accepted: true, rank: 1, total: 1, name: '玩家一号1', best: 3, entry: { rank: 1, name: '玩家一号1', score: 3, durationMs: 120000, completionMs: 60000, submittedAt: '2026-11-03T00:00:00.000Z' } }; } };
  const board = createPafOnlineLeaderboard({ api });
  await assert.rejects(() => board.submit({ score: 3, completionMs: 60000, durationMs: 120000 }, 'bad name'), /名字/);
  await board.beginRun();
  assert.equal(await board.submit({ score: 3, completionMs: 60000, durationMs: 120000 }, '玩家一号1'), true);
  assert.equal(calls.find((call) => call.route === '/paf/scores').options.body.name, '玩家一号1');
});
