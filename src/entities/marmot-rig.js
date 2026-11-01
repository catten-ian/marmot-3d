/** Pure policy for the three clips in the uploaded Beta marmot. */
export const MARMOT_CLIPS = Object.freeze(['Run', 'StandIdle', 'StandUp']);
export const MARMOT_MOVE_THRESHOLD = 0.05;

export function marmotClipForState(state = {}, speed = 0) {
  const mode = typeof state === 'string' ? state : (state.mode || state.state || 'idle');
  // Grazing deliberately uses the supplied Run, even without translation.
  if (mode === 'eat' || state.grazing) return 'Run';
  // Input/follow intent alone is insufficient (blocked or arrived actors idle).
  if (Number.isFinite(speed) && speed > MARMOT_MOVE_THRESHOLD) return 'Run';
  if (mode === 'stand' || mode === 'alert' || state.emote === 'exclaim' || state.stand) return 'StandUp';
  // Jump/rest/groom/bite/check have no uploaded clip: safe standing fallback.
  return 'StandIdle';
}

export function companionFollowStep(distance, dt, gap, speed) {
  if (!(dt > 0) || !Number.isFinite(distance) || distance <= gap) return 0;
  return Math.min(Math.max(0, speed) * dt, distance - gap);
}

export function animationTransition(current, next, fadeSeconds = 0.18) {
  if (!next || next === current) return { changed: false, from: current || null, to: current || next || null, fade: 0 };
  return { changed: true, from: current || null, to: next, fade: Math.max(0.05, fadeSeconds) };
}

export function marmotFallbackDecision({ rigAvailable, clipsAvailable, staticAvailable = true } = {}) {
  if (rigAvailable && clipsAvailable) return 'rig';
  if (staticAvailable) return 'static';
  return 'procedural';
}
