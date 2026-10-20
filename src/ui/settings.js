/**
 * 设置界面：键位方案选择与自定义绑定。
 * 方案切换即时生效并持久化到 localStorage。
 */
import { Keybinds, ACTIONS, findConflicts } from '../core/keybinds.js';
import { IS_DEV } from '../core/version.js';
import { INPUT_MODES } from '../core/input-mode.mjs';

const INPUT_MODE_OPTIONS = [
  { id: 'auto', name: '自动', desc: '按设备自动判断；手机/平板首次触摸会自动启用触屏。' },
  { id: 'touch', name: '强制触屏', desc: '始终显示触屏摇杆与动作按钮；桌面端可借此调试触屏布局。' },
  { id: 'keyboard', name: '强制键鼠', desc: '始终使用键盘 + 鼠标视角，即使设备支持触摸也不切换。' },
];

export class SettingsUI {
  constructor(binds, touchLayout = null, feedback = null, inputMode = null) {
    this.binds = binds;
    this.touchLayout = touchLayout;
    this.feedback = feedback;
    this.inputMode = inputMode;
    this.el = {
      btn: document.getElementById('setBtn'),
      sheet: document.getElementById('setSheet'),
      close: document.getElementById('setClose'),
      body: document.getElementById('setBody'),
    };
    this.capturing = null; // 正在等待按键重绑的动作 id

    if (this.el.btn) this.el.btn.onclick = () => this.toggle();
    if (this.el.close) this.el.close.onclick = () => this.close();
    if (this.el.sheet) {
      // 点击面板外部关闭
      this.el.sheet.addEventListener('click', (e) => e.stopPropagation());
      document.addEventListener('click', (e) => {
        if (!this.el.sheet.hidden && !this.el.sheet.contains(e.target)
          && e.target !== this.el.btn) this.close();
      });
    }

    this._onKey = (e) => this._handleCaptureKey(e);
    this._onSchemeChange = () => { if (this.el.sheet && !this.el.sheet.hidden) this.render(); };

    binds.onChange(this._onSchemeChange);
    this.render();
  }

  toggle() {
    if (this.el.sheet.hidden) this.open(); else this.close();
  }

  open() {
    this.el.sheet.hidden = false;
    document.body.classList.add('settings-open');
    this.render();
  }

  close() {
    this.el.sheet.hidden = true;
    document.body.classList.remove('settings-open');
    this.capturing = null;
    if (this._onKey) window.removeEventListener('keydown', this._onKey, true);
    // 关闭设置面板时结束触屏布局拖动编辑（会连带恢复自动暂停的游戏）。
    if (this.touchLayout?.editing) this.touchLayout.setEditing(false);
  }

  /** 进入按键捕获状态 */
  _startCapture(actionId) {
    this.capturing = actionId;
    this.render();
    // 用捕获阶段监听，抢在游戏 keydown 之前拿到按键
    window.addEventListener('keydown', this._onKey, true);
  }

  _handleCaptureKey(e) {
    e.preventDefault();
    e.stopPropagation();
    if (e.code === 'Escape') { // Esc 取消绑定
      this.capturing = null;
      window.removeEventListener('keydown', this._onKey, true);
      this.render();
      return;
    }
    if (this.capturing) {
      this.binds.setKey(this.capturing, e.code);
      this.capturing = null;
    }
    window.removeEventListener('keydown', this._onKey, true);
    this.render();
  }

  render() {
    if (!this.el.body) return;
    const b = this.binds;

    const schemes = [
      { id: 'compatible', name: '兼容方案', desc: '与 v1.0 完全一致，J 爆发 / K 大招 / E 交互' },
      { id: 'optimized', name: '优化方案', desc: IS_DEV
        ? 'A/D 转向、方向键横移；Q-E-R 技能簇，鼠标左键攻击'
        : 'WASD 移动；Q-E-R 技能簇，鼠标左键攻击，空格跳跃' },
      { id: 'custom', name: '自定义', desc: '点击任意动作后按新键位' },
    ];

    let html = '<div class="scheme-row">';
    for (const s of schemes) {
      html += `
        <button class="scheme-card ${b.scheme === s.id ? 'cur' : ''}" data-scheme="${s.id}">
          <div class="scheme-name">${s.name}</div>
          <div class="scheme-desc">${s.desc}</div>
        </button>`;
    }
    html += '</div>';

    if (this.inputMode) {
      const pref = INPUT_MODES.includes(this.inputMode.preference) ? this.inputMode.preference : 'auto';
      const effTouch = this.inputMode.isTouch();
      html += `<section class="input-mode-settings" aria-label="输入模式">
      <h4>输入模式</h4>
      <div class="scheme-row input-mode-row">${INPUT_MODE_OPTIONS.map((m) => `
        <button class="scheme-card ${pref === m.id ? 'cur' : ''}" data-input-mode="${m.id}">
          <div class="scheme-name">${m.name}</div>
          <div class="scheme-desc">${m.desc}</div>
        </button>`).join('')}
      </div>
      <p class="input-mode-status">当前生效：<b>${effTouch ? '触屏' : '键鼠'}</b>${
        pref === 'auto'
          ? `（自动判定${this.inputMode.runtimeTouch && !this.inputMode.deviceTouch ? ' · 已由首次真实触摸升级' : ''}；切换立即生效）`
          : '（强制模式，切换立即生效）'
      }</p>
    </section>`;
    }

    // 触屏布局编辑入口只在有效模式为触屏时可用；键鼠模式隐藏整段，不允许编辑浮动触控控件。
    const touchEffective = this.inputMode ? this.inputMode.isTouch() : true;
    if (this.touchLayout && touchEffective) {
      const adjustOn = !!this.touchLayout.adjustEnabled;
      html += `<section class="touch-adjust-settings" aria-label="触屏布局调整开关">
      <h4>触屏布局调整</h4>
      <label class="touch-adjust-toggle"><input type="checkbox" id="touchAdjustToggle"${adjustOn ? ' checked' : ''}> 启用触屏布局调整</label>
      <p>默认关闭：关闭时游戏画面上的“编辑”按钮和下方的拖动编辑入口都会隐藏。打开后进入调整会自动暂停游戏，退出调整自动继续。</p>
    </section>`;
      html += this.touchLayout.settingsMarkup();
    }

    // 冲突提示
    const conflicts = findConflicts(b.scheme === 'custom' ? b.custom : b.map);
    if (conflicts.size) {
      const list = [...conflicts.entries()].map(([code, acts]) => {
        const names = acts.map((a) => {
          const act = ACTIONS.find((x) => x.id === a);
          return act ? act.label : a;
        }).join(' / ');
        return `<span class="conflict">${Keybinds.pretty(code)} → ${names}</span>`;
      }).join('');
      html += `<div class="conflict-box">键位冲突：${list}</div>`;
    }

    // 绑定列表
    html += '<div class="bind-list">';
    const rows = b.describe();
    for (const r of rows) {
      const keyText = r.empty
        ? '<span class="key mouse">鼠标左键</span>'
        : r.keys.map((k) => `<span class="key">${k}</span>`).join('')
          + (r.alt ? `<span class="key alt">${r.alt}</span>` : '');
      const editable = b.scheme === 'custom';
      html += `
        <div class="bind-row ${this.capturing === r.id ? 'capturing' : ''}">
          <span class="bind-label">${r.label}</span>
          <span class="bind-keys">${keyText}</span>
          ${editable
        ? `<button class="rebind" data-action="${r.id}">${this.capturing === r.id ? '按新键…' : '改键'}</button>`
        : ''}
        </div>`;
    }
    html += '</div>';

    if (b.scheme === 'custom') {
      html += '<div class="set-actions"><button class="ghost-btn" id="resetBinds">恢复默认键位</button></div>';
    }
    if (this.feedback) html += '<div class="set-actions"><button class="ghost-btn" id="settingsFeedback">问题反馈 / 反馈建议</button></div>';

    this.el.body.innerHTML = html;

    // 绑定事件
    this.el.body.querySelectorAll('[data-scheme]').forEach((el) => {
      el.onclick = () => this.binds.setScheme(el.dataset.scheme);
    });
    this.el.body.querySelectorAll('[data-action]').forEach((el) => {
      el.onclick = (ev) => {
        ev.stopPropagation();
        this._startCapture(el.dataset.action);
      };
    });
    const rb = this.el.body.querySelector('#resetBinds');
    if (rb) rb.onclick = () => this.binds.resetCustom();
    const fb = this.el.body.querySelector('#settingsFeedback');
    if (fb) fb.onclick = () => this.feedback.open();
    this.el.body.querySelectorAll('[data-input-mode]').forEach((el) => {
      el.onclick = () => { this.inputMode?.setPreference(el.dataset.inputMode); this.render(); };
    });
    const adjustToggle = this.el.body.querySelector('#touchAdjustToggle');
    adjustToggle?.addEventListener('change', () => this.touchLayout.setAdjustEnabled(adjustToggle.checked));
    this.touchLayout?.bindSettings(this.el.body);
  }
}
