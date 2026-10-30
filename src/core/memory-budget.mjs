/** Pure memory budget helpers for dev-only large asset loading. */
function numberOr(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

export function getMemorySnapshot(memory = globalThis.performance?.memory, navigatorLike = globalThis.navigator) {
  const jsHeapSizeLimit = numberOr(memory?.jsHeapSizeLimit, 0);
  const deviceMemory = numberOr(navigatorLike?.deviceMemory, 0);
  const mobile = /Android|iPhone|iPad|Mobile/i.test(String(navigatorLike?.userAgent || ''))
    || Number(navigatorLike?.maxTouchPoints) > 0;
  if (!jsHeapSizeLimit && !deviceMemory) return null;
  return {
    usedJSHeapSize: Math.max(0, numberOr(memory?.usedJSHeapSize, 0)),
    jsHeapSizeLimit: Math.max(0, jsHeapSizeLimit),
    deviceMemory,
    mobile,
    maxTextureSize: Math.max(0, Math.floor(numberOr(navigatorLike?.__m3dMaxTextureSize, 0))),
  };
}

export function estimateTextureBytes({ width = 0, height = 0, channels = 4, mipmaps = true } = {}) {
  const pixels = Math.max(0, numberOr(width) * numberOr(height));
  const mipFactor = mipmaps ? 4 / 3 : 1;
  return pixels * Math.max(1, numberOr(channels, 4)) * mipFactor;
}

/** Sum texture estimates once per texture UUID/object identity. */
export function estimateUniqueTextureBytes(textures = []) {
  const seen = new Set(); let total = 0;
  for (const texture of textures || []) {
    if (!texture) continue;
    const identity = texture.uuid || texture;
    if (seen.has(identity)) continue;
    seen.add(identity);
    const image = texture.image || texture;
    total += estimateTextureBytes({ width: image.width || image.naturalWidth || 0, height: image.height || image.naturalHeight || 0, channels: texture.channels || 4, mipmaps: texture.generateMipmaps !== false });
  }
  return total;
}

export function textureBudgetFor({ snapshot = getMemorySnapshot(), reserveBytes = 256 * 1024 * 1024, maxTextureFraction = 0.24 } = {}) {
  if (!snapshot) return null;
  const deviceBytes = snapshot.deviceMemory > 0 ? snapshot.deviceMemory * 1024 ** 3 : Infinity;
  const jsBytes = snapshot.jsHeapSizeLimit > 0 ? snapshot.jsHeapSizeLimit : Infinity;
  const available = Math.min(deviceBytes, jsBytes);
  if (!Number.isFinite(available)) return null;
  const reserve = Math.max(0, numberOr(reserveBytes, 256 * 1024 * 1024));
  return Math.max(0, Math.min(available * Math.min(0.5, Math.max(0.08, numberOr(maxTextureFraction, 0.24))), available - reserve));
}

export function memoryBudgetFor({ snapshot = getMemorySnapshot(), reserveBytes = 256 * 1024 * 1024, maxFraction = 0.82 } = {}) {
  if (!snapshot || !snapshot.jsHeapSizeLimit) return null;
  const byFraction = snapshot.jsHeapSizeLimit * Math.min(0.95, Math.max(0.5, numberOr(maxFraction, 0.82)));
  return Math.max(0, Math.min(byFraction, snapshot.jsHeapSizeLimit - Math.max(0, numberOr(reserveBytes, 256 * 1024 * 1024))));
}

export function exceedsMemoryBudget({ snapshot = getMemorySnapshot(), extraBytes = 0, extraTextureBytes = 0, reserveBytes = 256 * 1024 * 1024, maxFraction = 0.82 } = {}) {
  if (!snapshot) return false;
  const jsBudget = memoryBudgetFor({ snapshot, reserveBytes, maxFraction });
  const gpuBudget = textureBudgetFor({ snapshot, reserveBytes });
  const jsExceeded = jsBudget != null && snapshot.usedJSHeapSize + Math.max(0, numberOr(extraBytes)) > jsBudget;
  const gpuExceeded = gpuBudget != null && Math.max(0, numberOr(extraTextureBytes)) > gpuBudget;
  return !!(jsExceeded || gpuExceeded);
}
