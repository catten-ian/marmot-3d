/** 公开排行榜面板：加载、重试、切榜及我的最佳均与游戏主循环解耦。 */
import { escapeHtml, formatSeconds } from '../core/accounts-api.mjs';

export class LeaderboardUI {
  constructor({ api, levels = [], getSession = () => null, onAuthRequest } = {}) {
    this.api = api;
    this.levels = levels;
    this.getSession = getSession;
    this.onAuthRequest = onAuthRequest;
    this.root = null;
    this.kind = 'level';
    this.level = 0;
    this.requestId = 0;
  }

  open() {
    if (typeof document === 'undefined' || !document.body) return;
    if (this.root) { this.load(); return; }
    const options = this.levels.map((level, index) =>
      `<option value="${index}">第 ${index + 1} 关 · ${escapeHtml(level?.name || '')}</option>`).join('');
    const root = document.createElement('div');
    root.className = 'accounts-overlay leaderboard-overlay';
    root.innerHTML = `<section class="accounts-panel leaderboard-panel" role="dialog" aria-modal="true" aria-labelledby="leaderboardTitle">
      <button class="accounts-close" type="button" aria-label="关闭">×</button>
      <div class="eyebrow">PUBLIC RANKING</div><h2 id="leaderboardTitle">单关最佳榜</h2>
      <div class="leaderboard-toolbar">
        <label class="leaderboard-level-label" for="leaderboardLevel">关卡</label>
        <select id="leaderboardLevel">${options}</select>
      </div>
      <p class="leaderboard-status" aria-live="polite">正在加载…</p>
      <div class="leaderboard-table-wrap"><table class="leaderboard-table">
        <thead><tr><th>名次</th><th>玩家</th><th>用时</th><th>受击</th></tr></thead>
        <tbody class="leaderboard-rows"></tbody>
      </table></div>
      <button type="button" class="ghost leaderboard-retry" hidden>重试</button>
      <div class="leaderboard-mine"><b>我的最佳</b><span class="leaderboard-mine-value">—</span></div>
      <p class="leaderboard-auth-hint"></p>
    </section>`;
    document.body.appendChild(root);
    this.root = root;
    this.kind = 'level';
    root.querySelector('.accounts-close')?.addEventListener('click', () => this.close());
    root.addEventListener('click', (event) => { if (event.target === root) this.close(); });
    root.querySelector('#leaderboardLevel')?.addEventListener('change', (event) => {
      const index = Number(event.target.value);
      this.level = Number.isInteger(index) ? Math.max(0, Math.min(this.levels.length - 1, index)) : 0;
      this.load();
    });
    root.querySelector('.leaderboard-retry')?.addEventListener('click', () => this.load());
    this.load();
  }

  updateControls() {
    if (!this.root) return;
  }

  async load() {
    if (!this.root || !this.api) return;
    const requestId = ++this.requestId;
    const status = this.root.querySelector('.leaderboard-status');
    const rows = this.root.querySelector('.leaderboard-rows');
    const retry = this.root.querySelector('.leaderboard-retry');
    if (status) status.textContent = '正在加载…';
    if (rows) rows.innerHTML = '<tr><td colspan="4" class="leaderboard-empty">正在加载…</td></tr>';
    if (retry) retry.hidden = true;
    const session = this.getSession();
    const boardPromise = this.api.leaderboard(this.kind, { level: this.level, limit: 50 });
    const minePromise = session ? this.api.mine(session.token).catch(() => null) : Promise.resolve(null);
    const [boardResult, mineResult] = await Promise.allSettled([boardPromise, minePromise]);
    if (!this.root || requestId !== this.requestId) return;
    if (boardResult.status !== 'fulfilled') {
      if (status) status.textContent = '暂时无法加载排行榜，请检查网络后重试。';
      if (rows) rows.innerHTML = '<tr><td colspan="4" class="leaderboard-empty">排行榜暂不可用</td></tr>';
      if (retry) retry.hidden = false;
      this.renderMine(null, null, session);
      return;
    }
    if (status) status.textContent = '';
    const board = boardResult.value || {};
    const items = Array.isArray(board.items) ? board.items.slice(0, 50) : [];
    this.renderRows(items, session);
    this.renderMine(mineResult.status === 'fulfilled' ? mineResult.value : null, items, session);
  }

  renderRows(items, session) {
    if (!this.root) return;
    const rows = this.root.querySelector('.leaderboard-rows');
    if (!rows) return;
    if (!items.length) {
      rows.innerHTML = '<tr><td colspan="4" class="leaderboard-empty">还没有成绩，来当第一名</td></tr>';
      return;
    }
    const playerName = String(session?.user?.name || '');
    rows.innerHTML = items.map((item, index) => {
      const isSelf = !!playerName && String(item?.name || '') === playerName;
      const rank = Number.isFinite(Number(item?.rank)) ? Math.max(1, Math.trunc(Number(item.rank))) : index + 1;
      const hits = Number.isFinite(Number(item?.hits)) ? Math.max(0, Math.trunc(Number(item.hits))) : 0;
      return `<tr class="${isSelf ? 'is-self' : ''}"><td>${rank}</td><td>${escapeHtml(item?.name || '未知玩家')}</td><td>${formatSeconds(item?.time)}</td><td>${hits}</td></tr>`;
    }).join('');
  }

  renderMine(mine, items, session) {
    if (!this.root) return;
    const value = this.root.querySelector('.leaderboard-mine-value');
    const hint = this.root.querySelector('.leaderboard-auth-hint');
    if (!session) {
      if (value) value.textContent = '—';
      if (hint) hint.innerHTML = '开始游戏即以游客身份自动上榜；也可 <button type="button" class="leaderboard-login">登录 / 注册</button>';
      hint?.querySelector('.leaderboard-login')?.addEventListener('click', () => this.onAuthRequest?.());
      return;
    }
    if (hint) hint.textContent = session.user.guest
      ? `游客：${session.user.name}（可在设置中升级为正式账号并保留成绩）`
      : `已登录：${session.user.name}`;
    let best = mine?.levels?.[String(this.level)];
    if (best === undefined || best === null || !Number.isFinite(Number(best))) {
      const ownRow = (items || []).find((item) => String(item?.name || '') === String(session.user.name));
      if (ownRow) best = ownRow.time;
    }
    if (value) value.textContent = best === undefined || best === null ? '暂无' : formatSeconds(best);
  }

  refresh() { if (this.root) void this.load(); }

  close() {
    if (!this.root) return;
    this.requestId++;
    this.root.remove();
    this.root = null;
  }
}
