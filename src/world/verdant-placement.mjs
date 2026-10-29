/** Pure, deterministic placement on connected Verdant surface layers. */
export const VERDANT_SURFACE_LAYER_COUNT = 4;
const SUPPORT_RING = [
  [0, 0], [0.5, 0], [-0.5, 0], [0, 0.5], [0, -0.5],
  [1, 0], [-1, 0], [0, 1], [0, -1],
  [0.70710678, 0.70710678], [-0.70710678, 0.70710678],
  [0.70710678, -0.70710678], [-0.70710678, -0.70710678],
];

/** Label walkable mesh surfaces by 4-connected XZ adjacency and similar height. */
export function buildSurfaceComponents({
  surfaceLayers, walkable, nx, nz, cellSize, layerCount = VERDANT_SURFACE_LAYER_COUNT,
  maxAdjacentDelta = Math.max(0.62, cellSize * 2.8),
}) {
  if (!surfaceLayers || !walkable || !Number.isInteger(nx) || !Number.isInteger(nz)) {
    return { labels: new Int32Array(), sizes: [], count: 0 };
  }
  const nodeCount = nx * nz * layerCount;
  const labels = new Int32Array(nodeCount).fill(-1);
  const queue = new Int32Array(nodeCount);
  const sizes = [];
  let count = 0;
  const layerAt = (k, s) => surfaceLayers[k * layerCount + s];
  for (let k = 0; k < nx * nz; k++) {
    if (!walkable[k]) continue;
    for (let slot = 0; slot < layerCount; slot++) {
      const start = k * layerCount + slot;
      if (!Number.isFinite(layerAt(k, slot)) || labels[start] !== -1) continue;
      const component = count++;
      let head = 0, tail = 0;
      labels[start] = component; queue[tail++] = start;
      while (head < tail) {
        const node = queue[head++];
        const cell = Math.floor(node / layerCount), currentSlot = node % layerCount;
        const i = cell % nx, j = Math.floor(cell / nx), y = layerAt(cell, currentSlot);
        const neighbors = [i ? cell - 1 : -1, i + 1 < nx ? cell + 1 : -1,
          j ? cell - nx : -1, j + 1 < nz ? cell + nx : -1];
        for (const neighbor of neighbors) {
          if (neighbor < 0 || !walkable[neighbor]) continue;
          let nearestSlot = -1, nearestDelta = Infinity;
          for (let ns = 0; ns < layerCount; ns++) {
            const ny = layerAt(neighbor, ns), delta = Math.abs(ny - y);
            if (!Number.isFinite(ny) || delta > maxAdjacentDelta || delta >= nearestDelta) continue;
            nearestSlot = ns; nearestDelta = delta;
          }
          if (nearestSlot < 0) continue;
          // Reciprocal nearest-height matching keeps nearby parallel decks from
          // collapsing into one component when their vertical gap is small.
          const neighborY = layerAt(neighbor, nearestSlot);
          let reverseSlot = -1, reverseDelta = Infinity;
          for (let ns = 0; ns < layerCount; ns++) {
            const ny = layerAt(cell, ns), delta = Math.abs(ny - neighborY);
            if (!Number.isFinite(ny) || delta > maxAdjacentDelta || delta >= reverseDelta) continue;
            reverseSlot = ns; reverseDelta = delta;
          }
          if (reverseSlot !== currentSlot) continue;
          const next = neighbor * layerCount + nearestSlot;
          if (labels[next] !== -1) continue;
          labels[next] = component; queue[tail++] = next;
        }
      }
      sizes.push(tail);
    }
  }
  return { labels, sizes, count };
}

function inObstacle(field, i, j) {
  const k = j * field.nx + i;
  return !!(field.obstacleMask && field.obstacleMask[k]);
}

function nearestLayer(field, x, z, component, targetY, maxCellDistance = 1.6, avoidObstacles = true) {
  const { nx, nz, bounds, cellSize, surfaceLayers, layerLabels, layerCount } = field;
  const ix = Math.floor((x - bounds.minX) / cellSize), iz = Math.floor((z - bounds.minZ) / cellSize);
  const reach = Math.max(1, Math.ceil(maxCellDistance));
  let best = null, bestScore = Infinity;
  for (let j = iz - reach; j <= iz + reach; j++) for (let i = ix - reach; i <= ix + reach; i++) {
    if (i < 0 || j < 0 || i >= nx || j >= nz) continue;
    const k = j * nx + i;
    if (!field.walkable[k]) continue;
    const cx = bounds.minX + (i + 0.5) * cellSize;
    const cz = bounds.minZ + (j + 0.5) * cellSize;
    const d2 = (cx - x) ** 2 + (cz - z) ** 2;
    if (d2 > (maxCellDistance * cellSize) ** 2) continue;
    if (avoidObstacles && inObstacle(field, i, j)) continue;
    for (let slot = 0; slot < layerCount; slot++) {
      const node = k * layerCount + slot;
      if (layerLabels[node] !== component) continue;
      const y = surfaceLayers[node];
      if (!Number.isFinite(y)) continue;
      const dy = Number.isFinite(targetY) ? Math.abs(y - targetY) : 0;
      const score = d2 + dy * dy * 0.08;
      if (score < bestScore) { bestScore = score; best = { i, j, k, slot, x: cx, y, z: cz, d2 }; }
    }
  }
  return best;
}

function sampleLayerHeight(field, x, z, component, referenceY) {
  const { bounds, cellSize, nx, nz, layerCount, surfaceLayers, layerLabels } = field;
  const gx = (x - bounds.minX) / cellSize - 0.5;
  const gz = (z - bounds.minZ) / cellSize - 0.5;
  const fi = Math.max(0, Math.min(nx - 1, gx));
  const fj = Math.max(0, Math.min(nz - 1, gz));
  const i0 = Math.floor(fi), j0 = Math.floor(fj), i1 = Math.min(nx - 1, i0 + 1), j1 = Math.min(nz - 1, j0 + 1);
  const fx = fi - i0, fz = fj - j0;
  const sample = (i, j) => {
    const k = j * nx + i;
    for (let s = 0; s < layerCount; s++) {
      const node = k * layerCount + s;
      if (layerLabels[node] === component && Number.isFinite(surfaceLayers[node])) return surfaceLayers[node];
    }
    const near = nearestLayer(field, bounds.minX + (i + 0.5) * cellSize,
      bounds.minZ + (j + 0.5) * cellSize, component, referenceY, 1.4, false);
    return near?.y;
  };
  const a = sample(i0, j0), b = sample(i1, j0), c = sample(i0, j1), d = sample(i1, j1);
  if (![a, b, c, d].every(Number.isFinite)) return null;
  return (a * (1 - fx) + b * fx) * (1 - fz) + (c * (1 - fx) + d * fx) * fz;
}

/**
 * Resolve a circular entity footprint onto one connected mesh layer. A result is
 * rejected if any support probe is missing, on a different layer, obstructed,
 * too uneven, or covered by a low ceiling/overhang.
 */
export function resolveEntityGround(field, x, z, {
  radius = 0.35, bodyHeight = 0.8, clearance = 0, referenceY = NaN,
  maxSurfaceVariation = 1.1, avoidObstacles = true, hasClearance = null, component = null,
} = {}) {
  if (!field || ![x, z].every(Number.isFinite) || !field.surfaceLayers || !field.layerLabels) return null;
  // Pick the connected layer nearest the requested pose and optional vertical reference.
  let anchor = null;
  const { nx, nz, bounds, cellSize, surfaceLayers, layerLabels, layerCount } = field;
  const ix = Math.floor((x - bounds.minX) / cellSize), iz = Math.floor((z - bounds.minZ) / cellSize);
  let bestAnchorScore = Infinity;
  for (let j = iz - 1; j <= iz + 1; j++) for (let i = ix - 1; i <= ix + 1; i++) {
    if (i < 0 || j < 0 || i >= nx || j >= nz) continue;
    const k = j * nx + i;
    if (!field.walkable[k] || (avoidObstacles && inObstacle(field, i, j))) continue;
    const cx = bounds.minX + (i + 0.5) * cellSize, cz = bounds.minZ + (j + 0.5) * cellSize;
    const d2 = (cx - x) ** 2 + (cz - z) ** 2;
    for (let slot = 0; slot < layerCount; slot++) {
      const node = k * layerCount + slot, y = surfaceLayers[node], layerComponent = layerLabels[node];
      if (!Number.isFinite(y) || layerComponent < 0 || (component != null && layerComponent !== component)) continue;
      const dy = Number.isFinite(referenceY) ? Math.abs(y - referenceY) : 0;
      const score = d2 + dy * dy * 0.08;
      if (score < bestAnchorScore) {
        bestAnchorScore = score;
        anchor = { i, j, k, slot, x: cx, y, z: cz, component: layerComponent };
      }
    }
  }
  if (!anchor) return null;
  const sampleHeights = [];
  const matched = [];
  for (const [dx, dz] of SUPPORT_RING) {
    const sx = x + dx * radius * 0.9, sz = z + dz * radius * 0.9;
    const support = nearestLayer(field, sx, sz, anchor.component, anchor.y, 0.9, avoidObstacles);
    if (!support) return null;
    sampleHeights.push(support.y); matched.push(support);
  }
  const minY = Math.min(...sampleHeights), maxY = Math.max(...sampleHeights);
  if (maxY - minY > maxSurfaceVariation) return null;
  const verticalClearance = Math.max(0, bodyHeight, clearance);
  if (verticalClearance > 0) {
    for (const support of matched) {
      const baseY = support.y;
      for (let slot = 0; slot < field.layerCount; slot++) {
        const y = field.surfaceLayers[support.k * field.layerCount + slot];
        if (Number.isFinite(y) && y > baseY + 0.15 && y < baseY + verticalClearance) return null;
      }
    }
  }
  const centerSupport = matched[0];
  const exactY = sampleLayerHeight(field, x, z, anchor.component, centerSupport.y);
  if (!Number.isFinite(exactY)) return null;
  if (typeof hasClearance === 'function'
    && !hasClearance({ x, z, y: centerSupport.y, radius, height: verticalClearance })) return null;
  return {
    x, y: exactY, z, walkable: true,
    component: anchor.component, surfaceMin: minY, surfaceMax: maxY,
    surfaceVariation: maxY - minY, moved: Math.hypot(anchor.x - x, anchor.z - z),
    validation: { groundDelta: 0, walkable: true, fakeZero: false, component: anchor.component },
  };
}

/** Bound expensive placement scans so a sparse/invalid field cannot monopolize a mobile CPU.
 * The returned stride preserves the caller's requested stride and deterministically
 * increases it only when the rectangular search would exceed the budget.
 */
function boundedSearchStep(minI, maxI, minJ, maxJ, requestedStride = 1, maxCandidates = 4096) {
  const base = Math.max(1, Math.floor(requestedStride));
  const count = Math.ceil(Math.max(0, maxI - minI + 1) / base) * Math.ceil(Math.max(0, maxJ - minJ + 1) / base);
  if (!Number.isFinite(maxCandidates) || maxCandidates <= 0 || count <= maxCandidates) return base;
  return Math.max(base, Math.ceil(Math.sqrt(count / maxCandidates)) * base);
}

/** Deterministic nearest supported placement search; never samples fake-zero fills. */
export function findRobustPlacement(field, {
  x, z, radius = 0.35, bodyHeight = 0.8, clearance = 0, referenceY = NaN,
  maxDistance = 12, maxSurfaceVariation = 1.1, avoidObstacles = true,
  exclude = [], component = null, stride = 1, maxCandidates = 4096, hasClearance = null, scorePlacement = null,
} = {}) {
  if (!field || ![x, z].every(Number.isFinite) || !field.surfaceLayers || !field.layerLabels) return null;
  const { nx, nz, bounds, cellSize, layerCount, surfaceLayers, layerLabels, walkable } = field;
  const maxD2 = Number.isFinite(maxDistance) ? maxDistance * maxDistance : Infinity;
  let best = null, bestScore = Infinity;
  const minI = Number.isFinite(maxDistance) ? Math.max(0, Math.floor((x - maxDistance - bounds.minX) / cellSize)) : 0;
  const maxI = Number.isFinite(maxDistance) ? Math.min(nx - 1, Math.floor((x + maxDistance - bounds.minX) / cellSize)) : nx - 1;
  const minJ = Number.isFinite(maxDistance) ? Math.max(0, Math.floor((z - maxDistance - bounds.minZ) / cellSize)) : 0;
  const maxJ = Number.isFinite(maxDistance) ? Math.min(nz - 1, Math.floor((z + maxDistance - bounds.minZ) / cellSize)) : nz - 1;
  const step = boundedSearchStep(minI, maxI, minJ, maxJ, stride, maxCandidates);
  for (let j = minJ; j <= maxJ; j += step) for (let i = minI; i <= maxI; i += step) {
    const k = j * nx + i;
    if (!walkable[k] || (avoidObstacles && inObstacle(field, i, j))) continue;
    const cx = bounds.minX + (i + 0.5) * cellSize, cz = bounds.minZ + (j + 0.5) * cellSize;
    const d2 = (cx - x) ** 2 + (cz - z) ** 2;
    if (d2 > maxD2) continue;
    if (exclude.some((e) => Math.hypot(cx - e.x, cz - e.z) < radius + (e.radius || 0) + (e.gap || 0))) continue;
    for (let slot = 0; slot < layerCount; slot++) {
      const node = k * layerCount + slot, y = surfaceLayers[node], comp = layerLabels[node];
      if (!Number.isFinite(y) || comp < 0 || (component != null && comp !== component)) continue;
      const dy = Number.isFinite(referenceY) ? Math.abs(y - referenceY) : 0;
      const score = d2 + dy * dy * 0.08;
      if (!scorePlacement && score >= bestScore) continue;
      const point = resolveEntityGround(field, cx, cz, {
        radius, bodyHeight, clearance, referenceY: y, maxSurfaceVariation, avoidObstacles, hasClearance, component: comp,
      });
      if (!point || point.component !== comp) continue;
      const result = { ...point, y: point.y, moved: Math.sqrt(d2), component: comp };
      const rankedScore = typeof scorePlacement === 'function' ? scorePlacement(result) : score;
      if (!Number.isFinite(rankedScore) || rankedScore >= bestScore) continue;
      best = result; bestScore = rankedScore;
    }
  }
  return best;
}

/** Choose a broad, flat site in the largest connected region near map/resources. */
export function chooseCentralBaseSite(field, {
  interestPoints = [], radius = 4.2, clearance = 3.2,
  maxSurfaceVariation = 0.65, centerX, centerZ, stride = 5, hasClearance = null,
  exclude = [], candidateLimit = 64,
} = {}) {
  if (!field?.componentSizes?.length) return null;
  let mainComponent = 0;
  for (let i = 1; i < field.componentSizes.length; i++) {
    if (field.componentSizes[i] > field.componentSizes[mainComponent]) mainComponent = i;
  }
  const cx0 = Number.isFinite(centerX) ? centerX : (field.bounds.minX + field.bounds.maxX) / 2;
  const cz0 = Number.isFinite(centerZ) ? centerZ : (field.bounds.minZ + field.bounds.maxZ) / 2;
  const { nx, nz, bounds, cellSize, layerCount, surfaceLayers, layerLabels, walkable } = field;
  const step = boundedSearchStep(0, nx - 1, 0, nz - 1, stride, 4096);
  const candidates = [];
  for (let j = 0; j < nz; j += step) for (let i = 0; i < nx; i += step) {
    const k = j * nx + i;
    if (!walkable[k] || inObstacle(field, i, j)) continue;
    const x = bounds.minX + (i + 0.5) * cellSize, z = bounds.minZ + (j + 0.5) * cellSize;
    if (exclude.some((e) => Math.hypot(x - e.x, z - e.z) < radius + (e.radius || 0) + (e.gap || 0))) continue;
    let y = NaN;
    for (let slot = 0; slot < layerCount; slot++) {
      const node = k * layerCount + slot;
      if (layerLabels[node] === mainComponent && Number.isFinite(surfaceLayers[node])) { y = surfaceLayers[node]; break; }
    }
    if (!Number.isFinite(y)) continue;
    const heights = [];
    let supported = true;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const support = nearestLayer(field, x + dx * radius * 0.8, z + dz * radius * 0.8,
        mainComponent, y, 0.9, true);
      if (!support) { supported = false; break; }
      heights.push(support.y);
    }
    if (!supported) continue;
    const roughness = Math.max(y, ...heights) - Math.min(y, ...heights);
    if (roughness > maxSurfaceVariation) continue;
    const centerDistance = Math.hypot(x - cx0, z - cz0);
    const resourceDistance = interestPoints.length
      ? interestPoints.reduce((sum, q) => sum + Math.hypot(x - q[0], z - q[1]), 0) / interestPoints.length : 0;
    candidates.push({ x, y, z, i, j, roughness, rank: centerDistance + resourceDistance * 0.11 + roughness * 1.8 });
  }
  candidates.sort((a, b) => a.rank - b.rank || a.j - b.j || a.i - b.i);
  // Only top ranked, preliminarily flat candidates receive expensive exact
  // footprint + scene-ray clearance checks.
  for (const candidate of candidates.slice(0, Math.max(1, candidateLimit))) {
    const site = resolveEntityGround(field, candidate.x, candidate.z, {
      radius, bodyHeight: 0, clearance, maxSurfaceVariation, avoidObstacles: true,
      hasClearance, component: mainComponent, referenceY: candidate.y,
    });
    if (!site) continue;
    const resourceDistance = interestPoints.length
      ? interestPoints.reduce((sum, p) => sum + Math.hypot(site.x - p[0], site.z - p[1]), 0) / interestPoints.length : 0;
    return {
      ...site, component: mainComponent,
      centerDistance: Math.hypot(site.x - cx0, site.z - cz0), resourceDistance,
    };
  }
  return null;
}

/** Cooperative variant for boot/sandbox paths; preserves candidate order while yielding regularly. */
export async function findRobustPlacementCooperative(field, options = {}, { onProgress = null } = {}) {
  if (!field || ![options.x, options.z].every(Number.isFinite) || !field.surfaceLayers || !field.layerLabels) return null;
  const { x, z, radius = 0.35, bodyHeight = 0.8, clearance = 0, referenceY = NaN,
    maxDistance = 12, maxSurfaceVariation = 1.1, avoidObstacles = true,
    exclude = [], component = null, stride = 1, maxCandidates = 4096, hasClearance = null, scorePlacement = null } = options;
  const { nx, nz, bounds, cellSize, layerCount, surfaceLayers, layerLabels, walkable } = field;
  const maxD2 = Number.isFinite(maxDistance) ? maxDistance * maxDistance : Infinity;
  const minI = Number.isFinite(maxDistance) ? Math.max(0, Math.floor((x - maxDistance - bounds.minX) / cellSize)) : 0;
  const maxI = Number.isFinite(maxDistance) ? Math.min(nx - 1, Math.floor((x + maxDistance - bounds.minX) / cellSize)) : nx - 1;
  const minJ = Number.isFinite(maxDistance) ? Math.max(0, Math.floor((z - maxDistance - bounds.minZ) / cellSize)) : 0;
  const maxJ = Number.isFinite(maxDistance) ? Math.min(nz - 1, Math.floor((z + maxDistance - bounds.minZ) / cellSize)) : nz - 1;
  const step = boundedSearchStep(minI, maxI, minJ, maxJ, stride, maxCandidates);
  let best = null, bestScore = Infinity, scanned = 0;
  const totalCandidates = Math.max(1, Math.ceil((maxI - minI + 1) / step) * Math.ceil((maxJ - minJ + 1) / step));
  for (let j = minJ; j <= maxJ; j += step) {
    for (let i = minI; i <= maxI; i += step) {
      const k = j * nx + i; scanned++;
      if (!walkable[k] || (avoidObstacles && inObstacle(field, i, j))) continue;
      const cx = bounds.minX + (i + 0.5) * cellSize, cz = bounds.minZ + (j + 0.5) * cellSize;
      const d2 = (cx - x) ** 2 + (cz - z) ** 2;
      if (d2 > maxD2 || exclude.some((e) => Math.hypot(cx - e.x, cz - e.z) < radius + (e.radius || 0) + (e.gap || 0))) continue;
      for (let slot = 0; slot < layerCount; slot++) {
        const node = k * layerCount + slot, y = surfaceLayers[node], comp = layerLabels[node];
        if (!Number.isFinite(y) || comp < 0 || (component != null && comp !== component)) continue;
        const dy = Number.isFinite(referenceY) ? Math.abs(y - referenceY) : 0;
        const score = d2 + dy * dy * 0.08;
        if (!scorePlacement && score >= bestScore) continue;
        const point = resolveEntityGround(field, cx, cz, { radius, bodyHeight, clearance, referenceY: y, maxSurfaceVariation, avoidObstacles, hasClearance, component: comp });
        if (!point || point.component !== comp) continue;
        const result = { ...point, y: point.y, moved: Math.sqrt(d2), component: comp };
        const rankedScore = typeof scorePlacement === 'function' ? scorePlacement(result) : score;
        if (Number.isFinite(rankedScore) && rankedScore < bestScore) { best = result; bestScore = rankedScore; }
      }
      if ((scanned & 63) === 0) {
        onProgress?.(Math.min(1, scanned / totalCandidates), `寻找安全站位 ${scanned}/${totalCandidates} 个候选`);
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }
  }
  return best;
}

/** Cooperative central-site search for startup and sandbox entry. */
export async function chooseCentralBaseSiteCooperative(field, options = {}, { onProgress = null } = {}) {
  if (!field?.componentSizes?.length) return null;
  let mainComponent = 0;
  for (let i = 1; i < field.componentSizes.length; i++) if (field.componentSizes[i] > field.componentSizes[mainComponent]) mainComponent = i;
  const { interestPoints = [], radius = 4.2, clearance = 3.2, maxSurfaceVariation = 0.65,
    centerX, centerZ, stride = 5, hasClearance = null, exclude = [], candidateLimit = 64, maxCandidates = 2048 } = options;
  const cx0 = Number.isFinite(centerX) ? centerX : (field.bounds.minX + field.bounds.maxX) / 2;
  const cz0 = Number.isFinite(centerZ) ? centerZ : (field.bounds.minZ + field.bounds.maxZ) / 2;
  const { nx, nz, bounds, cellSize, layerCount, surfaceLayers, layerLabels, walkable } = field;
  const step = boundedSearchStep(0, nx - 1, 0, nz - 1, stride, maxCandidates);
  const candidates = [];
  let scanned = 0;
  const totalCandidates = Math.max(1, Math.ceil(nx / step) * Math.ceil(nz / step));
  for (let j = 0; j < nz; j += step) {
    for (let i = 0; i < nx; i += step) {
      scanned++;
      const k = j * nx + i;
      if (walkable[k] && !inObstacle(field, i, j)) {
        const x = bounds.minX + (i + 0.5) * cellSize, z = bounds.minZ + (j + 0.5) * cellSize;
        if (!exclude.some((e) => Math.hypot(x - e.x, z - e.z) < radius + (e.radius || 0) + (e.gap || 0))) {
          let y = NaN;
          for (let slot = 0; slot < layerCount; slot++) { const node = k * layerCount + slot; if (layerLabels[node] === mainComponent && Number.isFinite(surfaceLayers[node])) { y = surfaceLayers[node]; break; } }
          if (Number.isFinite(y)) {
            const heights = [];
            let supported = true;
            for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
              const support = nearestLayer(field, x + dx * radius * 0.8, z + dz * radius * 0.8, mainComponent, y, 0.9, true);
              if (!support) { supported = false; break; }
              heights.push(support.y);
            }
            if (supported && Math.max(y, ...heights) - Math.min(y, ...heights) <= maxSurfaceVariation) {
              const centerDistance = Math.hypot(x - cx0, z - cz0);
              const resourceDistance = interestPoints.length ? interestPoints.reduce((sum, q) => sum + Math.hypot(x - q[0], z - q[1]), 0) / interestPoints.length : 0;
              candidates.push({ x, y, z, i, j, rank: centerDistance + resourceDistance * 0.11 + (Math.max(y, ...heights) - Math.min(y, ...heights)) * 1.8 });
            }
          }
        }
      }
      if ((scanned & 63) === 0) { onProgress?.(Math.min(1, scanned / totalCandidates), `布置洞穴：检查 ${scanned}/${totalCandidates} 个候选`); await new Promise((resolve) => setTimeout(resolve, 0)); }
    }
  }
  candidates.sort((a, b) => a.rank - b.rank || a.j - b.j || a.i - b.i);
  for (const candidate of candidates.slice(0, Math.max(1, candidateLimit))) {
    const site = resolveEntityGround(field, candidate.x, candidate.z, { radius, bodyHeight: 0, clearance, maxSurfaceVariation, avoidObstacles: true, hasClearance, component: mainComponent, referenceY: candidate.y });
    if (site) return { ...site, component: mainComponent, centerDistance: Math.hypot(site.x - cx0, site.z - cz0), resourceDistance: interestPoints.length ? interestPoints.reduce((sum, p) => sum + Math.hypot(site.x - p[0], site.z - p[1]), 0) / interestPoints.length : 0 };
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  return null;
}
