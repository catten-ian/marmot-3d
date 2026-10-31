/**
 * Beta runtime tuning handoff. Pure validation/encoding helpers plus a tiny
 * browser adapter; defaults remain in BETA_TUNE when no valid payload exists.
 */
import { BETA_TUNE } from './beta-tuning.js';

export const RUNTIME_CONFIG_SCHEMA_VERSION = 1;
export const RUNTIME_CONFIG_QUERY_KEY = 'betaConfig';

// Key-specific runtime bounds complement the admin schema. They also protect
// hand-written betaConfig URLs and old active configs, not just UI input.
const POSITIVE_CAP = { smartMaxHp: [1, 40], smartMaxStamina: [1, 300] };
const RATIO_KEYS = [
  'smartRestHpRegenRatio', 'smartLowHpThreshold', 'smartSpeedMulAtZeroHp',
  'smartDamageMulAtZeroHp', 'smartRetreatHpRatio', 'smartRetreatStaminaRatio',
  'smartRestSafeHpRegenRatio', 'smartRestHealTarget',
];
const SMART_BOUNDS = {
  ...POSITIVE_CAP,
  smartPounceAimOffsetScale: [0, 1], smartPounceMinDistance: [1, 15],
  smartPounceMaxDistance: [1, 20], smartPounceApproachRadius: [2, 10],
  smartPounceObserveRadius: [4, 12], smartPounceRingTolerance: [.05, 1],
  smartPounceRingCrawlSpeed: [0, 5], smartPounceAlignCreepSpeed: [0, 5],
  smartPounceMemoryPenalty: [0, 1], smartPounceFatiguePenalty: [0, 1],
  smartPounceHitRadiusCap: [1.7, 3], smartPounceLeadSeconds: [0, .5],
  smartPounceMaxLeadDistance: [0, 3], smartPounceStrikeSpeed: [2, 25],
  smartPounceStrikeTime: [.05, .8],
  smartPackWindow: [0, 5], smartPackSpacing: [0, 2],
  smartPackSlotSpacing: [0, .5], smartDebounceHold: [0, 3],
  smartMeleeTriggerRange: [.5, 4], smartMeleeHitRange: [.3, 2.5],
  smartMeleeWindupTime: [.2, .6], smartMeleeStrikeTime: [.1, .3],
  smartMeleeRecoverTime: [.2, 1.5], smartMeleeCooldown: [.6, 4],
  smartMeleeStrikeSpeed: [0, 5],
  smartStalkStaminaPerSec: [0, 60], smartSprintStaminaPerSec: [0, 60],
  smartPounceStaminaPerSec: [0, 80], smartPounceStaminaCost: [0, 100],
  smartMeleeStaminaCost: [0, 100], smartPounceRecoverTime: [0, 3],
  smartPounceCooldown: [0, 10], smartHitStaminaCost: [0, 40],
  smartStaminaLockSeconds: [0, 10], smartRetreatHitStreak: [1, 20],
  smartHitStreakDecay: [0, 30], smartRetreatArriveRadius: [.1, 10],
  smartRetreatSpeed: [0, 30], smartRestSeconds: [0, 60],
  smartRestMinPlayerDistance: [0, 120],
  smartRestStaminaRegenPerSec: [0, 60], smartRecoverStaminaRegenPerSec: [0, 60],
  smartInterceptStaminaRegenPerSec: [0, 60], smartRoamStaminaRegenPerSec: [0, 60],
  smartTeamRestFatigue: [0, 1], smartTeamHealthyHpRatio: [0, 1],
  smartTeamHealthyStaminaRatio: [0, 1], smartTeamHoldTime: [0, 10],
  smartTeamSwitchCooldown: [0, 10],
};
SMART_BOUNDS.smartTeamRestHpRatio = [0, 1];
SMART_BOUNDS.smartTeamRestStaminaRatio = [0, 1];
for (const key of RATIO_KEYS) SMART_BOUNDS[key] = [0, 1];

const isObject = (v) => v && typeof v === 'object' && !Array.isArray(v);

function safeSessionStorage() {
  try { return globalThis.sessionStorage; } catch { return null; }
}

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
      const bounded = Math.max(0, n);
      const bounds = SMART_BOUNDS[key];
      out[key] = bounds ? Math.min(bounds[1], Math.max(bounds[0], bounded)) : bounded;
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
  if (query !== null) return decodeRuntimePayload(query, base);
  let raw;
  try { raw = storageLike?.getItem?.(RUNTIME_CONFIG_QUERY_KEY); }
  catch { return { ok: false, absent: true, error: '运行时配置存储不可用' }; }
  if (!raw) return { ok: false, absent: true, error: '未提供运行时配置' };
  try { return validateRuntimePayload(JSON.parse(raw), base); }
  catch { return { ok: false, error: '运行时配置存储内容不是有效 JSON' }; }
}

/** Apply active site values then explicit query values; the query wins conflicts. */
export function applyRuntimeConfigSources({
  locationLike = globalThis.location,
  storageLike = safeSessionStorage(),
  target = BETA_TUNE,
  activePayload = null,
} = {}) {
  const params = new URLSearchParams(locationLike?.search || '');
  if (params.has(RUNTIME_CONFIG_QUERY_KEY)) {
    const query = readRuntimePayload(locationLike, null, target);
    const active = activePayload ? validateRuntimePayload(activePayload, target) : null;
    const activeApplied = active?.ok ? applyRuntimeValues(active.payload.values, target).applied : [];
    if (!query.ok) {
      return active?.ok
        ? { ...active, applied: activeApplied, source: 'active', queryError: query.error }
        : { ...query, applied: [], source: 'default' };
    }
    const queryApplied = applyRuntimeValues(query.payload.values, target).applied;
    return {
      ...query,
      applied: [...new Set([...activeApplied, ...queryApplied])],
      source: 'explicit',
    };
  }

  if (activePayload) {
    const validated = validateRuntimePayload(activePayload, target);
    if (validated.ok) {
      return {
        ...validated,
        ...applyRuntimeValues(validated.payload.values, target),
        source: 'active',
      };
    }
  }

  // Same-tab storage remains a fail-soft fallback when no valid site-wide
  // config is available; it must not override a successfully fetched active.
  const stored = readRuntimePayload({ ...locationLike, search: '' }, storageLike, target);
  if (stored.ok) return { ...stored, ...applyRuntimeValues(stored.payload.values, target), source: 'storage' };
  return { ...stored, applied: [], source: 'default' };
}

/**
 * Apply the site-wide config first, then overlay valid per-page query values;
 * session storage is the fail-soft fallback. Invalid queries leave a valid
 * active config alone, or preserve defaults if neither source is valid.
 */
export async function applyRuntimeConfigWithPrecedence({
  locationLike = globalThis.location,
  storageLike = safeSessionStorage(),
  target = BETA_TUNE,
  fetchActive = fetchActiveBetaConfig,
} = {}) {
  let active;
  try { active = await fetchActive({ locationLike }); }
  catch (error) { active = { ok: false, error: error?.message || 'Beta active 配置不可用' }; }
  if (active?.ok) {
    return applyRuntimeConfigSources({ locationLike, storageLike, target, activePayload: active.payload });
  }
  return { ...applyRuntimeConfigSources({ locationLike, storageLike, target }), error: active?.error || '没有有效 Beta runtime 配置' };
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
