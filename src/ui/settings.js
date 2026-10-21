/**
 * 设置界面：键位方案选择与自定义绑定。
 * 方案切换即时生效并持久化到 localStorage。
 */
import { Keybinds, ACTIONS, findConflicts } from '../core/keybinds.js';
import { IS_DEV, VERSION, USE_REAL_MODELS, USE_REAL_FOX_MODEL, FORCE_WEBGL, GS_OVERRIDE } from '../core/version.js';
import { versionSwitchModel } from '../core/version-switch.mjs';
import { INPUT_MODES } from '../core/input-mode.mjs';
import { getModelStatus, getAssetResolutionStatus, instantiate, clearModelCache } from '../models/loader.js';
import { getLocalPackStatus, installLocalPackUI } from '../world/local-pack.js';

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
    html += this._versionMarkup();
    if (IS_DEV) html += this._resourceMarkup();
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
    if (IS_DEV) {
      const refresh = this.el.body.querySelector('#resourceRefresh');
      refresh?.addEventListener('click', () => this.render());
      const reload = this.el.body.querySelector('#resourceReload');
      reload?.addEventListener('click', () => window.location.reload());
      this.el.body.querySelectorAll('[data-resource-retry]').forEach((el) => el.addEventListener('click', async () => {
        const key = el.dataset.resourceRetry;
        const url = key === 'fox' ? './assets/models/fox-segmented.glb' : key === 'marmot' ? './assets/models/marmot.glb' : key.startsWith('asset:') ? `./${key.slice(6)}` : null;
        if (!url) return;
        if (key === 'fox' || key === 'marmot') { clearModelCache(); await instantiate(url, key); }
        else { try { await fetch(url, { cache: 'no-store' }); } catch (_) {} }
        this.render();
      }));
      installLocalPackUI({ onChange: () => this.render() });
    }
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
        <a class="scheme-card version-card ${o.current ? 'cur' : ''}" href="${o.href}" data-version-href="${o.id}">
          <div class="scheme-name">${o.name}${o.current ? ' · 当前' : ''}</div>
          <div class="scheme-desc">${o.desc}</div>
        </a>`).join('');
    return `<section class="version-settings" aria-label="版本切换">
      <h4>版本</h4>
      <div class="scheme-row version-row">${cards}</div>
      <p class="version-note">切换版本会重新加载页面；三档存档与资源相互隔离。DEV 写实素材也可从 <a href="https://www.catten.cyou/marmot3d-assets/" target="_blank" rel="noopener">素材资源桶</a> 下载到本地使用。</p>
    </section>`;
  }

  _resourceMarkup() {
    const models = getModelStatus();
    const local = getLocalPackStatus();
    const resolutions = getAssetResolutionStatus();
    const rows = [
      ['assets/verdant/verdant-trail.glb', '场景模型', 'pending', 'asset:assets/verdant/verdant-trail.glb'],
      ['assets/verdant/verdant-trail-height.json', '地形高度', 'pending', 'asset:assets/verdant/verdant-trail-height.json'],
      ['assets/verdant/manifest.json', '资源清单', 'pending', 'asset:assets/verdant/manifest.json'],
      ['assets/models/marmot.glb', 'marmot.glb', models.marmot?.level || 'pending', 'marmot'],
      ['assets/models/fox-segmented.glb', 'fox-segmented.glb', models.fox?.level || 'pending', 'fox'],
      ['assets/models/fox.glb', 'fox.glb（备用）', 'pending', 'asset:assets/models/fox.glb'],
      ['assets/models/terrain.glb', 'terrain.glb（备用）', 'pending', 'asset:assets/models/terrain.glb'],
    ];
    const level = (v) => ({ 'geometry-only': 'geometry-only', 'loading-slow': 'loading-slow', full: 'full', failed: 'failed', procedural: 'procedural' }[v] || v || 'pending');
    const source = (path) => resolutions[path]?.source === 'local' ? `本地资源包 · ${resolutions[path].inPackPath || path}` : local.found.includes(path) ? `本地资源包 · ${path}` : '服务器 URL';
    const rowHtml = rows.map(([path, label, lv, key]) => {
      const m = key ? models[key] : null;
      const missing = !local.found.includes(path) && path.startsWith('assets/');
      return `<div class="resource-row"><code>${label}</code><span>${source(path)}</span><span>级别：${level(lv)}</span><span>贴图：${m ? (m.textured ? '是' : '否') : '—'}</span><span>三角面：${m?.tris || '—'}</span><span>字节：—</span><span class="resource-error">${m?.error || (missing ? `缺少：${path}` : '')}</span>${key ? `<button class="ghost-btn" data-resource-retry="${key}">重试</button>` : ''}</div>`;
    }).join('');
    return `<section class="resource-loading-settings" aria-label="资源加载"><h4>资源加载</h4><div class="resource-env"><b>环境：</b> IS_DEV=${IS_DEV} · USE_REAL_MODELS=${USE_REAL_MODELS} · USE_REAL_FOX_MODEL=${USE_REAL_FOX_MODEL} · FORCE_WEBGL=${FORCE_WEBGL} · GS_OVERRIDE=${GS_OVERRIDE ?? 'auto'} · renderer=${window.__resourceRendererBackend || 'webgl'}<br><b>本地资源包：</b> ${local.state} · ${local.message} · 已找到 ${local.found.length}/${local.required.length}${local.rootName ? ` · 根目录 ${local.rootName}` : ''}</div><div class="resource-actions"><button class="ghost-btn" id="resourceRefresh">刷新/重新检测</button><button class="ghost-btn" data-local-pack-choose>选择资源包文件夹</button><button class="ghost-btn" id="resourceReload">重新载入页面</button><input type="file" data-local-pack-input webkitdirectory directory multiple hidden></div><div class="resource-downloads">下载：<a href="./release/verdant-models.zip" download>模型包</a> · <a href="./release/verdant-overlay-runtime.zip" download>overlay 运行时包</a></div><div class="resource-table">${rowHtml}</div><p class="resource-note">期望包内路径：${local.required.join('、')}。fox-segmented.glb 当前不含 images/textures、UV 或顶点色；没有可单独补放的外部贴图，纹理版本必须重新导出 GLB。程序化回退会继续维持游戏可玩。</p></section>`;
  }

}
