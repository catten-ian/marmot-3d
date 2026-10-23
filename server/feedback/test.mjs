import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';

import { createFeedbackServer, toCsv, FEEDBACK_TYPES } from './server.mjs';

let tmpDir;
let baseUrl;
let server;
let token;
let counter = 0;

function listen(srv) {
  return new Promise((resolve) => srv.listen(0, '127.0.0.1', () => resolve(srv.address().port)));
}

before(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'm3d-fb-'));
  token = 'test-admin-token-' + Math.random().toString(36).slice(2);
  const app = createFeedbackServer({
    token,
    dataDir: tmpDir,
    bodyLimit: 4096, // 小上限，便于测试 413
    ratePerMin: 3,   // 便于测试 429
  });
  server = app.server;
  const port = await listen(server);
  baseUrl = `http://127.0.0.1:${port}`;
});

after(async () => {
  await new Promise((r) => server.close(r));
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

async function req(method, p, opts = {}) {
  const { body, auth, headers = {}, raw = false } = opts;
  const h = { ...headers };
  if (body !== undefined) h['Content-Type'] = 'application/json';
  if (auth) h.Authorization = 'Bearer ' + auth;
  const res = await fetch(baseUrl + p, {
    method,
    headers: h,
    body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)),
  });
  const ct = res.headers.get('content-type') || '';
  if (raw) return { status: res.status, bytes: new Uint8Array(await res.arrayBuffer()), headers: res.headers };
  const text = await res.text();
  let json = null;
  if (ct.includes('application/json')) { try { json = JSON.parse(text); } catch { /* ignore */ } }
  return { status: res.status, text, json, headers: res.headers };
}

function fb(over = {}) {
  counter += 1;
  return {
    createdAt: new Date(Date.UTC(2026, 9, 1, 12, counter, 0)).toISOString(),
    type: '卡顿',
    description: `测试反馈 #${counter} ` + 'x'.repeat(4),
    installId: 'install-' + counter,
    version: 'dev',
    snapshot: { level: 1, ua: 'node-test' },
    ...over,
  };
}

describe('反馈收集服务', () => {
  test('health 免鉴权', async () => {
    const r = await req('GET', '/health');
    assert.equal(r.status, 200);
    assert.equal(r.json.ok, true);
  });

  test('无令牌 / 错令牌访问 list 返回 401', async () => {
    assert.equal((await req('GET', '/list')).status, 401);
    assert.equal((await req('GET', '/list', { auth: 'wrong' })).status, 401);
    assert.equal((await req('GET', '/stats', { auth: 'Bearer-ish' })).status, 401);
  });

  test('上报成功且可被 list 看到，字段完整', async () => {
    const payload = fb({ description: '画面在第3关卡顿明显' });
    const post = await req('POST', '/', { body: payload });
    assert.equal(post.status, 200);
    assert.ok(post.json.id);

    const list = await req('GET', '/list', { auth: token });
    assert.equal(list.status, 200);
    const found = list.json.items.find((x) => x.id === post.json.id);
    assert.ok(found, 'list 应包含刚上报的反馈');
    assert.equal(found.type, '卡顿');
    assert.equal(found.description, '画面在第3关卡顿明显');
    assert.equal(found.version, 'dev');
    assert.equal(found.installId, payload.installId);
    assert.equal(found.handled, false);
    assert.ok(found.serverReceivedAt);
    assert.deepEqual(found.snapshot, { level: 1, ua: 'node-test' });
  });

  test('非法 type / 空描述 / 超长描述 / snapshot 非对象 → 400', async () => {
    const r1 = await req('POST', '/', { body: fb({ type: '不存在' }), headers: { 'X-Forwarded-For': '10.9.9.1' } });
    assert.match(r1.json.error || '', /type/);
    const r2 = await req('POST', '/', { body: fb({ description: '   ' }), headers: { 'X-Forwarded-For': '10.9.9.2' } });
    assert.match(r2.json.error || '', /description/);
    const r3 = await req('POST', '/', { body: fb({ description: 'x'.repeat(2001) }), headers: { 'X-Forwarded-For': '10.9.9.3' } });
    assert.match(r3.json.error || '', /description/);
    const r4 = await req('POST', '/', { body: fb({ snapshot: [1, 2] }), headers: { 'X-Forwarded-For': '10.9.9.4' } });
    assert.match(r4.json.error || '', /snapshot/);
  });

  test('非法 JSON → 400', async () => {
    const r = await req('POST', '/', { body: '{not json', headers: { 'X-Forwarded-For': '10.8.8.1' } });
    assert.equal(r.status, 400);
  });

  test('超大 body → 413', async () => {
    const big = JSON.stringify(fb({ description: 'y'.repeat(5000) }));
    const r = await req('POST', '/', { body: big, headers: { 'X-Forwarded-For': '10.7.7.1' } });
    assert.equal(r.status, 413);
  });

  test('同一来源超过限流返回 429', async () => {
    const headers = { 'X-Forwarded-For': '10.6.6.6' };
    const codes = [];
    for (let i = 0; i < 4; i++) codes.push((await req('POST', '/', { body: fb(), headers })).status);
    assert.ok(codes.includes(429), `应出现 429，实际 ${codes.join(',')}`);
  });

  test('handled 标记并能按状态过滤', async () => {
    const created = await req('POST', '/', { body: fb({ type: '其他', description: '待处理项' }), headers: { 'X-Forwarded-For': '10.5.5.1' } });
    const id = created.json.id;
    const mark = await req('POST', `/${id}/handled`, { body: { handled: true }, auth: token });
    assert.equal(mark.status, 200);
    assert.equal(mark.json.handled, true);

    const open = await req('GET', '/list?handled=false', { auth: token });
    assert.ok(!open.json.items.some((x) => x.id === id), '未处理列表不应包含已处理项');
    const done = await req('GET', '/list?handled=true', { auth: token });
    assert.ok(done.json.items.some((x) => x.id === id), '已处理列表应包含该项');

    const undo = await req('POST', `/${id}/handled`, { body: { handled: false }, auth: token });
    assert.equal(undo.json.handled, false);
  });

  test('DELETE 删除后不再出现；不存在 id 返回 404', async () => {
    const created = await req('POST', '/', { body: fb({ description: '将被删除' }), headers: { 'X-Forwarded-For': '10.4.4.1' } });
    const id = created.json.id;
    assert.equal((await req('DELETE', `/${id}`, { auth: token })).status, 200);
    const list = await req('GET', '/list', { auth: token });
    assert.ok(!list.json.items.some((x) => x.id === id));
    assert.equal((await req('DELETE', `/${id}`, { auth: token })).status, 404);
  });

  test('筛选 type / version / q / month 生效', async () => {
    await req('POST', '/', { body: fb({ type: '显示异常', version: 'stable', description: '屏幕花屏特殊关键字ZZZ' }), headers: { 'X-Forwarded-For': '10.3.3.1' } });
    const byType = await req('GET', '/list?type=' + encodeURIComponent('显示异常'), { auth: token });
    assert.ok(byType.json.items.every((x) => x.type === '显示异常'));
    const byVer = await req('GET', '/list?version=stable', { auth: token });
    assert.ok(byVer.json.items.length >= 1 && byVer.json.items.every((x) => x.version === 'stable'));
    const byQ = await req('GET', '/list?q=' + encodeURIComponent('zzz'), { auth: token });
    assert.ok(byQ.json.items.length >= 1 && byQ.json.items.every((x) => /ZZZ/.test(x.description)));
    const byMonth = await req('GET', '/list?month=2026-10', { auth: token });
    assert.ok(byMonth.json.items.every((x) => String(x.createdAt).startsWith('2026-10')));
  });

  test('before 游标分页：newest 优先且第二页更早', async () => {
    for (let i = 0; i < 3; i++) {
      await req('POST', '/', { body: fb({ createdAt: new Date(Date.UTC(2026, 9, 2, i, 0, 0)).toISOString(), description: `分页 ${i}` }), headers: { 'X-Forwarded-For': `10.2.2.${i}` } });
    }
    const p1 = await req('GET', '/list?limit=2', { auth: token });
    assert.ok(p1.json.items.length <= 2);
    const t1 = p1.json.items.map((x) => x.createdAt);
    for (let i = 1; i < t1.length; i++) assert.ok(t1[i - 1] >= t1[i]);
    if (p1.json.nextCursor) {
      const p2 = await req('GET', `/list?limit=2&before=${encodeURIComponent(p1.json.nextCursor)}`, { auth: token });
      for (const it of p2.json.items) assert.ok(it.createdAt < p1.json.nextCursor, '第二页必须严格早于游标');
    }
  });

  test('导出 JSON 与 CSV（含表头/BOM/转义）', async () => {
    await req('POST', '/', { body: fb({ type: '操作手感', description: '含,逗号与"引号"\n换行' }), headers: { 'X-Forwarded-For': '10.1.1.1' } });

    const j = await req('GET', '/export?format=json', { auth: token });
    assert.equal(j.status, 200);
    assert.ok(j.json.items.length >= 1);
    assert.match(j.headers.get('content-disposition') || '', /feedback\.json/);
    assert.match(j.headers.get('content-type') || '', /application\/json/);

    const csvText = await req('GET', '/export?format=csv', { auth: token });
    assert.equal(csvText.status, 200);
    assert.match(csvText.headers.get('content-type') || '', /text\/csv/);
    // fetch.text() 会剥离 BOM，用字节流验证前 3 字节 EF BB BF。
    const csvRaw = await req('GET', '/export?format=csv', { auth: token, raw: true });
    assert.deepEqual([...csvRaw.bytes.slice(0, 3)], [0xef, 0xbb, 0xbf], 'CSV 应以 UTF-8 BOM 开头');
    const lines = csvText.text.split('\r\n');
    assert.equal(lines[0], 'createdAt,serverReceivedAt,type,version,installId,handled,description,snapshot');
    assert.ok(csvText.text.includes('"含,逗号与""引号""'), 'CSV 应正确转义逗号/引号');
  });

  test('stats 返回总量/未处理/按类型/近7·30天', async () => {
    const s = await req('GET', '/stats', { auth: token });
    assert.equal(s.status, 200);
    assert.ok(s.json.total >= 1);
    assert.equal(typeof s.json.open, 'number');
    for (const t of FEEDBACK_TYPES) assert.ok(t in s.json.byType, `stats.byType 缺 ${t}`);
    assert.ok(s.json.last7 >= 0 && s.json.last30 >= s.json.last7);
  });

  test('toCsv 单元：转义', () => {
    const out = toCsv([{ createdAt: 'a', serverReceivedAt: 'b', type: '卡顿', version: 'v', installId: 'i', handled: false, description: 'x,y', snapshot: {} }]);
    assert.ok(out.includes('"x,y"'));
  });

  test('错误长度/错误令牌均被拒，正确令牌通过', async () => {
    assert.equal((await req('GET', '/list', { auth: token + 'x' })).status, 401);
    assert.equal((await req('GET', '/list', { auth: token })).status, 200);
  });
});
