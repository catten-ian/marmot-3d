/* TouchControls 双指并行语义（纯 Node + 最小 DOM 桩，走 Touch Events/X5 路径）：
 *  - 左摇杆只移动；右 lookZone 手指只转相机，角色分配互不替换/抢权；
 *  - 攻击键左滑 onParryGesture / 右滑 onRollGesture，闩锁只触发一次；
 *  - 疾跑阈值可实时调整，档位环 px 半径 = 阈值 × maxStick；
 *  - look 手指松开与 releaseAll 都正确复位 touchLookActive。
 */
const assert = require('node:assert/strict');

class ClassList {
  constructor() { this.s = new Set(); }
  add(c) { this.s.add(c); } remove(c) { this.s.delete(c); } toggle(c, f) { const on = f === undefined ? !this.s.has(c) : !!f; on ? this.s.add(c) : this.s.delete(c); return on; }
  contains(c) { return this.s.has(c); }
}
class El {
  constructor(tag, attrs = {}) { this.tag = tag; this.attrs = attrs; this.listeners = []; this.classList = new ClassList(); this.style = { _m: {}, setProperty(k, v) { this._m[k] = v; } }; this.children = []; this.dataset = {}; }
  addEventListener(type, fn, opts) { this.listeners.push({ type, fn, capture: opts === true || (opts && opts.capture) }); }
  dispatch(type, ev) {
    for (const l of this.listeners.filter((x) => x.type === type)) l.fn(ev);
  }
  appendChild(c) { this.children.push(c); return c; }
  querySelector(sel) { return this._walk().find((e) => e._match(sel)) || null; }
  querySelectorAll(sel) { return this._walk().filter((e) => e._match(sel)); }
  _walk(out = []) { for (const c of this.children) { out.push(c); c._walk(out); } return out; }
  _match(sel) {
    const mHas = sel.match(/^\[([\w-]+)\]$/);
    if (mHas) return Object.prototype.hasOwnProperty.call(this.attrs, mHas[1]);
    const m = sel.match(/^\[([\w-]+)="?([^"\]]+)"?\]$/);
    if (m) return this.attrs[m[1]] === m[2];
    return this.tag === sel;
  }
  getBoundingClientRect() { return { left: 0, top: 0, width: 100, height: 100 }; }
  setPointerCapture() {}
}

(async () => {
  const touch = (identifier, clientX, clientY) => ({ identifier, clientX, clientY });
  const touchEvent = (list) => ({ changedTouches: list, preventDefault() {}, stopPropagation() {} });

  const handlers = {};
  const win = {
    ontouchstart: null,
    addEventListener(type, fn, opts) { (handlers[type] ||= []).push({ fn, capture: opts === true || (opts && opts.capture) }); },
  };
  globalThis.window = win;
  globalThis.navigator = { maxTouchPoints: 5 };
  globalThis.TouchEvent = function TouchEvent() {};
  globalThis.document = {
    body: { classList: new ClassList() },
    addEventListener() {},
    pointerLockElement: null,
    exitPointerLock() {},
  };

  const { TouchControls } = await import('../src/core/touch-controls.js');

  const root = new El('div');
  const lookZone = new El('div');
  const joystick = new El('div');
  const stick = new El('div');
  const attack = new El('button', { 'data-touch-action': 'attack' });
  attack.dataset.touchAction = 'attack';
  root.appendChild(attack);

  const parryFires = [];
  const rollFires = [];
  const actions = [];
  const controller = { yaw: 0, pitch: 0, touchLookSensitivity: 0.006, touchSprint: false, touchLookActive: false };
  const tc = new TouchControls({
    canvas: {}, controller, root, lookZone, joystick, stick,
    isActive: () => true,
    onParryGesture: (ctx) => parryFires.push(ctx),
    onRollGesture: (ctx) => rollFires.push(ctx),
    onAction: (action, pressed, id, data) => actions.push({ action, pressed, id, data }),
  });

  // 右手 look 指针
  lookZone.dispatch('touchstart', touchEvent([touch(1, 100, 100)]));
  assert.equal(tc.lookPointer, 1);
  assert.equal(tc.pointerRoles.get(1), 'look');
  assert.equal(controller.touchLookActive, true, 'look 手指按下置 touchLookActive');
  lookZone.dispatch('touchmove', touchEvent([touch(1, 140, 100)]));
  const yawAfterLook = controller.yaw;
  assert.ok(Math.abs(yawAfterLook - (-40 * controller.touchLookSensitivity)) < 1e-12, 'look 拖动改写相机 yaw');

  // 左手摇杆：移动 + 疾跑；不改变 look 角色
  joystick.dispatch('touchstart', touchEvent([touch(0, 80, 50)]));
  assert.equal(tc.movePointer, 0);
  assert.equal(tc.pointerRoles.get(0), 'move');
  assert.equal(tc.lookPointer, 1, '摇杆按下不顶替 look 指针');
  assert.equal(tc.pointerRoles.get(1), 'look', 'look 角色不被摇杆覆盖');
  joystick.dispatch('touchmove', touchEvent([touch(0, 80, 50)])); // dx=30 → mag .625
  assert.ok(Math.abs(tc.move.x - 0.625) < 1e-9 && tc.move.y === 0);
  assert.equal(controller.touchSprint, false, '0.625 行程未到默认阈值 0.78，不疾跑');
  joystick.dispatch('touchmove', touchEvent([touch(0, 95, 50)])); // dx=45 → mag .9375
  assert.equal(controller.touchSprint, true, '推过 0.78 疾跑');

  // 疾跑阈值实时调整 + 档位环半径与归一化行程一致
  assert.equal(joystick.style._m['--stick-sprint-radius'], '37.44px', '默认环半径 = 0.78×48');
  tc.setSprintThreshold(0.95);
  assert.equal(controller.touchSprint, false, '阈值调到 0.95 后当前 .9375 不再疾跑');
  assert.equal(joystick.style._m['--stick-sprint-radius'], '45.60px', '环半径随阈值 = .95×48');
  tc.setSprintThreshold(0.55);
  assert.equal(controller.touchSprint, true, '阈值调到 0.55 立即疾跑');
  assert.equal(joystick.style._m['--stick-sprint-radius'], '26.40px');
  tc.setSprintThreshold(2); // clamp 到上限
  assert.equal(tc.sprintThreshold, 0.95, '阈值 clamp 上限');
  tc.setSprintThreshold(0.1); // clamp 到下限
  assert.equal(tc.sprintThreshold, 0.55, '阈值 clamp 下限');
  tc.setSprintThreshold(0.78);

  // 攻击手指（第三根指针）：左滑迎击，look/move 均不受影响
  attack.dispatch('touchstart', touchEvent([touch(2, 300, 500)]));
  assert.equal(tc.pointerRoles.get(2), 'button:attack');
  assert.equal(tc.lookPointer, 1, '攻击手指不顶替 look');
  assert.equal(tc.movePointer, 0, '攻击手指不顶替 move');
  attack.dispatch('touchmove', touchEvent([touch(2, 280, 500)])); // dx=-20 未到阈值
  assert.equal(parryFires.length, 0);
  attack.dispatch('touchmove', touchEvent([touch(2, 268, 500)])); // dx=-32 迎击
  assert.equal(parryFires.length, 1, '左滑跨阈立即迎击一次');
  assert.equal(parryFires[0].kind, 'parry');
  assert.equal(parryFires[0].pointerId, 2);
  attack.dispatch('touchmove', touchEvent([touch(2, 200, 500)])); // 继续左滑
  attack.dispatch('touchmove', touchEvent([touch(2, 360, 500)])); // 再右滑：闩锁互斥
  assert.equal(parryFires.length, 1, '闩锁：一次按住不重复迎击');
  assert.equal(rollFires.length, 0, '已迎击后右滑不翻滚');
  assert.equal(controller.touchLookActive, true, '攻击手势期间右手 look 始终有效');
  // window touchend 兜底
  handlers.touchend.find((x) => !x.capture).fn(touchEvent([touch(2, 200, 500)]));
  const releaseAttack = actions.findLast((a) => a.action === 'attack' && !a.pressed && a.id === 2);
  assert.ok(releaseAttack, '松手结算攻击');
  assert.equal(releaseAttack.data.fired, 'parry');
  assert.equal(releaseAttack.data.parried, true);
  assert.equal(tc.attackPointers.has(2), false);
  assert.equal(tc.lookPointer, 1, '攻击手指松手不夺走 look 指针');
  assert.equal(controller.touchLookActive, true);

  // 第二根攻击手指：右滑翻滚一次；斜向不触发
  attack.dispatch('touchstart', touchEvent([touch(3, 300, 500)]));
  attack.dispatch('touchmove', touchEvent([touch(3, 260, 460)])); // dx=-40 dy=-40 斜向
  assert.equal(parryFires.length, 1, '斜向（纵向主导）不触发迎击');
  assert.equal(rollFires.length, 0);
  attack.dispatch('touchmove', touchEvent([touch(3, 330, 498)])); // dx=30 水平主导 → 翻滚
  assert.equal(rollFires.length, 1, '右滑跨阈立即翻滚一次');
  assert.equal(rollFires[0].kind, 'roll');
  attack.dispatch('touchmove', touchEvent([touch(3, 400, 500)]));
  assert.equal(rollFires.length, 1, '闩锁：不重复翻滚');
  handlers.touchend.find((x) => !x.capture).fn(touchEvent([touch(3, 400, 500)]));
  const releaseRoll = actions.findLast((a) => a.action === 'attack' && !a.pressed && a.id === 3);
  assert.equal(releaseRoll.data.fired, 'roll');
  assert.equal(releaseRoll.data.rolled, true);

  // 第三根攻击手指：无方向招式，普通松手
  attack.dispatch('touchstart', touchEvent([touch(4, 300, 500)]));
  attack.dispatch('touchmove', touchEvent([touch(4, 305, 560)])); // 纯纵向
  handlers.touchend.find((x) => !x.capture).fn(touchEvent([touch(4, 305, 560)]));
  const releaseTap = actions.findLast((a) => a.action === 'attack' && !a.pressed && a.id === 4);
  assert.equal(releaseTap.data.fired, null, '纵向拖动松手不结算方向招式');

  // 摇杆松开：移动/疾跑复位，look 仍在
  handlers.touchend.find((x) => !x.capture).fn(touchEvent([touch(0, 95, 50)]));
  assert.equal(tc.movePointer, null);
  assert.equal(tc.move.x, 0); assert.equal(tc.move.mag, 0);
  assert.equal(controller.touchSprint, false);
  assert.equal(tc.lookPointer, 1, '摇杆松手不影响 look');
  assert.equal(controller.touchLookActive, true);

  // look 松手：touchLookActive 复位
  handlers.touchend.find((x) => !x.capture).fn(touchEvent([touch(1, 140, 100)]));
  assert.equal(tc.lookPointer, null);
  assert.equal(controller.touchLookActive, false, 'look 手指松手复位 touchLookActive');
  assert.equal(tc.pointerRoles.size, 0);

  // releaseAll：重新按下两根手指后一次清空
  lookZone.dispatch('touchstart', touchEvent([touch(7, 100, 100)]));
  joystick.dispatch('touchstart', touchEvent([touch(8, 95, 50)]));
  assert.equal(controller.touchLookActive, true);
  assert.equal(controller.touchSprint, true);
  tc.releaseAll();
  assert.equal(tc.lookPointer, null);
  assert.equal(tc.movePointer, null);
  assert.equal(controller.touchLookActive, false, 'releaseAll 复位 touchLookActive');
  assert.equal(controller.touchSprint, false, 'releaseAll 复位疾跑');
  assert.equal(tc.move.mag, 0);
  assert.equal(tc.pointerRoles.size, 0);

  console.log('touch pointer roles/gestures/sprint: all assertions passed');
})().catch((e) => { console.error(e); process.exit(1); });
