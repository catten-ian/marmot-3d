/* Clean-main touch-drive contract checks (pure Node; no browser). */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

let checks = 0;
function ok(condition, message) { assert.ok(condition, message); checks += 1; }
function eq(actual, expected, message) { assert.equal(actual, expected, message); checks += 1; }
function approx(actual, expected, epsilon, message) {
  assert.ok(Math.abs(actual - expected) < epsilon, `${message}: |${actual} - ${expected}| >= ${epsilon}`);
  checks += 1;
}

(async () => {
  const { resolveTouchDrive } = await import('../src/core/move-facing.mjs');
  const base = { bodyYaw: 0, cameraYaw: 0, dt: 1 / 60, turnRate: 2.7 };

  const right = resolveTouchDrive({ ...base, x: 1, y: 0, thirdPerson: true });
  approx(right.bodyYaw, -2.7 / 60, 1e-12, 'third-person pure right turns incrementally');
  eq(right.throttle, 0, 'third-person pure right has no throttle');
  eq(right.direction, 0, 'third-person pure right has no movement direction');
  eq(right.cameraYaw, 0, 'third-person wheel does not change camera yaw');
  ok(!('uTurn' in right), 'new contract has no hidden U-turn state');

  const forward = resolveTouchDrive({ ...base, x: 0, y: 0.6, thirdPerson: true });
  eq(forward.throttle, 0.6, 'forward throttle comes from y');
  eq(forward.direction, 1, 'positive y is forward');
  approx(forward.bodyYaw, 0, 1e-12, 'forward-only input leaves body yaw unchanged');

  const diagonal = resolveTouchDrive({ ...base, x: 1, y: 0.6, thirdPerson: true });
  eq(diagonal.throttle, forward.throttle, 'x cannot increase forward throttle');
  approx(diagonal.bodyYaw, -2.7 / 60, 1e-12, 'forward diagonal adds steering only');

  const back = resolveTouchDrive({ ...base, x: -1, y: -0.8, thirdPerson: true });
  eq(back.throttle, 0.8, 'backward throttle comes from absolute y');
  eq(back.direction, -1, 'negative y is backward');
  eq(back.isBackpedal, true, 'negative y marks backpedal');
  approx(back.bodyYaw, -2.7 / 60, 1e-12, 'back-left reverses steering sign');

  for (const cameraYaw of [0, 1.2345, -2.7, Math.PI, -Math.PI / 2]) {
    const result = resolveTouchDrive({ ...base, bodyYaw: 0.33, cameraYaw, x: -0.6, y: 0.9 });
    eq(result.cameraYaw, cameraYaw, `camera yaw ${cameraYaw} passes through unchanged`);
  }

  const controls = fs.readFileSync(path.join(__dirname, '..', 'src', 'core', 'controls.js'), 'utf8');
  ok(controls.includes("resolveTouchDrive"), 'controls uses the shared touch-drive helper');
  ok(!controls.includes('mx += this.touchAxes.x') && !controls.includes('mz += this.touchAxes.y'),
    'controls does not treat touch x/y as ordinary WASD strafe axes');
  ok(controls.includes('cameraYaw: this.yaw'), 'touch drive receives camera yaw as independent state');
  const touchBlock = controls.slice(controls.indexOf('if (touchActive)'));
  ok(touchBlock.includes('this.bodyYaw = drive.bodyYaw'), 'touch drive updates body yaw');
  ok(touchBlock.includes('this.thirdPerson'), 'third-person camera path is kept separate');

  const touchControls = fs.readFileSync(path.join(__dirname, '..', 'src', 'core', 'touch-controls.js'), 'utf8');
  ok(touchControls.includes('this.controller.yaw -= dx'), 'right-hand look zone still owns camera yaw updates');

  console.log(`OK ${checks}/${checks}`);
})().catch((error) => { console.error(error); process.exitCode = 1; });
