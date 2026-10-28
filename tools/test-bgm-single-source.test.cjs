'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

function trackedBgmHarness({ loadBuffer = async () => ({ duration: 30 }) } = {}) {
  const active = new Set();
  const sources = [];
  let maxActive = 0;
  const makeParam = () => ({
    value: 0,
    cancelScheduledValues() {},
    setValueAtTime(value) { this.value = value; },
    linearRampToValueAtTime(value) { this.value = value; },
  });
  const context = {
    currentTime: 0,
    destination: {},
    advanceTo(time) {
      this.currentTime = time;
      for (const source of sources) {
        if (source.running && source.stopAt != null && source.stopAt <= time) source.finish();
      }
    },
    createBufferSource() {
      const source = {
        loop: false,
        started: [],
        stopped: [],
        connect() {},
        disconnect() { this.disconnected = true; },
        start(...args) {
          this.started.push(args);
          this.running = true;
          active.add(this);
          maxActive = Math.max(maxActive, active.size);
        },
        finish() {
          if (!this.running) return;
          this.running = false;
          active.delete(this);
          this.onended?.();
        },
        stop(...args) {
          this.stopped.push(args);
          this.stopAt = args.length ? args[0] : context.currentTime;
          if (this.stopAt <= context.currentTime) this.finish();
        },
      };
      sources.push(source);
      return source;
    },
    createGain() { return { gain: makeParam(), connect() {}, disconnect() {} }; },
  };
  const audio = {
    ctx: context,
    buses: { bgm: {} },
    settings: { bgmEnabled: true },
    _bgmCache: new Map(),
    _hasManifestAsset: async () => true,
    _loadBuffer: loadBuffer,
  };
  return {
    audio, active, sources,
    get maxActive() { return maxActive; },
  };
}

const nextTurn = () => new Promise((resolve) => setImmediate(resolve));

test('BGM switch stops the old source before starting its replacement', async () => {
  const { BgmManager } = await import('../src/systems/audio.js');
  const harness = trackedBgmHarness();
  const manager = new BgmManager(harness.audio);

  manager.request('menu');
  await nextTurn();
  const oldSource = manager.current.source;
  assert.equal(harness.active.size, 1);

  manager.request('night');
  await nextTurn();
  assert.equal(manager.current.source, oldSource, 'new source waits during the old source exit');
  assert.equal(manager.pending.slot, 'night');
  assert.equal(harness.sources.length, 1, 'new source is not created before the old one ends');
  assert.equal(oldSource.stopped.length, 1, 'old looping source receives source.stop()');
  assert.deepEqual(oldSource.stopped[0], [1.5], 'stop follows the serialized 1.5s fade-out exit');
  assert.equal(oldSource.running, true, 'the old source alone runs during its exit');
  assert.equal(harness.active.size, 1);
  harness.audio.ctx.advanceTo(1.5);
  assert.equal(manager.current.slot, 'night');
  assert.equal(oldSource.running, false);
  assert.equal(oldSource.disconnected, true);
  assert.equal(harness.active.size, 1, 'the new source starts after the old source ends');
  assert.equal(harness.maxActive, 1);
});

test('rapid A to B to C requests do not start stale tracks or leak sources', async () => {
  const { BgmManager } = await import('../src/systems/audio.js');
  const deferred = new Map();
  const harness = trackedBgmHarness({
    loadBuffer: (path) => new Promise((resolve) => deferred.set(path, resolve)),
  });
  const manager = new BgmManager(harness.audio);
  const pathFor = (slot) => `assets/audio/elevenlabs/bgm/${slot}.mp3`;

  manager.request('menu');
  await nextTurn();
  deferred.get(pathFor('menu'))({ duration: 30 });
  await nextTurn();
  const firstSource = manager.current.source;

  manager.request('explore');
  manager.request('night');
  await nextTurn();
  deferred.get(pathFor('explore'))({ duration: 30 });
  deferred.get(pathFor('night'))({ duration: 30 });
  await nextTurn();

  assert.equal(manager.current.source, firstSource);
  assert.equal(manager.pending.slot, 'night');
  assert.equal(harness.sources.length, 1, 'neither stale B nor pending C is created during A exit');
  assert.equal(firstSource.stopped.length, 1);
  assert.equal(harness.active.size, 1);
  harness.audio.ctx.advanceTo(1.5);
  assert.equal(manager.current.slot, 'night');
  assert.equal(harness.sources.length, 2, 'stale B was never created; only A and final C exist');
  assert.equal(firstSource.disconnected, true);
  assert.equal(harness.active.size, 1);
  assert.equal(harness.active.has(manager.current.source), true);
  assert.equal(harness.maxActive, 1);
});

test('combat slot re-entry advances the combat asset variant while same-slot updates keep it', async () => {
  const { BgmManager } = await import('../src/systems/audio.js');
  const harness = trackedBgmHarness();
  const manager = new BgmManager(harness.audio);
  const originalRandom = Math.random;
  Math.random = () => 0;
  try {
    manager.request('combat');
    await nextTurn();
    assert.equal(manager.current.assetKey, 'combat');
    const firstSource = manager.current.source;

    manager.request('combat');
    await nextTurn();
    assert.equal(manager.current.source, firstSource, 'repeated combat state does not interrupt/reroll a live fight');

    manager.request('combat', true);
    await nextTurn();
    assert.equal(manager.current.source, firstSource, 'forced combat variant waits behind the current source');
    assert.equal(manager.pending.assetKey, 'combat-b');
    harness.audio.ctx.advanceTo(firstSource.stopAt);
    assert.equal(manager.current.assetKey, 'combat-b');

    manager.request('explore');
    await nextTurn();
    const outgoing = manager.current;
    assert.equal(outgoing.retiring, true);
    harness.audio.ctx.advanceTo(outgoing.fade.end);
    manager.request('combat');
    await nextTurn();
    assert.equal(manager.current.slot, 'explore');
    harness.audio.ctx.advanceTo(manager.current.source.stopAt);
    assert.equal(manager.current.assetKey, 'combat', 'entering combat again selects a different variant');
    assert.equal(firstSource.stopped.length, 1);
    assert.equal(harness.active.size, 1);
    assert.equal(harness.maxActive, 1);
  } finally {
    Math.random = originalRandom;
  }
});

test('PAF transition stays single-source and Audio.setSettings releases BGM when disabled', async () => {
  const { Audio } = await import('../src/systems/audio.js');
  const harness = trackedBgmHarness();
  const contextFactory = function FakeContextFactory() { return harness.audio.ctx; };
  const audio = new Audio({
    isBeta: true,
    storage: { getItem: () => null, setItem() {} },
    contextFactory,
    fetchFn: async () => ({ ok: false }),
  });
  audio._hasManifestAsset = async () => true;
  audio._loadBuffer = async () => ({ duration: 30 });
  assert.equal(audio.ensure(), true);
  audio.updateBgmState({ mode: 'play' });
  await nextTurn();
  const exploreSource = audio._bgmManager.current.source;
  audio.setPafActive(true);
  await nextTurn();
  assert.equal(audio._bgmManager.current.source, exploreSource);
  assert.equal(audio._bgmManager.pending.assetKey, 'paf');
  assert.equal(exploreSource.stopped.length, 1);
  assert.equal(harness.active.size, 1);
  harness.audio.ctx.advanceTo(exploreSource.stopAt);
  const pafSource = audio._bgmManager.current.source;
  assert.equal(audio._bgmManager.current.assetKey, 'paf');
  assert.equal(harness.active.size, 1);
  assert.equal(harness.maxActive, 1);

  audio.setSettings({ bgmEnabled: false }, { persist: false });
  assert.equal(audio.getAudioSettings().bgmEnabled, false);
  assert.equal(audio.bgmBus.gain.value, 0, 'the BGM bus is muted immediately');
  assert.equal(pafSource.stopped.length, 1);
  assert.equal(audio._bgmManager.current, null);
  assert.equal(harness.active.size, 0);
  assert.equal(harness.maxActive, 1);
});

test('disabling BGM cancels pending loads so they cannot start after mute', async () => {
  const { BgmManager } = await import('../src/systems/audio.js');
  let resolveBuffer;
  const harness = trackedBgmHarness({ loadBuffer: () => new Promise((resolve) => { resolveBuffer = resolve; }) });
  const manager = new BgmManager(harness.audio);

  manager.request('menu');
  await nextTurn();
  manager.setEnabled(false);
  resolveBuffer({ duration: 30 });
  await nextTurn();

  assert.equal(manager.current, null);
  assert.equal(harness.sources.length, 0);
  assert.equal(harness.active.size, 0);
});

test('stable/dev Audio never creates or starts the beta BGM manager', async () => {
  const { Audio } = await import('../src/systems/audio.js');
  const harness = trackedBgmHarness();
  const contextFactory = function FakeContextFactory() { return harness.audio.ctx; };
  const stableAudio = new Audio({ isBeta: false, contextFactory, fetchFn: async () => ({ ok: false }) });
  assert.equal(stableAudio.ensure(), true);
  assert.equal(stableAudio._bgmManager, null);
  assert.equal(stableAudio.updateBgmState({ mode: 'title' }), null);
  assert.equal(harness.sources.length, 0);
  assert.equal(harness.active.size, 0);
});

test('procedural BGM loop timer and source graph are released after a serialized switch', async () => {
  const { BgmManager } = await import('../src/systems/audio.js');
  const harness = trackedBgmHarness();
  const manager = new BgmManager(harness.audio);
  let ticks = 0;
  const loopTimer = setInterval(() => { ticks += 1; }, 2);
  const proceduralSource = harness.audio.ctx.createBufferSource();
  const proceduralGain = harness.audio.ctx.createGain();
  const procedural = {
    __proceduralBgm: true,
    source: proceduralSource,
    gain: proceduralGain,
    loopTimer,
  };

  manager._crossfadeTo('explore', procedural);
  manager._crossfadeTo('night', { duration: 30 });
  assert.equal(manager.current.source, proceduralSource);
  assert.equal(harness.active.size, 1);
  harness.audio.ctx.advanceTo(manager.crossfadeSeconds);
  assert.equal(manager.current.slot, 'night');
  assert.equal(proceduralSource.disconnected, true);
  const ticksAtStop = ticks;
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(ticks, ticksAtStop, 'procedural timer no longer runs after its source ends');
  assert.equal(harness.active.size, 1);
  assert.equal(harness.maxActive, 1);
});
