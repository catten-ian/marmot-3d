'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

test('BGM metadata decisions cover intro exceptions and combat selection', async () => {
  const tracks = await import('../src/systems/bgm-tracks.mjs');
  assert.equal(tracks.resolveBgmStartOffset({ slot: 'combat', prevMode: 'play', transition: 'switch', introSec: 7 }), 7);
  assert.equal(tracks.resolveBgmStartOffset({ slot: 'explore', prevMode: 'title', transition: 'play', introSec: 7 }), 0);
  assert.equal(tracks.resolveBgmStartOffset({ slot: 'victory', prevMode: 'play', transition: 'switch', introSec: 7 }), 0);
  assert.equal(tracks.resolveBgmStartOffset({ slot: 'combat', prevMode: 'play', transition: 'loop', introSec: 7 }), 0);
  const a = tracks.chooseCombatVariant({ variants: ['combat', 'combat-b', 'combat-c'], previous: 'combat', rng: () => 0 });
  assert.equal(a, 'combat-b');
  assert.notEqual(a, 'combat');
  assert.equal(tracks.BGM_TRACK_META.combat.gain, 1);
});

test('beta slot mapping replaces cave and includes PAF', async () => {
  const audio = await import('../src/systems/audio.js');
  assert.deepEqual(audio.BGM_SLOTS, ['menu', 'explore', 'tension', 'combat', 'night', 'victory', 'defeat', 'paf']);
  assert.equal(audio.selectBgmSlot({ mode: 'play', inBurrow: true }), 'night');
  assert.equal('cave' in audio.BGM_ASSETS, false);
});

test('crossfade target multiplies normalized track gain', async () => {
  const audio = await import('../src/systems/audio.js');
  const param = { value: 0, cancelScheduledValues() {}, setValueAtTime(v) { this.value = v; }, linearRampToValueAtTime(v) { this.value = v; } };
  const manager = new audio.BgmManager({ ctx: { currentTime: 0, createBufferSource() { return { connect(){}, start(){}, stop(){}, disconnect(){}, loop: false }; }, createGain() { return { gain: param, connect(){}, disconnect(){} }; } }, buses: { bgm: {} }, settings: { bgmEnabled: true } });
  manager._crossfadeTo('combat', { duration: 45 }, { startOffset: 3 });
  assert.equal(param.value, 0.42);
});

test('PAF priority survives normal state updates and preload excludes paf', async () => {
  const audio = await import('../src/systems/audio.js');
  const instance = new audio.Audio({ isBeta: true, fetchFn: async () => ({ ok: false }), storage: null });
  instance.setPafActive(true);
  assert.equal(instance.updateBgmState({ mode: 'play', hp: 100 }), 'paf');
  instance.setPafActive(false);
  assert.equal(instance.updateBgmState({ mode: 'play', hp: 100 }), 'explore');
  const calls = [];
  const preload = new audio.Audio({ isBeta: true, fetchFn: async (url) => { calls.push(url); return { ok: false }; }, storage: null });
  await preload.preload();
  assert.equal(calls.some((url) => url.endsWith('/paf.mp3')), false);
  assert.equal(calls.some((url) => url.endsWith('/combat-b.mp3') || url.endsWith('/combat-c.mp3') || url.endsWith('/combat.mp3')), true);
});
