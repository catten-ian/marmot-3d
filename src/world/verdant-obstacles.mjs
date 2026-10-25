/** Pure helpers for conservative, dev-only imported-rock collision proxies. */
function proxyCells({ proxy, nx, nz, bounds, padding = 0 }) {
  const cells = [];
  if (![proxy?.x, proxy?.z, proxy?.radius].every(Number.isFinite) || proxy.radius < 0) return cells;
  const dx = (bounds.maxX - bounds.minX) / nx;
  const dz = (bounds.maxZ - bounds.minZ) / nz;
  const r = proxy.radius + Math.max(0, padding);
  const i0 = Math.max(0, Math.floor((proxy.x - r - bounds.minX) / dx));
  const i1 = Math.min(nx - 1, Math.floor((proxy.x + r - bounds.minX) / dx));
  const j0 = Math.max(0, Math.floor((proxy.z - r - bounds.minZ) / dz));
  const j1 = Math.min(nz - 1, Math.floor((proxy.z + r - bounds.minZ) / dz));
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const x = bounds.minX + (i + 0.5) * dx;
    const z = bounds.minZ + (j + 0.5) * dz;
    if (Math.hypot(x - proxy.x, z - proxy.z) <= r) cells.push(j * nx + i);
  }
  return cells;
}

export function createObstacleMask({ nx, nz, bounds, proxies = [], padding = 0 }) {
  if (!Number.isInteger(nx) || !Number.isInteger(nz) || nx <= 0 || nz <= 0 || !bounds) return new Uint8Array();
  const mask = new Uint8Array(nx * nz);
  for (const proxy of proxies) for (const k of proxyCells({ proxy, nx, nz, bounds, padding })) mask[k] = 1;
  return mask;
}

function reachableCount({ walkable, obstacles, nx, nz, start }) {
  if (!walkable || !Number.isInteger(nx) || !Number.isInteger(nz) || !start) return 0;
  const from = start.j * nx + start.i;
  const usable = (k) => k >= 0 && k < nx * nz && walkable[k] === 1 && (!obstacles || obstacles[k] !== 1);
  if (!usable(from)) return 0;
  const seen = new Uint8Array(nx * nz), queue = new Int32Array(nx * nz);
  let head = 0, tail = 0;
  seen[from] = 1; queue[tail++] = from;
  while (head < tail) {
    const k = queue[head++];
    const i = k % nx, j = Math.floor(k / nx);
    const neighbors = [i ? k - 1 : -1, i + 1 < nx ? k + 1 : -1, j ? k - nx : -1, j + 1 < nz ? k + nx : -1];
    for (const n of neighbors) if (usable(n) && !seen[n]) { seen[n] = 1; queue[tail++] = n; }
  }
  return tail;
}

/** Greedy route-preserving filter; reject a proxy if it seals too much of the walkable component. */
export function selectConnectedObstacleProxies({ proxies = [], walkable, nx, nz, bounds, start, minReachableRatio = 0.995 }) {
  if (!proxies.length || !walkable || !start) return { proxies: [], mask: new Uint8Array(nx * nz), rejected: proxies.length, baselineReachable: 0, reachable: 0 };
  const baselineReachable = reachableCount({ walkable, nx, nz, start });
  if (!baselineReachable) return { proxies: [], mask: new Uint8Array(nx * nz), rejected: proxies.length, baselineReachable: 0, reachable: 0 };
  const accepted = [];
  let mask = new Uint8Array(nx * nz);
  for (const proxy of proxies) {
    const trial = createObstacleMask({ nx, nz, bounds, proxies: [...accepted, proxy] });
    const reachable = reachableCount({ walkable, obstacles: trial, nx, nz, start });
    if (reachable / baselineReachable >= minReachableRatio) { accepted.push(proxy); mask = trial; }
  }
  return { proxies: accepted, mask, rejected: proxies.length - accepted.length, baselineReachable, reachable: reachableCount({ walkable, obstacles: mask, nx, nz, start }) };
}

/** Four-neighbour reachability check over walkable cells after optional obstacles. */
export function hasWalkablePath({ walkable, obstacles, nx, nz, start, goal }) {
  if (!walkable || !Number.isInteger(nx) || !Number.isInteger(nz) || !start || !goal) return false;
  const reachable = reachableCount({ walkable, obstacles, nx, nz, start });
  const target = goal.j * nx + goal.i;
  // A small isolated target may be reached without knowing the full search tree;
  // rerun from start with an early-exit BFS for deterministic exactness.
  if (reachable === 0 || target < 0 || target >= nx * nz) return false;
  const usable = (k) => k >= 0 && k < nx * nz && walkable[k] === 1 && (!obstacles || obstacles[k] !== 1);
  const seen = new Uint8Array(nx * nz), queue = new Int32Array(nx * nz);
  let head = 0, tail = 0; const from = start.j * nx + start.i;
  if (!usable(from) || !usable(target)) return false;
  seen[from] = 1; queue[tail++] = from;
  while (head < tail) {
    const k = queue[head++]; if (k === target) return true;
    const i = k % nx, j = Math.floor(k / nx);
    const neighbors = [i ? k - 1 : -1, i + 1 < nx ? k + 1 : -1, j ? k - nx : -1, j + 1 < nz ? k + nx : -1];
    for (const n of neighbors) if (usable(n) && !seen[n]) { seen[n] = 1; queue[tail++] = n; }
  }
  return false;
}

/** Push an XZ point out of overlapping circles; deterministic at a proxy center. */
export function resolveObstacleProxies({ x, z, proxies = [], playerRadius = 0.18, feetY = 0, bodyHeight = 0.46 }) {
  let px = x, pz = z;
  const collisions = [];
  for (let pass = 0; pass < 2; pass++) {
    let changed = false;
    for (const proxy of proxies) {
      if (![proxy?.x, proxy?.z, proxy?.radius].every(Number.isFinite)) continue;
      if (Number.isFinite(proxy.minY) && Number.isFinite(proxy.maxY)
        && !(feetY < proxy.maxY - 0.04 && feetY + bodyHeight > proxy.minY + 0.02)) continue;
      const dx = px - proxy.x, dz = pz - proxy.z;
      const distance = Math.hypot(dx, dz), limit = Math.max(0, proxy.radius) + Math.max(0, playerRadius);
      if (distance >= limit) continue;
      const nx = distance > 1e-7 ? dx / distance : 0;
      const nz = distance > 1e-7 ? dz / distance : 1;
      px = proxy.x + nx * limit;
      pz = proxy.z + nz * limit;
      collisions.push({ proxy: proxy.id || '', nx, nz });
      changed = true;
    }
    if (!changed) break;
  }
  return { x: px, z: pz, collisions };
}

/** Existing design circles are intentionally bypassed whenever a scene owns collision. */
export function shouldUseDesignRocks(solidColliderActive) {
  return !solidColliderActive;
}
