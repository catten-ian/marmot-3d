/** PAF debug bridge for the admin tuning schema. DOM-free helpers live here so
 * the server sync contract can be tested without Three/lil-gui. */
import { buildTuningEntries, indexEntries, clampStored, toView, toStored, applyImport, serializeSavedConfig, validateConfigName } from '../admin/tuning-schema.mjs';
import { PLAYER, FOX, BURROW, UNDERGROUND, BURROWS, BURROW_AI, LEVELS, BERRY_POINTS, SPAWN_POINTS, ROCKS } from '../core/config.js';
import { BETA_TUNE } from '../core/beta-tuning.js';
import { STRIKE_VOLUMES } from '../systems/combat.js';
import { SMART_POUNCE, SMART_PHASE_MIN, SMART_WEIGHTS } from '../entities/smart-fox-core.mjs';

const ROOTS = { PLAYER, FOX, BURROW, UNDERGROUND, BURROWS, BURROW_AI, LEVELS, BERRY_POINTS, SPAWN_POINTS, ROCKS, BETA_TUNE, STRIKE_VOLUMES, SMART_POUNCE, SMART_PHASE_MIN, SMART_WEIGHTS };
const shadows = new Map();

export function splitPath(path) { return String(path || '').split('.').filter(Boolean); }
export function getPath(root, path) {
  let value = root;
  for (const key of splitPath(path)) { if (value == null) return undefined; value = value[key]; }
  return value;
}
export function setPath(root, path, value) {
  const keys = splitPath(path); if (!keys.length || root == null) return false;
  let target = root;
  for (const key of keys.slice(0, -1)) { if (target == null || !(key in target)) return false; target = target[key]; }
  if (target == null) return false;
  try { target[keys.at(-1)] = value; return Object.is(target[keys.at(-1)], value); } catch { return false; }
}

function sourcePath(entry) {
  const source = String(entry?.source || '').split('→')[0].trim();
  const m = /^([A-Z][A-Z0-9_]*)\.(.+)$/.exec(source);
  return m ? { root: m[1], path: m[2] } : null;
}
export function resolveEntryTarget(entry, roots = ROOTS) {
  const parsed = sourcePath(entry);
  if (!parsed || !roots[parsed.root]) return null;
  const root = roots[parsed.root];
  return getPath(root, parsed.path) === undefined ? null : { root, path: parsed.path, rootName: parsed.root };
}
export function readRuntimeValue(entry, roots = ROOTS) {
  const target = resolveEntryTarget(entry, roots);
  if (target) return getPath(target.root, target.path);
  return shadows.has(entry.id) ? shadows.get(entry.id) : entry.def;
}
export function writeRuntimeValue(entry, stored, roots = ROOTS) {
  const target = resolveEntryTarget(entry, roots);
  if (target && setPath(target.root, target.path, stored)) return { ok: true, shadow: false };
  shadows.set(entry.id, stored);
  return { ok: true, shadow: true };
}
export function applySchemaValues(entries, values, roots = ROOTS) {
  const byId = indexEntries(entries); const applied = []; const ignored = []; const clamped = [];
  for (const [id, raw] of Object.entries(values || {})) {
    const entry = byId.get(id); if (!entry) { ignored.push(id); continue; }
    const stored = clampStored(entry, raw);
    if (!(Object.is(raw, stored) || (entry.kind === 'number' && Number(raw) === stored))) clamped.push({ id, from: raw, to: stored });
    writeRuntimeValue(entry, stored, roots); applied.push(id);
  }
  return { applied, ignored, clamped };
}
export function collectSchemaValues(entries, roots = ROOTS, state = null) {
  return Object.fromEntries(entries.map((entry) => [entry.id, state?.values?.[entry.id] ?? readRuntimeValue(entry, roots)]));
}
export function buildPushPayload(entries, roots = ROOTS, state = null, at = new Date().toISOString()) {
  return serializeSavedConfig(entries, { values: collectSchemaValues(entries, roots, state) }, at);
}
export function normalizeServerConfig(data) {
  const config = data?.config?.values ? data.config : data?.values ? data : null;
  return config ? { ok: true, config } : { ok: false, error: '服务器响应缺少 config.values' };
}
export function applyServerConfig(entries, data, roots = ROOTS, { active = false } = {}) {
  const normalized = normalizeServerConfig(data); if (!normalized.ok) return normalized;
  const known = new Set(entries.map((entry) => entry.id));
  const values = {};
  for (const [id, value] of Object.entries(normalized.config.values || {})) {
    const mapped = active && !known.has(id) && known.has(`beta.${id}`) ? `beta.${id}` : id;
    values[mapped] = value;
  }
  return { ok: true, ...applySchemaValues(entries, values, roots) };
}
export function configsFromResponse(data) { return Array.isArray(data?.configs) ? data.configs : []; }
export function apiBaseFromLocation(locationLike = globalThis.location) {
  const path = String(locationLike?.pathname || '/');
  const m = /^(.*\/marmot3d-beta)(?:\/|$)/u.exec(path);
  return `${m ? m[1] : path.replace(/\/[^/]*$/u, '')}/api`;
}
export function createAdminSync(entries = buildTuningEntries(), opts = {}) {
  const roots = opts.roots || ROOTS;
  const byId = indexEntries(entries);
  return { entries, byId, roots,
    apply(values) { return applySchemaValues(entries, values, roots); },
    collect(state) { return collectSchemaValues(entries, roots, state); },
    payload(state, at) { return buildPushPayload(entries, roots, state, at); },
    read(entry) { return readRuntimeValue(entry, roots); },
    write(entry, value) { return writeRuntimeValue(entry, value, roots); },
  };
}
