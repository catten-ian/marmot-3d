/** Persistent WebGPU graphics adapter preference. */
export const GRAPHICS_PREFERENCE_STORAGE_KEY = 'marmot.graphics-adapter.v1';
export const GRAPHICS_PREFERENCE_AUTO = 'auto';
export const GRAPHICS_PREFERENCE_HIGH = 'high-performance';
export const GRAPHICS_PREFERENCE_POWER = 'power-saving';
export const GRAPHICS_PREFERENCES = [
  GRAPHICS_PREFERENCE_AUTO,
  GRAPHICS_PREFERENCE_HIGH,
  GRAPHICS_PREFERENCE_POWER,
];

export function normalizeGraphicsPreference(value) {
  return GRAPHICS_PREFERENCES.includes(value) ? value : GRAPHICS_PREFERENCE_AUTO;
}

export function readGraphicsPreference(storage = globalThis.localStorage) {
  try {
    return normalizeGraphicsPreference(storage?.getItem?.(GRAPHICS_PREFERENCE_STORAGE_KEY));
  } catch (_) {
    return GRAPHICS_PREFERENCE_AUTO;
  }
}

export function writeGraphicsPreference(value, storage = globalThis.localStorage) {
  const next = normalizeGraphicsPreference(value);
  try { storage?.setItem?.(GRAPHICS_PREFERENCE_STORAGE_KEY, next); } catch (_) { /* unavailable storage */ }
  return next;
}

/** Map the user preference to the portable WebGPU request hint. */
export function adapterPowerPreference(value) {
  return normalizeGraphicsPreference(value) === GRAPHICS_PREFERENCE_POWER
    ? 'low-power'
    : 'high-performance';
}
