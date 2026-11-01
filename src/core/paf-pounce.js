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
  const sample = pafPounceCatchSample({ startX, startZ, yaw, lungeSpeed, lungeTime, t, lungeHeight,
    foxTerrainY, catchRadius, catchFoxCenter, catchVerticalTol, preyCenterHeight });
  return pafPounceCatchSampleHits(sample, targetX, targetZ, preyTerrainY);
}

/** Immutable geometry for one active instant; shared by live catch and filled ground preview. */
export function pafPounceCatchSample(params = {}) {
  const t = finite(params.t, 0);
  const pos = pafPouncePathAt(params);
  return {
    x: pos.x, z: pos.z, active: t >= PAF_POUNCE_ACTIVE_T && t <= 1,
    airY: pafPounceAirHeight(t, params.lungeHeight), foxTerrainY: finite(params.foxTerrainY, 0),
    catchConfig: {
      catchRadius: Math.max(0, finite(params.catchRadius, 0)),
      catchFoxCenter: finite(params.catchFoxCenter, 0),
      catchVerticalTol: Math.max(0, finite(params.catchVerticalTol, 0)),
      preyCenterHeight: finite(params.preyCenterHeight, 0),
    },
  };
}

export function pafPounceCatchSampleHits(sample, targetX, targetZ, preyTerrainY) {
  return sample.active && canCatch(finite(targetX, 0) - sample.x, finite(targetZ, 0) - sample.z,
    sample.airY, finite(preyTerrainY, 0), sample.catchConfig, sample.foxTerrainY);
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

export const PAF_POUNCE_PREVIEW_GRID = Object.freeze({ columns: 32, rows: 16 });
export const PAF_POUNCE_PREVIEW_STYLE = Object.freeze({ color: 0x9fd8ff, opacity: 0.28 });

/** Release commits the origin; the entire attack remains visible through recovery. */
export function pafPouncePreviewActive(phase) {
  return phase === 'wind' || phase === 'lunge' || phase === 'recover';
}

/** Flat horizontal sweep boundary, derived from the same path/radius as live catches.
 * The filled footprint is a horizontal envelope; target markers additionally test height/terrain.
 * Returns world X/Z positions for terrain draping, with no THREE dependency.
 */
export function pafPounceFootprint(params = {}, capSteps = 20) {
  const segment = pafPouncePreviewSegment(params);
  const yaw = finite(params.yaw, 0);
  const points = [];
  const steps = Math.max(4, Math.floor(finite(capSteps, 20)));
  for (const [center, offset] of [[segment.end, -Math.PI / 2], [segment.start, Math.PI / 2]]) {
    for (let i = 0; i <= steps; i++) {
      const a = yaw + offset + Math.PI * i / steps;
      points.push({ x: center.x + Math.sin(a) * segment.radius, z: center.z + Math.cos(a) * segment.radius });
    }
  }
  return { ...segment, points };
}

/** Conservative terrain-draped preview of the actual ground-prey catch predicate.
 * Every emitted vertex and triangle center must pass the SAME active-time/height/radius
 * test as live catches. The grid omits a thin edge rather than claiming unreachable area.
 * Terrain is injected, so this geometry remains pure and independently testable.
 */
export function pafPounceGroundPreview(params = {}, terrainAt = () => 0, columns = PAF_POUNCE_PREVIEW_GRID.columns, rows = PAF_POUNCE_PREVIEW_GRID.rows) {
  const { startX, startZ, yaw: inputYaw, lungeSpeed, lungeTime, lungeHeight, catchRadius, catchFoxCenter, catchVerticalTol, preyCenterHeight } = params;
  params = { startX, startZ, yaw: inputYaw, lungeSpeed, lungeTime, lungeHeight, catchRadius, catchFoxCenter, catchVerticalTol, preyCenterHeight };
  const footprint = pafPouncePreviewSegment(params);
  const yaw = finite(params.yaw, 0), sy = Math.sin(yaw), cy = Math.cos(yaw);
  const origin = pafPouncePathAt({ ...params, t: 0 });
  const length = Math.hypot(footprint.end.x - origin.x, footprint.end.z - origin.z);
  const near = length * PAF_POUNCE_ACTIVE_T - footprint.radius;
  const far = length + footprint.radius;
  const samples = [];
  for (let i = 0; i <= 64; i++) {
    const t = PAF_POUNCE_ACTIVE_T + (1 - PAF_POUNCE_ACTIVE_T) * i / 64;
    const pos = pafPouncePathAt({ ...params, t });
    samples.push(pafPounceCatchSample({ ...params, t, foxTerrainY: terrainAt(pos.x, pos.z) }));
  }
  const point = (side, along) => {
    const x = origin.x + sy * along + cy * side;
    const z = origin.z + cy * along - sy * side;
    const y = terrainAt(x, z);
    const hit = samples.some(sample => pafPounceCatchSampleHits(sample, x, z, y));
    return { x, y: y + 0.045, z, hit };
  };
  const grid = [];
  const nx = Math.max(1, Math.floor(columns)), nz = Math.max(1, Math.floor(rows));
  for (let i = 0; i <= nx; i++) {
    const row = [];
    for (let j = 0; j <= nz; j++) row.push(point(-footprint.radius + 2 * footprint.radius * j / nz, near + (far - near) * i / nx));
    grid.push(row);
  }
  const positions = [];
  const triangle = (a, b, c) => {
    if (!a.hit || !b.hit || !c.hit) return;
    const midX = (a.x + b.x + c.x) / 3, midZ = (a.z + b.z + c.z) / 3;
    const side = (midX - origin.x) * cy - (midZ - origin.z) * sy;
    const along = (midX - origin.x) * sy + (midZ - origin.z) * cy;
    if (!point(side, along).hit) return;
    for (const v of [a,b,c]) positions.push(v.x, v.y, v.z);
  };
  for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
    triangle(grid[i][j], grid[i+1][j], grid[i][j+1]);
    triangle(grid[i+1][j], grid[i+1][j+1], grid[i][j+1]);
  }
  return positions;
}
