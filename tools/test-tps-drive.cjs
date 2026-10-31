/* fix/touch-intent-corrections 验收测试（纯 Node，不启动浏览器）：
 * A. resolveTouchDrive 第三人称：身体按当前相机 yaw 转向，但 cameraYaw 必须原样回传
 *    （摇杆绝不驱动镜头）；左右符号必须正确（推右 = 镜头右侧，旧实现横向恒反）；
 *    第一人称行为保持不变。
 * B. 沙盒只有一个可调整入口：现有的 #testModeBtn（沙盒中文字“沙盒控制”），
 *    不再有 #sandboxTouchLayer / 七个浮动按钮 / collectSandboxButtons。
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

  // ---------- A. 第三人称：摇杆转身/移动，镜头 yaw 原样不变 ----------
  const base = { bodyYaw: 0, cameraYaw: 0, dt: 1 / 60, thirdPerson: true };

  const right = resolveTouchDrive({ ...base, x: 1, y: 0 });
  approxEq(right.bodyYaw, -Math.PI / 2, 1e-9, 'TP 纯横推右 → bodyYaw -π/2（forward=(-sin,-cos)=+X=镜头右侧）');
  approxEq(right.cameraYaw, 0, 1e-9, 'TP 横推右：cameraYaw 必须原样保持 0');
  approxEq(right.throttle, 1, 1e-9, 'TP 满杆 throttle=1');
  eq(right.uTurn, false, 'TP 不走 U-turn 状态');

  const up = resolveTouchDrive({ ...base, x: 0, y: 1 });
  approxEq(up.bodyYaw, 0, 1e-9, 'TP 正上推 → bodyYaw 0（世界 -Z）');
  approxEq(up.cameraYaw, 0, 1e-9, 'TP 正上推：cameraYaw 不变');

  const diag = resolveTouchDrive({ ...base, x: 0.7, y: 0.7 });
  approxEq(diag.bodyYaw, -Math.PI / 4, 1e-9, 'TP 斜推 → bodyYaw -π/4');
  approxEq(diag.cameraYaw, 0, 1e-9, 'TP 斜推：cameraYaw 不被身体带走');
  approxEq(diag.throttle, Math.hypot(0.7, 0.7), 1e-9, 'TP throttle=推杆距离');

  const left = resolveTouchDrive({ ...base, x: -1, y: 0 });
  approxEq(left.bodyYaw, Math.PI / 2, 1e-9, 'TP 纯横推左 → bodyYaw +π/2（世界 -X=镜头左侧）');
  approxEq(left.cameraYaw, 0, 1e-9, 'TP 横推左：cameraYaw 不变');

  // 后拉：身体朝镜头后方跑，镜头本身不转。
  const pull = resolveTouchDrive({ ...base, x: 0, y: -1 });
  approxEq(angleErr(pull.bodyYaw, Math.PI), 0, 1e-9, 'TP 后拉 → bodyYaw 朝镜头后方 π');
  approxEq(pull.cameraYaw, 0, 1e-9, 'TP 后拉：cameraYaw 保持 0（不跟着掉头）');
  eq(pull.uTurn, false, 'TP 后拉不置 uTurn');

  // 镜头被右手 look 指针转到任意 yaw 后：移动按【当前】镜头换算，镜头 yaw 仍不被改写。
  const cam = 1.2345;
  for (const [x, y] of [[0, 1], [1, 0], [-1, 0], [0, -1], [0.7, -0.3]]) {
    const r = resolveTouchDrive({ bodyYaw: cam, cameraYaw: cam, dt: 1 / 60, thirdPerson: true, x, y });
    approxEq(r.cameraYaw, cam, 1e-12, `TP 相机 yaw=${cam} 输入(${x},${y}) 后原样回传`);
  }
  const turned = { ...base, cameraYaw: Math.PI / 2, bodyYaw: Math.PI / 2 };
  approxEq(resolveTouchDrive({ ...turned, x: 0, y: 1 }).bodyYaw, Math.PI / 2, 1e-9, 'TP 转镜头后正上跟随镜头');
  // cy=π/2 时镜头右方 = (cos,-sin) = (0,-1) = 世界 -Z → forward(bodyYaw=0)。
  approxEq(resolveTouchDrive({ ...turned, x: 1, y: 0 }).bodyYaw, 0, 1e-9, 'TP 转镜头后正右=镜头右侧(世界 -Z → yaw 0)');

  // 连续两帧正右推（相机不动）：身体朝世界 +X 后保持，不再因相机 yaw 被改写而连续画圈。
  const f1 = resolveTouchDrive({ ...base, x: 1, y: 0 });
  const f2 = resolveTouchDrive({ ...base, bodyYaw: f1.bodyYaw, cameraYaw: 0, x: 1, y: 0 });
  approxEq(f2.bodyYaw, -Math.PI / 2, 1e-9, 'TP 连续右推身体稳定在 -π/2（非累加画圈）');
  approxEq(f2.cameraYaw, 0, 1e-9, 'TP 连续右推相机始终 0');

  // dead zone：原样回传 cameraYaw，bodyYaw 不动。
  const idle = resolveTouchDrive({ ...base, x: 0.05, y: 0.05, cameraYaw: 1.23 });
  eq(idle.throttle, 0, 'TP dead zone 内 throttle=0');
  approxEq(idle.cameraYaw, 1.23, 1e-9, 'TP dead zone 回传原 cameraYaw');
  approxEq(idle.bodyYaw, 0, 1e-9, 'TP dead zone bodyYaw 不动');

  // ---------- A1.5 任意镜头 yaw 下，由 bodyYaw 推出的移动方向必须等于 摇杆屏幕向量×镜头 ----------
  // 这覆盖“第三人称左右符号”根因：身体 forward=(-sin,-cos) 即实际控制移动的方向。
  for (const cy of [0, Math.PI / 2, Math.PI, -Math.PI / 2, 0.77, -2.31]) {
    for (const [x, y] of [[1, 0], [-1, 0], [0, 1], [0, -1], [0.6, 0.8], [-0.5, 0.3], [0.2, -0.9]]) {
      const r = resolveTouchDrive({ bodyYaw: 0.33, cameraYaw: cy, dt: 1 / 60, thirdPerson: true, x, y });
      const m = Math.hypot(x, y);
      const fwdX = -Math.sin(cy), fwdZ = -Math.cos(cy);      // 镜头前方
      const rightX = Math.cos(cy), rightZ = -Math.sin(cy);   // 镜头右方
      const wantX = (rightX * x + fwdX * y) / m, wantZ = (rightZ * x + fwdZ * y) / m;
      const gotX = -Math.sin(r.bodyYaw), gotZ = -Math.cos(r.bodyYaw);
      approxEq(gotX, wantX, 1e-9, `TP cy=${cy} 输入(${x},${y}) 移动方向 x 分量`);
      approxEq(gotZ, wantZ, 1e-9, `TP cy=${cy} 输入(${x},${y}) 移动方向 z 分量`);
    }
  }

  // ---------- A2. 第一人称行为完全保持（旧“油门+连续转向”模型） ----------
  const fp = { bodyYaw: 0, cameraYaw: 0, dt: 1 / 60 };
  const fpRight = resolveTouchDrive({ ...fp, x: 1, y: 0 });
  approxEq(fpRight.bodyYaw, -2.7 / 60, 1e-9, 'FP 横推右仍持续转 bodyYaw（画圈模型保留）');
  approxEq(fpRight.throttle, 0.82, 1e-9, 'FP 纯横推基础油门 0.82 不变');
  eq(fpRight.cameraYaw, 0, 'FP 输出 cameraYaw 原样不变');
  const fpDefault = resolveTouchDrive({ bodyYaw: 0, cameraYaw: 0, x: 1, y: 0, dt: 1 / 60 });
  approxEq(fpDefault.bodyYaw, -2.7 / 60, 1e-9, '默认（无 thirdPerson）仍是 FP 行为');
  const fpBack = resolveTouchDrive({ ...fp, x: 0, y: -0.8 });
  eq(fpBack.uTurn, true, 'FP 后拉保留 U-turn 分支');
  approxEq(fpBack.throttle, 0.8, 1e-9, 'FP 后拉油门 .8');

  // 调用方契约：controls.js 第三人称 touch-drive 分支禁止把摇杆结果写回 this.yaw。
  const controlsSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'core', 'controls.js'), 'utf8');
  ok(controlsSrc.includes('thirdPerson: this.thirdPerson'), 'controls.js 传入 thirdPerson 标志');
  const tpBlock = controlsSrc.slice(controlsSrc.indexOf('if (this.thirdPerson) {', controlsSrc.indexOf('resolveTouchDrive')));
  const tpBranch = tpBlock.slice(0, tpBlock.indexOf('} else if'));
  ok(tpBranch.includes('moveFacingYaw') && !/this\.yaw\s*=/.test(tpBranch),
    'controls.js 第三人称分支不写 this.yaw（镜头只由 lookZone/键鼠改变）');

  // ---------- B. 沙盒唯一可调整入口：现有 #testModeBtn ----------
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
          stopImmediatePropagation() { stopped = true; ev.stopped = true; },
          stopPropagation() { stopped = true; ev.stopped = true; } };
        for (const l of this._listeners.filter((l) => l.type === type)) {
          l.fn(ev);
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
  // 现有沙盒入口按钮：index.html 中一直存在的 #testModeBtn（不在 #touchControls 内）。
  const testModeBtn = register(makeEl('button', { id: 'testModeBtn', class: 'test-mode-btn' }), 'testModeBtn');
  register(makeEl('i', { id: 'touchSafeInsets' }), 'touchSafeInsets');
  register(makeEl('button', { id: 'touchLayoutEntry' }), 'touchLayoutEntry');
  register(makeEl('div', { id: 'setBody' }), 'setBody');

  const storage = new Map();
  globalThis.innerWidth = 390; globalThis.innerHeight = 844;
  globalThis.window = { addEventListener() {} };
  globalThis.localStorage = { getItem: (k) => (storage.has(k) ? storage.get(k) : null), setItem: (k, v) => storage.set(k, v), removeItem: (k) => storage.delete(k) };
  globalThis.getComputedStyle = () => ({ paddingTop: '0px', paddingRight: '0px', paddingBottom: '0px', paddingLeft: '0px' });
  globalThis.document = {
    documentElement: { setAttribute() {} },
    getElementById: (id) => byId.get(id) || null,
    body: makeEl('body'),
    addEventListener() {},
  };

  const { TouchLayout } = await import('../src/ui/touch-layout.js?bust=' + Date.now());
  const layout = new TouchLayout();

  const sandboxIds = Object.keys(layout.buttons).filter((id) => id.includes('sandbox') || id === 'refill');
  eq(sandboxIds.length, 1, '运行时只有一个沙盒相关可调控件');
  eq(sandboxIds[0], 'sandboxControl', '该控件是 sandboxControl（#testModeBtn）');
  eq(layout.buttons.sandboxControl, testModeBtn, 'sandboxControl 即现有的 #testModeBtn');
  for (const id of ['refill', 'clearStress', 'charge', 'resetFood', 'spawnOne', 'spawnGroup', 'clearFoxes']) {
    eq(layout.buttons[id], undefined, `浮动沙盒动作 ${id} 不再被接管`);
  }
  ok(typeof layout.collectSandboxButtons !== 'function', 'collectSandboxButtons 已删除');

  // 默认布局含 sandboxControl，且应用的是 left/top 定位（覆盖旧 left/bottom CSS）。
  ok(layout.defaultLayout().buttons.sandboxControl, '默认布局含沙盒入口按钮');
  eq(testModeBtn.style.bottom, 'auto', '沙盒按钮改用 top 定位时清掉旧 bottom 锚定');
  ok(String(testModeBtn.style.left).endsWith('px') && String(testModeBtn.style.top).endsWith('px'), '沙盒按钮位置被布局系统接管');

  // 编辑态：点击沙盒按钮被拦截（不触发原 onclick 开面板），可选中/拖动/调尺寸透明度。
  layout.setAdjustEnabled(true);
  layout.setEditing(true);
  const editClick = testModeBtn.dispatch('click', {});
  eq(layout.selected, 'sandboxControl', '编辑态点击选中沙盒入口按钮');
  eq(editClick.stopped, true, '编辑态拦截点击，不触发开/关面板');
  ok(testModeBtn.classList.contains('layout-selected'), '选中键有 layout-selected 轮廓类');

  layout.setEditing(false);
  layout.setSelected('attack');
  const playClick = testModeBtn.dispatch('click', {});
  eq(layout.selected, 'attack', '非编辑态点击不改变选中');
  eq(playClick.stopped, false, '非编辑态点击透传给原 onclick（开/关 #testPanel）');

  layout.setEditing(true);
  layout.setSelected('sandboxControl');
  const before = { ...layout.layout.buttons.sandboxControl };
  testModeBtn.dispatch('pointerdown', { pointerType: 'mouse', pointerId: 1, clientX: 100 + 27, clientY: 200 + 27 });
  testModeBtn.dispatch('pointermove', { pointerType: 'mouse', pointerId: 1, clientX: 130, clientY: 400 });
  const after = layout.layout.buttons.sandboxControl;
  ok(Math.abs(after.x - before.x) > 1e-6 || Math.abs(after.y - before.y) > 1e-6, '拖动改变沙盒按钮位置');
  testModeBtn.dispatch('pointerup', { pointerType: 'mouse', pointerId: 1 });
  ok(!testModeBtn.classList.contains('layout-dragging'), '松手移除 dragging 类');

  layout.layout.buttons.sandboxControl.scale = 1.15;
  layout.layout.buttons.sandboxControl.opacity = 0.6;
  layout.apply();
  eq(testModeBtn.style._m['--touch-button-scale'], String(1.15 * layout.layout.scale), '沙盒按钮尺寸变量生效');
  eq(testModeBtn.style._m['--touch-button-opacity'], String(0.6 * layout.layout.opacity), '沙盒按钮透明度变量生效');

  // 设置面板：能选到“沙盒控制”，选不到已删除的七个浮动动作。
  const markup = layout.settingsMarkup();
  ok(markup.includes('沙盒控制'), '设置面板含沙盒控制分组');
  ok(markup.includes('value="sandboxControl"'), '设置面板可选沙盒入口按钮');
  for (const id of ['refill', 'spawnOne', 'clearFoxes']) ok(!markup.includes(`value="${id}"`), `设置面板不含已删除动作 ${id}`);

  // 旧存档（只有战斗键 + 旧摇杆装饰内圈字段）：补齐沙盒按钮默认值与真实疾跑阈值，忽略装饰字段。
  storage.clear();
  const oldSave = {
    scale: 1.1, opacity: 0.9,
    buttons: { attack: { x: 0.61, y: 0.67, scale: 1.2, opacity: 0.8 } },
    joystick: { coreSize: 0.9, coreOpacity: 0.5 },
  };
  storage.set('marmot.touch-layout.v1', JSON.stringify(oldSave));
  const layout2 = new TouchLayout();
  approxEq(layout2.layout.buttons.attack.x, 0.61, 1e-9, '旧存档战斗键位置保留');
  approxEq(layout2.layout.scale, 1.1, 1e-9, '旧存档全局缩放保留');
  ok(layout2.layout.buttons.sandboxControl, '旧存档补齐沙盒按钮默认值');
  approxEq(layout2.layout.joystick.sprintThreshold, 0.78, 1e-9, '旧存档缺疾跑阈值 → 默认 0.78');
  ok(!('coreSize' in layout2.layout.joystick), '旧装饰内圈字段被丢弃');

  // 源码/页面静态检查：浮动层与七个动作彻底消失。
  const panelSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'sandbox', 'panel.js'), 'utf8');
  ok(!panelSrc.includes('sandboxTouchLayer') && !panelSrc.includes('SANDBOX_TOUCH_ACTIONS'), 'panel.js 不再创建浮动层');
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  ok(!html.includes('sandboxTouchLayer') && !html.includes('data-sandbox-action="spawnOne"'), 'index.html 无浮动沙盒层/浮动动作按钮');
  eq((html.match(/id="testModeBtn"/g) || []).length, 1, '页面上只有一个 #testModeBtn 沙盒控制入口');

  console.log(`OK ${checks}/${checks}`);
})().catch((e) => { console.error(e); process.exitCode = 1; });
