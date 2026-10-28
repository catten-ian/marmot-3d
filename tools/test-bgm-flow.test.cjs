'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const tick = () => new Promise((resolve) => setImmediate(resolve));

test('beta BGM threat classification uses fox intent and aliases graze/alert centrally', async () => {
  const audio = await import('../src/systems/audio.js');
  assert.equal(audio.resolveBgmSlot('graze'), 'explore');
  assert.equal(audio.resolveBgmSlot('alert'), 'tension');
  assert.equal(audio.selectBgmSlot({ mode: 'play', threats: 4, threatActive: false }), 'explore');
  assert.equal(audio.selectBgmSlot({ mode: 'play', threats: 0, nearestThreatState: 'wind' }), 'tension');
  assert.equal(audio.selectBgmSlot({ mode: 'play', threats: 0, nearestThreatState: 'roam' }), 'explore');
});

test('beta BGM state machine applies dwell, tension hysteresis, and post-hit combat observation', async () => {
  const { BgmStateMachine } = await import('../src/systems/audio.js');
  const machine = new BgmStateMachine({ minDwellSeconds: 0 });
  assert.equal(machine.update({ mode: 'play', now: 0, threatActive: false }), 'explore');
  assert.equal(machine.update({ mode: 'play', now: 1, threatActive: true }), 'explore');
  assert.equal(machine.update({ mode: 'play', now: 2.5, threatActive: true }), 'tension');
  assert.equal(machine.update({ mode: 'play', now: 3, threatActive: false }), 'tension');
  assert.equal(machine.update({ mode: 'play', now: 6.9, threatActive: false }), 'tension');
  assert.equal(machine.update({ mode: 'play', now: 7.1, threatActive: false }), 'explore');

  const combat = new BgmStateMachine({ minDwellSeconds: 0 });
  assert.equal(combat.update({ mode: 'play', now: 0, threatActive: false }), 'explore');
  assert.equal(combat.update({ mode: 'play', now: 1, combatUntil: 56, threatActive: false }), 'combat');
  assert.equal(combat.update({ mode: 'play', now: 55.9, combatUntil: 56, threatActive: false }), 'combat');
  assert.equal(combat.update({ mode: 'play', now: 56, combatUntil: 56, threatActive: false }), 'tension');
  assert.equal(combat.update({ mode: 'play', now: 59.9, combatUntil: 56, threatActive: false }), 'tension');
  assert.equal(combat.update({ mode: 'play', now: 60.1, combatUntil: 56, threatActive: false }), 'explore');

  const dwell = new BgmStateMachine();
  assert.equal(dwell.update({ mode: 'play', now: 0, threatActive: false }), 'explore');
  assert.equal(dwell.update({ mode: 'play', now: 1, threatActive: true }), 'explore');
  assert.equal(dwell.update({ mode: 'play', now: 2.5, threatActive: true }), 'explore', 'the normal slot has a 10s minimum dwell');
  assert.equal(dwell.update({ mode: 'play', now: 10, threatActive: true }), 'tension');
});

test('BgmManager fades out then fades in without overlapping sources', async () => {
  const { BgmManager } = await import('../src/systems/audio.js');
  const active = new Set();
  const sources = [];
  let maxActive = 0;
  const param = () => ({ value: 0, cancelScheduledValues() {}, setValueAtTime(v) { this.value = v; }, linearRampToValueAtTime(v, t) { this.value = v; this.lastRampAt = t; } });
  const ctx = {
    currentTime: 0,
    sources,
    advanceTo(time) { this.currentTime = time; for (const source of sources) if (source.stopAt <= time) source.finish(); },
    createGain() { return { gain: param(), connect() {}, disconnect() {} }; },
    createBufferSource() {
      const source = { loop: false, stopped: [], connect() {}, disconnect() { this.disconnected = true; }, start() { this.running = true; active.add(this); maxActive = Math.max(maxActive, active.size); }, stop(time) { this.stopped.push(time); this.stopAt = time ?? ctx.currentTime; }, finish() { if (!this.running) return; this.running = false; active.delete(this); this.onended?.(); } };
      sources.push(source); return source;
    },
  };
  const audio = { ctx, buses: { bgm: {} }, settings: { bgmEnabled: true }, _bgmCache: new Map(), _hasManifestAsset: async () => true, _loadBuffer: async () => ({ duration: 30 }) };
  const manager = new BgmManager(audio);
  manager.request('explore');
  await tick();
  const old = manager.current;
  manager.request('tension');
  await tick();
  assert.equal(old.source.stopped[0], 1.5);
  assert.equal(sources.length, 1);
  assert.equal(active.size, 1);
  ctx.advanceTo(1.5);
  assert.equal(manager.current.slot, 'tension');
  assert.equal(active.size, 1);
  assert.equal(maxActive, 1);
  assert.equal(manager.current.gain.gain.lastRampAt, 2.6);
});
