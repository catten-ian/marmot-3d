/* feat/tps-drive 验收测试（纯 Node，不启动浏览器）：
 * A. resolveTouchDrive 第三人称“滑向哪就跑向哪” + 第一人称行为不变；
 * B. TouchLayout 接入沙盒浮动按钮（默认位置/选中/拖动/尺寸透明度/旧布局兼容）。
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

let checks = 0;
function ok(cond, msg) { assert.ok(cond, msg); checks++; }
function eq(a, b, msg) { assert.equal(a, b, msg); checks++; }
function approxEq(a, b, eps, msg) { assert.ok(Math.abs(a - b) < eps, `${msg}: |${a} - ${b}| >= ${eps}`); checks++; }
const angleErr = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));

(async () => {
  const { resolveTouchDrive } = await import('../src/core/move-facing.mjs');
  const { TouchLayout } = await import('../src/ui/touch-layout.js');
  const { SANDBOX_TOUCH_ACTIONS } = await import('../src/sandbox/panel.js');

  // ---------- A. 第三人称滑向哪就跑向哪 ----------
  const base = { bodyYaw: 0, cameraYaw: 0, dt: 1 / 60, thirdPerson: true };

  const right = resolveTouchDrive({ ...base, x: 1, y: 0 });
  approxEq(right.bodyYaw, Math.PI / 2, 1e-9, 'TP 纯横推右 → bodyYaw π/2');
  approxEq(right.cameraYaw, Math.PI / 2, 1e-9, 'TP 纯横推右 → cameraYaw 同步 π/2');
  approxEq(right.throttle, 1, 1e-9, 'TP 满杆 throttle=1');
  eq(right.uTurn, false, 'TP 不走 U-turn 状态');

  const up = resolveTouchDrive({ ...base, x: 0, y: 1 });
  approxEq(up.bodyYaw, 0, 1e-9, 'TP 正上推 → bodyYaw 0（世界 -Z）');
  approxEq(up.cameraYaw, 0, 1e-9, 'TP 正上推 → cameraYaw 0');

  const diag = resolveTouchDrive({ ...base, x: 0.7, y: 0.7 });
  approxEq(diag.bodyYaw, Math.PI / 4, 1e-9, 'TP 斜推 → bodyYaw π/4');
  approxEq(diag.cameraYaw, Math.PI / 4, 1e-9, 'TP 斜推 → cameraYaw π/4');
  approxEq(diag.throttle, Math.hypot(0.7, 0.7), 1e-9, 'TP throttle=推杆距离');

  const left = resolveTouchDrive({ ...base, x: -1, y: 0 });
  approxEq(left.bodyYaw, -Math.PI / 2, 1e-9, 'TP 纯横推左 → bodyYaw -π/2');
  approxEq(left.cameraYaw, -Math.PI / 2, 1e-9, 'TP 纯横推左 → cameraYaw 同步');

  // 镜头转 90° 后，屏幕方向仍对应世界方向：正上=当前镜头朝向，正右=镜头右侧。
  const turned = { ...base, cameraYaw: Math.PI / 2, bodyYaw: Math.PI / 2 };
  approxEq(resolveTouchDrive({ ...turned, x: 0, y: 1 }).bodyYaw, Math.PI / 2, 1e-9, 'TP 转镜头后正上跟随镜头');
  approxEq(resolveTouchDrive({ ...turned, x: 1, y: 0 }).bodyYaw, Math.PI, 1e-9, 'TP 转镜头后正右=镜头右侧(π)');
  approxEq(resolveTouchDrive({ ...turned, x: 0, y: -1 }).bodyYaw, -Math.PI / 2, 1e-9, 'TP 转镜头后后拉=镜头后方');

  // 后拉：屏幕正下映射 cameraYaw+π（朝镜头后方掉头），不需要 U-turn 平滑状态。
  const pull = resolveTouchDrive({ ...base, x: 0, y: -1 });
  approxEq(angleErr(pull.bodyYaw, Math.PI), 0, 1e-9, 'TP 后拉 → bodyYaw 掉头 π');
  approxEq(angleErr(pull.cameraYaw, Math.PI), 0, 1e-9, 'TP 后拉 → cameraYaw 同步掉头');
  eq(pull.uTurn, false, 'TP 后拉不置 uTurn');

  // 连续两帧正右推：第二帧相对新屏幕方向再转 90°，而不是原地无限画圈。
  const second = resolveTouchDrive({ ...base, x: 1, y: 0, bodyYaw: right.bodyYaw, cameraYaw: right.cameraYaw });
  approxEq(second.bodyYaw, Math.PI, 1e-9, 'TP 连续右推累计朝向 π 而非持续累加速度式画圈');

  // throttle 随 mag 线性，且被 1 截断；dead zone 0.14 保留。
  approxEq(resolveTouchDrive({ ...base, x: 0, y: 0.5 }).throttle, 0.5, 1e-9, 'TP 半杆 throttle=.5');
  approxEq(resolveTouchDrive({ ...base, x: 0, y: 1.2 }).throttle, 1, 1e-9, 'TP 超杆截断 1');
  const idle = resolveTouchDrive({ ...base, x: 0.05, y: 0.05, cameraYaw: 1.23 });
  eq(idle.throttle, 0, 'TP dead zone 内 throttle=0');
  approxEq(idle.cameraYaw, 1.23, 1e-9, 'TP dead zone 回传原 cameraYaw');
  approxEq(idle.bodyYaw, 0, 1e-9, 'TP dead zone bodyYaw 不动');

  // ---------- A2. 第一人称行为完全保持（旧“油门+连续转向”模型） ----------
  const fp = { bodyYaw: 0, cameraYaw: 0, dt: 1 / 60 };
  const fpRight = resolveTouchDrive({ ...fp, x: 1, y: 0 });
  approxEq(fpRight.bodyYaw, -2.7 / 60, 1e-9, 'FP 横推右仍持续转 bodyYaw（画圈模型保留）');
  approxEq(fpRight.throttle, 0.82, 1e-9, 'FP 纯横推基础油门 0.82 不变');
  eq(fpRight.cameraYaw, 0, 'FP 输出 cameraYaw 原样不变');
  const fpRight2 = resolveTouchDrive({ ...fp, x: 1, y: 0, bodyYaw: fpRight.bodyYaw });
  ok(fpRight2.bodyYaw < fpRight.bodyYaw, 'FP 连续横推持续累加转角');
  // 不传第三参（默认 false）也保持旧行为，兼容旧调用/旧单测。
  const fpDefault = resolveTouchDrive({ bodyYaw: 0, cameraYaw: 0, x: 1, y: 0, dt: 1 / 60 });
  approxEq(fpDefault.bodyYaw, -2.7 / 60, 1e-9, '默认（无 thirdPerson）仍是 FP 行为');
  const fpBack = resolveTouchDrive({ ...fp, x: 0, y: -0.8 });
  eq(fpBack.uTurn, true, 'FP 后拉保留 U-turn 分支');
  approxEq(fpBack.throttle, 0.8, 1e-9, 'FP 后拉油门 .8');
  ok(angleErr(fpBack.bodyYaw, Math.PI) < Math.PI - 0.1, 'FP 后拉朝镜头后方平滑掉头');

  // 调用方契约：controls.js 传入 thirdPerson 并消费 cameraYaw。
  const controlsSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'core', 'controls.js'), 'utf8');
  ok(controlsSrc.includes('thirdPerson: this.thirdPerson'), 'controls.js 传入 thirdPerson 标志');
  ok(/drive\.cameraYaw/.test(controlsSrc), 'controls.js 消费 drive.cameraYaw 同步镜头');

  // ---------- B. 沙盒按钮接入 TouchLayout（最小 DOM 桩） ----------
  function makeEl(tag = 'div', attrs = {}) {
    const el = {
      tag, attrs, children: [], dataset: {}, style: { _m: {}, setProperty(k, v) { this._m[k] = v; } },
      _listeners: [], classList: {
        _s: new Set(), add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); },
        toggle(c, f) { const on = f === undefined ? !this._s.has(c) : !!f; on ? this._s.add(c) : this._s.delete(c); return on; },
        contains(c) { return this._s.has(c); },
      },
      appendChild(c) { this.children.push(c); c.parentElement = this; return c; },
      addEventListener(type, fn, opts) { this._listeners.push({ type, fn, capture: opts === true || (opts && opts.capture) }); },
      dispatch(type, event) {
        let stopped = false;
        const ev = { ...event, defaultPrevented: false, prevented: false, stopped: false,
          preventDefault() { ev.defaultPrevented = true; ev.prevented = true; },
          stopImmediatePropagation() { stopped = true; ev.stopped = true; } };
        for (const l of this._listeners.filter((l) => l.type === type)) {
          // 捕获监听先于冒泡；本桩所有监听都挂在同一元素上，按捕获优先排序。
          if (l.capture || type === 'click') l.fn(ev);
          if (stopped) break;
        }
        return ev;
      },
      getBoundingClientRect() { return { left: 100, top: 200, width: 54, height: 54 }; },
      offsetWidth: 54, offsetHeight: 54,
      setPointerCapture() {}, releasePointerCapture() {},
      setAttribute() {}, getAttribute() { return null; },
      _match(sel) {
        const m = sel.match(/^\[([\w-]+)="?([^"\]]+)"?\]$/);
        if (m) return this.attrs[m[1]] === m[2];
        if (sel.startsWith('.')) return !!this.attrs.class && this.attrs.class.split(/\s+/).includes(sel.slice(1));
        return this.tag === sel;
      },
      _walk(out = []) { for (const c of this.children) { out.push(c); c._walk(out); } return out; },
      querySelector(sel) { return this._walk().find((e) => e._match(sel)) || null; },
      querySelectorAll(sel) { return this._walk().filter((e) => e._match(sel)); },
    };
    return el;
  }

  const byId = new Map();
  function register(el, id) { el.attrs.id = id; byId.set(id, el); return el; }
  const root = register(makeEl('div', { id: 'touchControls', class: 'touch-controls' }), 'touchControls');
  const actionLayer = makeEl('div', { class: 'touch-actions' });
  root.appendChild(actionLayer);
  for (const id of ['attack', 'dodge', 'jump', 'interact', 'burst', 'ultimate']) {
    actionLayer.appendChild(makeEl('button', { 'data-touch-action': id }));
  }
  root.appendChild(makeEl('button', { 'data-touch-action': 'pause' }));
  register(makeEl('i', { id: 'touchSafeInsets' }), 'touchSafeInsets');
  register(makeEl('button', { id: 'touchLayoutEntry' }), 'touchLayoutEntry');
  register(makeEl('div', { id: 'setBody' }), 'setBody');

  const storage = new Map();
  globalThis.innerWidth = 390; globalThis.innerHeight = 844;
  globalThis.window = { addEventListener() {} };
  globalThis.localStorage = { getItem: (k) => (storage.has(k) ? storage.get(k) : null), setItem: (k, v) => storage.set(k, v), removeItem: (k) => storage.delete(k) };
  globalThis.getComputedStyle = () => ({ paddingTop: '0px', paddingRight: '0px', paddingBottom: '0px', paddingLeft: '0px' });
  globalThis.document = {
    getElementById: (id) => byId.get(id) || null,
    body: makeEl('body'),
    addEventListener() {},
  };

  const layout = new TouchLayout();

  // 战斗键 7 个先就位，沙盒层尚未创建。
  for (const id of ['attack', 'dodge', 'jump', 'interact', 'burst', 'ultimate', 'pause']) ok(layout.buttons[id], `战斗键 ${id} 已接管`);
  for (const id of SANDBOX_TOUCH_ACTIONS.map((a) => a.id)) eq(layout.buttons[id], undefined, `沙盒层未创建前 ${id} 为空（不报错）`);

  // 默认布局：竖排、左侧、避开左下摇杆（摇杆顶在底 142px），y 互不重叠。
  const dflt = layout.defaultLayout();
  const ys = SANDBOX_TOUCH_ACTIONS.map((a) => dflt.buttons[a.id].y);
  for (const a of SANDBOX_TOUCH_ACTIONS) {
    const b = dflt.buttons[a.id];
    ok(b.x < 0.3, `${a.id} 默认在左侧`);
    ok(b.y < 1 - 150 / 844 + 1e-9, `${a.id} 默认高于摇杆`);
  }
  eq(new Set(ys).size, ys.length, '沙盒默认位置纵向互不重叠');
  for (const id of ['attack', 'pause']) ok(dflt.buttons[id], '战斗键默认布局保留');

  // 面板随后创建浮动层（与 main.js 时序一致），collectSandboxButtons 补绑。
  const layer = register(makeEl('div', { id: 'sandboxTouchLayer', class: 'sandbox-touch-layer' }), 'sandboxTouchLayer');
  globalThis.document.body.appendChild(layer);
  for (const a of SANDBOX_TOUCH_ACTIONS) layer.appendChild(makeEl('button', { 'data-sandbox-action': a.id }));
  layout.collectSandboxButtons();
  for (const a of SANDBOX_TOUCH_ACTIONS) ok(layout.buttons[a.id], `collectSandboxButtons 接管 ${a.id}`);
  eq(new Set(Object.keys(layout.buttons)).size, 7 + 7, '沙盒键与战斗键 id 互不冲突');

  // 编辑态点击沙盒按钮：选中且拦截点击（不触发 onAction）。
  layout.setEditing(true);
  const spawnOne = layout.buttons.spawnOne;
  const editClick = spawnOne.dispatch('click', {});
  eq(layout.selected, 'spawnOne', '编辑态点击选中沙盒键');
  eq(editClick.stopped, true, '编辑态拦截沙盒键点击，不触发动作');
  ok(spawnOne.classList.contains('layout-selected'), '选中键有 layout-selected 轮廓类');

  // 非编辑态点击：不拦截，交由面板原有 click → onAction。
  layout.setEditing(false);
  layout.setSelected('attack');
  const playClick = spawnOne.dispatch('click', {});
  eq(layout.selected, 'attack', '非编辑态点击不改变选中');
  eq(playClick.stopped, false, '非编辑态沙盒键点击透传给 onAction');

  // 编辑态拖动沙盒按钮：归一化位置被更新。
  layout.setEditing(true);
  layout.setSelected('clearFoxes');
  const before = { ...layout.layout.buttons.clearFoxes };
  const clearFoxes = layout.buttons.clearFoxes;
  clearFoxes.dispatch('pointerdown', { pointerType: 'mouse', pointerId: 1, clientX: 100 + 27, clientY: 200 + 27 });
  clearFoxes.dispatch('pointermove', { pointerType: 'mouse', pointerId: 1, clientX: 260, clientY: 420 });
  const after = layout.layout.buttons.clearFoxes;
  ok(Math.abs(after.x - before.x) > 1e-6 || Math.abs(after.y - before.y) > 1e-6, '拖动改变沙盒键布局位置');
  clearFoxes.dispatch('pointerup', { pointerType: 'mouse', pointerId: 1 });
  ok(!clearFoxes.classList.contains('layout-dragging'), '松手移除 dragging 类');

  // 单键尺寸/透明度滑块写入沙盒键配置。
  layout.layout.buttons.spawnGroup.scale = 1.2;
  layout.layout.buttons.spawnGroup.opacity = 0.5;
  layout.apply();
  const groupEl = layout.buttons.spawnGroup;
  eq(groupEl.style._m['--touch-button-scale'], String(1.2 * layout.layout.scale), '沙盒键尺寸变量生效');
  eq(groupEl.style._m['--touch-button-opacity'], String(0.5 * layout.layout.opacity), '沙盒键透明度变量生效');

  // 设置面板下拉里能选到沙盒按钮（分组）。
  const markup = layout.settingsMarkup();
  ok(markup.includes('沙盒控制') && markup.includes('战斗动作'), '设置面板分组战斗/沙盒');
  for (const a of SANDBOX_TOUCH_ACTIONS) ok(markup.includes(`value="${a.id}"`), `设置面板含沙盒键 ${a.id}`);
  for (const a of SANDBOX_TOUCH_ACTIONS) { layout.setSelected(a.id); eq(layout.selected, a.id, `可选中 ${a.id}`); }

  // 旧存档（只有战斗键）载入后自动补齐沙盒默认值，战斗键自定义值得以保留。
  storage.clear();
  const oldSave = { scale: 1.1, opacity: 0.9, buttons: { attack: { x: 0.61, y: 0.67, scale: 1.2, opacity: 0.8 } } };
  storage.set('marmot.touch-layout.v1', JSON.stringify(oldSave));
  const layout2 = new TouchLayout();
  approxEq(layout2.layout.buttons.attack.x, 0.61, 1e-9, '旧存档战斗键位置保留');
  approxEq(layout2.layout.scale, 1.1, 1e-9, '旧存档全局缩放保留');
  for (const a of SANDBOX_TOUCH_ACTIONS) ok(layout2.layout.buttons[a.id], `旧存档补齐沙盒键 ${a.id} 默认值`);

  // panel.js 暴露的浮动键集合与实际接管数量一致（7 个现有沙盒动作）。
  eq(SANDBOX_TOUCH_ACTIONS.length, 7, '浮动沙盒按钮数量');
  eq(new Set(SANDBOX_TOUCH_ACTIONS.map((a) => a.id)).size, 7, '沙盒动作 id 唯一');

  console.log(`OK ${checks}/${checks}`);
})().catch((e) => { console.error(e); process.exitCode = 1; });
