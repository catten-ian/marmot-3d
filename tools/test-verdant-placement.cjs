const test = require('node:test');
const assert = require('node:assert/strict');
test('connected-layer placement rejects unsupported upper layers and chooses central base', async () => {
  const { buildSurfaceComponents, resolveEntityGround, chooseCentralBaseSite } = await import('../src/world/verdant-placement.mjs');
  const nx = 8, nz = 6, layerCount = 4, cellSize = 1;
  const bounds = { minX: 0, maxX: nx, minZ: 0, maxZ: nz };
  const walkable = new Uint8Array(nx * nz).fill(1);
  const surfaceLayers = new Float32Array(nx * nz * layerCount).fill(NaN);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const k = j * nx + i; surfaceLayers[k * layerCount] = 2;
    if (i >= 2 && i <= 4 && j === 2) surfaceLayers[k * layerCount + 1] = 7;
  }
  const components = buildSurfaceComponents({ surfaceLayers, walkable, nx, nz, cellSize, layerCount });
  const field = { nx, nz, cellSize, bounds, walkable, surfaceLayers, layerCount, layerLabels: components.labels, componentSizes: components.sizes, obstacleMask: new Uint8Array(nx * nz), heightAt: () => 2 };
  const grounded = resolveEntityGround(field, 5.5, 4.5, { radius: .3, bodyHeight: .8 });
  assert.ok(grounded && grounded.y === 2);
  const upper = resolveEntityGround(field, 2.5, 2.5, { radius: .3, bodyHeight: .8, referenceY: 7 });
  assert.ok(upper && upper.y === 7, 'reference height selects the connected upper layer');
  const base = chooseCentralBaseSite(field, { centerX: 4, centerZ: 3, radius: .4, clearance: 1, stride: 1 });
  assert.ok(base && base.component >= 0 && base.centerDistance < 2.1);
});

test('placement rejects fake-zero cells, obstacle proxies and low clearance', async () => {
  const { buildSurfaceComponents, resolveEntityGround, findRobustPlacement } = await import('../src/world/verdant-placement.mjs');
  const nx = 5, nz = 5, layerCount = 4, cellSize = 1;
  const bounds = { minX: 0, maxX: 5, minZ: 0, maxZ: 5 };
  const walkable = new Uint8Array(nx * nz).fill(1);
  const layers = new Float32Array(nx * nz * layerCount).fill(NaN);
  for (let k = 0; k < nx * nz; k++) layers[k * layerCount] = 3;
  layers[2 * layerCount] = 0; // fake-zero column must never be selected as a support layer
  const comps = buildSurfaceComponents({ surfaceLayers: layers, walkable, nx, nz, cellSize, layerCount });
  const field = { nx, nz, bounds, cellSize, walkable, surfaceLayers: layers, layerCount,
    layerLabels: comps.labels, componentSizes: comps.sizes, obstacleMask: new Uint8Array(nx * nz) };
  field.obstacleMask[2 * nx + 2] = 1;
  assert.equal(resolveEntityGround(field, 2.5, 2.5, { radius: .3, bodyHeight: .8 }), null);
  const placed = findRobustPlacement(field, { x: 2.5, z: 2.5, radius: .3, bodyHeight: .8, maxDistance: 4 });
  assert.ok(placed && placed.y === 3 && placed.validation.fakeZero === false);
  field.hasPlacementClearance = () => false;
  assert.equal(resolveEntityGround(field, 1.5, 1.5, { radius: .3, bodyHeight: .8, hasClearance: field.hasPlacementClearance }), null);
});
