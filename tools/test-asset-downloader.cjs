const assert = require('assert');
(async () => {
  const m = await import('../src/world/asset-downloader.mjs');
  global.location = { href: 'https://site.test/' };
  let id = 0; global.URL.createObjectURL = () => `blob:test-${++id}`; global.URL.revokeObjectURL = () => {};
  const manifest = { files: [
    { path: 'scene.glb', size: 4 }, { path: 'unused.png', size: 99 },
  ], fileCount: 2 };
  const response = (bytes, status = 200, delay = 0) => ({ ok: status >= 200 && status < 300, status, body: { getReader() { let done = false; return { read: async () => { if (done) return { done: true }; done = true; if (delay) await new Promise(r => setTimeout(r, delay)); return { done: false, value: new Uint8Array(bytes) }; } }; } }, arrayBuffer: async () => new Uint8Array(bytes).buffer });
  const progress = [];
  let calls = [];
  global.fetch = async (url) => { calls.push(url); if (url.includes('tos')) throw new Error('reject'); return response([1,2,3,4]); };
  const out = await m.downloadVerdantPack(manifest, { baseUrl: 'https://site.test/assets/tiers/low/', scenePath: 'https://site.test/assets/tiers/low/scene.glb', candidatesForFile: () => ['https://tos.test/scene.glb', 'https://site.test/scene.glb'], onProgress: p => progress.push(p) });
  assert.strictEqual(out.networkFiles, 1); assert.deepStrictEqual(calls, ['https://tos.test/scene.glb', 'https://site.test/scene.glb']);
  assert(progress.some(p => p.sourceLabel === '源站')); assert(progress.at(-1).doneBytes === 4);
  calls = []; progress.length = 0;
  global.fetch = async (url) => { calls.push(url); return response([1,2,3,4], 200, 1); };
  await m.downloadVerdantPack({ files: [{ path: 'scene.glb', size: 4 }], fileCount: 1 }, { baseUrl: 'https://site.test/', scenePath: 'scene.glb', stallMs: 10, candidatesForFile: () => ['https://tos.test/scene.glb', 'https://site.test/scene.glb'], onProgress: p => progress.push(p) });
  assert.strictEqual(calls.length, 1); assert(progress.at(-1).doneBytes === 4);
  calls = [];
  global.fetch = async (url) => { calls.push(url); return response([1,2], url.includes('tos') ? 503 : 200); };
  await m.downloadVerdantPack({ files: [{ path: 'scene.glb', size: 2 }], fileCount: 1 }, { baseUrl: 'https://site.test/', scenePath: 'scene.glb', candidatesForFile: () => ['https://tos.test/scene.glb', 'https://site.test/scene.glb'] });
  assert.strictEqual(calls.length, 2);
  assert.strictEqual(m.formatBytes(52825048), '50.4 MiB');
  console.log('asset-downloader tests: ok (reject/non2xx switch, slow-live no switch, GLB-only, monotonic bytes, sourceLabel)');
})().catch(err => { console.error(err); process.exit(1); });
