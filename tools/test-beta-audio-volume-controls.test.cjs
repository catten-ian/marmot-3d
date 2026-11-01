'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const load = () => import('../src/systems/audio.js');

class Param {
  constructor(value = 1) { this.value = value; this.events = []; }
  cancelScheduledValues(time) { this.events.push(['cancel', time]); }
  cancelAndHoldAtTime(time) { this.events.push(['hold', time]); }
  setValueAtTime(value, time) { this.value = value; this.events.push(['set', value, time]); }
  setTargetAtTime(value, time, constant) { this.value = value; this.events.push(['target', value, time, constant]); }
}
class Node {
  constructor() { this.gain = new Param(); this.connections = []; }
  connect(node) { this.connections.push(node); return node; }
}
class Context {
  constructor() { this.currentTime = 1; this.state = 'suspended'; this.destination = new Node(); this.resumes = 0; }
  createGain() { return new Node(); }
  createDynamicsCompressor() {
    const node = new Node();
    for (const key of ['threshold', 'knee', 'ratio', 'attack', 'release']) node[key] = new Param();
    return node;
  }
  createWaveShaper() { return new Node(); }
  resume() { this.resumes++; this.state = 'running'; return Promise.resolve(); }
  suspend() { this.state = 'suspended'; return Promise.resolve(); }
}
function store(raw) {
  const values = new Map(raw === undefined ? [] : [['marmot3d.audio.beta.v1', raw]]);
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
}
function instance(mod, options = {}) { return new mod.Audio({ isBeta: true, storage: store(), contextFactory: Context, fetchFn: async () => ({ ok: false }), ...options }); }
const close = (actual, expected, epsilon = 1e-10) => assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} != ${expected}`);

test('Beta defaults gain +3.52 dB, all three 150% ranges reach actual buses, Stable/Dev retain legacy output', async () => {
  const mod = await load();
  const beta = instance(mod);
  assert.equal(beta.ensure(), true);
  assert.deepEqual(beta.getAudioSettings(), { masterVolume: 100, sfxVolume: 100, bgmVolume: 61, sfxEnabled: true, bgmEnabled: true });
  assert.deepEqual(beta.getBusLevels(), { master: 0.48, sfx: 1, bgm: 0.61 });
  close(20 * Math.log10(0.48 / 0.32), 3.5218251811136247);
  beta.setSettings({ masterVolume: 150, sfxVolume: 150, bgmVolume: 150 });
  assert.deepEqual(beta.getBusLevels(), { master: 0.72, sfx: 1.5, bgm: 1.5 });
  close(beta.getBusLevels().master * beta.getBusLevels().sfx, 1.08);
  for (const isBeta of [false]) {
    const stableDev = instance(mod, { isBeta, storage: { getItem() { throw Error('must not read'); } } });
    assert.equal(stableDev.ensure(), true);
    stableDev.setSettings({ masterVolume: 150, bgmVolume: 150 });
    assert.deepEqual(stableDev.getBusLevels(), { master: 0.32, sfx: 1, bgm: 0 });
    assert.equal(stableDev.buses.protection, null);
    assert.deepEqual(stableDev.buses.master.connections, [stableDev.ctx.destination]);
  }
});

test('shared compressor + final bounded curve protect SFX/BGM sum, normal samples stay linear', async () => {
  const mod = await load();
  const beta = instance(mod); beta.ensure();
  const { master, sfx, bgm, protection: p } = beta.buses;
  assert.deepEqual(sfx.connections, [master]); assert.deepEqual(bgm.connections, [master]);
  assert.deepEqual(master.connections, [p.compressorInput]);
  assert.deepEqual(p.compressorInput.connections, [p.compressor]);
  assert.deepEqual(p.compressor.connections, [p.guardInput]);
  assert.deepEqual(p.guardInput.connections, [p.guard]);
  assert.deepEqual(p.guard.connections, [beta.ctx.destination]);
  for (const [key, value] of Object.entries(mod.AUDIO_COMPRESSOR)) assert.equal(p.compressor[key].value, value);
  assert.equal(p.compressor.threshold.value, 0);
  assert.equal(p.compressor.knee.value, 0);
  close(p.compressorInput.gain.value * p.guardInput.gain.value, 1 / 32);
  close(20 * Math.log10(1 / p.compressorInput.gain.value), -3);
  assert.equal(p.guard.oversample, 'none');
  // Apply the actual WaveShaper lookup interpolation and its input normalization,
  // deliberately bypassing compressor reduction (worst attack-overshoot case).
  const curve = p.guard.curve;
  const processSample = (sample) => {
    const index = Math.max(0, Math.min(curve.length - 1, (sample * p.compressorInput.gain.value * p.guardInput.gain.value + 1) * 0.5 * (curve.length - 1)));
    const lo = Math.floor(index), hi = Math.min(curve.length - 1, lo + 1);
    return curve[lo] + (curve[hi] - curve[lo]) * (index - lo);
  };
  for (let i = -900; i <= 900; i++) close(processSample(i / 1000), i / 1000, 0.000002);
  // 18 permitted family reservations + the loudest BGM trim, coherent full-scale
  // signals. No claim that real assets reach this artificial worst case.
  const voices = Object.values(mod.SFX_LIMITS).reduce((sum, limit) => sum + limit.maxConcurrent, 0);
  const worst = (voices * 1.5 + 0.42 * 1.88 * 1.5) * 0.72;
  assert.equal(voices, 18);
  close(worst, 20.292768);
  for (const sample of [-1000, -worst, -1.08, -0.798384, 0, 0.798384, 1.08, worst, 1000]) assert.ok(Math.abs(processSample(sample)) <= 0.9800001);
  for (let i = 1; i < curve.length; i++) assert.ok(curve[i] >= curve[i - 1]);
});

test('legacy localStorage, missing/invalid values, explicit zero, fractional step and extended settings round trip', async () => {
  const mod = await load();
  const legacy = store(JSON.stringify({ masterVolume: 100, sfxVolume: 0, bgmVolume: 61, sfxEnabled: false }));
  const beta = instance(mod, { storage: legacy }); beta.ensure();
  assert.equal(beta.getBusLevels().master, 0.48); assert.equal(beta.getBusLevels().sfx, 0);
  beta.setSettings({ masterVolume: 0, sfxVolume: 149, bgmVolume: 150 });
  beta.setSettings({ masterVolume: NaN, sfxVolume: Infinity, bgmVolume: '' });
  assert.deepEqual(mod.readAudioSettings(legacy), beta.getAudioSettings());
  assert.deepEqual([beta.settings.masterVolume, beta.settings.sfxVolume, beta.settings.bgmVolume], [0, 149, 150]);
  for (const raw of ['null', '[]', 'broken', '{"masterVolume":null,"bgmVolume":""}']) assert.deepEqual(mod.readAudioSettings(store(raw)), mod.AUDIO_DEFAULTS);
  for (const bad of [null, undefined, '', ' ', NaN, Infinity, -Infinity, 'NaN', 'Infinity', '1e2', '1e999', true, {}, []]) assert.equal(mod.normalizeAudioVolume(bad, 47), 47);
  assert.equal(mod.normalizeAudioVolume(0), 0);
  assert.equal(mod.normalizeAudioVolume(-10), 0);
  assert.equal(mod.normalizeAudioVolume(1e300), 150);
  assert.equal(mod.normalizeAudioVolume(61.5), 62);
  assert.equal(mod.normalizeAudioVolume('125'), 125);
  const noPersist = instance(mod, { storage: legacy });
  noPersist.setSettings({ masterVolume: 140 }, { persist: false });
  assert.equal(mod.readAudioSettings(legacy).masterVolume, 0);
  assert.doesNotThrow(() => mod.writeAudioSettings({ masterVolume: 0 }, { setItem() { throw Error('disabled'); } }));
});

test('mute and hidden page stay silent through edits/ensure; gain changes smooth; user gesture resumes', async () => {
  const mod = await load();
  const beta = instance(mod); beta.ensure();
  beta.setSettings({ masterVolume: 125 });
  assert.ok(beta.master.gain.events.some((event) => event[0] === 'target' && event[1] === 0.6 && event[3] === 0.015));
  beta.setEnabled(false); assert.equal(beta.master.gain.value, 0);
  beta.setSettings({ masterVolume: 150 }); assert.equal(beta.master.gain.value, 0);
  beta.setEnabled(true); assert.equal(beta.master.gain.value, 0.72);
  beta.handleVisibility(true);
  const resumes = beta.ctx.resumes;
  beta.setSettings({ masterVolume: 100 }); beta.ensure();
  assert.equal(beta.ctx.resumes, resumes); assert.equal(beta.master.gain.value, 0);
  beta.handleVisibility(false); assert.equal(beta.master.gain.value, 0.48); assert.equal(beta.ctx.state, 'running');
  beta.setSettings({ sfxVolume: 0, bgmVolume: 0 });
  assert.equal(beta.sfxBus.gain.value, 0); assert.equal(beta.bgmBus.gain.value, 0);
  const hiddenBeforeUnlock = instance(mod);
  hiddenBeforeUnlock.handleVisibility(true); hiddenBeforeUnlock.ensure();
  assert.equal(hiddenBeforeUnlock.master.gain.value, 0);
  assert.equal(hiddenBeforeUnlock.ctx.resumes, 0);
  hiddenBeforeUnlock.handleVisibility(false);
  assert.equal(hiddenBeforeUnlock.master.gain.value, 0.48);
  assert.equal(hiddenBeforeUnlock.ctx.resumes, 1);
  const beforeGesture = instance(mod);
  const listeners = new Map();
  beforeGesture.bindUserGesture({ addEventListener: (type, fn) => listeners.set(type, fn), removeEventListener: (type) => listeners.delete(type) });
  assert.equal(beforeGesture.ctx, null);
  listeners.get('keydown')();
  assert.equal(beforeGesture.ctx.state, 'running'); assert.equal(listeners.size, 0);
});

test('config schema v1 accepts 0–150 round trips, rejects invalid types/nonfinite values, and clamps finite bounds', async () => {
  const transfer = await import('../src/core/config-transfer.mjs');
  const mod = await load();
  for (const values of [[0, 100, 61], [150, 125, 150]]) {
    const payload = transfer.buildConfigExport({ audioSettings: { masterVolume: values[0], sfxVolume: values[1], bgmVolume: values[2] } });
    const result = transfer.parseConfigText(JSON.stringify(payload));
    assert.equal(result.ok, true); assert.equal(result.warnings.length, 0);
    assert.deepEqual(result.config.audio, payload.audio);
    const storage = store(); mod.writeAudioSettings(result.config.audio, storage);
    assert.deepEqual(mod.readAudioSettings(storage), payload.audio);
  }
  for (const bad of [NaN, Infinity, -Infinity, null, '', '125', '1e999', true, {}]) {
    const result = transfer.sanitizeConfig({ schemaVersion: 1, audio: { masterVolume: bad, sfxVolume: 0 } });
    assert.equal(result.config.audio.masterVolume, undefined); assert.equal(result.config.audio.sfxVolume, 0);
    assert.equal(result.warnings.length, 1);
  }
  const result = transfer.sanitizeConfig({ schemaVersion: 1, audio: { masterVolume: -1, sfxVolume: 1e300, bgmVolume: 62.3 } });
  assert.deepEqual(result.config.audio, { masterVolume: 0, sfxVolume: 150, bgmVolume: 62 });
  assert.equal(result.warnings.length, 3);
});

class Element {
  constructor(value = '') { this.value = String(value); this.listeners = new Map(); this.attrs = {}; }
  addEventListener(type, fn) { this.listeners.set(type, fn); }
  setAttribute(key, value) { this.attrs[key] = value; }
  fire(type, event = {}) { this.listeners.get(type)?.(event); }
}

test('numeric draft logic rejects empty/nonfinite/exponent, delays fractional/bounds edits and commits integer step', async () => {
  const { parseAudioVolumeInput: parse } = await import('../src/ui/settings.js');
  for (const bad of ['', ' ', '-', '.', 'NaN', 'Infinity', '-Infinity', '1e2', '1e999', '1e-3', '0x10', '1,2', '9'.repeat(400)]) {
    assert.deepEqual(parse(bad, 73), { value: 73, apply: false });
    assert.deepEqual(parse(bad, 73, { commit: true }), { value: 73, apply: false });
  }
  for (const [draft, expected] of [['0', 0], ['150', 150], ['125', 125]]) assert.deepEqual(parse(draft, 73), { value: expected, apply: true });
  for (const [draft, expected] of [['-5', 0], ['99999999999999999', 150], ['61.5', 62], ['12.', 12]]) {
    assert.equal(parse(draft, 73).apply, false);
    assert.deepEqual(parse(draft, 73, { commit: true }), { value: expected, apply: true });
  }
});

test('all three numeric controls use the actual handlers: immediate persistence, slider sync, blur/Enter restore and ARIA', async () => {
  const mod = await load();
  const ui = await import('../src/ui/settings.js');
  const storage = store(); const beta = instance(mod, { storage }); beta.ensure();
  for (const [id, key, label] of [['audioMaster', 'masterVolume', '总音量'], ['audioSfx', 'sfxVolume', '音效音量'], ['audioBgm', 'bgmVolume', '音乐音量']]) {
    const markup = ui.audioVolumeMarkup(id, label, beta.settings[key]);
    assert.match(markup, /type="number" inputmode="numeric" min="0" max="150" step="1"/);
    assert.match(markup, /type="range" min="0" max="150" step="1"/);
    assert.ok(markup.includes(`for="${id}Volume ${id}Number"`));
    const slider = new Element(), number = new Element(), output = new Element();
    ui.bindAudioVolumeControl({ slider, number, output, getValue: () => beta.settings[key], setValue: (value) => beta.setSettings({ [key]: value })[key] });
    number.value = '125'; number.fire('input');
    assert.equal(beta.settings[key], 125); assert.equal(mod.readAudioSettings(storage)[key], 125);
    assert.equal(slider.value, '125'); assert.equal(output.textContent, '125%');
    number.value = ''; number.fire('input'); assert.equal(beta.settings[key], 125); assert.equal(number.value, '');
    number.fire('blur'); assert.equal(number.value, '125');
    number.value = 'Infinity'; number.fire('input'); number.fire('change'); assert.equal(number.value, '125');
    number.value = '61.5'; number.fire('input'); assert.equal(beta.settings[key], 125);
    let prevented = false, stopped = false;
    number.fire('keydown', { key: 'Enter', preventDefault() { prevented = true; }, stopPropagation() { stopped = true; } });
    assert.ok(prevented && stopped); assert.equal(number.value, '62'); assert.equal(slider.value, '62');
    number.value = '9999'; number.fire('input'); number.fire('blur'); assert.equal(number.value, '150');
    slider.value = '0'; slider.fire('input');
    assert.equal(number.value, '0'); assert.equal(output.value, '0%'); assert.equal(mod.readAudioSettings(storage)[key], 0);
    assert.equal(number.attrs['aria-valuetext'], '0%'); assert.equal(slider.attrs['aria-valuetext'], '0%');
  }
  const source = readFileSync(require.resolve('../src/ui/settings.js'), 'utf8');
  assert.match(source, /if \(IS_BETA && this.audio\)/);
});
