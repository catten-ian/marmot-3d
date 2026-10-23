/* 游戏内反馈：离线优先，提交失败也不影响主循环。 */
const QUEUE_KEY = 'm3d_feedback_queue';
const INSTALL_KEY = 'm3d_install_id';
const MAX_QUEUE = 20;
const MAX_ERRORS = 10;
const errorRing = [];
let installed = false;

/** 匿名安装标识（随机，无 PII），跨会话稳定，用于后台聚合同一设备的反馈。 */
export function getInstallId(storage = typeof localStorage !== 'undefined' ? localStorage : null) {
  if (!storage) return '';
  try {
    let id = storage.getItem(INSTALL_KEY);
    if (!id) {
      id = (crypto.randomUUID ? crypto.randomUUID() : 'm3d-' + Math.random().toString(36).slice(2) + Date.now().toString(36));
      storage.setItem(INSTALL_KEY, id);
    }
    return String(id).slice(0, 64);
  } catch (_) { return ''; }
}

/** 当前渠道：优先 ?version，其次快照传入；本基线只有 stable/dev。 */
function channelFromQuery() {
  try { return new URLSearchParams(location.search).get('version')?.replace(/\/+$/, '') || 'stable'; } catch (_) { return 'stable'; }
}

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
    version: context.version || channelFromQuery(),
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

export async function submitFeedback(payload, options = {}) {
  const endpoint = String(options.endpoint || '');
  const storage = options.storage || (typeof localStorage !== 'undefined' ? localStorage : null);
  if (!endpoint) { enqueueFeedback(payload, storage); try { console.info('[feedback] 已写入离线队列', payload); } catch (_) {} return { ok: true, queued: true }; }
  const fetchFn = options.fetchFn || (typeof fetch === 'function' ? fetch : null);
  if (!fetchFn) { enqueueFeedback(payload, storage); return { ok: false, queued: true }; }
  let timer = null; let controller = null; let timedOut = false;
  try {
    if (typeof AbortController !== 'undefined') controller = new AbortController();
    const request = fetchFn(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: controller && controller.signal });
    const timeout = new Promise((_, reject) => { timer = setTimeout(() => { timedOut = true; if (controller) controller.abort(); reject(new Error('feedback timeout')); }, 5000); });
    const response = await Promise.race([request, timeout]);
    if (timer) clearTimeout(timer);
    if (response && response.ok === false) throw new Error('feedback endpoint rejected request');
    return { ok: true, queued: false };
  } catch (_) { if (timer) clearTimeout(timer); enqueueFeedback(payload, storage); return { ok: false, queued: true, timedOut }; }
}

function writeQueue(storage, queue) {
  try { storage.setItem(QUEUE_KEY, JSON.stringify(queue)); return true; } catch (_) { return false; }
}

/**
 * 按时间顺序补传本地离线队列：成功一条移除一条；遇失败立即停止并保留剩余。
 * 返回 {flushed, remaining}。全程静默，不打扰玩家。
 */
export async function flushFeedbackQueue({ endpoint, storage = typeof localStorage !== 'undefined' ? localStorage : null, fetchFn = typeof fetch === 'function' ? fetch : null } = {}) {
  if (!endpoint || !storage || !fetchFn) return { flushed: 0, remaining: 0 };
  const queue = readQueue(storage);
  if (!queue.length) return { flushed: 0, remaining: 0 };
  let flushed = 0;
  while (queue.length) {
    const payload = queue[0];
    let ok = false;
    try {
      const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const timer = controller ? setTimeout(() => controller.abort(), 5000) : null;
      const res = await fetchFn(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: controller && controller.signal });
      if (timer) clearTimeout(timer);
      ok = !!(res && res.ok);
    } catch (_) { ok = false; }
    if (!ok) break;
    queue.shift(); flushed++;
    writeQueue(storage, queue); // 每条成功即落盘，避免崩溃重复上报
  }
  if (queue.length) writeQueue(storage, queue);
  try { if (flushed) console.debug(`[feedback] 已补传 ${flushed} 条，剩余 ${queue.length}`); } catch (_) { /* ignore */ }
  return { flushed, remaining: queue.length };
}

let flushInit = false;
/** 启动后、浏览器重新上线、以及定时尝试补传；失败静默。幂等，只初始化一次。 */
export function initFeedbackFlush({ endpoint = '', intervalMs = 8000 } = {}) {
  if (flushInit || typeof window === 'undefined' || !endpoint) return;
  flushInit = true;
  const storage = typeof localStorage !== 'undefined' ? localStorage : null;
  const run = () => { flushFeedbackQueue({ endpoint, storage }).catch(() => {}); };
  run();
  window.addEventListener('online', run);
  if (intervalMs > 0) setInterval(run, intervalMs);
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
    const payload = { createdAt: new Date().toISOString(), type: this.root.querySelector('#feedbackType').value, description: text, installId: getInstallId(), version: channelFromQuery(), snapshot: this.getSnapshot() };
    const result = await submitFeedback(payload, { endpoint: this.endpoint });
    if (this.root) { this.root.querySelector('.feedback-status').textContent = result.ok || result.queued ? '已记录，感谢反馈' : '提交失败，已保存到本地队列'; button.disabled = false; }
  }
}
