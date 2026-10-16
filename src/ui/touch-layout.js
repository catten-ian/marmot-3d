/**
 * 触屏技能盘的布局、编辑与持久化。坐标以视口归一化百分比保存，
 * 应用时按安全区和按钮半径夹紧，因此旋转屏幕/窄屏不会把按键挤出画面。
 */
const STORAGE_KEY = 'marmot.touch-layout.v1';
// 疾跑已改为由摇杆拖动距离判定（见 touch-controls SPRINT_STICK_THRESHOLD），不再有独立按钮。
const ACTIONS = ['attack', 'jump', 'interact', 'burst', 'ultimate', 'pause'];
const LABELS = { attack: '攻击', jump: '跳跃', interact: '交互', burst: '爆发', ultimate: '大招', pause: '暂停' };
const SIZE = { attack: 76, jump: 58, interact: 56, burst: 56, ultimate: 58, pause: 38 };
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
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
    this.buttons = Object.fromEntries(ACTIONS.map((id) => [id, this.root?.querySelector(`[data-touch-action="${id}"]`)]));
    this.editing = false;
    this.selected = 'attack';
    this.layout = this._load() || this.defaultLayout();
    this._bindEditor();
    this.apply();
  }

  defaultLayout() {
    const w = Math.max(320, innerWidth || 390), h = Math.max(320, innerHeight || 844);
    const safe = readInsets();
    const landscape = w > h;
    const unit = Math.min(w, h);
    const ax = landscape ? w - safe.right - Math.max(176, unit * .48) : w - safe.right - Math.max(150, w * .4);
    const ay = landscape ? h - safe.bottom - Math.max(154, h * .4) : h - safe.bottom - Math.max(230, h * .273);
    const dx = landscape ? Math.max(66, Math.min(78, unit * .2)) : Math.max(54, Math.min(70, w * .18));
    const dy = landscape ? Math.max(57, Math.min(68, unit * .17)) : Math.max(62, Math.min(76, unit * .2));
    // 攻击居中最大，跳跃正上方，交互/爆发/大招环绕两侧。
    const positions = {
      attack: [ax, ay],
      jump: [ax, ay - 96],
      interact: [ax + dx, ay - dy],
      burst: [ax - dx, ay + dy],
      ultimate: [ax + dx, ay + dy],
      pause: [w - safe.right - 28, safe.top + 61],
    };
    const buttons = {};
    for (const id of ACTIONS) buttons[id] = { x: positions[id][0] / w, y: positions[id][1] / h, scale: 1 };
    return { scale: 1, opacity: 1, buttons };
  }

  _normalize(input) {
    const base = this.defaultLayout();
    if (!input || typeof input !== 'object') return base;
    const out = { scale: clamp(Number(input.scale) || 1, .65, 1.5), opacity: clamp(Number(input.opacity) || 1, .3, 1), buttons: {} };
    for (const id of ACTIONS) {
      const b = input.buttons?.[id] || base.buttons[id];
      out.buttons[id] = {
        x: clamp(Number.isFinite(Number(b.x)) ? Number(b.x) : base.buttons[id].x, 0, 1),
        y: clamp(Number.isFinite(Number(b.y)) ? Number(b.y) : base.buttons[id].y, 0, 1),
        scale: clamp(Number(b.scale) || 1, .65, 1.5),
        opacity: clamp(Number(b.opacity) || 1, .3, 1),
      };
    }
    return out;
  }

  _load() {
    try { const raw = localStorage.getItem(STORAGE_KEY); return raw ? this._normalize(JSON.parse(raw)) : null; }
    catch (_) { return null; }
  }

  _safeCenter(id, x, y, scale, safe, w, h) {
    const size = SIZE[id] * scale * this.layout.scale;
    const half = size / 2 + 4;
    return {
      x: clamp(x, safe.left + half, w - safe.right - half),
      y: clamp(y, safe.top + half, h - safe.bottom - half),
    };
  }

  apply() {
    if (!this.root) return;
    const w = innerWidth, h = innerHeight, safe = readInsets();
    for (const id of ACTIONS) {
      const el = this.buttons[id], item = this.layout.buttons[id];
      if (!el) continue;
      const p = this._safeCenter(id, item.x * w, item.y * h, item.scale, safe, w, h);
      const base = SIZE[id];
      el.style.left = `${p.x}px`; el.style.top = `${p.y}px`;
      el.style.setProperty('--touch-button-size', `${base}px`);
      el.style.setProperty('--touch-button-scale', String(item.scale * this.layout.scale));
      el.style.setProperty('--touch-button-opacity', String(item.opacity * this.layout.opacity));
      // 直接写 inline opacity 兑底：部分旧内核/重复 CSS 规则下，--touch-button-opacity
      // 变量可能未生效，导致调透明度滑块无变化。inline opacity 始终生效。
      el.style.opacity = String(Math.max(0.18, item.opacity * this.layout.opacity));
      el.style.zIndex = id === 'attack' ? '2' : '1';
    }
    this.root.classList.toggle('layout-editing', this.editing);
    document.body.classList.toggle('touch-layout-editing', this.editing);
    const entry = document.getElementById('touchLayoutEntry');
    if (entry) { entry.textContent = this.editing ? '完成编辑' : '编辑'; entry.setAttribute('aria-pressed', String(this.editing)); }
    this._syncEditor();
  }

  setEditing(value = !this.editing) {
    this.editing = !!value;
    if (this.editing) this.selected = this.selected || 'attack';
    this.apply();
  }

  save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(this.layout)); }
    catch (error) { console.warn('触屏布局无法保存到本地存储', error); }
  }

  restoreDefault() {
    this.layout = this.defaultLayout();
    this.save();
    this.apply();
  }

  setSelected(id) { if (ACTIONS.includes(id)) { this.selected = id; this._syncEditor(); } }

  settingsMarkup() {
    return `<section class="touch-layout-settings" aria-label="触屏技能盘设置">
      <h4>触屏技能盘</h4><p>进入编辑后可拖动按钮；选择单键后可单独调尺寸和透明度。</p>
      <div class="layout-setting-row"><label for="layoutGlobalScale">整体大小</label><input id="layoutGlobalScale" type="range" min="0.75" max="1.3" step="0.05" value="${this.layout.scale}"><output data-layout-value="globalScale"></output></div>
      <div class="layout-setting-row"><label for="layoutGlobalOpacity">整体透明度</label><input id="layoutGlobalOpacity" type="range" min="0.35" max="1" step="0.05" value="${this.layout.opacity}"><output data-layout-value="globalOpacity"></output></div>
      <div class="layout-setting-row"><label for="layoutSelected">单个按钮</label><select id="layoutSelected">${ACTIONS.map((id) => `<option value="${id}" ${id === this.selected ? 'selected' : ''}>${LABELS[id]}</option>`).join('')}</select></div>
      <div class="layout-setting-row"><label for="layoutButtonScale">单键大小</label><input id="layoutButtonScale" type="range" min="0.7" max="1.35" step="0.05"><output data-layout-value="buttonScale"></output></div>
      <div class="layout-setting-row"><label for="layoutButtonOpacity">单键透明度</label><input id="layoutButtonOpacity" type="range" min="0.3" max="1" step="0.05"><output data-layout-value="buttonOpacity"></output></div>
      <div class="layout-actions"><button type="button" class="ghost-btn" data-layout-edit>进入拖动编辑</button><button type="button" class="ghost-btn" data-layout-save>保存方案 / 设为默认</button><button type="button" class="ghost-btn" data-layout-reset>恢复设计默认</button></div>
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
    for (const [key, value] of [['globalScale', this.layout.scale], ['globalOpacity', this.layout.opacity], ['buttonScale', item?.scale], ['buttonOpacity', item?.opacity]]) {
      const output = layout.querySelector(`[data-layout-value="${key}"]`);
      if (output) output.value = `${Math.round((value || 0) * 100)}%`;
    }
    const scale = layout.querySelector('#layoutButtonScale'), opacity = layout.querySelector('#layoutButtonOpacity');
    if (scale && item && Number(scale.value) !== item.scale) scale.value = item.scale;
    if (opacity && item && Number(opacity.value) !== item.opacity) opacity.value = item.opacity;
    for (const [id, el] of Object.entries(this.buttons)) el?.classList.toggle('layout-selected', this.editing && id === this.selected);
  }

  _bindEditor() {
    const entry = document.getElementById('touchLayoutEntry');
    entry?.addEventListener('click', () => this.setEditing());
    for (const [id, el] of Object.entries(this.buttons)) {
      if (!el) continue;
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
    window.addEventListener('resize', () => this.apply());
    window.addEventListener('orientationchange', () => setTimeout(() => this.apply(), 80));
  }
}
