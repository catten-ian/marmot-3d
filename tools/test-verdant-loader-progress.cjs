const assert = require('node:assert');
const path = require('node:path');

const modulePath = '../src/world/verdant-progress.mjs';

function makeStream(chunks, delayMs = 0) {
  let i = 0;
  return {
    getReader() {
      return {
        async read() {
          if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
          if (i >= chunks.length) return { done: true };
          const value = chunks[i++];
          return { done: false, value: new Uint8Array(value) };
        },
      };
    },
  };
}

function makeResponse(bytes, { status = 200, contentLength = null, chunkSize = 2, delayMs = 0 } = {}) {
  const chunks = [];
  for (let i = 0; i < bytes.length; i += chunkSize) chunks.push(bytes.slice(i, i + chunkSize));
  const headers = new Map();
  if (contentLength !== null) headers.set('content-length', String(contentLength));
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (key) => headers.get(String(key).toLowerCase()) ?? null },
    body: makeStream(chunks, delayMs),
    arrayBuffer: async () => new Uint8Array(bytes).buffer,
  };
}

(async () => {
  const m = await import(modulePath);

  // ---- formatBytes ----
  assert.strictEqual(m.formatBytes(0), '0 B');
  assert.strictEqual(m.formatBytes(512), '512 B');
  assert.strictEqual(m.formatBytes(1024), '1.00 KiB');
  assert.strictEqual(m.formatBytes(52825048), '50.4 MiB');
  assert.strictEqual(m.formatBytes(126547360), '121 MiB');

  // ---- SpeedEma ----
  const ema = new m.SpeedEma(0.5);
  assert.strictEqual(ema.value, 0);
  ema.push(100);
  assert.strictEqual(ema.value, 100);
  ema.push(200);
  assert.strictEqual(ema.value, 150);

  // ---- sourceLabelOf ----
  assert.strictEqual(m.sourceLabelOf('https://marmot.tos-cn-shanghai.volces.com/x'), 'TOS');
  assert.strictEqual(m.sourceLabelOf('https://www.catten.cyou/marmot3d/x'), '源站');
  assert.strictEqual(m.sourceLabelOf('blob:https://site.test/uuid'), '本地');

  // ---- isCachedResponse ----
  const realPerformance = globalThis.performance;
  globalThis.performance = { getEntriesByName: () => [{ transferSize: 0 }] };
  assert.strictEqual(m.isCachedResponse('https://x/y', { status: 200 }), true);
  globalThis.performance = { getEntriesByName: () => [{ transferSize: 4096 }] };
  assert.strictEqual(m.isCachedResponse('https://x/y', { status: 200 }), false);
  assert.strictEqual(m.isCachedResponse('https://x/y', { status: 304 }), true);
  globalThis.performance = realPerformance;

  // ---- createProgressReporter ----
  let now = 1000;
  const reporter = m.createProgressReporter({ now: () => now });
  reporter.setSource('TOS');
  reporter.setTotal(1000);
  reporter.addBytes(100);
  now += 1000;
  reporter.addBytes(100);
  const stats = reporter.publish();
  assert.strictEqual(stats.doneBytes, 200);
  assert.strictEqual(stats.totalBytes, 1000);
  assert.strictEqual(stats.remainingBytes, 800);
  assert.strictEqual(stats.sourceLabel, 'TOS');
  assert.ok(stats.speedBytesPerSecond > 0, '速度应大于 0');

  // ---- streamUrl：分块字节 + content-length ----
  const seen = [];
  let opened = null;
  const fetched = [];
  globalThis.fetch = async (url, init) => {
    fetched.push({ url, init });
    return makeResponse([1, 2, 3, 4, 5, 6], { contentLength: 6, chunkSize: 2 });
  };
  const streamed = await m.streamUrl('https://site.test/a.bin', {
    expectedSize: 6,
    onOpen: (info) => { opened = info; },
    onChunk: (bytes) => seen.push(bytes),
  });
  assert.deepStrictEqual(seen, [2, 2, 2]);
  assert.deepStrictEqual([...streamed.bytes], [1, 2, 3, 4, 5, 6]);
  assert.strictEqual(streamed.totalBytes, 6);
  assert.strictEqual(opened.totalBytes, 6);
  assert.strictEqual(fetched[0].init.cache, undefined, '未指定 cache 时不应带 cache 选项');

  // ---- streamUrl：cache 选项只作用于 http(s) ----
  fetched.length = 0;
  await m.streamUrl('https://site.test/b.bin', { cache: 'no-cache' });
  assert.strictEqual(fetched[0].init.cache, 'no-cache');

  // ---- fetchWithFailover：首源失败 → 切下一源 ----
  fetched.length = 0;
  const switches = [];
  globalThis.fetch = async (url) => {
    fetched.push(url);
    if (url.includes('tos')) throw new Error('源无响应 8000ms');
    return makeResponse([9, 9], { contentLength: 2 });
  };
  const switched = await m.fetchWithFailover(['https://tos.test/x', 'https://site.test/x'], {
    onSwitch: (info) => switches.push(info),
  });
  assert.deepStrictEqual(fetched, ['https://tos.test/x', 'https://site.test/x']);
  assert.strictEqual(switches.length, 1);
  assert.strictEqual(switches[0].from, 'https://tos.test/x');
  assert.strictEqual(switches[0].to, 'https://site.test/x');
  assert.deepStrictEqual([...switched.bytes], [9, 9]);

  // ---- fetchWithFailover：已收到部分字节则不换源，抛 partialBytes ----
  fetched.length = 0;
  globalThis.fetch = async (url) => {
    fetched.push(url);
    return {
      ok: true,
      status: 200,
      headers: { get: () => null },
      body: { getReader() { let done = false; return { async read() { if (done) return { done: true }; done = true; return { done: false, value: new Uint8Array([1]) }; } }; } },
      arrayBuffer: async () => new Uint8Array([1]).buffer,
    };
  };
  let partial = null;
  try {
    await m.fetchWithFailover(['https://tos.test/x', 'https://site.test/x'], {
      // 第一次读就成功，第二读抛错 → 模拟传输中途断流
      fetchImpl: async (url) => ({
        ok: true, status: 200, headers: { get: () => null },
        body: { getReader() { let n = 0; return { async read() { n++; if (n === 1) return { done: false, value: new Uint8Array([1, 2]) }; throw new Error('连接重置'); } }; } },
        arrayBuffer: async () => new Uint8Array([1, 2]).buffer,
      }),
    });
    assert.fail('应当抛出 partialBytes 错误');
  } catch (error) {
    partial = error;
  }
  assert.strictEqual(partial.partialBytes, 2, '部分字节数应被记录');
  assert.strictEqual(fetched.length, 0, '已收到字节后不应再尝试其它源');

  // ---- fetchWithFailover：全部源失败 ----
  globalThis.fetch = async () => { throw new Error('boom'); };
  let allFailed = null;
  try {
    await m.fetchWithFailover(['https://a.test/x', 'https://b.test/x']);
    assert.fail('应当抛出 allCandidatesFailed');
  } catch (error) { allFailed = error; }
  assert.strictEqual(allFailed.allCandidatesFailed, true);

  // ---- parseGltfReferences ----
  const refs = m.parseGltfReferences({
    buffers: [{ uri: 'verdant-trail-ultra.bin' }, { uri: 'data:application/octet-stream;base64,AA' }],
    images: [{ uri: 'textures/a.png' }, { uri: 'textures/a.png' }, { uri: 'data:image/png;base64,BB' }, { bufferView: 3 }],
  });
  assert.deepStrictEqual(refs, ['verdant-trail-ultra.bin', 'textures/a.png']);

  console.log('verdant-progress tests: ok (formatBytes/SpeedEma/sourceLabel/isCached/reporter/streamUrl/failover/partialBytes/glTF refs)');
})().catch((error) => { console.error(error); process.exit(1); });
