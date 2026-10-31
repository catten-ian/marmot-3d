/**
 * Beta sandbox SmartFox black-box capture and replay helpers.
 * Scope: the explicitly supported Beta free sandbox SmartFox scenario.
 */
export const SMARTFOX_BLACKBOX_FORMAT = 'marmot3d-beta-smartfox-blackbox';
export const SMARTFOX_BLACKBOX_VERSION = 1;
export const BLACKBOX_PRE_SECONDS = 20;
export const BLACKBOX_POST_SECONDS = 5;
export const BLACKBOX_MAX_FRAMES = 1800;
export const BLACKBOX_MAX_EVENTS = 5000;
export const BLACKBOX_MAX_BYTES = 2 * 1024 * 1024;

const finite = (n, fallback = 0) => Number.isFinite(Number(n)) ? Number(n) : fallback;
const clean = (value, depth = 0) => {
  if (depth > 5) return undefined;
  if (value == null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? Number(value.toFixed(5)) : undefined;
  if (Array.isArray(value)) return value.slice(0, 200).map((v) => clean(v, depth + 1)).filter((v) => v !== undefined);
  if (typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value).slice(0, 100)) {
      if (/token|secret|password|apikey|api_key|authorization|email|phone|address|cookie/i.test(k)) continue;
      const c = clean(v, depth + 1); if (c !== undefined) out[k] = c;
    }
    return out;
  }
  return undefined;
};

export function makeSeed(source = null) {
  if (Number.isInteger(source)) return source >>> 0;
  const now = Date.now() >>> 0;
  return (now ^ ((Math.random() * 0xffffffff) >>> 0)) >>> 0;
}

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = (t + Math.imul(t ^ t >>> 7, 61 | t)) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}

function pruneByTime(items, now, seconds) {
  const min = now - seconds;
  while (items.length && finite(items[0].t) < min) items.shift();
}

export class SmartFoxBlackBoxRecorder {
  constructor({ now = () => 0, seed = null, maxFrames = BLACKBOX_MAX_FRAMES, maxEvents = BLACKBOX_MAX_EVENTS } = {}) {
    this.now = now; this.seed = makeSeed(seed); this.maxFrames = maxFrames; this.maxEvents = maxEvents;
    this.reset();
  }
  reset() {
    this.startedAt = finite(this.now()); this.frames = []; this.events = []; this.input = [];
    this.initialSnapshot = null; this.config = {}; this.build = {}; this.capture = null; this.lastPackage = null;
    this._foxIds = new WeakMap(); this._nextFoxId = 1;
  }
  start({ build = {}, config = {}, seed = this.seed, initialSnapshot = null } = {}) {
    this.reset(); this.startedAt = finite(this.now()); this.seed = makeSeed(seed);
    this.build = clean(build) || {}; this.config = clean(config) || {}; this.initialSnapshot = clean(initialSnapshot);
    this.recordEvent('blackbox-start', { seed: this.seed }); return this;
  }
  _t(t = this.now()) { return Math.max(0, finite(t) - this.startedAt); }
  idFor(fox) {
    if (!fox || (typeof fox !== 'object' && typeof fox !== 'function')) return String(fox ?? 'fox');
    let id = this._foxIds.get(fox);
    if (!id) { id = `F${this._nextFoxId++}`; this._foxIds.set(fox, id); }
    return id;
  }
  recordInput(input = {}, t = this.now()) { this.input.push({ t: this._t(t), input: clean(input) || {} }); this._trim(); }
  recordFrame(frame = {}, t = this.now()) {
    const time = this._t(t); const data = clean(frame) || {};
    this.frames.push({ t: time, ...data }); this._trim();
  }
  recordFox(fox = {}, t = this.now()) { this.recordFrame({ kind: 'fox', fox: clean(fox) || {} }, t); }
  recordDecision(decision = {}, t = this.now()) { this.recordEvent('ai-decision', clean(decision) || {}, t); }
  recordEvent(type, data = {}, t = this.now()) { this.events.push({ t: this._t(t), type: String(type), ...clean(data) }); this._trim(); }
  _trim() {
    const now = this._t(); pruneByTime(this.frames, now, BLACKBOX_PRE_SECONDS + BLACKBOX_POST_SECONDS + 2); pruneByTime(this.input, now, BLACKBOX_PRE_SECONDS + BLACKBOX_POST_SECONDS + 2); pruneByTime(this.events, now, BLACKBOX_PRE_SECONDS + BLACKBOX_POST_SECONDS + 2);
    if (this.frames.length > this.maxFrames) this.frames.splice(0, this.frames.length - this.maxFrames);
    if (this.input.length > this.maxFrames) this.input.splice(0, this.input.length - this.maxFrames);
    if (this.events.length > this.maxEvents) this.events.splice(0, this.events.length - this.maxEvents);
  }
  captureAnomaly({ description = '', timestamp = new Date().toISOString(), initialSnapshot = this.initialSnapshot } = {}, t = this.now()) {
    if (this.capture?.status === 'pending') return { pending: true, package: null };
    const at = this._t(t); this.capture = { status: 'pending', at, description: String(description || '').slice(0, 2000), timestamp, initialSnapshot: clean(initialSnapshot) };
    this.recordEvent('capture-requested', { description: this.capture.description }, t);
    if (this._t() - at >= BLACKBOX_POST_SECONDS) return this.finalizeCapture();
    return { pending: true, package: null, captureAt: at, finalizeAfter: at + BLACKBOX_POST_SECONDS };
  }
  tick(t = this.now()) { if (this.capture?.status === 'pending' && this._t(t) >= this.capture.at + BLACKBOX_POST_SECONDS) return this.finalizeCapture(t); return null; }
  finalizeCapture(t = this.now()) {
    if (!this.capture) return this.lastPackage;
    const c = this.capture; const end = this._t(t); const start = Math.max(0, c.at - BLACKBOX_PRE_SECONDS);
    const within = (x) => finite(x.t) >= start && finite(x.t) <= Math.max(end, c.at + BLACKBOX_POST_SECONDS);
    const pkg = {
      format: SMARTFOX_BLACKBOX_FORMAT, version: SMARTFOX_BLACKBOX_VERSION,
      caseId: `sf-${Date.now().toString(36)}-${this.seed.toString(36)}`,
      capturedAt: c.timestamp, window: { preSeconds: BLACKBOX_PRE_SECONDS, postSeconds: BLACKBOX_POST_SECONDS, captureAt: c.at, start, end: Math.min(end, c.at + BLACKBOX_POST_SECONDS) },
      build: clean(this.build) || {}, effectiveConfig: clean(this.config) || {}, rngSeed: this.seed,
      initialScene: clean(c.initialSnapshot || this.initialSnapshot) || {}, description: c.description || '',
      inputStream: this.input.filter(within), foxTrajectories: this.frames.filter((f) => within(f) && f.kind === 'fox'),
      frames: this.frames.filter(within), aiDecisions: this.events.filter((e) => within(e) && e.type === 'ai-decision'),
      eventLog: this.events.filter(within), limits: { maxFrames: this.maxFrames, maxEvents: this.maxEvents },
    };
    pkg.analysis = analyzeBlackBox(pkg);
    while (JSON.stringify(pkg).length > BLACKBOX_MAX_BYTES && (pkg.frames.length || pkg.inputStream.length || pkg.eventLog.length)) {
      if (pkg.frames.length) pkg.frames.shift();
      if (pkg.inputStream.length) pkg.inputStream.shift();
      if (pkg.eventLog.length) pkg.eventLog.shift();
      pkg.foxTrajectories = pkg.frames.filter((f) => f.kind === 'fox');
      pkg.aiDecisions = pkg.eventLog.filter((e) => e.type === 'ai-decision');
      pkg.analysis = analyzeBlackBox(pkg);
    }
    pkg.limits.maxBytes = BLACKBOX_MAX_BYTES; this.lastPackage = pkg; this.capture = { ...c, status: 'complete', package: pkg }; return pkg;
  }
  status(t = this.now()) { return { active: true, pending: this.capture?.status === 'pending', ready: !!this.lastPackage, secondsSinceCapture: this.capture ? Math.max(0, this._t(t) - this.capture.at) : null }; }
}

export function detectNoProgressOscillation(pkg, options = {}) {
  const distance = Number(options.distance ?? 0.08), minSeconds = Number(options.minSeconds ?? 2.5), oscillations = Number(options.oscillations ?? 4);
  const groups = new Map();
  for (const f of pkg.foxTrajectories || []) { const id = f.fox?.id || f.fox?.fox || f.fox?.slot || 'fox'; if (!groups.has(id)) groups.set(id, []); groups.get(id).push(f); }
  const hits = [];
  for (const [id, rows] of groups) {
    if (rows.length < 2) continue; const first = rows[0], last = rows.at(-1); const span = last.t - first.t; let changes = 0;
    for (let i = 2; i < rows.length; i++) { const a = rows[i - 1].fox || {}, b = rows[i].fox || {}, p = rows[i - 2].fox || {}; const d1 = Math.hypot(finite(b.x) - finite(a.x), finite(b.z) - finite(a.z)); const d0 = Math.hypot(finite(a.x) - finite(p.x), finite(a.z) - finite(p.z)); if (d1 < distance && d0 < distance && Math.sign((b.yaw ?? 0) - (a.yaw ?? 0)) !== Math.sign((a.yaw ?? 0) - (p.yaw ?? 0))) changes++; }
    if (span >= minSeconds && changes >= oscillations) hits.push({ detector: 'no-progress-oscillation', fox: id, span, oscillations: changes, threshold: { distance, minSeconds, oscillations } });
  }
  return hits;
}

export function detectRepeatedReorientation(pkg, options = {}) {
  const maxAngle = Number(options.maxAngle ?? 0.12), minRepeats = Number(options.minRepeats ?? 3), windowSeconds = Number(options.windowSeconds ?? 6);
  const rows = (pkg.aiDecisions || []).filter((e) => e.decision?.targetId || e.targetId || e.decision?.target);
  const hits = []; const byTarget = new Map();
  for (const e of rows) { const d = e.decision || e; const target = d.targetId || d.target; if (!byTarget.has(target)) byTarget.set(target, []); byTarget.get(target).push({ e, yaw: finite(d.yaw ?? d.targetYaw), t: e.t }); }
  for (const [target, list] of byTarget) { let repeats = 0; for (let i = 1; i < list.length; i++) { const delta = Math.abs(list[i].yaw - list[i - 1].yaw); if (delta > maxAngle && list[i].t - list[i - 1].t <= windowSeconds) repeats++; } if (repeats >= minRepeats) hits.push({ detector: 'repeated-reorientation', target, repeats, threshold: { maxAngle, minRepeats, windowSeconds } }); }
  return hits;
}

export function detectWastedPounces(pkg, options = {}) {
  const minDistance = Number(options.minDistance ?? 2.2), maxLockError = Number(options.maxLockError ?? 0.55), minAttempts = Number(options.minAttempts ?? 2);
  const attempts = (pkg.eventLog || []).filter((e) => e.type === 'smart-pounce-commit' || e.type === 'pounce-commit');
  const wasted = attempts.filter((e) => finite(e.distance) < minDistance || finite(e.lockAngleError) > maxLockError || e.invalid === true);
  return wasted.length >= minAttempts ? [{ detector: 'wasted-invalid-pounce', attempts: wasted.length, examples: wasted.slice(0, 10), threshold: { minDistance, maxLockError, minAttempts } }] : [];
}

export function analyzeBlackBox(pkg, thresholds = {}) {
  const findings = [
    ...detectNoProgressOscillation(pkg, thresholds.noProgress || {}),
    ...detectRepeatedReorientation(pkg, thresholds.reorientation || {}),
    ...detectWastedPounces(pkg, thresholds.pounce || {}),
  ];
  const timeline = [...(pkg.eventLog || [])].sort((a, b) => a.t - b.t).map((e) => ({ t: e.t, type: e.type, detail: e }));
  return { logicTrace: (pkg.aiDecisions || []).map((e) => ({ t: e.t, ...e })), eventTimeline: timeline, anomalies: findings, synthetic: false };
}

export function replaySmartFoxPackage(pkg, { step, supported = true } = {}) {
  if (!supported) throw new Error('Replay supports only the Beta sandbox SmartFox scenario');
  if (!pkg || pkg.format !== SMARTFOX_BLACKBOX_FORMAT) throw new Error('Unsupported SmartFox black-box package');
  if (typeof step !== 'function') throw new TypeError('replay step callback is required');
  const rng = mulberry32(pkg.rngSeed >>> 0); const out = []; const inputs = pkg.inputStream || [];
  for (const item of inputs) out.push(clean(step({ t: item.t, input: item.input, initialScene: pkg.initialScene, build: pkg.build, effectiveConfig: pkg.effectiveConfig, rng })) || {});
  return out;
}

export function compareReplayTraces(a = [], b = []) {
  const left = JSON.stringify(a), right = JSON.stringify(b); return { identical: left === right, leftLength: a.length, rightLength: b.length, firstDifference: left === right ? null : a.findIndex((v, i) => JSON.stringify(v) !== JSON.stringify(b[i])) };
}

export function compareBlackBoxPackages(a, b, { replayA = null, replayB = null } = {}) {
  const left = replayA || a?.analysis?.logicTrace || []; const right = replayB || b?.analysis?.logicTrace || [];
  return { sameCase: a?.caseId === b?.caseId, buildA: a?.build || {}, buildB: b?.build || {}, trace: compareReplayTraces(left, right), anomaliesA: a?.analysis?.anomalies || [], anomaliesB: b?.analysis?.anomalies || [], eventCountDelta: (b?.eventLog?.length || 0) - (a?.eventLog?.length || 0) };
}

export function exportBlackBoxLocal(pkg, { filename = null, download = true } = {}) {
  try {
    const json = JSON.stringify(pkg, null, 2);
    if (!download || typeof document === 'undefined' || typeof Blob === 'undefined' || typeof URL === 'undefined') return { ok: false, json, reason: 'no-browser-download' };
    const blob = new Blob([json], { type: 'application/json' }); const href = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = href; a.download = filename || `${pkg.caseId || 'smartfox-anomaly'}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(href), 1000); return { ok: true, json };
  } catch (error) { return { ok: false, json: '', reason: String(error?.message || error) }; }
}
