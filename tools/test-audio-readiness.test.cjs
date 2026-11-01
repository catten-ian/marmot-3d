'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const tick = () => new Promise((resolve) => setImmediate(resolve));
const load = () => import('../src/systems/audio.js');
const defer = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };

class Param {
  constructor() { this.value = 1; }
  setValueAtTime(value) { this.value = value; }
  linearRampToValueAtTime(value) { this.value = value; }
  cancelScheduledValues() {}
}
class Node {
  constructor() { this.gain = new Param(); }
  connect(node) { return node; }
  disconnect() {}
}
class Source extends Node {
  start() { this.started = true; }
  stop() { this.stopped = true; }
}
function harness(mod, { fetchAsset, decodeAsset, manifestFailure = false, fetchGate, decodeGate, resumeBlocked = false } = {}) {
  const calls = [], decodes = [], created = [], decodedArguments = [];
  const pathOf = (url) => url.startsWith(mod.TOS_AUDIO_BASE) ? `assets/audio/${url.slice(mod.TOS_AUDIO_BASE.length)}` : url;
  class Context {
    constructor() { this.state = 'suspended'; this.currentTime = 0; this.destination = new Node(); this.sources = []; this.resumes = 0; created.push(this); }
    createGain() { return new Node(); }
    createDynamicsCompressor() { return { ...Object.fromEntries(['threshold', 'knee', 'ratio', 'attack', 'release'].map((key) => [key, new Param()])), connect() {} }; }
    createWaveShaper() { return new Node(); }
    createBufferSource() { const source = new Source(); this.sources.push(source); return source; }
    async decodeAudioData(bytes) {
      const path = Buffer.from(bytes).toString();
      decodedArguments.push(bytes);
      decodes.push(path);
      // Match the browser's ownership transfer: the retained original must survive.
      structuredClone(bytes, { transfer: [bytes] });
      if (decodeGate) await decodeGate.promise;
      if (decodeAsset) await decodeAsset(path);
      return { duration: 1, path, real: true };
    }
    resume() {
      this.resumes++;
      if (resumeBlocked) return Promise.reject(new Error('autoplay denied'));
      this.state = 'running'; return Promise.resolve();
    }
    suspend() { this.state = 'suspended'; return Promise.resolve(); }
  }
  const audio = new mod.Audio({
    isBeta: true, storage: { getItem: () => null, setItem() {} }, contextFactory: Context,
    fetchFn: async (url) => {
      calls.push(url);
      const path = pathOf(url);
      if (url.endsWith('/manifest.json')) return { ok: !manifestFailure, status: 503, json: async () => ({ assets: {} }) };
      if (fetchGate) await fetchGate.promise;
      const response = await fetchAsset?.(path, url);
      if (response) return response;
      return { ok: true, arrayBuffer: async () => Uint8Array.from(Buffer.from(path)).buffer };
    },
  });
  let procedural = 0;
  audio._createProceduralBgm = () => { procedural++; return null; };
  const gesture = () => {
    const listeners = new Map();
    audio.bindUserGesture({ addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: (name) => listeners.delete(name) });
    listeners.get('pointerdown')();
    assert.equal(listeners.size, 0);
  };
  return { audio, calls, decodes, created, decodedArguments, pathOf, gesture, get procedural() { return procedural; } };
}

function inventoryCounts(mod) {
  assert.equal(mod.SFX_EVENT_NAMES.length, 17);
  assert.equal(new Set(Object.values(mod.SFX_ASSETS)).size, 16);
  assert.equal(mod.BETA_AUDIO_RESOURCES.length, 26);
  assert.equal(new Set(mod.BETA_AUDIO_RESOURCES.map(({ path }) => path)).size, 26);
  assert.deepEqual(new Set(mod.BETA_AUDIO_RESOURCES.filter(({ kind }) => kind === 'sfx').flatMap(({ keys }) => keys)), new Set(mod.SFX_EVENT_NAMES));
  assert.deepEqual(new Set(mod.BETA_AUDIO_RESOURCES.filter(({ kind }) => kind === 'bgm').flatMap(({ keys }) => keys)), new Set([...mod.BGM_SLOTS, 'combat-b', 'combat-c']));
  assert.deepEqual(mod.BETA_AUDIO_RESOURCES.find(({ path }) => path === mod.SFX_ASSETS.repel).keys, ['repel', 'kill']);
}

test('single immutable inventory covers 17 SFX events, 16 unique SFX files, all BGM/PAF and combat variants', async () => {
  const mod = await load(); inventoryCounts(mod);
  assert.ok(Object.isFrozen(mod.BETA_AUDIO_RESOURCES));
  for (const resource of mod.BETA_AUDIO_RESOURCES) { assert.ok(Object.isFrozen(resource)); assert.ok(Object.isFrozen(resource.keys)); }
  const { BGM_TRACK_META } = await import('../src/systems/bgm-tracks.mjs');
  for (const variant of BGM_TRACK_META.combat.variants) assert.ok(mod.BETA_AUDIO_RESOURCES.some(({ path }) => path === mod.BGM_ASSETS[variant]));
});

test('before a gesture preload only fetches real bytes; ready waits for all decodes and preserves detached input originals', async () => {
  const mod = await load(); const h = harness(mod); const { audio } = h;
  assert.equal(audio.getReadiness().status, 'idle');
  const prefetched = await audio.preload();
  assert.equal(h.created.length, 0); assert.equal(h.decodes.length, 0);
  assert.equal(prefetched.status, 'awaiting-context'); assert.equal(prefetched.ready, false);
  assert.equal(prefetched.fetched, 26); assert.equal(prefetched.decoded, 0);
  assert.equal(h.calls.length, 28); // 26 files + two manifests, exactly once
  assert.deepEqual(new Set(h.calls.filter((url) => !url.endsWith('/manifest.json')).map(h.pathOf)), new Set(mod.BETA_AUDIO_RESOURCES.map(({ path }) => path)));
  let settled = false;
  const ready = audio.whenReady(); ready.then(() => { settled = true; });
  assert.equal(audio.whenReady(), ready);
  await tick(); assert.equal(settled, false); assert.equal(h.created.length, 0);
  h.gesture();
  const state = await ready;
  assert.equal(state.ready, true); assert.equal(state.status, 'ready'); assert.equal(state.decoded, 26);
  assert.equal(state.unlocked, true); assert.equal(h.created.length, 1); assert.equal(h.decodes.length, 26);
  assert.equal(h.calls.length, 28);
  assert.equal(new Set(h.decodes).size, 26);
  assert.ok(h.decodedArguments.every((bytes) => bytes.byteLength === 0));
  assert.ok([...audio._assetBytesCache.values()].every(({ bytes }) => bytes.byteLength > 0));
  const snapshot = audio.getReadiness(); snapshot.resources[0].fetched = false; snapshot.resources[0].keys.length = 0;
  assert.equal(audio.getReadiness().fetched, 26); assert.ok(audio.getReadiness().resources[0].keys.length);
});

test('concurrent/repeated preload and ready calls share fetch/decode work, including a gesture while fetch is in flight', async () => {
  const mod = await load(); const fetchGate = defer(), decodeGate = defer();
  const h = harness(mod, { fetchGate, decodeGate }); const { audio } = h;
  const progress = [];
  const first = audio.preload({ onProgress: (event) => progress.push(event) });
  assert.equal(audio.preload(), first);
  const ready = audio.whenReady(); assert.equal(audio.whenReady(), ready);
  await tick(); assert.equal(audio.getReadiness().status, 'fetching');
  h.gesture(); assert.equal(audio.preload(), first);
  fetchGate.resolve(); await tick();
  assert.equal(audio.getReadiness().ready, false); assert.equal(audio.getReadiness().status, 'decoding');
  assert.equal(h.decodes.length, 26); assert.equal(audio.preload(), first);
  decodeGate.resolve(); await ready;
  assert.equal((await first).ready, true);
  const counts = [h.calls.length, h.decodes.length];
  assert.equal(audio.preload(), first); assert.equal(audio.whenReady(), ready);
  await audio.preload({ retry: true });
  assert.deepEqual([h.calls.length, h.decodes.length], counts); assert.deepEqual(counts, [28, 26]);
  assert.ok(progress.some(({ state }) => state.status === 'fetching'));
  assert.equal(progress.at(-1).done, 54); assert.equal(progress.at(-1).total, 54);
});

test('first PAF BGM and SFX after ready use decoded caches even when manifests omit those keys', async () => {
  const mod = await load(); const h = harness(mod); const { audio } = h;
  await audio.preload(); h.gesture(); await audio.whenReady(); await tick();
  assert.equal(audio._bgmManager.current.assetKey, 'menu');
  const counts = [h.calls.length, h.decodes.length];
  audio.setPafActive(true); await tick();
  const manager = audio._bgmManager;
  assert.equal(manager.pending.bufferOrProcedural, audio._decodedResources.get(mod.BGM_ASSETS.paf));
  manager.current.source.onended();
  assert.equal(manager.current.slot, 'paf'); assert.equal(manager.current.procedural, false);
  assert.equal(manager.current.source.buffer.path, mod.BGM_ASSETS.paf);
  let fallback = 0;
  assert.equal(audio._dispatchSfx('hit', () => { fallback++; }), true);
  await tick();
  audio.ctx.sources.at(-1).onended(); // finish hit before another event in the impact family
  assert.equal(audio._dispatchSfx('kill', () => { fallback++; }), true);
  await tick();
  assert.equal(fallback, 0); assert.equal(h.procedural, 0);
  const playing = audio.ctx.sources.filter(({ started }) => started).map(({ buffer }) => buffer?.path);
  assert.ok(playing.includes(mod.SFX_ASSETS.hit)); assert.ok(playing.includes(mod.SFX_ASSETS.kill));
  for (const resource of mod.BETA_AUDIO_RESOURCES) {
    const cache = resource.kind === 'bgm' ? audio._bgmCache : audio._sfxCache;
    assert.equal(await audio._loadBuffer(resource.path, cache), audio._decodedResources.get(resource.path));
  }
  assert.deepEqual([h.calls.length, h.decodes.length], counts);
});

test('fetch failures identify resource/stage/HTTP attempts; explicit retry only re-fetches failed items', async () => {
  const mod = await load(); let broken = true;
  const h = harness(mod, { fetchAsset: (path) => broken && path === mod.BGM_ASSETS.paf ? { ok: false, status: 503 } : null });
  const { audio } = h;
  const failed = await audio.preload();
  assert.equal(failed.status, 'failed'); assert.equal(failed.ready, false); assert.equal(failed.fetched, 25);
  const failure = failed.failures[0];
  assert.equal(failure.path, mod.BGM_ASSETS.paf); assert.equal(failure.kind, 'bgm'); assert.equal(failure.stage, 'fetch');
  assert.equal(failure.attempts.length, 2); assert.ok(failure.attempts.every(({ stage, message }) => stage === 'fetch' && message === 'HTTP 503'));
  await assert.rejects(audio.whenReady(), (error) => error instanceof mod.AudioReadinessError && error.state.failures[0].stage === 'fetch');
  h.gesture(); await audio.preload();
  assert.equal(audio.getReadiness().decoded, 25);
  const before = h.calls.length;
  await audio.preload(); assert.equal(h.calls.length, before);
  broken = false;
  const retry = audio.whenReady({ retry: true }); assert.equal(audio.whenReady({ retry: true }), retry);
  const state = await retry;
  assert.equal(state.ready, true); assert.deepEqual(state.failures, []); assert.equal(h.calls.length, before + 1);
  assert.equal(h.decodes.length, 26);
  for (const { path } of mod.BETA_AUDIO_RESOURCES.filter(({ path }) => path !== mod.BGM_ASSETS.paf)) assert.equal(h.calls.filter((url) => h.pathOf(url) === path).length, 1);
});

test('decode failures remain failed and reject ready; retry retains successful decoded assets and re-fetches bad bytes', async () => {
  const mod = await load(); let broken = true;
  const h = harness(mod, { decodeAsset: (path) => { if (broken && path === mod.SFX_ASSETS.hit) throw new Error('corrupt MP3'); } });
  const { audio } = h;
  await audio.preload(); audio.ensure();
  await assert.rejects(audio.whenReady(), (error) => {
    assert.equal(error.state.ready, false); assert.equal(error.state.decoded, 25);
    const failure = error.state.failures[0];
    assert.equal(failure.path, mod.SFX_ASSETS.hit); assert.equal(failure.stage, 'decode');
    assert.equal(failure.attempts.length, 2); assert.ok(failure.attempts.every(({ message }) => message === 'corrupt MP3'));
    return true;
  });
  assert.equal(h.decodes.filter((path) => path === mod.SFX_ASSETS.hit).length, 2);
  const successBuffer = audio._decodedResources.get(mod.BGM_ASSETS.paf);
  const counts = [h.calls.length, h.decodes.length];
  await audio.preload(); assert.deepEqual([h.calls.length, h.decodes.length], counts);
  broken = false;
  assert.equal((await audio.whenReady({ retry: true })).ready, true);
  assert.deepEqual([h.calls.length, h.decodes.length], [counts[0] + 1, counts[1] + 1]);
  assert.equal(audio._decodedResources.get(mod.BGM_ASSETS.paf), successBuffer);
});

test('HTTP 200 with empty bytes and successful manifests do not constitute readiness; failures can recover', async () => {
  const mod = await load(); let empty = true;
  const h = harness(mod, { fetchAsset: (path) => empty && path === mod.BGM_ASSETS.paf ? { ok: true, arrayBuffer: async () => new ArrayBuffer(0) } : null });
  const failed = await h.audio.preload();
  assert.equal(failed.ready, false); assert.equal(failed.status, 'failed'); assert.equal(failed.manifests.bgm, 'ready');
  assert.equal(failed.failures[0].stage, 'fetch'); assert.equal(failed.failures[0].path, mod.BGM_ASSETS.paf);
  assert.ok(failed.failures[0].attempts.every(({ message }) => message === 'empty or invalid audio bytes'));
  empty = false; await h.audio.preload({ retry: true });
  assert.equal(h.audio.getReadiness().ready, false);
  h.audio.ensure(); assert.equal((await h.audio.whenReady()).ready, true);
});

test('local bytes fetched before context are reused without remote refetch; advisory manifest failure is exposed', async () => {
  const mod = await load();
  const h = harness(mod, { manifestFailure: true, fetchAsset: (_, url) => url.startsWith(mod.TOS_AUDIO_BASE) ? { ok: false, status: 404 } : null });
  const fetched = await h.audio.preload();
  assert.equal(fetched.ready, false); assert.equal(fetched.fetched, 26); assert.equal(fetched.manifests.bgm, 'failed');
  const assetCalls = h.calls.filter((url) => !url.endsWith('/manifest.json')).length;
  h.audio.ensure(); const state = await h.audio.whenReady();
  assert.equal(state.ready, true); assert.deepEqual(state.failures, []);
  assert.equal(state.manifests.sfx, 'failed');
  assert.equal(h.calls.filter((url) => !url.endsWith('/manifest.json')).length, assetCalls);
  assert.equal(assetCalls, 52); assert.equal(h.decodes.length, 26);
});

test('zero volume/all audio disabled still fetch and decode everything; hidden pages stay suspended and muted', async () => {
  const mod = await load(); const h = harness(mod); const { audio } = h;
  audio.setSettings({ masterVolume: 0, sfxVolume: 0, bgmVolume: 0, sfxEnabled: false, bgmEnabled: false });
  audio.setEnabled(false); audio.handleVisibility(true);
  await audio.preload(); audio.ensure();
  const state = await audio.whenReady();
  assert.equal(state.ready, true); assert.equal(state.unlocked, false); assert.equal(audio.ctx.resumes, 0);
  assert.equal(state.decoded, 26); assert.equal(h.decodes.length, 26); assert.equal(h.calls.length, 28);
  assert.deepEqual(audio.getBusLevels(), { master: 0, sfx: 0, bgm: 0 });
  audio.handleVisibility(false);
  assert.equal(audio.ctx.state, 'running'); assert.equal(audio.master.gain.value, 0);
});

test('readiness does not bypass a rejected autoplay resume; Stable/Dev preload stays a no-op', async () => {
  const mod = await load(); const h = harness(mod, { resumeBlocked: true });
  await h.audio.preload(); const ready = h.audio.whenReady();
  assert.equal(h.created.length, 0); h.gesture();
  const state = await ready;
  assert.equal(state.ready, true); assert.equal(state.unlocked, false); assert.equal(h.audio.ctx.state, 'suspended');
  let operations = 0;
  const stable = new mod.Audio({ isBeta: false, contextFactory() { operations++; }, fetchFn() { operations++; } });
  assert.deepEqual(await stable.preload(), []);
  await assert.rejects(stable.whenReady(), mod.AudioReadinessError);
  assert.equal(stable.getReadiness().status, 'disabled'); assert.equal(stable.getReadiness().ready, false);
  assert.equal(operations, 0);
});


test('progress callbacks cannot forge ready or interrupt preload by mutating snapshots or throwing', async () => {
  const mod = await load(); const h = harness(mod);
  let settled = false;
  const ready = h.audio.whenReady({ onProgress: ({ state }) => { state.ready = true; state.failures.length = 0; throw new Error('observer'); } });
  ready.then(() => { settled = true; });
  await h.audio.preload(); await tick();
  assert.equal(settled, false); assert.equal(h.audio.getReadiness().ready, false);
  h.audio.ensure();
  assert.equal((await ready).ready, true); assert.equal(h.decodes.length, 26);
});

test('empty decode Promises, invalid decoded buffers and procedural objects never satisfy the ready gate', async () => {
  const mod = await load();
  for (const invalid of [undefined, null, { duration: 0 }, { duration: NaN }, { duration: Infinity }, { duration: 1, __proceduralBgm: true }]) {
    const h = harness(mod); await h.audio.preload(); h.audio.ensure();
    const original = h.audio.ctx.decodeAudioData.bind(h.audio.ctx);
    h.audio.ctx.decodeAudioData = (bytes) => Buffer.from(bytes).toString() === mod.BGM_ASSETS.paf ? Promise.resolve(invalid) : original(bytes);
    await assert.rejects(h.audio.whenReady(), (error) => {
      assert.equal(error.state.ready, false); assert.equal(error.state.decoded, 25);
      assert.equal(error.state.failures[0].path, mod.BGM_ASSETS.paf);
      assert.equal(error.state.failures[0].stage, 'decode');
      return true;
    });
  }
});
