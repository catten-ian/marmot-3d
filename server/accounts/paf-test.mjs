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
  let now = Date.now();
  const app = createAccountsServer({ secret, dataDir, ratePerMin: 1000, pafRatePerMin: 1000, pafNow: () => now, ...options });
  const port = await new Promise((resolve) => app.server.listen(0, '127.0.0.1', () => resolve(app.server.address().port)));
  const context = { app, dataDir, baseUrl: `http://127.0.0.1:${port}`, advance: (ms) => { now += ms; } }; running.push(context); return context;
}
async function stop(context) { await new Promise((resolve) => context.app.server.close(resolve)); const i = running.indexOf(context); if (i >= 0) running.splice(i, 1); }
test.after(async () => { for (const c of running.splice(0)) { await stop(c); fs.rmSync(c.dataDir, { recursive: true, force: true }); } });
async function request(context, method, route, { ip = '198.51.100.10', body, raw } = {}) {
  const response = await fetch(context.baseUrl + route, { method, headers: { ...(body !== undefined || raw !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(ip ? { 'X-Forwarded-For': ip } : {}) }, body: raw !== undefined ? raw : body === undefined ? undefined : JSON.stringify(body) });
  const text = await response.text(); let json = null; try { json = JSON.parse(text); } catch {} return { status: response.status, json, text, headers: Object.fromEntries(response.headers.entries()) };
}
const body = (name, score, completionMs = 120000) => ({ name, score, durationMs: 120000, completionMs });
async function scoreRequest(context, ip, payload) {
  const run = await request(context, 'POST', '/paf/runs', { ip, body: {} });
  assert.equal(run.status, 200);
  context.advance(120000);
  return request(context, 'POST', '/paf/scores', { ip, body: { ...payload, runTicket: run.json.ticket } });
}

test('run tickets reject early, tampered, cross-IP and replay submissions', async () => {
  const c = await start();
  const ip = '203.0.113.44';
  const run = await request(c, 'POST', '/paf/runs', { ip, body: {} });
  const payload = { ...body('Ticket_User', 7), runTicket: run.json.ticket };
  assert.equal((await request(c, 'POST', '/paf/scores', { ip, body: payload })).json.code, 'run_not_finished');
  c.advance(120000);
  assert.equal((await request(c, 'POST', '/paf/scores', { ip, body: { ...payload, runTicket: `${payload.runTicket}x` } })).status, 401);
  assert.equal((await request(c, 'POST', '/paf/scores', { ip: '203.0.113.45', body: payload })).status, 409);
  assert.equal((await request(c, 'POST', '/paf/scores', { ip, body: payload })).status, 200);
  assert.equal((await request(c, 'POST', '/paf/scores', { ip, body: payload })).status, 409);
  const expired = await request(c, 'POST', '/paf/runs', { ip, body: {} });
  c.advance(15 * 60 * 1000);
  assert.equal((await request(c, 'POST', '/paf/scores', { ip, body: { ...payload, runTicket: expired.json.ticket } })).status, 401);
  await stop(c); fs.rmSync(c.dataDir, { recursive: true, force: true });
});

test('name contract, same IP personal-best, unique names and honest responses', async () => {
  const c = await start();
  const naked = await request(c, 'POST', '/paf/scores', { ip: '203.0.113.99', body: body('Naked_HTTP', 99999, 0) });
  assert.equal(naked.status, 401);
  assert.equal(naked.json.code, 'run_ticket_invalid');
  for (const invalid of [{ score: 1, durationMs: 120000 }, { name: 'abcd', score: 1, durationMs: 120000 }, { name: 'bad name', score: 1, durationMs: 120000 }, { name: 'abc\n12', score: 1, durationMs: 120000 }]) assert.equal((await scoreRequest(c, '198.51.100.10', invalid)).status, 400);
  assert.equal((await scoreRequest(c, '203.0.113.1', body('Alpha_One', 10, 90000))).json.accepted, true);
  const low = await scoreRequest(c, '203.0.113.1', body('Alpha_One', 5, 1000));
  assert.equal(low.json.accepted, false); assert.equal(low.json.best, 10); assert.equal(low.json.entry.name, 'Alpha_One');
  const equal = await scoreRequest(c, '203.0.113.1', body('Alpha_One', 10, 1));
  assert.equal(equal.json.accepted, false);
  const conflict = await scoreRequest(c, '203.0.113.2', body('Alpha_One', 99, 1));
  assert.equal(conflict.status, 409); assert.equal(conflict.json.code, 'name_taken');
  const high = await scoreRequest(c, '203.0.113.1', body('Alpha_One', 11, 50000));
  assert.equal(high.json.accepted, true); assert.equal(high.json.entry.completionMs, 50000);
  const rename = await scoreRequest(c, '203.0.113.1', body('Bravo_Two', 12, 40000));
  assert.equal(rename.status, 409); assert.equal(rename.json.code, 'ip_name_mismatch');
  const second = await scoreRequest(c, '203.0.113.2', body('Bravo_Two', 9, 30000));
  assert.equal(second.status, 200);
  const board = await request(c, 'GET', '/paf/leaderboard');
  assert.deepEqual(board.json.items.map((r) => [r.name, r.score, r.completionMs]), [['Alpha_One', 11, 50000], ['Bravo_Two', 9, 30000]]);
  assert.doesNotMatch(board.text, /203\.0\.113|[a-f0-9]{64}|"key"|hmac|ip/i);
  await stop(c); fs.rmSync(c.dataDir, { recursive: true, force: true });
});

test('same-score completion time ordering, persistence and atomic rollback', async () => {
  const c = await start();
  await scoreRequest(c, '198.51.100.1', body('Gamma_One', 40, 90000));
  await scoreRequest(c, '198.51.100.2', body('Delta_Two', 40, 70000));
  await scoreRequest(c, '198.51.100.3', body('Echo_Three', 70, 80000));
  let board = await request(c, 'GET', '/paf/leaderboard'); assert.deepEqual(board.json.items.map((r) => r.name), ['Echo_Three', 'Delta_Two', 'Gamma_One']);
  const dataDir = c.dataDir; await stop(c); const restarted = await start({ dataDir });
  board = await request(restarted, 'GET', '/paf/leaderboard'); assert.deepEqual(board.json.items.map((r) => r.name), ['Echo_Three', 'Delta_Two', 'Gamma_One']);
  const file = path.join(dataDir, 'paf-scores.jsonl'); fs.unlinkSync(file); fs.mkdirSync(file);
  const failed = await scoreRequest(restarted, '198.51.100.3', body('Echo_Three', 71, 1));
  assert.equal(failed.status, 500); board = await request(restarted, 'GET', '/paf/leaderboard'); assert.equal(board.json.items[0].score, 70);
  await stop(restarted); fs.rmSync(dataDir, { recursive: true, force: true });
});

test('strict body, limit and rate validation', async () => {
  const c = await start({ pafRatePerMin: 2, pafBodyLimit: 1024 });
  assert.equal((await scoreRequest(c, '198.19.0.1', body('Rate_One', 1))).status, 200);
  assert.equal((await scoreRequest(c, '198.19.0.1', body('Rate_One', 2))).status, 200);
  assert.equal((await request(c, 'POST', '/paf/runs', { ip: '198.19.0.1', body: {} })).status, 429);
  assert.equal((await request(c, 'POST', '/paf/scores', { ip: '198.19.0.2', raw: '{bad' })).status, 400);
  await stop(c); fs.rmSync(c.dataDir, { recursive: true, force: true });
});
