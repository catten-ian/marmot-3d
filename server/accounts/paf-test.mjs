import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';

import { createAccountsServer } from './server.mjs';

const secret = 'test-only-' + Math.random().toString(36).slice(2);
const running = [];

async function start(options = {}) {
  const dataDir = options.dataDir || fs.mkdtempSync(path.join(os.tmpdir(), 'm3d-paf-scores-'));
  const app = createAccountsServer({ secret, dataDir, ratePerMin: 1000, pafRatePerMin: 1000, ...options });
  const port = await new Promise((resolve) => app.server.listen(0, '127.0.0.1', () => resolve(app.server.address().port)));
  const context = { app, dataDir, baseUrl: `http://127.0.0.1:${port}` };
  running.push(context);
  return context;
}

async function stop(context) {
  await new Promise((resolve) => context.app.server.close(resolve));
  const index = running.indexOf(context); if (index >= 0) running.splice(index, 1);
}

test.after(async () => {
  for (const context of running.splice(0)) {
    await stop(context);
    fs.rmSync(context.dataDir, { recursive: true, force: true });
  }
});

async function request(context, method, route, { ip = '198.51.100.10', body, raw, headers = {} } = {}) {
  const response = await fetch(context.baseUrl + route, {
    method,
    headers: {
      ...(body !== undefined || raw !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(ip ? { 'X-Forwarded-For': ip } : {}),
      ...headers,
    },
    body: raw !== undefined ? raw : body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let json = null; try { json = JSON.parse(text); } catch {}
  return { status: response.status, json, text, headers: Object.fromEntries(response.headers.entries()) };
}

test('two IPs coexist; same IP replaces even with lower score and persists only current records', async () => {
  const context = await start();
  const first = await request(context, 'POST', '/paf/scores', { ip: ' 203.0.113.10, 10.0.0.1 ', body: { score: 90, durationMs: 120000 } });
  const second = await request(context, 'POST', '/paf/scores', { ip: '2001:db8::1', body: { score: 80, durationMs: 120000 } });
  assert.equal(first.status, 200); assert.equal(second.status, 200);
  assert.equal(first.json.rank, 1); assert.equal(second.json.rank, 2);

  const replacement = await request(context, 'POST', '/paf/scores', { ip: '203.0.113.10', body: { score: 5, durationMs: 120000, submittedAt: '1999-01-01' } });
  assert.equal(replacement.status, 200);
  assert.equal(replacement.json.rank, 2);
  assert.notEqual(replacement.json.entry.submittedAt, '1999-01-01');

  const board = await request(context, 'GET', '/paf/leaderboard', { ip: '' });
  assert.equal(board.status, 200);
  assert.equal(board.json.total, 2);
  assert.deepEqual(board.json.items.map((r) => [r.rank, r.score]), [[1, 80], [2, 5]]);
  for (const item of board.json.items) assert.deepEqual(Object.keys(item).sort(), ['durationMs', 'rank', 'score', 'submittedAt']);
  assert.doesNotMatch(board.text, /203\.0\.113\.10|2001:db8|10\.0\.0\.1|[a-f0-9]{64}|key|hash|ip/i);

  const file = path.join(context.dataDir, 'paf-scores.jsonl');
  const records = fs.readFileSync(file, 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(records.length, 2);
  assert.deepEqual(records.map((r) => r.score).sort((a, b) => a - b), [5, 80]);
  assert.equal(records.filter((r) => r.score === 90).length, 0);
  assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /203\.0\.113\.10|2001:db8/i);
  await stop(context); fs.rmSync(context.dataDir, { recursive: true, force: true });
});

test('score desc, submittedAt asc, continuous rank, unique total and bounded limit survive restart', async () => {
  const context = await start();
  await request(context, 'POST', '/paf/scores', { ip: '198.51.100.1', body: { score: 40, durationMs: 120000 } });
  await new Promise((resolve) => setTimeout(resolve, 5));
  await request(context, 'POST', '/paf/scores', { ip: '198.51.100.2', body: { score: 70, durationMs: 120000 } });
  await new Promise((resolve) => setTimeout(resolve, 5));
  await request(context, 'POST', '/paf/scores', { ip: '198.51.100.3', body: { score: 40, durationMs: 120000 } });
  const limited = await request(context, 'GET', '/paf/leaderboard?limit=2');
  assert.equal(limited.json.total, 3);
  assert.deepEqual(limited.json.items.map((r) => [r.rank, r.score]), [[1, 70], [2, 40]]);
  assert.equal((await request(context, 'GET', '/paf/leaderboard?limit=999')).json.items.length, 3);
  assert.equal((await request(context, 'GET', '/paf/leaderboard?limit=0')).status, 400);
  const dataDir = context.dataDir;
  await stop(context);

  const restarted = await start({ dataDir });
  const board = await request(restarted, 'GET', '/paf/leaderboard');
  assert.equal(board.json.total, 3);
  assert.deepEqual(board.json.items.map((r) => r.score), [70, 40, 40]);
  assert.ok(Date.parse(board.json.items[1].submittedAt) < Date.parse(board.json.items[2].submittedAt));
  await request(restarted, 'POST', '/paf/scores', { ip: '198.51.100.1', body: { score: 1, durationMs: 120000 } });
  assert.equal(fs.readFileSync(path.join(dataDir, 'paf-scores.jsonl'), 'utf8').trim().split('\n').length, 3);
  assert.deepEqual((await request(restarted, 'GET', '/paf/leaderboard')).json.items.map((r) => r.score), [70, 40, 1]);
  await stop(restarted); fs.rmSync(dataDir, { recursive: true, force: true });
});

test('strict JSON, integer score and exact duration validation; body limit and independent IP rate limit', async () => {
  const context = await start({ pafRatePerMin: 2, pafBodyLimit: 256 });
  const invalid = [
    { score: -1, durationMs: 120000 }, { score: 100001, durationMs: 120000 },
    { score: 1.5, durationMs: 120000 }, { score: '5', durationMs: 120000 },
    { score: 5, durationMs: 119999 }, { score: 5, durationMs: '120000' },
  ];
  for (const body of invalid) {
    const ip = `198.18.0.${invalid.indexOf(body) + 1}`;
    assert.equal((await request(context, 'POST', '/paf/scores', { ip, body })).status, 400);
  }
  assert.equal((await request(context, 'POST', '/paf/scores', { ip: '198.18.1.1', raw: '[]' })).status, 400);
  assert.equal((await request(context, 'POST', '/paf/scores', { ip: '198.18.1.2', raw: '{bad' })).status, 400);
  assert.equal((await request(context, 'POST', '/paf/scores', { ip: '198.18.1.3', raw: '' })).status, 400);
  assert.equal((await request(context, 'POST', '/paf/scores', { ip: '198.18.1.4', raw: `{"score":1,"durationMs":120000,"pad":"${'x'.repeat(300)}` })).status, 413);

  const ip = '198.19.0.1';
  assert.equal((await request(context, 'POST', '/paf/scores', { ip, body: { score: 1, durationMs: 120000 } })).status, 200);
  assert.equal((await request(context, 'POST', '/paf/scores', { ip, body: { score: 2, durationMs: 120000 } })).status, 200);
  const limited = await request(context, 'POST', '/paf/scores', { ip, body: { score: 3, durationMs: 120000 } });
  assert.equal(limited.status, 429); assert.match(limited.json.error, /频繁/); assert.equal(limited.headers['retry-after'], '60');
  assert.equal((await request(context, 'POST', '/paf/scores', { ip: '198.19.0.2', body: { score: 3, durationMs: 120000 } })).status, 200);
  await stop(context); fs.rmSync(context.dataDir, { recursive: true, force: true });
});

test('disk rewrite failure returns non-success and leaves the previous in-memory record effective', async () => {
  const context = await start();
  const ip = '192.0.2.55';
  await request(context, 'POST', '/paf/scores', { ip, body: { score: 33, durationMs: 120000 } });
  const file = path.join(context.dataDir, 'paf-scores.jsonl');
  fs.unlinkSync(file); fs.mkdirSync(file);
  const failed = await request(context, 'POST', '/paf/scores', { ip, body: { score: 2, durationMs: 120000 } });
  assert.equal(failed.status, 500);
  const board = await request(context, 'GET', '/paf/leaderboard');
  assert.equal(board.json.total, 1); assert.equal(board.json.items[0].score, 33);
  await stop(context); fs.rmSync(context.dataDir, { recursive: true, force: true });
});
