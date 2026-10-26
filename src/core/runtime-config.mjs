/**
 * Beta runtime tuning handoff. Pure validation/encoding helpers plus a tiny
 * browser adapter; defaults remain in BETA_TUNE when no valid payload exists.
 */
import { BETA_TUNE } from './beta-tuning.js';

export const RUNTIME_CONFIG_SCHEMA_VERSION = 1;
export const RUNTIME_CONFIG_QUERY_KEY = 'betaConfig';

const isObject = (v) => v && typeof v === 'object' && !Array.isArray(v);

/** Keep only actual beta tuning keys and finite values of the same type. */
export function sanitizeRuntimeValues(values, base = BETA_TUNE) {
  if (!isObject(values)) return { values: {}, ignored: [], warnings: ['values 必须是对象'] };
  const out = {}; const ignored = []; const warnings = [];
  for (const [key, value] of Object.entries(values)) {
    if (!Object.prototype.hasOwnProperty.call(base, key)) { ignored.push(key); continue; }
    if (typeof base[key] === 'boolean') {
      if (typeof value !== 'boolean') { warnings.push(`${key} 类型非法`); continue; }
      out[key] = value;
    } else if (typeof base[key] === 'number') {
      const n = Number(value);
      if (typeof value !== 'number' || !Number.isFinite(n)) { warnings.push(`${key} 必须是有限数字`); continue; }
      // Runtime payloads must not smuggle negative/NaN physics values.
      out[key] = Math.max(0, n);
    } else { ignored.push(key); }
  }
  return { values: out, ignored, warnings };
}

export function validateRuntimePayload(payload, base = BETA_TUNE) {
  if (!isObject(payload)) return { ok: false, error: '运行时配置必须是对象' };
  if (payload.schemaVersion !== RUNTIME_CONFIG_SCHEMA_VERSION) {
    return { ok: false, error: `运行时配置 schemaVersion 不匹配：期望 ${RUNTIME_CONFIG_SCHEMA_VERSION}` };
  }
  const clean = sanitizeRuntimeValues(payload.values, base);
  if (!Object.keys(clean.values).length) return { ok: false, error: '运行时配置没有有效 Beta 参数', ...clean };
  return { ok: true, ...clean, payload: { schemaVersion: RUNTIME_CONFIG_SCHEMA_VERSION, values: clean.values } };
}

/** Apply only validated values; returns changed keys and never changes defaults otherwise. */
export function applyRuntimeValues(values, target = BETA_TUNE) {
  const clean = sanitizeRuntimeValues(values, target);
  for (const [key, value] of Object.entries(clean.values)) target[key] = value;
  return { ...clean, applied: Object.keys(clean.values) };
}

export function runtimePayloadFromAdminConfig(config) {
  const values = {};
  for (const [id, value] of Object.entries(config?.values || {})) {
    if (id.startsWith('beta.')) values[id.slice(5)] = value;
  }
  return { schemaVersion: RUNTIME_CONFIG_SCHEMA_VERSION, values };
}

export function encodeRuntimePayload(payload) {
  const result = validateRuntimePayload(payload);
  if (!result.ok) throw new TypeError(result.error);
  return encodeURIComponent(JSON.stringify(result.payload));
}

export function decodeRuntimePayload(encoded, base = BETA_TUNE) {
  try { return validateRuntimePayload(JSON.parse(decodeURIComponent(String(encoded))), base); }
  catch { return { ok: false, error: '运行时配置 URL 载荷不是有效 JSON' }; }
}

/** Read query first, then storage fallback (storage is useful for same-tab launchers). */
export function readRuntimePayload(locationLike, storageLike = null, base = BETA_TUNE) {
  const params = new URLSearchParams(locationLike?.search || '');
  const query = params.get(RUNTIME_CONFIG_QUERY_KEY);
  if (query) return decodeRuntimePayload(query, base);
  const raw = storageLike?.getItem?.(RUNTIME_CONFIG_QUERY_KEY);
  if (!raw) return { ok: false, absent: true, error: '未提供运行时配置' };
  try { return validateRuntimePayload(JSON.parse(raw), base); }
  catch { return { ok: false, error: '运行时配置存储内容不是有效 JSON' }; }
}

export async function fetchActiveBetaConfig({ locationLike = globalThis.location, fetchFn = globalThis.fetch, timeoutMs = 1500 } = {}) {
  if (typeof fetchFn !== 'function') return { ok: false, error: 'fetch 不可用' };
  const pathname = String(locationLike?.pathname || '/');
  const base = pathname.includes('/marmot3d-beta/') ? '/marmot3d-beta/api' : pathname.replace(/\/[^/]*$/u, '') + '/api';
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = setTimeout(() => controller?.abort(), Math.min(2000, Math.max(50, Number(timeoutMs) || 1500)));
  try {
    const response = await fetchFn(`${base}/configs/active`, { headers: { Accept: 'application/json' }, ...(controller ? { signal: controller.signal } : {}) });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data?.config) return { ok: false, absent: response.status === 404, error: data?.error || `HTTP ${response.status}` };
    const payload = data.config;
    return validateRuntimePayload(payload);
  } catch (error) { return { ok: false, error: error?.name === 'AbortError' ? '账号服务请求超时' : '账号服务不可用' }; }
  finally { clearTimeout(timer); }
}

export function applyRuntimeConfigFromLocation(locationLike = globalThis.location, storageLike = globalThis.sessionStorage, target = BETA_TUNE) {
  const result = readRuntimePayload(locationLike, storageLike, target);
  if (!result.ok) return result;
  return { ...result, ...applyRuntimeValues(result.payload.values, target) };
}

export function buildGameUrl(adminPathname, payload, gamePath = 'index.html') {
  const base = String(adminPathname || '/admin.html').replace(/admin\.html$/u, '');
  const url = new URL(gamePath, `https://runtime.invalid${base}`);
  url.searchParams.set(RUNTIME_CONFIG_QUERY_KEY, encodeRuntimePayload(payload));
  return `${url.pathname}${url.search}`;
}
