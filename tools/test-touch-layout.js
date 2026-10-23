/**
 * 触屏布局调整：总开关可见性/编辑守卫 + 进出调整自动暂停 的纯逻辑回归，
 * 以及常驻 HUD 信息卡（.vitals/.mission/.objective）纳入布局系统的回归：
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
    this.offsetWidth = 112;
    this.offsetHeight = 112;
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
  const joystick = new FakeEl('touchJoystick');
  const testModeBtn = new FakeEl('testModeBtn');
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
  const ids = { touchControls: root, touchLayoutEntry: entry, touchSafeInsets: probe, touchJoystick: joystick, testModeBtn };
  // 常驻 HUD 信息卡（TouchLayout 通过 document.querySelector 获取）。
  const cards = {
    '.vitals': new FakeEl('hudVitals'),
    '.mission': new FakeEl('hudMission'),
    '.objective': new FakeEl('hudObjective'),
    '.sandbox-status': new FakeEl('hudSandbox'),
    '.minimap': new FakeEl('hudMinimap'),
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
  return { storage, root, html, bodyClass, makeHooks, cards, joystick };
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
  const controlsSrc = fs.readFileSync(path.join(rootDir, 'src/core/touch-controls.js'), 'utf8');
  const layoutSrc = fs.readFileSync(path.join(rootDir, 'src/ui/touch-layout.js'), 'utf8');
  assert.ok(html.includes('id="touchJoystick"'), 'index.html 必须保留 #touchJoystick 摇杆');
  assert.ok(layoutSrc.includes("getElementById('touchJoystick')"), 'touch-layout 必须接管 #touchJoystick 布局');
  assert.ok(layoutSrc.includes('layoutJoystickScale'), '设置面板必须包含摇杆整体大小滑块');
  assert.ok(layoutSrc.includes('layoutSprintThreshold'), '设置面板必须包含摇杆内圈疾跑范围滑块');
  assert.ok(controlsSrc.includes('setSprintThreshold'), 'TouchControls 必须支持设置疾跑阈值');
  assert.ok(controlsSrc.includes('setJoystickScale'), 'TouchControls 必须支持摇杆缩放');
  assert.ok(mainSrc.includes('onJoystickScale'), 'main.js 必须接入摇杆缩放回调');
  assert.ok(css.includes('.layout-editing .touch-joystick'), '编辑态摇杆必须有拖动视觉提示');
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
    '非编辑态HUD 卡必须 pointer-events:none，不能挡视角/按键');
  assert.ok(/body\.touch-layout-editing \.vitals,[\s\S]*?\.objective \{[^}]*pointer-events:\s*auto/.test(css),
    '编辑态下HUD 卡必须 pointer-events:auto 以支持点选/拖动');
  assert.ok(css.includes('body.touch-layout-editing .objective.layout-selected'),
    '编辑态 HUD 卡必须有选中描边样式');
  assert.ok(/body\.touch-playing \.hud-right \{[^}]*display:\s*block/.test(css),
    '触控实玩（body.touch-playing）时目标卡 .hud-right 必须可见');
  assert.ok(html.includes('id="sandboxStatus"'), '必须有独立沙盒状态卡 DOM');
  assert.ok(layoutSrc.includes('hudSandbox'), '布局 cards 命名空间必须包含 hudSandbox');
  assert.ok(layoutSrc.includes('hudMinimap') && layoutSrc.includes("hudMinimap: '.minimap'"), '小地图必须纳入同一 cards 布局系统');
  assert.ok(css.includes('body.touch-layout-editing .minimap') && css.includes('pointer-events: auto'), '编辑态小地图必须强制可见并可接收指针');
  assert.ok(css.includes('.minimap.touch-layout-managed { transform: translate(-50%, -50%) scale(var(--touch-layout-card-scale, 1)); }'), '小地图可见态切换不能丢失持久化中心变换');
  assert.ok(css.includes('.touch-controls.layout-editing .touch-look-zone { pointer-events: none; }'), '触屏编辑态必须让全屏视角层退让，避免遮住 HUD 卡片');
  assert.ok(css.includes('.sandbox-status'), '沙盒状态卡必须有独立样式');
  assert.ok(hudSrc.includes('sandboxStatus'), 'HUD 必须渲染独立沙盒状态卡');
  assert.ok(hudSrc.includes('this.el.objective.hidden = true'), '沙盒模式不能把普通目标卡改成沙盒内容');
  assert.ok(hudSrc.includes('this.el.objective.hidden = false'), '退出沙盒后普通目标卡必须恢复');
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

  // 6) HUD 卡片：默认布局所有卡齐全；apply() 写出 left/top/scale/opacity
  const layout3 = new TouchLayout();
  for (const id of ['hudVitals', 'hudMission', 'hudObjective', 'hudSandbox', 'hudMinimap']) {
    const c = layout3.layout.cards[id];
    assert.ok(c, `默认布局必须包含卡片 ${id}`);
    assert.ok(c.x >= 0 && c.x <= 1 && c.y >= 0 && c.y <= 1, `${id} 默认中心点必须归一化在 0-1`);
    assert.equal(c.scale, 1);
    assert.equal(c.opacity, 1);
  }
  layout3.apply();
  layout3.editing = true; layout3.apply();
  assert.equal(shim.cards['.sandbox-status'].style.visibility, 'visible', '编辑态必须显式显示沙盒状态卡');
  assert.equal(shim.cards['.minimap'].style.opacity, '1', '编辑态必须显式显示小地图');
  layout3.editing = false; layout3.apply();
  for (const [sel, id] of [['.vitals', 'hudVitals'], ['.mission', 'hudMission'], ['.objective', 'hudObjective'], ['.sandbox-status', 'hudSandbox'], ['.minimap', 'hudMinimap']]) {
    const el = shim.cards[sel];
    assert.ok(String(el.style.left).endsWith('px'), `${id} apply 后必须写 left`);
    assert.ok(String(el.style.top).endsWith('px'), `${id} apply 后必须写 top`);
    assert.ok(String(el.style.transform).includes('scale('), `${id} apply 后必须写 transform scale`);
    if (id === 'hudMinimap') assert.equal(el.style.opacity, '', '小地图需保留 .on 显隐并通过 CSS 变量调透明度');
    else assert.notEqual(el.style.opacity, '', `${id} apply 后必须写 opacity`);
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
  for (const id of ['hudVitals', 'hudMission', 'hudObjective', 'hudSandbox', 'hudMinimap']) {
    const c = legacy.layout.cards[id];
    assert.ok(c, `旧存档缺 cards 时 ${id} 必须落到默认布局`);
    assert.equal(c.scale, 1);
    assert.equal(c.opacity, 1);
    assert.ok(c.x >= 0 && c.x <= 1 && c.y >= 0 && c.y <= 1);
  }
  shim.storage.removeItem('marmot.touch-layout.v1');

  // 9) 设置面板包含HUD 卡选项，且整体大小/透明度文案限定于动作按钮
  const markup = layout3.settingsMarkup();
  for (const id of ['hudVitals', 'hudMission', 'hudObjective', 'hudSandbox', 'hudMinimap']) {
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

  // 12) 摇杆/沙盒控制：默认字段、设置项、持久化和越界夹紧。
  const joystickLayout = new TouchLayout();
  assert.ok(joystickLayout.layout.buttons.sandboxControl, '默认布局必须包含沙盒控制按钮');
  assert.ok(Number.isFinite(joystickLayout.layout.joystick.x) && Number.isFinite(joystickLayout.layout.joystick.y), '摇杆必须有归一化位置');
  assert.equal(joystickLayout.layout.joystick.scale, 1);
  assert.equal(joystickLayout.layout.joystick.sprintThreshold, 0.78);
  const sandboxButton = joystickLayout.layout.buttons.sandboxControl;
  assert.ok(sandboxButton.y < joystickLayout.layout.joystick.y - 0.05, '沙盒入口默认必须位于摇杆上方，不能覆盖移动区域');
  assert.ok(joystickLayout.layout.cards.hudSandbox.y > 250 / 844, '沙盒状态卡默认必须落在小地图下方的安全位置');
  const joystickMarkup = joystickLayout.settingsMarkup();
  for (const needle of ['value="sandboxControl"', 'value="joystick"', 'value="hudMinimap"', 'layoutJoystickScale', 'layoutSprintThreshold']) {
    assert.ok(joystickMarkup.includes(needle), `设置面板缺少 ${needle}`);
  }
  joystickLayout.layout.joystick.x = 0.3;
  joystickLayout.layout.joystick.y = 0.6;
  joystickLayout.layout.joystick.scale = 1.2;
  joystickLayout.layout.joystick.sprintThreshold = 0.66;
  joystickLayout.layout.buttons.sandboxControl.x = 0.5;
  joystickLayout.save();
  const reloadedJoystick = new TouchLayout();
  assert.equal(reloadedJoystick.layout.joystick.x, 0.3);
  assert.equal(reloadedJoystick.layout.joystick.y, 0.6);
  assert.equal(reloadedJoystick.layout.joystick.scale, 1.2);
  assert.equal(reloadedJoystick.layout.joystick.sprintThreshold, 0.66);
  assert.equal(reloadedJoystick.layout.buttons.sandboxControl.x, 0.5);
  shim.storage.setItem('marmot.touch-layout.v1', JSON.stringify({
    buttons: { sandboxControl: { x: -1, y: 9, scale: 0.01, opacity: 9 } },
    joystick: { x: 9, y: -9, scale: 9, sprintThreshold: 0.01 },
  }));
  const dirtyJoystick = new TouchLayout();
  assert.equal(dirtyJoystick.layout.joystick.x, 1);
  assert.equal(dirtyJoystick.layout.joystick.y, 0);
  assert.equal(dirtyJoystick.layout.joystick.scale, 1.4);
  assert.equal(dirtyJoystick.layout.joystick.sprintThreshold, 0.55);
  assert.equal(dirtyJoystick.layout.buttons.sandboxControl.x, 0);
  assert.equal(dirtyJoystick.layout.buttons.sandboxControl.y, 1);
  shim.storage.removeItem('marmot.touch-layout.v1');

  // 13) 编辑态拖动摇杆，非编辑态不得拦截移动输入。
  // 多个 TouchLayout 实例共用 shim 元素时，清理幂等绑定标记以模拟新页面实例。
  delete shim.joystick.__touchLayoutBound;
  for (const key of Object.keys(shim.joystick.listeners)) shim.joystick.listeners[key] = [];
  const dragLayout = new TouchLayout();
  const beforeJoystick = { x: dragLayout.layout.joystick.x, y: dragLayout.layout.joystick.y };
  const fireTouch = (type, x, y) => {
    const event = { changedTouches: [{ identifier: 7, clientX: x, clientY: y }], preventDefault() {}, stopImmediatePropagation() {} };
    for (const fn of shim.joystick.listeners[type] || []) fn(event);
  };
  fireTouch('touchstart', 100, 700); fireTouch('touchmove', 140, 660);
  assert.equal(dragLayout.layout.joystick.x, beforeJoystick.x, '非编辑态不得移动摇杆布局');
  dragLayout.setAdjustEnabled(true);
  dragLayout.setEditing(true);
  fireTouch('touchstart', 100, 700); fireTouch('touchmove', 140, 660);
  assert.equal(dragLayout.selected, 'joystick');
  assert.ok(dragLayout.layout.joystick.x !== beforeJoystick.x, '编辑态拖动必须更新摇杆位置');
  fireTouch('touchend', 140, 660);
  assert.ok(!shim.joystick.classList.contains('layout-dragging'));

  console.log('touch layout adjust gate + auto-pause + HUD cards + joystick: all assertions passed');
})().catch((err) => { console.error(err); process.exitCode = 1; });
