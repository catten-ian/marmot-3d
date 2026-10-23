/** Dev Verdant pack downloader: cache-friendly streaming bytes and blob URL mapping. */

export function formatBytes(value) {
  const bytes = Math.max(0, Number(value) || 0);
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const units = ['KiB', 'MiB', 'GiB'];
  let n = bytes;
  let i = -1;
  do { n /= 1024; i++; } while (n >= 1024 && i < units.length - 1);
  const digits = n >= 100 ? 0 : n >= 10 ? 1 : 2;
  return `${n.toFixed(digits)} ${units[i]}`;
}

export class SpeedEma {
  constructor(alpha = 0.22) { this.alpha = Math.max(0.01, Math.min(1, alpha)); this.value = 0; }
  push(sample) { const n = Math.max(0, Number(sample) || 0); this.value = this.value ? this.value * (1 - this.alpha) + n * this.alpha : n; return this.value; }
}

export function aggregateManifestBytes(manifest) {
  const files = Array.isArray(manifest?.files) ? manifest.files : [];
  return files.reduce((sum, file) => sum + (Number.isFinite(file?.size) ? file.size : 0), 0);
}

function likelyCached(url, response) {
  if (response?.status === 304) return true;
  try {
    // 磁盘缓存再验证(304)：transferSize=0 且 encodedBodySize>0；
    // 内存缓存命中：transferSize=0 且 encodedBodySize 可能也为 0。两者都算缓存命中，
    // 避免二次进入时不显示「已缓存」、反而闪出瞬时假速度。
    const entries = globalThis.performance?.getEntriesByName?.(url) || [];
    return entries.some((entry) => entry.transferSize === 0);
  } catch (_) { return false; }
}

async function readResponse(response, expectedSize, onChunk) {
  if (!response.body || typeof response.body.getReader !== 'function') {
    const bytes = new Uint8Array(await response.arrayBuffer());
    onChunk(bytes.byteLength, true);
    return new Blob([bytes]);
  }
  const reader = response.body.getReader();
  const chunks = [];
  let done = 0;
  for (;;) {
    const part = await reader.read();
    if (part.done) break;
    if (part.value?.byteLength) { chunks.push(part.value); done += part.value.byteLength; onChunk(part.value.byteLength, false); }
  }
  // Some cache implementations omit a body byte count; the manifest remains authoritative.
  if (expectedSize >= 0 && done === 0 && expectedSize > 0) onChunk(expectedSize, true);
  return new Blob(chunks);
}

export async function downloadVerdantPack(manifest, { baseUrl, resolveLocal, onProgress, scenePath } = {}) {
  const allFiles = Array.isArray(manifest?.files) ? manifest.files : [];
  // 运行时只需要场景主文件：已核验 low/medium/high 三档 GLB 的贴图与缓冲全部内嵌
  // （images 外链数为 0），托管加载只需那一个 .glb。pack-manifest 里其余 jpg/png
  // 仅供 ZIP / 本地资源包分发，逐个网络预取会让手机多下约 43MB 用不到的数据。
  // 仅当主场景是 .gltf(JSON，通常外链 .bin/贴图) 时才回退整包预取，保持通用正确。
  let files = allFiles;
  let sceneName = '';
  if (scenePath) {
    try { sceneName = new URL(scenePath, location.href).pathname.split('/').pop().toLowerCase(); }
    catch (_) { sceneName = String(scenePath).split('?')[0].split('#')[0].split('/').pop().toLowerCase(); }
  }
  if (sceneName.endsWith('.glb')) {
    const picked = allFiles.filter((file) => String(file.path || '').split('/').pop().toLowerCase() === sceneName);
    if (picked.length) files = picked;
  }
  const localUrls = new Map();
  for (const file of files) {
    const path = String(file.path || '');
    const logical = new URL(path, baseUrl).href;
    const local = resolveLocal?.(logical);
    if (local) localUrls.set(path, local);
  }
  const totalBytes = files.reduce((sum, file) => sum + (localUrls.has(String(file.path || '')) ? 0 : Math.max(0, Number(file?.size) || 0)), 0);
  const urls = new Map(localUrls);
  const objectUrls = [];
  const speed = new SpeedEma();
  let doneBytes = 0;
  let networkFiles = 0;
  let cachedFiles = 0;
  let lastTime = globalThis.performance?.now?.() || Date.now();
  const publish = (extra = {}) => onProgress?.({ doneBytes, totalBytes, remainingBytes: Math.max(0, totalBytes - doneBytes), speedBytesPerSecond: speed.value, cached: networkFiles > 0 && cachedFiles === networkFiles, ...extra });

  for (const file of files) {
    const path = String(file.path || '');
    const local = localUrls.get(path);
    if (local) continue;
    const logical = new URL(path, baseUrl).href;
    networkFiles++;
    const response = await fetch(logical); // default cache: HTTP cache + ETag/304
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${logical}`);
    const cached = likelyCached(logical, response);
    if (cached) cachedFiles++;
    const started = globalThis.performance?.now?.() || Date.now();
    const blob = await readResponse(response, Number(file.size) || 0, (chunk, fallback) => {
      doneBytes += chunk;
      const now = globalThis.performance?.now?.() || Date.now();
      const elapsed = Math.max(1, now - lastTime) / 1000;
      if (chunk > 0) speed.push(chunk / elapsed);
      lastTime = now;
      publish({ currentPath: path, currentCached: cached || fallback });
    });
    const objectUrl = URL.createObjectURL(blob);
    objectUrls.push(objectUrl); urls.set(path, objectUrl);
    // If a stream was unavailable or the response supplied fewer bytes, use manifest size for progress.
    const actual = Number(file.size) || blob.size;
    if (blob.size !== actual && doneBytes < totalBytes) doneBytes += Math.max(0, actual - blob.size);
    if (cached && !speed.value) speed.push(actual / Math.max(0.001, ((globalThis.performance?.now?.() || Date.now()) - started) / 1000));
    publish({ currentPath: path, currentCached: cached });
  }
  publish({ complete: true, cached: networkFiles > 0 && cachedFiles === networkFiles });
  return { urls, objectUrls, totalBytes, networkFiles, cachedFiles, revoke() { for (const url of objectUrls) URL.revokeObjectURL(url); } };
}

export function formatDownloadStats(stats) {
  if (!stats || !Number.isFinite(stats.totalBytes) || stats.totalBytes <= 0) return '';
  if (stats.cached) return `已缓存 ${formatBytes(stats.totalBytes)}`;
  const speed = stats.speedBytesPerSecond > 0 ? ` · ${formatBytes(stats.speedBytesPerSecond)}/s` : '';
  return `${formatBytes(stats.doneBytes)} / ${formatBytes(stats.totalBytes)}（剩 ${formatBytes(stats.remainingBytes)}）${speed}`;
}
