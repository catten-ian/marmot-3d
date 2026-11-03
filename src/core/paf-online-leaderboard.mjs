import { AccountsApi } from './accounts-api.mjs';

function publicEntry(value) {
  if (!value || typeof value !== 'object' || !Number.isInteger(value.rank) || value.rank < 1
    || !Number.isInteger(value.score) || value.score < 0 || value.score > 100000
    || value.durationMs !== 120000 || typeof value.submittedAt !== 'string'
    || !Number.isFinite(Date.parse(value.submittedAt))) throw new Error('在线榜响应格式无效');
  return { rank: value.rank, score: value.score, durationMs: value.durationMs, submittedAt: value.submittedAt };
}

export function createPafOnlineLeaderboard({ api = new AccountsApi(), limit = 50 } = {}) {
  const safeLimit = Math.max(1, Math.min(100, Math.trunc(Number(limit) || 50)));
  const listeners = new Set();
  let loadSequence = 0;
  let submitSequence = 0;
  let lastResult = null;
  let state = {
    status: 'idle', items: [], total: 0, error: '',
    submission: { status: 'idle', rank: null, total: 0, error: '' },
  };
  const snapshot = () => ({ ...state, items: state.items.slice(), submission: { ...state.submission } });
  const emit = () => { const value = snapshot(); for (const listener of listeners) listener(value); };
  const patch = (value) => { state = { ...state, ...value }; emit(); };

  async function load() {
    const sequence = ++loadSequence;
    patch({ status: 'loading', items: [], total: 0, error: '' });
    try {
      const response = await api.request('/paf/leaderboard', { query: { limit: safeLimit } });
      if (sequence !== loadSequence) return false;
      if (!response || !Number.isInteger(response.total) || response.total < 0 || !Array.isArray(response.items)) throw new Error('在线榜响应格式无效');
      const items = response.items.map(publicEntry);
      patch({ status: items.length ? 'ready' : 'empty', items, total: response.total, error: '' });
      return true;
    } catch (error) {
      if (sequence !== loadSequence) return false;
      patch({ status: 'error', items: [], total: 0, error: String(error?.message || '在线榜加载失败') });
      return false;
    }
  }

  async function submit(result) {
    if (state.submission.status === 'submitting') return false;
    const score = result?.score;
    if (!Number.isInteger(score) || score < 0 || score > 100000 || result?.durationMs !== 120000) throw new TypeError('PAF 在线成绩无效');
    lastResult = { score, durationMs: 120000 };
    const sequence = ++submitSequence;
    patch({ submission: { status: 'submitting', rank: null, total: 0, error: '' } });
    try {
      const response = await api.request('/paf/scores', { method: 'POST', body: lastResult });
      if (sequence !== submitSequence) return false;
      const entry = publicEntry(response?.entry);
      if (!response?.ok || !Number.isInteger(response.rank) || response.rank !== entry.rank || !Number.isInteger(response.total)) throw new Error('在线提交回执无效');
      patch({ submission: { status: 'success', rank: response.rank, total: response.total, error: '' } });
      await load();
      return true;
    } catch (error) {
      if (sequence !== submitSequence) return false;
      patch({ submission: { status: 'error', rank: null, total: 0, error: String(error?.message || '在线提交失败') } });
      return false;
    }
  }

  return {
    getState: snapshot,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    load,
    submit,
    retry() { return lastResult ? submit(lastResult) : load(); },
    resetSubmission() {
      lastResult = null; submitSequence += 1;
      patch({ submission: { status: 'idle', rank: null, total: 0, error: '' } });
    },
  };
}
