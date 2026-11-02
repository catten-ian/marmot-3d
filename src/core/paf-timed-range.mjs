/** Pure contracts for PAF timed rounds and vertical pounce-range input. */

export const PAF_TIMED_ROUND_MS = 120000;
export const PAF_POUNCE_RANGE_DEFAULT = 5.67;
export const PAF_POUNCE_RANGE_MIN = 3.6;
export const PAF_POUNCE_RANGE_MAX = 7.2;
export const PAF_POUNCE_RANGE_PER_PIXEL = 0.02;

const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
const clamp = (value, min, max) => value < min ? min : value > max ? max : value;

export function clampPounceRange(value, {
  min = PAF_POUNCE_RANGE_MIN,
  max = PAF_POUNCE_RANGE_MAX,
} = {}) {
  const lo = Math.min(finite(min, PAF_POUNCE_RANGE_MIN), finite(max, PAF_POUNCE_RANGE_MAX));
  const hi = Math.max(finite(min, PAF_POUNCE_RANGE_MIN), finite(max, PAF_POUNCE_RANGE_MAX));
  return clamp(finite(value, PAF_POUNCE_RANGE_DEFAULT), lo, hi);
}

/** Screen-up drag (negative dy) extends the real pounce; screen-down shortens it. */
export function pounceRangeFromDrag(baseRange = PAF_POUNCE_RANGE_DEFAULT, dy = 0, options = {}) {
  const scale = Math.max(0, finite(options.pixelsPerMeter, 1 / PAF_POUNCE_RANGE_PER_PIXEL));
  return clampPounceRange(finite(baseRange, PAF_POUNCE_RANGE_DEFAULT) - finite(dy, 0) / scale, options);
}

export function createPafTimedRound({ durationMs = PAF_TIMED_ROUND_MS } = {}) {
  const duration = Math.max(1, Math.round(finite(durationMs, PAF_TIMED_ROUND_MS)));
  let status = 'idle';
  let elapsedMs = 0;

  const snapshot = (justFinished = false) => ({ status, elapsedMs, remainingMs: Math.max(0, duration - elapsedMs), durationMs: duration, justFinished });
  const start = () => {
    if (status !== 'idle') return snapshot();
    status = 'running';
    return snapshot();
  };
  const pause = () => {
    if (status === 'running') status = 'paused';
    return snapshot();
  };
  const resume = () => {
    if (status === 'paused') status = 'running';
    return snapshot();
  };
  const restart = () => {
    elapsedMs = 0;
    status = 'running';
    return snapshot();
  };
  const tick = (deltaMs = 0) => {
    if (status !== 'running') return snapshot();
    const delta = Math.max(0, finite(deltaMs, 0));
    const next = Math.min(duration, elapsedMs + delta);
    const justFinished = next >= duration && elapsedMs < duration;
    elapsedMs = next;
    if (justFinished) status = 'finished';
    return snapshot(justFinished);
  };
  return {
    get status() { return status; },
    get elapsedMs() { return elapsedMs; },
    get remainingMs() { return Math.max(0, duration - elapsedMs); },
    get durationMs() { return duration; },
    get canScore() { return status === 'running'; },
    snapshot,
    start,
    pause,
    resume,
    restart,
    tick,
  };
}
