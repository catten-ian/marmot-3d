/** Pure helpers for the dev Verdant fall-safety path (no DOM or Three.js). */
export const VERDANT_KILL_PLANE_MARGIN = 12;
export const VERDANT_LOCAL_DROP_MARGIN = 10;
export const VERDANT_VOID_DROP_MARGIN = 2.5;
export const VERDANT_SWEEP_STEP = 0.1;

/**
 * Sweep a descending player point from `from` to `to`, sampling the full XZ path.
 * Returns the first walkable surface crossed, or null. `groundAt` returns
 * `{ y, walkable }`, allowing this to be tested without a renderer or scene.
 */
export function findSegmentLanding({ from, to, groundAt, maxStep = VERDANT_SWEEP_STEP }) {
  if (typeof groundAt !== 'function' || !from || !to) return null;
  const vals = [from.x, from.y, from.z, to.x, to.y, to.z];
  if (!vals.every(Number.isFinite) || to.y >= from.y) return null;
  const step = Number.isFinite(maxStep) && maxStep > 0 ? maxStep : VERDANT_SWEEP_STEP;
  const dx = to.x - from.x, dz = to.z - from.z;
  const count = Math.max(1, Math.ceil(Math.hypot(dx, dz) / step), Math.ceil(Math.abs(to.y - from.y) / Math.max(step, 0.15)));
  for (let i = 0; i <= count; i++) {
    const t = i / count;
    const x = from.x + dx * t, z = from.z + dz * t;
    const y = from.y + (to.y - from.y) * t;
    const ground = groundAt(x, z);
    const surfaceY = ground?.y;
    if (!ground?.walkable || !Number.isFinite(surfaceY)) {
      continue;
    }
    if (y > surfaceY) {
      continue;
    }
    // If the sweep starts inside/below a valid column, resolve immediately too.
    return { x, y: surfaceY, z, t, ground };
  }
  return null;
}

/**
 * Sweep a grounded horizontal move to avoid stepping across a narrow void or
 * an unwalkable tall ledge when one delayed frame spans several height cells.
 * Descents are intentionally not blocked, preserving normal downhill movement.
 */
export function findGroundPathBlock({ from, to, groundAt, maxStep = VERDANT_SWEEP_STEP, maxStepUp = 0.42 }) {
  if (typeof groundAt !== 'function' || !from || !to
    || ![from.x, from.z, to.x, to.z].every(Number.isFinite)) return null;
  const step = Number.isFinite(maxStep) && maxStep > 0 ? maxStep : VERDANT_SWEEP_STEP;
  const dx = to.x - from.x, dz = to.z - from.z;
  const count = Math.max(1, Math.ceil(Math.hypot(dx, dz) / step));
  let previous = null;
  for (let i = 0; i <= count; i++) {
    const t = i / count;
    const x = from.x + dx * t, z = from.z + dz * t;
    const ground = groundAt(x, z);
    if (!ground?.walkable || !Number.isFinite(ground.y)) return { x, z, t, reason: 'void' };
    if (previous && ground.y - previous.y > maxStepUp) return { x, z, t, reason: 'step' };
    previous = ground;
  }
  return null;
}

/** Conservative anomaly test; ordinary slopes and shallow burrows stay valid. */
export function shouldRescueVerdantPosition({
  position, ground, bounds, minWalkableY,
  killPlane = Number.isFinite(minWalkableY) ? minWalkableY - VERDANT_KILL_PLANE_MARGIN : -Infinity,
  localDropMargin = VERDANT_LOCAL_DROP_MARGIN,
  voidDropMargin = VERDANT_VOID_DROP_MARGIN,
}) {
  const p = position;
  if (!p || ![p.x, p.y, p.z].every(Number.isFinite)) return { rescue: true, reason: 'non-finite' };
  if (p.y < killPlane) return { rescue: true, reason: 'kill-plane' };
  if (ground?.walkable && Number.isFinite(ground.y) && p.y < ground.y - localDropMargin) {
    return { rescue: true, reason: 'below-local-ground' };
  }
  const outside = !!bounds && (p.x < bounds.minX || p.x > bounds.maxX || p.z < bounds.minZ || p.z > bounds.maxZ);
  if (outside && ground?.walkable !== true && Number.isFinite(ground?.y)
    && p.y < ground.y - voidDropMargin) {
    return { rescue: true, reason: 'outside-without-ground' };
  }
  return { rescue: false, reason: '' };
}

/** Grounded feet follow the sampled surface immediately; airborne Y is never clamped. */
export function resolveGroundedY(positionY, groundY, grounded) {
  return grounded && Number.isFinite(groundY) ? groundY : positionY;
}

/** Exact nearest walkable grid cell; used only when the requested column is invalid. */
export function findNearestWalkableCell({ x, z, nx, nz, cellSize, bounds, walkable, top, heightAt }) {
  if (!Number.isInteger(nx) || !Number.isInteger(nz) || nx <= 0 || nz <= 0
    || !Number.isFinite(cellSize) || cellSize <= 0 || !bounds || !walkable || !top) return null;
  const qx = Number.isFinite(x) ? x : (bounds.minX + bounds.maxX) / 2;
  const qz = Number.isFinite(z) ? z : (bounds.minZ + bounds.maxZ) / 2;
  const clampIndex = (v, min, n) => Math.max(0, Math.min(n - 1, Math.floor((v - min) / cellSize)));
  const ci = clampIndex(qx, bounds.minX, nx), cj = clampIndex(qz, bounds.minZ, nz);
  const ck = cj * nx + ci;
  const requestedInside = qx >= bounds.minX && qx <= bounds.maxX && qz >= bounds.minZ && qz <= bounds.maxZ;
  if (requestedInside && walkable[ck] && Number.isFinite(top[ck])) {
    const y = typeof heightAt === 'function' ? heightAt(qx, qz) : top[ck];
    if (Number.isFinite(y)) return { x: qx, y, z: qz, moved: 0 };
  }

  let bestK = -1, bestD2 = Infinity;
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const k = j * nx + i;
    if (!walkable[k] || !Number.isFinite(top[k])) continue;
    const wx = Math.min(bounds.maxX, bounds.minX + (i + 0.5) * cellSize);
    const wz = Math.min(bounds.maxZ, bounds.minZ + (j + 0.5) * cellSize);
    const d2 = (wx - qx) ** 2 + (wz - qz) ** 2;
    if (d2 < bestD2) { bestD2 = d2; bestK = k; }
  }
  if (bestK < 0) return null;
  const i = bestK % nx, j = Math.floor(bestK / nx);
  return {
    x: Math.min(bounds.maxX, bounds.minX + (i + 0.5) * cellSize),
    y: top[bestK],
    z: Math.min(bounds.maxZ, bounds.minZ + (j + 0.5) * cellSize),
    moved: Math.sqrt(bestD2),
  };
}
