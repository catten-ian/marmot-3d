import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGrazeGrid, queryGrazeRadius, createGrassGrowth, grassDensity } from '../src/core/graze-grid.mjs';
import { BETA_TUNE } from '../src/core/beta-tuning.js';

test('grid queries radius boundaries and filters', () => {
  const grid = buildGrazeGrid([{ index: 0, x: 0, z: 0 }, { index: 1, x: 1.9, z: 0 }, { index: 2, x: 2, z: 2 }, { index: 3, x: 5, z: 0 }], 2);
  assert.deepEqual(queryGrazeRadius(grid, 0, 0, 2).sort((a,b)=>a-b), [0,1]);
  assert.deepEqual(queryGrazeRadius(grid, 2, 2, 0), [2]);
  assert.deepEqual(queryGrazeRadius(grid, 0, 0, 10, (i) => i % 2 === 0).sort((a,b)=>a-b), [0,2]);
  assert.deepEqual(queryGrazeRadius(buildGrazeGrid([]), 0, 0, 2), []);
});

test('growth tracks damage and regrowth with clamping', () => {
  const g = createGrassGrowth(3); assert.equal(g.get(0), 1); g.set(1, 0); assert.deepEqual(g.damaged(), [1]); assert.equal(g.damagedCount(), 1); assert.equal(g.grow(1, .1), .1); g.grow(1, 99); assert.equal(g.get(1), 1); g.set(1, -5); assert.equal(g.get(1), 0); g.set(1, 99); assert.equal(g.get(1), 1); g.set(2, 0); g.reset(); assert.equal(g.damagedCount(), 0);
});

test('density reflects intact grass', () => {
  const points = [0,1,2,3].map((index) => ({ index, x: index, z: 0 })); const grid = buildGrazeGrid(points, 2); const g = createGrassGrowth(4);
  assert.equal(grassDensity(grid, g, 1.5, 0, 3, 4), 1); for (let i=0;i<4;i++) g.set(i, 0); assert.equal(grassDensity(grid,g,1.5,0,3,4),0); g.set(0,1); g.set(1,1); assert.equal(grassDensity(grid,g,1.5,0,3,4),.5); assert.equal(grassDensity(grid,g,1.5,0,3,0),0);
});

test('beta forage contracts remain fixed', () => { assert.equal(BETA_TUNE.grassSeconds, 0.6); assert.equal(BETA_TUNE.grazeRegenPerSec, 8.0); });
