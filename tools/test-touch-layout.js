/**
 * 触屏布局调整：总开关可见性/编辑守卫 + 进出调整自动暂停 的纯逻辑回归。
 * 不依赖浏览器：用最小 DOM shim 载入 src/ui/touch-layout.js（ESM）。
 * 运行：node tools/test-touch-layout.js
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '..');

/* ---------------- 最小 DOM / 存储 shim ---------------- */
class ClassList {
  constructor() { this.set = new Set(); }
  toggle(name, force) {
    const on = force === undefined ? !this.set.has(name) : !!force;
    this.set[on ? 'add' : 'delete'](name);
    return on;
  }
  add(n) { this.set.add(n); }
  remove(n) { this.set.delete(n); }
  contains(n) { return this.set.has(n); }
}
class FakeEl {
  constructor(id) {
    this.id = id || '';
    this.style = { setProperty() {}, opacity: '' };
    this.classList = new ClassList();
    this.listeners = {};
    this.attrs = {};
    this.textContent = '';
    this.hidden = false;
    this.offsetWidth = 112;
    this.offsetHeight = 112;
  }
  getBoundingClientRect() { return { left: 0, top: 0, width: this.offsetWidth, height: this.offsetHeight }; }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null; }
  setPointerCapture() {}
  querySelector() { return null; }
}

function installDomShim() {
  const store = new Map();
  const storage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    _store: store,
  };
  const root = new FakeEl('touchControls');
  const actionLayer = new FakeEl('touchActions');
  const buttons = {};
  const makeHooks = () => ({ pause: 0, resume: 0, paused: false });
  for (const id of ['attack', 'dodge', 'jump', 'interact', 'burst', 'ultimate']) buttons[id] = new FakeEl('btn-' + id);
  const pauseBtn = new FakeEl('btn-pause');
  const joystick = new FakeEl('touchJoystick');
  const entry = new FakeEl('touchLayoutEntry');
  const probe = new FakeEl('touchSafeInsets');
  const html = new FakeEl('html');
  const bodyClass = new ClassList();
  root.querySelector = (sel) => {
    if (sel === '.touch-actions') return actionLayer;
    const m = sel.match(/data-touch-action="(\w+)"/);
    if (!m) return null;
    return m[1] === 'pause' ? pauseBtn : buttons[m[1]] || null;
  };
  actionLayer.querySelector = (sel) => {
    const m = sel.match(/data-touch-action="(\w+)"/);
    return m ? buttons[m[1]] || null : null;
  };
  const testModeBtn = new FakeEl('testModeBtn');
  const ids = { touchControls: root, touchLayoutEntry: entry, touchSafeInsets: probe, touchJoystick: joystick, testModeBtn };
  global.document = {
    documentElement: html,
    body: { classList: bodyClass },
    getElementById: (id) => (Object.prototype.hasOwnProperty.call(ids, id) ? ids[id] : null),
  };
  global.getComputedStyle = () => ({ paddingTop: '0px', paddingRight: '0px', paddingBottom: '0px', paddingLeft: '0px' });
  global.localStorage = storage;
  global.window = global; // touch-layout 只在 window 上 addEventListener
  global.addEventListener = () => {};
  global.innerWidth = 390;
  global.innerHeight = 844;
  return { storage, root, html, bodyClass, makeHooks, joystick };
}

/* ---------------- 静态资源检查（任务 A/B） ---------------- */
function staticChecks() {
  const html = fs.readFileSync(path.join(rootDir, 'index.html'), 'utf8');
  const css = fs.readFileSync(path.join(rootDir, 'styles.css'), 'utf8');
  const dodgeCount = (html.match(/data-touch-action="dodge"/g) || []).length;
  assert.equal(dodgeCount, 1, 'index.html 中只能保留右侧大翻滚键一个 data-touch-action="dodge"');
  assert.ok(!html.includes('stick-dodge'), '摇杆上的 .stick-dodge 按钮必须从 index.html 删除');
  assert.ok(!css.includes('.stick-dodge'), 'styles.css 中的 .stick-dodge 样式必须整段删除');
  assert.ok(html.includes('<html lang="zh-CN" data-touch-adjust-enabled="false">'),
    '<html> 默认 data-touch-adjust-enabled="false"，防首屏闪现调整键');
  assert.ok(html.includes('data-touch-adjust="entry"'), '#touchLayoutEntry 必须带 data-touch-adjust 标记');
  assert.ok(css.includes('[data-touch-adjust-enabled="false"] [data-touch-adjust]'),
    'styles.css 必须用属性选择器在开关关闭时隐藏调整键');
  assert.ok(css.includes('body.touch-layout-editing #overlay'),
    '调整态下必须隐藏会遮挡拖动的暂停面板');

  // 任务静态契约：摇杆位置/大小/内圈 + 沙盒按钮可调 + TouchControls 数值同步。
  const controls = fs.readFileSync(path.join(rootDir, 'src/core/touch-controls.js'), 'utf8');
  const layout = fs.readFileSync(path.join(rootDir, 'src/ui/touch-layout.js'), 'utf8');
  const main = fs.readFileSync(path.join(rootDir, 'src/main.js'), 'utf8');
  assert.ok(html.includes('id="touchJoystick"'), 'index.html 必须保留 #touchJoystick 摇杆');
  assert.ok(layout.includes("getElementById('touchJoystick')"), 'touch-layout 必须接管 #touchJoystick 布局');
  assert.ok(layout.includes("id=\"layoutJoystickScale\""), '设置面板必须包含摇杆整体大小滑块');
  assert.ok(layout.includes('layoutSprintThreshold'), '设置面板必须包含摇杆内圈（疾跑触发范围）滑块');
  assert.ok(layout.includes("value=\"sandboxControl\"") || layout.includes('SANDBOX_CONTROL'),
    '设置面板必须包含沙盒控制选项');
  assert.ok(controls.includes('setSprintThreshold'), 'TouchControls 必须导出 setSprintThreshold');
  assert.ok(controls.includes('setJoystickScale'), 'TouchControls 必须实现 setJoystickScale（摇杆缩放坐标换算）');
  assert.ok(controls.includes('this.joystickScale || 1'), '推杆计算必须用 joystickScale 做 client→local 换算');
  // 手指正在推杆时改阈值必须立刻重算疾跑状态（不等下一帧移动）。
  const sprintFn = controls.slice(controls.indexOf('setSprintThreshold(v)'));
  assert.ok(sprintFn.indexOf('movePointer') < sprintFn.indexOf('_applySprintRing() {'),
    'setSprintThreshold 必须在手指按住期间即时重算 touchSprint');
  assert.ok(controls.includes('stick-sprint-radius'), '疾跑内圈可视环必须由 TouchControls 写 CSS 变量同步');
  assert.ok(main.includes('touchLayout.onJoystickScale'), 'main.js 必须把摇杆缩放回调接到 TouchControls');
  assert.ok(main.includes('setJoystickScale(touchLayout.layout.joystick.scale)'),
    'main.js 启动时必须用持久化的摇杆缩放初始化 TouchControls');
  assert.ok(main.includes('setSprintThreshold(touchLayout.layout.joystick.sprintThreshold)'),
    'main.js 启动时必须用持久化的疾跑内圈阈值初始化 TouchControls');
  assert.ok(css.includes('.layout-editing .touch-joystick'), '编辑态摇杆必须有可拖动的视觉提示');
}

(async () => {
  staticChecks();
  const shim = installDomShim();
  const { TouchLayout, touchAdjustEnabled, setTouchAdjustStored } =
    await import('../src/ui/touch-layout.js');

  // 1) 默认：localStorage 无开关 → 拒绝进入编辑，不碰暂停钩子，属性 false
  assert.equal(touchAdjustEnabled(), false, '无 localStorage 记录时开关默认 OFF');
  const layout = new TouchLayout();
  assert.equal(layout.adjustEnabled, false);
  assert.equal(shim.html.getAttribute('data-touch-adjust-enabled'), 'false');
  const hooks1 = shim.makeHooks();
  layout.setPauseHooks({
    pause: () => { hooks1.pause++; },
    resume: () => { hooks1.resume++; },
    isPaused: () => hooks1.paused,
  });
  layout.setEditing(true);
  assert.equal(layout.editing, false, '开关 OFF 时 setEditing(true) 必须立即被拒绝回 false');
  layout.setEditing(); // 无参 toggle 同样被拒绝
  assert.equal(layout.editing, false);
  assert.equal(hooks1.pause, 0, '拒绝进入编辑时不得暂停游戏');
  assert.equal(hooks1.resume, 0);
  assert.ok(!shim.bodyClass.contains('touch-layout-editing'));
  assert.ok(layout.settingsMarkup().includes('data-touch-adjust="actions"'),
    '设置里的 layout-actions 按钮组必须带 data-touch-adjust 标记');

  // 2) 打开开关：可进入编辑 → 自动暂停；退出 → 自动恢复
  layout.setAdjustEnabled(true);
  assert.equal(touchAdjustEnabled(), true);
  assert.equal(shim.storage.getItem('marmot.settings.touchLayoutAdjust'), '1', '开关必须持久化到 localStorage');
  assert.equal(shim.html.getAttribute('data-touch-adjust-enabled'), 'true');
  layout.setEditing(true);
  assert.equal(layout.editing, true);
  assert.equal(hooks1.pause, 1, '进入调整时必须自动暂停');
  assert.equal(hooks1.resume, 0);
  assert.ok(shim.bodyClass.contains('touch-layout-editing'));
  layout.setEditing(false);
  assert.equal(layout.editing, false);
  assert.equal(hooks1.resume, 1, '退出调整时必须自动恢复');
  assert.equal(hooks1.pause, 1, '恢复时不得重复调 pause');
  assert.ok(!shim.bodyClass.contains('touch-layout-editing'));

  // 3) 调整前游戏已暂停：进入调整不重复暂停，退出保持暂停
  const layout2 = new TouchLayout();
  const hooks2 = shim.makeHooks(); hooks2.paused = true;
  layout2.setPauseHooks({
    pause: () => { hooks2.pause++; },
    resume: () => { hooks2.resume++; },
    isPaused: () => hooks2.paused,
  });
  layout2.setAdjustEnabled(true);
  layout2.setEditing(true);
  assert.equal(layout2.editing, true);
  assert.equal(hooks2.pause, 0, '已暂停时进入调整不得重复暂停');
  layout2.setEditing(false);
  assert.equal(hooks2.resume, 0, '调整前已暂停，退出调整必须保持暂停');

  // 4) 编辑中关掉总开关：强制退出编辑并恢复游戏
  layout.setEditing(true);
  assert.equal(layout.editing, true);
  layout.setAdjustEnabled(false);
  assert.equal(layout.editing, false, '关闭总开关必须立即退出编辑');
  assert.equal(hooks1.resume, 2, '关开关导致的退出也必须恢复自动暂停');
  assert.equal(shim.html.getAttribute('data-touch-adjust-enabled'), 'false');
  assert.equal(shim.storage.getItem('marmot.settings.touchLayoutAdjust'), '0');

  // 5) 导出的持久化辅助函数独立可用
  setTouchAdjustStored(true);
  assert.equal(touchAdjustEnabled(), true);
  setTouchAdjustStored(false);
  assert.equal(touchAdjustEnabled(), false);

  /* ---------- 摇杆位置/大小/内圈 + 沙盒按钮布局 ---------- */
  const fresh = new TouchLayout();
  // 6) 默认布局：沙盒按钮与摇杆字段齐全且取值合法
  const def = fresh.layout;
  assert.ok(def.buttons.sandboxControl, '默认布局必须包含沙盒控制按钮');
  for (const k of ['x', 'y', 'scale']) assert.ok(Number.isFinite(def.buttons.sandboxControl[k]), `sandboxControl.${k} 必须是数值`);
  assert.ok(Number.isFinite(def.joystick.x) && Number.isFinite(def.joystick.y), '摇杆默认必须有归一化位置');
  assert.equal(def.joystick.scale, 1, '摇杆默认整体大小为 1');
  assert.equal(def.joystick.sprintThreshold, 0.78, '摇杆内圈默认疾跑阈值 0.78');
  // 摇杆默认在左下安全区内（中心点，基准 112px @390 宽 → 半径 56+4 夹紧）
  assert.ok(def.joystick.x > 0 && def.joystick.x < 0.5 && def.joystick.y > 0.5 && def.joystick.y < 1,
    '摇杆默认位置应在左下象限');

  // 7) 设置面板标记包含三类控件与全部滑块
  const markup = fresh.settingsMarkup();
  for (const needle of ['value="sandboxControl"', 'value="joystick"', 'id="layoutJoystickScale"', 'id="layoutSprintThreshold"', 'id="layoutButtonScale"', 'id="layoutButtonOpacity"']) {
    assert.ok(markup.includes(needle), `设置面板缺少 ${needle}`);
  }

  // 8) 摇杆位置/大小/内圈阈值持久化：保存后新实例读回
  fresh.layout.joystick.x = 0.3; fresh.layout.joystick.y = 0.6;
  fresh.layout.joystick.scale = 1.2; fresh.layout.joystick.sprintThreshold = 0.66;
  fresh.layout.buttons.sandboxControl.x = 0.5; fresh.layout.buttons.sandboxControl.scale = 1.1;
  fresh.save();
  const reloaded = new TouchLayout();
  assert.equal(reloaded.layout.joystick.x, 0.3, '摇杆 x 必须持久化');
  assert.equal(reloaded.layout.joystick.y, 0.6, '摇杆 y 必须持久化');
  assert.equal(reloaded.layout.joystick.scale, 1.2, '摇杆整体大小必须持久化');
  assert.equal(reloaded.layout.joystick.sprintThreshold, 0.66, '摇杆内圈阈值必须持久化');
  assert.equal(reloaded.layout.buttons.sandboxControl.x, 0.5, '沙盒按钮位置必须持久化');
  assert.equal(reloaded.layout.buttons.sandboxControl.scale, 1.1, '沙盒按钮大小必须持久化');

  // 9) 越界数据 clamp：旧/脏 localStorage 不得炸也不得超界
  shim.storage.setItem('marmot.touch-layout.v1', JSON.stringify({
    scale: 99, opacity: 0.01,
    buttons: { attack: { x: 5, y: -2, scale: 99, opacity: 0.01 }, sandboxControl: { x: -1, y: 7, scale: 0.01, opacity: 99 } },
    joystick: { x: 9, y: -9, scale: 99, sprintThreshold: 0.01 },
  }));
  const dirty = new TouchLayout();
  assert.equal(dirty.layout.scale, 1.5); assert.equal(dirty.layout.opacity, 0.3);
  assert.equal(dirty.layout.buttons.attack.x, 1); assert.equal(dirty.layout.buttons.attack.y, 0);
  assert.equal(dirty.layout.buttons.attack.scale, 1.5); assert.equal(dirty.layout.buttons.attack.opacity, 0.3);
  assert.equal(dirty.layout.buttons.sandboxControl.x, 0); assert.equal(dirty.layout.buttons.sandboxControl.y, 1);
  assert.equal(dirty.layout.buttons.sandboxControl.scale, 0.65); assert.equal(dirty.layout.buttons.sandboxControl.opacity, 1);
  assert.equal(dirty.layout.joystick.x, 1); assert.equal(dirty.layout.joystick.y, 0);
  assert.equal(dirty.layout.joystick.scale, 1.4, '摇杆大小 clamp 到 1.4');
  assert.equal(dirty.layout.joystick.sprintThreshold, 0.55, '内圈阈值 clamp 到 0.55');

  // 10) 旧数据兼容：rev7 之前的存档只有 sprintThreshold / 甚至没有 joystick 字段 → 补默认不重置按钮
  shim.storage.setItem('marmot.touch-layout.v1', JSON.stringify({
    scale: 1.1, opacity: 0.9,
    buttons: { attack: { x: 0.77, y: 0.66, scale: 1.2, opacity: 0.8, coreSize: 0.6, coreOpacity: 0.9 } },
    joystick: { sprintThreshold: 0.85 },
  }));
  const legacy = new TouchLayout();
  assert.equal(legacy.layout.joystick.sprintThreshold, 0.85, '旧存档的疾跑阈值必须保留');
  assert.equal(legacy.layout.joystick.scale, 1, '旧存档缺摇杆大小时补默认 1');
  assert.ok(Number.isFinite(legacy.layout.joystick.x), '旧存档缺摇杆位置时补默认');
  assert.equal(legacy.layout.buttons.attack.x, 0.77, '旧存档按钮位置必须保留');
  assert.equal(legacy.layout.buttons.attack.coreSize, 0.6, '旧存档攻击键内圈必须保留');
  assert.ok(legacy.layout.buttons.sandboxControl, '旧存档缺沙盒按钮时补默认');
  shim.storage.setItem('marmot.touch-layout.v1', JSON.stringify({ buttons: { dodge: { x: 0.6, y: 0.7, scale: 1, opacity: 1 } } }));
  const ancient = new TouchLayout();
  assert.equal(ancient.layout.joystick.sprintThreshold, 0.78, '无 joystick 字段的旧存档补默认阈值');
  assert.equal(ancient.layout.buttons.dodge.x, 0.6, '无 joystick 字段的旧存档按钮必须保留');

  // 11) resize / 安全区夹紧：摇杆与沙盒按钮都被拉回可视区
  shim.storage.removeItem('marmot.touch-layout.v1');
  const clamped = new TouchLayout();
  clamped.layout.joystick.x = 0.999; clamped.layout.joystick.y = 0.001;
  clamped.layout.buttons.sandboxControl.x = 0.999; clamped.layout.buttons.sandboxControl.y = 0.999;
  global.innerWidth = 390; global.innerHeight = 844;
  clamped.apply(); // 模拟 resize 后的 apply（无安全区）
  // 390 宽 → 摇杆基准 112，半径 56+4=60：x∈[60,330], y∈[60,784]
  assert.equal(shim.joystick.style.left, '330px', '摇杆右边缘必须夹紧在可视区内');
  assert.equal(shim.joystick.style.top, '60px', '摇杆上边缘必须夹紧在可视区内');
  // 沙盒按钮 56px → 半径 28+4=32：x∈[32,358], y∈[32,812]
  const sb = clamped.buttons.sandboxControl;
  assert.equal(sb.style.left, '358px', '沙盒按钮右边缘必须夹紧在可视区内');
  assert.equal(sb.style.top, '812px', '沙盒按钮下边缘必须夹紧在可视区内');
  // 有安全区（刘海 20px / 底部 30px）时夹紧范围进一步内缩
  const oldGcs = global.getComputedStyle;
  global.getComputedStyle = () => ({ paddingTop: '0px', paddingRight: '0px', paddingBottom: '30px', paddingLeft: '20px' });
  clamped.layout.joystick.x = 0; clamped.layout.joystick.y = 1;
  clamped.apply();
  assert.equal(shim.joystick.style.left, '80px', '安全区左边距必须参与摇杆夹紧');
  assert.equal(shim.joystick.style.top, '754px', '安全区底边距必须参与摇杆夹紧');
  global.getComputedStyle = oldGcs;

  // 12) 摇杆缩放回调（onJoystickScale 契约）：apply 即同步，供 TouchControls 换算
  let syncedScale = null;
  clamped.onJoystickScale = (v) => { syncedScale = v; };
  clamped.layout.joystick.scale = 1.3; clamped.apply();
  assert.equal(syncedScale, 1.3, '摇杆大小变化必须经 onJoystickScale 即时同步');
  assert.ok(String(clamped.joystickEl?.style.transform || shim.joystick.style.transform).includes('scale(1.3)'),
    '摇杆元素 transform 必须包含 scale(1.3)');

  // 13) 编辑态拖动摇杆：选中 joystick、位置更新并夹紧；非编辑态完全不动
  global.innerWidth = 390; global.innerHeight = 844;
  delete shim.joystick.__touchLayoutBound; // shim 复用同一元素：解除上一实例的幂等标记，让本实例重新绑定
  const drag = new TouchLayout();
  drag.setAdjustEnabled(true);
  const before = { x: drag.layout.joystick.x, y: drag.layout.joystick.y };
  const fire = (type, x, y) => {
    const ev = { changedTouches: [{ identifier: 7, clientX: x, clientY: y }], preventDefault() {}, stopImmediatePropagation() {} };
    for (const fn of shim.joystick.listeners[type] || []) fn(ev);
  };
  fire('touchstart', 100, 700); fire('touchmove', 140, 660); // 非编辑态：忽略
  assert.equal(drag.layout.joystick.x, before.x, '非编辑态摇杆不得响应拖动');
  drag.setEditing(true);
  fire('touchstart', 100, 700); fire('touchmove', 140, 660);
  assert.equal(drag.selected, 'joystick', '编辑态按下摇杆必须选中 joystick');
  // 起点 (100,700)，rect 中心 (56,56) → 偏移 (44,644)；移动到 (140,660) → 中心 (96,16) → y 夹紧到 60
  assert.ok(Math.abs(drag.layout.joystick.x - 96 / 390) < 1e-9, '拖动后摇杆 x 必须跟随手指');
  assert.equal(shim.joystick.style.top, '60px', '拖动越界时必须夹紧到可视区');
  fire('touchend', 140, 660);
  assert.ok(!shim.joystick.classList.contains('layout-dragging'), 'touchend 后必须退出拖动态');
  drag.setEditing(false);

  console.log('touch layout adjust gate + auto-pause: all assertions passed');
})().catch((err) => { console.error(err); process.exitCode = 1; });
