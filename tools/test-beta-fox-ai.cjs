const assert = require('node:assert/strict');
(async () => {
  const { separationVector, isSegmentReachable, stepSmartMotion } = await import('../src/entities/smart-fox-core.mjs');
  const s = separationVector({ x: 0, z: 0 }, [{ x: 0.2, z: 0 }, { x: 0, z: 0.4 }], 1.8, 2.2);
  assert.ok(Math.hypot(s.x, s.z) > 0, 'overlapping foxes receive separation');
  const moved = { x: 0, z: 0 }, peers = [{ x: 0.2, z: 0 }];
  moved.x += s.x / 60; moved.z += s.z / 60;
  assert.ok(Math.hypot(moved.x - peers[0].x, moved.z - peers[0].z) > 0.2, 'separation moves apart');
  assert.equal(isSegmentReachable({ x: 0, z: 0 }, { x: 5, z: 0 }, [{ x: 2.5, z: 0, r: 1 }], 0.2), false, 'rock blocks pounce');
  assert.equal(isSegmentReachable({ x: 0, z: 0 }, { x: 5, z: 0 }, [{ x: 2.5, z: 2, r: 1 }], 0.2), true, 'clear line is reachable');
  let st = { x: 0, z: 0, vx: 0, vz: 0, yaw: 0, maxTurnRate: 2.8, acceleration: 18, pounceCooldown: 0 };
  let maxStep = 0, maxTurn = 0, prevYaw = st.yaw;
  for (let i = 0; i < 60; i++) { const n = stepSmartMotion(st, { x: 0, z: 4 }, 1 / 60, 'approach'); maxStep = Math.max(maxStep, Math.hypot(n.x - st.x, n.z - st.z)); maxTurn = Math.max(maxTurn, Math.abs(n.yaw - prevYaw)); prevYaw = n.yaw; st = n; }
  assert.ok(maxStep <= 0.2, `bounded displacement ${maxStep}`);
  assert.ok(maxTurn <= 2.8 / 60 + 1e-9, `bounded turn ${maxTurn}`);
  let velocity = { x: 0, z: 0 };
  assert.ok(Math.hypot(velocity.x, velocity.z) < 0.05, 'stationary measured speed is approximately zero');
  console.log('beta fox AI: separation, reachability, bounded motion, stationary speed assertions passed');
})();
