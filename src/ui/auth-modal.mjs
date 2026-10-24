/** 登录/注册共用弹窗；网络错误与校验信息只在弹窗内提示。 */
import { writeSession } from '../core/accounts-session.mjs';
import { AccountsApiError } from '../core/accounts-api.mjs';

function authErrorText(error, mode) {
  const status = Number(error?.status) || 0;
  if (status === 409) return '这个用户名已被使用，请换一个。';
  if (status === 401) return mode === 'upgrade' ? '游客身份已失效，请刷新后重试。' : '用户名或密码不正确，请检查后重试。';
  if (status === 400) return '用户名格式或密码长度不符合要求。';
  if (status === 429) return '尝试次数较多，请稍后再试。';
  if (error?.code === 'timeout' || error?.code === 'network' || status === 0) return '网络暂不可用，请稍后重试。';
  return mode === 'register' ? '暂时无法完成注册，请稍后重试。' : mode === 'upgrade' ? '暂时无法完成升级，请稍后重试。' : '暂时无法完成登录，请稍后重试。';
}

export class AuthModal {
  constructor({ api, storage, storageKey = 'm3d.beta.session.v1', getToken = null, onAuthenticated, onClose } = {}) {
    this.api = api;
    this.storage = storage;
    this.storageKey = storageKey;
    this.getToken = typeof getToken === 'function' ? getToken : null;
    this.onAuthenticated = onAuthenticated;
    this.onClose = onClose;
    this.root = null;
    this.mode = 'login';
    this.busy = false;
  }

  open(mode = 'login') {
    if (typeof document === 'undefined' || !document.body) return;
    if (this.root) { this.setMode(mode); return; }
    this.mode = mode === 'register' ? 'register' : mode === 'upgrade' ? 'upgrade' : 'login';
    const upgrade = this.mode === 'upgrade';
    const root = document.createElement('div');
    root.className = 'accounts-overlay';
    root.innerHTML = `<section class="accounts-panel auth-panel" role="dialog" aria-modal="true" aria-labelledby="accountsAuthTitle">
      <button class="accounts-close" type="button" aria-label="关闭">×</button>
      <div class="eyebrow">BETA ACCOUNT</div><h2 id="accountsAuthTitle">账号登录</h2>
      <div class="accounts-tabs" role="tablist" aria-label="账号操作"${upgrade ? ' hidden' : ''}>
        <button type="button" class="accounts-tab" data-auth-mode="login" role="tab">登录</button>
        <button type="button" class="accounts-tab" data-auth-mode="register" role="tab">注册</button>
      </div>
      ${upgrade ? '<p class="accounts-hint">把当前游客升级为正式账号：<b>同一身份、历史最佳成绩自动保留</b>，以后可用用户名密码登录。</p>' : ''}
      <form class="accounts-form" novalidate>
        <label class="accounts-label" for="accountsUsername">用户名</label>
        <input id="accountsUsername" name="username" autocomplete="username" maxlength="16" required>
        <label class="accounts-label" for="accountsPassword">密码</label>
        <input id="accountsPassword" name="password" type="password" autocomplete="${upgrade ? 'new-password' : 'current-password'}" minlength="6" required>
        <p class="accounts-hint">用户名 2–16 位，可用中英文、数字、下划线、点和短横线；密码至少 6 位。</p>
        <p class="accounts-status" aria-live="polite"></p>
        <button class="primary accounts-submit" type="submit">登录</button>
      </form>
    </section>`;
    document.body.appendChild(root);
    this.root = root;
    root.querySelector('.accounts-close')?.addEventListener('click', () => this.close());
    root.addEventListener('click', (event) => { if (event.target === root) this.close(); });
    root.querySelectorAll('[data-auth-mode]').forEach((button) => {
      button.addEventListener('click', () => this.setMode(button.dataset.authMode));
    });
    root.querySelector('form')?.addEventListener('submit', (event) => {
      event.preventDefault();
      void this.submit();
    });
    this.renderMode();
    root.querySelector('#accountsUsername')?.focus();
  }

  setMode(mode) {
    if (!this.root || this.busy) return;
    this.mode = mode === 'register' ? 'register' : mode === 'upgrade' ? 'upgrade' : 'login';
    this.renderMode();
  }

  renderMode() {
    if (!this.root) return;
    const registering = this.mode === 'register';
    const upgrade = this.mode === 'upgrade';
    const title = this.root.querySelector('#accountsAuthTitle');
    const password = this.root.querySelector('#accountsPassword');
    const submit = this.root.querySelector('.accounts-submit');
    if (title) title.textContent = upgrade ? '升级为正式账号' : registering ? '创建账号' : '账号登录';
    if (password) password.autocomplete = registering || upgrade ? 'new-password' : 'current-password';
    if (submit) submit.textContent = upgrade ? '升级并保留成绩' : registering ? '注册并登录' : '登录';
    this.root.querySelectorAll('[data-auth-mode]').forEach((button) => {
      const active = button.dataset.authMode === this.mode;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', String(active));
    });
    const status = this.root.querySelector('.accounts-status');
    if (status) status.textContent = '';
  }

  async submit() {
    if (!this.root || this.busy) return;
    const usernameInput = this.root.querySelector('#accountsUsername');
    const passwordInput = this.root.querySelector('#accountsPassword');
    const status = this.root.querySelector('.accounts-status');
    const button = this.root.querySelector('.accounts-submit');
    const username = String(usernameInput?.value || '').trim();
    const password = String(passwordInput?.value || '');
    if (!/^[\p{L}\p{N}_.-]{2,16}$/u.test(username)) {
      if (status) status.textContent = '用户名需为 2–16 位中英文、数字或 _ . -。';
      usernameInput?.focus();
      return;
    }
    if (password.length < 6) {
      if (status) status.textContent = '密码至少需要 6 位。';
      passwordInput?.focus();
      return;
    }

    this.busy = true;
    if (button) button.disabled = true;
    if (status) status.textContent = '正在处理…';
    try {
      const credentials = { username, password };
      let response;
      if (this.mode === 'register') response = await this.api.register(credentials);
      else if (this.mode === 'upgrade') {
        const guestToken = this.getToken?.() || '';
        if (!guestToken) throw new AccountsApiError(401, '游客身份已失效', 'http');
        response = await this.api.upgrade(credentials, guestToken);
      } else response = await this.api.login(credentials);
      const session = writeSession(response?.token, response?.user, this.storage, this.storageKey);
      if (!session) throw new Error('invalid-session');
      this.close(false);
      this.onAuthenticated?.(session);
    } catch (error) {
      if (status && this.root) status.textContent = authErrorText(error, this.mode);
    } finally {
      this.busy = false;
      if (button && this.root) button.disabled = false;
    }
  }

  close(notify = true) {
    if (!this.root) return;
    this.root.remove();
    this.root = null;
    this.busy = false;
    if (notify) this.onClose?.();
  }
}
