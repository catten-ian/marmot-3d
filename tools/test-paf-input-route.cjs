/** Stage 2：藏狐共享触屏 / 键位适配纯逻辑契约。用法：node --test tools/test-paf-input-route.cjs */
const { test } = require('node:test');
const assert = require('node:assert/strict');
let input;
let pafDirectionFromInput;
let pafMovementFromInput;
test.before(async () => { input = await import('../src/core/paf-input.js'); ({ pafDirectionFromInput, pafMovementFromInput } = input); });

test('摇杆轴映射：死区、前后、左右倒置及径向归一化', () => {
  const { mapPafJoystick } = input;
  assert.deepEqual(mapPafJoystick({ x: 0.09, y: 0.09, mag: 0.127 }, 0.78),
    { throttle: 0, turn: 0, magnitude: 0, sprint: false, stalk: true });
  assert.deepEqual(mapPafJoystick({ x: 0, y: 0.5, mag: 0.5 }, 0.78),
    { throttle: 0.5, turn: -0, magnitude: 0.5, sprint: false, stalk: true });
  const right = mapPafJoystick({ x: 0.6, y: 0, mag: 0.6 }, 0.78);
  assert.equal(right.turn, -0.6, '右拖应顺时针右转');
  assert.equal(right.throttle, 0);
  const left = mapPafJoystick({ x: -0.6, y: 0, mag: 0.6 }, 0.78);
  assert.equal(left.turn, 0.6, '左拖应左转');
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

test('camera-relative keyboard direction maps W/AW/A/D/WD and clamps to the configured arc', () => {
  const cases = [
    [{ forward: true }, 0],
    [{ forward: true, left: true }, -45],
    [{ left: true }, -60],
    [{ right: true }, 60],
    [{ forward: true, right: true }, 45],
  ];
  for (const [keys, degrees] of cases) {
    const got = pafDirectionFromInput({ cameraYaw: 0, ...keys });
    assert.ok(Math.abs(got.offset - degrees * Math.PI / 180) < 1e-9, `${JSON.stringify(keys)} => ${got.offset}`);
    assert.ok(Number.isFinite(got.x) && Number.isFinite(got.z));
  }
  assert.equal(pafDirectionFromInput({ arcDeg: 80, right: true }).offset, 40 * Math.PI / 180);
  assert.equal(pafDirectionFromInput({ arcDeg: 240, left: true }).offset, -90 * Math.PI / 180);
});

test('FPV and TPS use identical camera-relative movement semantics for the same input', () => {
  for (const cameraYaw of [0, 0.7, -2.2]) {
    for (const keys of [{ forward: true }, { left: true, forward: true }, { right: true }]) {
      const tps = pafMovementFromInput({ cameraYaw, ...keys });
      const fpv = pafMovementFromInput({ cameraYaw, ...keys });
      assert.deepEqual(fpv, tps);
    }
  }
});

test('touch joystick uses the same camera-relative direction contract and finite fallback', () => {
  const touch = pafDirectionFromInput({ cameraYaw: Math.PI / 2, axes: { x: 0, y: 1 } });
  assert.ok(Math.abs(touch.yaw - Math.PI / 2) < 1e-9);
  const diagonal = pafMovementFromInput({ cameraYaw: 0.4, axes: { x: 1, y: 1 } });
  assert.ok(Math.abs(diagonal.magnitude - 1) < 1e-12);
  assert.ok(Math.abs(Math.hypot(diagonal.x, diagonal.z) - 1) < 1e-12);
  const fallback = pafDirectionFromInput({ cameraYaw: 0.7, axes: { x: NaN, y: Infinity } });
  assert.equal(fallback.source, 'fallback');
  assert.ok(Number.isFinite(fallback.yaw));
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
