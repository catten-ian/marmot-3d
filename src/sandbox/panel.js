import { SANDBOX_DIFFICULTIES, SANDBOX_TYPES } from './state.js';

const typeLabels = { normal: '普通', fast: '疾行', heavy: '厚皮', pup: '幼狐', boss: '首领' };

// 沙盒浮动触屏按钮：挂在 #sandboxTouchLayer 里，由 TouchLayout 统一布局/调尺寸/透明度。
// 测试面板（.sandbox-controls）里保留同一套 data-sandbox-action 按钮供鼠标调试，
// TouchLayout 只接管浮动层内的按钮，两者互不影响。
export const SANDBOX_TOUCH_ACTIONS = [
  { id: 'refill', label: '回满', title: '回满生命 / 储备' },
  { id: 'clearStress', label: '减压', title: '清零应激' },
  { id: 'charge', label: '满大', title: '充满大招' },
  { id: 'resetFood', label: '食物', title: '重置食物' },
  { id: 'spawnOne', label: '+1狐', title: '前方生成 1 只' },
  { id: 'spawnGroup', label: '+群狐', title: '前方生成一群' },
  { id: 'clearFoxes', label: '清狐', title: '清除全部狐狸' },
];

function setupSandboxTouchLayer(onAction) {
  let layer = document.getElementById('sandboxTouchLayer');
  if (!layer) {
    layer = document.createElement('div');
    layer.id = 'sandboxTouchLayer';
    layer.className = 'sandbox-touch-layer';
    layer.innerHTML = SANDBOX_TOUCH_ACTIONS
      .map((a) => `<button type="button" data-sandbox-action="${a.id}" title="${a.title}" aria-label="${a.title}">${a.label}</button>`)
      .join('');
    document.body.appendChild(layer);
    // 编辑布局时 TouchLayout 会在捕获阶段截下点击；非编辑态才走到这里触发动作。
    layer.addEventListener('click', (event) => {
      const action = event.target.closest('[data-sandbox-action]')?.dataset.sandboxAction;
      if (action) onAction?.(action);
    });
  }
  return layer;
}

export function setupSandboxPanel({ root, state, onAction, onChange }) {
  if (!root) return null;
  const existing = root.querySelector('.sandbox-controls');
  if (existing) existing.remove();
  setupSandboxTouchLayer(onAction);
  const section = document.createElement('section');
  section.className = 'sandbox-controls';
  section.innerHTML = `
    <div class="sandbox-heading">自由测试沙盒</div>
    <div class="sandbox-subline">无关卡 · 无时间限制 · 不计入正式进度<br>沙盒快捷按钮浮在屏幕左侧，可在「设置 → 触屏技能盘」里拖动 / 调大小与透明度</div>
    <label class="test-toggle"><input id="sandboxGodMode" type="checkbox"> 无敌</label>
    <label class="test-toggle"><input id="sandboxFreezeTimer" type="checkbox" checked> 冻结 / 关闭计时</label>
    <label class="test-toggle"><input id="sandboxParryDrill" type="checkbox"> 迎击练习（单狐正面冲刺，击退即重来）</label>
    <div class="test-actions sandbox-actions">
      <button type="button" data-sandbox-action="refill">回满生命 / 储备</button>
      <button type="button" data-sandbox-action="clearStress">清零应激</button>
      <button type="button" data-sandbox-action="charge">充满大招</button>
      <button type="button" data-sandbox-action="resetFood">重置食物</button>
    </div>
    <div class="sandbox-spawn-row">
      <label>狐狸类型 <select id="sandboxFoxType">${SANDBOX_TYPES.map((t) => `<option value="${t}">${typeLabels[t] || t}</option>`).join('')}</select></label>
      <label>难度 <select id="sandboxDifficulty">${Object.entries(SANDBOX_DIFFICULTIES).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('')}</select></label>
    </div>
    <div class="test-actions sandbox-actions">
      <button type="button" data-sandbox-action="spawnOne">前方生成 1 只</button>
      <button type="button" data-sandbox-action="spawnGroup">前方生成一群</button>
      <button type="button" data-sandbox-action="clearFoxes">清除全部狐狸</button>
    </div>
    <div class="sandbox-debug" id="sandboxDebug" aria-live="polite"></div>
  `;
  root.appendChild(section);
  const god = section.querySelector('#sandboxGodMode');
  const freeze = section.querySelector('#sandboxFreezeTimer');
  const parryDrill = section.querySelector('#sandboxParryDrill');
  const type = section.querySelector('#sandboxFoxType');
  const difficulty = section.querySelector('#sandboxDifficulty');
  god.checked = !!state.godMode;
  freeze.checked = state.freezeTimer !== false;
  parryDrill.checked = !!state.parryDrill;
  type.value = state.selectedType;
  difficulty.value = state.difficulty;
  god.onchange = () => { state.godMode = god.checked; onChange?.('godMode', state.godMode); };
  freeze.onchange = () => { state.freezeTimer = freeze.checked; onChange?.('freezeTimer', state.freezeTimer); };
  parryDrill.onchange = () => { state.parryDrill = parryDrill.checked; onChange?.('parryDrill', parryDrill.checked); };
  type.onchange = () => { state.selectedType = type.value; onChange?.('foxType', type.value); };
  difficulty.onchange = () => { onChange?.('difficulty', difficulty.value); };
  section.addEventListener('click', (event) => {
    const action = event.target.closest('[data-sandbox-action]')?.dataset.sandboxAction;
    if (action) onAction?.(action);
  });
  return {
    section,
    update({ game, controller, foxes, fps }) {
      const debug = section.querySelector('#sandboxDebug');
      if (!debug) return;
      const statuses = foxes.slice(0, 5).map((f) => `${f.type}:${f.state}`).join(' · ') || '无';
      debug.innerHTML = `FPS <b>${Math.round(fps || 0)}</b>　坐标 <b>${controller.position.x.toFixed(1)}, ${controller.position.z.toFixed(1)}</b><br>`
        + `yaw <b>${controller.yaw.toFixed(2)}</b>　狐狸 <b>${foxes.length}</b><br>`
        + `<span>${statuses}${foxes.length > 5 ? ' …' : ''}</span>`
        + (state.lastCommand ? `<br><em>${state.lastCommand}</em>` : '');
    },
  };
}
