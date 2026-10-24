/**
 * 视角状态卡（beta）：常驻显示当前是第一/第三人称，跟随 setViewMode 实时更新。
 *
 * 元素由 JS 创建（仅 beta 调用），因此 stable/dev 的 DOM 完全不变。
 * 卡片纳入 touch-layout 的 CARDS（id: hudViewMode，选择器 .viewmode-card），
 * 自动获得可拖动 / X·Y 百分比 / 大小 / 透明度 / 编辑态可见等既有能力。
 *
 * 样式说明：styles.css 带 ?v= 缓存戳而本批不升戳，因此基础观感用 inline style
 * 保证立即生效；仅编辑态（拖动/选中描边）这类不影响默认观感的规则放进新增的
 * styles-beta-addon.css（新文件无旧缓存）。
 */

/** 创建（幂等）并返回视角状态卡元素。 */
export function ensureViewModeCard() {
  let el = document.querySelector('.viewmode-card');
  if (el) return el;
  el = document.createElement('div');
  el.className = 'viewmode-card';
  el.id = 'viewModeCard';
  el.setAttribute('aria-live', 'polite');
  // inline 基础样式：深色科技风，与其余 HUD 卡一致；右上、小地图设计位下方。
  // 布局系统接管后会改写 position/left/top 等定位属性。
  el.style.cssText = [
    'position:fixed',
    'top:calc(262px + var(--safe-top, 0px))',
    'right:calc(14px + var(--safe-right, 0px))',
    'z-index:18',
    'padding:5px 10px',
    'background:rgba(9,20,16,.55)',
    'border:1px solid #5e7b63',
    'border-radius:8px',
    'color:#dcebc9',
    'font-size:12px',
    'line-height:1.4',
    'text-shadow:0 1px 3px #000',
    'pointer-events:none',
    'white-space:nowrap',
  ].join(';');
  document.body.appendChild(el);
  updateViewModeCard(false, el);
  return el;
}

/** 刷新文案：第一人称 / 第三人称。 */
export function updateViewModeCard(thirdPerson, el = null) {
  const card = el || document.querySelector('.viewmode-card');
  if (!card) return;
  const label = thirdPerson ? '第三人称' : '第一人称';
  card.textContent = `视角：${label}`;
  card.dataset.viewMode = thirdPerson ? 'third' : 'first';
}
