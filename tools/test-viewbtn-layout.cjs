'use strict';
/**
 * #viewBtn 接入布局系统（hudViewBtn）的 node:test 覆盖：
 *  - beta 可调名单存在 / 可选中；stable/dev 不接管（IS_BETA 守卫语义）
 *  - opacity / scale / 位置 X·Y 百分比可写入并在“渲染”样式上生效
 *  - 按钮型卡片不冻结宽度（第一/第三人称文案切换不裁切）、不加 pointer-events 限制
 *  - 旧存档 / 导入配置中的 cards.hudViewMode 安全忽略，不崩溃
 *  - 编辑态点选拦截按钮行为，非编辑态放行（点击与 V 键照常）
 *  - 重复件 src/ui/view-mode-card.js 物理删除、main.js 无残留
 *
 * 用最小手写 DOM 桩驱动真实的 TouchLayout 类（不依赖 jsdom）。
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const STORAGE_KEY = 'marmot.touch-layout.v1';
const ADJUST_KEY = 'marmot.settings.touchLayoutAdjust';

function makeClassList() {
  const set = new Set();
  return {
    contains: (c) => set.has(c),
    add: (c) => set.add(c),
    remove: (c) => set.delete(c),
    toggle(c, on) { const v = on === undefined ? !set.has(c) : !!on; v ? set.add(c) : set.delete(c); return v; },
  };
}

function fakeEl(rect0) {
  let rect = rect0;
  const listeners = {};
  return {
    style: {},
    dataset: {},
    listeners,
    classList: makeClassList(),
    setRect: (r) => { rect = r; },
    getBoundingClientRect: () => ({ ...rect }),
    addEventListener(type, fn, opts) { (listeners[type] ||= []).push({ fn, opts }); },
    setPointerCapture() {}, releasePointerCapture() {},
  };
}

function installDom({ width = 1280, height = 720, store = {} } = {}) {
  // 设计位：styles.css 桌面断点 .view-btn{top:16px;right:16px}，宽 96 高 34。
  const viewBtnEl = fakeEl({ left: width - 16 - 96, top: 16, width: 96, height: 34 });
  const root = { querySelector: () => null, classList: makeClassList() };
  const ids = { touchControls: root, kbLayoutDone: null, touchLayoutEntry: null, setBody: null };
  globalThis.innerWidth = width;
  globalThis.innerHeight = height;
  globalThis.window = { innerWidth: width, innerHeight: height, addEventListener() {} };
  globalThis.document = {
    body: { classList: makeClassList() },
    documentElement: { setAttribute() {} },
    getElementById: (id) => ids[id] ?? null,
    querySelector: (sel) => (sel === '#viewBtn' ? viewBtnEl : null),
  };
  globalThis.localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
  };
  return { viewBtnEl, store };
}

(async () => {
  const { TouchLayout, CARDS, normalizeCardEntries } = await import('../src/ui/touch-layout.js');
  const transfer = await import('../src/core/config-transfer.mjs');

  test('hudViewBtn 在 beta 可调名单中，默认位由 CSS 设计位实测得出（非硬编码）', () => {
    const { viewBtnEl } = installDom();
    const layout = new TouchLayout({ beta: true });
    assert.ok(CARDS.includes('hudViewBtn'));
    assert.ok(layout.availableCards().includes('hudViewBtn'));
    assert.equal(layout.cards.hudViewBtn, viewBtnEl);
    const item = layout.layout.cards.hudViewBtn;
    // 设计中心 (1168+48, 16+17) = (1216, 33)，归一化 0.95 / 0.0458…
    assert.ok(Math.abs(item.x - 1216 / 1280) < 1e-9, `x=${item.x}`);
    assert.ok(Math.abs(item.y - 33 / 720) < 1e-9, `y=${item.y}`);
    // apply 后从 right 锚点切换为 left/top 中心点定位
    assert.equal(viewBtnEl.style.position, 'fixed');
    assert.equal(viewBtnEl.style.right, 'auto');
    assert.equal(viewBtnEl.style.bottom, 'auto');
    assert.ok(/scale\(1\)/.test(viewBtnEl.style.transform));
  });

  test('stable/dev（beta:false）不接管视角按钮，渠道语义不变', () => {
    const { viewBtnEl } = installDom();
    const layout = new TouchLayout({ beta: false });
    assert.equal(layout.cards.hudViewBtn, null);
    assert.ok(!layout.availableCards().includes('hudViewBtn'));
    assert.equal(viewBtnEl.style.position, undefined);
    assert.equal(viewBtnEl.style.transform, undefined);
  });

  test('视角按钮可在设置面板选中（setSelected/_entry 走卡片通路）', () => {
    installDom();
    const layout = new TouchLayout({ beta: true });
    assert.equal(layout.setSelected('hudViewBtn'), undefined);
    assert.equal(layout.selected, 'hudViewBtn');
    assert.equal(layout._entry('hudViewBtn'), layout.layout.cards.hudViewBtn);
  });

  test('opacity/scale/位置百分比三项可写入并在样式上生效，且宽度永不冻结', () => {
    const { viewBtnEl } = installDom();
    const layout = new TouchLayout({ beta: true });
    layout.setSelected('hudViewBtn');
    const item = layout.layout.cards.hudViewBtn;
    // 单项大小 / 单项透明度滑块（与 bindSettings 同一写入路径）
    item.scale = 0.8;
    item.opacity = 0.5;
    layout.apply();
    assert.equal(viewBtnEl.style.opacity, '0.5');
    assert.ok(/translate\(-50%, ?-50%\) scale\(0\.8\)/.test(viewBtnEl.style.transform), viewBtnEl.style.transform);
    // 位置 X·Y 百分比输入
    assert.equal(layout.setCardPositionPercent('hudViewBtn', 40, 30), true);
    assert.ok(Math.abs(item.x - 0.4) < 1e-6, `x=${item.x}`);
    assert.ok(Math.abs(item.y - 0.3) < 1e-6, `y=${item.y}`);
    assert.equal(viewBtnEl.style.left, '512px');
    assert.equal(viewBtnEl.style.top, '216px');
    // 按钮型卡片：宽度始终交给内容/CSS（文案切换不裁切）；层级与指针不被布局系统接管
    assert.equal(viewBtnEl.style.width, '');
    assert.equal(viewBtnEl.style.maxWidth, '');
    assert.equal(viewBtnEl.style.zIndex, '');
    assert.equal(viewBtnEl.style.pointerEvents, undefined);
    // 模拟“第三人称”文案变长：rect 变宽后再次 apply，宽度依旧不冻结
    viewBtnEl.setRect({ left: 1280 - 16 - 112, top: 16, width: 112, height: 34 });
    layout.apply();
    assert.equal(viewBtnEl.style.width, '');
  });

  test('旧存档含 cards.hudViewMode 时不崩溃、被安全忽略，hudViewBtn 补默认', () => {
    const store = {};
    store[STORAGE_KEY] = JSON.stringify({
      scale: 1, opacity: 1,
      buttons: {},
      cards: { hudViewMode: { x: 0.9, y: 0.2, scale: 1, opacity: 1 } },
      joystick: {},
    });
    installDom({ store });
    let layout;
    assert.doesNotThrow(() => { layout = new TouchLayout({ beta: true }); });
    assert.equal(layout.layout.cards.hudViewMode, undefined);
    assert.ok(layout.layout.cards.hudViewBtn);
    assert.ok(Math.abs(layout.layout.cards.hudViewBtn.x - 1216 / 1280) < 1e-9);
    // 纯函数层面同样忽略未知 id
    const base = Object.fromEntries(CARDS.map((id) => [id, { x: 0.5, y: 0.5, scale: 1, opacity: 1 }]));
    const normalized = normalizeCardEntries({ hudViewMode: { x: 1, y: 1 } }, base, CARDS);
    assert.equal(normalized.hudViewMode, undefined);
    for (const id of CARDS) assert.ok(normalized[id], `${id} 必须存在`);
    // 保存后的存档不再携带旧键
    layout.save();
    const saved = JSON.parse(store[STORAGE_KEY]);
    assert.equal(saved.cards.hudViewMode, undefined);
    assert.ok(saved.cards.hudViewBtn);
  });

  test('配置导入：cards.hudViewMode 进忽略名单，cards.hudViewBtn 正常清洗入库', () => {
    const result = transfer.sanitizeConfig({
      schemaVersion: 1,
      touchLayout: {
        cards: {
          hudViewMode: { x: 0.5, y: 0.5, scale: 1, opacity: 1 },
          hudViewBtn: { x: 0.5, y: 0.5, scale: 1, opacity: 0.8 },
        },
      },
    });
    assert.equal(result.ok, true);
    assert.equal(result.config.touchLayout.cards.hudViewMode, undefined);
    assert.deepEqual(result.config.touchLayout.cards.hudViewBtn, { x: 0.5, y: 0.5, scale: 1, opacity: 0.8 });
    assert.ok(result.ignored.includes('touchLayout.cards.hudViewMode'), result.ignored.join(','));
  });

  test('编辑态点选拦截按钮点击（不误切视角），非编辑态完全放行', () => {
    const { viewBtnEl } = installDom();
    const layout = new TouchLayout({ beta: true });
    layout.adjustEnabled = true;
    layout.setEditing(true);
    assert.equal(layout.editing, true);
    const clickCapture = viewBtnEl.listeners.click.find((l) => l.opts === true).fn;
    let prevented = 0, stopped = 0;
    clickCapture({ preventDefault() { prevented += 1; }, stopImmediatePropagation() { stopped += 1; } });
    assert.equal(prevented, 1);
    assert.equal(stopped, 1);
    assert.equal(layout.selected, 'hudViewBtn');
    // 编辑态 pointerdown（鼠标）同样被吞掉并转为拖拽（浏览器因此不再派发兼容 click）
    const pointerdown = viewBtnEl.listeners.pointerdown.find((l) => l.opts === true).fn;
    let pdStopped = 0;
    pointerdown({ pointerType: 'mouse', clientX: 1200, clientY: 30, preventDefault() {}, stopImmediatePropagation() { pdStopped += 1; }, pointerId: 7 });
    assert.equal(pdStopped, 1);
    const pointerup = viewBtnEl.listeners.pointerup.find((l) => l.opts === true).fn;
    pointerup({ pointerId: 7 });
    // 退出编辑后点击不再被拦截：#viewBtn.onclick（main.js 挂载）照常执行
    layout.setEditing(false);
    let passed = 0;
    clickCapture({ preventDefault() { passed += 1; }, stopImmediatePropagation() { passed += 1; } });
    assert.equal(passed, 0);
  });

  test('beta 默认在设置键左侧，非编辑态不被全屏菜单遮罩拦截', () => {
    const addonCss = fs.readFileSync(path.join(ROOT, 'styles-beta-addon.css'), 'utf8');
    // 桌面 #setBtn 为 right:92px + 32px 宽；viewBtn right:132px 留出 8px 间距。
    assert.match(addonCss, /@media \(min-width: 861px\)\s*\{\s*body\.beta-version \.view-btn\s*\{[^}]*right:\s*132px/s);
    // 开始/暂停 overlay 为 z-index:40；实玩按钮须在其上，编辑态仍由拖动层接管。
    assert.match(addonCss, /body\.beta-version:not\(\.touch-layout-editing\) \.view-btn\s*\{[^}]*z-index:\s*50/s);
  });

  test('重复件 view-mode-card 已物理删除，main.js/全仓无 hudViewMode 残留', () => {
    assert.equal(fs.existsSync(path.join(ROOT, 'src/ui/view-mode-card.js')), false);
    const mainSrc = fs.readFileSync(path.join(ROOT, 'src/main.js'), 'utf8');
    assert.ok(!mainSrc.includes('view-mode-card'));
    assert.ok(!mainSrc.includes('ViewModeCard'));
    assert.ok(mainSrc.includes('new TouchLayout({ beta: IS_BETA })'));
    const addonCss = fs.readFileSync(path.join(ROOT, 'styles-beta-addon.css'), 'utf8');
    assert.ok(!addonCss.includes('viewmode-card'));
    assert.ok(addonCss.includes('hudViewBtn') && addonCss.includes('.view-btn'));
  });
})();
