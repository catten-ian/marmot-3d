const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
(async () => {
  const {
    resolveMarmotRollDirection, resolveRollMovementInput,
    ROLL_JOYSTICK_DEAD_ZONE,
  } = await import('../src/core/combat-wheel.mjs');
  const { resolveMoveIntent, resolveKeyboardDrive } = await import('../src/core/move-facing.mjs');
  const { resolveControlMaps } = await import('../src/core/keybinds.js');
  const close = (actual, expected, label, epsilon = 1e-9) => {
    assert.ok(Math.abs(actual.x - expected.x) < epsilon, `${label}: x ${actual.x} != ${expected.x}`);
    assert.ok(Math.abs(actual.z - expected.z) < epsilon, `${label}: z ${actual.z} != ${expected.z}`);
    assert.ok(Math.abs(Math.hypot(actual.x, actual.z) - 1) < epsilon, `${label}: not normalized`);
  };
  const from = (input = {}) => resolveMarmotRollDirection(input);
  const inputAt = (movement, cameraYaw) => from({ movement, cameraYaw, velX: -9, velZ: 2, bodyYaw: 2.1 });
  const rightAt = (yaw) => ({ x: Math.cos(yaw), z: -Math.sin(yaw) });
  const forwardAt = (yaw) => ({ x: -Math.sin(yaw), z: -Math.cos(yaw) });
  const leftAt = (yaw) => ({ x: -Math.cos(yaw), z: Math.sin(yaw) });
  const backAt = (yaw) => ({ x: Math.sin(yaw), z: Math.cos(yaw) });
  const normalized = (a, b) => { const h = Math.hypot(a, b); return { x: a / h, z: b / h }; };
  const yaws = [0, Math.PI / 6, -Math.PI / 2, 2.2];

  // No-input keyboard/mouse roll always points screen-right, independent of
  // residual travel velocity and body facing, across camera orientations.
  for (const yaw of yaws) {
    const d = from({ cameraYaw: yaw, velX: -9, velZ: 2, bodyYaw: 2.1 });
    assert.equal(d.source, 'default-right');
    close(d, rightAt(yaw), `default right yaw=${yaw}`);
  }

  // Individual keys and diagonal intent resolve in camera-relative axes.
  for (const yaw of yaws) {
    for (const [key, dir] of [
      ['W', forwardAt(yaw)], ['S', backAt(yaw)], ['A', leftAt(yaw)], ['D', rightAt(yaw)],
    ]) {
      const movement = { forward: key === 'W', back: key === 'S', left: key === 'A', right: key === 'D' };
      const d = inputAt(movement, yaw);
      assert.equal(d.source, 'movement', `${key} source`);
      close(d, dir, `${key} yaw=${yaw}`);
    }
    close(inputAt({ forward: true, left: true }, yaw), normalized(leftAt(yaw).x + forwardAt(yaw).x, leftAt(yaw).z + forwardAt(yaw).z), `AW yaw=${yaw}`);
    close(inputAt({ back: true, right: true }, yaw), normalized(rightAt(yaw).x + backAt(yaw).x, rightAt(yaw).z + backAt(yaw).z), `SD yaw=${yaw}`);
    for (const movement of [
      { forward: true, back: true }, { left: true, right: true },
      { forward: true, back: true, left: true, right: true },
    ]) close(inputAt(movement, yaw), rightAt(yaw), `opposing keys cancel yaw=${yaw}`);
  }

  // Actual scheme-key reading includes custom action bindings, standard WASD,
  // resolved movement aliases (arrows), and driving turn-map A/D.
  const keys = new Set(['KeyW', 'ArrowLeft', 'KeyI', 'KeyL', 'KeyJ']);
  const mapped = resolveRollMovementInput({
    keys,
    movementKeys: { forward: ['KeyI'], back: [], left: ['KeyJ'], right: ['KeyL'] },
    moveMap: { forward: 'KeyW', forwardAlt: 'ArrowUp', left: null, leftAlt: 'ArrowLeft' },
    turnMap: { left: 'KeyJ', right: 'KeyL' },
  });
  assert.deepEqual(mapped, { forward: true, back: false, left: true, right: true });
  assert.deepEqual(resolveRollMovementInput({ keys: new Set(['ArrowUp', 'ArrowDown']), moveMap: { forward: null, forwardAlt: 'ArrowUp', back: null, backAlt: 'ArrowDown' } }),
    { forward: true, back: true, left: false, right: false });
  const customMaps = resolveControlMaps({ version: 'beta', scheme: 'custom', controlMode: 'classic', bindings: {
    forward: 'KeyI', back: 'KeyK', left: 'KeyJ', right: 'KeyL',
  } });
  assert.deepEqual(resolveRollMovementInput({
    keys: new Set(['KeyI', 'KeyL']),
    movementKeys: { forward: ['KeyI'], back: ['KeyK'], left: ['KeyJ'], right: ['KeyL'] },
    moveMap: customMaps.moveMap, turnMap: customMaps.turnMap,
  }), { forward: true, back: false, left: false, right: true }, 'configured custom movement keys');
  const drivingMaps = resolveControlMaps({ version: 'beta', scheme: 'optimized', controlMode: 'driving', bindings: {
    forward: 'KeyW', back: 'KeyS', left: 'KeyA', right: 'KeyD', turnLeft: 'KeyA', turnRight: 'KeyD',
  } });
  assert.deepEqual(resolveRollMovementInput({ keys: new Set(['KeyA', 'KeyW']),
    movementKeys: { forward: ['KeyW'], back: ['KeyS'], left: [], right: [] },
    moveMap: drivingMaps.moveMap, turnMap: drivingMaps.turnMap,
  }), { forward: true, back: false, left: true, right: false }, 'driving A turns map to roll-left intent');

  // Joystick convention is the production touchAxes convention (x right+, y up+).
  assert.equal(ROLL_JOYSTICK_DEAD_ZONE, 0.18);
  for (const yaw of yaws) {
    const j = from({ joystick: { x: 0.6, y: 0.8 }, movement: { left: true }, cameraYaw: yaw });
    assert.equal(j.source, 'joystick', 'stick outranks held keys');
    close(j, normalized(rightAt(yaw).x * 0.6 + forwardAt(yaw).x * 0.8,
      rightAt(yaw).z * 0.6 + forwardAt(yaw).z * 0.8), `joystick yaw=${yaw}`);
    const dz = from({ joystick: { x: ROLL_JOYSTICK_DEAD_ZONE, y: 0 }, cameraYaw: yaw, velX: 0, velZ: 0, bodyYaw: 0 });
    assert.equal(dz.source, 'default-right', 'exact dead-zone boundary is inactive');
    close(dz, rightAt(yaw), `joystick dead zone yaw=${yaw}`);
    const outside = from({ joystick: { x: ROLL_JOYSTICK_DEAD_ZONE + 0.001, y: 0 }, cameraYaw: yaw });
    assert.equal(outside.source, 'joystick');
    close(outside, rightAt(yaw), `joystick beyond dead zone yaw=${yaw}`);
  }

  // Independent drag overrides stick and keys; up-drag is screen-forward.
  for (const yaw of yaws) {
    const drag = from({ gesture: { moved: true, dx: -40, dy: -30 }, joystick: { x: 1, y: 0 },
      movement: { right: true }, cameraYaw: yaw });
    assert.equal(drag.source, 'drag');
    close(drag, normalized(leftAt(yaw).x + forwardAt(yaw).x * 0.75, leftAt(yaw).z + forwardAt(yaw).z * 0.75), `drag priority yaw=${yaw}`);
  }

  // Direction is a start-time snapshot: later input mutation cannot retarget it.
  const live = { cameraYaw: 0.7, movement: { forward: true } };
  const latched = from(live);
  const snapshot = { x: latched.x, z: latched.z };
  live.cameraYaw = -2.4; live.movement.forward = false; live.movement.left = true;
  assert.deepEqual({ x: latched.x, z: latched.z }, snapshot);
  close(latched, forwardAt(0.7), 'latched direction');

  // Touch-origin with no usable drag/stick/key input retains legacy velocity,
  // then body-facing fallback; keyboard/mouse with identical state stays right.
  for (const yaw of yaws) {
    const touchMoving = from({ touchOrigin: true, cameraYaw: yaw, velX: 3, velZ: 4, bodyYaw: 1.2 });
    assert.equal(touchMoving.source, 'touch-fallback');
    close(touchMoving, { x: 0.6, z: 0.8 }, `touch velocity yaw=${yaw}`);
    const touchStill = from({ touchOrigin: true, cameraYaw: yaw, bodyYaw: 0 });
    close(touchStill, { x: 0, z: -1 }, `touch body yaw=${yaw}`);
    close(from({ cameraYaw: yaw, velX: 3, velZ: 4, bodyYaw: 1.2 }), rightAt(yaw), `keyboard ignores residual motion yaw=${yaw}`);
  }

  // Production wiring: direct rolls and combat-wheel dodge both enter the same
  // synchronous resolver; only touch-control entrypoints request touch fallback.
  const main = fs.readFileSync(path.join(__dirname, '../src/main.js'), 'utf8');
  const touchControls = fs.readFileSync(path.join(__dirname, '../src/core/touch-controls.js'), 'utf8');
  assert.match(touchControls, /this\.controller\.touchAxes = this\.move/);
  assert.match(touchControls, /let x = dx \/ this\.maxStick;\s*let y = -dy \/ this\.maxStick/,
    'screen-down joystick movement is represented as negative camera-up axis');
  assert.match(touchControls, /if \(magnitude < 0\.14\) \{\s*x = 0;\s*y = 0;/,
    'production joystick zeroes its own 0.14 dead zone before roll resolution');
  assert.match(main, /function resolveCurrentRollDirection\(gesture = null, touchOrigin = false\)[\s\S]*?resolveMarmotRollDirection\(/);
  assert.match(main, /if \(move === 'dodge'\) \{\s*const dir = resolveCurrentRollDirection\(\);/);
  assert.match(main, /const resolvedDir = resolveCurrentRollDirection\(gesture, touchOrigin\);[\s\S]*?controller\.roll\(dir, rollSpeed\);/);
  assert.match(main, /doRoll\(\{ moved: true, dx: ctx\.dx, dy: ctx\.dy \}, true\)/);
  assert.match(main, /action === 'dodge'\) doRoll\(gesture, true\)/);

  // Ordinary movement path remains byte-for-byte based on the existing resolver:
  // its diagonal normalization and backpedal speed contract are not modified.
  const drive = resolveKeyboardDrive(new Set(['KeyW', 'KeyD']),
    { forward: 'KeyW', right: 'KeyD' }, null, 0.4, 2.2, 1 / 60);
  assert.equal(Math.hypot(drive.mx, drive.mz), Math.SQRT2);
  const move = resolveMoveIntent(drive.mx, drive.mz, drive.yaw, 0.58);
  assert.ok(Math.abs(Math.hypot(move.moveX, move.moveZ) - 1) < 1e-9);
  const back = resolveMoveIntent(0, -1, 0.4, 0.58);
  assert.equal(back.speedScale, 0.58);
  assert.equal(back.isBackpedal, true);

  console.log('marmot roll direction: all production-path assertions passed');
})().catch((err) => { console.error(err); process.exit(1); });
