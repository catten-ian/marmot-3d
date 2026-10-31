const assert = require('node:assert/strict');
(async () => {
  const { worldToMap, worldYawToMapAngle } = await import('../src/ui/minimap.js');
  assert.deepEqual(worldToMap(2, 3, 0, 0), { x: 2, y: 3 });
  const dir = (yaw) => { const a = worldYawToMapAngle(yaw); return { x: Math.sin(a), y: -Math.cos(a) }; };
  const close = (a, b) => Math.abs(a - b) < 1e-9;
  assert(close(dir(0).x, 0) && dir(0).y < 0, 'yaw 0 / -Z points up');
  assert(dir(Math.PI).y > 0, 'yaw PI / +Z points down');
  assert(dir(-Math.PI / 2).x > 0, 'yaw -PI/2 / +X points right');
  assert(dir(Math.PI / 2).x < 0, 'yaw PI/2 / -X points left');
  console.log('minimap projection regression ok');
})();
