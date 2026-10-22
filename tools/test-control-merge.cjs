const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

(async () => {
  const { resolveKeyboardDrive } = await import('../src/core/move-facing.mjs');
  const {
    Keybinds, CONTROL_MODE_STORAGE_KEY, resolveControlMaps, resolveDefaultControlMode,
  } = await import('../src/core/keybinds.js');
  const { schemeHints } = await import('../src/core/key-hints.mjs');

  assert.equal(resolveDefaultControlMode('beta'), 'driving', '无存档 beta 默认转向驾驶');
  assert.equal(resolveDefaultControlMode('beta', 'classic'), 'classic', 'beta 保留玩家已选经典模式');
  assert.equal(resolveDefaultControlMode('dev'), 'classic', 'dev 默认不被 beta 偏好污染');

  const binds = new Keybinds();
  binds.setScheme('compatible');
  const betaDriving = resolveControlMaps({
    version: 'beta', scheme: 'compatible', controlMode: 'driving', bindings: binds.map,
  });
  assert.deepEqual(betaDriving.turnMap, {
    left: 'KeyA', right: 'KeyD', leftAlt: 'ArrowLeft', rightAlt: 'ArrowRight',
  }, 'beta compatible driving binds A/D and left/right arrows to steering');
  assert.equal(betaDriving.moveMap.left, null, 'driving mode does not strafe from A');
  assert.equal(betaDriving.moveMap.right, null, 'driving mode does not strafe from D');
  assert.equal(betaDriving.moveMap.forward, 'KeyW');
  assert.equal(betaDriving.moveMap.back, 'KeyS');

  const left = resolveKeyboardDrive(new Set(['KeyA']), betaDriving.moveMap, betaDriving.turnMap, 0, 2.2, 0.1, 0.58);
  assert.ok(left.yaw > 0.2 && left.mx === 0 && left.mz === 0, 'A turns left without moving laterally');
  const arrowRight = resolveKeyboardDrive(new Set(['ArrowRight']), betaDriving.moveMap, betaDriving.turnMap, 0, 2.2, 0.1);
  assert.ok(arrowRight.yaw < -0.2 && arrowRight.mx === 0, 'right arrow also steers right');
  const forward = resolveKeyboardDrive(new Set(['KeyW']), betaDriving.moveMap, betaDriving.turnMap, 0, 2.2, 0.1, 0.58);
  assert.equal(forward.intent.mz, 1);
  assert.equal(forward.intent.isBackpedal, false);
  const backward = resolveKeyboardDrive(new Set(['KeyS']), betaDriving.moveMap, betaDriving.turnMap, 0, 2.2, 0.1, 0.58);
  assert.equal(backward.intent.mz, -1);
  assert.equal(backward.intent.isBackpedal, true);
  assert.equal(backward.intent.speedScale, 0.58);
  assert.equal(backward.intent.facingYaw, 0, 'S keeps current heading while backing');
  const arc = resolveKeyboardDrive(new Set(['KeyW', 'KeyD']), betaDriving.moveMap, betaDriving.turnMap, 0, 2.2, 0.1, 0.58);
  assert.ok(arc.turnActive && arc.yaw < 0, 'W+D turns right in the same frame');
  assert.ok(arc.intent.mz > 0 && arc.intent.moveX > 0, 'W+D advances along the newly steered heading');
  const reverseArc = resolveKeyboardDrive(new Set(['KeyS', 'KeyD']), betaDriving.moveMap, betaDriving.turnMap, 0, 2.2, 0.1, 0.58);
  assert.ok(reverseArc.yaw < 0 && reverseArc.intent.isBackpedal, 'S+D turns while keeping backpedal semantics');
  assert.equal(reverseArc.intent.speedScale, 0.58);

  const betaOptimized = resolveControlMaps({
    version: 'beta', scheme: 'optimized', controlMode: 'driving',
    bindings: { ...binds.map, forward: 'KeyW', back: 'KeyS', left: 'KeyA', right: 'KeyD' },
  });
  assert.equal(betaOptimized.turnMap.left, 'KeyA', 'optimized beta scheme also uses selected driving mode');
  assert.equal(betaOptimized.moveMap.left, null);
  const betaClassic = resolveControlMaps({
    version: 'beta', scheme: 'compatible', controlMode: 'classic', bindings: binds.map,
  });
  assert.equal(betaClassic.turnMap, null, 'classic mode disables turn map');
  assert.equal(betaClassic.moveMap.left, 'KeyA', 'classic mode retains A strafe');
  assert.equal(betaClassic.moveMap.leftAlt, 'ArrowLeft', 'classic mode retains arrow strafe');
  const classicA = resolveKeyboardDrive(new Set(['KeyA']), betaClassic.moveMap, betaClassic.turnMap, 0, 2.2, 0.1);
  assert.equal(classicA.yaw, 0, 'classic A does not turn');
  assert.equal(classicA.intent.moveX, -1, 'classic A strafes left');

  // Dev's existing optimized A/D turning with arrow-key lateral movement is unchanged,
  // and dev compatible remains legacy strafe regardless of a stored beta preference.
  const devOptimized = resolveControlMaps({
    version: 'dev', scheme: 'optimized', controlMode: 'classic',
    bindings: { forward: 'KeyW', back: 'KeyS', left: null, right: null, turnLeft: 'KeyA', turnRight: 'KeyD' },
  });
  assert.deepEqual(devOptimized.turnMap, { left: 'KeyA', right: 'KeyD' });
  assert.equal(devOptimized.moveMap.left, null);
  assert.equal(devOptimized.moveMap.leftAlt, 'ArrowLeft');
  const devA = resolveKeyboardDrive(new Set(['KeyA']), devOptimized.moveMap, devOptimized.turnMap, 0, 2.2, 0.1);
  assert.ok(devA.yaw > 0 && devA.mx === 0, 'dev optimized A still turns');
  const devCompat = resolveControlMaps({ version: 'dev', scheme: 'compatible', controlMode: 'driving', bindings: binds.map });
  assert.deepEqual(devCompat.turnMap, { left: null, right: null });
  assert.equal(devCompat.moveMap.left, 'KeyA');

  // Selection change persists and notifies listeners.
  const stored = new Map();
  global.localStorage = {
    getItem(key) { return stored.get(key) ?? null; },
    setItem(key, value) { stored.set(key, value); },
  };
  let notified = 0;
  const persisted = new Keybinds();
  persisted.onChange(() => { notified++; });
  persisted.setControlMode('classic');
  assert.equal(stored.get(CONTROL_MODE_STORAGE_KEY), 'classic');
  assert.equal(notified, 1);
  assert.equal(persisted.controlMode, 'classic');

  const opt = new Keybinds();
  opt.setScheme('optimized');
  const classicHint = schemeHints(opt, { isDev: false });
  assert.ok(classicHint.movement.includes('横移'), 'classic hint describes sideways motion');
  const betaHintBinds = Object.create(opt);
  Object.defineProperty(betaHintBinds, 'controlProfile', { value: 'driving' });
  Object.defineProperty(betaHintBinds, 'turningEnabled', { value: true });
  const betaHint = schemeHints(betaHintBinds, { isDev: false });
  assert.ok(betaHint.movement.includes('前后移动') && betaHint.movement.includes('转向'));
  assert.ok(betaHint.movement.includes('A / D'), 'beta hint shows active A/D bindings');
  assert.equal(betaHint.turning, true);
  const devHint = schemeHints(opt, { isDev: true });
  assert.ok(devHint.movement.includes('转向'), 'dev optimized hint remains turning');
  assert.ok(devHint.movement.includes('横移'), 'dev optimized hint preserves arrow strafe description');

  const root = path.resolve(__dirname, '..');
  const settingsSource = fs.readFileSync(path.join(root, 'src/ui/settings.js'), 'utf8');
  const mainSource = fs.readFileSync(path.join(root, 'src/main.js'), 'utf8');
  assert.match(settingsSource, /if \(IS_BETA\)[\s\S]*?data-control-mode/, 'beta settings expose the control mode choice');
  assert.match(settingsSource, /mode\.id === 'driving' \? '（默认\/新）'/, 'beta settings label the new default');
  assert.match(settingsSource, /经典横移（WASD strafe，旧）/, 'beta settings retain the legacy option');
  assert.match(mainSource, /id="titleMoveHint"[\s\S]*?h\.movement/, 'title hint is sourced from current binding profile');
  assert.match(mainSource, /if \(titleMoveHint\) titleMoveHint\.textContent = moveHint/, 'mode changes refresh title hint');
  assert.match(mainSource, /if \(pauseMoveHint && !TOUCH_DEVICE\) pauseMoveHint\.textContent = moveHint/, 'mode changes refresh pause hint');

  console.log('control merge policy: all assertions passed');
})().catch((err) => { console.error(err); process.exit(1); });
