const assert = require('node:assert/strict');
(async () => {
  const { worldToMap, worldYawToMapAngle, shouldObserveMinimap } = await import('../src/ui/minimap.js');
  assert.deepEqual(worldToMap(2, 3, 0, 0), { x: 2, y: 3 });
  const dir = (yaw) => { const a = worldYawToMapAngle(yaw); return { x: Math.sin(a), y: -Math.cos(a) }; };
  const close = (a, b) => Math.abs(a - b) < 1e-9;
  assert(close(dir(0).x, 0) && dir(0).y < 0, 'yaw 0 / -Z points up');
  assert(dir(Math.PI).y > 0, 'yaw PI / +Z points down');
  assert(dir(-Math.PI / 2).x > 0, 'yaw -PI/2 / +X points right');
  assert(dir(Math.PI / 2).x < 0, 'yaw PI/2 / -X points left');

  const base = { moving: false, inBurrow: false, postureSpeed: 0 };
  const postures = [0, 0.04, 0.2, 0.65, 1, 0.65, 0.2, 0];
  for (const crouch of postures) {
    assert.equal(shouldObserveMinimap({ ...base, beta: true, crouch }), true,
      `beta minimap remains visible at stationary crouch=${crouch}`);
  }
  assert.equal(shouldObserveMinimap({ ...base, beta: true, crouch: 0.5, moving: true }), false,
    'beta movement still hides the observation map');
  assert.equal(shouldObserveMinimap({ ...base, beta: true, crouch: 0.5, inBurrow: true }), false,
    'beta burrow still hides the observation map');
  assert.equal(shouldObserveMinimap({ ...base, beta: false, crouch: 0 }), true,
    'stable settled standing behavior is unchanged');
  assert.equal(shouldObserveMinimap({ ...base, beta: false, crouch: 0.2 }), false,
    'stable posture transition behavior is unchanged');
  console.log('minimap projection and beta posture-visibility regressions ok');
})();
