/**
 * Beta 数值/可视化后台入口：组装版本信息、数值面板与 3D 预览。
 * 本页只做内存态预览，不写回任何源码文件。
 */
import { IS_BETA, BUILD_STAMP, CHANNEL_SHORT } from '../core/version.js';
import {
  buildTuningEntries, indexEntries, createTuningState,
} from './tuning-schema.mjs';
import { TuningPanel } from './panel.mjs';
import { AdminPreview } from './preview.mjs';
import { FeedbackPanel } from './feedback-panel.mjs';
import { MechanismDocs } from './mechanism-docs.mjs';
import { deriveApiBase } from './tuning-schema.mjs';

const $ = (sel) => document.querySelector(sel);

function toastFactory() {
  const box = $('#toasts');
  return (msg, kind = 'ok') => {
    const el = document.createElement('div');
    el.className = `toast ${kind}`;
    el.textContent = msg;
    box.appendChild(el);
    setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 400); }, 3600);
  };
}
const toast = toastFactory();

// —— 顶部版本信息 ——
(function header() {
  const chan = $('#channel');
  chan.textContent = `${CHANNEL_SHORT} 通道 · ${BUILD_STAMP}`;
  chan.classList.add(IS_BETA ? 'beta' : 'not-beta');
  $('#mode').textContent = '本页数值改动仅作用于预览场景（内存态），不会写回源码文件';
  $('#path').textContent = '访问路径：/marmot3d-beta/admin.html';
  if (!IS_BETA) $('#beta-warning').hidden = false;
})();

const entries = buildTuningEntries();
const entriesById = indexEntries(entries);
const state = createTuningState(entries);
$('#tune-count').textContent = `共 ${entries.length} 项可调数值`;
let preview = null;

// 三个工作区相互独立；隐藏预览不销毁 WebGL，返回调参时保留当前编辑状态。
document.querySelectorAll('[data-view]').forEach((button) => {
  button.addEventListener('click', () => {
    const view = button.dataset.view;
    document.querySelectorAll('[data-view]').forEach((item) => item.classList.toggle('active', item === button));
    $('#tuning-view').hidden = view !== 'tuning';
    $('#feedback-view').hidden = view !== 'feedback';
    $('#docs-view').hidden = view !== 'docs';
    if (view === 'feedback') $('#feedback-view').querySelector('input')?.focus();
  });
});
let apiBase = '/api';
try { apiBase = deriveApiBase(location.pathname); } catch { /* local preview fallback */ }
new FeedbackPanel({ root: $('#feedback-view'), apiBase, onToast: toast });
new MechanismDocs({ root: $('#docs-view'), entries });

function refreshWindowSummary() {
  const box = $('#window-summary');
  const type = $('#fox-type').value;
  const get = (id, fallback = 0) => Number.isFinite(state.values[id]) ? state.values[id] : fallback;
  const mode = state.values[`foxAtk.${type}.mode`] || 'straight';
  const windMul = get(`foxAtk.${type}.windMul`, 1);
  const typeWind = get(`foxType.${type}.wind`, 1);
  const baseWind = get('world.LEVELS.0.wind', 0.76);
  const windSeconds = Math.max(0.01, baseWind * typeWind * windMul);
  const dash = get(`foxAtk.${type}.dashTime`, 0.32);
  const recoveryKey = mode === 'leap' ? 'leap' : mode === 'combo' ? 'combo' : mode === 'straight' && type === 'fast' ? 'fast' : 'normal';
  const recovery = get(`fox.recovery.${recoveryKey}`, 1);
  const pounceWind = get('smart.pounce.windup', 0.22);
  const pounceTime = get('smart.pounce.lockTime', 0.72);
  const pounceCooldown = get('smart.pounceCooldown', 1.2);
  const parts = [windSeconds, dash, recovery].map((n) => Math.max(0.05, Number(n) || 0.05));
  const total = parts.reduce((a, b) => a + b, 0);
  const pct = parts.map((n) => 100 * n / total);
  box.innerHTML = `
    <div class="window-line"><span>狐狸档案</span><span class="window-bar"><i class="wind" style="width:${pct[0]}%"></i><i class="dash" style="width:${pct[1]}%"></i><i class="recover" style="width:${pct[2]}%"></i></span></div>
    <div class="window-text">蓄力 ${windSeconds.toFixed(2)}s（关卡基准 ×${typeWind.toFixed(2)} ×${windMul.toFixed(2)}）· 冲刺 ${dash.toFixed(2)}s · 后摇 ${recovery.toFixed(2)}s</div>
    <div class="window-line"><span>智能扑击</span><span class="window-bar"><i class="wind" style="width:${100*pounceWind/(pounceWind+pounceTime+pounceCooldown)}%"></i><i class="dash" style="width:${100*pounceTime/(pounceWind+pounceTime+pounceCooldown)}%"></i><i class="recover" style="width:${100*pounceCooldown/(pounceWind+pounceTime+pounceCooldown)}%"></i></span></div>
    <div class="window-text">前摇 ${pounceWind.toFixed(2)}s · 扑击锁定 ${pounceTime.toFixed(2)}s · 冷却 ${pounceCooldown.toFixed(2)}s</div>`;
}

// 数值面板先渲染；即使浏览器不支持 WebGL，导入导出和数值查看仍可用。
new TuningPanel({
  root: $('#panel'), entries, entriesById, state,
  onChange: () => {
    preview?.rebuildVolumes();
    if (preview) {
      preview.refreshTuning();
    }
    refreshWindowSummary();
  },
  onToast: toast,
});

try {
  preview = new AdminPreview({
    canvas: $('#view'),
    values: state.values,
    onStatus: (msg) => { $('#model-status').textContent = msg; },
  });
} catch (err) {
  $('#view').hidden = true;
  $('#stage').insertAdjacentHTML('afterbegin', '<div class="preview-error">当前浏览器无法初始化 WebGL 3D 预览；数值面板、导入导出仍可使用。</div>');
  $('#model-status').textContent = `预览初始化失败：${err?.message || err}`;
}

if (preview) {
  document.querySelectorAll('[data-pose]').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-pose]').forEach((b) => b.classList.toggle('active', b === btn));
      preview.setPose(btn.dataset.pose);
    });
  });
  $('#fox-type').addEventListener('change', (e) => {
    preview.setFoxType(e.target.value);
    refreshWindowSummary();
  });
  $('#fox-yaw').addEventListener('input', (e) => { preview.setYaw(Number(e.target.value) * Math.PI / 180); preview.rebuildVolumes(); });
  $('#fox-x').addEventListener('input', (e) => { preview.foxRoot.position.x = Number(e.target.value); preview.rebuildVolumes(); });
  $('#fox-z').addEventListener('input', (e) => { preview.foxRoot.position.z = Number(e.target.value); preview.rebuildVolumes(); });
  document.querySelectorAll('[data-object]').forEach((cb) => { cb.addEventListener('change', () => preview.setObjectVisible(cb.dataset.object, cb.checked)); });
  $('#timeline-play').addEventListener('click', (e) => { preview.toggleTimeline(); e.target.textContent = preview.timeline.playing ? '暂停' : '继续'; });
  $('#timeline-replay').addEventListener('click', () => { preview.replayTimeline(); $('#timeline').value = 0; $('#timeline-play').textContent = '暂停'; });
  $('#timeline').addEventListener('input', (e) => preview.setTimelineTime(e.target.value));
  document.querySelectorAll('[data-vol]').forEach((cb) => {
    cb.addEventListener('change', () => {
      preview.show[cb.dataset.vol] = cb.checked;
      preview.rebuildVolumes();
    });
  });
}
refreshWindowSummary();
$('#year').textContent = String(new Date().getFullYear());
