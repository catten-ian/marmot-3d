// Node fixed-step integration of the production controller, with real Three.js math.
// Import URLs replace the browser import map only; no controller method is stubbed.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { test } = require('node:test');
const root = path.resolve(__dirname, '..');
const url = (file) => pathToFileURL(path.join(root, file)).href;
const dt = 1 / 60;
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg}: ${a} vs ${b}`);
const angleNear = (a, b) => near(Math.atan2(Math.sin(a - b), Math.cos(a - b)), 0, 'facing');
const source = fs.readFileSync(path.join(root, 'src/core/controls.js'), 'utf8');
const loaded = (async () => {
  const mapped = source.replace(/from '([^']+)'/g, (_, spec) => {
    const target = spec === 'three' ? 'vendor/three.module.js'
      : path.relative(root, path.resolve(root, 'src/core', spec));
    return `from '${url(target)}'`;
  });
  const [{ FirstPersonController }, THREE, math, config, { resolveControlMaps }] = await Promise.all([
    import(`data:text/javascript;base64,${Buffer.from(mapped).toString('base64')}`),
    import(url('vendor/three.module.js')), import(url('src/core/move-facing.mjs')),
    import(url('src/core/config.js')), import(url('src/core/keybinds.js')),
  ]);
  global.document = { addEventListener() {}, removeEventListener() {} };
  const maps = (controlMode) => resolveControlMaps({
    version: 'beta', scheme: 'compatible', controlMode,
    bindings: { forward: 'KeyW', back: 'KeyS', left: 'KeyA', right: 'KeyD' },
  });
  const make = (cameraYaw, bodyYaw, tps = true) => {
    const c = new FirstPersonController(new THREE.PerspectiveCamera(70, 1, 0.1, 200), {});
    c.setThirdPerson(tps);
    c.yaw = cameraYaw; c.bodyYaw = bodyYaw;
    return c;
  };
  return { make, maps, ...math, ...config };
})();
const directions = [
  [['KeyW'], 0, 1], [['KeyS'], 0, -1], [['KeyA'], -1, 0], [['KeyD'], 1, 0],
  [['ArrowUp'], 0, 1], [['ArrowDown'], 0, -1], [['ArrowLeft'], -1, 0], [['ArrowRight'], 1, 0],
  [['KeyW', 'KeyA'], -1, 1], [['KeyW', 'KeyD'], 1, 1],
  [['KeyS', 'KeyA'], -1, -1], [['KeyS', 'KeyD'], 1, -1],
];
for (const [label, cy, by] of [['zero', 0, 0], ['camera only', 1.13, 0], ['body only', 0, -0.83], ['both', -1.21, 0.71]]) {
  test(`TPS all directions: ${label}, driving/classic, fixed-step and touch equivalence`, async () => {
    const { make, maps, resolveTouchDrive, PLAYER } = await loaded;
    for (const mode of ['driving', 'classic']) for (const [codes, x, y] of directions) {
      const c = make(cy, by), touch = make(cy, by), { moveMap, turnMap } = maps(mode);
      touch.touchAxes = { x, y };
      const mag = Math.hypot(x, y);
      // Independent screen basis: screen-up and screen-right from the camera yaw.
      const wantX = (Math.cos(cy) * x - Math.sin(cy) * y) / mag;
      const wantZ = (-Math.sin(cy) * x - Math.cos(cy) * y) / mag;
      for (let frame = 0; frame < 12; frame++) {
        c.update(dt, new Set(codes), 1, moveMap, 0, turnMap);
        touch.update(dt, new Set(), 1, moveMap, 0, turnMap);
        near(c.yaw, cy, 'camera yaw every frame'); near(c.camera.rotation.y, cy, 'render camera yaw');
        near(touch.yaw, cy, 'touch camera yaw');
        near(-Math.sin(c.bodyYaw), wantX, 'body forward X');
        near(-Math.cos(c.bodyYaw), wantZ, 'body forward Z');
        angleNear(c.moveFacingYaw, c.bodyYaw);
        assert.equal(c.isBackpedal, false); assert.equal(c.moveSpeedScale, 1);
        const speed = PLAYER.speed * (1 - Math.exp(-PLAYER.handling.accel * dt * (frame + 1)));
        near(c.velocity.x, wantX * speed, 'actual velocity X');
        near(c.velocity.z, wantZ * speed, 'actual velocity Z');
        for (const axis of ['x', 'z']) {
          near(c.position[axis], touch.position[axis], 'keyboard/touch position');
          near(c.velocity[axis], touch.velocity[axis], 'keyboard/touch velocity');
        }
        angleNear(c.bodyYaw, touch.bodyYaw);
      }
      const drive = resolveTouchDrive({ bodyYaw: by, cameraYaw: cy, x, y, dt, thirdPerson: true });
      near(drive.moveX, wantX, 'touch unit X'); near(drive.moveZ, wantZ, 'touch unit Z');
    }
  });
}

test('TPS keyboard resolver shares touch directions; opposing, alias and mixed input stay capped', async () => {
  const { make, maps, resolveKeyboardDrive } = await loaded;
  const { moveMap, turnMap } = maps('driving');
  for (const [codes, x, y] of directions) {
    const k = resolveKeyboardDrive(new Set(codes), moveMap, turnMap, 0.7, 2.7, dt, 0.58, true);
    near(k.yaw, 0.7, 'pure resolver camera');
    near(Math.hypot(k.intent.moveX, k.intent.moveZ), 1, 'normalized direction');
    angleNear(k.intent.facingYaw, Math.atan2(-k.intent.moveX, -k.intent.moveZ));
    assert.equal(k.intent.isBackpedal, false);
    near(k.mx, x, 'keyboard screen X'); near(k.mz, y, 'keyboard screen Y');
  }
  for (const codes of [['KeyW', 'KeyS'], ['KeyA', 'KeyD'], ['KeyW', 'KeyS', 'KeyA', 'KeyD']]) {
    const c = make(0.7, -0.4);
    c.update(dt, new Set(codes), 1, moveMap, 0, turnMap);
    near(c.velocity.length(), 0, 'opposing inputs cancel'); angleNear(c.bodyYaw, -0.4);
  }
  const c = make(0.7, -0.4), reference = make(0.7, -0.4);
  c.touchAxes = { x: 1, y: 1 }; reference.touchAxes = { x: 1, y: 1 };
  c.update(dt, new Set(['KeyW', 'ArrowUp', 'KeyD', 'ArrowRight']), 1, moveMap, 0, turnMap);
  reference.update(dt, new Set(), 1, moveMap, 0, turnMap);
  near(c.velocity.x, reference.velocity.x, 'mixed normalized X');
  near(c.velocity.z, reference.velocity.z, 'mixed normalized Z'); near(c.yaw, 0.7, 'mixed camera');
});

test('FPV driving and classic retain W/S backpedal and A/D camera/body behavior', async () => {
  const { make, maps, resolveMoveIntent, dampAngle, PLAYER } = await loaded;
  for (const mode of ['driving', 'classic']) for (const codes of [
    ['KeyW'], ['KeyS'], ['KeyA'], ['KeyD'], ['KeyW', 'KeyD'], ['KeyS', 'KeyD'],
  ]) {
    const c = make(0.63, -0.4, false), { moveMap, turnMap } = maps(mode);
    let expectedYaw = c.yaw, expectedBody = c.bodyYaw;
    for (let frame = 0; frame < 20; frame++) {
      const lateral = Number(codes.includes('KeyD')) - Number(codes.includes('KeyA'));
      const throttle = Number(codes.includes('KeyW')) - Number(codes.includes('KeyS'));
      if (mode === 'driving') expectedYaw -= lateral * PLAYER.handling.turnRate * dt;
      const intent = resolveMoveIntent(mode === 'classic' ? lateral : 0, throttle, expectedYaw, PLAYER.backpedalSpeed);
      expectedBody = dampAngle(expectedBody, intent.facingYaw, dt, PLAYER.bodyTurnRate);
      c.update(dt, new Set(codes), 1, moveMap, 0, turnMap);
      near(c.yaw, expectedYaw, 'FPV camera coupling'); angleNear(c.bodyYaw, expectedBody);
      assert.equal(c.isBackpedal, intent.isBackpedal);
      if (codes.length === 1 && codes[0] === 'KeyS') assert.equal(c.isBackpedal, true);
      near(c.moveSpeedScale, intent.isBackpedal ? PLAYER.backpedalSpeed : 1, 'FPV speed');
    }
    if (mode === 'driving' && codes.length === 1 && ['KeyA', 'KeyD'].includes(codes[0])) {
      near(c.velocity.length(), 0, 'FPV steering without throttle');
      assert.ok(codes[0] === 'KeyA' ? c.yaw > 0.63 : c.yaw < 0.63);
    }
  }
});

test('TPS release, movement lock and resume cannot retain steering or touch throttle', async () => {
  const { make, maps } = await loaded;
  const { moveMap, turnMap } = maps('driving');
  const c = make(1.1, -0.3), keys = new Set(['KeyS', 'KeyD']);
  c.touchAxes = { x: 0.4, y: -0.7 };
  c.update(dt, keys, 1, moveMap, 0, turnMap);
  const released = make(1.1, -0.3);
  released.update(dt, new Set(['KeyS']), 1, moveMap, 0, turnMap);
  const releasedBody = released.bodyYaw;
  let priorSpeed = released.velocity.length();
  for (let i = 0; i < 120; i++) {
    released.update(dt, new Set(), 1, moveMap, 0, turnMap);
    assert.ok(released.velocity.length() <= priorSpeed, 'key release brakes every step');
    priorSpeed = released.velocity.length();
    angleNear(released.bodyYaw, releasedBody); near(released.yaw, 1.1, 'release camera');
  }
  assert.ok(priorSpeed < 1e-9, 'released motion converges to rest');
  c.movementLocked = true;
  const position = c.position.clone(), body = c.bodyYaw;
  for (let i = 0; i < 20; i++) c.update(dt, keys, 1, moveMap, 0, turnMap);
  near(c.position.distanceTo(position), 0, 'locked input has no displacement'); angleNear(c.bodyYaw, body);
  // Apply the production pause/release contract, then advance the real controller.
  keys.clear(); c.touchAxes = { x: 0, y: 0 }; c.movementLocked = false;
  for (let i = 0; i < 20; i++) c.update(dt, keys, 1, moveMap, 0, turnMap);
  near(c.position.distanceTo(position), 0, 'resume after release remains stopped'); near(c.yaw, 1.1, 'released camera');
  c.update(dt, new Set(['KeyW']), 1, moveMap, 0, turnMap);
  assert.ok(c.velocity.length() > 0, 'fresh input works after resume'); angleNear(c.bodyYaw, c.yaw);
});

test('source contract: pause/settings/blur release, simulation gate and TPS camera ownership', async () => {
  await loaded;
  const main = fs.readFileSync(path.join(root, 'src/main.js'), 'utf8');
  const pause = main.slice(main.indexOf('function pause()'), main.indexOf('function resume'));
  assert.match(pause, /keys\.clear\(\)/); assert.match(pause, /touchControls\?\.releaseAll\(\)/);
  assert.match(main, /window\.addEventListener\('blur',[\s\S]*?keys\.clear\(\)[\s\S]*?if \(game\.mode === 'play'\) pause\(\)/);
  assert.match(main, /pause: \(\{ silent = false \} = \{\}\) => pause\(\{ silent \}\)/);
  assert.match(main, /function update\(dt\) \{\s*if \(game\.mode !== 'play'\) \{[\s\S]*?return;\s*\}/);
  assert.match(source, /if \(!this\.thirdPerson\) this\.yaw = keyboard\.yaw/);
  const tps = source.slice(source.indexOf('if (this.thirdPerson) {', source.indexOf('const drive = resolveTouchDrive')), source.indexOf('} else if (this.touchLookActive)'));
  assert.ok(tps.includes('moveFacingYaw')); assert.doesNotMatch(tps, /this\.yaw\s*=/);
});
