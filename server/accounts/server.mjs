#!/usr/bin/env node
/**
 * Marmot3D BETA 账号 + 排行榜后端（零第三方运行时依赖，仅 Node 内置模块）。
 *
 * 能力：
 *  - 用户名 + 密码注册/登录；密码用 scrypt 加盐哈希，绝不存明文。
 *  - 会话令牌 = base64url(payload).hmacSHA256(payload, SECRET)，服务端无状态校验，可失效。
 *  - 成绩上报（需登录）：单关最佳成绩榜 + 全通关竞速榜；每玩家仅保留最佳。
 *  - 排行榜与“我的成绩”公开可读（榜单），写操作必须登录。
 *
 * 存储：DATA_DIR 下 JSONL（accounts.jsonl / scores.jsonl），启动载入内存；
 *      分数仅追加（保留历史），读取时按玩家取最佳；账号文件在改密时原子重写。
 *
 * 环境变量：
 *  PORT(默认8095) HOST(默认127.0.0.1) DATA_DIR(默认 <repo>/data/accounts)
 *  M3D_ACCOUNTS_SECRET  令牌签名密钥（必填；缺失拒绝启动）
 *  BODY_LIMIT(默认16384) RATE_PER_MIN(默认60) LEVEL_COUNT(默认12)
 *  MAX_TOTAL_TIME(默认 86400 秒，防作弊上限)
 */
import http from 'node:http';
import crypto from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROUTE_PREFIXES = ['/marmot3d-beta/api', '/api'];
const USERNAME_RE = /^[\p{L}\p{N}_.\-]{2,16}$/u;

// ---------------- 工具 ----------------
function isObj(v) { return typeof v === 'object' && v !== null && !Array.isArray(v); }
function sendJson(res, status, obj, extra = {}) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra });
  res.end(body);
}
async function readBody(req, limit) {
  const chunks = []; let len = 0;
  for await (const c of req) { len += c.length; if (len > limit) return { tooLarge: true }; chunks.push(c); }
  return { raw: Buffer.concat(chunks), len };
}
function b64url(buf) { return Buffer.from(buf).toString('base64url'); }
function timingEqual(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
function clientIp(req) {
  return String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || 'unknown';
}
export function routePath(pathname) {
  for (const pre of ROUTE_PREFIXES) {
    if (pathname === pre || pathname.startsWith(pre + '/')) { const r = pathname.slice(pre.length) || '/'; return r.startsWith('/') ? r : '/' + r; }
  }
  return pathname.startsWith('/') ? pathname : '/' + pathname;
}

// ---------------- 密码 / 令牌 ----------------
function hashPassword(password, salt = crypto.randomBytes(16)) {
  const derived = crypto.scryptSync(String(password), salt, 64);
  return { salt: salt.toString('hex'), hash: derived.toString('hex') };
}
function verifyPassword(password, record) {
  const salt = Buffer.from(record.salt, 'hex');
  const derived = crypto.scryptSync(String(password), salt, 64);
  return timingEqual(derived.toString('hex'), record.hash);
}
function signToken(payloadB64, secret) {
  return crypto.createHmac('sha256', secret).update(payloadB64).digest('base64url');
}
function issueToken(user, secret) {
  const payload = b64url(JSON.stringify({ uid: user.id, name: user.name, iat: Date.now() }));
  return `${payload}.${signToken(payload, secret)}`;
}
function verifyToken(token, secret, users) {
  if (typeof token !== 'string' || !token.includes('.')) return null;
  const dot = token.lastIndexOf('.');
  const payloadB64 = token.slice(0, dot); const sig = token.slice(dot + 1);
  let payload;
  try { payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8')); } catch { return null; }
  if (!payload || !payload.uid || !timingEqual(sig, signToken(payloadB64, secret))) return null;
  const user = users.get(payload.uid);
  if (!user || user.name !== payload.name) return null; // 改名后旧令牌失效
  return user;
}

// ---------------- 存储 ----------------
function createStore(dataDir) {
  /** @type {Map<string, any>} */
  const users = new Map(); // id -> {id,name,salt,hash,createdAt}
  /** @type {Map<string, string>} 小写用户名 -> id */
  const nameIndex = new Map();
  /** @type {any[]} */
  const scores = [];
  const accFile = path.join(dataDir, 'accounts.jsonl');
  const scoreFile = path.join(dataDir, 'scores.jsonl');

  async function load() {
    await fsp.mkdir(dataDir, { recursive: true });
    const accText = await fsp.readFile(accFile, 'utf8').catch(() => '');
    for (const line of accText.split('\n')) {
      const s = line.trim(); if (!s) continue;
      try { const u = JSON.parse(s); if (u && u.id && u.name) { users.set(u.id, u); nameIndex.set(u.name.toLowerCase(), u.id); } } catch { /* skip */ }
    }
    const scoreText = await fsp.readFile(scoreFile, 'utf8').catch(() => '');
    for (const line of scoreText.split('\n')) {
      const s = line.trim(); if (!s) continue;
      try { const r = JSON.parse(s); if (r && r.uid && r.kind) scores.push(r); } catch { /* skip */ }
    }
  }
  async function appendAccount(u) { await fsp.appendFile(accFile, JSON.stringify(u) + '\n', 'utf8'); }
  async function rewriteAccounts() {
    const tmp = `${accFile}.tmp-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
    await fsp.writeFile(tmp, users.size ? [...users.values()].map((u) => JSON.stringify(u)).join('\n') + '\n' : '', 'utf8');
    await fsp.rename(tmp, accFile);
  }
  async function appendScore(r) { scores.push(r); await fsp.appendFile(scoreFile, JSON.stringify(r) + '\n', 'utf8'); }

  return { users, nameIndex, scores, load, appendAccount, rewriteAccounts, appendScore };
}

// ---------------- 限流 ----------------
function createRateLimiter(perMin) {
  /** @type {Map<string, number[]>} */ const buckets = new Map();
  return function allow(key) {
    const now = Date.now();
    const arr = (buckets.get(key) || []).filter((t) => now - t < 60000);
    if (arr.length >= perMin) { buckets.set(key, arr); return false; }
    arr.push(now); buckets.set(key, arr); return true;
  };
}

// ---------------- 成绩逻辑 ----------------
export function normalizeScore(body, levelCount, maxTotalTime) {
  if (!isObj(body)) return { error: '请求体必须是对象' };
  const kind = body.kind === 'full' ? 'full' : 'level';
  const time = Number(body.time);
  if (!Number.isFinite(time) || time <= 0) return { error: 'time 必须为正数（秒）' };
  if (time > maxTotalTime) return { error: 'time 超出合理上限' };
  const level = kind === 'level' ? Math.trunc(Number(body.level)) : -1;
  if (kind === 'level' && (!Number.isInteger(level) || level < 0 || level >= levelCount)) return { error: 'level 越界' };
  const ints = {};
  for (const k of ['hits', 'boosts', 'ultimates']) {
    if (body[k] === undefined || body[k] === null) { ints[k] = 0; continue; }
    const v = Math.trunc(Number(body[k]));
    if (!Number.isFinite(Number(body[k])) || v < 0 || v > 100000) return { error: `${k} 非法` };
    ints[k] = v;
  }
  const version = typeof body.version === 'string' ? body.version.slice(0, 40) : '';
  return { ok: true, value: { kind, level, time, ...ints, version } };
}

function bestPerPlayer(scores, kind, level = null) {
  const best = new Map(); // uid -> record
  for (const r of scores) {
    if (r.kind !== kind) continue;
    if (kind === 'level' && r.level !== level) continue;
    const cur = best.get(r.uid);
    if (!cur || r.time < cur.time) best.set(r.uid, r);
  }
  return best;
}

function decorate(list, store) {
  return list.map((r) => ({
    rank: 0, name: store.users.get(r.uid)?.name || '(已注销)',
    time: r.time, hits: r.hits, boosts: r.boosts, ultimates: r.ultimates,
    level: r.level, version: r.version, createdAt: r.createdAt,
  }));
}

// ---------------- HTTP 应用 ----------------
export function createAccountsServer(options = {}) {
  const secret = options.secret;
  const dataDir = options.dataDir;
  const bodyLimit = options.bodyLimit || 16384;
  const levelCount = options.levelCount || 12;
  const maxTotalTime = options.maxTotalTime || 86400;
  const store = createStore(dataDir);
  const limiter = createRateLimiter(options.ratePerMin || 60);
  const authLimiter = createRateLimiter(20); // 登录/注册更严格
  let loaded = null;

  function authUser(req) { return verifyToken((req.headers.authorization || '').replace(/^Bearer\s+/i, ''), secret, store.users); }

  const server = http.createServer(async (req, res) => {
    try {
      if (!loaded) loaded = store.load();
      await loaded;
      const url = new URL(req.url, 'http://localhost');
      const route = (routePath(url.pathname) || '/').replace(/\/+$/, '') || '/';
      if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
      if (route === '/health' && req.method === 'GET') return sendJson(res, 200, { ok: true });

      // ---------- 注册 ----------
      if (req.method === 'POST' && route === '/auth/register') {
        if (!authLimiter(clientIp(req))) return sendJson(res, 429, { error: '操作过于频繁，请稍后再试' });
        const read = await readBody(req, bodyLimit);
        if (read.tooLarge) return sendJson(res, 413, { error: 'body too large' });
        let body; try { body = JSON.parse(read.raw.toString('utf8') || '{}'); } catch { return sendJson(res, 400, { error: 'invalid JSON' }); }
        const name = typeof body.username === 'string' ? body.username.trim() : '';
        const password = typeof body.password === 'string' ? body.password : '';
        if (!USERNAME_RE.test(name)) return sendJson(res, 400, { error: '用户名需 2-16 位，可用中英文/数字/_.-' });
        if (password.length < 6 || password.length > 128) return sendJson(res, 400, { error: '密码至少 6 位' });
        if (store.nameIndex.has(name.toLowerCase())) return sendJson(res, 409, { error: '用户名已被占用' });
        const { salt, hash } = hashPassword(password);
        const user = { id: crypto.randomUUID(), name, salt, hash, createdAt: new Date().toISOString() };
        store.users.set(user.id, user); store.nameIndex.set(name.toLowerCase(), user.id);
        await store.appendAccount(user);
        return sendJson(res, 200, { token: issueToken(user, secret), user: { id: user.id, name: user.name } });
      }

      // ---------- 登录 ----------
      if (req.method === 'POST' && route === '/auth/login') {
        if (!authLimiter(clientIp(req))) return sendJson(res, 429, { error: '操作过于频繁，请稍后再试' });
        const read = await readBody(req, bodyLimit);
        if (read.tooLarge) return sendJson(res, 413, { error: 'body too large' });
        let body; try { body = JSON.parse(read.raw.toString('utf8') || '{}'); } catch { return sendJson(res, 400, { error: 'invalid JSON' }); }
        const name = typeof body.username === 'string' ? body.username.trim() : '';
        const password = typeof body.password === 'string' ? body.password : '';
        const uid = store.nameIndex.get(name.toLowerCase());
        const user = uid ? store.users.get(uid) : null;
        // 即使用户不存在也走一次 scrypt，降低用户名枚举的时序差异。
        const ok = user ? verifyPassword(password, user) : (hashPassword(password), false);
        if (!user || !ok) return sendJson(res, 401, { error: '用户名或密码错误' });
        return sendJson(res, 200, { token: issueToken(user, secret), user: { id: user.id, name: user.name } });
      }

      // ---------- 当前会话 ----------
      if (req.method === 'GET' && route === '/auth/me') {
        const user = authUser(req);
        if (!user) return sendJson(res, 401, { error: 'unauthorized' });
        return sendJson(res, 200, { user: { id: user.id, name: user.name } });
      }

      // ---------- 成绩上报（需登录）----------
      if (req.method === 'POST' && route === '/scores') {
        const user = authUser(req);
        if (!user) return sendJson(res, 401, { error: 'unauthorized' });
        if (!limiter('u:' + user.id)) return sendJson(res, 429, { error: '提交过于频繁' });
        const read = await readBody(req, bodyLimit);
        if (read.tooLarge) return sendJson(res, 413, { error: 'body too large' });
        let body; try { body = JSON.parse(read.raw.toString('utf8') || '{}'); } catch { return sendJson(res, 400, { error: 'invalid JSON' }); }
        const norm = normalizeScore(body, levelCount, maxTotalTime);
        if (norm.error) return sendJson(res, 400, { error: norm.error });
        const v = norm.value;
        // 该玩家该榜当前最佳：只有更快才接受（防重复/防回退刷屏）。
        const cur = bestPerPlayer(store.scores, v.kind, v.kind === 'level' ? v.level : null).get(user.id);
        if (cur && !(v.time < cur.time)) return sendJson(res, 200, { ok: true, accepted: false, best: cur.time, reason: 'not_better' });
        const rec = {
          id: crypto.randomUUID(), uid: user.id, kind: v.kind, level: v.level,
          time: Math.round(v.time * 1000) / 1000, hits: v.hits, boosts: v.boosts, ultimates: v.ultimates,
          version: v.version, createdAt: new Date().toISOString(),
        };
        await store.appendScore(rec);
        return sendJson(res, 200, { ok: true, accepted: true, best: rec.time });
      }

      // ---------- 排行榜（公开）----------
      if (req.method === 'GET' && route === '/leaderboard') {
        const sp = url.searchParams;
        const kind = sp.get('kind') === 'full' ? 'full' : 'level';
        let level = 0;
        if (kind === 'level') { level = Math.trunc(Number(sp.get('level') || 0)); if (!Number.isInteger(level) || level < 0 || level >= levelCount) return sendJson(res, 400, { error: 'level 越界' }); }
        let limit = Math.trunc(Number(sp.get('limit') || 50));
        if (!Number.isFinite(limit) || limit <= 0) limit = 50; limit = Math.min(200, limit);
        const best = [...bestPerPlayer(store.scores, kind, kind === 'level' ? level : null).values()]
          .sort((a, b) => (a.time - b.time) || a.createdAt.localeCompare(b.createdAt));
        const items = decorate(best.slice(0, limit), store);
        items.forEach((it, i) => { it.rank = i + 1; });
        return sendJson(res, 200, { kind, ...(kind === 'level' ? { level } : {}), total: best.length, items });
      }

      // ---------- 我的成绩（登录）----------
      if (req.method === 'GET' && route === '/scores/mine') {
        const user = authUser(req);
        if (!user) return sendJson(res, 401, { error: 'unauthorized' });
        const mine = store.scores.filter((r) => r.uid === user.id);
        const levels = {};
        for (let i = 0; i < levelCount; i++) {
          const b = bestPerPlayer(mine, 'level', i).get(user.id); if (b) levels[i] = b.time;
        }
        const full = bestPerPlayer(mine, 'full').get(user.id)?.time ?? null;
        return sendJson(res, 200, { levels, full });
      }

      return sendJson(res, 404, { error: 'not found' });
    } catch (e) {
      console.error('[accounts]', e);
      if (!res.headersSent) sendJson(res, 500, { error: 'internal error' });
    }
  });

  return { server, ready: () => loaded || Promise.resolve(), store };
}

// ---------------- 直接运行 ----------------
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const envObj = process.env;
  const secKey = 'M3D_' + 'ACCOUNTS_' + 'SECRET';
  const SECRET = envObj[secKey] ? String(envObj[secKey]).trim() : '';
  if (!SECRET) { console.error('[accounts] 拒绝启动：缺少环境变量 M3D_ACCOUNTS_SECRET。'); process.exit(1); }
  const HOST = process.env.HOST || '127.0.0.1';
  const PORT = Number(process.env.PORT || 8095);
  const DATA_DIR = process.env.DATA_DIR
    ? path.resolve(process.env.DATA_DIR)
    : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'data', 'accounts');
  const { server } = createAccountsServer({
    secret: SECRET, dataDir: DATA_DIR, bodyLimit: Math.max(2048, Number(process.env.BODY_LIMIT || 16384)),
    ratePerMin: Math.max(1, Number(process.env.RATE_PER_MIN || 60)),
    levelCount: Math.max(1, Number(process.env.LEVEL_COUNT || 12)),
    maxTotalTime: Math.max(60, Number(process.env.MAX_TOTAL_TIME || 86400)),
  });
  server.listen(PORT, HOST, () => console.log(`[accounts] listening on http://${HOST}:${PORT} data=${DATA_DIR}`));
  let down = false;
  const shutdown = () => { if (down) return; down = true; server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 1500).unref(); };
  process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
}
