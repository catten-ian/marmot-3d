import { BURROWS, scalePoint, scaleRadius } from '../core/config.js';
import { terrainHeight, baseTerrainHeight, heightFieldActive, depressionAt } from '../core/utils.js';

let _defs = [];
// dev Verdant 实体场景里不存在程序化洞穴，腔室下沉会在出生点附近挖出深坑（真机掉底）。
let _cavesEnabled = true;
export function setUndergroundCavesEnabled(v) { _cavesEnabled = v !== false; }
export function undergroundCavesEnabled() { return _cavesEnabled; }
export function configureUnderground(defs = []) { _defs = defs; return _defs; }
export function undergroundDefs() { return _defs; }

export function undergroundProfile(def) {
  const base = def.type === 'base' ? 1 : 0;
  return {
    openingRadius: def.openingRadius ?? (base ? 2.2 : 1.05),
    slopeRadius: def.slopeRadius ?? (base ? 3.6 : 1.9),
    chamberRadius: def.chamberRadius ?? (base ? 3.0 : 1.5),
    chamberDepth: def.chamberDepth ?? (base ? 3.8 : 2),
  };
}

export function undergroundFloorY(x, z, defs = _defs) {
  // 程序化地形的凹陷已写入 terrainHeight；GS 高度场则在这里叠加近似下沉腔室。
  // 实体摄影场景（Verdant）没有地下层，直接返回高度场值。
  if (!_cavesEnabled) return terrainHeight(x, z);
  let y = heightFieldActive() ? terrainHeight(x, z) : baseTerrainHeight(x, z);
  for (const b of defs || []) {
    const p = undergroundProfile(b);
    const d = Math.hypot(x - b.x, z - b.z);
    if (d >= p.slopeRadius) continue;
    const surface = heightFieldActive() ? terrainHeight(b.x, b.z) : baseTerrainHeight(b.x, b.z);
    y = Math.min(y, surface - p.chamberDepth * depressionAt(d, p));
  }
  return y;
}

export function burrowVolumeAt(x, y, z, defs = _defs) {
  for (const b of defs || []) {
    const p = undergroundProfile(b);
    const surface = heightFieldActive() ? terrainHeight(b.x, b.z) : baseTerrainHeight(b.x, b.z);
    const d = Math.hypot(x - b.x, z - b.z);
    if (d > p.slopeRadius) continue;
    const floor = undergroundFloorY(x, z, [b]);
    // Only the below-surface part of the ramp/chamber is a burrow. Surface decoration is not.
    if (y < surface - 0.18 && y <= floor + 0.7) return b;
  }
  return null;
}

export function scaledUndergroundDefaults() {
  return BURROWS.map((b) => { const [x, z] = scalePoint([b.x, b.z]); return { ...b, x, z, r: scaleRadius(b.r) }; });
}
