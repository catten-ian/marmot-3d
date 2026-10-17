/* 摇杆“疾跑触发范围”（用户所说的移动轮盘内圈大小）：
 * 默认值、clamp、持久化到 marmot.touch-layout.v1、阈值两侧 sprint 判定、
 * 可视档位环半径与归一化行程一致。纯 Node + DOM 桩。 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

class ClassList {
  constructor() { this.s = new Set(); }
  add(c) { this.s.add(c); } remove(c) { this.s.delete(c); } toggle(c, f) { const on = f === undefined ? !this.s.has(c) : !!f; on ? this.s.add(c) : this.s.delete(c); return on; }
  contains(c) { return this.s.has(c); }
}
class El {
  constructor(id) { this.id = id || ''; this.style = { _m: {}, setProperty(k, v) { this._m[k] = v; } }; this.classList = new ClassList(); this.listeners = []; this.children = []; this.attrs = {}; }
  addEventListener(type, fn) { this.listeners.push({ type, fn }); }
  appendChild(c) { this.children.push(c); return c; }
  _walk(out = []) { for (const c of this.children) { out.push(c); c._walk(out); } return out; }
  _match(sel) {
    const mHas = sel.match(/^\[([\w-]+)\]$/);
    if (mHas) return Object.prototype.hasOwnProperty.call(this.attrs, mHas[1]);
    const m = sel.match(/^\[([\w-]+)="?([^"\]]+)"?\]$/);
    if (m) return this.attrs[m[1]] === m[2];
    if (sel === '.touch-actions') return this.attrs.class === 'touch-actions';
    return false;
  }
  querySelector(sel) { return this._walk().find((e) => e._match(sel)) || null; }
  querySelectorAll() { return []; }
  getBoundingClientRect() { return { left: 0, top: 0, width: 100, height: 100 }; }
  setPointerCapture() {}
  setAttribute() {}
  getAttribute() { return null; }
}

(async () => {
  const store = new Map();
  const root = new El('touchControls');
  const layer = new El(); layer.attrs.class = 'touch-actions';
  root.appendChild(layer);
  for (const id of ['attack', 'dodge', 'jump', 'interact', 'burst', 'ultimate']) {
    const b = new El(); b.attrs = { 'data-touch-action': id }; layer.appendChild(b);
  }
  const pause = new El(); pause.attrs = { 'data-touch-action': 'pause' }; root.appendChild(pause);
  const ids = {
    touchControls: root,
    touchSafeInsets: new El('touchSafeInsets'),
    touchLayoutEntry: new El('touchLayoutEntry'),
    setBody: new El('setBody'),
    testModeBtn: new El('testModeBtn'),
  };
  globalThis.innerWidth = 390; globalThis.innerHeight = 844;
  globalThis.window = { _h: {}, addEventListener(type, fn) { (this._h[type] ||= []).push(fn); } };
const dispatchWindow = (type, ev) => globalThis.window._h[type]?.forEach((fn) => fn(ev));
  globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
  globalThis.getComputedStyle = () => ({ paddingTop: '0px', paddingRight: '0px', paddingBottom: '0px', paddingLeft: '0px' });
  globalThis.document = {
    documentElement: { setAttribute() {} },
    getElementById: (id) => ids[id] || null,
    body: { classList: new ClassList() },
    addEventListener() {},
  };

  const { TouchLayout } = await import('../src/ui/touch-layout.js?bust=' + Date.now());
  const { SPRINT_STICK_THRESHOLD, SPRINT_THRESHOLD_MIN, SPRINT_THRESHOLD_MAX, clampSprintThreshold } =
    await import('../src/core/touch-settings.mjs');

  // 常量口径：建议范围 0.55-0.95，默认约 0.78。
  assert.equal(SPRINT_STICK_THRESHOLD, 0.78);
  assert.equal(SPRINT_THRESHOLD_MIN, 0.55);
  assert.equal(SPRINT_THRESHOLD_MAX, 0.95);

  // 默认值
  const layout = new TouchLayout();
  assert.equal(layout.layout.joystick.sprintThreshold, 0.78);
  assert.equal(layout.defaultLayout().joystick.sprintThreshold, 0.78);

  // clamp 纯函数
  assert.equal(clampSprintThreshold(0.1), 0.55);
  assert.equal(clampSprintThreshold(2), 0.95);
  assert.equal(clampSprintThreshold(0.6), 0.6);
  assert.equal(clampSprintThreshold('banana'), 0.78);
  assert.equal(clampSprintThreshold(undefined, 0.7), 0.7);

  // 旧布局缺字段 → 默认；坏值 → clamp；正常自定义 → 保留
  function loadWith(joystick) {
    store.clear();
    store.set('marmot.touch-layout.v1', JSON.stringify({ buttons: { attack: { x: 0.6, y: 0.6 } } }, joystick ? { joystick } : {}));
    // JSON 合并需要手工构造：
    const data = { buttons: { attack: { x: 0.6, y: 0.6 } } };
    if (joystick) data.joystick = joystick;
    store.set('marmot.touch-layout.v1', JSON.stringify(data));
    return new TouchLayout();
  }
  assert.equal(loadWith(null).layout.joystick.sprintThreshold, 0.78, '缺字段补默认');
  assert.equal(loadWith({ coreSize: 0.9, coreOpacity: 0.4 }).layout.joystick.sprintThreshold, 0.78, '旧装饰字段被忽略');
  assert.equal(loadWith({ sprintThreshold: 0.9 }).layout.joystick.sprintThreshold, 0.9, '自定义值保留');
  assert.equal(loadWith({ sprintThreshold: 2 }).layout.joystick.sprintThreshold, 0.95, '超上限 clamp');
  assert.equal(loadWith({ sprintThreshold: 0.1 }).layout.joystick.sprintThreshold, 0.55, '超下限 clamp');

  // 持久化：save() 写真实阈值；restoreDefault() 复位并通知触控层。
  const seen = [];
  layout.onSprintThreshold = (v) => seen.push(v);
  layout.layout.joystick.sprintThreshold = 0.88;
  layout.save();
  const saved = JSON.parse(store.get('marmot.touch-layout.v1'));
  assert.equal(saved.joystick.sprintThreshold, 0.88, '阈值持久化到既有布局数据');
  assert.ok(!('coreSize' in saved.joystick), '不再持久化装饰内圈字段');
  layout.restoreDefault();
  assert.equal(layout.layout.joystick.sprintThreshold, 0.78, '恢复默认同时恢复阈值');
  assert.deepEqual(seen, [0.78], '恢复默认通知触控层');
  assert.equal(JSON.parse(store.get('marmot.touch-layout.v1')).joystick.sprintThreshold, 0.78);

  // —— 阈值两侧的 sprint 判定 + 档位环 px 与归一化行程一致 ——
  globalThis.navigator = { maxTouchPoints: 5 };
  globalThis.TouchEvent = function () {};
  globalThis.window.ontouchstart = null;
  const { TouchControls } = await import('../src/core/touch-controls.js');
  class El2 extends El {
    constructor() { super(); this.listeners = []; }
    addEventListener(type, fn, opts) { this.listeners.push({ type, fn }); }
    dispatch(type, ev) { for (const l of this.listeners.filter((x) => x.type === type)) l.fn(ev); }
  }
  const lookZone = new El2();
  const joystickEl = new El2();
  const stick = new El2();
  const controller = { yaw: 0, pitch: 0, touchLookSensitivity: 0.006, touchSprint: false, touchLookActive: false };
  const tc = new TouchControls({
    canvas: {}, controller, root, lookZone, joystick: joystickEl, stick,
    isActive: () => true, onAction() {}, onParryGesture() {}, onRollGesture() {},
  });
  const touchEvent = (x) => ({ changedTouches: [{ identifier: 0, clientX: x, clientY: 50 }], preventDefault() {}, stopPropagation() {} });
  // maxStick=48：推杆 dx=34 → mag 34/48≈0.708；dx=40 → 0.833。
  function push(dx) { joystickEl.dispatch('touchstart', touchEvent(50 + dx)); }
  function lift(dx) { dispatchWindow('touchend', touchEvent(50 + dx)); }
  tc.setSprintThreshold(0.78);
  assert.equal(joystickEl.style._m['--stick-sprint-radius'], '37.44px', '默认环半径 0.78×48=37.44px');
  push(34);
  assert.equal(controller.touchSprint, false, '0.708 < 0.78 不疾跑');
  lift(34);
  push(40);
  assert.equal(controller.touchSprint, true, '0.833 ≥ 0.78 疾跑');
  lift(40);
  // 阈值 0.55：同一 0.708 行程变为疾跑；环半径同步。
  tc.setSprintThreshold(0.55);
  assert.equal(joystickEl.style._m['--stick-sprint-radius'], '26.40px', '环半径随阈值 0.55×48');
  push(34);
  assert.equal(controller.touchSprint, true, '阈值降低后 0.708 即疾跑');
  lift(34);

  // CSS 默认 fallback 与公式一致（0.78×48=37.44px）。
  const css = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');
  assert.ok(css.includes('--stick-sprint-radius: 37.44px'), 'styles.css 档位环 fallback 与默认阈值一致');
  assert.ok(!css.includes('.stick-core'), '装饰 .stick-core 样式已删除');

  console.log('sprint threshold: all assertions passed');
})().catch((e) => { console.error(e); process.exit(1); });
