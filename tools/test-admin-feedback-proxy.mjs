import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createAccountsServer } from '../server/accounts/server.mjs';

const listen = (server) => new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
const close = (server) => new Promise((resolve) => server.close(resolve));
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'm3d-feedback-proxy-test-'));
const feedbackToken = `test-feedback-${crypto.randomBytes(24).toString('hex')}`;
const password = `test-only-${crypto.randomBytes(18).toString('hex')}`;
let accounts, mock, baseUrl, sessionToken;
let mockMode = 'normal';
const requests = [];

before(async () => {
  mock = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    requests.push({ path: url.pathname, query: Object.fromEntries(url.searchParams), authorization: req.headers.authorization });
    res.setHeader('Content-Type', 'application/json');
    if (req.headers.authorization !== `Bearer ${feedbackToken}`) {
      res.writeHead(401); return res.end(JSON.stringify({ error: 'unauthorized' }));
    }
    if (mockMode === 'timeout') return;
    if (mockMode === '503') {
      res.writeHead(503); return res.end(JSON.stringify({ error: feedbackToken }));
    }
    if (url.pathname === '/stats') {
      res.writeHead(200); return res.end(JSON.stringify({ total: 1, open: 1, byType: { 卡顿: 1 } }));
    }
    res.writeHead(200);
    res.end(JSON.stringify({ items: [{ id: 'one', createdAt: '2026-10-25T00:00:00.000Z', type: '卡顿', description: '临时 mock 反馈', version: 'beta-test', handled: false, snapshot: { level: 2 } }], total: 1, nextCursor: null }));
  });
  const feedbackUrl = `http://127.0.0.1:${await listen(mock)}`;
  const app = createAccountsServer({ secret: `test-accounts-${crypto.randomBytes(24).toString('hex')}`, dataDir: tmpDir, feedbackUrl, feedbackToken, feedbackTimeoutMs: 100 });
  accounts = app.server;
  baseUrl = `http://127.0.0.1:${await listen(accounts)}`;
  const register = await request('/auth/register', { method: 'POST', body: { username: 'catten', password } });
  assert.equal(register.status, 200);
  sessionToken = register.json.token;
});

after(async () => {
  if (accounts) await close(accounts);
  if (mock) {
    mock.closeAllConnections?.();
    await close(mock);
  }
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

async function request(pathname, { method = 'GET', token = '', body, timeoutMs = 2000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(baseUrl + pathname, {
      method, signal: controller.signal,
      headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await response.text();
    let json = null; try { json = JSON.parse(text); } catch { /* tested by assertions */ }
    return { status: response.status, text, json };
  } finally { clearTimeout(timer); }
}

test('未登录和错误账号均为 401，且不会访问下游', async () => {
  const beforeCount = requests.length;
  assert.equal((await request('/admin/feedback/list')).status, 401);
  assert.equal((await request('/admin/feedback/stats', { token: 'invalid.test.token' })).status, 401);
  const wrongLogin = await request('/auth/login', { method: 'POST', body: { username: 'catten', password: 'definitely-wrong-test-password' } });
  assert.equal(wrongLogin.status, 401);
  assert.equal(requests.length, beforeCount);
});

test('登录后通过部署前缀代理列表和统计，只转发白名单参数', async () => {
  const login = await request('/auth/login', { method: 'POST', body: { username: 'catten', password } });
  assert.equal(login.status, 200);
  assert.ok(login.json.token);
  const list = await request('/marmot3d-beta/api/admin/feedback/list?limit=25&handled=false&format=csv&authorization=bad', { token: login.json.token });
  assert.equal(list.status, 200);
  assert.equal(list.json.items[0].description, '临时 mock 反馈');
  assert.equal(list.text.includes(feedbackToken), false);
  const stats = await request('/marmot3d-beta/api/admin/feedback/stats?limit=200', { token: sessionToken });
  assert.equal(stats.status, 200);
  assert.equal(stats.json.total, 1);
  const last = requests.at(-2);
  assert.equal(last.path, '/list');
  assert.deepEqual(last.query, { limit: '25', handled: 'false' });
  assert.equal(last.authorization, `Bearer ${feedbackToken}`);
  assert.deepEqual(requests.at(-1).query, {});
});

test('下游 503、超时与缺少配置均 fail-soft，内部 token 不出现在响应', async () => {
  mockMode = '503';
  const down = await request('/admin/feedback/list?downstream=503', { token: sessionToken });
  mockMode = 'normal';
  assert.equal(down.status, 503);
  assert.equal(down.text.includes(feedbackToken), false);

  try {
    mockMode = 'timeout';
    const timeout = await request('/admin/feedback/stats', { token: sessionToken });
    assert.equal(timeout.status, 503);
    assert.equal(timeout.json.code, 'feedback_timeout');
    assert.equal(timeout.text.includes(feedbackToken), false);
  } finally {
    mockMode = 'normal';
  }

  const missingDir = fs.mkdtempSync(path.join(os.tmpdir(), 'm3d-feedback-missing-test-'));
  const missing = createAccountsServer({ secret: 'temporary-test-signing-secret', dataDir: missingDir, feedbackToken: '' }).server;
  const port = await listen(missing);
  try {
    const response = await fetch(`http://127.0.0.1:${port}/admin/feedback/list`, { headers: { Authorization: `Bearer ${sessionToken}` } });
    assert.equal(response.status, 401); // 另一个签名密钥下不能复用会话。
  } finally {
    await close(missing);
    fs.rmSync(missingDir, { recursive: true, force: true });
  }
});

test('已登录但代理未配置时明确返回 503', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'm3d-feedback-unconfigured-test-'));
  const app = createAccountsServer({ secret: 'temporary-unconfigured-signing-secret', dataDir, feedbackToken: '' });
  const port = await listen(app.server);
  const localBase = `http://127.0.0.1:${port}`;
  try {
    const registration = await fetch(localBase + '/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'tester', password: 'temporary-password' }) });
    const account = await registration.json();
    const response = await fetch(localBase + '/admin/feedback/list', { headers: { Authorization: `Bearer ${account.token}` } });
    assert.equal(response.status, 503);
    const data = await response.json();
    assert.equal(data.code, 'feedback_not_configured');
    assert.match(data.error, /M3D_FEEDBACK_TOKEN/);
  } finally {
    await close(app.server);
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
