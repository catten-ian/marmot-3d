'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const sleep = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

class Param {
  constructor(value = 1) { this.value = value; this.events = []; }
  setValueAtTime(value, time) { this.value = value; this.events.push(['set', value, time]); }
  linearRampToValueAtTime(value, time) { this.value = value; this.events.push(['linear', value, time]); }
  cancelScheduledValues(time) { this.events.push(['cancel', time]); }
}
class Node {
  constructor() { this.gain = new Param(); this.connections = []; }
  connect(node) { this.connections.push(node); return node; }
  disconnect() { this.connections = []; }
}
class Source extends Node {
  constructor() { super(); this.started = []; this.stopped = []; }
  start(...args) { this.started.push(args); }
  stop(...args) { this.stopped.push(args); }
}
class Oscillator extends Source {
  constructor() { super(); this.frequency = new Param(440); this.type = 'sine'; }
}
class Context {
  constructor() { this.currentTime = 2; this.state = 'running'; this.sampleRate = 44100; this.destination = new Node(); this.sources = []; }
  createGain() { return new Node(); }
  createBufferSource() { const src = new Source(); this.sources.push(src); return src; }
  createOscillator() { const src = new Oscillator(); this.sources.push(src); return src; }
  decodeAudioData(bytes) { return Promise.resolve({ duration: 180, decodedByte: new Uint8Array(bytes)[0] }); }
  resume() { this.state = 'running'; return Promise.resolve(); }
}
const response = (status, body = null) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
  arrayBuffer: async () => Uint8Array.from([7, 8, 9]).buffer,
});

let mod;
test('PAF fallback retries a failed remote+local chain and promotes the real decoded asset after recovery', async (t) => {
  mod ||= await import('../src/systems/audio.js');
  let recovered = false;
  const requests = [];
  const audio = new mod.Audio({
    isBeta: true,
    storage: { getItem: () => null, setItem() {} },
    contextFactory: Context,
    fetchFn: async (url) => {
      requests.push(url);
      if (url.endsWith('/manifest.json')) {
        return response(200, { assets: { paf: { file: mod.BGM_ASSETS.paf }, menu: { file: mod.BGM_ASSETS.menu } } });
      }
      if (url === `${mod.TOS_AUDIO_BASE}elevenlabs/bgm/paf.mp3`) return recovered ? response(200) : response(503);
      if (url === mod.BGM_ASSETS.paf) return response(404);
      if (url === `${mod.TOS_AUDIO_BASE}elevenlabs/bgm/menu.mp3`) return response(200);
      if (url === mod.BGM_ASSETS.menu) return response(404);
      return response(404);
    },
  });
  audio.ensure();
  audio._bgmManager.fallbackRetryMs = 0;
  audio.setPafActive(true);
  for (let i = 0; i < 50 && !audio._bgmManager.current; i++) await sleep(2);
  const fallback = audio._bgmManager.current;
  assert.equal(fallback?.slot, 'paf');
  assert.equal(fallback?.sourceType, 'procedural-fallback');
  assert.deepEqual(requests.slice(-2), [
    `${mod.TOS_AUDIO_BASE}elevenlabs/bgm/paf.mp3`,
    mod.BGM_ASSETS.paf,
  ]);
  assert.equal(fallback.assetKey, 'paf');

  recovered = true;
  audio._bgmManager.request('paf');
  for (let i = 0; i < 50 && !audio._bgmManager.pending; i++) await sleep(2);
  assert.equal(audio._bgmManager.pending?.bufferOrProcedural?.duration, 180);
  assert.equal(fallback.source.stopped.length, 1);
  fallback.source.onended?.();
  const playing = audio._bgmManager.current;
  assert.equal(playing?.slot, 'paf');
  assert.equal(playing?.assetKey, 'paf');
  assert.equal(playing?.sourceType, 'elevenlabs-buffer');
  assert.equal(playing?.assetPath, mod.BGM_ASSETS.paf);
  assert.equal(playing?.source.buffer.duration, 180);
  assert.ok(requests.filter((url) => url.endsWith('/paf.mp3')).length >= 3, 'recovered URL was requested again');

  audio.setPafActive(false);
  assert.equal(audio._pafActive, false);
  assert.equal(audio._desiredBgmSlot, 'menu', 'PAF exit explicitly restores the title track slot');
  for (let i = 0; i < 50 && !audio._bgmManager.pending; i++) await sleep(2);
  assert.equal(audio._bgmManager.pending?.slot, 'menu');
  playing.source.onended?.();
  assert.equal(audio._bgmManager.current?.slot, 'menu');
  audio._bgmManager.current?.source.onended?.();
});

test('manifest failures and corrupt byte failures are not permanently cached', async () => {
  mod ||= await import('../src/systems/audio.js');
  let manifestReady = false;
  let assetReady = false;
  let manifestCalls = 0;
  const audio = new mod.Audio({
    isBeta: true,
    storage: { getItem: () => null, setItem() {} },
    fetchFn: async (url) => {
      if (url.endsWith('/manifest.json')) {
        manifestCalls += 1;
        if (!manifestReady) return response(503);
        return response(200, { assets: { paf: { file: mod.BGM_ASSETS.paf } } });
      }
      if (url.includes('/paf.mp3')) return assetReady ? response(200) : response(404);
      return response(404);
    },
  });
  assert.equal(await audio._readManifest('bgm'), null);
  manifestReady = true;
  const manifest = await audio._readManifest('bgm');
  assert.ok(manifest?.assets?.paf);
  assert.equal(manifestCalls, 3, 'one failed remote+local lookup then a recovered TOS manifest lookup');
  audio.ctx = new Context();
  assert.equal(await audio._loadBuffer(mod.BGM_ASSETS.paf, audio._bgmCache), null);
  assert.equal(audio._bgmCache.has(mod.BGM_ASSETS.paf), false);
  assetReady = true;
  assert.equal((await audio._loadBuffer(mod.BGM_ASSETS.paf, audio._bgmCache))?.duration, 180);
});

test('procedural gain analytically matches the -16 LUFS normalized PAF reference under default buses', async () => {
  mod ||= await import('../src/systems/audio.js');
  const filePeakGain = mod.resolveBgmPlaybackGain({ assetKey: 'paf', slot: 'paf' });
  const fallbackGain = mod.resolveBgmPlaybackGain({ procedural: true, assetKey: 'paf', slot: 'paf' });
  const referenceRms = mod.BGM_REFERENCE_RMS;
  const fileOutput = filePeakGain * referenceRms * (mod.AUDIO_DEFAULTS.bgmVolume / 100) * 0.32;
  const fallbackOutput = fallbackGain * mod.TRIANGLE_WAVE_RMS * (mod.AUDIO_DEFAULTS.bgmVolume / 100) * 0.32;
  assert.ok(Math.abs(fileOutput - fallbackOutput) < 1e-12);
  assert.ok(fallbackGain < filePeakGain * 0.3, 'fallback must compensate for the oscillator being continuously active');
  assert.equal(mod.PROCEDURAL_BGM_GAIN, referenceRms / mod.TRIANGLE_WAVE_RMS);
  assert.ok(Math.abs(mod.BGM_REFERENCE_DBFS + 17.251) < 0.002);
});

test('PAF settings route pauses/resumes PAF only and never touches ordinary game pause hooks', async () => {
  const { createSettingsPauseHooks } = await import('../src/core/settings-pause.mjs');
  let paused = false;
  let pafActive = true;
  const calls = [];
  const paf = { get active() { return pafActive; }, get paused() { return paused; }, setPaused(value) { calls.push(`paf:${value}`); paused = value; } };
  const hooks = createSettingsPauseHooks({ getPaf: () => paf, normal: {
    pause: () => calls.push('normal:pause'), resume: () => calls.push('normal:resume'), isPlaying: () => true,
  } });
  assert.equal(hooks.isPlaying(), true);
  assert.equal(hooks.isPaused(), false);
  hooks.pause();
  assert.equal(hooks.isPaused(), true);
  hooks.resume();
  assert.equal(hooks.isPaused(), false);
  assert.deepEqual(calls, ['paf:true', 'paf:false']);
  pafActive = false;
  hooks.pause();
  hooks.resume();
  assert.deepEqual(calls.slice(-2), ['normal:pause', 'normal:resume']);
});

test('PAF settings entry is visible above the touch controls and gated against pointer lock/input bleed', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../src/play/play-as-fox.js'), 'utf8');
  assert.match(source, /body\.play-as-fox #setBtn\s*\{\s*display:flex !important/);
  assert.match(source, /body\.play-as-fox #setSheet\s*\{\s*z-index:57 !important/);
  assert.match(source, /if \(!running \|\| paused\) return;/);
  assert.match(source, /document\.exitPointerLock\?\./);
  assert.match(source, /if \(paused \|\| !document\.getElementById\('setSheet'\)\?\.hidden\) return;/);
});
