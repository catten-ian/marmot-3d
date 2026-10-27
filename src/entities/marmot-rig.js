/** Pure beta marmot rig policy: no THREE/browser dependencies. */
export const MARMOT_CLIPS = Object.freeze(['Bite', 'Groom', 'Idle', 'Jump', 'Rest', 'Run', 'Sprint', 'Stand']);
export const SPRINT_THRESHOLD = 5.5;

export function marmotClipForState(state = {}, speed = 0) {
  const mode = typeof state === 'string' ? state : (state.mode || state.state || 'idle');
  if (mode === 'jump' || state.jump) return 'Jump';
  if (mode === 'eat' || mode === 'interact' || state.emote === 'check' || state.emote === 'bite') return 'Bite';
  if (mode === 'groom' || state.emote === 'groom') return 'Groom';
  if (mode === 'alert' || state.emote === 'exclaim' || state.stand) return 'Stand';
  if (mode === 'rest' || state.rest || state.safe) return 'Rest';
  if (mode === 'move' || mode === 'follow' || speed > 0.05) return speed >= SPRINT_THRESHOLD ? 'Sprint' : 'Run';
  return 'Idle';
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
