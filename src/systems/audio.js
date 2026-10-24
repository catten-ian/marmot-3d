/**
 * BETA audio: three WebAudio buses, lazy local MP3 playback, and procedural fallback.
 * Stable/dev keep their original 0.32 master level and procedural synth path.
 * No provider SDK, remote service, or API key is present in this runtime module.
 */
import { IS_BETA } from '../core/version.js';

export const AUDIO_SETTINGS_KEY = 'marmot3d.audio.beta.v1';
export const AUDIO_DEFAULTS = Object.freeze({
  masterVolume: 100,
  sfxVolume: 100,
  bgmVolume: 38,
  sfxEnabled: true,
  bgmEnabled: true,
});

const clamp01 = (value) => Math.max(0, Math.min(1, Number.isFinite(Number(value)) ? Number(value) : 0));
const clampPercent = (value, fallback) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(100, number)) : fallback;
};

/** All public legacy event names remain available, including the repel/kill alias. */
export const SFX_ASSETS = Object.freeze({
  swing: 'assets/audio/sfx/swing.mp3',
  hit: 'assets/audio/sfx/hit.mp3',
  repel: 'assets/audio/sfx/repel.mp3',
  kill: 'assets/audio/sfx/repel.mp3',
  berry: 'assets/audio/sfx/berry.mp3',
  burst: 'assets/audio/sfx/burst.mp3',
  ultimate: 'assets/audio/sfx/ultimate.mp3',
  hurt: 'assets/audio/sfx/hurt.mp3',
  foxWind: 'assets/audio/sfx/foxWind.mp3',
  jump: 'assets/audio/sfx/jump.mp3',
  foxDash: 'assets/audio/sfx/foxDash.mp3',
  rescue: 'assets/audio/sfx/rescue.mp3',
  helpCry: 'assets/audio/sfx/helpCry.mp3',
  levelUp: 'assets/audio/sfx/levelUp.mp3',
  win: 'assets/audio/sfx/win.mp3',
  lose: 'assets/audio/sfx/lose.mp3',
  lowHealth: 'assets/audio/sfx/lowHealth.mp3',
});
export const SFX_EVENT_NAMES = Object.freeze([
  'swing', 'hit', 'repel', 'kill', 'berry', 'burst', 'ultimate', 'hurt', 'foxWind',
  'jump', 'foxDash', 'rescue', 'helpCry', 'levelUp', 'win', 'lose', 'lowHealth',
]);
export const BGM_SLOTS = Object.freeze(['menu', 'explore', 'tension', 'combat', 'victory', 'defeat']);
export const BGM_ASSETS = Object.freeze(Object.fromEntries(
  BGM_SLOTS.map((slot) => [slot, `assets/audio/bgm/${slot}.mp3`]),
));

const SFX_GROUP = Object.freeze({
  swing: 'swish', hit: 'impact', repel: 'impact', kill: 'impact', hurt: 'impact', foxDash: 'impact',
  berry: 'pickup', jump: 'movement', foxWind: 'alert', helpCry: 'alert', lowHealth: 'alert',
  burst: 'power', ultimate: 'power', rescue: 'fanfare', levelUp: 'fanfare', win: 'fanfare', lose: 'fanfare',
});
export const SFX_LIMITS = Object.freeze({
  swish: Object.freeze({ maxConcurrent: 3, minIntervalMs: 45 }),
  impact: Object.freeze({ maxConcurrent: 4, minIntervalMs: 38 }),
  pickup: Object.freeze({ maxConcurrent: 3, minIntervalMs: 65 }),
  movement: Object.freeze({ maxConcurrent: 3, minIntervalMs: 70 }),
  alert: Object.freeze({ maxConcurrent: 2, minIntervalMs: 120 }),
  power: Object.freeze({ maxConcurrent: 2, minIntervalMs: 100 }),
  fanfare: Object.freeze({ maxConcurrent: 1, minIntervalMs: 160 }),
});
const FALLBACK_HOLD_MS = Object.freeze({
  swing: 180, hit: 220, repel: 430, kill: 430, berry: 300, burst: 420, ultimate: 680,
  hurt: 300, foxWind: 450, jump: 220, foxDash: 270, rescue: 430, helpCry: 300,
  levelUp: 620, win: 950, lose: 900, lowHealth: 220,
});

export function normalizeAudioSettings(value = {}) {
  return {
    masterVolume: clampPercent(value.masterVolume, AUDIO_DEFAULTS.masterVolume),
    sfxVolume: clampPercent(value.sfxVolume, AUDIO_DEFAULTS.sfxVolume),
    bgmVolume: clampPercent(value.bgmVolume, AUDIO_DEFAULTS.bgmVolume),
    sfxEnabled: value.sfxEnabled !== false,
    bgmEnabled: value.bgmEnabled !== false,
  };
}

export function readAudioSettings(storage) {
  try {
    if (storage === undefined) storage = globalThis.localStorage;
    const raw = storage?.getItem?.(AUDIO_SETTINGS_KEY);
    return normalizeAudioSettings(raw ? JSON.parse(raw) : AUDIO_DEFAULTS);
  } catch (_) {
    return { ...AUDIO_DEFAULTS };
  }
}

export function writeAudioSettings(value, storage) {
  const settings = normalizeAudioSettings(value);
  try {
    if (storage === undefined) storage = globalThis.localStorage;
    storage?.setItem?.(AUDIO_SETTINGS_KEY, JSON.stringify(settings));
  } catch (_) { /* storage can be disabled */ }
  return settings;
}

/** Pure decision seam: once a file lookup resolves, choose static, procedural, or silent. */
export function selectSfxPlayback({ isBeta = true, enabled = true, fileAvailable = false } = {}) {
  if (!enabled) return 'silent';
  if (isBeta && fileAvailable) return 'file';
  return 'procedural';
}

/** Select the score for the current game state; null means fade to silence (e.g. pause). */
export function selectBgmSlot({ mode = 'title', hp = 100, stress = 0, threats = 0, winding = false, combat = false, overdrive = 0 } = {}) {
  if (mode === 'title') return 'menu';
  if (mode === 'won' || mode === 'levelclear') return 'victory';
  if (mode === 'lost') return 'defeat';
  if (mode === 'pause') return null;
  if (mode !== 'play') return 'menu';
  if (Number(hp) <= 25) return 'defeat';
  if (combat || Number(overdrive) > 0) return 'combat';
  if (winding || Number(threats) > 0 || Number(stress) >= 55) return 'tension';
  return 'explore';
}

/** Three gain buses with independent controls; both leaf buses feed master. */
export function createAudioBuses(ctx) {
  const master = ctx.createGain();
  const sfx = ctx.createGain();
  const bgm = ctx.createGain();
  sfx.connect(master);
  bgm.connect(master);
  master.connect(ctx.destination);
  return { master, sfx, bgm };
}

export function reserveSfxPlayback(name, nowMs, reservations, limits = SFX_LIMITS) {
  const group = SFX_GROUP[name] || name;
  const limit = limits[group] || { maxConcurrent: 3, minIntervalMs: 50 };
  const entry = reservations.get(group) || { active: 0, lastAt: -Infinity };
  if (entry.active >= limit.maxConcurrent || nowMs - entry.lastAt < limit.minIntervalMs) return false;
  entry.active += 1;
  entry.lastAt = nowMs;
  reservations.set(group, entry);
  return true;
}

export function releaseSfxPlayback(name, reservations) {
  const group = SFX_GROUP[name] || name;
  const entry = reservations.get(group);
  if (!entry) return;
  entry.active = Math.max(0, entry.active - 1);
  if (!entry.active) reservations.delete(group);
}

function paramValue(param, value, time) {
  param.setValueAtTime(value, time);
}

/** Linear, scheduled gain transition used by BGM crossfades and easy to fake in node:test. */
export function rampGain(param, from, to, startTime, durationSeconds) {
  const endTime = startTime + Math.max(0, durationSeconds);
  param.cancelScheduledValues(startTime);
  paramValue(param, from, startTime);
  param.linearRampToValueAtTime(to, endTime);
  return endTime;
}

export class BgmManager {
  constructor(audio, { crossfadeSeconds = 2.5 } = {}) {
    this.audio = audio;
    this.crossfadeSeconds = crossfadeSeconds;
    this.current = null;
    this.desiredSlot = null;
    this.generation = 0;
    this.enabled = true;
  }

  setEnabled(enabled) {
    const next = !!enabled;
    if (next === this.enabled) return;
    this.enabled = next;
    if (next) this.request(this.desiredSlot, true);
    else this._fadeOut(this.current);
  }

  request(slot, force = false) {
    const next = BGM_SLOTS.includes(slot) ? slot : null;
    if (!force && next === this.desiredSlot) return;
    this.desiredSlot = next;
    const generation = ++this.generation;
    if (!this.enabled || !this.audio.settings.bgmEnabled || !next) {
      this._fadeOut(this.current);
      return;
    }
    if (this.current?.slot === next) return;
    this.audio._hasManifestAsset('bgm', next, BGM_ASSETS[next]).then((available) => {
      if (!available) return null;
      return this.audio._loadBuffer(BGM_ASSETS[next], this.audio._bgmCache);
    }).then((buffer) => {
      if (generation !== this.generation) return;
      if (!buffer) { this._fadeOut(this.current); return; }
      this._crossfadeTo(next, buffer);
    }).catch(() => {
      if (generation === this.generation) this._fadeOut(this.current);
    });
  }

  _trackLevel(track, now) {
    if (!track?.fade) return Number(track?.gain?.gain?.value) || 0;
    const { from, to, start, end } = track.fade;
    if (now <= start) return from;
    if (now >= end || end <= start) return to;
    return from + (to - from) * ((now - start) / (end - start));
  }

  _fade(track, target, now, duration) {
    if (!track) return;
    const from = this._trackLevel(track, now);
    const end = rampGain(track.gain.gain, from, target, now, duration);
    track.fade = { from, to: target, start: now, end };
    if (target === 0) {
      try { track.source.stop(end + 0.04); } catch (_) { /* already stopped */ }
    }
  }

  _fadeOut(track) {
    if (!track) return;
    this.current = null;
    this._fade(track, 0, this.audio.ctx.currentTime, this.crossfadeSeconds);
  }

  _crossfadeTo(slot, buffer) {
    const ctx = this.audio.ctx;
    const now = ctx.currentTime;
    const source = ctx.createBufferSource();
    const gain = ctx.createGain();
    source.buffer = buffer;
    source.loop = true;
    source.connect(gain);
    gain.connect(this.audio.buses.bgm);
    paramValue(gain.gain, 0, now);
    source.start(now);
    const track = { slot, source, gain, fade: null };
    this._fade(track, 0.42, now, this.crossfadeSeconds);
    const previous = this.current;
    this.current = track;
    this._fade(previous, 0, now, this.crossfadeSeconds);
    source.onended = () => {
      try { source.disconnect(); gain.disconnect(); } catch (_) { /* cleanup is best-effort */ }
    };
  }
}

export class Audio {
  constructor({ isBeta = IS_BETA, storage = null, fetchFn = null, contextFactory = null } = {}) {
    this.isBeta = !!isBeta;
    this.storage = this.isBeta ? (storage || this._safeStorage()) : null;
    this.fetchFn = fetchFn || globalThis.fetch?.bind(globalThis) || null;
    this.contextFactory = contextFactory;
    this.ctx = null;
    this.master = null;
    this.sfxBus = null;
    this.bgmBus = null;
    this.buses = null;
    this.enabled = true;
    this.settings = this.isBeta ? readAudioSettings(this.storage) : { ...AUDIO_DEFAULTS };
    this._noiseBuf = null;
    this._sfxCache = new Map();
    this._bgmCache = new Map();
    this._manifestCache = new Map();
    this._reservations = new Map();
    this._bgmManager = null;
    this._desiredBgmSlot = null;
    this._gestureHandler = null;
  }

  _safeStorage() {
    try { return globalThis.localStorage || null; } catch (_) { return null; }
  }

  bindUserGesture(target = globalThis.window) {
    if (!this.isBeta || !target?.addEventListener || this._gestureHandler) return;
    this._gestureHandler = () => {
      this.ensure();
      this._resumeContext();
      target.removeEventListener('pointerdown', this._gestureHandler, true);
      target.removeEventListener('keydown', this._gestureHandler, true);
      target.removeEventListener('touchstart', this._gestureHandler, true);
      this._gestureHandler = null;
    };
    target.addEventListener('pointerdown', this._gestureHandler, { capture: true, once: true });
    target.addEventListener('keydown', this._gestureHandler, { capture: true, once: true });
    target.addEventListener('touchstart', this._gestureHandler, { capture: true, once: true, passive: true });
  }

  ensure() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') {
        this._resumeContext();
      }
      return true;
    }
    try {
      const AC = this.contextFactory || globalThis.window?.AudioContext || globalThis.window?.webkitAudioContext;
      if (!AC) return false;
      this.ctx = new AC();
      this.buses = createAudioBuses(this.ctx);
      this.master = this.buses.master;
      this.sfxBus = this.buses.sfx;
      this.bgmBus = this.buses.bgm;
      this._applySettings();
      if (this.isBeta) {
        this._bgmManager = new BgmManager(this);
        this._bgmManager.request(this._desiredBgmSlot, true);
      }
      if (this.ctx.state === 'suspended') {
        this._resumeContext();
      }
      return true;
    } catch (_) {
      this.enabled = false;
      return false;
    }
  }

  _resumeContext() {
    try {
      const resumed = this.ctx?.resume?.();
      resumed?.catch?.(() => {});
    } catch (_) { /* autoplay may remain blocked until a later gesture */ }
  }

  _applySettings() {
    if (!this.buses) return;
    // The old synthesizer's reference output is 0.32; 100% preserves that balance.
    this.buses.master.gain.value = this.enabled ? 0.32 * (this.isBeta ? this.settings.masterVolume / 100 : 1) : 0;
    this.buses.sfx.gain.value = this.isBeta
      ? (this.settings.sfxEnabled ? this.settings.sfxVolume / 100 : 0)
      : 1;
    this.buses.bgm.gain.value = this.isBeta && this.settings.bgmEnabled ? this.settings.bgmVolume / 100 : 0;
  }

  getAudioSettings() { return { ...this.settings }; }

  setSettings(value, { persist = true } = {}) {
    if (!this.isBeta) return this.getAudioSettings();
    this.settings = normalizeAudioSettings({ ...this.settings, ...value });
    this._applySettings();
    if (persist) writeAudioSettings(this.settings, this.storage);
    if (this._bgmManager) {
      this._bgmManager.setEnabled(this.settings.bgmEnabled);
      if (this.settings.bgmEnabled) this._bgmManager.request(this._desiredBgmSlot, true);
    }
    return this.getAudioSettings();
  }

  setEnabled(value) {
    this.enabled = !!value;
    this._applySettings();
  }

  updateBgmState(state) {
    if (!this.isBeta) return null;
    const slot = selectBgmSlot(state);
    this._desiredBgmSlot = slot;
    if (this._bgmManager) this._bgmManager.request(slot);
    return slot;
  }

  getBusLevels() {
    return this.buses ? {
      master: this.buses.master.gain.value,
      sfx: this.buses.sfx.gain.value,
      bgm: this.buses.bgm.gain.value,
    } : null;
  }

  _readManifest(kind) {
    if (!this.fetchFn) return Promise.resolve(null);
    if (this._manifestCache.has(kind)) return this._manifestCache.get(kind);
    const path = `assets/audio/${kind}/manifest.json`;
    const promise = Promise.resolve().then(() => this.fetchFn(path, { cache: 'force-cache' }))
      .then((response) => response?.ok ? response.json() : null)
      .catch(() => null);
    this._manifestCache.set(kind, promise);
    return promise;
  }

  async _hasManifestAsset(kind, name, expectedPath) {
    if (!this.isBeta) return false;
    const manifest = await this._readManifest(kind);
    const entry = manifest?.assets?.[name];
    if (typeof entry === 'string') return entry === expectedPath;
    return !!entry && entry.file === expectedPath;
  }

  _loadBuffer(path, cache) {
    if (!this.ctx || !this.fetchFn) return Promise.resolve(null);
    if (cache.has(path)) return cache.get(path);
    const promise = Promise.resolve().then(() => this.fetchFn(path, { cache: 'force-cache' }))
      .then((response) => {
        if (!response?.ok) return null;
        return response.arrayBuffer();
      })
      .then((data) => data ? this.ctx.decodeAudioData(data) : null)
      .catch(() => null);
    cache.set(path, promise);
    return promise;
  }

  _playBuffer(buffer, bus, { volume = 1, fadeIn = 0.008, fadeOut = 0.025, onended = null } = {}) {
    if (!this.ctx || !bus || !this.enabled) return false;
    try {
      const source = this.ctx.createBufferSource();
      const gain = this.ctx.createGain();
      const now = this.ctx.currentTime;
      const duration = Math.max(0.02, Number(buffer.duration) || 0.12);
      source.buffer = buffer;
      source.connect(gain);
      gain.connect(bus);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.linearRampToValueAtTime(Math.max(0.0001, volume), now + Math.min(fadeIn, duration * 0.2));
      gain.gain.setValueAtTime(Math.max(0.0001, volume), now + Math.max(fadeIn, duration - fadeOut));
      gain.gain.linearRampToValueAtTime(0.0001, now + duration);
      source.onended = () => {
        try { source.disconnect(); gain.disconnect(); } catch (_) { /* best-effort cleanup */ }
        onended?.();
      };
      source.start(now);
      return true;
    } catch (_) {
      return false;
    }
  }

  _dispatchSfx(name, fallback, { attenuation = 0, pan = 0 } = {}) {
    if (!this.enabled || (this.isBeta && !this.settings.sfxEnabled)) return false;
    // Stable/dev retain the exact legacy synthesis timing and are not rate-limited.
    if (!this.isBeta) { try { fallback(pan); } catch (_) { /* preserve gameplay safety */ } return true; }
    if (!reserveSfxPlayback(name, Date.now(), this._reservations)) return false;
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      releaseSfxPlayback(name, this._reservations);
    };
    if (!this.ensure()) {
      try { fallback(pan); } catch (_) { /* sound must never break gameplay */ }
      setTimeout(release, FALLBACK_HOLD_MS[name] || 300);
      return true;
    }
    this._hasManifestAsset('sfx', name, SFX_ASSETS[name]).then((available) => {
      if (!available) return null;
      return this._loadBuffer(SFX_ASSETS[name], this._sfxCache);
    }).then((buffer) => {
      if (!this.enabled || !this.settings.sfxEnabled) { release(); return; }
      const selected = selectSfxPlayback({ isBeta: this.isBeta, enabled: true, fileAvailable: !!buffer });
      if (selected === 'file' && this._playBuffer(buffer, this.sfxBus, {
        volume: Math.max(0, 1 - Math.min(0.85, clamp01(attenuation))), onended: release,
      })) return;
      try { fallback(pan); } catch (_) { /* procedural fallback is isolated */ }
      setTimeout(release, FALLBACK_HOLD_MS[name] || 300);
    }).catch(() => {
      try { fallback(pan); } catch (_) { /* missing/offline file is normal */ }
      setTimeout(release, FALLBACK_HOLD_MS[name] || 300);
    });
    return true;
  }

  _noise() {
    if (!this._noiseBuf) {
      const len = this.ctx.sampleRate * 0.5;
      const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      this._noiseBuf = buf;
    }
    const src = this.ctx.createBufferSource();
    src.buffer = this._noiseBuf;
    return src;
  }

  _tone(freq, dur, type = 'sine', gain = 0.3, freqEnd = null, pan = 0) {
    if (!this.enabled || (this.isBeta && !this.settings.sfxEnabled) || !this.ensure()) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (freqEnd) osc.frequency.exponentialRampToValueAtTime(Math.max(1, freqEnd), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + Math.min(0.015, dur * 0.2));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g);
    if (pan !== 0 && this.ctx.createStereoPanner) {
      const panner = this.ctx.createStereoPanner(); panner.pan.value = Math.max(-1, Math.min(1, pan));
      g.connect(panner); panner.connect(this.sfxBus || this.master);
    } else g.connect(this.sfxBus || this.master);
    osc.start(t); osc.stop(t + dur + 0.02);
  }

  _burstNoise(dur, gain = 0.25, filterFreq = 1200, type = 'lowpass', pan = 0) {
    if (!this.enabled || (this.isBeta && !this.settings.sfxEnabled) || !this.ensure()) return;
    const t = this.ctx.currentTime;
    const src = this._noise();
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(filterFreq, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(80, filterFreq * 0.3), t + dur);
    const g = this.ctx.createGain();
    if (this.isBeta) {
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(gain, t + Math.min(0.008, dur * 0.2));
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    } else {
      // Exact legacy transient envelope for stable/dev compatibility.
      g.gain.setValueAtTime(gain, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    }
    src.connect(f); f.connect(g);
    if (pan !== 0 && this.ctx.createStereoPanner) {
      const panner = this.ctx.createStereoPanner(); panner.pan.value = Math.max(-1, Math.min(1, pan));
      g.connect(panner); panner.connect(this.sfxBus || this.master);
    } else g.connect(this.sfxBus || this.master);
    src.start(t); src.stop(t + dur + 0.02);
  }

  // The following private synths preserve all original fallback voicings and timing.
  _swing() { this._burstNoise(0.11, 0.14, 2600, 'bandpass'); }
  _hit() {
    this._tone(320, 0.09, 'square', 0.16, 140);
    this._burstNoise(0.08, 0.16, 1800);
  }
  _repel() {
    this._tone(520, 0.1, 'triangle', 0.16, 760);
    this._burstNoise(0.12, 0.1, 1600, 'bandpass');
    setTimeout(() => this._burstNoise(0.2, 0.09, 1100, 'bandpass'), 90);
  }
  _berry() {
    this._tone(660, 0.09, 'sine', 0.2);
    setTimeout(() => this._tone(880, 0.12, 'sine', 0.18), 70);
  }
  _burst() {
    this._tone(240, 0.34, 'sawtooth', 0.24, 620);
    this._burstNoise(0.3, 0.2, 2200);
  }
  _ultimate() {
    this._tone(160, 0.6, 'sawtooth', 0.3, 90);
    this._tone(420, 0.5, 'triangle', 0.2, 140);
    this._burstNoise(0.55, 0.26, 3000, 'bandpass');
  }
  _hurt() {
    this._tone(150, 0.2, 'square', 0.22, 70);
    this._burstNoise(0.14, 0.18, 600);
  }
  _foxWind() { this._tone(520, 0.4, 'triangle', 0.08, 900); }
  _jump() {
    this._tone(340, 0.11, 'sine', 0.12, 620);
    this._burstNoise(0.06, 0.05, 800);
  }
  _foxDash() { this._burstNoise(0.22, 0.16, 1400, 'bandpass'); }
  /** Caution 1.0-1.2k pure tones; urgent 1.4-1.9k triple tones, distinct from foxDash noise. Purely procedural (no manifest MP3). */
  _companionAlarm(level, pan = 0) {
    const notes = level === 'urgent' ? [1397, 1661, 1865] : level === 'caution' ? [1046, 1175] : [];
    const duration = level === 'urgent' ? 0.07 : 0.09, gain = level === 'urgent' ? 0.15 : 0.12, gap = level === 'urgent' ? 0.14 : 0.18;
    notes.forEach((freq, i) => setTimeout(() => this._tone(freq, duration, level === 'urgent' ? 'sine' : 'triangle', gain, null, pan), i * gap * 1000));
  }
  _rescue() { [523, 659, 784].forEach((f, i) => setTimeout(() => this._tone(f, 0.16, 'sine', 0.18), i * 90)); }
  /** 伙伴呼救：两声上扬的短促叫声。attenuation 越大（距离越远）音量越低 */
  _helpCry(attenuation = 0.5) {
    if (!this.enabled || !this.ensure()) return;
    const vol = 0.16 * (1 - Math.min(0.85, attenuation));
    this._tone(760, 0.09, 'triangle', vol, 980);
    setTimeout(() => this._tone(980, 0.1, 'triangle', vol * 0.85, 1180), 95);
  }
  _levelUp() { [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => this._tone(f, 0.28, 'triangle', 0.22), i * 130)); }
  _win() { [523, 659, 784, 1046, 1318].forEach((f, i) => setTimeout(() => this._tone(f, 0.4, 'sine', 0.24), i * 160)); }
  _lose() { [392, 330, 262, 196].forEach((f, i) => setTimeout(() => this._tone(f, 0.42, 'sine', 0.22), i * 190)); }
  _lowHealth() { this._tone(220, 0.16, 'sine', 0.14, 180); }

  swing() { return this._dispatchSfx('swing', () => this._swing()); }
  hit() { return this._dispatchSfx('hit', () => this._hit()); }
  repel() { return this._dispatchSfx('repel', () => this._repel()); }
  /** @deprecated Kept as a legacy alias; it intentionally uses the non-lethal repel sound. */
  kill() { return this._dispatchSfx('kill', () => this._repel()); }
  berry() { return this._dispatchSfx('berry', () => this._berry()); }
  burst() { return this._dispatchSfx('burst', () => this._burst()); }
  ultimate() { return this._dispatchSfx('ultimate', () => this._ultimate()); }
  hurt() { return this._dispatchSfx('hurt', () => this._hurt()); }
  foxWind() { return this._dispatchSfx('foxWind', () => this._foxWind()); }
  jump() { return this._dispatchSfx('jump', () => this._jump()); }
  foxDash() { return this._dispatchSfx('foxDash', () => this._foxDash()); }
  rescue() { return this._dispatchSfx('rescue', () => this._rescue()); }
  helpCry(attenuation = 0.5) {
    return this._dispatchSfx('helpCry', () => this._helpCry(attenuation), { attenuation });
  }
  levelUp() { return this._dispatchSfx('levelUp', () => this._levelUp()); }
  win() { return this._dispatchSfx('win', () => this._win()); }
  lose() { return this._dispatchSfx('lose', () => this._lose()); }
  lowHealth() { return this._dispatchSfx('lowHealth', () => this._lowHealth()); }
  /** Two-level companion escort alarm; pan positions it in the stereo field via sfxBus. */
  companionAlarm(level, pan = 0) {
    return this._dispatchSfx('companionAlarm', (p) => this._companionAlarm(level, p ?? pan), { pan });
  }
}
