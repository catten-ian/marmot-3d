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

async function readResponse(response, expectedSize, onChunk, firstByteTimeoutMs = 8000, signal, abort = null) {
  if (!response.body || typeof response.body.getReader !== 'function') {
    // 非流式内核无法观察首字节时刻；不要错误地用 8 秒误杀仍在下载的 arrayBuffer。
    const bytes = new Uint8Array(await response.arrayBuffer());
    onChunk(bytes.byteLength, true);
    return new Blob([bytes]);
  }
  const reader = response.body.getReader();
  const chunks = [];
  let done = 0;
  const read = () => {
    if (!signal) return reader.read();
    return new Promise((resolve, reject) => {
      if (signal.aborted) { try { reader.cancel(); } catch (_) {} reject(new Error('下载已取消')); return; }
      const onAbort = () => { signal.removeEventListener('abort', onAbort); try { reader.cancel(); } catch (_) {} reject(new Error('下载已取消')); };
      signal.addEventListener('abort', onAbort, { once: true });
      reader.read().then((value) => { signal.removeEventListener('abort', onAbort); resolve(value); }, (error) => { signal.removeEventListener('abort', onAbort); reject(error); });
    });
  };
  for (;;) {
    const part = await (done === 0 ? withTimeout(read(), firstByteTimeoutMs, `首字节无响应 ${firstByteTimeoutMs}ms`, abort) : read());
    if (part.done) break;
    if (part.value?.byteLength) { chunks.push(part.value); done += part.value.byteLength; onChunk(part.value.byteLength, false); }
  }
  // Some cache implementations omit a body byte count; the manifest remains authoritative.
  if (expectedSize >= 0 && done === 0 && expectedSize > 0) onChunk(expectedSize, true);
  return new Blob(chunks);
}

function sourceLabel(url) {
  const u = String(url || '');
  if (/^blob:/i.test(u)) return '本地';
  if (/tos-cn-shanghai|tos\b|volces\.com/i.test(u)) return 'TOS';
  return '源站';
}

function withTimeout(promise, ms, message, onTimeout = null) {
  let timer;
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => { try { onTimeout?.(); } catch (_) {} reject(new Error(message)); }, ms); });
  return Promise.race([promise, timeout]).then((value) => { clearTimeout(timer); return value; }, (error) => { clearTimeout(timer); throw error; });
}

export async function downloadVerdantPack(manifest, { baseUrl, resolveLocal, candidatesForFile, onProgress, scenePath, stallMs = 8000, signal } = {}) {
  const allFiles = Array.isArray(manifest?.files) ? manifest.files : [];
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
  const candidateMap = new Map();
  for (const file of files) {
    const path = String(file.path || '');
    const logical = baseUrl ? new URL(path, baseUrl).href : path;
    const local = resolveLocal?.(logical);
    if (local) localUrls.set(path, local);
    const candidates = candidatesForFile?.(path, logical) || [logical];
    candidateMap.set(path, [...new Set(candidates.filter(Boolean))]);
  }
  const totalBytes = files.reduce((sum, file) => sum + (localUrls.has(String(file.path || '')) ? 0 : Math.max(0, Number(file?.size) || 0)), 0);
  const urls = new Map(localUrls), objectUrls = [], speed = new SpeedEma();
  let doneBytes = 0, networkFiles = 0, cachedFiles = 0, lastTime = globalThis.performance?.now?.() || Date.now();
  const publish = (extra = {}) => onProgress?.({ doneBytes, totalBytes, remainingBytes: Math.max(0, totalBytes - doneBytes), speedBytesPerSecond: speed.value, cached: networkFiles > 0 && cachedFiles === networkFiles, sourceLabel: extra.sourceLabel || '', ...extra });
  for (const file of files) {
    const path = String(file.path || ''), local = localUrls.get(path);
    if (local) { publish({ currentPath: path, currentCached: true, sourceLabel: '本地' }); continue; }
    networkFiles++;
    const candidates = candidateMap.get(path) || [];
    let blob = null, selected = '', cached = false, started = 0, lastError = null;
    for (let i = 0; i < candidates.length; i++) {
      const candidate = candidates[i];
      let fileBytes = 0;
      cached = false;
      const controller = typeof AbortController === 'function' ? new AbortController() : { signal: null, abort() {} };
      const abortSource = () => controller.abort();
      signal?.addEventListener?.('abort', abortSource, { once: true });
      try {
        const response = await withTimeout(fetch(candidate, controller.signal ? { signal: controller.signal } : undefined), stallMs, `源无响应 ${stallMs}ms`, abortSource);
        if (!response?.ok) throw new Error(`HTTP ${response?.status || 0}`);
        cached = likelyCached(candidate, response); if (cached) cachedFiles++;
        selected = candidate; started = globalThis.performance?.now?.() || Date.now();
        blob = await readResponse(response, Number(file.size) || 0, (chunk, fallback) => {
          fileBytes += chunk; doneBytes += chunk;
          const now = globalThis.performance?.now?.() || Date.now();
          const elapsed = Math.max(1, now - lastTime) / 1000;
          if (chunk > 0) speed.push(chunk / elapsed);
          lastTime = now;
          publish({ currentPath: path, currentCached: cached || fallback, sourceLabel: cached ? '缓存' : sourceLabel(selected) });
        }, stallMs, controller.signal, abortSource);
        break;
      } catch (error) {
        controller.abort(); signal?.removeEventListener?.('abort', abortSource);
        lastError = error;
        if (signal?.aborted || fileBytes > 0) { if (fileBytes > 0) error.partialBytes = fileBytes; throw error; }
        if (cached) cachedFiles = Math.max(0, cachedFiles - 1);
        blob = null;
        if (i + 1 < candidates.length) { const why = /HTTP \d+/.test(String(error?.message || '')) ? String(error.message) : '无响应'; publish({ currentPath: path, text: `${sourceLabel(candidate)} ${why}，切换到${sourceLabel(candidates[i + 1])}`, sourceLabel: sourceLabel(candidates[i + 1]) }); }
      } finally { signal?.removeEventListener?.('abort', abortSource); }
    }
    if (!blob) { const failure = new Error(`${path}：${lastError?.message || '所有下载源失败'}`); failure.allCandidatesFailed = true; failure.sourceLabel = sourceLabel(candidates.at(-1)); throw failure; }
    const objectUrl = URL.createObjectURL(blob); objectUrls.push(objectUrl); urls.set(path, objectUrl);
    const actual = Number(file.size) || blob.size;
    if (blob.size !== actual && doneBytes < totalBytes) doneBytes += Math.max(0, actual - blob.size);
    if (cached && !speed.value) speed.push(actual / Math.max(0.001, ((globalThis.performance?.now?.() || Date.now()) - started) / 1000));
    publish({ currentPath: path, currentCached: cached, sourceLabel: cached ? '缓存' : sourceLabel(selected) });
  }
  publish({ complete: true, cached: networkFiles > 0 && cachedFiles === networkFiles, sourceLabel: networkFiles > 0 && cachedFiles === networkFiles ? '缓存' : '' });
  return { urls, objectUrls, totalBytes, networkFiles, cachedFiles, revoke() { for (const url of objectUrls) URL.revokeObjectURL(url); } };
}

export function formatDownloadStats(stats) {
  if (!stats || !Number.isFinite(stats.totalBytes) || stats.totalBytes <= 0) return '';
  if (stats.cached) return `已缓存 ${formatBytes(stats.totalBytes)}${stats.sourceLabel ? ` · ${stats.sourceLabel}` : ''}`;
  const speed = stats.speedBytesPerSecond > 0 ? ` · ${formatBytes(stats.speedBytesPerSecond)}/s` : '';
  const source = stats.sourceLabel ? ` · ${stats.sourceLabel}` : '';
  return `${formatBytes(stats.doneBytes)} / ${formatBytes(stats.totalBytes)}（剩 ${formatBytes(stats.remainingBytes)}）${speed}${source}`;
}
