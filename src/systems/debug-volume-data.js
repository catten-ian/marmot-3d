import { PLAYER, FOX } from '../core/config.js';
import { STRIKE_VOLUMES, resolveStrikeProfile } from './combat.js';

export { STRIKE_VOLUMES, resolveStrikeProfile };

export function strikeVolumeGeometryData({ move = 'tap', range = 2.4, halfAngle = STRIKE_VOLUMES.halfAngle, lower = STRIKE_VOLUMES[move]?.lower, upper = STRIKE_VOLUMES[move]?.upper, segments = 20 } = {}) {
  const pts = [];
  const n = Math.max(4, segments | 0);
  for (let i = 0; i <= n; i++) {
    const a = -halfAngle + (2 * halfAngle * i) / n;
    pts.push({ x: Math.sin(a) * range, z: -Math.cos(a) * range });
  }
  return { type: 'strike-fan-column', move, range, halfAngle, lower, upper, arc: pts };
}

export function rollGeometryData({ distance = PLAYER.combatWheel.dodge.distance, invuln = PLAYER.combatWheel.dodge.invuln, direction = { x: 0, z: -1 } } = {}) {
  return { type: 'roll-envelope', distance, invuln, direction: { x: direction.x, z: direction.z }, radius: PLAYER.radius, height: PLAYER.collisionHeight };
}

export function foxAttackGeometryData(fox = {}) {
  const attack = fox.attack || FOX.attacks.normal;
  const dashDistance = FOX.dashSpeed * (fox.dashTime || attack.dashTime || 0.32) * (attack.dashSpeedMul || 1);
  return { type: attack.mode === 'leap' ? 'fox-leap-track' : 'fox-ground-warning', distance: dashDistance,
    groundAttackHeight: FOX.groundAttackHeight, leapHeight: attack.leapHeight || 0, yaw: fox.yaw || 0 };
}
