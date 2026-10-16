// Pure attack-wheel selection shared by touch and keyboard input.
export const ATTACK_MOVES = ['tap', 'dodge', 'stand', 'lunge'];
export const ATTACK_DEAD_ZONE = 18;

export function selectAttackMove({ dx = 0, dy = 0, moved = false } = {}) {
  const x = Number(dx) || 0;
  const y = Number(dy) || 0;
  if (!moved || Math.hypot(x, y) <= ATTACK_DEAD_ZONE) return 'tap';
  // Screen coordinates: up is negative y. Forward has a deliberately wide upper wedge.
  if (y < 0 && Math.abs(x) <= -y) return 'lunge';
  if (x < 0) return 'stand';
  if (x > 0) return 'dodge';
  return y < 0 ? 'lunge' : 'tap';
}

export function selectAttackMoveFromInput(moveX = 0, moveZ = 0) {
  const x = Number(moveX) || 0;
  const z = Number(moveZ) || 0;
  if (Math.hypot(x, z) < 0.1) return 'tap';
  if (z > Math.abs(x)) return 'lunge';
  if (x < 0) return 'stand';
  if (x > 0) return 'dodge';
  return z > 0 ? 'lunge' : 'tap';
}
