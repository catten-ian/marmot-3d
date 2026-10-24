import test from 'node:test';
import assert from 'node:assert/strict';
import { BURROWS, BERRY_POINTS, ROCKS, FIELD_W, FIELD_H } from '../src/core/config.js';
import { scaledBurrowsFromConfig, nearestBurrowForPoint, sampleForagePoints, returnTimeSeconds } from './audit-burrow-forage.mjs';

test('洞位按 config 比例映射，最近洞与回洞时间纯函数正确', () => {
  const burrows = scaledBurrowsFromConfig();
  assert.equal(burrows.length, BURROWS.length);
  assert.deepEqual([burrows[0].x, burrows[0].z, burrows[0].r], [BURROWS[0].x, BURROWS[0].z, BURROWS[0].r]);
  assert.deepEqual(nearestBurrowForPoint(-52, 0, burrows), { id: 'base', type: 'base', dCenter: 0, dEdge: 0 });
  assert.deepEqual(returnTimeSeconds(9.6), { bare: 2, sprint: 9.6 / (4.8 * 1.42) });
  console.log('ASSERT burrow-scale/nearest/return-time OK');
});

test('固定与网格采样均在边界内且网格避开岩石心区', () => {
  const points = sampleForagePoints();
  assert.equal(points.filter((p) => p.kind === 'fixed').length, BERRY_POINTS.length);
  for (const p of points) {
    assert.ok(Math.abs(p.x) <= FIELD_W / 2 && Math.abs(p.z) <= FIELD_H / 2);
    if (p.kind === 'grid') for (const [x, z, r] of ROCKS) assert.ok(Math.hypot(p.x - x, p.z - z) >= r + 1);
  }
  console.log(`ASSERT sampling-boundary/rock-clearance OK (${points.length} points)`);
});
