#!/usr/bin/env node
/**
 * Marmot3D BETA 账号 + 排行榜后端（零第三方运行时依赖，仅 Node 内置模块）。
 *
 * 能力：
 *  - 用户名 + 密码注册/登录；密码用 scrypt 加盐哈希，绝不存明文。
 *  - 会话令牌 = base64url(payload).hmacSHA256(payload, SECRET)，服务端无状态校验，可失效。
 *  - 游客可直接游玩并上报单关最佳；游客可升级为账号并继承同 uid 成绩。
 *  - 成绩上报：单关最佳成绩榜 + 全通关竞速榜兼容；每玩家仅保留最佳。
 *  - 排行榜公开可读；“我的成绩”和上报仅需有效令牌（游客或正式账号）。
 *  - Beta 后台命名调参配置：保存/列表/读取/删除（configs.jsonl，同名覆盖）。
 *  - Beta 后台用户反馈：账号会话鉴权后，由服务端代理反馈管理接口；内部令牌不下发。
 *
 * 存储：DATA_DIR 下 JSONL（accounts.jsonl / scores.jsonl / configs.jsonl），启动载入内存；
 *      分数仅追加（保留历史），读取时按玩家取最佳；账号与配置文件变更时原子重写。
 *
 * 环境变量：
 *  PORT(默认8095) HOST(默认127.0.0.1) DATA_DIR(默认 <repo>/data/accounts)
 *  M3D_ACCOUNTS_SECRET  令牌签名密钥（必填；缺失拒绝启动）
 *  BODY_LIMIT(默认16384) RATE_PER_MIN(默认60) LEVEL_COUNT(默认12)
 *  MAX_TOTAL_TIME(默认 86400 秒，防作弊上限)
 *  M3D_FEEDBACK_URL(默认 http://127.0.0.1:8094) M3D_FEEDBACK_TOKEN(反馈代理必填)
 */
import http from 'node:http';
import crypto from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROUTE_PREFIXES = ['/marmot3d-beta/api', '/api'];
const USERNAME_RE = /^[\p{L}\p{N}_.\-]{2,16}$/u;
/** 调参配置名：1-50 位，中英文/数字/连字符/下划线。 */
const CONFIG_NAME_RE = /^[\p{L}\p{N}_\-]{1,50}$/u;
/** 单个配置（config 本体）大小上限：100KB。 */
const CONFIG_MAX_BYTES = 100 * 1024;
/** 读 body 时给 {name, config} 外层信封留的余量。 */
const CONFIG_ENVELOPE_SLACK = 1024;
const FEEDBACK_RESPONSE_LIMIT = 2 * 1024 * 1024;
const FEEDBACK_LIST_QUERY = ['type', 'version', 'q', 'handled', 'month', 'limit', 'before'];

// ---------------- 工具 ----------------
function isObj(v) { return typeof v === 'object' && v !== null && !Array.isArray(v); }
function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
  };
}
function sendJson(res, status, obj, extra = {}) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...corsHeaders(), ...extra });
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
  const users = new Map(); // id -> {id,name,salt?,hash?,guest?,createdAt}
  /** @type {Map<string, string>} 小写用户名 -> id */
  const nameIndex = new Map();
  /** @type {any[]} */
  const scores = [];
  const accFile = path.join(dataDir, 'accounts.jsonl');
  const scoreFile = path.join(dataDir, 'scores.jsonl');
  const configFile = path.join(dataDir, 'configs.jsonl');
  /** @type {Map<string, {name:string, config:object, updatedAt:string, size:number}>} */
  const configs = new Map(); // 配置名 -> 最新记录
  let accountWriteQueue = Promise.resolve();
  let configWriteQueue = Promise.resolve();

  async function load() {
    await fsp.mkdir(dataDir, { recursive: true });
    const accText = await fsp.readFile(accFile, 'utf8').catch(() => '');
    for (const line of accText.split('\n')) {
      const s = line.trim(); if (!s) continue;
      try {
        const u = JSON.parse(s);
        if (u && u.id && u.name) {
          const previous = users.get(u.id);
          if (previous && previous.guest !== true && previous.salt && previous.hash) {
            const previousName = String(previous.name).toLowerCase();
            if (nameIndex.get(previousName) === u.id) nameIndex.delete(previousName);
          }
          users.set(u.id, u);
          // guest 缺失是旧账号格式，按正式账号兼容；游客不参与登录名索引。
          if (u.guest !== true && u.salt && u.hash) nameIndex.set(u.name.toLowerCase(), u.id);
        }
      } catch { /* skip */ }
    }
    const scoreText = await fsp.readFile(scoreFile, 'utf8').catch(() => '');
    for (const line of scoreText.split('\n')) {
      const s = line.trim(); if (!s) continue;
      try { const r = JSON.parse(s); if (r && r.uid && r.kind) scores.push(r); } catch { /* skip */ }
    }
    const cfgText = await fsp.readFile(configFile, 'utf8').catch(() => '');
    for (const line of cfgText.split('\n')) {
      const s = line.trim(); if (!s) continue;
      try {
        const r = JSON.parse(s);
        // 同名以最后一行生效（与账号文件同策略）；损坏行跳过。
        if (r && typeof r.name === 'string' && CONFIG_NAME_RE.test(r.name) && isObj(r.config)) {
          configs.set(r.name, {
            name: r.name, config: r.config,
            updatedAt: typeof r.updatedAt === 'string' ? r.updatedAt : new Date(0).toISOString(),
            size: Number.isFinite(r.size) ? r.size : Buffer.byteLength(JSON.stringify(r.config)),
          });
        }
      } catch { /* skip */ }
    }
  }
  async function rewriteAccounts() {
    const write = accountWriteQueue.then(async () => {
      const tmp = `${accFile}.tmp-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
      try {
        const records = [...users.values()];
        await fsp.writeFile(tmp, records.length ? records.map((u) => JSON.stringify(u)).join('\n') + '\n' : '', 'utf8');
        await fsp.rename(tmp, accFile);
      } catch (e) {
        await fsp.unlink(tmp).catch(() => {});
        throw e;
      }
    });
    accountWriteQueue = write.catch(() => {});
    return write;
  }
  async function appendScore(r) { scores.push(r); await fsp.appendFile(scoreFile, JSON.stringify(r) + '\n', 'utf8'); }
  async function rewriteConfigs() {
    const write = configWriteQueue.then(async () => {
      const tmp = `${configFile}.tmp-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
      try {
        const records = [...configs.values()];
        await fsp.writeFile(tmp, records.length ? records.map((r) => JSON.stringify(r)).join('\n') + '\n' : '', 'utf8');
        await fsp.rename(tmp, configFile);
      } catch (e) {
        await fsp.unlink(tmp).catch(() => {});
        throw e;
      }
    });
    configWriteQueue = write.catch(() => {});
    return write;
  }

  return { users, nameIndex, scores, configs, load, rewriteAccounts, appendScore, rewriteConfigs };
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

// ---------------- 命名调参配置 ----------------
/** 配置名校验：trim 后 1-50 位，中英文/数字/连字符/下划线。 */
export function isValidConfigName(name) {
  return typeof name === 'string' && CONFIG_NAME_RE.test(name.trim());
}
/** 从路由 /configs/:name 取出解码后的名字；非法（含未转义保留字符）返回 null。 */
function decodeConfigName(route) {
  const raw = route.slice('/configs/'.length);
  if (!raw || raw.includes('/')) return null;
  try { return decodeURIComponent(raw); } catch { return null; }
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
  const authLimiter = createRateLimiter(20); // 登录/注册/升级更严格
  const guestLimiter = createRateLimiter(options.guestRatePerMin || 10); // 游客签发按 IP 严格限流
  let loaded = null;
  const feedbackUrl = options.feedbackUrl ?? process.env.M3D_FEEDBACK_URL ?? 'http://127.0.0.1:8094';
  const feedbackToken = options.feedbackToken ?? process.env.M3D_FEEDBACK_TOKEN ?? '';
  const feedbackTimeoutMs = Math.max(50, Number(options.feedbackTimeoutMs ?? 6000) || 6000);

  function authUser(req) {
    const match = /^Bearer\s+(\S+)$/i.exec(String(req.headers.authorization || ''));
    return match ? verifyToken(match[1], secret, store.users) : null;
  }

  async function proxyFeedback(req, res, kind, searchParams) {
    if (!authUser(req)) return sendJson(res, 401, { error: '登录已失效，请重新登录' });
    if (!String(feedbackToken).trim() || !String(feedbackUrl).trim()) {
      return sendJson(res, 503, { error: '反馈服务未配置，请联系管理员配置 M3D_FEEDBACK_URL 和 M3D_FEEDBACK_TOKEN', code: 'feedback_not_configured' });
    }
    let target;
    try {
      const base = new URL(String(feedbackUrl));
      if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password) throw new Error('invalid feedback url');
      target = new URL(kind === 'stats' ? '/stats' : '/list', base);
      if (kind === 'list') {
        for (const key of FEEDBACK_LIST_QUERY) {
          const value = searchParams.get(key);
          if (value !== null && value !== '') target.searchParams.set(key, value);
        }
      }
    } catch {
      return sendJson(res, 503, { error: '反馈服务地址配置无效', code: 'feedback_not_configured' });
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), feedbackTimeoutMs);
    try {
      const upstream = await fetch(target, {
        headers: { Accept: 'application/json', Authorization: `Bearer ${String(feedbackToken).trim()}` },
        signal: controller.signal,
      });
      if (!upstream.ok) return sendJson(res, 503, { error: `反馈服务暂不可用（HTTP ${upstream.status}）`, code: 'feedback_unavailable' });
      const declared = Number(upstream.headers.get('content-length') || 0);
      if (declared > FEEDBACK_RESPONSE_LIMIT) return sendJson(res, 502, { error: '反馈服务响应过大', code: 'feedback_bad_response' });
      const text = await upstream.text();
      if (Buffer.byteLength(text) > FEEDBACK_RESPONSE_LIMIT) return sendJson(res, 502, { error: '反馈服务响应过大', code: 'feedback_bad_response' });
      let data;
      try { data = JSON.parse(text); } catch { return sendJson(res, 502, { error: '反馈服务返回了无效数据', code: 'feedback_bad_response' }); }
      if (!isObj(data) || text.includes(String(feedbackToken).trim())) {
        return sendJson(res, 502, { error: '反馈服务返回了不可转发的数据', code: 'feedback_bad_response' });
      }
      return sendJson(res, 200, data);
    } catch (e) {
      const timedOut = e?.name === 'AbortError';
      return sendJson(res, 503, { error: timedOut ? '反馈服务响应超时，请稍后重试' : '无法连接反馈服务，请稍后重试', code: timedOut ? 'feedback_timeout' : 'feedback_unavailable' });
    } finally {
      clearTimeout(timer);
    }
  }

  const server = http.createServer(async (req, res) => {
    try {
      if (!loaded) loaded = store.load();
      await loaded;
      const url = new URL(req.url, 'http://localhost');
      const route = (routePath(url.pathname) || '/').replace(/\/+$/, '') || '/';
      if (req.method === 'OPTIONS') { res.writeHead(204, corsHeaders()); return res.end(); }
      if (route === '/health' && req.method === 'GET') return sendJson(res, 200, { ok: true });

      // ---------- 游客身份（无需令牌，按 IP 严格限流）----------
      if (req.method === 'POST' && route === '/auth/guest') {
        if (!guestLimiter(clientIp(req))) return sendJson(res, 429, { error: '游客创建过于频繁，请稍后再试' });
        const read = await readBody(req, bodyLimit);
        if (read.tooLarge) return sendJson(res, 413, { error: '请求体过大' });
        const id = crypto.randomUUID();
        const user = {
          id, name: `游客-${id.slice(0, 6)}`,
          guest: true, createdAt: new Date().toISOString(),
        };
        store.users.set(user.id, user);
        try { await store.rewriteAccounts(); }
        catch (e) { store.users.delete(user.id); throw e; }
        return sendJson(res, 200, { token: issueToken(user, secret), user: { id: user.id, name: user.name, guest: true } });
      }

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
        const user = { id: crypto.randomUUID(), name, salt, hash, guest: false, createdAt: new Date().toISOString() };
        store.users.set(user.id, user); store.nameIndex.set(name.toLowerCase(), user.id);
        try { await store.rewriteAccounts(); }
        catch (e) { store.users.delete(user.id); store.nameIndex.delete(name.toLowerCase()); throw e; }
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

      // ---------- 游客升级为正式账号（同 uid；改名令旧游客令牌失效）----------
      if (req.method === 'POST' && route === '/auth/upgrade') {
        if (!authLimiter(clientIp(req))) return sendJson(res, 429, { error: '操作过于频繁，请稍后再试' });
        const user = authUser(req);
        if (!user) return sendJson(res, 401, { error: '未授权' });
        if (user.guest !== true) return sendJson(res, 400, { error: '该账号已是正式账号' });
        const read = await readBody(req, bodyLimit);
        if (read.tooLarge) return sendJson(res, 413, { error: '请求体过大' });
        let body; try { body = JSON.parse(read.raw.toString('utf8') || '{}'); } catch { return sendJson(res, 400, { error: 'JSON 格式错误' }); }
        const name = typeof body.username === 'string' ? body.username.trim() : '';
        const password = typeof body.password === 'string' ? body.password : '';
        if (!USERNAME_RE.test(name)) return sendJson(res, 400, { error: '用户名需 2-16 位，可用中英文/数字/_.-' });
        if (password.length < 6 || password.length > 128) return sendJson(res, 400, { error: '密码至少 6 位' });
        if (store.nameIndex.has(name.toLowerCase())) return sendJson(res, 409, { error: '用户名已被占用' });

        const { salt, hash } = hashPassword(password);
        const upgraded = { ...user, name, salt, hash, guest: false };
        store.users.set(user.id, upgraded);
        try { await store.rewriteAccounts(); }
        catch (e) { store.users.set(user.id, user); throw e; }
        store.nameIndex.set(name.toLowerCase(), upgraded.id);
        return sendJson(res, 200, { token: issueToken(upgraded, secret), user: { id: upgraded.id, name: upgraded.name, guest: false } });
      }

      // ---------- 当前会话 ----------
      if (req.method === 'GET' && route === '/auth/me') {
        const user = authUser(req);
        if (!user) return sendJson(res, 401, { error: 'unauthorized' });
        return sendJson(res, 200, { user: { id: user.id, name: user.name, guest: user.guest === true } });
      }

      // ---------- 用户反馈（仅服务端持内部令牌；浏览器只使用账号会话）----------
      if (req.method === 'GET' && (route === '/admin/feedback/list' || route === '/admin/feedback/stats')) {
        return proxyFeedback(req, res, route.endsWith('/stats') ? 'stats' : 'list', url.searchParams);
      }

      // ---------- 成绩上报（需有效令牌；游客与正式账号均可）----------
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

      // ---------- 我的成绩（需有效令牌；游客与正式账号均可）----------
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


      // ---------- 命名调参配置（Beta 后台；公开读，写按 IP 限流）----------
      if (route === '/configs' && req.method === 'GET') {
        const configs = [...store.configs.values()]
          .map((r) => ({ name: r.name, updatedAt: r.updatedAt, size: r.size }))
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.name.localeCompare(b.name));
        return sendJson(res, 200, { configs });
      }

      if (route === '/configs' && req.method === 'POST') {
        if (!limiter('cfg:' + clientIp(req))) return sendJson(res, 429, { error: '操作过于频繁，请稍后再试' });
        const read = await readBody(req, CONFIG_MAX_BYTES + CONFIG_ENVELOPE_SLACK);
        if (read.tooLarge) return sendJson(res, 413, { error: '请求体过大（配置上限 100KB）' });
        let body; try { body = JSON.parse(read.raw.toString('utf8') || '{}'); } catch { return sendJson(res, 400, { error: 'invalid JSON' }); }
        const name = typeof body.name === 'string' ? body.name.trim() : '';
        if (!CONFIG_NAME_RE.test(name)) return sendJson(res, 400, { error: '配置名需 1-50 位，可用中英文/数字/连字符/下划线' });
        if (!isObj(body.config)) return sendJson(res, 400, { error: 'config 必须是对象' });
        let size;
        try { size = Buffer.byteLength(JSON.stringify(body.config)); } catch { return sendJson(res, 400, { error: 'config 无法序列化' }); }
        if (size > CONFIG_MAX_BYTES) return sendJson(res, 413, { error: `配置过大（${size} 字节），上限 100KB` });
        const rec = { name, config: body.config, updatedAt: new Date().toISOString(), size };
        const previous = store.configs.get(name) || null;
        store.configs.set(name, rec);
        try { await store.rewriteConfigs(); }
        catch (e) { if (previous) store.configs.set(name, previous); else store.configs.delete(name); throw e; }
        return sendJson(res, 200, { ok: true, name, updatedAt: rec.updatedAt, size });
      }

      if (route.startsWith('/configs/') && (req.method === 'GET' || req.method === 'DELETE')) {
        const rawName = decodeConfigName(route);
        if (rawName == null || !CONFIG_NAME_RE.test(rawName)) return sendJson(res, 400, { error: '配置名非法' });
        const exists = store.configs.has(rawName);
        if (req.method === 'GET') {
          if (!exists) return sendJson(res, 404, { error: '配置不存在' });
          const rec = store.configs.get(rawName);
          return sendJson(res, 200, { name: rec.name, updatedAt: rec.updatedAt, size: rec.size, config: rec.config });
        }
        // DELETE 幂等：删除不存在的名字也返回 ok。
        if (!exists) return sendJson(res, 200, { ok: true, name: rawName, deleted: false });
        if (!limiter('cfg:' + clientIp(req))) return sendJson(res, 429, { error: '操作过于频繁，请稍后再试' });
        const removed = store.configs.get(rawName);
        store.configs.delete(rawName);
        try { await store.rewriteConfigs(); }
        catch (e) { if (removed) store.configs.set(rawName, removed); throw e; }
        return sendJson(res, 200, { ok: true, name: rawName, deleted: true });
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
    feedbackUrl: process.env.M3D_FEEDBACK_URL || 'http://127.0.0.1:8094',
    feedbackToken: process.env.M3D_FEEDBACK_TOKEN || '',
  });
  server.listen(PORT, HOST, () => console.log(`[accounts] listening on http://${HOST}:${PORT} data=${DATA_DIR}`));
  let down = false;
  const shutdown = () => { if (down) return; down = true; server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 1500).unref(); };
  process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
}
