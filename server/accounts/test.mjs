import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

import { createAccountsServer, normalizeScore, routePath, isValidConfigName } from './server.mjs';

let tmpDir, baseUrl, server, secret, app;
function listen(s) { return new Promise((r) => s.listen(0, '127.0.0.1', () => r(s.address().port))); }

before(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'm3d-acc-'));
  secret = '***' + Math.random().toString(36).slice(2);
  const legacySalt = '00112233445566778899aabbccddeeff';
  const legacy = {
    id: 'legacy-account-id', name: '旧账号', salt: legacySalt,
    hash: crypto.scryptSync('legacy123', Buffer.from(legacySalt, 'hex'), 64).toString('hex'),
    createdAt: '2020-01-01T00:00:00.000Z',
  };
  const persistedGuest = { id: 'persisted-guest-id', name: '游客-旧记录', guest: true, createdAt: '2020-01-02T00:00:00.000Z' };
  fs.writeFileSync(path.join(tmpDir, 'accounts.jsonl'), `${JSON.stringify(legacy)}\n${JSON.stringify(persistedGuest)}\n`);
  app = createAccountsServer({ secret, dataDir: tmpDir, levelCount: 5, maxTotalTime: 3600, bodyLimit: 8192, ratePerMin: 1000 });
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
  return { status: res.status, json, text, headers: Object.fromEntries(res.headers.entries()) };
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

  test('CORS 预检保留跨域方法与鉴权头', async () => {
    const preflight = await req('OPTIONS', '/auth/guest');
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers['access-control-allow-origin'], '*');
    assert.match(preflight.headers['access-control-allow-methods'], /OPTIONS/);
    assert.match(preflight.headers['access-control-allow-headers'], /Authorization/i);
    assert.equal((await req('GET', '/auth/me')).status, 401);
  });

  test('旧账号缺 guest 字段按正式账号兼容，持久化游客不进入 nameIndex', async () => {
    const login = await req('POST', '/auth/login', { body: { username: '旧账号', password: 'legacy123' } });
    assert.equal(login.status, 200);
    const me = await req('GET', '/auth/me', { token: login.json.token });
    assert.equal(me.status, 200);
    assert.equal(me.json.user.guest, false);
    assert.equal(app.store.nameIndex.get('旧账号'), 'legacy-account-id');
    assert.equal(app.store.nameIndex.has('游客-旧记录'), false);
    assert.equal(app.store.users.get('persisted-guest-id').guest, true);
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

  test('游客签发、单关最快成绩与升级账号：uid/成绩继承、改名、旧令牌失效、登录可用', async () => {
    const ip = { 'x-forwarded-for': '198.51.100.41' };
    const guest = await req('POST', '/auth/guest', { headers: ip });
    assert.equal(guest.status, 200);
    assert.ok(guest.json.token);
    assert.equal(guest.json.user.guest, true);
    assert.match(guest.json.user.name, /^游客-/);
    const oldToken = guest.json.token;
    const oldName = guest.json.user.name;
    const oldId = guest.json.user.id;

    const meGuest = await req('GET', '/auth/me', { token: oldToken });
    assert.equal(meGuest.status, 200);
    assert.equal(meGuest.json.user.guest, true);

    const first = await req('POST', '/scores', { token: oldToken, body: { kind: 'level', level: 0, time: 45 } });
    assert.equal(first.status, 200);
    assert.equal(first.json.accepted, true);
    const boardGuest = await req('GET', '/leaderboard?kind=level&level=0');
    const guestRow = boardGuest.json.items.find((item) => item.name === oldName);
    assert.ok(guestRow);
    assert.equal(guestRow.time, 45);
    const guestMine = await req('GET', '/scores/mine', { token: oldToken });
    assert.equal(guestMine.status, 200);
    assert.equal(guestMine.json.levels[0], 45);

    const slower = await req('POST', '/scores', { token: oldToken, body: { kind: 'level', level: 0, time: 50 } });
    assert.equal(slower.status, 200);
    assert.equal(slower.json.accepted, false);
    assert.equal(slower.json.best, 45);
    const boardBeforeUpgrade = await req('GET', '/leaderboard?kind=level&level=0');
    assert.equal(boardBeforeUpgrade.json.items.filter((item) => item.name === oldName).length, 1);
    assert.equal(boardBeforeUpgrade.json.items.find((item) => item.name === oldName).time, 45);

    const occupiedName = await registerUser('已占用');
    assert.equal((await req('POST', '/auth/upgrade', { token: oldToken, headers: { ...ip, 'x-forwarded-for': '198.51.100.42' }, body: { username: occupiedName.username, password: 'secret123' } })).status, 409);
    assert.equal((await req('POST', '/auth/upgrade', { token: oldToken, headers: { 'x-forwarded-for': '198.51.100.43' }, body: { username: 'x', password: 'secret123' } })).status, 400);
    assert.equal((await req('POST', '/auth/upgrade', { token: oldToken, headers: { 'x-forwarded-for': '198.51.100.44' }, body: { username: '非法短密测试', password: '123' } })).status, 400);
    assert.equal((await req('POST', '/auth/upgrade', { body: { username: '无令牌升级', password: 'secret123' } })).status, 401);
    assert.equal((await req('POST', '/auth/upgrade', { headers: { Authorization: oldToken, 'x-forwarded-for': '198.51.100.48' }, body: { username: '缺Bearer前缀', password: 'secret123' } })).status, 401);

    const username = `升级${Date.now().toString().slice(-8)}`;
    const upgraded = await req('POST', '/auth/upgrade', {
      token: oldToken, headers: { 'x-forwarded-for': '198.51.100.45' },
      body: { username, password: 'upgrade123' },
    });
    assert.equal(upgraded.status, 200);
    assert.equal(upgraded.json.user.id, oldId);
    assert.equal(upgraded.json.user.name, username);
    assert.equal(upgraded.json.user.guest, false);
    assert.ok(upgraded.json.token);
    const persistedUsers = fs.readFileSync(path.join(tmpDir, 'accounts.jsonl'), 'utf8').trim().split('\n').map((line) => JSON.parse(line));
    const persistedUpgrade = persistedUsers.find((record) => record.id === oldId);
    assert.equal(persistedUpgrade.name, username);
    assert.equal(persistedUpgrade.guest, false);
    assert.ok(persistedUpgrade.salt && persistedUpgrade.hash);

    const mine = await req('GET', '/scores/mine', { token: upgraded.json.token });
    assert.equal(mine.status, 200);
    assert.equal(mine.json.levels[0], 45);
    const boardAfterUpgrade = await req('GET', '/leaderboard?kind=level&level=0');
    const upgradedRow = boardAfterUpgrade.json.items.find((item) => item.name === username);
    assert.ok(upgradedRow);
    assert.equal(upgradedRow.time, 45);
    assert.equal(boardAfterUpgrade.json.items.some((item) => item.name === oldName), false);

    assert.equal((await req('GET', '/auth/me', { token: oldToken })).status, 401);
    assert.equal((await req('POST', '/scores', { token: oldToken, body: { kind: 'level', level: 0, time: 40 } })).status, 401);
    assert.equal((await req('POST', '/auth/upgrade', { token: upgraded.json.token, headers: { 'x-forwarded-for': '198.51.100.46' }, body: { username: '再次升级', password: 'upgrade123' } })).status, 400);

    const login = await req('POST', '/auth/login', {
      headers: { 'x-forwarded-for': '198.51.100.47' }, body: { username, password: 'upgrade123' },
    });
    assert.equal(login.status, 200);
    assert.equal(login.json.user.id, oldId);
    const mineAfterLogin = await req('GET', '/scores/mine', { token: login.json.token });
    assert.equal(mineAfterLogin.status, 200);
    assert.equal(mineAfterLogin.json.levels[0], 45);
  });

  test('游客签发按 IP 限流，超过默认阈值返回 429 中文错误', async () => {
    const headers = { 'x-forwarded-for': '198.51.100.99' };
    const results = [];
    for (let i = 0; i < 11; i++) results.push(await req('POST', '/auth/guest', { headers }));
    assert.ok(results.slice(0, 10).every((r) => r.status === 200));
    assert.equal(results[10].status, 429);
    assert.match(results[10].json.error, /游客/);
  });
});

describe('命名调参配置 /configs', () => {
  test('配置名校验：中英文/数字/连字符/下划线，1-50 位', () => {
    assert.equal(isValidConfigName('平衡方案-2026_v1'), true);
    assert.equal(isValidConfigName('  土拨鼠调参  '), true); // trim 后合法
    assert.equal(isValidConfigName('a'.repeat(50)), true);
    assert.equal(isValidConfigName('a'.repeat(51)), false);
    assert.equal(isValidConfigName(''), false);
    assert.equal(isValidConfigName('bad name!'), false);
    assert.equal(isValidConfigName('a/b'), false);
    assert.equal(isValidConfigName(123), false);
  });

  test('空列表；部署前缀 /marmot3d-beta/api 同样可达', async () => {
    const r1 = await req('GET', '/configs');
    assert.equal(r1.status, 200);
    assert.deepEqual(r1.json.configs, []);
    const r2 = await req('GET', '/marmot3d-beta/api/configs');
    assert.equal(r2.status, 200);
    assert.deepEqual(r2.json.configs, []);
  });

  test('当前生效配置独立槽位读写，不出现在命名列表', async () => {
    assert.equal((await req('GET', '/configs/active')).status, 404);
    const set = await req('POST', '/configs/active', { body: { name: '方案-active', config: { schemaVersion: 1, values: { moveSpeedMul: 1.2 } } } });
    assert.equal(set.status, 200);
    const active = await req('GET', '/configs/active');
    assert.equal(active.status, 200);
    assert.equal(active.json.config.values.moveSpeedMul, 1.2);
    assert.equal((await req('GET', '/configs')).json.configs.some((x) => x.name === '__active__'), false);
  });

  test('保存→列表→读取往返；中文名字走 URL 编码', async () => {
    const config = { schemaVersion: 1, app: 'marmot3d-beta-admin', values: { 'player.speed': 8.5, 'beta.flowerInstant': false } };
    const saved = await req('POST', '/configs', { body: { name: '  啃草方案_v1  ', config } });
    assert.equal(saved.status, 200);
    assert.equal(saved.json.ok, true);
    assert.equal(saved.json.name, '啃草方案_v1'); // 服务端 trim
    assert.equal(saved.json.size, Buffer.byteLength(JSON.stringify(config)));
    assert.ok(saved.json.updatedAt);

    const list = await req('GET', '/configs');
    assert.equal(list.json.configs.length, 1);
    assert.equal(list.json.configs[0].name, '啃草方案_v1');
    assert.equal(list.json.configs[0].size, saved.json.size);
    assert.equal(list.json.configs[0].config, undefined); // 列表不带 config 本体

    const one = await req('GET', `/configs/${encodeURIComponent('啃草方案_v1')}`);
    assert.equal(one.status, 200);
    assert.equal(one.json.name, '啃草方案_v1');
    assert.deepEqual(one.json.config, config);
  });

  test('同名覆盖：内容与 updatedAt 更新，列表仍只有一条', async () => {
    const first = await req('GET', '/configs/配置-cover');
    const c1 = { schemaVersion: 1, values: { a: 1 } };
    const r1 = await req('POST', '/configs', { body: { name: '配置-cover', config: c1 } });
    assert.equal(r1.status, 200);
    await new Promise((r) => setTimeout(r, 20));
    const c2 = { schemaVersion: 1, values: { a: 2, b: 'x'.repeat(200) } };
    const r2 = await req('POST', '/configs', { body: { name: '配置-cover', config: c2 } });
    assert.equal(r2.status, 200);
    assert.ok(r2.json.updatedAt >= r1.json.updatedAt);
    assert.notEqual(r2.json.updatedAt, r1.json.updatedAt);
    assert.ok(r2.json.size > r1.json.size);
    const list = await req('GET', '/configs');
    assert.equal(list.json.configs.filter((x) => x.name === '配置-cover').length, 1);
    const one = await req('GET', '/configs/配置-cover');
    assert.deepEqual(one.json.config, c2);
    assert.equal(first.status, 404); // 保存前不存在
  });

  test('非法名字 / config 非对象 / 非法 JSON → 4xx', async () => {
    assert.equal((await req('POST', '/configs', { body: { name: '', config: {} } })).status, 400);
    assert.equal((await req('POST', '/configs', { body: { name: 'bad/name', config: {} } })).status, 400);
    assert.equal((await req('POST', '/configs', { body: { name: 'x'.repeat(51), config: {} } })).status, 400);
    assert.equal((await req('POST', '/configs', { body: { name: 'no-config' } })).status, 400);
    assert.equal((await req('GET', '/configs/a%ZZ')).status, 400); // 未转义保留字符
    const badJson = await fetch(baseUrl + '/configs', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{not-json',
    });
    assert.equal(badJson.status, 400);
  });

  test('config 超过 100KB → 413', async () => {
    const big = { schemaVersion: 1, values: { blob: 'x'.repeat(100 * 1024 + 100) } };
    const r = await req('POST', '/configs', { body: { name: '超大配置', config: big } });
    assert.equal(r.status, 413);
    assert.match(r.json.error, /100KB|过大|大/);
    // 被拒绝的配置不落盘
    assert.equal((await req('GET', '/configs/超大配置')).status, 404);
  });

  test('DELETE 幂等：不存在也 ok；删除后读取 404、列表消失', async () => {
    const missing = await req('DELETE', '/configs/从不存在');
    assert.equal(missing.status, 200);
    assert.equal(missing.json.ok, true);
    assert.equal(missing.json.deleted, false);

    await req('POST', '/configs', { body: { name: '删除我', config: { schemaVersion: 1, values: {} } } });
    const del = await req('DELETE', '/configs/删除我');
    assert.equal(del.status, 200);
    assert.equal(del.json.deleted, true);
    assert.equal((await req('GET', '/configs/删除我')).status, 404);
    const again = await req('DELETE', '/configs/删除我');
    assert.equal(again.status, 200);
    assert.equal(again.json.deleted, false);
    const list = await req('GET', '/configs');
    assert.equal(list.json.configs.some((x) => x.name === '删除我'), false);
    // 之前保存的另一条仍在
    assert.ok(list.json.configs.some((x) => x.name === '配置-cover'));
  });

  test('列表按 updatedAt 倒序', async () => {
    const list = await req('GET', '/configs');
    const times = list.json.configs.map((x) => x.updatedAt);
    assert.deepEqual(times, [...times].sort().reverse());
  });

  test('CORS 预检允许 DELETE', async () => {
    const pre = await req('OPTIONS', '/configs');
    assert.equal(pre.status, 204);
    assert.match(pre.headers['access-control-allow-methods'], /DELETE/);
  });

  test('持久化到 configs.jsonl，重启后同名记录以最后一行生效', async () => {
    const file = path.join(tmpDir, 'configs.jsonl');
    assert.ok(fs.existsSync(file));
    const lines = fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
    assert.ok(lines.some((r) => r.name === '配置-cover'));
    // 手工追加一条同名旧内容，验证“后写覆盖”的载入策略与历史追加兼容。
    fs.appendFileSync(file, JSON.stringify({ name: '配置-cover', config: { schemaVersion: 1, values: { stale: true } }, updatedAt: '2000-01-01T00:00:00.000Z' }) + '\n');
    const app2 = createAccountsServer({ secret, dataDir: tmpDir, levelCount: 5, maxTotalTime: 3600, bodyLimit: 8192, ratePerMin: 1000 });
    const s2 = app2.server;
    const port2 = await new Promise((r) => s2.listen(0, '127.0.0.1', () => r(s2.address().port)));
    try {
      const res = await fetch(`http://127.0.0.1:${port2}/configs/配置-cover`);
      const json = await res.json();
      assert.equal(res.status, 200);
      assert.equal(json.config.values.stale, true); // 最后一行生效
    } finally {
      await new Promise((r) => s2.close(r));
    }
  });
});
