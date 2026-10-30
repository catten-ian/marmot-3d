/**
 * 数值面板 DOM 渲染（仅本页使用；不污染游戏主界面）。
 * 每一行：中文名 + 当前值 + 滑块/下拉 + 数字输入框；附来源标注。
 */
import {
  filterEntries, toView, setViewValue, resetGroup,
  serializeConfig, parseConfigText, applyImport,
  validateConfigName, deriveApiBase, configsIndexUrl, configItemUrl,
  needsOverwriteConfirm, serializeSavedConfig, parseSavedConfig,
  formatConfigSize, formatConfigTime,
} from './tuning-schema.mjs';
import { runtimePayloadFromAdminConfig } from '../core/runtime-config.mjs';

const fmt = (v) => {
  if (typeof v === 'boolean') return v ? '开' : '关';
  if (typeof v === 'string') return v;
  if (!Number.isFinite(v)) return String(v);
  const a = Math.abs(v);
  if (a >= 100) return v.toFixed(0);
  if (a >= 10) return v.toFixed(1);
  return Number(v.toFixed(3)).toString();
};

export class TuningPanel {
  /**
   * @param opts.root        面板容器元素
   * @param opts.entries     schema 条目
   * @param opts.entriesById Map
   * @param opts.state       预览态 {values, dirty}
   * @param opts.onChange    (id|null) => void  值变化回调（null = 批量变化）
   * @param opts.onToast     (msg, kind) => void
   */
  constructor({ root, entries, entriesById, state, onChange, onToast }) {
    this.root = root;
    this.entries = entries;
    this.entriesById = entriesById;
    this.state = state;
    this.onChange = onChange || (() => {});
    this.toast = onToast || (() => {});
    this.inputs = new Map(); // id -> {slider, number, select, row}
    this.cloudItems = [];    // 服务器配置列表 [{name, updatedAt, size}]
    this.pendingOverwrite = null; // 同名覆盖确认中的名字
    try { this.apiBase = deriveApiBase(typeof location !== 'undefined' ? location.pathname : '/'); }
    catch { this.apiBase = '/api'; }
    this._build();
  }

  _build() {
    this.root.innerHTML = '';
    const bar = document.createElement('div');
    bar.className = 'panel-toolbar';
    bar.innerHTML = `
      <input type="search" class="search" placeholder="搜索：中文名 / 常量名 / 来源文件…">
      <button data-act="cloud" type="button">保存到服务器</button>
      <button data-act="export" type="button">导出配置</button>
      <button data-act="copy" type="button">复制到剪贴板</button>
      <label class="import-label">导入配置<input type="file" accept="application/json,.json" hidden></label>
      <button data-act="resetAll" type="button" class="danger">全部恢复默认</button>
      <span class="capability-legend" aria-label="参数能力说明"><b>运行时生效</b> · <span>仅预览/导出，不影响线上对局</span></span>`;
    this.root.appendChild(bar);
    this.searchInput = bar.querySelector('.search');
    this.searchInput.addEventListener('input', () => this._renderList());
    bar.querySelector('[data-act=cloud]').addEventListener('click', () => this._toggleCloud());
    bar.querySelector('[data-act=export]').addEventListener('click', () => this._exportFile());
    bar.querySelector('[data-act=copy]').addEventListener('click', () => this._copyClipboard());
    bar.querySelector('[data-act=resetAll]').addEventListener('click', () => this._reset(null));
    bar.querySelector('input[type=file]').addEventListener('change', (ev) => this._importFile(ev));

    this._buildCloud();

    this.list = document.createElement('div');
    this.list.className = 'panel-list';
    this.root.appendChild(this.list);
    this._renderList();
    this.help = document.createElement('div');
    this.help.className = 'tune-help'; this.help.hidden = true;
    document.body.appendChild(this.help);
  }

  _bindHelp(row, entry) {
    const show = () => { this.help.textContent = entry.help; this.help.hidden = false; row.classList.add('help-open'); };
    const hide = () => { this.help.hidden = true; row.classList.remove('help-open'); };
    row.addEventListener('pointerenter', show); row.addEventListener('pointerleave', hide);
    let timer = 0;
    row.addEventListener('pointerdown', (ev) => { if (ev.pointerType === 'touch') timer = window.setTimeout(show, 520); }, { passive: true });
    row.addEventListener('pointerup', () => { if (timer) window.clearTimeout(timer); });
    row.addEventListener('pointercancel', () => { if (timer) window.clearTimeout(timer); });
  }

  _groups() {
    const q = this.searchInput.value;
    const filtered = filterEntries(this.entries, q);
    const groups = new Map();
    for (const e of filtered) {
      if (!groups.has(e.group)) groups.set(e.group, []);
      groups.get(e.group).push(e);
    }
    return groups;
  }

  _renderList() {
    this.list.innerHTML = '';
    this.inputs.clear();
    for (const [group, items] of this._groups()) {
      const section = document.createElement('section');
      section.className = 'panel-group';
      const head = document.createElement('header');
      head.innerHTML = `<h3></h3><span class="count">${items.length} 项</span><button type="button" class="reset-group">恢复本组默认</button>`;
      head.querySelector('h3').textContent = group;
      head.querySelector('.reset-group').addEventListener('click', () => this._reset(group));
      section.appendChild(head);
      for (const e of items) section.appendChild(this._row(e));
      this.list.appendChild(section);
    }
    if (!this.list.children.length) {
      const empty = document.createElement('p');
      empty.className = 'empty';
      empty.textContent = '没有匹配的数值项。';
      this.list.appendChild(empty);
    }
  }

  _row(entry) {
    const row = document.createElement('div');
    row.className = 'tune-row';
    row.dataset.id = entry.id;
    const viewVal = toView(entry, this.state.values[entry.id]);

    const label = document.createElement('div');
    label.className = 'tune-label';
    label.innerHTML = `<span class="cn"></span><code></code>`;
    label.querySelector('.cn').textContent = entry.label;
    label.querySelector('code').textContent = entry.source;
    label.title = `${entry.file} · ${entry.source}`;
    const capability = document.createElement('span');
    capability.className = `tune-capability ${entry.capability === 'runtime' ? 'runtime' : 'preview'}`;
    capability.textContent = entry.capability === 'runtime' ? '运行时生效' : '仅预览/导出，不影响线上对局';
    capability.setAttribute('aria-label', capability.textContent);
    label.appendChild(capability);
    row.appendChild(label);

    const ctrl = document.createElement('div');
    ctrl.className = 'tune-ctrl';
    const refs = { row };
    if (entry.kind === 'enum') {
      const sel = document.createElement('select');
      for (const opt of entry.options) {
        const o = document.createElement('option');
        o.value = opt; o.textContent = opt;
        sel.appendChild(o);
      }
      sel.value = this.state.values[entry.id];
      sel.addEventListener('change', () => this._set(entry, sel.value));
      ctrl.appendChild(sel);
      refs.select = sel;
    } else if (entry.kind === 'boolean') {
      const sel = document.createElement('select');
      for (const [v, t] of [['true', '开'], ['false', '关']]) {
        const o = document.createElement('option');
        o.value = v; o.textContent = t;
        sel.appendChild(o);
      }
      sel.value = String(this.state.values[entry.id]);
      sel.addEventListener('change', () => this._set(entry, sel.value === 'true'));
      ctrl.appendChild(sel);
      refs.select = sel;
    } else {
      const slider = document.createElement('input');
      slider.type = 'range';
      slider.min = entry.min; slider.max = entry.max; slider.step = entry.step;
      slider.value = viewVal;
      const num = document.createElement('input');
      num.type = 'number';
      num.min = entry.min; num.max = entry.max; num.step = entry.step;
      num.value = fmt(viewVal);
      slider.addEventListener('input', () => this._set(entry, Number(slider.value), 'slider'));
      num.addEventListener('change', () => this._set(entry, Number(num.value), 'number'));
      ctrl.appendChild(slider); ctrl.appendChild(num);
      if (entry.unit) {
        const u = document.createElement('span');
        u.className = 'unit'; u.textContent = entry.unit;
        ctrl.appendChild(u);
      }
      refs.slider = slider; refs.number = num;
    }
    row.appendChild(ctrl);
    this._bindHelp(row, entry);
    this._markDirty(row, entry);
    this.inputs.set(entry.id, refs);
    return row;
  }

  _markDirty(row, entry) {
    row.classList.toggle('dirty', this.state.dirty.has(entry.id));
  }

  _set(entry, viewValue, via) {
    const stored = setViewValue(this.entriesById, this.state, entry.id, viewValue);
    if (stored == null) return;
    const refs = this.inputs.get(entry.id);
    if (refs) {
      const vv = toView(entry, stored);
      if (refs.slider && via !== 'slider') refs.slider.value = vv;
      if (refs.number) refs.number.value = fmt(vv);
      if (refs.select) refs.select.value = String(stored);
      this._markDirty(refs.row, entry);
    }
    this.onChange(entry.id);
  }

  _reset(group) {
    const ids = resetGroup(this.state, this.entries, group);
    for (const id of ids) {
      const entry = this.entriesById.get(id);
      const refs = this.inputs.get(id);
      if (!refs || !entry) continue;
      const vv = toView(entry, entry.def);
      if (refs.slider) refs.slider.value = vv;
      if (refs.number) refs.number.value = fmt(vv);
      if (refs.select) refs.select.value = String(entry.def);
      this._markDirty(refs.row, entry);
    }
    this.toast(group ? `已恢复「${group}」默认值` : '已全部恢复默认值', 'ok');
    this.onChange(null);
  }

  _exportText() {
    return JSON.stringify(serializeConfig(this.entries, this.state), null, 2);
  }

  _exportFile() {
    const text = this._exportText();
    const blob = new Blob([text], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `m3d-beta-tuning-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
    this.toast('已导出 JSON 配置文件', 'ok');
  }

  async _copyClipboard() {
    const text = this._exportText();
    try {
      await navigator.clipboard.writeText(text);
      this.toast('已复制到剪贴板', 'ok');
    } catch (e) {
      // fail-soft：剪贴板不可用（非安全上下文等）时退化为导出文件
      this.toast('剪贴板不可用，已改为下载文件', 'warn');
      this._exportFile();
    }
  }

  _importFile(ev) {
    const file = ev.target.files && ev.target.files[0];
    ev.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onerror = () => this.toast('读取文件失败', 'error');
    reader.onload = () => {
      const parsed = parseConfigText(String(reader.result || ''));
      if (!parsed.ok) { this.toast(`导入失败：${parsed.error}`, 'error'); return; }
      const res = applyImport(this.entries, this.entriesById, this.state, parsed.data);
      this._renderList();
      this.onChange(null);
      let msg = `导入完成：应用 ${res.applied.length} 项`;
      if (res.ignored.length) msg += `，忽略未知字段 ${res.ignored.length} 个（${res.ignored.slice(0, 3).join(', ')}${res.ignored.length > 3 ? '…' : ''}）`;
      if (res.clamped.length) msg += `，钳制非法值 ${res.clamped.length} 个`;
      this.toast(msg, res.ignored.length || res.clamped.length ? 'warn' : 'ok');
    };
    reader.readAsText(file);
  }

  // ---------------- 服务器命名配置（保存/列表/加载/删除）----------------
  _buildCloud() {
    const box = document.createElement('div');
    box.className = 'cloud-box';
    box.hidden = true;
    box.innerHTML = `
      <form class="cloud-form">
        <input class="cloud-name" type="text" maxlength="50" autocomplete="off"
               placeholder="配置名字：中英文/数字/-/_，1-50 位">
        <button type="submit" class="cloud-save">保存当前配置到服务器</button>
        <button type="button" class="cloud-apply-current">应用当前编辑值到全部 Beta</button>
      </form>
      <div class="cloud-confirm" hidden>
        <span class="cloud-confirm-text"></span>
        <button type="button" class="cloud-ok danger">确认覆盖</button>
        <button type="button" class="cloud-cancel">取消</button>
      </div>
      <div class="cloud-bar">
        <span class="cloud-title">服务器上的配置（列表“应用”只应用已保存版本；当前编辑请先保存）</span>
        <button type="button" class="cloud-refresh">刷新列表</button>
        <span class="cloud-status"></span>
      </div>
      <ul class="cloud-list"></ul>`;
    this.root.appendChild(box);
    this.cloudBox = box;
    this.cloudName = box.querySelector('.cloud-name');
    this.cloudForm = box.querySelector('.cloud-form');
    this.cloudApplyCurrentBtn = box.querySelector('.cloud-apply-current');
    this.cloudConfirm = box.querySelector('.cloud-confirm');
    this.cloudConfirmText = box.querySelector('.cloud-confirm-text');
    this.cloudListEl = box.querySelector('.cloud-list');
    this.cloudStatusEl = box.querySelector('.cloud-status');
    this.cloudForm.addEventListener('submit', (ev) => { ev.preventDefault(); this._submitSave(); });
    this.cloudApplyCurrentBtn.title = '不创建命名配置，直接将当前面板里的 Beta 参数设为全部 Beta 游戏页的生效配置';
    this.cloudApplyCurrentBtn.addEventListener('click', () => this._applyCurrentConfig(this.cloudApplyCurrentBtn));
    this.cloudName.addEventListener('input', () => { if (this.pendingOverwrite) this._hideOverwrite(); });
    box.querySelector('.cloud-ok').addEventListener('click', () => {
      const name = this.pendingOverwrite;
      if (name) this._doSave(name);
    });
    box.querySelector('.cloud-cancel').addEventListener('click', () => this._hideOverwrite());
    box.querySelector('.cloud-refresh').addEventListener('click', () => this._refreshConfigs());
  }

  _toggleCloud() {
    this.cloudBox.hidden = !this.cloudBox.hidden;
    if (!this.cloudBox.hidden) {
      try { this.cloudName.focus(); } catch { /* noop */ }
      this._refreshConfigs();
    }
  }

  _cloudStatus(text, kind = '') {
    this.cloudStatusEl.textContent = text || '';
    this.cloudStatusEl.className = kind ? `cloud-status ${kind}` : 'cloud-status';
  }

  _hideOverwrite() {
    this.pendingOverwrite = null;
    this.cloudConfirm.hidden = true;
  }

  async _refreshConfigs() {
    this._cloudStatus('读取中…');
    try {
      if (typeof fetch !== 'function') throw new Error('fetch 不可用');
      const res = await fetch(configsIndexUrl(this.apiBase), { headers: { Accept: 'application/json' } });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data || !Array.isArray(data.configs)) {
        throw new Error(data && data.error ? data.error : `HTTP ${res.status}`);
      }
      this.cloudItems = data.configs;
      this._renderCloudList();
      this._cloudStatus(this.cloudItems.length ? `共 ${this.cloudItems.length} 个命名配置` : '服务器上还没有保存的配置');
    } catch (e) {
      this.cloudItems = [];
      this._renderCloudList();
      this._cloudStatus(`列表读取失败：${e && e.message ? e.message : e}`, 'error');
    }
  }

  _renderCloudList() {
    this.cloudListEl.innerHTML = '';
    for (const item of this.cloudItems) {
      const li = document.createElement('li');
      const main = document.createElement('span');
      main.className = 'cloud-item-name';
      main.textContent = item.name;
      const meta = document.createElement('span');
      meta.className = 'cloud-item-meta';
      meta.textContent = `${formatConfigTime(item.updatedAt)} · ${formatConfigSize(item.size)}`;
      const actions = document.createElement('span');
      actions.className = 'cloud-item-actions';
      const applyBtn = document.createElement('button');
      applyBtn.type = 'button'; applyBtn.className = 'cloud-apply'; applyBtn.textContent = '应用';
      applyBtn.title = '将这份已保存配置设为全部 Beta 游戏页当前生效配置；先保存编辑后再应用';
      applyBtn.addEventListener('click', () => this._applyConfig(item.name, applyBtn));
      const loadBtn = document.createElement('button');
      loadBtn.type = 'button'; loadBtn.className = 'cloud-load'; loadBtn.textContent = '加载';
      loadBtn.addEventListener('click', () => this._loadConfig(item.name));
      const delBtn = document.createElement('button');
      delBtn.type = 'button'; delBtn.className = 'cloud-delete danger'; delBtn.textContent = '删除';
      delBtn.addEventListener('click', () => this._deleteConfig(item.name, delBtn));
      actions.append(applyBtn, loadBtn, delBtn);
      li.append(main, meta, actions);
      this.cloudListEl.appendChild(li);
    }
  }

  async _submitSave() {
    this._hideOverwrite();
    const v = validateConfigName(this.cloudName.value);
    if (!v.ok) { this._cloudStatus(v.error, 'error'); return; }
    if (needsOverwriteConfirm(this.cloudItems.map((x) => x.name), v.name)) {
      // 同名：内联二次确认，不使用 confirm()/alert()。
      this.pendingOverwrite = v.name;
      this.cloudConfirmText.textContent = `服务器上已存在「${v.name}」，保存将覆盖旧版本，是否继续？`;
      this.cloudConfirm.hidden = false;
      this._cloudStatus('请确认是否覆盖同名配置', 'warn');
      return;
    }
    await this._doSave(v.name);
  }

  async _doSave(name) {
    const payload = serializeSavedConfig(this.entries, this.state);
    try {
      if (typeof fetch !== 'function') throw new Error('fetch 不可用');
      const res = await fetch(configsIndexUrl(this.apiBase), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ name, config: payload }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data || data.ok !== true) {
        throw new Error(data && data.error ? data.error : `HTTP ${res.status}`);
      }
      this.toast(`已把当前调参状态保存为「${name}」`, 'ok');
      this._cloudStatus(`已保存「${name}」`, 'ok');
      this.cloudName.value = '';
      this._hideOverwrite();
      await this._refreshConfigs();
    } catch (e) {
      const msg = `保存失败：${e && e.message ? e.message : e}`;
      this._cloudStatus(msg, 'error');
      this.toast(msg, 'error');
    }
  }

  async _applyConfig(name, btn) {
    const old = btn.textContent; btn.disabled = true; btn.textContent = '应用中…';
    try {
      if (typeof fetch !== 'function') throw new Error('fetch 不可用');
      const res = await fetch(configItemUrl(this.apiBase, name), { headers: { Accept: 'application/json' } });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data) throw new Error(data && data.error ? data.error : `HTTP ${res.status}`);
      const payload = runtimePayloadFromAdminConfig(data.config);
      const active = await fetch(`${this.apiBase}/configs/active`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ name, config: payload }) });
      const activeData = await active.json().catch(() => null);
      if (!active.ok || !activeData || activeData.ok !== true) throw new Error(activeData?.error || `HTTP ${active.status}`);
      this._cloudStatus(`已应用「${name}」到全部 Beta 网站`, 'ok'); this.toast(`已应用「${name}」到全部 Beta 网站`, 'ok');
    } catch (e) { const msg = `应用失败：${e && e.message ? e.message : e}`; this._cloudStatus(msg, 'error'); this.toast(msg, 'error'); }
    finally { btn.disabled = false; btn.textContent = old; }
  }

  async _applyCurrentConfig(btn) {
    const old = btn.textContent; btn.disabled = true; btn.textContent = '应用中…';
    try {
      if (typeof fetch !== 'function') throw new Error('fetch 不可用');
      const payload = runtimePayloadFromAdminConfig(serializeSavedConfig(this.entries, this.state));
      if (!Object.keys(payload.values).length) throw new Error('当前面板没有可应用的 Beta 参数');
      const res = await fetch(`${this.apiBase}/configs/active`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ name: '后台当前值', config: payload }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data || data.ok !== true) throw new Error(data?.error || `HTTP ${res.status}`);
      const msg = '已将当前编辑的 Beta 参数应用到全部 Beta 网站（未保存为命名配置）';
      this._cloudStatus(msg, 'ok'); this.toast(msg, 'ok');
    } catch (e) {
      const msg = `应用当前值失败：${e && e.message ? e.message : e}`;
      this._cloudStatus(msg, 'error'); this.toast(msg, 'error');
    } finally { btn.disabled = false; btn.textContent = old; }
  }

  async _loadConfig(name) {
    try {
      if (typeof fetch !== 'function') throw new Error('fetch 不可用');
      const res = await fetch(configItemUrl(this.apiBase, name), { headers: { Accept: 'application/json' } });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data) throw new Error(data && data.error ? data.error : `HTTP ${res.status}`);
      const parsed = parseSavedConfig(data.config);
      if (!parsed.ok) throw new Error(parsed.error);
      const r = applyImport(this.entries, this.entriesById, this.state, parsed.data);
      this._renderList();
      this.onChange(null); // 替换编辑状态并立即应用到预览
      let msg = `已加载服务器配置「${name}」：应用 ${r.applied.length} 项，预览已更新`;
      if (r.ignored.length) msg += `，忽略未知字段 ${r.ignored.length} 个`;
      if (r.clamped.length) msg += `，钳制非法值 ${r.clamped.length} 个`;
      this.toast(msg, r.ignored.length || r.clamped.length ? 'warn' : 'ok');
      this._cloudStatus(`已加载「${name}」`, 'ok');
    } catch (e) {
      const msg = `加载失败：${e && e.message ? e.message : e}`;
      this._cloudStatus(msg, 'error');
      this.toast(msg, 'error');
    }
  }

  _deleteConfig(name, btn) {
    // 两次点击内联确认（3 秒内有效），不使用 confirm()。
    if (!btn.dataset.confirming) {
      btn.dataset.confirming = '1';
      btn.textContent = '确认删除？';
      this._cloudStatus(`再次点击以删除「${name}」`, 'warn');
      setTimeout(() => {
        if (btn.dataset.confirming) { delete btn.dataset.confirming; btn.textContent = '删除'; }
      }, 3000);
      return;
    }
    delete btn.dataset.confirming;
    btn.textContent = '删除';
    (async () => {
      try {
        if (typeof fetch !== 'function') throw new Error('fetch 不可用');
        const res = await fetch(configItemUrl(this.apiBase, name), { method: 'DELETE', headers: { Accept: 'application/json' } });
        const data = await res.json().catch(() => null);
        if (!res.ok || !data || data.ok !== true) throw new Error(data && data.error ? data.error : `HTTP ${res.status}`);
        this.toast(`已删除服务器配置「${name}」`, 'ok');
        await this._refreshConfigs();
      } catch (e) {
        const msg = `删除失败：${e && e.message ? e.message : e}`;
        this._cloudStatus(msg, 'error');
        this.toast(msg, 'error');
      }
    })();
  }
}
