/** Scene-filter preferences: one validated, fail-soft local settings store. */
export const SCENE_FILTER_STORAGE_KEY = 'marmot.settings.sceneFilter.v1';
export const DEFAULT_SCENE_FILTER = Object.freeze({ preset: 'none', intensity: 0 });

export const SCENE_FILTER_PRESETS = Object.freeze([
  Object.freeze({ id: 'none', name: '无滤镜', description: '保持 rev58 原始场景色彩；0% 强度也走无滤镜路径。', saturation: 1, contrast: 1, brightness: 1, tint: Object.freeze([1, 1, 1]), shadowLift: 0, highlightSoftness: 0, filmic: 0 }),
  Object.freeze({ id: 'natural', name: '自然增强', description: '恢复草地与岩石层次，轻微提升自然饱和度和柔和高光。', saturation: 1.12, contrast: 1.075, brightness: 1.01, tint: Object.freeze([1.015, 1.025, 0.995]), shadowLift: 0.018, highlightSoftness: 0.055, filmic: 0.12 }),
  Object.freeze({ id: 'clear', name: '清透晨光', description: '提亮天空和远景空气感，保留草地纹理与暗部细节。', saturation: 1.08, contrast: 1.045, brightness: 1.055, tint: Object.freeze([0.985, 1.025, 1.045]), shadowLift: 0.028, highlightSoftness: 0.075, filmic: 0.16 }),
  Object.freeze({ id: 'warm', name: '暖阳电影', description: '金色高光配青绿色阴影，带轻微电影感但不过度染色。', saturation: 1.1, contrast: 1.065, brightness: 1.018, tint: Object.freeze([1.095, 1.035, 0.91]), shadowLift: 0.02, highlightSoftness: 0.085, filmic: 0.24 }),
  Object.freeze({ id: 'cool', name: '冷雾远山', description: '蓝青远景与温和草地对比，适合阴天和山谷视角。', saturation: 1.07, contrast: 1.06, brightness: 1.012, tint: Object.freeze([0.91, 1.02, 1.095]), shadowLift: 0.03, highlightSoftness: 0.06, filmic: 0.2 }),
  Object.freeze({ id: 'verdant', name: '青翠层次', description: '突出植被层次和土石暖色，压住刺眼高光，适合白天探索。', saturation: 1.17, contrast: 1.09, brightness: 1.005, tint: Object.freeze([1.015, 1.05, 0.965]), shadowLift: 0.014, highlightSoftness: 0.095, filmic: 0.18 }),
]);

const IDS = new Set(SCENE_FILTER_PRESETS.map((p) => p.id));
export function getSceneFilterPreset(id) { return SCENE_FILTER_PRESETS.find((p) => p.id === id) || SCENE_FILTER_PRESETS[0]; }

/** Invalid/missing/old data always fails closed to the original unfiltered scene. */
export function normalizeSceneFilter(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { ...DEFAULT_SCENE_FILTER };
  if (!IDS.has(value.preset)) return { ...DEFAULT_SCENE_FILTER };
  if (typeof value.intensity !== 'number' || !Number.isFinite(value.intensity)) return { ...DEFAULT_SCENE_FILTER };
  const intensity = Math.round(Math.max(0, Math.min(100, value.intensity)));
  if (value.preset === 'none' || intensity === 0) return { ...DEFAULT_SCENE_FILTER };
  return { preset: value.preset, intensity };
}

export function readSceneFilterSettings(storage) {
  try {
    const raw = storage?.getItem?.(SCENE_FILTER_STORAGE_KEY);
    return raw == null ? { ...DEFAULT_SCENE_FILTER } : normalizeSceneFilter(JSON.parse(raw));
  } catch (_) { return { ...DEFAULT_SCENE_FILTER }; }
}

export class SceneFilterSettings {
  constructor({ storage } = {}) {
    if (storage === undefined) { try { storage = globalThis.localStorage; } catch (_) { storage = null; } }
    this.storage = storage;
    this.value = readSceneFilterSettings(storage);
    this.listeners = new Set();
  }
  snapshot() { return { ...this.value }; }
  get active() { return this.value.preset !== 'none' && this.value.intensity > 0; }
  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  _apply(next) {
    this.value = normalizeSceneFilter(next);
    try { this.storage?.setItem?.(SCENE_FILTER_STORAGE_KEY, JSON.stringify(this.value)); } catch (_) { /* storage denial never blocks play */ }
    const state = this.snapshot();
    for (const fn of this.listeners) { try { fn(state); } catch (_) { /* one consumer cannot corrupt settings */ } }
    return state;
  }
  setPreset(preset) {
    const previous = this.value;
    return this._apply({ preset, intensity: preset === 'none' ? 0 : (previous.intensity || 75) });
  }
  setIntensity(intensity) { return this._apply({ preset: this.value.preset, intensity }); }
  reset() { return this._apply({ ...DEFAULT_SCENE_FILTER }); }
}
