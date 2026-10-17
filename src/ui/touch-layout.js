/**
 * 触屏技能盘的布局、编辑与持久化。坐标以视口归一化百分比保存，
 * 应用时按安全区和按钮半径夹紧，因此旋转屏幕/窄屏不会把按键挤出画面。
 *
 * 管理两类按钮：
 * - 战斗键 data-touch-action（右下动作盘 + 暂停）；
 * - 沙盒键 data-sandbox-action（#sandboxTouchLayer 内的浮动快捷按钮）。
 * 两类 id 互不冲突，编辑态下点击/拖动任意一类都只做选中与布局，
 * 非编辑态各自走原来的 onAction 逻辑。
 */
const STORAGE_KEY = 'marmot.touch-layout.v1';
// “启用触屏布局调整”开关：默认关闭。关闭时所有调整入口隐藏，setEditing(true) 被拒绝。
const ADJUST_STORAGE_KEY = 'marmot.settings.touchLayoutAdjust';
export function touchAdjustEnabled() {
  try { return localStorage.getItem(ADJUST_STORAGE_KEY) === '1'; }
  catch (_) { return false; }
}
export function setTouchAdjustStored(on) {
  try { localStorage.setItem(ADJUST_STORAGE_KEY, on ? '1' : '0'); }
  catch (error) { console.warn('触屏布局调整开关无法写入本地存储', error); }
}
// 疾跑已改为由摇杆拖动距离判定（见 touch-controls SPRINT_STICK_THRESHOLD），不再有独立按钮。
const ACTIONS = ['attack', 'dodge', 'jump', 'interact', 'burst', 'ultimate', 'pause'];
const SANDBOX_ACTIONS = ['refill', 'clearStress', 'charge', 'resetFood', 'spawnOne', 'spawnGroup', 'clearFoxes'];
const ALL_IDS = [...ACTIONS, ...SANDBOX_ACTIONS];
const LABELS = {
  attack: '攻击', dodge: '翻滚', jump: '跳跃', interact: '交互', burst: '爆发', ultimate: '大招', pause: '暂停',
  refill: '沙盒·回满生命', clearStress: '沙盒·清零应激', charge: '沙盒·充满大招', resetFood: '沙盒·重置食物',
  spawnOne: '沙盒·生成 1 只', spawnGroup: '沙盒·生成一群', clearFoxes: '沙盒·清除狐狸',
};
const SIZE = {
  attack: 76, dodge: 58, jump: 58, interact: 56, burst: 56, ultimate: 58, pause: 38,
  refill: 54, clearStress: 54, charge: 54, resetFood: 54, spawnOne: 54, spawnGroup: 54, clearFoxes: 54,
};
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
// 攻击键内圈（触发核心）默认占外圈 55%、不透明度 92%，滑块范围 40-100% / 30-100%。
const ATTACK_CORE_DEFAULTS = { size: 0.55, opacity: 0.92 };
const copy = (v) => JSON.parse(JSON.stringify(v));

function readInsets() {
  const probe = document.getElementById('touchSafeInsets');
  if (!probe) return { top: 0, right: 0, bottom: 0, left: 0 };
  const s = getComputedStyle(probe);
  return { top: parseFloat(s.paddingTop) || 0, right: parseFloat(s.paddingRight) || 0,
    bottom: parseFloat(s.paddingBottom) || 0, left: parseFloat(s.paddingLeft) || 0 };
}

export class TouchLayout {
  constructor() {
    this.root = document.getElementById('touchControls');
    // 可拖动键都在右侧 .touch-actions 动作栏里；pause 在动作栏外，单独从 root 取。
    this.actionLayer = this.root?.querySelector('.touch-actions') || this.root;
    this.adjustEnabled = touchAdjustEnabled();
    // 由 main.js 注入的游戏暂停/恢复钩子；调整态进出时自动暂停/继续。
    this.pauseHooks = null;
    // 本次调整是否由编辑器发起的暂停（调整前已在暂停态则退出调整时保持暂停）。
    this._pausedByEditor = false;
    this.buttons = Object.fromEntries(ACTIONS.map((id) => {
      const scope = id === 'pause' ? this.root : this.actionLayer;
      return [id, scope?.querySelector(`[data-touch-action="${id}"]`)];
    }));
    // 沙盒浮动层由 src/sandbox/panel.js 创建，时间上可能晚于本构造函数；
    // 先按缺失处理，main.js 在创建面板后调用 collectSandboxButtons() 补绑。
    this._collectSandboxButtons(false);
    this.editing = false;
    this.selected = 'attack';
    this.layout = this._load() || this.defaultLayout();
    this._bindEditor();
    this._syncAdjustVisibility();
    this.apply();
  }

  // 沙盒按钮在屏幕左侧竖排（横屏时改为摇杆右侧一行），避开左下摇杆与"编辑"入口。
  _sandboxPositions(w, h, safe, landscape) {
    const pos = {};
    if (landscape) {
      const y = h - safe.bottom - 34;
      SANDBOX_ACTIONS.forEach((id, i) => { pos[id] = [safe.left + 180 + i * 62, y]; });
    } else {
      const x = safe.left + 96;
      SANDBOX_ACTIONS.forEach((id, i) => { pos[id] = [x, h - safe.bottom - (176 + i * 58)]; });
    }
    return pos;
  }

  /** main.js 注入暂停钩子：{ pause(), resume(), isPaused() } */
  setPauseHooks(hooks) { this.pauseHooks = hooks || null; }

  _syncAdjustVisibility() {
    // CSS 据此隐藏/显示所有带 data-touch-adjust 的"调整键"。
    document.documentElement?.setAttribute('data-touch-adjust-enabled', this.adjustEnabled ? 'true' : 'false');
  }

  /** 设置面板里的"启用触屏布局调整"总开关 */
  setAdjustEnabled(on) {
    this.adjustEnabled = !!on;
    setTouchAdjustStored(this.adjustEnabled);
    this._syncAdjustVisibility();
    if (!this.adjustEnabled && this.editing) this.setEditing(false);
    else this.apply();
  }

  defaultLayout() {
    const w = Math.max(320, innerWidth || 390), h = Math.max(320, innerHeight || 844);
    const safe = readInsets();
    const landscape = w > h;
    const unit = Math.min(w, h);
    const ax = landscape ? w - safe.right - Math.max(176, unit * .48) : w - safe.right - Math.max(150, w * .4);
    const ay = landscape ? h - safe.bottom - Math.max(154, h * .4) : h - safe.bottom - Math.max(230, h * .273);
    const dx = landscape ? Math.max(66, Math.min(78, unit * .2)) : Math.max(54, Math.min(70, w * .18));
    const dy = landscape ? Math.max(57, Math.min(68, unit * .17)) : Math.max(62, Math.min(76, h * .2));
    // 攻击居中最大，跳跃正上方，交互/爆发/大招环绕两侧。
    const positions = {
      attack: [ax, ay],
      dodge: [ax - dx, ay - dy * 0.4],
      jump: [ax, ay - 96],
      interact: [ax + dx, ay - dy],
      burst: [ax - dx, ay + dy],
      ultimate: [ax + dx, ay + dy],
      pause: [w - safe.right - 28, safe.top + 61],
      ...this._sandboxPositions(w, h, safe, landscape),
    };
    const buttons = {};
    for (const id of ALL_IDS) buttons[id] = { x: positions[id][0] / w, y: positions[id][1] / h, scale: 1 };
    buttons.attack.coreSize = ATTACK_CORE_DEFAULTS.size;
    buttons.attack.coreOpacity = ATTACK_CORE_DEFAULTS.opacity;
    return { scale: 1, opacity: 1, buttons };
  }

  _normalize(input) {
    const base = this.defaultLayout();
    if (!input || typeof input !== 'object') return base;
    const out = { scale: clamp(Number(input.scale) || 1, .65, 1.5), opacity: clamp(Number(input.opacity) || 1, .3, 1), buttons: {} };
    for (const id of ALL_IDS) {
      const b = input.buttons?.[id] || base.buttons[id];
      out.buttons[id] = {
        x: clamp(Number.isFinite(Number(b.x)) ? Number(b.x) : base.buttons[id].x, 0, 1),
        y: clamp(Number.isFinite(Number(b.y)) ? Number(b.y) : base.buttons[id].y, 0, 1),
        scale: clamp(Number(b.scale) || 1, .65, 1.5),
        opacity: clamp(Number(b.opacity) || 1, .3, 1),
      };
      if (id === 'attack') {
        // 兼容平铺别名 attackCoreSize / attackCoreOpacity（与 buttons.attack.coreSize 同义）。
        const sizeSrc = b.coreSize ?? input.attackCoreSize;
        const opacitySrc = b.coreOpacity ?? input.attackCoreOpacity;
        out.buttons[id].coreSize = clamp(Number.isFinite(Number(sizeSrc)) ? Number(sizeSrc) : ATTACK_CORE_DEFAULTS.size, .4, 1);
        out.buttons[id].coreOpacity = clamp(Number.isFinite(Number(opacitySrc)) ? Number(opacitySrc) : ATTACK_CORE_DEFAULTS.opacity, .3, 1);
      }
    }
    return out;
  }

  _load() {
    try { const raw = localStorage.getItem(STORAGE_KEY); return raw ? this._normalize(JSON.parse(raw)) : null; }
    catch (_) { return null; }
  }

  _safeCenter(id, x, y, scale, safe, w, h) {
    const size = (SIZE[id] || 54) * scale * this.layout.scale;
    const half = size / 2 + 4;
    return {
      x: clamp(x, safe.left + half, w - safe.right - half),
      y: clamp(y, safe.top + half, h - safe.bottom - half),
    };
  }

  apply() {
    if (!this.root) return;
    const w = innerWidth, h = innerHeight, safe = readInsets();
    for (const id of ALL_IDS) {
      const el = this.buttons[id], item = this.layout.buttons[id];
      if (!el || !item) continue;
      const p = this._safeCenter(id, item.x * w, item.y * h, item.scale, safe, w, h);
      const base = SIZE[id] || 54;
      el.style.left = `${p.x}px`; el.style.top = `${p.y}px`;
      el.style.setProperty('--touch-button-size', `${base}px`);
      el.style.setProperty('--touch-button-scale', String(item.scale * this.layout.scale));
      el.style.setProperty('--touch-button-opacity', String(item.opacity * this.layout.opacity));
      // 直接写 inline opacity 兑底：部分旧内核/重复 CSS 规则下，--touch-button-opacity
      // 变量可能未生效，导致调透明度滑块无变化。inline opacity 始终生效。
      el.style.opacity = String(Math.max(0.18, item.opacity * this.layout.opacity));
      if (id === 'attack') {
        el.style.setProperty('--attack-core-scale', String(item.coreSize ?? ATTACK_CORE_DEFAULTS.size));
        el.style.setProperty('--attack-core-opacity', String(item.coreOpacity ?? ATTACK_CORE_DEFAULTS.opacity));
      }
      el.style.zIndex = id === 'attack' ? '2' : '1';
    }
    this.root.classList.toggle('layout-editing', this.editing);
    document.body.classList.toggle('touch-layout-editing', this.editing);
    const entry = document.getElementById('touchLayoutEntry');
    if (entry) { entry.textContent = this.editing ? '完成编辑' : '编辑'; entry.setAttribute('aria-pressed', String(this.editing)); }
    this._syncEditor();
  }

  setEditing(value = !this.editing) {
    const next = !!value;
    // 总开关关闭时拒绝进入编辑态（即便有残留的编辑状态也立即退出）。
    if (next && !this.adjustEnabled) {
      if (this.editing) this._stopEditing();
      else { this.editing = false; this.apply(); }
      return;
    }
    if (next === this.editing) { this.apply(); return; }
    if (next) this._startEditing();
    else this._stopEditing();
    this.apply();
  }

  _startEditing() {
    this.editing = true;
    this.selected = this.selected || 'attack';
    const alreadyPaused = !!this.pauseHooks?.isPaused?.();
    if (alreadyPaused) {
      this._pausedByEditor = false;
    } else {
      this._pausedByEditor = true;
      this.pauseHooks?.pause?.();
    }
  }

  _stopEditing() {
    this.editing = false;
    // 只在暂停确由本次调整发起时才恢复；调整前已暂停则保持暂停。
    if (this._pausedByEditor) {
      this._pausedByEditor = false;
      this.pauseHooks?.resume?.();
    }
  }

  save() {
    try {
      // 攻击键内圈参数同时平铺为 attackCoreSize / attackCoreOpacity 别名，便于外部读取。
      const data = {
        ...this.layout,
        attackCoreSize: this.layout.buttons.attack.coreSize,
        attackCoreOpacity: this.layout.buttons.attack.coreOpacity,
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (error) { console.warn('触屏布局无法保存到本地存储', error); }
  }

  restoreDefault() {
    this.layout = this.defaultLayout();
    this.save();
    this.apply();
  }

  setSelected(id) { if (ALL_IDS.includes(id)) { this.selected = id; this._syncEditor(); } }

  // 绑定 #sandboxTouchLayer 内的沙盒按钮；面板创建后由 main.js 调用一次。
  collectSandboxButtons() { this._collectSandboxButtons(true); }

  _collectSandboxButtons(rebind) {
    const layer = document.getElementById('sandboxTouchLayer');
    if (!layer) return;
    let changed = false;
    for (const id of SANDBOX_ACTIONS) {
      if (this.buttons?.[id]) continue;
      const el = layer.querySelector(`[data-sandbox-action="${id}"]`);
      if (el) {
        this.buttons[id] = el;
        if (rebind !== false) this._bindButton(id, el);
        changed = true;
      }
    }
    if (changed && rebind !== false) this.apply();
  }

  settingsMarkup() {
    const options = (ids) => ids.map((id) => `<option value="${id}" ${id === this.selected ? 'selected' : ''}>${LABELS[id]}</option>`).join('');
    return `<section class="touch-layout-settings" aria-label="触屏技能盘设置">
      <h4>触屏技能盘</h4><p>进入编辑后可拖动按钮；选择单键后可单独调尺寸和透明度。沙盒按钮仅在自由测试沙盒（或编辑态）中显示。</p>
      <div class="layout-setting-row"><label for="layoutGlobalScale">整体大小</label><input id="layoutGlobalScale" type="range" min="0.75" max="1.3" step="0.05" value="${this.layout.scale}"><output data-layout-value="globalScale"></output></div>
      <div class="layout-setting-row"><label for="layoutGlobalOpacity">整体透明度</label><input id="layoutGlobalOpacity" type="range" min="0.35" max="1" step="0.05" value="${this.layout.opacity}"><output data-layout-value="globalOpacity"></output></div>
      <div class="layout-setting-row"><label for="layoutSelected">单个按钮</label><select id="layoutSelected"><optgroup label="战斗动作">${options(ACTIONS)}</optgroup><optgroup label="沙盒控制">${options(SANDBOX_ACTIONS)}</optgroup></select></div>
      <div class="layout-setting-row"><label for="layoutButtonScale">单键大小</label><input id="layoutButtonScale" type="range" min="0.7" max="1.35" step="0.05"><output data-layout-value="buttonScale"></output></div>
      <div class="layout-setting-row"><label for="layoutButtonOpacity">单键透明度</label><input id="layoutButtonOpacity" type="range" min="0.3" max="1" step="0.05"><output data-layout-value="buttonOpacity"></output></div>
      <div class="layout-setting-row attack-core-row"><label for="layoutAttackCoreSize">内圈大小 (40-100%)</label><input id="layoutAttackCoreSize" type="range" min="0.4" max="1" step="0.01"><output data-layout-value="attackCoreSize"></output></div>
      <div class="layout-setting-row attack-core-row"><label for="layoutAttackCoreOpacity">内圈透明度 (30-100%)</label><input id="layoutAttackCoreOpacity" type="range" min="0.3" max="1" step="0.01"><output data-layout-value="attackCoreOpacity"></output></div>
      <div class="layout-actions" data-touch-adjust="actions"><button type="button" class="ghost-btn" data-layout-edit>进入拖动编辑</button><button type="button" class="ghost-btn" data-layout-save>保存方案 / 设为默认</button><button type="button" class="ghost-btn" data-layout-reset>恢复设计默认</button></div>
      <p class="layout-save-status" aria-live="polite">保存后当前布局成为刷新/重进后的默认方案。</p>
    </section>`;
  }

  bindSettings(container) {
    const byId = (id) => container.querySelector(`#${id}`);
    const globalScale = byId('layoutGlobalScale'), globalOpacity = byId('layoutGlobalOpacity');
    const btnScale = byId('layoutButtonScale'), btnOpacity = byId('layoutButtonOpacity');
    const selected = byId('layoutSelected');
    globalScale?.addEventListener('input', () => { this.layout.scale = Number(globalScale.value); this.apply(); });
    globalOpacity?.addEventListener('input', () => { this.layout.opacity = Number(globalOpacity.value); this.apply(); });
    selected?.addEventListener('change', () => this.setSelected(selected.value));
    btnScale?.addEventListener('input', () => { this.layout.buttons[this.selected].scale = Number(btnScale.value); this.apply(); });
    btnOpacity?.addEventListener('input', () => { this.layout.buttons[this.selected].opacity = Number(btnOpacity.value); this.apply(); });
    // 攻击键内圈：拖动即时写 CSS 变量（apply 内），并立即持久化到既有布局字典。
    const coreSize = byId('layoutAttackCoreSize'), coreOpacity = byId('layoutAttackCoreOpacity');
    coreSize?.addEventListener('input', () => { this.layout.buttons.attack.coreSize = Number(coreSize.value); this.apply(); this.save(); });
    coreOpacity?.addEventListener('input', () => { this.layout.buttons.attack.coreOpacity = Number(coreOpacity.value); this.apply(); this.save(); });
    container.querySelector('[data-layout-edit]')?.addEventListener('click', (e) => {
      this.setEditing(!this.editing); e.currentTarget.textContent = this.editing ? '完成拖动编辑' : '进入拖动编辑';
      if (this.editing) {
        const sheet = document.getElementById('setSheet');
        if (sheet && !sheet.hidden) { sheet.hidden = true; document.body.classList.remove('settings-open'); }
      }
    });
    container.querySelector('[data-layout-save]')?.addEventListener('click', () => {
      this.save(); const status = container.querySelector('.layout-save-status'); if (status) status.textContent = '已保存：当前布局已设为默认方案。';
    });
    container.querySelector('[data-layout-reset]')?.addEventListener('click', () => {
      this.restoreDefault(); if (globalScale) globalScale.value = this.layout.scale; if (globalOpacity) globalOpacity.value = this.layout.opacity;
      const status = container.querySelector('.layout-save-status'); if (status) status.textContent = '已恢复并保存设计默认排布。';
    });
    this._syncEditor();
  }

  _syncEditor() {
    const layout = document.getElementById('setBody');
    if (!layout) return;
    const item = this.layout.buttons[this.selected];
    const isAttack = this.selected === 'attack';
    const corePairs = isAttack
      ? [['attackCoreSize', item?.coreSize ?? ATTACK_CORE_DEFAULTS.size], ['attackCoreOpacity', item?.coreOpacity ?? ATTACK_CORE_DEFAULTS.opacity]]
      : [];
    for (const [key, value] of [['globalScale', this.layout.scale], ['globalOpacity', this.layout.opacity], ['buttonScale', item?.scale], ['buttonOpacity', item?.opacity], ...corePairs]) {
      const output = layout.querySelector(`[data-layout-value="${key}"]`);
      if (output) output.value = `${Math.round((value || 0) * 100)}%`;
    }
    const scale = layout.querySelector('#layoutButtonScale'), opacity = layout.querySelector('#layoutButtonOpacity');
    if (scale && item && Number(scale.value) !== item.scale) scale.value = item.scale;
    if (opacity && item && Number(opacity.value) !== item.opacity) opacity.value = item.opacity;
    // 内圈两行只在选中攻击键时出现。
    const coreSize = layout.querySelector('#layoutAttackCoreSize'), coreOpacity = layout.querySelector('#layoutAttackCoreOpacity');
    layout.querySelectorAll('.attack-core-row').forEach((row) => { row.style.display = isAttack ? '' : 'none'; });
    if (isAttack) {
      if (coreSize && Number(coreSize.value) !== item.coreSize) coreSize.value = item.coreSize;
      if (coreOpacity && Number(coreOpacity.value) !== item.coreOpacity) coreOpacity.value = item.coreOpacity;
    }
    for (const [id, el] of Object.entries(this.buttons)) el?.classList.toggle('layout-selected', this.editing && id === this.selected);
  }

  _bindEditor() {
    const entry = document.getElementById('touchLayoutEntry');
    entry?.addEventListener('click', () => this.setEditing());
    for (const [id, el] of Object.entries(this.buttons)) {
      if (el) this._bindButton(id, el);
    }
    window.addEventListener('resize', () => this.apply());
    window.addEventListener('orientationchange', () => setTimeout(() => this.apply(), 80));
  }

  // 单个按钮的编辑态选中/拖动绑定（幂等，collectSandboxButtons 后补绑时复用）。
  _bindButton(id, el) {
    if (!el || el.__touchLayoutBound) return;
    el.__touchLayoutBound = true;
    el.addEventListener('click', (event) => { if (this.editing) { event.preventDefault(); event.stopImmediatePropagation(); this.setSelected(id); } }, true);
    let drag = null;
    const start = (x, y, event, pointerId = null) => {
      if (!this.editing) return false;
      event.preventDefault(); event.stopImmediatePropagation();
      this.setSelected(id);
      drag = { pointerId, dx: x - el.getBoundingClientRect().left - el.offsetWidth / 2, dy: y - el.getBoundingClientRect().top - el.offsetHeight / 2 };
      el.classList.add('layout-dragging');
      if (pointerId != null) { try { el.setPointerCapture(pointerId); } catch (_) {} }
      return true;
    };
    const move = (x, y) => {
      if (!drag) return;
      const w = innerWidth, h = innerHeight, safe = readInsets();
      const pos = this._safeCenter(id, x - drag.dx, y - drag.dy, this.layout.buttons[id].scale, safe, w, h);
      this.layout.buttons[id].x = pos.x / w; this.layout.buttons[id].y = pos.y / h; this.apply();
    };
    const end = () => { if (drag) { drag = null; el.classList.remove('layout-dragging'); } };
    el.addEventListener('pointerdown', (event) => { if (event.pointerType !== 'touch' && (event.pointerType === 'mouse' || this.editing)) start(event.clientX, event.clientY, event, event.pointerId); }, true);
    el.addEventListener('pointermove', (event) => { if (drag?.pointerId === event.pointerId) { event.preventDefault(); event.stopImmediatePropagation(); move(event.clientX, event.clientY); } }, true);
    for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) el.addEventListener(name, (event) => { if (drag?.pointerId === event.pointerId) end(); }, true);
    el.addEventListener('touchstart', (event) => {
      if (!this.editing || !event.changedTouches.length) return;
      const t = event.changedTouches[0]; start(t.clientX, t.clientY, event, t.identifier);
    }, { capture: true, passive: false });
    el.addEventListener('touchmove', (event) => {
      if (!drag || !this.editing) return;
      const t = [...event.changedTouches].find((x) => x.identifier === drag.pointerId);
      if (t) { event.preventDefault(); event.stopImmediatePropagation(); move(t.clientX, t.clientY); }
    }, { capture: true, passive: false });
    for (const name of ['touchend', 'touchcancel']) el.addEventListener(name, (event) => {
      if (drag && [...event.changedTouches].some((x) => x.identifier === drag.pointerId)) end();
    }, true);
  }
}
