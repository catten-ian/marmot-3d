/**
 * 设置界面：键位方案选择与自定义绑定。
 * 方案切换即时生效并持久化到 localStorage。
 */
import { Keybinds, ACTIONS, CONTROL_MODE_OPTIONS, findConflicts } from '../core/keybinds.js';
import { IS_BETA, IS_DEV, VERSION } from '../core/version.js';
import { INPUT_MODES } from '../core/input-mode.mjs';
import { versionSwitchModel } from '../core/version-switch.mjs';

const GRAPHICS_OPTIONS = [
  { id: 'auto', name: '自动', desc: '保留浏览器默认 GPU 选择。' },
  { id: 'high-performance', name: '高性能', desc: '提示优先选择高性能适配器。' },
  { id: 'power-saving', name: '省电', desc: '提示优先选择低功耗适配器，适合集成 GPU。' },
];

const INPUT_MODE_OPTIONS = [
  { id: 'auto', name: '自动', desc: '按设备自动判断；手机/平板首次触摸会自动启用触屏。' },
  { id: 'touch', name: '强制触屏', desc: '始终显示触屏摇杆与动作按钮；桌面端可借此调试触屏布局。' },
  { id: 'keyboard', name: '强制键鼠', desc: '始终使用键盘 + 鼠标视角，即使设备支持触摸也不切换。' },
];

export class SettingsUI {
  constructor(binds, touchLayout = null, feedback = null, inputMode = null, graphicsPreference = null, audio = null) {
    this.binds = binds;
    this.touchLayout = touchLayout;
    this.feedback = feedback;
    this.inputMode = inputMode;
    this.graphicsPreference = graphicsPreference;
    this.audio = audio;
    this.el = {
      btn: document.getElementById('setBtn'),
      sheet: document.getElementById('setSheet'),
      close: document.getElementById('setClose'),
      body: document.getElementById('setBody'),
    };
    this.capturing = null; // 正在等待按键重绑的动作 id
    // 由 main.js 注入的暂停钩子：游戏中打开设置会暂停，关闭时仅在本次发起暂停时恢复。
    this.pauseHooks = null;
    this._pausedByPanel = false;

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

  /** main.js 注入：{ pause(), resume(), isPaused(), isPlaying() } */
  setPauseHooks(hooks) { this.pauseHooks = hooks || null; }

  _pauseForPanel() {
    // 只在真正游戏中才由面板发起暂停；标题/已暂停/结算等状态保持原样。
    if (this.pauseHooks?.isPlaying?.() && !this.pauseHooks.isPaused?.()) {
      this.pauseHooks.pause?.();
      this._pausedByPanel = !!this.pauseHooks.isPaused?.();
    } else {
      this._pausedByPanel = false;
    }
  }

  _resumeFromPanel() {
    if (this._pausedByPanel) {
      this._pausedByPanel = false;
      this.pauseHooks?.resume?.();
    }
  }

  /** Hand the pause started by this sheet to the layout editor when the sheet is dismissed for editing. */
  transferPauseToLayoutEditor() {
    if (!this._pausedByPanel || !this.touchLayout?.editing) return false;
    this._pausedByPanel = false;
    this.touchLayout.adoptExistingPause?.();
    return true;
  }

  toggle() {
    if (this.el.sheet.hidden) this.open(); else this.close();
  }

  open() {
    this.el.sheet.hidden = false;
    document.body.classList.add('settings-open');
    this._pauseForPanel();
    this.render();
  }

  close() {
    this.el.sheet.hidden = true;
    document.body.classList.remove('settings-open');
    this.capturing = null;
    if (this._onKey) window.removeEventListener('keydown', this._onKey, true);
    // 先退出布局编辑（仅当编辑是暂停发起方时它会恢复），再处理本面板发起的暂停，
    // 避免编辑态仍在时游戏被提前恢复。
    if (this.touchLayout?.editing) this.touchLayout.setEditing(false);
    this._resumeFromPanel();
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
      { id: 'compatible', name: '兼容方案', desc: '与 v1.0 键位一致，J 爆发 / K 大招 / E 交互' },
      { id: 'optimized', name: '优化方案', desc: IS_DEV
        ? '开发版原有 A/D 转向；Q-E-R 技能簇，鼠标左键攻击'
        : 'Q/R 技能簇，鼠标左键攻击，空格跳跃；移动方式由操控模式单独决定' },
      { id: 'custom', name: '自定义', desc: '点击任意动作后按新键位' },
    ];

    let html = '';
    if (IS_BETA) {
      html += `<section class="control-mode-settings" aria-label="操控模式">
        <h4>操控模式</h4>
        <div class="scheme-row control-mode-row">${CONTROL_MODE_OPTIONS.map((mode) => `
          <button class="scheme-card ${b.controlMode === mode.id ? 'cur' : ''}" data-control-mode="${mode.id}">
            <div class="scheme-name">${mode.name}${mode.id === 'driving' ? '（默认/新）' : ''}</div>
            <div class="scheme-desc">${mode.id === 'classic' ? '经典横移（WASD strafe，旧）' : mode.desc}</div>
          </button>`).join('')}
        </div>
        <p>此选择同时适用于兼容、优化和自定义键位方案；方向键左右跟随当前模式。</p>
      </section>`;
    }
    html += '<div class="scheme-row">';
    for (const s of schemes) {
      html += `
        <button class="scheme-card ${b.scheme === s.id ? 'cur' : ''}" data-scheme="${s.id}">
          <div class="scheme-name">${s.name}</div>
          <div class="scheme-desc">${s.desc}</div>
        </button>`;
    }
    html += '</div>';

    if (IS_BETA && this.audio) {
      const audioSettings = this.audio.getAudioSettings();
      html += `<section class="audio-settings" aria-label="音频设置">
        <h4>音频</h4>
        <label class="audio-slider" for="audioMasterVolume">
          <span>总音量 <output id="audioMasterValue">${audioSettings.masterVolume}%</output></span>
          <input id="audioMasterVolume" type="range" min="0" max="100" step="1" value="${audioSettings.masterVolume}">
        </label>
        <label class="audio-slider" for="audioSfxVolume">
          <span>音效音量 <output id="audioSfxValue">${audioSettings.sfxVolume}%</output></span>
          <input id="audioSfxVolume" type="range" min="0" max="100" step="1" value="${audioSettings.sfxVolume}">
        </label>
        <label class="audio-slider" for="audioBgmVolume">
          <span>音乐音量 <output id="audioBgmValue">${audioSettings.bgmVolume}%</output></span>
          <input id="audioBgmVolume" type="range" min="0" max="100" step="1" value="${audioSettings.bgmVolume}">
        </label>
        <div class="audio-toggles">
          <label><input id="audioSfxEnabled" type="checkbox"${audioSettings.sfxEnabled ? ' checked' : ''}> 启用音效</label>
          <label><input id="audioBgmEnabled" type="checkbox"${audioSettings.bgmEnabled ? ' checked' : ''}> 启用音乐</label>
        </div>
        <p>音量会立即生效并保存在本设备；音频文件缺失时会自动使用内置音效。</p>
      </section>`;
    }

    if (this.graphicsPreference) {
      const pref = GRAPHICS_OPTIONS.some((item) => item.id === this.graphicsPreference.preference)
        ? this.graphicsPreference.preference : 'auto';
      html += `<section class="graphics-settings" aria-label="图形适配器偏好">
      <h4>图形适配器偏好</h4>
      <label for="graphicsPreference">GPU 选择提示</label>
      <select id="graphicsPreference" aria-describedby="graphicsPreferenceHelp">${GRAPHICS_OPTIONS.map((item) => `
        <option value="${item.id}"${pref === item.id ? ' selected' : ''}>${item.name}</option>`).join('')}
      </select>
      <p id="graphicsPreferenceHelp">${GRAPHICS_OPTIONS.find((item) => item.id === pref)?.desc || ''} 更改后会保存，并在重新加载页面后生效；不会实时切换硬件。</p>
    </section>`;
    }

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

    // 布局自定义分两种：
    //  - 触屏模式：总开关 + 动作按钮/摇杆/HUD 卡全套（settingsMarkup）。
    //  - 键鼠模式：只提供常驻 HUD 信息卡的拖动/大小/透明度（keyboardSettingsMarkup），
    //    不显示虚拟摇杆与触屏动作按钮，进入编辑仍自动暂停。
    const touchEffective = this.inputMode ? this.inputMode.isTouch() : true;
    if (this.touchLayout && touchEffective) {
      const adjustOn = !!this.touchLayout.adjustEnabled;
      html += `<section class="touch-adjust-settings" aria-label="触屏布局调整开关">
      <h4>触屏布局调整</h4>
      <label class="touch-adjust-toggle"><input type="checkbox" id="touchAdjustToggle"${adjustOn ? ' checked' : ''}> 启用触屏布局调整</label>
      <p>默认关闭：关闭时游戏画面上的“编辑”按钮和下方的拖动编辑入口都会隐藏。打开后进入调整会自动暂停游戏，退出调整自动继续。</p>
    </section>`;
      html += this.touchLayout.settingsMarkup();
    } else if (this.touchLayout) {
      html += this.touchLayout.keyboardSettingsMarkup();
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
    html += this._versionMarkup();
    if (this.feedback) html += '<div class="set-actions"><button class="ghost-btn" id="settingsFeedback">问题反馈 / 反馈建议</button></div>';

    this.el.body.innerHTML = html;

    // 绑定事件
    this.el.body.querySelectorAll('[data-scheme]').forEach((el) => {
      el.onclick = () => this.binds.setScheme(el.dataset.scheme);
    });
    this.el.body.querySelectorAll('[data-control-mode]').forEach((el) => {
      el.onclick = () => this.binds.setControlMode(el.dataset.controlMode);
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
    if (IS_BETA && this.audio) {
      const sliderSettings = [
        ['audioMasterVolume', 'masterVolume', 'audioMasterValue'],
        ['audioSfxVolume', 'sfxVolume', 'audioSfxValue'],
        ['audioBgmVolume', 'bgmVolume', 'audioBgmValue'],
      ];
      for (const [inputId, key, outputId] of sliderSettings) {
        const input = this.el.body.querySelector(`#${inputId}`);
        const output = this.el.body.querySelector(`#${outputId}`);
        input?.addEventListener('input', () => {
          const next = Number(input.value);
          this.audio.setSettings({ [key]: next });
          if (output) output.value = `${next}%`;
          if (output) output.textContent = `${next}%`;
        });
      }
      for (const [inputId, key] of [['audioSfxEnabled', 'sfxEnabled'], ['audioBgmEnabled', 'bgmEnabled']]) {
        const input = this.el.body.querySelector(`#${inputId}`);
        input?.addEventListener('change', () => this.audio.setSettings({ [key]: input.checked }));
      }
    }
    const graphicsSelect = this.el.body.querySelector('#graphicsPreference');
    graphicsSelect?.addEventListener('change', () => {
      this.graphicsPreference?.setPreference(graphicsSelect.value);
      this.render();
    });
    this.el.body.querySelectorAll('[data-input-mode]').forEach((el) => {
      el.onclick = () => { this.inputMode?.setPreference(el.dataset.inputMode); this.render(); };
    });
    const adjustToggle = this.el.body.querySelector('#touchAdjustToggle');
    adjustToggle?.addEventListener('change', () => this.touchLayout.setAdjustEnabled(adjustToggle.checked));
    this.touchLayout?.bindSettings(this.el.body);
  }

  _versionMarkup() {
    const model = versionSwitchModel(VERSION, {
      pathname: location.pathname,
      origin: location.origin,
    });
    const cards = model.options.map((o) => `
        <a class="scheme-card version-card ${o.current ? 'cur' : ''}" href="${o.href}">
          <div class="scheme-name">${o.name}${o.current ? ' · 当前' : ''}</div>
          <div class="scheme-desc">${o.desc}</div>
        </a>`).join('');
    return `<section class="version-settings" aria-label="版本切换">
      <h4>版本</h4>
      <div class="scheme-row version-row">${cards}</div>
      <p class="version-note">切换版本会重新加载页面；三档存档与资源相互隔离。DEV 写实素材也可从 <a href="https://www.catten.cyou/marmot3d-assets/" target="_blank" rel="noopener">素材资源桶</a> 下载到本地使用。</p>
    </section>`;
  }
}
