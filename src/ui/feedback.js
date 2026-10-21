/* 游戏内反馈：离线优先，提交失败也不影响主循环。 */
const QUEUE_KEY = 'm3d_feedback_queue';
const MAX_QUEUE = 20;
const MAX_ERRORS = 10;
const errorRing = [];
let installed = false;

function installErrorBuffer() {
  if (installed || typeof window === 'undefined' || !window.addEventListener) return;
  installed = true;
  try {
    window.addEventListener('error', (event) => {
      errorRing.push({ at: new Date().toISOString(), message: String(event.message || '未知错误'), source: event.filename || '', line: event.lineno || 0 });
      if (errorRing.length > MAX_ERRORS) errorRing.splice(0, errorRing.length - MAX_ERRORS);
    });
    window.addEventListener('unhandledrejection', (event) => {
      errorRing.push({ at: new Date().toISOString(), message: String(event.reason && (event.reason.stack || event.reason) || '未处理的 Promise 拒绝') });
      if (errorRing.length > MAX_ERRORS) errorRing.splice(0, errorRing.length - MAX_ERRORS);
    });
  } catch (_) { /* Error capture is optional and must not affect boot. */ }
}
installErrorBuffer();

export function getRecentBrowserErrors() { return errorRing.slice(); }

export function collectGameSnapshot(context = {}) {
  const game = context.game || {};
  const player = game.player || {};
  const nav = typeof navigator !== 'undefined' ? navigator : {};
  const win = typeof window !== 'undefined' ? window : {};
  const profile = context.performanceProfile || {};
  const viewport = { width: Number(win.innerWidth) || 0, height: Number(win.innerHeight) || 0 };
  return {
    timestamp: new Date().toISOString(),
    version: context.version || 'unknown',
    level: Number.isFinite(game.level) ? game.level + 1 : null,
    viewMode: context.thirdPerson ? 'third-person' : 'first-person',
    sandbox: !!(context.sandbox || game.sandbox),
    game: {
      hp: Number.isFinite(player.hp) ? player.hp : null,
      energy: Number.isFinite(player.energy) ? player.energy : null,
      stress: Number.isFinite(player.stress) ? player.stress : null,
      completedObjectives: (game.foodCount ? 1 : 0) + (game.friend && (game.friend.rescued || game.friend.saved) ? 1 : 0),
      time: Number.isFinite(game.time) ? game.time : null,
      elapsed: Number.isFinite(game.elapsed) ? game.elapsed : null,
      mode: game.mode || 'unknown',
    },
    environment: {
      userAgent: String(nav.userAgent || ''), viewport, devicePixelRatio: Number(win.devicePixelRatio) || 1,
      touch: !!context.touch || Number(nav.maxTouchPoints) > 0 || ('ontouchstart' in win),
      performance: context.performance || (profile.lowPower ? 'low' : profile.mobile ? 'mobile' : 'desktop'),
    },
    recentErrors: getRecentBrowserErrors(),
  };
}

function readQueue(storage) {
  try { const value = JSON.parse(storage.getItem(QUEUE_KEY) || '[]'); return Array.isArray(value) ? value : []; } catch (_) { return []; }
}
export function enqueueFeedback(payload, storage = typeof localStorage !== 'undefined' ? localStorage : null) {
  if (!storage) return false;
  try { const queue = readQueue(storage); queue.push(payload); while (queue.length > MAX_QUEUE) queue.shift(); storage.setItem(QUEUE_KEY, JSON.stringify(queue)); return true; } catch (_) { return false; }
}

export function feedbackStatusText(result) {
  if (result && result.ok && !result.queued) return '已提交，感谢反馈';
  if (result && result.queued) return '已保存到本机；当前未联网上报。';
  return '未能保存反馈；当前未联网上报，请稍后重试。';
}

export async function submitFeedback(payload, options = {}) {
  const endpoint = String(options.endpoint || '');
  const storage = options.storage || (typeof localStorage !== 'undefined' ? localStorage : null);
  if (!endpoint) {
    const queued = enqueueFeedback(payload, storage);
    if (queued) { try { console.info('[feedback] 已写入离线队列', payload); } catch (_) {} }
    return { ok: queued, queued };
  }
  const fetchFn = options.fetchFn || (typeof fetch === 'function' ? fetch : null);
  if (!fetchFn) return { ok: false, queued: enqueueFeedback(payload, storage) };
  let timer = null; let controller = null; let timedOut = false;
  try {
    if (typeof AbortController !== 'undefined') controller = new AbortController();
    const request = fetchFn(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: controller && controller.signal });
    const timeout = new Promise((_, reject) => { timer = setTimeout(() => { timedOut = true; if (controller) controller.abort(); reject(new Error('feedback timeout')); }, 5000); });
    const response = await Promise.race([request, timeout]);
    if (timer) clearTimeout(timer);
    if (!response || response.ok !== true) throw new Error('feedback endpoint rejected request');
    return { ok: true, queued: false };
  } catch (_) { if (timer) clearTimeout(timer); return { ok: false, queued: enqueueFeedback(payload, storage), timedOut }; }
}

export class FeedbackUI {
  constructor({ getSnapshot, endpoint = '', onClose } = {}) { this.getSnapshot = getSnapshot || (() => collectGameSnapshot()); this.endpoint = endpoint; this.onClose = onClose; this.lastSubmit = 0; this.root = null; }
  open() {
    if (this.root) return;
    const root = document.createElement('div'); root.className = 'feedback-overlay'; root.innerHTML = `<section class="feedback-panel" role="dialog" aria-modal="true" aria-labelledby="feedbackTitle"><div class="eyebrow">FEEDBACK</div><h2 id="feedbackTitle">问题反馈 / 反馈建议</h2><label class="feedback-label" for="feedbackType">问题类型</label><select id="feedbackType"><option>卡顿</option><option>显示异常</option><option>操作手感</option><option>关卡数值</option><option>其他</option></select><label class="feedback-label" for="feedbackText">描述</label><textarea id="feedbackText" maxlength="2000" placeholder="描述你遇到的问题或建议…"></textarea><details><summary>游戏数据快照</summary><pre id="feedbackSnapshot"></pre></details><p class="feedback-status" aria-live="polite"></p><div class="row"><button class="primary" id="feedbackSubmit">提交反馈</button><button class="ghost" id="feedbackClose">关闭</button></div></section>`;
    document.body.appendChild(root); this.root = root;
    root.querySelector('#feedbackSnapshot').textContent = JSON.stringify(this.getSnapshot(), null, 2);
    root.querySelector('#feedbackClose').onclick = () => this.close();
    root.querySelector('#feedbackSubmit').onclick = () => this.submit();
    root.querySelector('#feedbackText').focus();
  }
  close() { if (!this.root) return; this.root.remove(); this.root = null; if (this.onClose) this.onClose(); }
  async submit() {
    if (!this.root || Date.now() - this.lastSubmit < 1000) return;
    const text = this.root.querySelector('#feedbackText').value.trim(); if (!text) { this.root.querySelector('.feedback-status').textContent = '请先描述问题或建议。'; return; }
    this.lastSubmit = Date.now(); const button = this.root.querySelector('#feedbackSubmit'); button.disabled = true;
    const payload = { createdAt: new Date().toISOString(), type: this.root.querySelector('#feedbackType').value, description: text, snapshot: this.getSnapshot() };
    const result = await submitFeedback(payload, { endpoint: this.endpoint });
    if (this.root) { this.root.querySelector('.feedback-status').textContent = feedbackStatusText(result); button.disabled = false; }
  }
}
