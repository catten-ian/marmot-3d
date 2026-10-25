import { buildMechanismDocs } from './mechanism-docs-data.mjs';

function cell(row, value, className = '') {
  const el = document.createElement('td');
  el.textContent = String(value ?? '—');
  if (className) el.className = className;
  row.appendChild(el);
  return el;
}

function parameterTable(parameters) {
  const wrap = document.createElement('div'); wrap.className = 'doc-table-wrap';
  const table = document.createElement('table'); table.className = 'doc-table';
  const head = document.createElement('thead'); const hr = document.createElement('tr');
  for (const title of ['参数 / 来源', '默认值', '范围 / 单位', '调大效果', '调小效果', '相关机制', '风险 / 验证']) {
    const th = document.createElement('th'); th.textContent = title; hr.appendChild(th);
  }
  head.appendChild(hr); table.appendChild(head);
  const body = document.createElement('tbody');
  for (const parameter of parameters) {
    const row = document.createElement('tr');
    const name = cell(row, parameter.name, 'doc-param-name');
    const source = document.createElement('code'); source.textContent = parameter.source; name.appendChild(source);
    cell(row, parameter.def); cell(row, parameter.range); cell(row, parameter.up); cell(row, parameter.down); cell(row, parameter.link); cell(row, parameter.risk);
    body.appendChild(row);
  }
  table.appendChild(body); wrap.appendChild(table); return wrap;
}

export class MechanismDocs {
  constructor({ root, entries }) {
    this.root = root;
    this.docs = buildMechanismDocs(entries);
    this._build();
  }

  _build() {
    this.root.innerHTML = `<div class="docs-head"><div><h2>机制说明 / 调参文档</h2><p>默认值与范围实时读取当前后台 schema。先读联动和风险，再小步修改；实时预览不等于写回线上游戏。</p></div>
      <input type="search" placeholder="搜索机制、参数、来源、风险…" aria-label="搜索机制文档"></div><div class="docs-sections"></div>`;
    this.search = this.root.querySelector('input');
    this.sections = this.root.querySelector('.docs-sections');
    this.search.addEventListener('input', () => this._render());
    this._render();
  }

  _render() {
    const query = this.search.value.trim().toLowerCase();
    this.sections.replaceChildren();
    let guideCount = 0, parameterCount = 0;
    for (const guide of this.docs) {
      const ownText = [guide.title, guide.overview, guide.sources, ...guide.workflow, ...guide.risks].join(' ').toLowerCase();
      const ownMatches = query && ownText.includes(query);
      const parameters = query && !ownMatches ? guide.parameters.filter((p) => Object.values(p).join(' ').toLowerCase().includes(query)) : guide.parameters;
      if (query && !ownMatches && !parameters.length) continue;
      guideCount++; parameterCount += parameters.length;
      const section = document.createElement('details'); section.className = 'mechanism-guide'; section.open = !!query;
      const summary = document.createElement('summary'); summary.textContent = `${guide.title}（${parameters.length} 项参数）`; section.appendChild(summary);
      const content = document.createElement('div'); content.className = 'mechanism-content';
      const overview = document.createElement('p'); overview.textContent = guide.overview; content.appendChild(overview);
      const sources = document.createElement('p'); sources.className = 'doc-sources'; sources.textContent = `源码依据：${guide.sources}`; content.appendChild(sources);
      for (const [title, lines] of [['机制与调参顺序', guide.workflow], ['危险组合与验证建议', guide.risks]]) {
        const heading = document.createElement('h3'); heading.textContent = title; content.appendChild(heading);
        const list = document.createElement('ul');
        for (const line of lines) { const li = document.createElement('li'); li.textContent = line; list.appendChild(li); }
        content.appendChild(list);
      }
      if (guide.extra.length) {
        const heading = document.createElement('h3'); heading.textContent = '补充运行参数'; content.appendChild(heading); content.appendChild(parameterTable(guide.extra));
      }
      for (const group of guide.groups) {
        const rows = parameters.filter((p) => p.group === group);
        // schema 顺序保持稳定；按原分组折叠，搜索时只显示命中项。
        if (!rows.length) continue;
        const groupBox = document.createElement('details'); groupBox.className = 'doc-param-group'; groupBox.open = !!query;
        const groupSummary = document.createElement('summary'); groupSummary.textContent = `${group}（${rows.length} 项）`; groupBox.appendChild(groupSummary);
        groupBox.appendChild(parameterTable(rows)); content.appendChild(groupBox);
      }
      section.appendChild(content); this.sections.appendChild(section);
    }
    if (!guideCount) {
      const empty = document.createElement('p'); empty.className = 'empty'; empty.textContent = '没有匹配的机制或参数。'; this.sections.appendChild(empty);
    }
    this.root.querySelector('.docs-head p').textContent = query
      ? `搜索到 ${guideCount} 个机制分组、${parameterCount} 项参数。清空搜索可恢复完整文档。`
      : '默认值与范围实时读取当前后台 schema。先读联动和风险，再小步修改；实时预览不等于写回线上游戏。';
  }
}
