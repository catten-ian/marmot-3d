'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const sleep = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

class FakeParam {
  constructor(value = 1) { this.value = value; this.events = []; }
  setValueAtTime(value, time) { this.value = value; this.events.push(['set', value, time]); }
  linearRampToValueAtTime(value, time) { this.value = value; this.events.push(['linear', value, time]); }
  exponentialRampToValueAtTime(value, time) { this.value = value; this.events.push(['exp', value, time]); }
  cancelScheduledValues(time) { this.events.push(['cancel', time]); }
}
class FakeNode {
  constructor() { this.connections = []; this.gain = new FakeParam(1); }
  connect(node) { this.connections.push(node); return node; }
  disconnect() { this.connections = []; }
}
class FakeSource extends FakeNode {
  constructor() { super(); this.started = []; this.stopped = []; this.loop = false; }
  start(time) { this.started.push(time); }
  stop(time) { this.stopped.push(time); }
}
class FakeContext {
  constructor() { this.currentTime = 5; this.sampleRate = 44100; this.state = 'running'; this.destination = new FakeNode(); this.sources = []; }
  createGain() { return new FakeNode(); }
  createBufferSource() { const source = new FakeSource(); this.sources.push(source); return source; }
  decodeAudioData() { return Promise.resolve({ duration: 0.4 }); }
  resume() { this.state = 'running'; return Promise.resolve(); }
}

let audio;
test('beta audio buses, percent clamp, settings persistence round trip', async (t) => {
  const mod = await import('../src/systems/audio.js');
  const store = new Map();
  const storage = {
    getItem(key) { return store.get(key) ?? null; },
    setItem(key, value) { store.set(key, String(value)); },
  };
  audio = new mod.Audio({ isBeta: true, storage, contextFactory: FakeContext, fetchFn: async () => ({ ok: true, json: async () => ({ assets: {} }) }) });
  assert.equal(audio.ensure(), true);
  assert.ok(audio.buses.master && audio.buses.sfx && audio.buses.bgm);
  assert.deepEqual(audio.buses.sfx.connections, [audio.buses.master]);
  assert.deepEqual(audio.buses.bgm.connections, [audio.buses.master]);
  assert.deepEqual(audio.buses.master.connections, [audio.ctx.destination]);
  assert.deepEqual(audio.getBusLevels(), { master: 0.32, sfx: 1, bgm: 0.38 });
  const stored = audio.setSettings({ masterVolume: 180, sfxVolume: -20, bgmVolume: 62, sfxEnabled: false });
  assert.equal(stored.masterVolume, 100);
  assert.equal(stored.sfxVolume, 0);
  assert.equal(stored.bgmVolume, 62);
  assert.equal(stored.sfxEnabled, false);
  assert.deepEqual(audio.getBusLevels(), { master: 0.32, sfx: 0, bgm: 0.62 });
  const restored = mod.readAudioSettings(storage);
  assert.deepEqual(restored, stored);
  assert.equal(mod.AUDIO_SETTINGS_KEY, 'marmot3d.audio.beta.v1');
  t.after(() => {});
});

test('all 17 legacy SFX names map and file/failure/offline decision is pure', async () => {
  const mod = await import('../src/systems/audio.js');
  assert.equal(mod.SFX_EVENT_NAMES.length, 17);
  for (const event of mod.SFX_EVENT_NAMES) assert.match(mod.SFX_ASSETS[event], /^assets\/audio\/sfx\/.+\.mp3$/);
  assert.equal(mod.SFX_ASSETS.kill, mod.SFX_ASSETS.repel, 'legacy kill alias reuses non-lethal repel asset');
  assert.equal(mod.selectSfxPlayback({ isBeta: true, enabled: true, fileAvailable: true }), 'file');
  assert.equal(mod.selectSfxPlayback({ isBeta: true, enabled: true, fileAvailable: false }), 'procedural');
  assert.equal(mod.selectSfxPlayback({ isBeta: true, enabled: true, fileAvailable: false, loadFailed: true }), 'procedural');
  assert.equal(mod.selectSfxPlayback({ isBeta: true, enabled: true, fileAvailable: false, offline: true }), 'procedural');
  assert.equal(mod.selectSfxPlayback({ isBeta: false, enabled: true, fileAvailable: true }), 'procedural');
  assert.equal(mod.selectSfxPlayback({ isBeta: true, enabled: false, fileAvailable: true }), 'silent');
});

test('static SFX file wins; missing/failing local file silently calls procedural fallback', async () => {
  const mod = await import('../src/systems/audio.js');
  const urls = [];
  const contextFactory = FakeContext;
  const fileAudio = new mod.Audio({
    isBeta: true,
    storage: { getItem: () => null, setItem() {} },
    contextFactory,
    fetchFn: async (url) => {
      urls.push(url);
      if (url.endsWith('manifest.json')) return { ok: true, json: async () => ({ assets: { hit: { file: mod.SFX_ASSETS.hit } } }) };
      return { ok: true, arrayBuffer: async () => new ArrayBuffer(8) };
    },
  });
  let fileFallbacks = 0;
  fileAudio._hit = () => { fileFallbacks++; };
  fileAudio.hit();
  await sleep(10);
  assert.equal(fileFallbacks, 0);
  assert.ok(urls.includes('assets/audio/sfx/manifest.json'));
  assert.ok(urls.includes(mod.SFX_ASSETS.hit));
  assert.ok(fileAudio.ctx.sources.some((source) => source.started.length === 1));

  const missingAudio = new mod.Audio({
    isBeta: true,
    storage: { getItem: () => null, setItem() {} },
    contextFactory,
    fetchFn: async (url) => {
      if (url.endsWith('manifest.json')) return { ok: true, json: async () => ({ assets: {} }) };
      throw new Error('offline');
    },
  });
  let missingFallbacks = 0;
  missingAudio._hit = () => { missingFallbacks++; };
  assert.doesNotThrow(() => missingAudio.hit());
  await sleep(10);
  assert.equal(missingFallbacks, 1);
});

test('BGM slots cover all six moods and switch through a timed crossfade', async () => {
  const mod = await import('../src/systems/audio.js');
  assert.deepEqual(mod.BGM_SLOTS, ['menu', 'explore', 'tension', 'combat', 'victory', 'defeat']);
  const states = [
    [{ mode: 'title' }, 'menu'],
    [{ mode: 'play', hp: 100, threats: 0, stress: 10 }, 'explore'],
    [{ mode: 'play', hp: 100, threats: 1, winding: true, stress: 10 }, 'tension'],
    [{ mode: 'play', hp: 100, threats: 1, combat: true }, 'combat'],
    [{ mode: 'levelclear' }, 'victory'],
    [{ mode: 'lost' }, 'defeat'],
  ];
  for (const [state, expected] of states) assert.equal(mod.selectBgmSlot(state), expected);

  const context = new FakeContext();
  const fakeAudio = {
    settings: { bgmEnabled: true }, enabled: true,
    ctx: context,
    buses: { bgm: new FakeNode() },
    _hasManifestAsset: async () => true,
    _loadBuffer: async () => ({ duration: 42 }),
  };
  const manager = new mod.BgmManager(fakeAudio, { crossfadeSeconds: 2.5 });
  manager.request('menu');
  await sleep(0);
  assert.equal(manager.current.slot, 'menu');
  assert.equal(manager.current.source.loop, true);
  manager.request('explore');
  await sleep(0);
  assert.equal(manager.current.slot, 'explore');
  assert.ok(manager.current.gain.gain.events.some((event) => event[0] === 'linear' && event[2] === 7.5));
  assert.ok(context.sources[0].stopped.some((when) => when === 7.54));
  assert.equal(mod.selectBgmSlot({ mode: 'pause' }), null);
});

test('same-family SFX concurrency and interval limits are enforced', async () => {
  const mod = await import('../src/systems/audio.js');
  const reservations = new Map();
  const cap2NoInterval = { impact: { maxConcurrent: 2, minIntervalMs: 0 } };
  assert.equal(mod.reserveSfxPlayback('hit', 100, reservations, cap2NoInterval), true);
  assert.equal(mod.reserveSfxPlayback('hurt', 100, reservations, cap2NoInterval), true);
  assert.equal(mod.reserveSfxPlayback('repel', 100, reservations, cap2NoInterval), false);
  mod.releaseSfxPlayback('hit', reservations);
  mod.releaseSfxPlayback('hurt', reservations);
  assert.equal(reservations.size, 0);
  assert.equal(mod.reserveSfxPlayback('swing', 100, reservations), true);
  assert.equal(mod.reserveSfxPlayback('swing', 110, reservations), false);
  mod.releaseSfxPlayback('swing', reservations);
});

test('provider scripts safely skip when no environment keys are present', () => {
  const root = path.resolve(__dirname, '..');
  for (const [key, script, expected] of [
    ['ELEVENLABS_API_KEY', 'tools/audio/gen-sfx-elevenlabs.mjs', 'ELEVENLABS_API_KEY 未设置'],
    ['MINIMAX_API_KEY', 'tools/audio/gen-bgm-minimax.mjs', 'MINIMAX_API_KEY 未设置'],
  ]) {
    const env = { ...process.env };
    delete env[key];
    const result = spawnSync(process.execPath, [script, '--dry-run'], { cwd: root, env, encoding: 'utf8', timeout: 5000 });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, new RegExp(expected));
  }
});
