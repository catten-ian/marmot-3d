import { BURROWS, scalePoint, scaleRadius, fieldHalf, ROCKS, BERRY_POINTS, SPAWN_POINTS } from '../core/config.js';
import { Burrow } from './props.js';
import { configureUnderground } from './underground.js';

/** 运行时洞穴布局：位置/半径与 GS 点位缩放保持一致。 */
export function scaledBurrows() {
  return BURROWS.map((b) => {
    const [x, z] = scalePoint([b.x, b.z]);
    return { ...b, x, z, r: scaleRadius(b.r) };
  });
}

export function createBurrows(scene, { resolveDefinition = null } = {}) {
  let defs = scaledBurrows();
  if (typeof resolveDefinition === 'function') {
    const placed = [];
    defs = defs.map((def, index) => {
      const next = resolveDefinition(def, index, placed) || def;
      placed.push(next);
      return next;
    });
  }
  configureUnderground(defs);
  const objects = defs.map((def) => new Burrow(scene, def));
  return { defs, objects, base: defs[0], baseObject: objects[0] };
}

export function burrowAt(x, z, defs, margin = 0) {
  for (const b of defs || []) if (Math.hypot(x - b.x, z - b.z) < b.r + margin) return b;
  return null;
}

export function nearestBurrow(x, z, defs) {
  let best = null, bestD = Infinity;
  for (const b of defs || []) { const d = Math.hypot(x - b.x, z - b.z); if (d < bestD) { best = b; bestD = d; } }
  return best;
}

/** 无 WebGL 的布局审计，供工具测试和 dev 诊断复用。 */
export function auditBurrows(defs = scaledBurrows(), minGap = 2) {
  const { hw, hh } = fieldHalf();
  const issues = [];
  const points = [...BERRY_POINTS, ...SPAWN_POINTS].map(scalePoint);
  for (const b of defs) {
    if (Math.abs(b.x) + b.r > hw || Math.abs(b.z) + b.r > hh) issues.push(`${b.id}: outside field`);
    for (const rock of ROCKS) {
      const [x, z] = scalePoint(rock);
      if (Math.hypot(b.x - x, b.z - z) < b.r + scaleRadius(rock[2]) + minGap) issues.push(`${b.id}: rock overlap`);
    }
    for (const [x, z] of points) if (Math.hypot(b.x - x, b.z - z) < b.r + minGap) issues.push(`${b.id}: point overlap`);
  }
  for (let i = 0; i < defs.length; i++) for (let j = i + 1; j < defs.length; j++) {
    if (Math.hypot(defs[i].x - defs[j].x, defs[i].z - defs[j].z) < defs[i].r + defs[j].r + minGap) issues.push(`${defs[i].id}/${defs[j].id}: overlap`);
  }
  return { ok: issues.length === 0, issues };
}
