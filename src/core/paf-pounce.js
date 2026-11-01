/**
 * PAF pounce path and catch contract shared by live hit detection and aim preview.
 * No DOM/THREE dependencies: terrain sampling is injected so the same logic is testable
 * in Node and usable with the runtime deterministic terrainHeight() field.
 */
import { canCatch } from './predator-prey.js';

const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
const clamp = (value, min, max) => value < min ? min : value > max ? max : value;

export const PAF_POUNCE_ACTIVE_T = 0.5;

export function pafPounceProgress(phaseT, lungeTime) {
  return finite(phaseT, 0) / Math.max(0.0001, finite(lungeTime, 0));
}

export function pafPounceActiveAt(phaseT, lungeTime, activeStart = PAF_POUNCE_ACTIVE_T) {
  const t = pafPounceProgress(phaseT, lungeTime);
  return t >= finite(activeStart, PAF_POUNCE_ACTIVE_T) && t <= 1;
}

export function pafPounceAirHeight(t, lungeHeight) {
  return Math.sin(Math.PI * clamp(finite(t, 0), 0, 1)) * Math.max(0, finite(lungeHeight, 0));
}

/** Exact straight-line position used by both preview geometry and live lunge movement. */
export function pafPouncePathAt({ startX = 0, startZ = 0, yaw = 0, lungeSpeed = 0, lungeTime = 0, t = 0 } = {}) {
  const clampedT = clamp(finite(t, 0), 0, 1);
  const distance = finite(lungeSpeed, 0) * Math.max(0, finite(lungeTime, 0)) * clampedT;
  return {
    x: finite(startX, 0) + Math.sin(finite(yaw, 0)) * distance,
    z: finite(startZ, 0) + Math.cos(finite(yaw, 0)) * distance,
    t: clampedT,
  };
}

export function pafPouncePreviewSegment({
  startX = 0, startZ = 0, yaw = 0, lungeSpeed = 0, lungeTime = 0,
  activeStart = PAF_POUNCE_ACTIVE_T, catchRadius = 0,
} = {}) {
  return {
    start: pafPouncePathAt({ startX, startZ, yaw, lungeSpeed, lungeTime, t: activeStart }),
    end: pafPouncePathAt({ startX, startZ, yaw, lungeSpeed, lungeTime, t: 1 }),
    radius: Math.max(0, finite(catchRadius, 0)),
    activeStart: finite(activeStart, PAF_POUNCE_ACTIVE_T),
  };
}

/**
 * Reuses predator-prey.canCatch for horizontal radius and vertical window. The only
 * added gate is the explicit pounce path time t, restricted to 0.5 <= t <= 1.
 */
export function pafPounceCanCatchAt({
  startX = 0, startZ = 0, yaw = 0, lungeSpeed = 0, lungeTime = 0, t = 0,
  lungeHeight = 0, targetX = 0, targetZ = 0, foxTerrainY = 0, preyTerrainY = 0,
  catchRadius = 0, catchFoxCenter = 0, catchVerticalTol = 0, preyCenterHeight = 0,
} = {}) {
  const activeT = finite(t, 0);
  if (activeT < PAF_POUNCE_ACTIVE_T || activeT > 1) return false;
  const pos = pafPouncePathAt({ startX, startZ, yaw, lungeSpeed, lungeTime, t: activeT });
  const airY = pafPounceAirHeight(pos.t, lungeHeight);
  return canCatch(
    finite(targetX, 0) - pos.x,
    finite(targetZ, 0) - pos.z,
    airY,
    finite(preyTerrainY, 0),
    {
      catchRadius: Math.max(0, finite(catchRadius, 0)),
      catchFoxCenter: finite(catchFoxCenter, 0),
      catchVerticalTol: Math.max(0, finite(catchVerticalTol, 0)),
      preyCenterHeight: finite(preyCenterHeight, 0),
    },
    finite(foxTerrainY, 0),
  );
}

/**
 * Preview marker predicate. It is deliberately a dense sweep over the real active
 * interval using the same canCatch wrapper as live resolution. Targets moving after
 * release naturally invalidate an earlier prediction; that is a time-of-aim snapshot.
 */
export function pafPouncePredictionHitsTarget({
  startX = 0, startZ = 0, yaw = 0, lungeSpeed = 0, lungeTime = 0,
  activeStart = PAF_POUNCE_ACTIVE_T, lungeHeight = 0, targetX = 0, targetZ = 0,
  catchRadius = 0, catchFoxCenter = 0, catchVerticalTol = 0, preyCenterHeight = 0,
  foxTerrainAt = () => 0, preyTerrainAt = () => 0, sampleCount = 64,
} = {}) {
  const start = clamp(finite(activeStart, PAF_POUNCE_ACTIVE_T), 0, 1);
  const count = Math.max(1, Math.floor(finite(sampleCount, 64)));
  for (let i = 0; i <= count; i++) {
    const t = start + (1 - start) * (i / count);
    const pos = pafPouncePathAt({ startX, startZ, yaw, lungeSpeed, lungeTime, t });
    const hit = pafPounceCanCatchAt({
      startX, startZ, yaw, lungeSpeed, lungeTime, t, lungeHeight,
      targetX, targetZ, foxTerrainY: foxTerrainAt(pos.x, pos.z, t),
      preyTerrainY: preyTerrainAt(targetX, targetZ, t),
      catchRadius, catchFoxCenter, catchVerticalTol, preyCenterHeight,
    });
    if (hit) return { hit: true, t, x: pos.x, z: pos.z };
  }
  return { hit: false, t: null, x: null, z: null };
}
