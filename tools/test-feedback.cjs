const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const storageData = new Map();
const localStorage = {
  getItem(key) { return storageData.has(key) ? storageData.get(key) : null; },
  setItem(key, value) { storageData.set(key, String(value)); },
};
const listeners = {};
const window = { innerWidth: 390, innerHeight: 844, devicePixelRatio: 2, addEventListener(name, fn) { listeners[name] = fn; } };
const document = { body: { appendChild() {} }, createElement() { return { className: '', innerHTML: '', querySelector() { return { textContent: '', focus() {}, onclick: null }; } }; } };
const source = fs.readFileSync('src/ui/feedback.js', 'utf8')
  .replace(/^export\s+/gm, '')
  + '\nmodule.exports = { collectGameSnapshot, enqueueFeedback, submitFeedback, flushFeedbackQueue, feedbackStatusText, FeedbackUI };';
const sandbox = { module: { exports: {} }, exports: {}, window, document, navigator: { userAgent: 'test-agent', maxTouchPoints: 0 }, localStorage, console, Date, Number, String, Math, JSON, Promise, setTimeout, clearTimeout, AbortController, globalThis: {} };
vm.runInNewContext(source, sandbox, { filename: 'feedback.js' });
const { collectGameSnapshot, enqueueFeedback, submitFeedback, flushFeedbackQueue, feedbackStatusText, FeedbackUI } = sandbox.module.exports;

async function run() {
  const snapshot = collectGameSnapshot();
  assert(snapshot.timestamp && snapshot.version === 'unknown');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(snapshot.environment.viewport)), { width: 390, height: 844 });
  assert.doesNotThrow(() => collectGameSnapshot({ game: { player: null } }));

  for (let i = 0; i < 22; i++) enqueueFeedback({ n: i }, localStorage);
  const queue = JSON.parse(localStorage.getItem('m3d_feedback_queue'));
  assert.strictEqual(queue.length, 20);
  assert.strictEqual(queue[0].n, 2);

  const offlineStorage = { data: null, getItem() { return this.data; }, setItem(key, value) { this.data = value; } };
  const offline = await submitFeedback({ description: 'test' }, { endpoint: '', storage: offlineStorage });
  assert.strictEqual(offline.ok, true);
  assert.strictEqual(offline.queued, true);
  assert.strictEqual(feedbackStatusText(offline), '提交暂未成功，已暂存到本机；联网后会自动补传。');
  assert.strictEqual(JSON.parse(offlineStorage.data).length, 1);

  const failedStorage = { data: null, getItem() { return this.data; }, setItem(key, value) { this.data = value; } };
  const failed = await submitFeedback({ description: 'test' }, { endpoint: 'https://example.invalid', storage: failedStorage, fetchFn: () => Promise.reject(new Error('offline')) });
  assert.strictEqual(failed.ok, false);
  assert.strictEqual(failed.queued, true);
  assert.strictEqual(feedbackStatusText(failed), '提交暂未成功，已暂存到本机；联网后会自动补传。');
  assert.strictEqual(JSON.parse(failedStorage.data).length, 1);

  const sentStorage = { data: null, getItem() { return this.data; }, setItem(key, value) { this.data = value; } };
  const sent = await submitFeedback({ description: 'test' }, { endpoint: 'https://example.invalid', storage: sentStorage, fetchFn: async () => ({ ok: true }) });
  assert.strictEqual(sent.ok, true);
  assert.strictEqual(sent.queued, false);
  assert.strictEqual(feedbackStatusText(sent), '已提交，感谢反馈');
  assert.strictEqual(sentStorage.data, null);

  const queuedStorage = { data: JSON.stringify([{ id: 1 }, { id: 2 }]), getItem() { return this.data; }, setItem(key, value) { this.data = value; } };
  const flushRequests = [];
  const flushed = await flushFeedbackQueue({ endpoint: '/marmot3d-beta/api/feedback', storage: queuedStorage, fetchFn: async (url, options) => {
    flushRequests.push({ url, body: JSON.parse(options.body) });
    return { ok: true };
  } });
  assert.strictEqual(flushed.flushed, 2);
  assert.strictEqual(flushed.remaining, 0);
  assert.deepStrictEqual(flushRequests.map((item) => item.url), ['/marmot3d-beta/api/feedback', '/marmot3d-beta/api/feedback']);
  assert.strictEqual(JSON.parse(queuedStorage.data).length, 0);

  const concurrentStorage = { data: JSON.stringify([{ id: 'pending' }]), getItem() { return this.data; }, setItem(key, value) { this.data = value; } };
  let injectedConcurrentItem = false;
  const raceFlush = flushFeedbackQueue({ endpoint: '/marmot3d-beta/api/feedback', storage: concurrentStorage, fetchFn: async () => {
    if (!injectedConcurrentItem) {
      injectedConcurrentItem = true;
      enqueueFeedback({ id: 'added-during-request' }, concurrentStorage);
    }
    return { ok: true };
  } });
  const raceResult = await raceFlush;
  assert.strictEqual(raceResult.flushed, 2);
  assert.strictEqual(raceResult.remaining, 0);
  assert.deepStrictEqual(JSON.parse(concurrentStorage.data), []);

  let submitCount = 0;
  const elements = {
    '#feedbackText': { value: '描述' }, '#feedbackType': { value: '其他' },
    '.feedback-status': { textContent: '' }, '#feedbackSubmit': { disabled: false },
  };
  const ui = new FeedbackUI({ getSnapshot: () => ({}), endpoint: '' });
  ui.root = { querySelector(selector) { return elements[selector]; } };
  let writes = 0;
  const originalSetItem = localStorage.setItem;
  localStorage.setItem = function (key, value) { writes++; originalSetItem.call(this, key, value); };
  await ui.submit();
  await ui.submit();
  submitCount = writes;
  assert.strictEqual(submitCount, 1);
  const afterDebounce = JSON.parse(localStorage.getItem('m3d_feedback_queue'));
  assert.strictEqual(afterDebounce[afterDebounce.length - 1].description, '描述');
  assert.strictEqual(elements['#feedbackSubmit'].disabled, false);
  assert.strictEqual(elements['.feedback-status'].textContent, '提交暂未成功，已暂存到本机；联网后会自动补传。');
  assert(ui.lastSubmit > 0);
  // The second immediate invocation must not replace the first payload or reset debounce.
  assert.strictEqual(ui.lastSubmit > Date.now() - 1000, true);
  console.log('feedback tests passed');
}

run().catch((error) => { console.error(error); process.exitCode = 1; });
