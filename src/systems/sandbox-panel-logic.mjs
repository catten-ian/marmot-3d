/** Pure helpers for the beta sandbox panel; no DOM or browser globals. */
export const FOLDER_STORAGE_KEY = 'm3d_beta_sandbox_folders_v1';
export const PRESET_STORAGE_KEY = 'm3d_beta_sandbox_presets_v1';
export const BUILTIN_PRESET_NAME = '出厂默认';

export function matchesSandboxSearch(query, { name = '', property = '', path = '' } = {}) {
  const needle = String(query ?? '').trim().toLocaleLowerCase();
  if (!needle) return true;
  return [name, property, path].some((value) => String(value ?? '').toLocaleLowerCase().includes(needle));
}

/** Whether a folder should show and expand for a query, independent of lil-gui. */
export function sandboxFolderSearchState(query, path, descendantMatches) {
  const active = String(query ?? '').trim().length > 0;
  const pathMatches = active && matchesSandboxSearch(query, { path });
  const visible = !active || !!descendantMatches || pathMatches;
  return { visible, open: active && visible };
}

export function normalizePresetName(value) {
  return String(value ?? '').trim().slice(0, 80);
}

function normalizePresetList(value) {
  const source = Array.isArray(value) ? value : (value && Array.isArray(value.presets) ? value.presets : []);
  const byName = new Map();
  for (const item of source) {
    if (!item || typeof item !== 'object') continue;
    const name = normalizePresetName(item.name);
    if (!name || name.toLocaleLowerCase() === BUILTIN_PRESET_NAME.toLocaleLowerCase()) continue;
    if (!item.snapshot || typeof item.snapshot !== 'object' || Array.isArray(item.snapshot)) continue;
    byName.set(name.toLocaleLowerCase(), { name, snapshot: item.snapshot });
  }
  return [...byName.values()];
}

export function readSandboxPresets(storage, key = PRESET_STORAGE_KEY) {
  if (!storage) return [];
  try {
    const raw = storage.getItem(key);
    if (!raw) return [];
    return normalizePresetList(JSON.parse(raw));
  } catch (error) {
    console.warn('[sandbox-debug] 预设读取失败，使用空列表', error);
    return [];
  }
}

export function writeSandboxPresets(storage, presets, key = PRESET_STORAGE_KEY) {
  if (!storage) return false;
  try {
    storage.setItem(key, JSON.stringify({ version: 1, presets: normalizePresetList(presets) }));
    return true;
  } catch (error) {
    console.warn('[sandbox-debug] 预设保存失败', error);
    return false;
  }
}

export function saveSandboxPreset(storage, nameValue, snapshot, key = PRESET_STORAGE_KEY) {
  const name = normalizePresetName(nameValue);
  if (!storage || !name || name.toLocaleLowerCase() === BUILTIN_PRESET_NAME.toLocaleLowerCase()
    || !snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return false;
  try {
    const presets = readSandboxPresets(storage, key);
    const normalizedName = name.toLocaleLowerCase();
    const index = presets.findIndex((preset) => preset.name.toLocaleLowerCase() === normalizedName);
    const next = { name, snapshot: JSON.parse(JSON.stringify(snapshot)) };
    if (index >= 0) presets[index] = next;
    else presets.push(next);
    return writeSandboxPresets(storage, presets, key);
  } catch (error) {
    console.warn('[sandbox-debug] 预设保存失败', error);
    return false;
  }
}

export function deleteSandboxPreset(storage, nameValue, key = PRESET_STORAGE_KEY) {
  const name = normalizePresetName(nameValue);
  if (!storage || !name || name.toLocaleLowerCase() === BUILTIN_PRESET_NAME.toLocaleLowerCase()) return false;
  const presets = readSandboxPresets(storage, key);
  const next = presets.filter((preset) => preset.name.toLocaleLowerCase() !== name.toLocaleLowerCase());
  if (next.length === presets.length) return false;
  return writeSandboxPresets(storage, next, key);
}

const LEVEL_FIELDS = ['name', 'count', 'types', 'wind', 'windGust', 'reinforce', 'time', 'goal', 'repels', 'fogNear', 'fogFar', 'sandstorm', 'brief'];
export function mapSandboxLevelReplay(levels, index) {
  let i;
  try { i = Number(index); } catch (_) { return null; }
  if (!Array.isArray(levels) || !Number.isInteger(i) || i < 0 || i >= levels.length) return null;
  const level = levels[i];
  let configuredCount;
  try { configuredCount = Number(level?.count); } catch (_) { return null; }
  if (!level || typeof level !== 'object' || !Number.isFinite(configuredCount) || configuredCount < 0) return null;
  const count = Math.floor(configuredCount);
  const types = Array.isArray(level.types) && level.types.length
    ? level.types.filter((type) => type != null && String(type).trim()).map((type) => String(type)) : ['normal'];
  const safeTypes = types.length ? types : ['normal'];
  const roster = Array.from({ length: count }, (_, slot) => safeTypes[slot % safeTypes.length]);
  const result = { index: i, count, types: safeTypes, roster };
  for (const field of LEVEL_FIELDS) {
    if (field === 'count' || field === 'types') continue;
    if (Object.prototype.hasOwnProperty.call(level, field)) {
      const value = level[field];
      result[field] = Array.isArray(value) ? [...value] : value;
    }
  }
  return result;
}
