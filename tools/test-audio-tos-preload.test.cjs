'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const sleep = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

class FakeParam {
  constructor() { this.value = 1; }
  setValueAtTime(value) { this.value = value; }
  linearRampToValueAtTime(value) { this.value = value; }
  cancelScheduledValues() {}
}
class FakeNode {
  constructor() { this.gain = new FakeParam(); }
  connect(node) { return node; }
  disconnect() {}
}
class FakeSource extends FakeNode {
  start() { this.started = true; }
  stop() {}
}
class FakeContext {
  constructor() {
    this.currentTime = 0;
    this.state = 'suspended';
    this.destination = new FakeNode();
    this.sources = [];
    this.decoded = [];
  }
  createGain() { return new FakeNode(); }
  createBufferSource() { const source = new FakeSource(); this.sources.push(source); return source; }
  decodeAudioData(bytes) { this.decoded.push(bytes); return Promise.resolve({ duration: 180 }); }
  resume() { this.state = 'running'; return Promise.resolve(); }
}

async function loadModule() { return import('../src/systems/audio.js'); }
function betaAudio(mod, fetchFn) {
  return new mod.Audio({
    isBeta: true,
    storage: { getItem: () => null, setItem() {} },
    fetchFn,
    contextFactory: FakeContext,
  });
}
function bytes(value) { return Uint8Array.from([value]).buffer; }

test('beta URL candidates put TOS before the unchanged local path', async () => {
  const mod = await loadModule();
  assert.deepEqual(mod.audioAssetCandidates('assets/audio/bgm/menu.mp3', true), [
    'https://marmot.tos-cn-shanghai.volces.com/audio/bgm/menu.mp3',
    'assets/audio/bgm/menu.mp3',
  ]);
  assert.deepEqual(mod.audioAssetCandidates('assets/audio/sfx/manifest.json', true), [
    'https://marmot.tos-cn-shanghai.volces.com/audio/sfx/manifest.json',
    'assets/audio/sfx/manifest.json',
  ]);
  assert.deepEqual(mod.audioAssetCandidates('assets/audio/bgm/menu.mp3', false), [
    'assets/audio/bgm/menu.mp3',
  ]);
});

test('network errors fall back from TOS to local bytes', async () => {
  const mod = await loadModule();
  const calls = [];
  const audio = betaAudio(mod, async (url) => {
    calls.push(url);
    if (url.startsWith(mod.TOS_AUDIO_BASE)) throw new Error('offline');
    return { ok: true, arrayBuffer: async () => bytes(2) };
  });
  audio.ctx = new FakeContext();
  assert.ok(await audio._loadBuffer(mod.SFX_ASSETS.hit, audio._sfxCache));
  assert.deepEqual(calls, [
    `${mod.TOS_AUDIO_BASE}elevenlabs/sfx/hit.mp3`,
    mod.SFX_ASSETS.hit,
  ]);
});

test('non-2xx manifest responses fall back to the local manifest', async () => {
  const mod = await loadModule();
  const calls = [];
  const expected = { assets: { menu: { file: mod.BGM_ASSETS.menu } } };
  const audio = betaAudio(mod, async (url) => {
    calls.push(url);
    if (url.startsWith(mod.TOS_AUDIO_BASE)) return { ok: false, status: 503 };
    return { ok: true, json: async () => expected };
  });
  assert.equal(await audio._readManifest('bgm'), expected);
  assert.deepEqual(calls, [
    `${mod.TOS_AUDIO_BASE}elevenlabs/bgm/manifest.json`,
    'assets/audio/elevenlabs/bgm/manifest.json',
  ]);
});

test('decodeAudioData failure retries with local bytes', async () => {
  const mod = await loadModule();
  const calls = [];
  const audio = betaAudio(mod, async (url) => {
    calls.push(url);
    return { ok: true, arrayBuffer: async () => bytes(url.startsWith(mod.TOS_AUDIO_BASE) ? 1 : 2) };
  });
  audio.ctx = new FakeContext();
  audio.ctx.decodeAudioData = async (data) => {
    if (new Uint8Array(data)[0] === 1) throw new Error('bad remote MP3');
    return { duration: 1, local: true };
  };
  const buffer = await audio._loadBuffer(mod.SFX_ASSETS.hit, audio._sfxCache);
  assert.equal(buffer.local, true);
  assert.deepEqual(calls, [`${mod.TOS_AUDIO_BASE}elevenlabs/sfx/hit.mp3`, mod.SFX_ASSETS.hit]);
});

test('request timeout falls back to local bytes', async () => {
  const mod = await loadModule();
  const calls = [];
  const audio = betaAudio(mod, async (url, options) => {
    calls.push(url);
    if (url.startsWith(mod.TOS_AUDIO_BASE)) {
      return new Promise(() => {});
    }
    return { ok: true, arrayBuffer: async () => bytes(2) };
  });
  audio.ctx = new FakeContext();
  assert.ok(await audio._loadBetaBuffer(mod.SFX_ASSETS.hit, audio._sfxCache, 5));
  assert.deepEqual(calls, [`${mod.TOS_AUDIO_BASE}elevenlabs/sfx/hit.mp3`, mod.SFX_ASSETS.hit]);
});

test('startup prefetch runs without a gesture and gesture decodes cached menu bytes', async () => {
  const mod = await loadModule();
  const calls = [];
  const audio = betaAudio(mod, async (url) => {
    calls.push(url);
    if (url.endsWith('/manifest.json')) {
      const assets = url.includes('/bgm/') ? { menu: { file: mod.BGM_ASSETS.menu } } : {};
      return { ok: true, json: async () => ({ assets }) };
    }
    return { ok: true, arrayBuffer: async () => bytes(7) };
  });
  await audio.preload();
  assert.equal(audio.ctx, null, 'prefetch must not create AudioContext');
  // 进场阶段预取全部 BGM 槽位（不再只 menu），保证切状态不临时下载。
  assert.deepEqual(calls, [
    `${mod.TOS_AUDIO_BASE}elevenlabs/bgm/manifest.json`,
    `${mod.TOS_AUDIO_BASE}elevenlabs/sfx/manifest.json`,
    ...['menu', 'explore', 'tension', audio._preloadCombatVariant, 'night', 'victory', 'defeat'].map((slot) => `${mod.TOS_AUDIO_BASE}elevenlabs/bgm/${slot}.mp3`),
  ]);

  const listeners = new Map();
  const target = {
    addEventListener(name, fn) { listeners.set(name, fn); },
    removeEventListener(name) { listeners.delete(name); },
  };
  audio.bindUserGesture(target);
  listeners.get('pointerdown')();
  for (let i = 0; i < 20 && !audio._bgmManager?.current; i++) await sleep();
  assert.equal(audio.ctx.state, 'running');
  assert.equal(audio._bgmManager.current.slot, 'menu');
  assert.equal(audio.ctx.decoded.length, 1);
  assert.equal(new Uint8Array(audio.ctx.decoded[0])[0], 7);
  assert.equal(calls.filter((url) => url.endsWith('bgm/menu.mp3')).length, 1, 'gesture must not refetch menu');
});

test('non-beta preload and buffer loading never touch TOS', async () => {
  const mod = await loadModule();
  const calls = [];
  const audio = new mod.Audio({ isBeta: false, fetchFn: async (url) => {
    calls.push(url);
    return { ok: true, arrayBuffer: async () => bytes(3) };
  } });
  await audio.preload();
  assert.deepEqual(calls, []);
  audio.ctx = new FakeContext();
  assert.ok(await audio._loadBuffer(mod.SFX_ASSETS.hit, audio._sfxCache));
  assert.deepEqual(calls, [mod.SFX_ASSETS.hit]);
  assert.equal(calls.some((url) => url.startsWith(mod.TOS_AUDIO_BASE)), false);
});
