/**
 * 触屏布局调整：总开关可见性/编辑守卫 + 进出调整自动暂停 的纯逻辑回归，
 * 以及三张常驻 HUD 信息卡（.vitals/.mission/.objective）纳入布局系统的回归：
 * 旧版 buttons/joystick 存档兼容、卡片 _normalize 夹紧、apply 写样式、
 * 设置面板选项、普通关卡目标常驻与触控实玩可见性的静态契约。
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
    this._rect = null; // 设为 {left,top,width,height} 可模拟可测量元素
  }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null; }
  setPointerCapture() {}
  querySelector() { return null; }
  getBoundingClientRect() {
    return this._rect || { left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0 };
  }
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
  // 三张常驻 HUD 信息卡（TouchLayout 通过 document.querySelector 获取）。
  const cards = {
    '.vitals': new FakeEl('hudVitals'),
    '.mission': new FakeEl('hudMission'),
    '.objective': new FakeEl('hudObjective'),
  };
  global.document = {
    documentElement: html,
    body: { classList: bodyClass },
    getElementById: (id) => (Object.prototype.hasOwnProperty.call(ids, id) ? ids[id] : null),
    querySelector: (sel) => (Object.prototype.hasOwnProperty.call(cards, sel) ? cards[sel] : null),
  };
  global.getComputedStyle = () => ({ paddingTop: '0px', paddingRight: '0px', paddingBottom: '0px', paddingLeft: '0px' });
  global.localStorage = storage;
  global.window = global; // touch-layout 只在 window 上 addEventListener
  global.addEventListener = () => {};
  global.innerWidth = 390;
  global.innerHeight = 844;
  return { storage, root, html, bodyClass, makeHooks, cards };
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

  // —— 普通关卡目标常驻（任务 A）——
  const hudSrc = fs.readFileSync(path.join(rootDir, 'src/ui/hud.js'), 'utf8');
  const mainSrc = fs.readFileSync(path.join(rootDir, 'src/main.js'), 'utf8');
  assert.ok(!hudSrc.includes('obj-toggle') && !hudSrc.includes('obj-details'),
    'hud.js 的 campaign objective 不得再依赖 .obj-toggle/.obj-details 展开交互');
  assert.ok(!mainSrc.includes('obj-toggle'), 'main.js 里旧的 .obj-toggle 展开事件必须移除');
  for (const text of ['本关目标', '采食', '伙伴', '回大本营']) {
    assert.ok(hudSrc.includes(text), `campaign objective HTML 必须常驻包含「${text}」`);
  }
  assert.ok(hudSrc.includes('沙盒状态'), '沙盒模式仍显示「沙盒状态」卡');
  assert.ok(!css.includes('.obj-toggle') && !css.includes('.obj-details'),
    'styles.css 中 .obj-toggle/.obj-details 样式必须清理');

  // —— HUD 卡片可调整 + 触控实玩可见（任务 B/C）——
  assert.ok(css.includes('.vitals, .mission, .objective { pointer-events: none; }'),
    '非编辑态三张 HUD 卡必须 pointer-events:none，不能挡视角/按键');
  assert.ok(/body\.touch-layout-editing \.vitals,[\s\S]*?\.objective \{[^}]*pointer-events:\s*auto/.test(css),
    '编辑态下三张 HUD 卡必须 pointer-events:auto 以支持点选/拖动');
  assert.ok(css.includes('body.touch-layout-editing .objective.layout-selected'),
    '编辑态 HUD 卡必须有选中描边样式');
  assert.ok(/body\.touch-playing \.hud-right \{[^}]*display:\s*block/.test(css),
    '触控实玩（body.touch-playing）时目标卡 .hud-right 必须可见');
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

  // 6) HUD 卡片：默认布局三张卡齐全；apply() 写出 left/top/scale/opacity
  const layout3 = new TouchLayout();
  for (const id of ['hudVitals', 'hudMission', 'hudObjective']) {
    const c = layout3.layout.cards[id];
    assert.ok(c, `默认布局必须包含卡片 ${id}`);
    assert.ok(c.x >= 0 && c.x <= 1 && c.y >= 0 && c.y <= 1, `${id} 默认中心点必须归一化在 0-1`);
    assert.equal(c.scale, 1);
    assert.equal(c.opacity, 1);
  }
  layout3.apply();
  for (const [sel, id] of [['.vitals', 'hudVitals'], ['.mission', 'hudMission'], ['.objective', 'hudObjective']]) {
    const el = shim.cards[sel];
    assert.ok(String(el.style.left).endsWith('px'), `${id} apply 后必须写 left`);
    assert.ok(String(el.style.top).endsWith('px'), `${id} apply 后必须写 top`);
    assert.ok(String(el.style.transform).includes('scale('), `${id} apply 后必须写 transform scale`);
    assert.notEqual(el.style.opacity, '', `${id} apply 后必须写 opacity`);
    assert.equal(el.style.position, 'fixed', `${id} apply 后必须 fixed 定位`);
  }

  // 7) 卡片 _normalize 夹紧：中心点 0-1，scale 0.75-1.25，opacity 0.35-1
  const n = layout3._normalize({
    cards: {
      hudVitals: { x: 5, y: -3, scale: 9, opacity: 0.01 },
      hudMission: { x: 0.4, y: 0.6, scale: 0.5, opacity: 2 },
    },
  });
  assert.equal(n.cards.hudVitals.x, 1);
  assert.equal(n.cards.hudVitals.y, 0);
  assert.equal(n.cards.hudVitals.scale, 1.25);
  assert.equal(n.cards.hudVitals.opacity, 0.35);
  assert.equal(n.cards.hudMission.x, 0.4);
  assert.equal(n.cards.hudMission.scale, 0.75);
  assert.equal(n.cards.hudMission.opacity, 1);
  assert.ok(n.cards.hudObjective, '缺字段的卡片必须补默认布局');

  // 8) 旧版存档（只有 buttons/joystick，无 cards）：不报错、不覆盖动作按钮布局
  shim.storage.setItem('marmot.touch-layout.v1', JSON.stringify({
    scale: 1.1,
    opacity: 0.9,
    buttons: { attack: { x: 0.5, y: 0.52, scale: 1.2, opacity: 0.8, coreSize: 0.6, coreOpacity: 0.9 } },
    joystick: { sprintThreshold: 0.8 },
  }));
  const legacy = new TouchLayout();
  assert.equal(legacy.layout.buttons.attack.x, 0.5, '旧存档的攻击键位置必须保留');
  assert.equal(legacy.layout.buttons.attack.scale, 1.2, '旧存档的攻击键大小必须保留');
  assert.equal(legacy.layout.scale, 1.1, '旧存档的整体大小必须保留');
  assert.equal(legacy.layout.joystick.sprintThreshold, 0.8, '旧存档的疾跑阈值必须保留');
  for (const id of ['hudVitals', 'hudMission', 'hudObjective']) {
    const c = legacy.layout.cards[id];
    assert.ok(c, `旧存档缺 cards 时 ${id} 必须落到默认布局`);
    assert.equal(c.scale, 1);
    assert.equal(c.opacity, 1);
    assert.ok(c.x >= 0 && c.x <= 1 && c.y >= 0 && c.y <= 1);
  }
  shim.storage.removeItem('marmot.touch-layout.v1');

  // 9) 设置面板包含三张卡选项，且整体大小/透明度文案限定于动作按钮
  const markup = layout3.settingsMarkup();
  for (const id of ['hudVitals', 'hudMission', 'hudObjective']) {
    assert.ok(markup.includes(`value="${id}"`), `设置面板单个控件选择器必须包含 ${id}`);
  }
  assert.ok(markup.includes('HUD 卡片'), '设置面板必须有 HUD 卡片分组');
  assert.ok(markup.includes('只作用于动作按钮'), '整体大小/透明度必须明确只作用于动作按钮');

  // 10) 卡片可被选中（编辑态点选）
  layout3.setSelected('hudObjective');
  assert.equal(layout3.selected, 'hudObjective');
  layout3.setSelected('attack');

  // 11) refreshCardDefaults：未拖动的卡跟随新的 CSS 设计位置；存档里的卡位置不被覆盖
  const fresh = new TouchLayout();
  shim.cards['.objective']._rect = { left: 100, top: 40, width: 120, height: 60, right: 220, bottom: 100 };
  fresh.refreshCardDefaults();
  assert.ok(Math.abs(fresh.layout.cards.hudObjective.x - 160 / 390) < 1e-9,
    '未拖动的卡 refresh 后必须跟随新的 CSS 设计中心 x');
  assert.ok(Math.abs(fresh.layout.cards.hudObjective.y - 70 / 844) < 1e-9,
    '未拖动的卡 refresh 后必须跟随新的 CSS 设计中心 y');
  // 用户拖动过的卡：refresh 不得改位置
  fresh._cardPosTouched.hudObjective = true;
  shim.cards['.objective']._rect = { left: 300, top: 300, width: 120, height: 60, right: 420, bottom: 360 };
  const keptX = fresh.layout.cards.hudObjective.x;
  fresh.refreshCardDefaults();
  assert.equal(fresh.layout.cards.hudObjective.x, keptX, '用户拖动过的卡位置不得被 refresh 覆盖');
  // 存档里带 cards 位置 = 用户方案：新会话 refresh 同样不得覆盖
  shim.storage.setItem('marmot.touch-layout.v1', JSON.stringify({
    cards: { hudObjective: { x: 0.2, y: 0.3, scale: 1, opacity: 1 } },
  }));
  const stored = new TouchLayout();
  stored.refreshCardDefaults();
  assert.equal(stored.layout.cards.hudObjective.x, 0.2, '已保存的卡片位置必须继续生效');
  assert.equal(stored.layout.cards.hudObjective.y, 0.3);
  shim.storage.removeItem('marmot.touch-layout.v1');
  shim.cards['.objective']._rect = null;

  console.log('touch layout adjust gate + auto-pause + HUD cards: all assertions passed');
})().catch((err) => { console.error(err); process.exitCode = 1; });
