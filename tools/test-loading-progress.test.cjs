const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function loadFormatLoadingBytes() {
  const source = fs.readFileSync('src/ui/hud.js', 'utf8');
  const match = source.match(/export function formatLoadingBytes\(value\) \{([\s\S]*?)\n\}/);
  assert.ok(match, 'formatLoadingBytes export should exist');
  return vm.runInNewContext(`(function formatLoadingBytes(value) {${match[1]}\n})`);
}

test('loading bytes are formatted for B, KiB and MiB', () => {
  const format = loadFormatLoadingBytes();
  assert.equal(format(12), '12 B');
  assert.equal(format(2048), '2.00 KiB');
  assert.equal(format(2 * 1024 * 1024), '2.00 MiB');
});

test('loading contract keeps progress monotonic and updates labels', () => {
  let width = '';
  let pct = '';
  let label = '';
  const setLoading = (value, text) => {
    const p = Math.max(0, Math.min(100, Number(value) || 0));
    if (p > setLoading.max) { setLoading.max = p; width = `${p}%`; pct = `${Math.round(p)}%`; }
    if (text) label = text;
  };
  setLoading.max = -1;
  setLoading(35, '初始化渲染器');
  setLoading(20, '读取清单');
  assert.equal(width, '35%');
  assert.equal(pct, '35%');
  assert.equal(label, '读取清单');
  setLoading(48, '加载场景资源');
  assert.equal(width, '48%');
  assert.equal(label, '加载场景资源');
});

test('audio preload reports one aggregated completion per job with mock fetch', async () => {
  const { Audio, BETA_AUDIO_RESOURCES } = await import('../src/systems/audio.js');
  const calls = [];
  const mockFetch = async (url) => {
    calls.push(String(url));
    return { ok: true, json: async () => ({ assets: {} }), arrayBuffer: async () => new ArrayBuffer(32) };
  };
  const events = [];
  const audio = new Audio({ isBeta: true, fetchFn: mockFetch, storage: null });
  const result = await audio.preload({ onProgress: (event) => events.push(event) });
  assert.equal(BETA_AUDIO_RESOURCES.length, 26);
  assert.equal(calls.length, 28);
  assert.deepEqual(events.map((event) => event.done), Array.from({ length: 28 }, (_, i) => i + 1));
  assert.ok(events.every((event) => event.total === 54));
  // Two manifests + 26 fetches complete; 26 genuine decodes still require a gesture.
  assert.equal(events.at(-1).done, events.at(-1).total - 26);
  assert.equal(result.fetched, 26);
  assert.equal(result.decoded, 0);
  assert.equal(result.ready, false);
  assert.equal(audio.ctx, null);
});

test('beta inline loader script contains quality override, auto selection and classic fallback', () => {
  const html = fs.readFileSync('index-public.html', 'utf8');
  assert.match(html, /__betaLoadingPickQuality/);
  assert.match(html, /forced === 'mobile' \|\| forced === 'desktop'/);
  assert.match(html, /max-width: 820px/);
  assert.match(html, /loader\.classList\.add\('classic'\)/);
});

test('watchdog text and recovery hooks are present', () => {
  const html = fs.readFileSync('index-public.html', 'utf8');
  assert.match(html, /Date\.now\(\) - lastProgressAt > 12000/);
  assert.match(html, /仍在加载，网络较慢，请稍候/);
  assert.match(html, /app:boot-progress/);
  assert.match(fs.readFileSync('src/ui/hud.js', 'utf8'), /watchdogStalled/);
});
