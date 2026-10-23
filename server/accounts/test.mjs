import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';

import { createAccountsServer, normalizeScore, routePath } from './server.mjs';

let tmpDir, baseUrl, server, secret;
function listen(s) { return new Promise((r) => s.listen(0, '127.0.0.1', () => r(s.address().port))); }

before(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'm3d-acc-'));
  secret = '***' + Math.random().toString(36).slice(2);
  const app = createAccountsServer({ secret, dataDir: tmpDir, levelCount: 5, maxTotalTime: 3600, bodyLimit: 8192, ratePerMin: 1000 });
  server = app.server;
  baseUrl = `http://127.0.0.1:${await listen(server)}`;
});
after(async () => { await new Promise((r) => server.close(r)); fs.rmSync(tmpDir, { recursive: true, force: true }); });

async function req(method, p, { body, token, headers = {} } = {}) {
  const h = { ...headers };
  if (body !== undefined) h['Content-Type'] = 'application/json';
  if (token) h.Authorization = 'Bearer ' + token;
  const res = await fetch(baseUrl + p, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch {}
  return { status: res.status, json, text };
}

let userSeq = 0;
async function registerUser(namePrefix) {
  userSeq += 1;
  const username = `${namePrefix || '玩家'}${userSeq}${Math.random().toString(36).slice(2, 6)}`;
  const r = await req('POST', '/auth/register', { body: { username, password: 'secret123' } });
  return { username, ...r.json, raw: r };
}

describe('账号与排行', () => {
  test('health 与路由前缀', () => {
    assert.equal(routePath('/marmot3d-beta/api/leaderboard'), '/leaderboard');
    assert.equal(routePath('/api/auth/login'), '/auth/login');
  });

  test('注册成功并返回 token/user；重复用户名 409', async () => {
    const u = await registerUser('土拨');
    assert.ok(u.token); assert.equal(u.user.name, u.username);
    const dup = await req('POST', '/auth/register', { body: { username: u.username, password: 'secret123' } });
    assert.equal(dup.status, 409);
  });

  test('非法用户名/短密码 → 400', async () => {
    assert.equal((await req('POST', '/auth/register', { body: { username: 'a', password: 'secret123' } })).status, 400);
    assert.equal((await req('POST', '/auth/register', { body: { username: '正常名字', password: '123' } })).status, 400);
    assert.equal((await req('POST', '/auth/register', { body: { username: 'bad name!', password: 'secret123' } })).status, 400);
  });

  test('登录：正确通过、错误密码 401；/auth/me 校验令牌', async () => {
    const u = await registerUser('登录');
    const ok = await req('POST', '/auth/login', { body: { username: u.username, password: 'secret123' } });
    assert.equal(ok.status, 200); assert.ok(ok.json.token);
    assert.equal((await req('POST', '/auth/login', { body: { username: u.username, password: 'wrong' } })).status, 401);
    assert.equal((await req('GET', '/auth/me')).status, 401);
    const me = await req('GET', '/auth/me', { token: ok.json.token });
    assert.equal(me.status, 200); assert.equal(me.json.user.name, u.username);
  });

  test('未登录不能上报成绩', async () => {
    assert.equal((await req('POST', '/scores', { body: { kind: 'full', time: 100 } })).status, 401);
  });

  test('成绩校验：time 非正/超上限/level 越界/计数非法 → 400', () => {
    assert.match(normalizeScore({ kind: 'full', time: 0 }, 5, 3600).error || '', /time/);
    assert.match(normalizeScore({ kind: 'full', time: 99999 }, 5, 3600).error || '', /上限/);
    assert.match(normalizeScore({ kind: 'level', level: 9, time: 10 }, 5, 3600).error || '', /level/);
    assert.match(normalizeScore({ kind: 'level', level: 0, time: 10, hits: -1 }, 5, 3600).error || '', /hits/);
    assert.equal(normalizeScore({ kind: 'level', level: 2, time: 12.5, hits: 1 }, 5, 3600).ok, true);
  });

  test('上报后上榜；更慢的成绩不覆盖，更快的覆盖；榜单按用时升序', async () => {
    const a = await registerUser('甲');
    const b = await registerUser('乙');
    // 甲先报 100s，再报更慢 120s（拒绝），再报更快 90s（接受）
    await req('POST', '/scores', { token: a.token, body: { kind: 'full', time: 100, hits: 3, version: 'beta-rev17' } });
    const slower = await req('POST', '/scores', { token: a.token, body: { kind: 'full', time: 120 } });
    assert.equal(slower.json.accepted, false);
    const faster = await req('POST', '/scores', { token: a.token, body: { kind: 'full', time: 90 } });
    assert.equal(faster.json.accepted, true);
    // 乙报 95s
    await req('POST', '/scores', { token: b.token, body: { kind: 'full', time: 95 } });

    const board = await req('GET', '/leaderboard?kind=full');
    assert.equal(board.status, 200);
    assert.equal(board.json.total, 2);
    assert.equal(board.json.items[0].name, a.username); // 90s 第一
    assert.equal(board.json.items[0].time, 90);
    assert.equal(board.json.items[0].rank, 1);
    assert.equal(board.json.items[1].time, 95);
    const times = board.json.items.map((x) => x.time);
    assert.deepEqual(times, [...times].sort((x, y) => x - y));
  });

  test('单关榜相互隔离；level 越界 400', async () => {
    const a = await registerUser('单关');
    await req('POST', '/scores', { token: a.token, body: { kind: 'level', level: 0, time: 40 } });
    await req('POST', '/scores', { token: a.token, body: { kind: 'level', level: 1, time: 55 } });
    const l0 = await req('GET', '/leaderboard?kind=level&level=0');
    const l1 = await req('GET', '/leaderboard?kind=level&level=1');
    assert.equal(l0.json.total, 1); assert.equal(l0.json.items[0].time, 40);
    assert.equal(l1.json.total, 1); assert.equal(l1.json.items[0].time, 55);
    assert.equal((await req('GET', '/leaderboard?kind=level&level=99')).status, 400);
  });

  test('我的成绩：返回各关最佳与全通关时间', async () => {
    const a = await registerUser('我的');
    await req('POST', '/scores', { token: a.token, body: { kind: 'level', level: 0, time: 30 } });
    await req('POST', '/scores', { token: a.token, body: { kind: 'level', level: 0, time: 25 } });
    await req('POST', '/scores', { token: a.token, body: { kind: 'full', time: 300 } });
    const mine = await req('GET', '/scores/mine', { token: a.token });
    assert.equal(mine.status, 200);
    assert.equal(mine.json.levels[0], 25);
    assert.equal(mine.json.full, 300);
  });

  test('排行榜公开可读（无需令牌）', async () => {
    assert.equal((await req('GET', '/leaderboard?kind=full')).status, 200);
  });
});
