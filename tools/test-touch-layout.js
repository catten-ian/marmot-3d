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
  }
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
  const ids = { touchControls: root, touchLayoutEntry: entry, touchSafeInsets: probe };
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
  return { storage, root, html, bodyClass, makeHooks };
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

  console.log('touch layout adjust gate + auto-pause: all assertions passed');
})().catch((err) => { console.error(err); process.exitCode = 1; });
