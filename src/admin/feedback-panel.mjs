/** Beta 后台反馈视图。密码仅存在于登录表单的当次请求，不写 storage。 */
import { AccountsApi } from '../core/accounts-api.mjs';
import { readSession, writeSession, clearSession, isUnauthorized } from '../core/accounts-session.mjs';

const text = (value, fallback = '—') => value === undefined || value === null || value === '' ? fallback : String(value);
const timeText = (value) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? text(value) : date.toLocaleString('zh-CN', { hour12: false });
};

export function feedbackSnapshotSummary(snapshot) {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return '无快照';
  const parts = [];
  if (snapshot.level !== undefined) parts.push(`关卡 ${text(snapshot.level)}`);
  for (const key of ['hp', 'energy', 'x', 'z', 'inputMode', 'graphics']) {
    if (snapshot[key] !== undefined && ['string', 'number', 'boolean'].includes(typeof snapshot[key])) parts.push(`${key}: ${snapshot[key]}`);
  }
  if (!parts.length) {
    const keys = Object.keys(snapshot).slice(0, 4);
    if (keys.length) parts.push(...keys.map((key) => `${key}: ${text(snapshot[key], '')}`.slice(0, 100)));
  }
  return parts.join(' · ') || '无快照';
}

export class FeedbackPanel {
  constructor({ root, apiBase, onToast }) {
    this.root = root;
    this.api = new AccountsApi({ basePath: apiBase });
    this.toast = onToast || (() => {});
    this.session = readSession();
    this.cursor = null;
    this.previousCursors = [];
    this.requestSerial = 0;
    this._build();
    this._showSession();
  }

  _build() {
    this.root.innerHTML = `
      <section class="feedback-login" aria-label="后台账号登录">
        <h2>账号登录</h2><p>使用现有 Beta 账号。密码只提交给同源账号服务，不会保存在本页或浏览器存储中。</p>
        <form><label>用户名<input name="username" value="catten" autocomplete="username" required maxlength="16"></label>
        <label>密码<input name="password" type="password" autocomplete="current-password" required maxlength="128"></label>
        <button type="submit">登录并查看反馈</button><span class="feedback-login-status" role="status"></span></form>
      </section>
      <section class="feedback-content" hidden aria-label="用户反馈">
        <div class="feedback-head"><div><h2>用户反馈</h2><span class="feedback-user"></span></div>
          <div><button type="button" data-act="refresh">刷新</button> <button type="button" data-act="logout">退出登录</button></div></div>
        <div class="feedback-stats" aria-label="反馈统计"></div>
        <form class="feedback-filters"><label>类型<select name="type"><option value="">全部类型</option><option>卡顿</option><option>显示异常</option><option>操作手感</option><option>关卡数值</option><option>其他</option></select></label>
          <label>状态<select name="handled"><option value="">全部状态</option><option value="false">未处理</option><option value="true">已处理</option></select></label>
          <label>每页<select name="limit"><option>20</option><option>50</option><option>100</option></select></label>
          <label>搜索<input name="q" type="search" maxlength="100" placeholder="描述关键词"></label><button type="submit">应用筛选</button></form>
        <div class="feedback-status" role="status" aria-live="polite"></div>
        <div class="feedback-list"></div>
        <div class="feedback-pages"><button type="button" data-act="prev">上一页</button><span></span><button type="button" data-act="next">下一页</button></div>
      </section>`;
    this.loginBox = this.root.querySelector('.feedback-login');
    this.content = this.root.querySelector('.feedback-content');
    this.loginForm = this.root.querySelector('.feedback-login form');
    this.loginStatus = this.root.querySelector('.feedback-login-status');
    this.filters = this.root.querySelector('.feedback-filters');
    this.status = this.root.querySelector('.feedback-status');
    this.list = this.root.querySelector('.feedback-list');
    this.stats = this.root.querySelector('.feedback-stats');
    this.pageText = this.root.querySelector('.feedback-pages span');
    this.loginForm.addEventListener('submit', (event) => { event.preventDefault(); this._login(); });
    this.filters.addEventListener('submit', (event) => { event.preventDefault(); this.cursor = null; this.previousCursors = []; this.refresh(); });
    this.root.querySelector('[data-act=refresh]').addEventListener('click', () => this.refresh());
    this.root.querySelector('[data-act=logout]').addEventListener('click', () => this.logout());
    this.root.querySelector('[data-act=next]').addEventListener('click', () => {
      if (!this.cursor) return;
      this.previousCursors.push(this.cursor);
      this.refresh();
    });
    this.root.querySelector('[data-act=prev]').addEventListener('click', () => {
      this.previousCursors.pop();
      this.cursor = this.previousCursors.at(-1) || null;
      this.refresh();
    });
  }

  _showSession() {
    const loggedIn = !!this.session?.token;
    this.loginBox.hidden = loggedIn;
    this.content.hidden = !loggedIn;
    this.root.querySelector('.feedback-user').textContent = loggedIn ? `当前账号：${this.session.user.name}` : '';
    if (loggedIn) this.refresh();
  }

  async _login() {
    const button = this.loginForm.querySelector('button');
    const username = this.loginForm.elements.username.value.trim();
    const passwordInput = this.loginForm.elements.password;
    button.disabled = true;
    this.loginStatus.textContent = '正在登录…';
    try {
      const result = await this.api.login({ username, password: passwordInput.value });
      this.session = writeSession(result.token, result.user) || { token: result.token, user: result.user };
      this.loginStatus.textContent = '';
      this.cursor = null; this.previousCursors = [];
      this._showSession();
    } catch (error) {
      this.loginStatus.textContent = error?.message || '登录失败，请稍后重试';
    } finally {
      passwordInput.value = '';
      button.disabled = false;
    }
  }

  _unauthorized() {
    clearSession();
    this.session = null;
    this.cursor = null; this.previousCursors = [];
    this.loginStatus.textContent = '登录已过期，请重新登录';
    this._showSession();
  }

  logout() {
    this.requestSerial++;
    clearSession();
    this.session = null;
    this.list.replaceChildren(); this.stats.replaceChildren();
    this.status.textContent = '';
    this.loginForm.reset();
    this.loginForm.elements.username.value = 'catten';
    this.loginForm.elements.password.value = '';
    this.loginStatus.textContent = '已退出登录';
    this._showSession();
  }

  _query() {
    const data = new FormData(this.filters);
    const params = new URLSearchParams();
    for (const key of ['type', 'handled', 'limit', 'q']) {
      const value = String(data.get(key) || '').trim();
      if (value) params.set(key, value);
    }
    if (this.cursor) params.set('before', this.cursor);
    return `?${params}`;
  }

  async refresh() {
    if (!this.session?.token) return;
    const serial = ++this.requestSerial;
    this.status.textContent = '正在读取反馈与统计…';
    this.root.querySelector('[data-act=refresh]').disabled = true;
    const token = this.session.token;
    try {
      const [listResult, statsResult] = await Promise.allSettled([
        this.api.request(`/admin/feedback/list${this._query()}`, { token }),
        this.api.request('/admin/feedback/stats', { token }),
      ]);
      if (serial !== this.requestSerial) return;
      const unauthorized = [listResult, statsResult].find((r) => r.status === 'rejected' && isUnauthorized(r.reason));
      if (unauthorized) { this._unauthorized(); return; }
      if (listResult.status === 'fulfilled') this._renderList(listResult.value);
      else { this.list.replaceChildren(); this.status.textContent = `列表读取失败：${listResult.reason?.message || '网络错误'}`; }
      if (statsResult.status === 'fulfilled') this._renderStats(statsResult.value);
      else this.stats.textContent = `统计读取失败：${statsResult.reason?.message || '网络错误'}`;
      if (listResult.status === 'fulfilled') this.status.textContent = statsResult.status === 'fulfilled' ? `已更新 · ${new Date().toLocaleTimeString('zh-CN', { hour12: false })}` : '列表已更新，统计暂不可用';
    } finally {
      if (serial === this.requestSerial) this.root.querySelector('[data-act=refresh]').disabled = false;
    }
  }

  _renderStats(data) {
    this.stats.replaceChildren();
    const values = [['全部反馈', data.total], ['未处理', data.open], ['近 7 天', data.last7], ['近 30 天', data.last30]];
    for (const [label, value] of values) {
      const el = document.createElement('div');
      const strong = document.createElement('strong'); strong.textContent = text(value, '0');
      const span = document.createElement('span'); span.textContent = label;
      el.append(strong, span); this.stats.appendChild(el);
    }
    const types = document.createElement('p');
    types.className = 'feedback-type-stats';
    types.textContent = Object.entries(data.byType || {}).map(([key, value]) => `${key} ${value}`).join(' · ') || '暂无分类统计';
    this.stats.appendChild(types);
  }

  _renderList(data) {
    const items = Array.isArray(data.items) ? data.items : [];
    this.list.replaceChildren();
    this.cursor = data.nextCursor || null;
    this.pageText.textContent = `本页 ${items.length} 条 / 筛选共 ${Number(data.total) || 0} 条`;
    this.root.querySelector('[data-act=next]').disabled = !this.cursor;
    this.root.querySelector('[data-act=prev]').disabled = this.previousCursors.length === 0;
    if (!items.length) {
      const empty = document.createElement('p'); empty.className = 'empty'; empty.textContent = '当前筛选条件下没有反馈。';
      this.list.appendChild(empty); return;
    }
    for (const item of items) {
      const article = document.createElement('article'); article.className = 'feedback-item';
      const head = document.createElement('header');
      const type = document.createElement('strong'); type.textContent = text(item.type, '其他');
      const state = document.createElement('span'); state.className = item.handled ? 'handled' : 'open'; state.textContent = item.handled ? '已处理' : '未处理';
      const time = document.createElement('time'); time.textContent = timeText(item.createdAt || item.serverReceivedAt);
      head.append(type, state, time);
      const description = document.createElement('p'); description.className = 'feedback-description'; description.textContent = text(item.description, '（无描述）');
      const meta = document.createElement('p'); meta.className = 'feedback-meta'; meta.textContent = `版本 ${text(item.version)} · ${feedbackSnapshotSummary(item.snapshot)} · 标识 ${text(item.installId, '未提供')}`;
      article.append(head, description, meta);
      article.dataset.feedbackId = text(item.id, '');
      this.list.appendChild(article);
    }
  }
}
