/** BETA 账号与排行榜接口；请求失败只向调用方报告，不影响游戏主循环。 */
export class AccountsApiError extends Error {
  constructor(status, message = '账号服务暂不可用', code = '') {
    super(message);
    this.name = 'AccountsApiError';
    this.status = Number(status) || 0;
    this.code = code;
  }
}

/** 将可见文本转义后再放入 HTML 字符串，避免玩家名或服务端文本变成标签。 */
export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[char]);
}

function nonNegativeInteger(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.trunc(number)) : 0;
}

/** 组装并校验后端要求的成绩字段；时间单位为秒。 */
export function buildScorePayload({
  kind, level, time, hits = 0, boosts = 0, ultimates = 0, version = 'unknown',
} = {}, levelCount = 0) {
  if (kind !== 'level' && kind !== 'full') throw new TypeError('成绩类型无效');
  const seconds = Number(time);
  if (!Number.isFinite(seconds) || seconds <= 0 || seconds > 86400) {
    throw new RangeError('成绩用时必须大于 0 且不超过 86400 秒');
  }

  const payload = { kind };
  if (kind === 'level') {
    const index = Number(level);
    if (!Number.isInteger(index) || index < 0 || index >= Number(levelCount)) {
      throw new RangeError('关卡下标超出范围');
    }
    payload.level = index;
  }
  payload.time = seconds;
  payload.hits = nonNegativeInteger(hits);
  payload.boosts = nonNegativeInteger(boosts);
  payload.ultimates = nonNegativeInteger(ultimates);
  payload.version = String(version || 'unknown');
  return payload;
}

/** 用时格式保持一位小数，必要时保留第二位。 */
export function formatSeconds(value) {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds < 0) return '—';
  return `${seconds.toFixed(2).replace(/(\.\d)0$/, '$1')}s`;
}

function queryString(values) {
  const params = new URLSearchParams();
  const allowed = new Set(['kind', 'level', 'limit']);
  for (const [key, value] of Object.entries(values || {})) {
    if (!allowed.has(key) || value === undefined || value === null || value === '') continue;
    params.set(key, String(value));
  }
  const serialized = params.toString();
  return serialized ? `?${serialized}` : '';
}

/** 同源 API 客户端。token 仅通过 Authorization 请求头传递。 */
export class AccountsApi {
  constructor({ basePath = '/marmot3d-beta/api', requestTimeoutMs = 8000, fetchFn = null } = {}) {
    this.basePath = String(basePath || '/marmot3d-beta/api').replace(/\/+$/, '');
    const configuredTimeout = Number(requestTimeoutMs);
    this.requestTimeoutMs = Number.isFinite(configuredTimeout)
      ? Math.min(8000, Math.max(5000, configuredTimeout)) : 8000;
    this.fetchFn = fetchFn;
  }

  async request(path, { method = 'GET', token = '', body, query } = {}) {
    const fetchFn = this.fetchFn || (typeof fetch === 'function' ? fetch : null);
    if (!fetchFn) throw new AccountsApiError(0, '浏览器不支持网络请求', 'unavailable');

    const headers = { Accept: 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const url = `${this.basePath}${path}${queryString(query)}`;
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    let timer = null;
    let timedOut = false;
    const requestPromise = Promise.resolve().then(async () => {
      const response = await fetchFn(url, {
        method, headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        ...(controller ? { signal: controller.signal } : {}),
      });
      let data = null;
      try { data = await response.json(); } catch (_) { data = null; }
      if (!response.ok) {
        throw new AccountsApiError(response.status, String(data?.error || '账号服务暂不可用'), 'http');
      }
      return data || {};
    });
    const timeoutPromise = new Promise((_, reject) => {
      timer = setTimeout(() => {
        timedOut = true;
        controller?.abort();
        reject(new AccountsApiError(0, '账号服务请求超时', 'timeout'));
      }, this.requestTimeoutMs);
    });

    try {
      return await Promise.race([requestPromise, timeoutPromise]);
    } catch (error) {
      if (error instanceof AccountsApiError) throw error;
      throw new AccountsApiError(0, timedOut ? '账号服务请求超时' : '网络暂不可用', timedOut ? 'timeout' : 'network');
    } finally {
      if (timer !== null) clearTimeout(timer);
    }
  }

  register(credentials) {
    return this.request('/auth/register', { method: 'POST', body: credentials });
  }

  login(credentials) {
    return this.request('/auth/login', { method: 'POST', body: credentials });
  }

  /** 无需令牌：签发游客身份（服务端按 IP 限流）。 */
  guest() {
    return this.request('/auth/guest', { method: 'POST', body: {} });
  }

  /** 持游客令牌升级为正式账号；成功后须换用新令牌，旧游客令牌随即失效。 */
  upgrade(credentials, token) {
    return this.request('/auth/upgrade', { method: 'POST', token, body: credentials });
  }

  me(token) {
    return this.request('/auth/me', { token });
  }

  submitScore(payload, token) {
    return this.request('/scores', { method: 'POST', token, body: payload });
  }

  leaderboard(kind, { level, limit = 50 } = {}) {
    const safeLimit = Math.max(1, Math.min(50, Math.trunc(Number(limit) || 50)));
    return this.request('/leaderboard', {
      query: { kind, ...(kind === 'level' ? { level } : {}), limit: safeLimit },
    });
  }

  mine(token) {
    return this.request('/scores/mine', { token });
  }
}
