/**
 * 数值面板 DOM 渲染（仅本页使用；不污染游戏主界面）。
 * 每一行：中文名 + 当前值 + 滑块/下拉 + 数字输入框；附来源标注。
 */
import {
  filterEntries, toView, setViewValue, resetGroup,
  serializeConfig, parseConfigText, applyImport,
} from './tuning-schema.mjs';

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
    this._build();
  }

  _build() {
    this.root.innerHTML = '';
    const bar = document.createElement('div');
    bar.className = 'panel-toolbar';
    bar.innerHTML = `
      <input type="search" class="search" placeholder="搜索：中文名 / 常量名 / 来源文件…">
      <button data-act="export" type="button">导出配置</button>
      <button data-act="copy" type="button">复制到剪贴板</button>
      <label class="import-label">导入配置<input type="file" accept="application/json,.json" hidden></label>
      <button data-act="resetAll" type="button" class="danger">全部恢复默认</button>`;
    this.root.appendChild(bar);
    this.searchInput = bar.querySelector('.search');
    this.searchInput.addEventListener('input', () => this._renderList());
    bar.querySelector('[data-act=export]').addEventListener('click', () => this._exportFile());
    bar.querySelector('[data-act=copy]').addEventListener('click', () => this._copyClipboard());
    bar.querySelector('[data-act=resetAll]').addEventListener('click', () => this._reset(null));
    bar.querySelector('input[type=file]').addEventListener('change', (ev) => this._importFile(ev));

    this.list = document.createElement('div');
    this.list.className = 'panel-list';
    this.root.appendChild(this.list);
    this._renderList();
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
}
