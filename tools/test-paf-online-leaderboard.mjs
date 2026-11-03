import test from 'node:test';
import assert from 'node:assert/strict';
import { createPafOnlineLeaderboard } from '../src/core/paf-online-leaderboard.mjs';

const entry = { rank: 1, score: 7, durationMs: 120000, submittedAt: '2026-11-03T00:00:00.000Z' };

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
  assert.deepEqual(Object.keys(board.getState().items[0]).sort(), ['durationMs', 'rank', 'score', 'submittedAt']);
});

test('real submission state reports server rank, refreshes board and prevents duplicate concurrent POST', async () => {
  let release;
  const calls = [];
  const api = { request: (route, options) => {
    calls.push({ route, options });
    if (route === '/paf/scores') return new Promise((resolve) => { release = () => resolve({ ok: true, rank: 1, total: 1, entry }); });
    return Promise.resolve({ total: 1, items: [entry] });
  } };
  const board = createPafOnlineLeaderboard({ api });
  const pending = board.submit({ score: 7, durationMs: 120000 });
  assert.equal(board.getState().submission.status, 'submitting');
  assert.equal(await board.submit({ score: 7, durationMs: 120000 }), false);
  release();
  assert.equal(await pending, true);
  assert.equal(board.getState().submission.status, 'success');
  assert.equal(board.getState().submission.rank, 1);
  assert.equal(calls.filter((call) => call.route === '/paf/scores').length, 1);
  assert.deepEqual(calls[0].options.body, { score: 7, durationMs: 120000 });
});

test('failed POST preserves retry payload; successful POST remains successful if later refresh fails', async () => {
  let shouldFail = true;
  let posts = 0;
  const api = { request: async (route) => {
    if (route === '/paf/scores') {
      posts += 1;
      if (shouldFail && posts === 1) throw new Error('offline');
      return { ok: true, rank: 2, total: 3, entry: { ...entry, rank: 2 } };
    }
    if (shouldFail) throw new Error('refresh offline');
    return { total: 3, items: [] };
  } };
  const board = createPafOnlineLeaderboard({ api });
  assert.equal(await board.submit({ score: 9, durationMs: 120000 }), false);
  assert.equal(board.getState().submission.status, 'error');
  assert.equal(await board.retry(), true);
  assert.equal(board.getState().submission.status, 'success');
  assert.equal(board.getState().status, 'error');
  assert.equal(posts, 2);
  board.resetSubmission();
  assert.equal(board.getState().submission.status, 'idle');
  await assert.rejects(() => board.submit({ score: 1, durationMs: 1 }), TypeError);
});
