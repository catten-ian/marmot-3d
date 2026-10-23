const test = require('node:test');
const assert = require('node:assert/strict');
const { createObstacleMask, hasWalkablePath, resolveObstacleProxies, shouldUseDesignRocks, selectConnectedObstacleProxies } = require('../src/world/verdant-obstacles.mjs');

test('obstacle mask marks the circle and pushes away from its normal', () => {
  const bounds = { minX: 0, maxX: 4, minZ: 0, maxZ: 4 };
  const proxies = [{ id: 'boulder', x: 2, z: 2, radius: 1.0 }];
  const mask = createObstacleMask({ nx: 4, nz: 4, bounds, proxies });
  assert.ok(mask.some(Boolean));
  const pushed = resolveObstacleProxies({ x: 2, z: 2, proxies, playerRadius: 0.2 });
  assert.ok(pushed.z > 2.6);
  assert.equal(shouldUseDesignRocks(true), false);
});

test('route connectivity check and conservative selection preserve the main path', () => {
  const nx = 9, nz = 3, bounds = { minX: 0, maxX: 9, minZ: 0, maxZ: 3 };
  const walkable = new Uint8Array(nx * nz).fill(1);
  const start = { i: 0, j: 1 }, goal = { i: 8, j: 1 };
  const proxies = [{ x: 4.5, z: 1.5, radius: 0.9 }];
  const mask = createObstacleMask({ nx, nz, bounds, proxies });
  assert.equal(hasWalkablePath({ walkable, obstacles: mask, nx, nz, start, goal }), true);
  const selected = selectConnectedObstacleProxies({ proxies, walkable, nx, nz, bounds, start, minReachableRatio: 0.95 });
  assert.equal(selected.proxies.length, 1);
});
