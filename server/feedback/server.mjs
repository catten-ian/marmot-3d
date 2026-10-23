#!/usr/bin/env node
/**
 * Marmot3D 玩家反馈收集服务（零第三方运行时依赖，仅 Node 内置模块）。
 *
 * 设计要点：
 *  - 上报公开（严格校验 + 按来源指纹限流）；查看/处理/导出需管理令牌（Bearer）。
 *  - 数据按自然月分片为 JSONL（DATA_DIR/feedback-YYYY-MM.jsonl），一行一条；
 *    追加写入，删除/标记处理通过「写临时文件 + rename」原子重写该月文件。
 *  - 不记录原始 IP：仅用「每日随机盐 + IP」的 sha256 指纹做内存限流，不落盘。
 *
 * 环境变量（直接运行时）：
 *  PORT                 监听端口，默认 8094
 *  HOST                 监听地址，默认 127.0.0.1（建议由 Caddy 反代）
 *  M3D_FEEDBACK_TOKEN   管理令牌（必填，缺失则拒绝启动）
 *  DATA_DIR             数据目录，默认 <repo>/data/feedback
 *  BODY_LIMIT           上报 body 字节上限，默认 32768
 *  RATE_PER_MIN         每个来源指纹每分钟最多上报条数，默认 10
 */
import http from 'node:http';
import crypto from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const FEEDBACK_TYPES = ['卡顿', '显示异常', '操作手感', '关卡数值', '其他'];
const ROUTE_PREFIXES = ['/marmot3d/api/feedback', '/api/feedback', '/feedback'];

// ---------------- 纯工具 ----------------
function isPlainObject(v) { return typeof v === 'object' && v !== null && !Array.isArray(v); }
function monthOf(iso) {
  const m = String(iso || '').slice(0, 7);
  return /^\d{4}-\d{2}$/.test(m) ? m : null;
}
function timingSafeEqualToken(provided, token) {
  if (typeof provided !== 'string' || !provided.startsWith('Bearer ')) return false;
  const got = Buffer.from(provided.slice(7).trim());
  const want = Buffer.from(token);
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}
function clientIp(req) {
  const xff = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return xff || req.socket.remoteAddress || 'unknown';
}
/** 去掉已知路由前缀，返回 '/' 开头的子路径。 */
export function routePath(pathname) {
  let rest = pathname;
  for (const pre of ROUTE_PREFIXES) {
    if (pathname === pre || pathname.startsWith(pre + '/')) { rest = pathname.slice(pre.length) || '/'; break; }
  }
  if (!rest.startsWith('/')) rest = '/' + rest;
  return rest;
}
function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}
async function readBody(req, limit) {
  const chunks = []; let len = 0;
  for await (const c of req) {
    len += c.length;
    if (len > limit) return { tooLarge: true };
    chunks.push(c);
  }
  return { raw: Buffer.concat(chunks), len };
}

// ---------------- 业务逻辑（与传输解耦，便于测试） ----------------
function validateFeedback(body, rawLen, bodyLimit) {
  if (!isPlainObject(body)) return { error: '请求体必须是 JSON 对象' };
  if (rawLen > bodyLimit) return { error: 'body too large', status: 413 };
  if (!FEEDBACK_TYPES.includes(body.type)) return { error: '非法的 type' };
  const description = typeof body.description === 'string' ? body.description.trim() : '';
  if (!description) return { error: 'description 必填' };
  if (description.length > 2000) return { error: 'description 过长' };
  if (body.snapshot !== undefined && body.snapshot !== null && !isPlainObject(body.snapshot)) return { error: 'snapshot 必须是对象' };
  if (body.installId !== undefined && (typeof body.installId !== 'string' || body.installId.length > 64)) return { error: 'installId 非法' };
  if (body.version !== undefined && (typeof body.version !== 'string' || body.version.length > 40)) return { error: 'version 非法' };
  if (body.createdAt !== undefined && (typeof body.createdAt !== 'string' || Number.isNaN(Date.parse(body.createdAt)))) return { error: 'createdAt 非法' };
  return { ok: true };
}
function versionOf(body) {
  const candidates = [body.version, isPlainObject(body.snapshot) ? body.snapshot.version : ''];
  for (const c of candidates) if (typeof c === 'string' && c.trim()) return c.trim().slice(0, 40);
  return '';
}
function buildRecord(body) {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    createdAt: typeof body.createdAt === 'string' && body.createdAt ? body.createdAt : now,
    serverReceivedAt: now,
    type: body.type,
    description: body.description.trim(),
    version: versionOf(body),
    installId: typeof body.installId === 'string' ? body.installId.slice(0, 64) : '',
    handled: false,
    snapshot: isPlainObject(body.snapshot) ? body.snapshot : {},
  };
}
function allSorted(records) {
  return [...records.values()].sort((a, b) =>
    (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : (a.id < b.id ? 1 : -1)));
}
function applyFilters(list, params) {
  let out = list;
  if (params.type) out = out.filter((r) => r.type === params.type);
  if (params.version) out = out.filter((r) => r.version === params.version);
  if (params.handled === 'true') out = out.filter((r) => r.handled);
  else if (params.handled === 'false') out = out.filter((r) => !r.handled);
  if (params.month && /^\d{4}-\d{2}$/.test(params.month)) out = out.filter((r) => (monthOf(r.createdAt) || monthOf(r.serverReceivedAt)) === params.month);
  if (params.q) { const n = params.q.toLowerCase(); out = out.filter((r) => r.description.toLowerCase().includes(n)); }
  return out;
}
function countsOf(list) {
  const byType = {}; const handled = { handled: 0, open: 0 };
  for (const r of list) { byType[r.type] = (byType[r.type] || 0) + 1; if (r.handled) handled.handled++; else handled.open++; }
  return { byType, byHandled: handled, total: list.length };
}
function statsOf(records) {
  const all = allSorted(records);
  const now = Date.now(); const day = 86400000;
  const within = (r, d) => now - Date.parse(r.serverReceivedAt || r.createdAt) <= d * day;
  const byVersion = {};
  for (const r of all) { const v = r.version || '(unknown)'; byVersion[v] = (byVersion[v] || 0) + 1; }
  return {
    total: all.length,
    open: all.filter((r) => !r.handled).length,
    byType: FEEDBACK_TYPES.reduce((acc, t) => { acc[t] = all.filter((r) => r.type === t).length; return acc; }, {}),
    byVersion,
    last7: all.filter((r) => within(r, 7)).length,
    last30: all.filter((r) => within(r, 30)).length,
  };
}
function csvCell(v) {
  const s = v == null ? '' : String(v);
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
export function toCsv(list) {
  const header = ['createdAt', 'serverReceivedAt', 'type', 'version', 'installId', 'handled', 'description', 'snapshot'];
  const rows = list.map((r) => [
    r.createdAt, r.serverReceivedAt, r.type, r.version, r.installId, r.handled ? '1' : '0',
    r.description, JSON.stringify(r.snapshot || {}),
  ].map(csvCell).join(','));
  return '﻿' + [header.join(','), ...rows].join('\r\n');
}

// ---------------- 存储 ----------------
function createStore(dataDir) {
  /** @type {Map<string, any>} */
  const records = new Map();
  const fileForMonth = (month) => path.join(dataDir, `feedback-${month}.jsonl`);
  async function load() {
    await fsp.mkdir(dataDir, { recursive: true });
    const names = await fsp.readdir(dataDir).catch(() => []);
    for (const name of names) {
      if (!/^feedback-\d{4}-\d{2}\.jsonl$/.test(name)) continue;
      const text = await fsp.readFile(path.join(dataDir, name), 'utf8').catch(() => '');
      for (const line of text.split('\n')) {
        const s = line.trim(); if (!s) continue;
        try { const rec = JSON.parse(s); if (rec && rec.id) records.set(rec.id, rec); } catch { /* 跳过坏行 */ }
      }
    }
  }
  async function append(rec) {
    const month = monthOf(rec.serverReceivedAt) || monthOf(rec.createdAt);
    if (!month) throw new Error('bad month');
    await fsp.appendFile(fileForMonth(month), JSON.stringify(rec) + '\n', 'utf8');
  }
  async function rewriteMonth(month) {
    const file = fileForMonth(month);
    const tmp = `${file}.tmp-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
    const lines = [];
    for (const rec of records.values()) {
      if ((monthOf(rec.serverReceivedAt) || monthOf(rec.createdAt)) === month) lines.push(JSON.stringify(rec));
    }
    await fsp.writeFile(tmp, lines.length ? lines.join('\n') + '\n' : '', 'utf8');
    await fsp.rename(tmp, file);
  }
  return { records, load, append, rewriteMonth };
}

// ---------------- 限流（仅内存，指纹不落盘） ----------------
function createRateLimiter(perMin) {
  let salt = crypto.randomBytes(16).toString('hex');
  let saltDay = new Date().toISOString().slice(0, 10);
  /** @type {Map<string, number[]>} */
  const buckets = new Map();
  return function allow(ip) {
    const today = new Date().toISOString().slice(0, 10);
    if (today !== saltDay) { saltDay = today; salt = crypto.randomBytes(16).toString('hex'); buckets.clear(); }
    const fp = crypto.createHash('sha256').update(salt + '|' + ip).digest('hex');
    const now = Date.now();
    const arr = (buckets.get(fp) || []).filter((t) => now - t < 60000);
    if (arr.length >= perMin) { buckets.set(fp, arr); return false; }
    arr.push(now); buckets.set(fp, arr); return true;
  };
}

// ---------------- HTTP 应用/服务器 ----------------
export function createFeedbackServer(options = {}) {
  const token = options.token;
  const dataDir = options.dataDir;
  const bodyLimit = options.bodyLimit || 32768;
  const store = createStore(dataDir);
  const limiter = createRateLimiter(options.ratePerMin || 10);
  let loaded = null;

  const server = http.createServer(async (req, res) => {
    try {
      if (!loaded) loaded = store.load();
      await loaded;
      const url = new URL(req.url, 'http://localhost');
      const route = (routePath(url.pathname) || '/').replace(/\/+$/, '') || '/';
      const authed = timingSafeEqualToken(req.headers.authorization || '', token);

      if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
      if (route === '/health' && req.method === 'GET') return sendJson(res, 200, { ok: true });

      // —— 公开上报 ——
      if (req.method === 'POST' && route === '/') {
        if (!limiter(clientIp(req))) return sendJson(res, 429, { error: 'rate limited' });
        const read = await readBody(req, bodyLimit);
        if (read.tooLarge) return sendJson(res, 413, { error: 'body too large' });
        let body;
        try { body = JSON.parse(read.raw.toString('utf8') || '{}'); }
        catch { return sendJson(res, 400, { error: 'invalid JSON' }); }
        const check = validateFeedback(body, read.len, bodyLimit);
        if (check.error) return sendJson(res, check.status || 400, { error: check.error });
        const rec = buildRecord(body);
        await store.append(rec); store.records.set(rec.id, rec);
        return sendJson(res, 200, { ok: true, id: rec.id });
      }

      // —— 以下均为管理接口 ——
      if (!authed) return sendJson(res, 401, { error: 'unauthorized' });

      if (req.method === 'GET' && route === '/stats') return sendJson(res, 200, statsOf(store.records));

      if (req.method === 'GET' && route === '/list') {
        const sp = url.searchParams;
        const params = {
          type: sp.get('type') || '', version: sp.get('version') || '', q: sp.get('q') || '',
          handled: sp.get('handled') || '', month: sp.get('month') || '',
        };
        const matched = applyFilters(allSorted(store.records), params);
        let limit = Number(sp.get('limit') || 50);
        if (!Number.isFinite(limit) || limit <= 0) limit = 50;
        limit = Math.min(200, Math.floor(limit));
        const before = sp.get('before');
        const paged = before && !Number.isNaN(Date.parse(before)) ? matched.filter((r) => r.createdAt < before) : matched;
        const items = paged.slice(0, limit);
        return sendJson(res, 200, {
          items, total: matched.length,
          nextCursor: items.length === limit && items[items.length - 1] ? items[items.length - 1].createdAt : null,
          counts: countsOf(matched),
        });
      }

      if (req.method === 'GET' && route === '/export') {
        const params = Object.fromEntries(url.searchParams);
        const list = applyFilters(allSorted(store.records), params);
        if (url.searchParams.get('format') === 'csv') {
          res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="feedback.csv"', 'Cache-Control': 'no-store' });
          return res.end(toCsv(list));
        }
        const body = JSON.stringify({ exportedAt: new Date().toISOString(), count: list.length, items: list }, null, 2);
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': 'attachment; filename="feedback.json"', 'Cache-Control': 'no-store' });
        return res.end(body);
      }

      const handledMatch = route.match(/^\/([^/]+)\/handled$/);
      if (req.method === 'POST' && handledMatch) {
        const rec = store.records.get(handledMatch[1]);
        if (!rec) return sendJson(res, 404, { error: 'not found' });
        const read = await readBody(req, 4096);
        let body = {}; try { body = JSON.parse(read.raw.toString('utf8') || '{}'); } catch { /* 空 body 视为 false */ }
        rec.handled = !!body.handled;
        await store.rewriteMonth(monthOf(rec.serverReceivedAt) || monthOf(rec.createdAt));
        return sendJson(res, 200, { ok: true, id: rec.id, handled: rec.handled });
      }
      if (req.method === 'DELETE' && /^\/[^/]+$/.test(route)) {
        const id = route.slice(1);
        const rec = store.records.get(id);
        if (!rec) return sendJson(res, 404, { error: 'not found' });
        const month = monthOf(rec.serverReceivedAt) || monthOf(rec.createdAt);
        store.records.delete(id); await store.rewriteMonth(month);
        return sendJson(res, 200, { ok: true, id });
      }

      return sendJson(res, 404, { error: 'not found' });
    } catch (e) {
      console.error('[feedback]', e);
      if (!res.headersSent) sendJson(res, 500, { error: 'internal error' });
    }
  });

  return { server, ready: () => (loaded || Promise.resolve()), store };
}

// ---------------- 直接运行 ----------------
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const TOKEN = process.env['M3D_FEEDBACK_' + 'TOKEN'] && String(process.env['M3D_FEEDBACK_' + 'TOKEN']).trim();
  if (!TOKEN) {
    console.error('[feedback] 拒绝启动：缺少环境变量 M3D_FEEDBACK_TOKEN（管理令牌）。');
    process.exit(1);
  }
  const HOST = process.env.HOST || '127.0.0.1';
  const PORT = Number(process.env.PORT || 8094);
  const DATA_DIR = process.env.DATA_DIR
    ? path.resolve(process.env.DATA_DIR)
    : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'data', 'feedback');
  const { server } = createFeedbackServer({
    token: TOKEN, dataDir: DATA_DIR,
    bodyLimit: Math.max(1024, Number(process.env.BODY_LIMIT || 32768)),
    ratePerMin: Math.max(1, Number(process.env.RATE_PER_MIN || 10)),
  });
  server.listen(PORT, HOST, () => console.log(`[feedback] listening on http://${HOST}:${PORT} data=${DATA_DIR}`));
  let shuttingDown = false;
  const shutdown = () => { if (shuttingDown) return; shuttingDown = true; server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 1500).unref(); };
  process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
}
