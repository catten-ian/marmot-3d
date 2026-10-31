export function cooldownAngle(remaining, duration) {
  if (!(duration > 0)) return 0;
  return Math.max(0, Math.min(1, Number(remaining) / duration)) * 360;
}

export function cooldownState({ remaining = 0, duration = 0, energy = 0, cost = 0, charge = 100, charging = false } = {}) {
  if (energy < cost) return 'no-energy';
  if (charging && charge < 100) return 'charging';
  if (remaining > 0) return 'cd';
  return 'ready';
}

export function cooldownOverlayData(input = {}) {
  const state = cooldownState(input);
  return { state, angle: state === 'cd' ? cooldownAngle(input.remaining, input.duration) : state === 'charging' ? cooldownAngle(100 - input.charge, 100) : 0 };
}
