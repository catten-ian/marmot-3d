/**
 * Dev Verdant 加载进度：字节 / 速度 / 剩余统计，以及多源「无字节即换源」故障切换。
 *
 * 背景：20261023 的「加载页显示真实字节/速度/剩余」与 20261024 的「8s 无字节切源站」
 * 都在 a1de0d1 用旧版 verdant.js 覆盖时丢了接线（downloadVerdantPack 变成零调用者的
 * 死代码），加载页只剩百分比；大文件下载期间 onProgress 一次都不触发，
 * main.js 的 25s 停滞看门狗因此误杀，表现为「加载停滞 8%」。
 *
 * 本模块把那段能力以纯逻辑形式重建：不依赖 DOM / three，可在 Node 下直接单测。
 */

/** 字节数 → 人类可读。 */
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

/** 速度指数滑动平均，避免瞬时抖动让速度数字乱跳。 */
export class SpeedEma {
  constructor(alpha = 0.22) {
    this.alpha = Math.max(0.01, Math.min(1, alpha));
    this.value = 0;
  }
  push(sample) {
    const n = Math.max(0, Number(sample) || 0);
    this.value = this.value ? this.value * (1 - this.alpha) + n * this.alpha : n;
    return this.value;
  }
}

/** 下载源标签：本地资源包 / 火山 TOS / 同源服务器。 */
export function sourceLabelOf(url) {
  const u = String(url || '');
  if (/^blob:/i.test(u)) return '本地';
  if (/tos-cn-shanghai|volces\.com|\btos\b/i.test(u)) return 'TOS';
  return '源站';
}

/**
 * 响应是否命中浏览器缓存。
 * 磁盘缓存再验证(304) 与内存缓存命中都会表现为 transferSize === 0，
 * 二次进入时应稳定显示「已缓存」而不是闪出瞬时假速度。
 */
export function isCachedResponse(url, response) {
  if (response?.status === 304) return true;
  try {
    const entries = globalThis.performance?.getEntriesByName?.(url) || [];
    return entries.some((entry) => entry.transferSize === 0);
  } catch (_) { return false; }
}

function withTimeout(promise, ms, message, onTimeout = null) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      try { onTimeout?.(); } catch (_) { /* 忽略 */ }
      reject(new Error(message));
    }, ms);
  });
  return Promise.race([promise, timeout]).then(
    (value) => { clearTimeout(timer); return value; },
    (error) => { clearTimeout(timer); throw error; },
  );
}

function concatChunks(chunks, total) {
  if (chunks.length === 1 && chunks[0].byteLength === total) return chunks[0];
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { out.set(chunk, offset); offset += chunk.byteLength; }
  return out;
}

/**
 * 加载进度累加器。产出 HUD 需要的字段：
 * doneBytes / totalBytes / remainingBytes / speedBytesPerSecond / cached / sourceLabel。
 */
export function createProgressReporter({ onProgress, now = () => Date.now() } = {}) {
  const speed = new SpeedEma();
  let doneBytes = 0;
  let totalBytes = 0;
  let lastAt = now();
  let source = '';

  const publish = (extra = {}) => {
    const stats = {
      doneBytes,
      totalBytes,
      remainingBytes: Math.max(0, totalBytes - doneBytes),
      speedBytesPerSecond: speed.value,
      cached: !!extra.cached,
      sourceLabel: extra.sourceLabel ?? source,
      ...extra,
    };
    try { if (globalThis.window) globalThis.window.__verdantLastDownloadStats = stats; } catch (_) { /* 忽略 */ }
    onProgress?.(stats);
    return stats;
  };

  return {
    publish,
    setSource(label) { source = label || source; return source; },
    setTotal(bytes) { totalBytes = Math.max(totalBytes, Math.max(0, Number(bytes) || 0)); return totalBytes; },
    addBytes(count) {
      const n = Math.max(0, Number(count) || 0);
      doneBytes += n;
      const at = now();
      const elapsed = Math.max(1, at - lastAt) / 1000;
      if (n > 0) speed.push(n / elapsed);
      lastAt = at;
      return doneBytes;
    },
    get doneBytes() { return doneBytes; },
    get totalBytes() { return totalBytes; },
    snapshot() {
      return {
        doneBytes, totalBytes,
        remainingBytes: Math.max(0, totalBytes - doneBytes),
        speedBytesPerSecond: speed.value,
        sourceLabel: source,
      };
    },
  };
}

/**
 * 流式下载一个资源，返回 { bytes, totalBytes, cached, url }。
 *
 * - 首个字节超过 stallMs → 判定该源故障（调用方换下一个源）。
 * - 传输中途超过 idleMs 无字节 → 同样判故障。
 * - onChunk 逐块回调，用于实时驱动加载页的字节/速度显示。
 */
export async function streamUrl(url, {
  signal = null,
  stallMs = 8000,
  idleMs = 60000,
  expectedSize = 0,
  cache = '',
  fetchImpl = globalThis.fetch,
  onOpen = null,
  onChunk = null,
} = {}) {
  const controller = typeof AbortController === 'function' ? new AbortController() : { signal: null, abort() {} };
  const abortSource = () => { try { controller.abort(); } catch (_) { /* 忽略 */ } };
  signal?.addEventListener?.('abort', abortSource, { once: true });
  try {
    const init = {};
    if (controller.signal) init.signal = controller.signal;
    // 'no-cache' 走条件验证（ETag → 304 零字节）：内容永远新鲜，且未变时不重复下载。
    if (cache && /^https?:/i.test(String(url || ''))) init.cache = cache;
    const response = await withTimeout(
      fetchImpl(url, init),
      stallMs,
      `源无响应 ${stallMs}ms`,
      abortSource,
    );
    if (!response?.ok) throw new Error(`HTTP ${response?.status || 0}`);
    const header = Number(response.headers?.get?.('content-length')) || 0;
    const total = expectedSize > 0 ? expectedSize : header;
    onOpen?.({ totalBytes: total, cached: false });

    if (!response.body || typeof response.body.getReader !== 'function') {
      // 无流式接口的内核：拿不到中间进度，但仍要报出总字节，避免加载页永远 0%。
      const buffer = new Uint8Array(await response.arrayBuffer());
      onChunk?.(buffer.byteLength);
      return { bytes: buffer, totalBytes: total || buffer.byteLength, cached: isCachedResponse(url, response), url };
    }

    const reader = response.body.getReader();
    const chunks = [];
    let loaded = 0;
    let first = true;
    for (;;) {
      const read = reader.read();
      const part = await withTimeout(
        read,
        first ? stallMs : idleMs,
        first ? `首字节无响应 ${stallMs}ms` : `传输停滞 ${idleMs}ms`,
        abortSource,
      );
      first = false;
      if (part.done) break;
      if (part.value?.byteLength) {
        chunks.push(part.value);
        loaded += part.value.byteLength;
        onChunk?.(part.value.byteLength);
      }
    }
    // 缓存判定放在响应体读完之后：资源计时条目（transferSize）此时才写入 performance。
    return { bytes: concatChunks(chunks, loaded), totalBytes: total || loaded, cached: isCachedResponse(url, response), url };
  } finally {
    signal?.removeEventListener?.('abort', abortSource);
  }
}

/**
 * 依次尝试多个下载源：某源无字节 / 报错时切下一个源。
 *
 * 已收到部分字节的源不再换源（避免同一个大文件重复下载半截），
 * 改为把 partialBytes 挂到错误上抛出，由上层决定是否重试整档。
 */
export async function fetchWithFailover(urls, {
  signal = null,
  stallMs = 8000,
  idleMs = 60000,
  expectedSize = 0,
  cache = '',
  fetchImpl = globalThis.fetch,
  onOpen = null,
  onChunk = null,
  onSwitch = null,
} = {}) {
  const errors = [];
  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    let loaded = 0;
    try {
      const result = await streamUrl(url, {
        signal,
        stallMs,
        idleMs,
        expectedSize,
        cache,
        fetchImpl,
        onOpen,
        onChunk: (bytes) => { loaded += bytes; onChunk?.(bytes); },
      });
      return { ...result, index: i, errors };
    } catch (error) {
      errors.push(`${url}: ${error.message}`);
      if (signal?.aborted) { error.partialBytes = loaded; throw error; }
      if (loaded > 0) { error.partialBytes = loaded; throw error; }
      if (i + 1 < urls.length) onSwitch?.({ from: url, to: urls[i + 1], error });
    }
  }
  const failure = new Error(`所有下载源失败：${errors.join(' | ')}`);
  failure.allCandidatesFailed = true;
  failure.sourceLabel = sourceLabelOf(urls.at(-1));
  throw failure;
}

/**
 * 从 glTF JSON 中取出运行时真正需要的外部资源 URI。
 * 排除 data: 内联资源；buffers 与 images 都要收。
 */
export function parseGltfReferences(json) {
  const out = [];
  for (const buffer of Array.isArray(json?.buffers) ? json.buffers : []) {
    if (typeof buffer?.uri === 'string' && !buffer.uri.startsWith('data:')) out.push(buffer.uri);
  }
  for (const image of Array.isArray(json?.images) ? json.images : []) {
    if (typeof image?.uri === 'string' && !image.uri.startsWith('data:')) out.push(image.uri);
  }
  return [...new Set(out)];
}
