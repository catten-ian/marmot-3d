const test = require('node:test');
const assert = require('node:assert/strict');
const {
  findGroundPathBlock,
  findSegmentLanding,
  shouldRescueVerdantPosition,
  findNearestWalkableCell,
} = require('../src/world/verdant-fall-safety.mjs');

test('swept descent catches a thin walkable patch missed at the endpoint', () => {
  const groundAt = (x) => (x >= 5.95 && x <= 6.05
    ? { y: 4, walkable: true }
    : { y: 0, walkable: false });
  // An endpoint-only query sees no ground and would leave the player below the patch.
  assert.equal(groundAt(10).walkable, false);
  const hit = findSegmentLanding({
    from: { x: 0, y: 10, z: 0 }, to: { x: 10, y: 0, z: 0 }, groundAt, maxStep: 0.1,
  });
  assert.ok(hit, 'the swept path must hit the thin platform');
  assert.ok(hit.x >= 5.95 && hit.x <= 6.05);
  assert.equal(hit.y, 4);
  assert.ok(hit.t > 0 && hit.t < 1);
});

test('grounded high-dt sweep blocks a narrow void but keeps walkable descent', () => {
  const groundAt = (x) => {
    if (x > 4.9 && x < 5.1) return { y: 0, walkable: false };
    return { y: x > 6 ? -1 : 0, walkable: true };
  };
  const blocked = findGroundPathBlock({
    from: { x: 0, z: 0 }, to: { x: 10, z: 0 }, groundAt, maxStep: 0.1,
  });
  assert.equal(blocked.reason, 'void');
  assert.ok(blocked.t > 0 && blocked.t < 1);
  const downhill = findGroundPathBlock({
    from: { x: 6, z: 0 }, to: { x: 10, z: 0 }, groundAt, maxStep: 0.1,
  });
  assert.equal(downhill, null, 'ordinary downhill terrain remains traversable');
});

test('safety thresholds preserve normal range and rescue kill-plane, non-finite, and outside void poses', () => {
  const bounds = { minX: -5, maxX: 5, minZ: -5, maxZ: 5 };
  const common = { bounds, minWalkableY: -2, killPlane: -14 };
  assert.equal(shouldRescueVerdantPosition({ ...common, position: { x: 0, y: -10, z: 0 }, ground: { y: -2, walkable: true } }).rescue, false);
  assert.equal(shouldRescueVerdantPosition({ ...common, position: { x: 0, y: -14.1, z: 0 }, ground: { y: -2, walkable: true } }).reason, 'kill-plane');
  assert.equal(shouldRescueVerdantPosition({ ...common, position: { x: NaN, y: 0, z: 0 }, ground: null }).reason, 'non-finite');
  assert.equal(shouldRescueVerdantPosition({ ...common, position: { x: 6, y: -5, z: 0 }, ground: { y: 0, walkable: false } }).reason, 'outside-without-ground');
  assert.equal(shouldRescueVerdantPosition({ ...common, position: { x: 6, y: -1, z: 0 }, ground: { y: 0, walkable: false } }).rescue, false);
});

test('nearest walkable resolves an invalid column and rejects an empty mask', () => {
  const args = {
    x: 1.2, z: 0.2, nx: 5, nz: 3, cellSize: 1,
    bounds: { minX: 0, maxX: 5, minZ: 0, maxZ: 3 },
    walkable: Uint8Array.from([1, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0]),
    top: Float32Array.from([2, NaN, NaN, NaN, NaN, NaN, NaN, 7, NaN, NaN, NaN, NaN, NaN, NaN, NaN]),
  };
  const nearest = findNearestWalkableCell(args);
  assert.deepEqual(nearest, { x: 0.5, y: 2, z: 0.5, moved: Math.hypot(0.7, 0.3) });
  assert.equal(findNearestWalkableCell({ ...args, walkable: new Uint8Array(15) }), null);
});
