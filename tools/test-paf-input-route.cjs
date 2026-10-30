/** Stage 2：藏狐共享触屏 / 键位适配纯逻辑契约。用法：node --test tools/test-paf-input-route.cjs */
const { test } = require('node:test');
const assert = require('node:assert/strict');
let input;
let pafDirectionFromInput;
test.before(async () => { input = await import('../src/core/paf-input.js'); ({ pafDirectionFromInput } = input); });

test('摇杆轴映射：死区、前后、左右转向符号及径向归一化', () => {
  const { mapPafJoystick } = input;
  assert.deepEqual(mapPafJoystick({ x: 0.09, y: 0.09, mag: 0.127 }, 0.78),
    { throttle: 0, turn: 0, magnitude: 0, sprint: false, stalk: true });
  assert.deepEqual(mapPafJoystick({ x: 0, y: 0.5, mag: 0.5 }, 0.78),
    { throttle: 0.5, turn: 0, magnitude: 0.5, sprint: false, stalk: true });
  const right = mapPafJoystick({ x: 0.6, y: 0, mag: 0.6 }, 0.78);
  assert.equal(right.turn, -0.6, '右拖对应减小 yaw 的 PAF 右转');
  assert.equal(right.throttle, 0);
  const left = mapPafJoystick({ x: -0.6, y: 0, mag: 0.6 }, 0.78);
  assert.equal(left.turn, 0.6, '左拖对应增大 yaw 的 PAF 左转');
  const back = mapPafJoystick({ x: 0, y: -0.4, mag: 0.4 }, 0.78);
  assert.equal(back.throttle, -0.4);
  const diagonal = mapPafJoystick({ x: 1, y: 1, mag: 1 }, 0.78);
  assert.ok(Math.abs(diagonal.magnitude - 1) < 1e-12);
  assert.ok(Math.abs(diagonal.throttle - Math.SQRT1_2) < 1e-12);
  assert.ok(Math.abs(diagonal.turn + Math.SQRT1_2) < 1e-12);
  assert.ok(Math.abs(Math.hypot(diagonal.throttle, diagonal.turn) - 1) < 1e-12);
  assert.deepEqual(mapPafJoystick(null), mapPafJoystick({ x: 0, y: 0 }));
});

test('推过 sprintThreshold 疾跑、内圈内潜行，任意输入二者严格互斥', () => {
  for (const threshold of [0.55, 0.78, 0.95]) {
    for (const magnitude of [0, 0.14, 0.3, threshold - 0.001, threshold, 1, 1.4]) {
      const out = input.mapPafJoystick({ x: 0, y: magnitude, mag: magnitude }, threshold);
      const expectedSprint = magnitude >= 0.14 && Math.min(1, magnitude) >= threshold;
      assert.equal(out.sprint, expectedSprint);
      assert.equal(out.stalk, !out.sprint);
      assert.notEqual(out.sprint, out.stalk);
    }
  }
});

test('PAF moving pounce: press starts a readable windup and release does not gate launch', () => {
  const charge = new input.PafPounceCharge();
  assert.equal(charge.press(), true);
  assert.equal(charge.press(), false, 'one press cannot re-arm the same pounce');
  assert.equal(charge.step(0.08, 0.22).shouldLunge, false);
  charge.release();
  assert.equal(charge.step(0.1, 0.22).shouldLunge, false);
  assert.equal(charge.step(0.05, 0.22).shouldLunge, true);
  charge.reset();
  charge.press();
  assert.equal(charge.step(0.5, 0.22).shouldLunge, true, 'held input must not extend moving pounce');
  charge.reset();
  assert.equal(charge.active, false);
});

test('PAF pounce press has no repeat auto-trigger after commit/reset', () => {
  const charge = new input.PafPounceCharge();
  assert.equal(charge.press(), true);
  assert.equal(charge.step(0.22, 0.22).shouldLunge, true);
  charge.reset();
  assert.equal(charge.step(1, 0.22).shouldLunge, false);
});

test('tank drive moves W/S along a fixed nonzero facing and steering never creates lateral motion', () => {
  const yaw = 0.73;
  const forward = input.pafTankDriveFromInput({ yaw, keys: { forward: true }, dt: 0.1 });
  assert.equal(forward.yaw, yaw);
  assert.ok(forward.x > 0 && forward.z > 0, 'forward from nonzero yaw follows +sin(yaw), +cos(yaw)');
  close(forward.x, Math.sin(yaw)); close(forward.z, Math.cos(yaw));
  const back = input.pafTankDriveFromInput({ yaw, keys: { back: true }, dt: 0.1 });
  assert.equal(back.yaw, yaw, 'S does not rotate the body');
  close(back.x, -Math.sin(yaw)); close(back.z, -Math.cos(yaw));
  const left = input.pafTankDriveFromInput({ yaw, keys: { left: true }, dt: 0.1 });
  assert.ok(screenTurnDot(yaw, left.yaw) < 0, 'left turns screen-left');
  assert.equal(left.x, 0); assert.equal(left.z, 0);
  const right = input.pafTankDriveFromInput({ yaw, keys: { right: true }, dt: 0.1 });
  assert.ok(screenTurnDot(yaw, right.yaw) > 0, 'right turns screen-right');
  assert.equal(right.x, 0); assert.equal(right.z, 0);
  const forwardRight = input.pafTankDriveFromInput({ yaw, keys: { forward: true, right: true }, dt: 0.1 });
  assert.ok(screenTurnDot(yaw, forwardRight.yaw) > 0);
  close(forwardRight.x, Math.sin(forwardRight.yaw)); close(forwardRight.z, Math.cos(forwardRight.yaw));
  assert.equal(input.pafTankDriveFromInput({ yaw, keys: { forward: true, back: true }, dt: 0.1 }).throttle, 0);
});

test('keyboard key aliases map WASD and arrows to throttle/steering with left/right signs', () => {
  const binds = { isAction: () => false };
  const aliases = [
    ['KeyW', 'forward'], ['ArrowUp', 'forward'], ['KeyS', 'back'], ['ArrowDown', 'back'],
    ['KeyA', 'left'], ['ArrowLeft', 'left'], ['KeyD', 'right'], ['ArrowRight', 'right'],
  ];
  for (const [code, expected] of aliases) {
    const mapped = input.pafKeyboardDriveInput(binds, new Set([code]));
    assert.equal(mapped[expected], true, `${code} maps to ${expected}`);
    const drive = input.pafTankDriveFromInput({ yaw: 0.73, keys: mapped, dt: 0.1 });
    if (expected === 'left') { assert.ok(screenTurnDot(0.73, drive.yaw) < 0); assert.equal(drive.x, 0); assert.equal(drive.z, 0); }
    if (expected === 'right') { assert.ok(screenTurnDot(0.73, drive.yaw) > 0); assert.equal(drive.x, 0); assert.equal(drive.z, 0); }
    if (expected === 'forward') { assert.equal(drive.yaw, 0.73); assert.ok(drive.x > 0 && drive.z > 0); }
    if (expected === 'back') { assert.equal(drive.yaw, 0.73); assert.ok(drive.x < 0 && drive.z < 0); }
  }
});

test('pounce keyboard and touch directions retain their independent arc-clamped selection contract', () => {
  const cases = [
    [{ forward: true }, 0], [{ forward: true, left: true }, 45],
    [{ left: true }, 60], [{ right: true }, -60], [{ forward: true, right: true }, -45],
  ];
  for (const [keys, degrees] of cases) {
    const got = pafDirectionFromInput({ cameraYaw: 0, ...keys });
    close(got.offset, degrees * Math.PI / 180);
    assert.ok(Number.isFinite(got.x) && Number.isFinite(got.z));
  }
  close(pafDirectionFromInput({ arcDeg: 80, right: true }).offset, -40 * Math.PI / 180);
  close(pafDirectionFromInput({ arcDeg: 240, left: true }).offset, 90 * Math.PI / 180);
  const touch = pafDirectionFromInput({ cameraYaw: Math.PI / 2, axes: { x: 0, y: 1 } });
  close(touch.yaw, Math.PI / 2);
  const fallback = pafDirectionFromInput({ cameraYaw: 0.7, axes: { x: NaN, y: Infinity } });
  assert.equal(fallback.source, 'fallback'); assert.ok(Number.isFinite(fallback.yaw));
});

test('touch vertical is throttle, horizontal steering has correct sign, diagonals normalize and dead-zone releases', () => {
  const yaw = 0.73, dt = 0.1, turnRate = 2.6;
  const up = input.pafTankDriveFromInput({ yaw, axes: { x: 0, y: 0.6 }, dt });
  close(up.x, 0.6 * Math.sin(yaw)); close(up.z, 0.6 * Math.cos(yaw)); assert.equal(up.yaw, yaw);
  const down = input.pafTankDriveFromInput({ yaw, axes: { x: 0, y: -0.6 }, dt });
  close(down.x, -0.6 * Math.sin(yaw)); close(down.z, -0.6 * Math.cos(yaw));
  const left = input.pafTankDriveFromInput({ yaw, axes: { x: -0.6, y: 0 }, dt, turnRate });
  assert.ok(screenTurnDot(yaw, left.yaw) < 0); assert.equal(left.throttle, 0); assert.equal(left.x, 0); assert.equal(left.z, 0);
  const right = input.pafTankDriveFromInput({ yaw, axes: { x: 0.6, y: 0 }, dt, turnRate });
  assert.ok(screenTurnDot(yaw, right.yaw) > 0); assert.equal(right.throttle, 0); assert.equal(right.x, 0); assert.equal(right.z, 0);
  const diagonal = input.pafTankDriveFromInput({ yaw, axes: { x: 1, y: 1 }, dt });
  close(diagonal.throttle, Math.SQRT1_2); close(diagonal.turn, -Math.SQRT1_2);
  close(Math.hypot(diagonal.throttle, diagonal.turn), 1);
  close(diagonal.x, diagonal.throttle * Math.sin(diagonal.yaw));
  close(diagonal.z, diagonal.throttle * Math.cos(diagonal.yaw));
  const dead = input.pafTankDriveFromInput({ yaw, axes: { x: 0.09, y: 0.09 }, dt });
  assert.deepEqual({ x: dead.x, z: dead.z, yaw: dead.yaw, active: dead.active }, { x: 0, z: 0, yaw, active: false });
});

function screenTurnDot(baseYaw, nextYaw) {
  const dx = Math.sin(nextYaw), dz = Math.cos(nextYaw);
  const rx = -Math.cos(baseYaw), rz = Math.sin(baseYaw);
  return dx * rx + dz * rz;
}

function close(actual, expected, eps = 1e-10) { assert.ok(Math.abs(actual - expected) <= eps, `${actual} != ${expected}`); }

test('pounce direction remains independent: same keyboard/touch intent selects attack direction, not locomotion strafe', () => {
  const bodyYaw = 0.73;
  const keys = input.pafKeyboardDriveInput({ isAction: () => false }, new Set(['KeyA', 'KeyW']));
  const normal = input.pafTankDriveFromInput({ yaw: bodyYaw, keys, dt: 0.1 });
  const pounce = pafDirectionFromInput({ cameraYaw: bodyYaw, ...keys });
  assert.ok(screenTurnDot(bodyYaw, normal.yaw) < 0, 'ordinary A turns screen-left');
  assert.ok(normal.x > 0 && normal.z > 0, 'W advances along the newly-facing heading');
  assert.ok(screenTurnDot(bodyYaw, pounce.yaw) < 0, 'pounce keeps its independent A+W direction selection');
  assert.ok(pounce.x > Math.sin(bodyYaw) && pounce.z < Math.cos(bodyYaw), 'attack selection rotates within its own direction contract');
  const touchPounce = pafDirectionFromInput({ cameraYaw: bodyYaw, axes: { x: 0.6, y: 0.4 } });
  const touchDrive = input.pafTankDriveFromInput({ yaw: bodyYaw, axes: { x: 0.6, y: 0.4 }, dt: 0.1 });
  assert.ok(screenTurnDot(bodyYaw, touchPounce.yaw) > 0 && screenTurnDot(bodyYaw, touchDrive.yaw) > 0);
  assert.ok(touchDrive.z > 0, 'touch throttle still advances along facing rather than diagonally strafing');
});

test('paused/settings guards and release prevent movement, turn, pounce and stuck touch/key state', async () => {
  assert.equal(input.pafInputBlocked({ running: true, paused: false, settingsOpen: true }), true);
  assert.equal(input.pafInputBlocked({ running: false }), true);
  assert.equal(input.pafInputBlocked({ running: true, paused: false, settingsOpen: false }), false);
  const keys = new Set(['KeyW', 'KeyA', 'Space']);
  const state = { throttle: 1, turn: -1, sprint: true };
  assert.equal(input.pafCanStartPounce({ paused: true }), false);
  assert.equal(input.pafCanStartPounce({ settingsOpen: true }), false);
  assert.equal(input.pafCanStartPounce({ running: false }), false);
  assert.equal(input.pafCanStartPounce({ phase: 'wind' }), false);
  assert.equal(input.pafCanStartPounce({ phase: 'idle' }), true);
  const { createSettingsPauseHooks } = await import('../src/core/settings-pause.mjs');
  let paused = false;
  const hooks = createSettingsPauseHooks({ getPaf: () => ({ active: true, get paused() { return paused; }, setPaused(value) { paused = value; if (value) input.releasePafInput({ keys, touchState: state }); } }) });
  hooks.pause();
  assert.equal(paused, true); assert.equal(input.pafInputBlocked({ paused }), true);
  assert.equal(input.pafCanStartPounce({ paused, settingsOpen: true }), false, 'settings pause blocks pounce dispatch');
  let releases = 0;
  input.releasePafInput({ keys, touchState: state, touchControls: { releaseAll() { releases++; } } });
  assert.equal(keys.size, 0);
  assert.deepEqual(state, { throttle: 0, turn: 0, sprint: false });
  assert.equal(releases, 1);
  hooks.resume(); assert.equal(paused, false);
  assert.equal(input.pafTankDriveFromInput({ yaw: 0.73, keys: input.pafKeyboardDriveInput(null, keys), axes: { x: 0, y: 0 } }).active, false, 'resume cannot replay held controls');
  assert.equal(input.pafInputBlocked({ running: true, paused: true, settingsOpen: true }), true, 'paused settings keep the production update gate closed');
});

test('Keybinds.isAction 命中优先生效，未命中时保留默认键兜底', () => {
  const binds = {
    isAction(code, action) { return action === 'attack' ? code === 'KeyU' : action === 'sprint' && code === 'ControlLeft'; },
  };
  assert.equal(input.isPafKey(binds, 'KeyU', 'attack', ['Space']), true);
  assert.equal(input.isPafKey(binds, 'Space', 'attack', ['Space']), true);
  assert.equal(input.isPafKey(binds, 'KeyJ', 'attack', ['Space']), false);
  assert.equal(input.isPafKey(binds, 'ControlLeft', 'sprint', ['ShiftLeft', 'ShiftRight']), true);
  assert.equal(input.isPafKey(binds, 'ShiftRight', 'sprint', ['ShiftLeft', 'ShiftRight']), true);
  assert.equal(input.isPafKey(null, 'KeyW', 'forward', ['KeyW']), true);
  assert.equal(input.pafKeyHeld(binds, new Set(['KeyU']), 'attack', ['Space']), true);
  assert.equal(input.pafKeyHeld(binds, new Set(['KeyJ']), 'attack', ['Space']), false);
  assert.equal(input.isPafKey(binds, 'KeyA', ['left', 'turnLeft'], ['KeyA']), true);
});

function mockTouchControls() {
  const normal = { touchEnabled: true, touchAxes: null, touchSprint: false, touchLookActive: false };
  const normalAction = () => {};
  const parry = () => {};
  const roll = () => {};
  return {
    controller: normal, move: { x: 0, y: 0, mag: 0 }, enabled: true, applied: true,
    onAction: normalAction, onParryGesture: parry, onRollGesture: roll,
    releaseCalls: 0,
    releaseAll() { this.releaseCalls++; this.move.x = this.move.y = this.move.mag = 0; this.controller.touchSprint = false; },
    normal, normalAction, parry, roll,
  };
}

test('模式切换：路由原样还原，连续进出无攻击/摇杆/手势残留', () => {
  const tc = mockTouchControls();
  const route = new input.PafInputRoute(tc);
  const seen = [];
  for (let i = 0; i < 3; i++) {
    assert.equal(route.activate({ onAction: (...args) => seen.push(args) }), true);
    assert.equal(route.active, true);
    assert.notEqual(tc.controller, tc.normal);
    assert.equal(tc.controller.touchAxes, tc.move);
    assert.equal(tc.onParryGesture, null);
    assert.equal(tc.onRollGesture, null);
    tc.controller.touchSprint = true;
    tc.move.x = 0.75; tc.move.y = -0.5; tc.move.mag = 0.9;
    tc.onAction('attack', true, i, {});
    assert.equal(route.restore(), true);
    assert.equal(route.active, false);
    assert.equal(tc.controller, tc.normal);
    assert.equal(tc.onAction, tc.normalAction);
    assert.equal(tc.onParryGesture, tc.parry);
    assert.equal(tc.onRollGesture, tc.roll);
    assert.equal(tc.normal.touchAxes, tc.move);
    assert.equal(tc.normal.touchEnabled, true);
    assert.equal(tc.normal.touchSprint, false);
    assert.equal(tc.normal.touchLookActive, false);
    assert.deepEqual(tc.move, { x: 0, y: 0, mag: 0 }, 'touch axes are released across route exit');
    tc.onAction('attack', false, i, {});
  }
  assert.equal(seen.length, 3, '恢复后的事件只能进入普通回调，不能进入藏狐回调');
  assert.equal(route.restore(), false);
  assert.equal(tc.releaseCalls, 6);
});

test('路由恢复采用当前触控启停状态，不把旧 enabled 状态带回普通模式', () => {
  const tc = mockTouchControls();
  const route = new input.PafInputRoute(tc);
  route.activate({});
  tc.enabled = false; tc.applied = false;
  route.restore();
  assert.equal(tc.normal.touchEnabled, false);
  assert.equal(tc.normal.touchSprint, false);
});
