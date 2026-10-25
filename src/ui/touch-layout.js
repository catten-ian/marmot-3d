/**
 * 触屏技能盘的布局、编辑与持久化。坐标以视口归一化百分比保存，
 * 应用时按安全区和按钮半径夹紧，因此旋转屏幕/窄屏不会把按键挤出画面。
 *
 * 管理四类控件：
 * - 战斗键 data-touch-action（右下动作盘 + 暂停）；
 * - 现有的「沙盒控制」入口按钮 #testModeBtn（沙盒中文字为“沙盒控制”，
 *   点击打开既有 #testPanel）。它是唯一可调整的沙盒入口；
 *   不创建任何额外的浮动沙盒快捷按钮。
 * - 移动摇杆 #touchJoystick：编辑态可拖动位置，设置面板可调整体大小；
 *   摇杆内圈（疾跑判定圈）大小即 joystick.sprintThreshold，滑动即时写回
 *   TouchControls.setSprintThreshold 并持久化。
 * - 常驻 HUD 信息卡（顶部状态 .vitals / 关卡信息 .mission /
 *   本关目标 .objective / 沙盒状态 .sandbox-status / 站立观察小地图 .minimap），
 *   布局存在独立的 cards 命名空间。
 * 四类 id 互不冲突，编辑态下点击/拖动任意一类都只做选中与布局，
 * 非编辑态各自走原来的输入/点击逻辑（摇杆照常移动，沙盒按钮仍开/关测试面板）。
 *
 * 旧版只有 buttons / joystick（甚至只有 sprintThreshold）的存档照常兼容：
 * 卡片自动落到设计默认位置，摇杆缺失字段补默认，不会覆盖或重置用户的动作按钮布局。
 */
import {
  SPRINT_STICK_THRESHOLD,
  clampSprintThreshold,
} from '../core/touch-settings.mjs';
import { IS_BETA } from '../core/version.js';

const STORAGE_KEY = 'marmot.touch-layout.v1';
// “启用触屏布局调整”开关：默认关闭。关闭时所有调整入口隐藏，setEditing(true) 被拒绝。
const ADJUST_STORAGE_KEY = 'marmot.settings.touchLayoutAdjust';
export function touchAdjustEnabled() {
  try { return localStorage.getItem(ADJUST_STORAGE_KEY) === '1'; }
  catch (_) { return false; }
}
export function setTouchAdjustStored(on) {
  try { localStorage.setItem(ADJUST_STORAGE_KEY, on ? '1' : '0'); }
  catch (error) { console.warn('触屏布局调整开关无法写入本地存储', error); }
}
// 疾跑已改为由摇杆拖动距离判定（见 touch-controls setSprintThreshold），不再有独立按钮。
const ACTIONS = ['attack', 'dodge', 'jump', 'interact', 'burst', 'ultimate', 'pause'];
// 唯一可调整的沙盒入口：index.html 里既有的 #testModeBtn。
const SANDBOX_CONTROL = 'sandboxControl';
const ALL_IDS = [...ACTIONS, SANDBOX_CONTROL];
// 移动摇杆：不在 buttons 字典里，布局挂在 layout.joystick 上，但同样可选中/拖动。
const JOYSTICK = 'joystick';
const SELECTABLE_IDS = [...ALL_IDS, JOYSTICK];
// 摇杆整体大小滑块范围（相对 CSS 基准尺寸的倍数）。
const JOYSTICK_SCALE_MIN = IS_BETA ? 0.5 : 0.7, JOYSTICK_SCALE_MAX = IS_BETA ? 1.8 : 1.4;
// 可调整的常驻 HUD 信息卡：布局 id → 页面元素。
// hudViewMode（视角状态卡）仅 beta 由 main.js 创建；stable/dev 上元素缺失，
// 构造时 cards[id] 为 null，设置面板下拉与编辑选中都按“存在的卡”过滤。
export const CARDS = ['hudVitals', 'hudMission', 'hudObjective', 'hudSandbox', 'hudMinimap', 'hudViewMode'];
const CARD_SELECTORS = {
  hudVitals: '.vitals', hudMission: '.mission', hudObjective: '.objective',
  hudSandbox: '.sandbox-status', hudMinimap: '.minimap', hudViewMode: '.viewmode-card',
};
// 卡片单卡缩放/透明度范围（比按钮更保守，避免卡片被缩到不可读）。
const CARD_SCALE = [0.75, 1.25];
const CARD_OPACITY = [0.35, 1];
const MINIMAP = 'hudMinimap';
function minimapDimensions(w, h) {
  const width = w > h && h <= 520 ? 128 : w <= 420 ? 142 : 174;
  // Canvas + 3px label margin + the 15px line box of the 10px label.
  return { w: width, h: width + 18 };
}
// 与 styles.css 中 .touch-joystick 的响应式基准直径保持一致（媒体查询同口径）。
function joystickBaseSize(w = innerWidth || 390, h = innerHeight || 844) {
  if (w > h && h <= 520) return 104; // 横屏低高度
  if (w <= 420) return 112;
  if (w <= 860) return 120;
  return 128;
}
const LABELS = {
  attack: '攻击', dodge: '翻滚', jump: '跳跃', interact: '交互', burst: '爆发', ultimate: '大招', pause: '暂停',
  sandboxControl: '沙盒控制（入口按钮）',
  joystick: '移动摇杆（含疾跑内圈）',
  hudVitals: '顶部状态卡（生命/储备/负荷）',
  hudMission: '关卡信息卡（第 X 关/时间/位置）',
  hudObjective: '本关目标卡',
  hudSandbox: '沙盒状态卡',
  hudMinimap: '站立观察小地图',
  hudViewMode: '视角状态卡（第一/第三人称）',
};
const SIZE = {
  attack: 76, dodge: 58, jump: 58, interact: 56, burst: 56, ultimate: 58, pause: 38,
  sandboxControl: 56,
};
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** Pure, DOM-free card normalization; missing card entries inherit their defaults. */
export function normalizeCardEntries(inputCards, baseCards, ids = CARDS) {
  const out = {};
  for (const id of ids) {
    const c = inputCards?.[id] || baseCards[id];
    out[id] = {
      x: clamp(Number.isFinite(Number(c.x)) ? Number(c.x) : baseCards[id].x, 0, 1),
      y: clamp(Number.isFinite(Number(c.y)) ? Number(c.y) : baseCards[id].y, 0, 1),
      scale: clamp(Number(c.scale) || 1, CARD_SCALE[0], CARD_SCALE[1]),
      opacity: clamp(Number(c.opacity) || 1, CARD_OPACITY[0], CARD_OPACITY[1]),
    };
  }
  return out;
}

/** Pure, DOM-free safe-area clamp using the element's current rendered dimensions. */
export function clampCardCenter(x, y, scale, safe, w, h, rect, currentScale = 1, design = null) {
  const bw = rect?.width ? rect.width / currentScale : (design?.w || 170);
  const bh = rect?.height ? rect.height / currentScale : (design?.h || 92);
  const hx = Math.min(bw * scale / 2 + 4, w / 2);
  const hy = Math.min(bh * scale / 2 + 4, h / 2);
  const axis = (value, size, minInset, maxInset, half) => {
    const min = minInset + half, max = size - maxInset - half;
    return min <= max ? clamp(value, min, max) : size / 2;
  };
  return {
    x: axis(x, w, safe.left, safe.right, hx),
    y: axis(y, h, safe.top, safe.bottom, hy),
  };
}
/** 归一化 0..1 → 展示用百分比（0-100，保留 1 位小数）。 */
export function normalizedToPercent(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.round(clamp(n, 0, 1) * 1000) / 10;
}

/**
 * 百分比输入（数字或带 % 的字符串）→ 归一化 0..1。
 * 非法输入返回 null（调用方保持原值），越界输入 clamp 到边界，绝不产生 NaN。
 */
export function percentToNormalized(input) {
  const text = String(input).trim().replace(/%\s*$/, '');
  if (text === '') return null; // 空输入（清空输入框过程态）保持原值
  const n = Number(text);
  if (!Number.isFinite(n)) return null;
  // 5 位小数取整：消除 87.6/100=0.8759999… 这类浮点尾巴，保证百分比↔归一化往返一致。
  return Math.round(clamp(n / 100, 0, 1) * 100000) / 100000;
}

// 攻击键内圈（装饰触发核心）默认占外圈 55%、不透明度 92%，滑块范围 40-100% / 30-100%。
const ATTACK_CORE_DEFAULTS = { size: 0.55, opacity: 0.92 };

function readInsets() {
  const probe = document.getElementById('touchSafeInsets');
  if (!probe) return { top: 0, right: 0, bottom: 0, left: 0 };
  const s = getComputedStyle(probe);
  return { top: parseFloat(s.paddingTop) || 0, right: parseFloat(s.paddingRight) || 0,
    bottom: parseFloat(s.paddingBottom) || 0, left: parseFloat(s.paddingLeft) || 0 };
}

export class TouchLayout {
  constructor() {
    this.root = document.getElementById('touchControls');
    // 可拖动键都在右侧 .touch-actions 动作栏里；pause 在动作栏外，单独从 root 取。
    this.actionLayer = this.root?.querySelector('.touch-actions') || this.root;
    this.adjustEnabled = touchAdjustEnabled();
    // 有效输入模式为触屏时才允许编辑浮动触控控件（由 main.js 注入）。
    this.touchModeAvailable = true;
    // 由 main.js 注入的游戏暂停/恢复钩子；调整态进出时自动暂停/继续。
    this.pauseHooks = null;
    this.onEditingStart = null;
    // 本次调整是否由编辑器发起的暂停（调整前已在暂停态则退出调整时保持暂停）。
    this._pausedByEditor = false;
    // 疾跑触发范围变化时由 main.js 注入 TouchControls 实时生效。
    this.onSprintThreshold = null;
    // 摇杆整体大小变化时由 main.js 注入 TouchControls.setJoystickScale 实时生效。
    this.onJoystickScale = null;
    this.buttons = Object.fromEntries(ACTIONS.map((id) => {
      const scope = id === 'pause' ? this.root : this.actionLayer;
      return [id, scope?.querySelector(`[data-touch-action="${id}"]`)];
    }));
    // 现有「沙盒控制」入口按钮（在 #touchControls 之外，直接取 id）。
    this.buttons[SANDBOX_CONTROL] = document.getElementById('testModeBtn');
    // 移动摇杆本体（位置/大小可调整；非编辑态仍是 TouchControls 的移动输入）。
    this.joystickEl = document.getElementById('touchJoystick');
    // 常驻 HUD 信息卡。布局系统用 position:fixed 接管定位，
    // 因此先在改动任何样式之前量出 CSS 设计位置，作为默认布局与卡片宽度基准。
    this.cards = Object.fromEntries(CARDS.map((id) => [id, document.querySelector?.(CARD_SELECTORS[id]) || null]));
    this._design = this._measureCards();
    this._appliedCardScale = {};
    // 用户拖过的卡片位置：refreshCardDefaults 只跟随仍为默认位置的卡，
    // 用户拖过（或存档里已有）的卡片位置永远以用户方案为准。
    this._cardPosTouched = {};
    this.editing = false;
    this.selected = 'attack';
    this.layout = this._load() || this.defaultLayout();
    // 存档里已带 cards 位置 = 用户已保存的方案，刷新默认时不得覆盖。
    try {
      const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      for (const id of CARDS) {
        if (raw?.cards?.[id] && Number.isFinite(Number(raw.cards[id].x))) this._cardPosTouched[id] = true;
      }
    } catch (_) { /* 存档损坏时按全新默认处理 */ }
    this._bindEditor();
    // 键鼠模式编辑 HUD 卡片时的“完成编辑”悬浮按钮（在触控层之外）。
    this.kbDoneBtn = document.getElementById('kbLayoutDone');
    this.kbDoneBtn?.addEventListener('click', () => { if (this.editing) this.setEditing(false); });
    this._syncAdjustVisibility();
    this.apply();
  }

  /** main.js 注入暂停钩子：{ pause(), resume(), isPaused() } */
  setPauseHooks(hooks) { this.pauseHooks = hooks || null; }

  /** Transfer a pause already owned by an enclosing settings sheet to this editor. */
  adoptExistingPause() {
    if (this.editing && this.pauseHooks?.isPaused?.()) this._pausedByEditor = true;
  }

  _syncAdjustVisibility() {
    // CSS 据此隐藏/显示所有带 data-touch-adjust 的"调整键"。
    document.documentElement?.setAttribute('data-touch-adjust-enabled', this.adjustEnabled ? 'true' : 'false');
  }

  /** 有效输入模式变化：记录当前是否为触屏。键鼠模式不再强制退出编辑，
   * 而是把可编辑范围收窄为常驻 HUD 卡片（不显示虚拟摇杆/动作层）。 */
  setTouchModeAvailable(on) {
    this.touchModeAvailable = on !== false;
    if (!this.touchModeAvailable && this.editing && !CARDS.includes(this.selected)) {
      this.selected = 'hudVitals';
    }
    this.apply();
  }

  /** 设置面板里的"启用触屏布局调整"总开关 */
  setAdjustEnabled(on) {
    this.adjustEnabled = !!on;
    setTouchAdjustStored(this.adjustEnabled);
    this._syncAdjustVisibility();
    if (!this.adjustEnabled && this.editing) this.setEditing(false);
    else this.apply();
  }

  /** 记录常驻 HUD 卡的 CSS 设计位置/尺寸（在任何 inline 样式写入之前调用）。 */
  _measureCards() {
    const out = {};
    for (const id of CARDS) {
      const d = this._measureCard(this.cards[id]);
      if (d) out[id] = d;
    }
    return out;
  }

  /**
   * 量单张卡的 CSS 设计位置：先临时清掉布局系统写入的 inline 定位样式，
   * 让元素回到样式表位置再测，测完恢复。元素缺失/隐藏时返回 null。
   */
  _measureCard(el) {
    if (!el?.getBoundingClientRect) return null;
    const PROPS = ['position', 'left', 'top', 'right', 'bottom', 'margin', 'width', 'maxWidth', 'transform', 'transformOrigin', 'opacity', 'zIndex', 'transition'];
    const saved = {};
    // The managed class mirrors the map's center transform in CSS so minimap.on
    // visibility changes cannot drop its persisted center positioning. Remove it
    // during design measurement, then restore it with the original inline styles.
    const isMinimap = el.classList?.contains('minimap');
    const managedMinimap = el.classList?.contains('touch-layout-managed');
    if (managedMinimap) el.classList.remove('touch-layout-managed');
    for (const p of PROPS) { saved[p] = el.style[p] || ''; el.style[p] = ''; }
    // 小地图 opacity:0 仍有正常布局盒；清掉隐藏态的 translateY/scale，
    // 默认中心应与实玩态 top/right 锚点一致，而不是向上偏移 6px、缩小 4%。
    if (isMinimap) {
      el.style.transition = 'none';
      el.style.transform = 'none';
    }
    const rect = el.getBoundingClientRect();
    for (const p of PROPS) el.style[p] = saved[p];
    if (managedMinimap) el.classList.add('touch-layout-managed');
    if (!rect || rect.width <= 0 || rect.height <= 0) return null;
    return { cx: rect.left + rect.width / 2, cy: rect.top + rect.height / 2, w: rect.width, h: rect.height };
  }

  /**
   * 重新测量仍为默认位置的 HUD 卡并重新应用布局。
   * body.touch-playing 切换、旋转/resize 会改变卡片的 CSS 设计位置；
   * 用户拖过或已保存过位置的卡（_cardPosTouched）保持用户方案不动。
   */
  refreshCardDefaults() {
    const w = Math.max(320, innerWidth || 390), h = Math.max(320, innerHeight || 844);
    for (const id of CARDS) {
      if (this._cardPosTouched[id]) continue;
      const d = this._measureCard(this.cards[id]);
      if (!d) continue;
      this._design[id] = d;
      const item = this.layout.cards?.[id];
      if (item) { item.x = d.cx / w; item.y = d.cy / h; }
    }
    this.apply();
  }

  /** 卡片元素缺失/不可测量（窄屏隐藏或测试环境）时的兜底默认中心点。 */
  _cardFallback(id, w, h, safe, landscape) {
    if (id === 'hudVitals') return [safe.left + 214, safe.top + (landscape ? 30 : 42)];
    if (id === 'hudMission') return [Math.min(w / 2, safe.left + 560), safe.top + (landscape ? 30 : 42)];
    // hudObjective：桌面右下；触屏实玩/窄屏放右上安全区（顶部 HUD 下方，避开动作轮盘）。
    if (id === 'hudSandbox') {
      // 小地图位于右上，沙盒卡固定放在其下方并保留一段间距，避免覆盖地图。
      return [w - safe.right - (landscape ? 76 : 86), safe.top + (landscape ? 222 : 300)];
    }
    if (id === MINIMAP) {
      const { w: mapWidth, h: mapHeight } = minimapDimensions(w, h);
      const top = landscape && h <= 520 ? 42 : w <= 860 ? 96 : 64;
      const right = w <= 860 ? 9 : 14;
      return [w - safe.right - right - mapWidth / 2, safe.top + top + mapHeight / 2];
    }
    if (id === 'hudViewMode') {
      // 默认贴右上、小地图正下方；与 view-mode-card.js 的 inline 设计位置一致。
      const top = landscape && h <= 520 ? 42 + 128 + 26 : w <= 860 ? 96 + 142 + 26 : 64 + 174 + 26;
      const right = w <= 860 ? 9 : 14;
      return [w - safe.right - right - 56, safe.top + top + 14];
    }
    if (w <= 860 || landscape) return [w - safe.right - 86, safe.top + (landscape ? 122 : 196)];
    return [w - safe.right - 116, h - safe.bottom - 100];
  }

  defaultLayout() {
    const w = Math.max(320, innerWidth || 390), h = Math.max(320, innerHeight || 844);
    const safe = readInsets();
    const landscape = w > h;
    const unit = Math.min(w, h);
    const ax = landscape ? w - safe.right - Math.max(176, unit * .48) : w - safe.right - Math.max(150, w * .4);
    const ay = landscape ? h - safe.bottom - Math.max(154, h * .4) : h - safe.bottom - Math.max(230, h * .273);
    const dx = landscape ? Math.max(66, Math.min(78, unit * .2)) : Math.max(54, Math.min(70, w * .18));
    const dy = landscape ? Math.max(57, Math.min(68, unit * .17)) : Math.max(62, Math.min(76, h * .2));
    const jSize = joystickBaseSize(w, h);
    // 攻击居中最大，跳跃正上方，交互/爆发/大招环绕两侧。
    const positions = {
      attack: [ax, ay],
      dodge: [ax - dx, ay - dy * 0.4],
      jump: [ax, ay - 96],
      interact: [ax + dx, ay - dy],
      burst: [ax - dx, ay + dy],
      ultimate: [ax + dx, ay + dy],
      pause: [w - safe.right - 28, safe.top + 61],
      // 与既有 .test-mode-btn CSS 默认位置一致：左下角（left≈12, bottom≈42 的小按钮）。
      // 沙盒控制入口放在摇杆上方，避免与左侧移动输入重叠；旧存档位置仍照常保留。
      sandboxControl: [safe.left + 56, h - safe.bottom - jSize - 26],
    };
    const buttons = {};
    for (const id of ALL_IDS) buttons[id] = { x: positions[id][0] / w, y: positions[id][1] / h, scale: 1 };
    buttons.attack.coreSize = ATTACK_CORE_DEFAULTS.size;
    buttons.attack.coreOpacity = ATTACK_CORE_DEFAULTS.opacity;
    const cards = {};
    for (const id of CARDS) {
      const d = this._design?.[id];
      const fb = d ? [d.cx, d.cy] : this._cardFallback(id, w, h, safe, w > h);
      cards[id] = { x: fb[0] / w, y: fb[1] / h, scale: 1, opacity: 1 };
    }
    return {
      scale: 1,
      opacity: 1,
      buttons,
      // HUD 卡片：独立命名空间；旧存档没有该字段时由 _normalize 补默认值。
      cards,
      // 摇杆：中心（归一化）/ 整体大小倍数 / 真实疾跑触发范围（摇杆归一化行程，非装饰圆）。
      joystick: {
        x: (safe.left + 14 + jSize / 2) / w,
        y: (h - safe.bottom - 14 - jSize / 2) / h,
        scale: 1,
        sprintThreshold: SPRINT_STICK_THRESHOLD,
      },
    };
  }

  _normalize(input) {
    const base = this.defaultLayout();
    if (!input || typeof input !== 'object') return base;
    const out = { scale: clamp(Number(input.scale) || 1, .65, 1.5), opacity: clamp(Number(input.opacity) || 1, .3, 1), buttons: {} };
    for (const id of ALL_IDS) {
      const b = input.buttons?.[id] || base.buttons[id];
      out.buttons[id] = {
        x: clamp(Number.isFinite(Number(b.x)) ? Number(b.x) : base.buttons[id].x, 0, 1),
        y: clamp(Number.isFinite(Number(b.y)) ? Number(b.y) : base.buttons[id].y, 0, 1),
        scale: clamp(Number(b.scale) || 1, .65, 1.5),
        opacity: clamp(Number(b.opacity) || 1, .3, 1),
      };
      if (id === 'attack') {
        // 兼容平铺别名 attackCoreSize / attackCoreOpacity（与 buttons.attack.coreSize 同义）。
        const sizeSrc = b.coreSize ?? input.attackCoreSize;
        const opacitySrc = b.coreOpacity ?? input.attackCoreOpacity;
        out.buttons[id].coreSize = clamp(Number.isFinite(Number(sizeSrc)) ? Number(sizeSrc) : ATTACK_CORE_DEFAULTS.size, .4, 1);
        out.buttons[id].coreOpacity = clamp(Number.isFinite(Number(opacitySrc)) ? Number(opacitySrc) : ATTACK_CORE_DEFAULTS.opacity, .3, 1);
      }
    }
    // HUD 卡片：旧存档缺 cards 或 hudMinimap 时按设计默认补齐，不覆盖已保存卡片。
    out.cards = normalizeCardEntries(input.cards, base.cards);
    // 摇杆：位置/整体大小/真实疾跑触发范围；旧布局缺字段时安全补默认值。
    // 旧版的 joystick.coreSize / coreOpacity（装饰圆）字段直接忽略；
    // 仅含 sprintThreshold 的旧数据（rev7 之前）保留阈值、其余取默认，不清空存储。
    const jsInput = input.joystick || {};
    const jsBase = base.joystick;
    out.joystick = {
      x: clamp(Number.isFinite(Number(jsInput.x)) ? Number(jsInput.x) : jsBase.x, 0, 1),
      y: clamp(Number.isFinite(Number(jsInput.y)) ? Number(jsInput.y) : jsBase.y, 0, 1),
      scale: clamp(Number.isFinite(Number(jsInput.scale)) ? Number(jsInput.scale) : 1, JOYSTICK_SCALE_MIN, JOYSTICK_SCALE_MAX),
      sprintThreshold: clampSprintThreshold(jsInput.sprintThreshold),
    };
    return out;
  }

  _load() {
    try { const raw = localStorage.getItem(STORAGE_KEY); return raw ? this._normalize(JSON.parse(raw)) : null; }
    catch (_) { return null; }
  }

  _safeCenter(id, x, y, scale, safe, w, h) {
    if (CARDS.includes(id)) return this._safeCardCenter(id, x, y, scale, safe, w, h);
    const size = (SIZE[id] || 54) * scale * this.layout.scale;
    const half = size / 2 + 4;
    return {
      x: clamp(x, safe.left + half, w - safe.right - half),
      y: clamp(y, safe.top + half, h - safe.bottom - half),
    };
  }

  _safeJoystickCenter(x, y, scale, safe, w, h) {
    const half = (joystickBaseSize(w, h) * scale) / 2 + 4;
    return {
      x: clamp(x, safe.left + half, w - safe.right - half),
      y: clamp(y, safe.top + half, h - safe.bottom - half),
    };
  }

  /** 卡片按实际渲染尺寸（getBoundingClientRect）夹紧，文字变长也不会被拖出屏幕。 */
  _safeCardCenter(id, x, y, scale, safe, w, h) {
    const el = this.cards[id];
    const rect = el?.getBoundingClientRect?.();
    const cur = this._appliedCardScale[id] || this.layout?.cards?.[id]?.scale || 1;
    const design = id === MINIMAP && !rect?.width ? minimapDimensions(w, h) : this._design?.[id];
    return clampCardCenter(x, y, scale, safe, w, h, rect, cur, design);
  }

  apply() {
    if (!this.root) return;
    const w = innerWidth, h = innerHeight, safe = readInsets();
    for (const id of ALL_IDS) {
      const el = this.buttons[id], item = this.layout.buttons[id];
      if (!el || !item) continue;
      const p = this._safeCenter(id, item.x * w, item.y * h, item.scale, safe, w, h);
      const base = SIZE[id] || 54;
      el.style.left = `${p.x}px`; el.style.top = `${p.y}px`;
      el.style.setProperty('--touch-button-size', `${base}px`);
      el.style.setProperty('--touch-button-scale', String(item.scale * this.layout.scale));
      el.style.setProperty('--touch-button-opacity', String(item.opacity * this.layout.opacity));
      // 直接写 inline opacity 兑底：部分旧内核/重复 CSS 规则下，--touch-button-opacity
      // 变量可能未生效，导致调透明度滑块无变化。inline opacity 始终生效。
      el.style.opacity = String(Math.max(0.18, item.opacity * this.layout.opacity));
      if (id === SANDBOX_CONTROL) {
        // #testModeBtn 原 CSS 用 left/bottom 锚定；布局系统改用 left/top 中心点定位。
        el.style.bottom = 'auto';
      }
      if (id === 'attack') {
        el.style.setProperty('--attack-core-scale', String(item.coreSize ?? ATTACK_CORE_DEFAULTS.size));
        el.style.setProperty('--attack-core-opacity', String(item.coreOpacity ?? ATTACK_CORE_DEFAULTS.opacity));
      }
      el.style.zIndex = id === 'attack' ? '2' : '1';
    }
    // 摇杆：中心定位 + transform 整体缩放（视觉、摇杆行程、疾跑内圈同比例缩放；
    // TouchControls 经 onJoystickScale 拿到同一倍率做 client→local 坐标换算）。
    const js = this.layout.joystick;
    if (this.joystickEl && js) {
      const p = this._safeJoystickCenter(js.x * w, js.y * h, js.scale, safe, w, h);
      this.joystickEl.style.left = `${p.x}px`;
      this.joystickEl.style.top = `${p.y}px`;
      // 原 CSS 用 left/bottom 锚定左上角；布局系统改为 left/top 中心点定位。
      this.joystickEl.style.bottom = 'auto';
      this.joystickEl.style.transform = `translate(-50%, -50%) scale(${js.scale})`;
    }
    this.onJoystickScale?.(js?.scale ?? 1);
    // HUD 卡片：统一 position:fixed + 中心点定位，默认位置来自构造时量到的设计位置。
    for (const id of CARDS) {
      const el = this.cards[id], item = this.layout.cards?.[id];
      if (!el || !item) continue;
      const scale = clamp(item.scale, CARD_SCALE[0], CARD_SCALE[1]);
      const opacity = clamp(item.opacity, CARD_OPACITY[0], CARD_OPACITY[1]);
      if (id === MINIMAP) {
        // Before measuring the safe clamp, expose the target scale through the live
        // rect. Its authored hidden transform is .96, which otherwise underestimates
        // the actual editable map dimensions on the first apply / scale change.
        el.classList.add('touch-layout-managed');
        el.style.setProperty('--touch-layout-card-scale', String(scale));
        el.style.transform = `translate(-50%, -50%) scale(${scale})`;
        el.style.transformOrigin = 'center';
        this._appliedCardScale[id] = scale;
      }
      const p = this._safeCardCenter(id, item.x * w, item.y * h, scale, safe, w, h);
      el.style.position = 'fixed';
      el.style.left = `${p.x}px`;
      el.style.top = `${p.y}px`;
      el.style.right = 'auto';
      el.style.bottom = 'auto';
      el.style.margin = '0';
      // 卡片脱离 flex/grid 后必须显式给宽度，否则 shrink-to-fit 改变默认观感；
      // 宽度用设计时量到的值，并按当前视口夹紧，旋转/窄屏不溢出。
      const dw = this._design?.[id]?.w;
      if (id === MINIMAP) {
        // 保留 .minimap 的断点宽度（174/142/128px），而非冻结构造时尺寸；
        // class 同时保证 .on 显隐切换不丢失居中 transform。
        el.classList.add('touch-layout-managed');
        el.style.setProperty('--touch-layout-card-scale', String(scale));
        el.style.width = '';
        el.style.maxWidth = '';
        el.style.setProperty('--touch-layout-opacity', String(opacity));
        el.style.opacity = this.editing ? String(opacity) : '';
        el.style.visibility = this.editing ? 'visible' : '';
      } else {
        if (dw) el.style.width = `${Math.min(dw, Math.max(120, w - safe.left - safe.right - 16))}px`;
        el.style.maxWidth = 'calc(100vw - 16px)';
        el.style.opacity = String(opacity);
        if (id === 'hudSandbox') el.style.visibility = this.editing ? 'visible' : '';
      }
      el.style.transform = `translate(-50%, -50%) scale(${scale})`;
      el.style.transformOrigin = 'center';
      el.style.zIndex = '24';
      this._appliedCardScale[id] = scale;
    }
    this.root.classList.toggle('layout-editing', this.editing);
    document.body.classList.toggle('touch-layout-editing', this.editing);
    // 键鼠模式下触控层隐藏，改由独立悬浮按钮退出；触屏模式沿用触控层内入口。
    if (this.kbDoneBtn) {
      const showKbDone = this.editing && !this.touchModeAvailable;
      this.kbDoneBtn.hidden = !showKbDone;
      this.kbDoneBtn.style.display = showKbDone ? '' : 'none';
    }
    const entry = document.getElementById('touchLayoutEntry');
    if (entry) { entry.textContent = this.editing ? '完成编辑' : '编辑'; entry.setAttribute('aria-pressed', String(this.editing)); }
    this._syncEditor();
  }

  setEditing(value = !this.editing) {
    const next = !!value;
    const kbHudOnly = !this.touchModeAvailable; // 键鼠模式：只能编辑常驻 HUD 卡片
    // 触屏模式要受“启用触屏布局调整”总开关约束；键鼠 HUD 卡片编辑不需要该开关。
    if (next && !kbHudOnly && !this.adjustEnabled) {
      if (this.editing) this._stopEditing();
      else { this.editing = false; this.apply(); }
      return;
    }
    // 键鼠模式下进入编辑：强制选中一张 HUD 卡，避免选中不可见的触控按钮/摇杆。
    if (next && kbHudOnly && !CARDS.includes(this.selected)) {
      this.selected = 'hudVitals';
    }
    if (next === this.editing) { this.apply(); return; }
    if (next) this._startEditing();
    else this._stopEditing();
    this.apply();
  }

  _startEditing() {
    this.editing = true;
    this.selected = this.selected || 'attack';
    // 进入前若非 play 态（标题/已暂停/结算，真实 hook 为 mode!=='play'）视为已暂停，
    // 退出时不 resume；只有本次发起暂停才在退出时恢复。
    const alreadyPaused = !!this.pauseHooks?.isPaused?.();
    if (alreadyPaused) {
      this._pausedByEditor = false;
    } else {
      this._pausedByEditor = true;
      // 自动暂停模拟，但不弹全屏暂停面板到 HUD 卡片上方。
      this.pauseHooks?.pause?.({ silent: true });
    }
  }

  _stopEditing() {
    this.editing = false;
    // 只在暂停确由本次调整发起时才恢复；调整前已暂停则保持暂停。
    if (this._pausedByEditor) {
      this._pausedByEditor = false;
      this.pauseHooks?.resume?.();
    }
  }

  save() {
    try {
      // 攻击键内圈参数同时平铺为 attackCoreSize / attackCoreOpacity 别名，便于外部读取。
      const data = {
        ...this.layout,
        attackCoreSize: this.layout.buttons.attack.coreSize,
        attackCoreOpacity: this.layout.buttons.attack.coreOpacity,
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (error) { console.warn('触屏布局无法保存到本地存储', error); }
  }

  restoreDefault() {
    this._cardPosTouched = {};
    this.layout = this.defaultLayout();
    this.save();
    // refreshCardDefaults() 内部会 apply()，顺带触发 onJoystickScale 同步摇杆大小。
    this.refreshCardDefaults();
    this.onSprintThreshold?.(this.layout.joystick.sprintThreshold);
  }

  /**
   * 导入外部布局（beta「导入配置」）：复用 _normalize 做边界钳制与字段补全，
   * 立即应用并持久化；导入的卡片位置视为用户方案，不再跟随设计默认刷新。
   */
  importLayout(raw) {
    // 合并语义：文件里缺失的分区/控件字段保留当前值；部分字段存在时也仅覆盖
    // 对应属性。完整导出文件包含所有项目，因此仍可完整复制到另一台设备。
    const incoming = raw && typeof raw === 'object' ? raw : {};
    const merged = { ...this.layout, ...incoming };
    for (const group of ['buttons', 'cards', 'joystick']) {
      if (!incoming[group] || typeof incoming[group] !== 'object') continue;
      const currentGroup = this.layout[group] || {};
      const nextGroup = { ...currentGroup };
      for (const [id, item] of Object.entries(incoming[group])) {
        nextGroup[id] = item && typeof item === 'object'
          ? { ...(currentGroup[id] || {}), ...item }
          : item;
      }
      merged[group] = nextGroup;
    }
    this.layout = this._normalize(merged);
    this._cardPosTouched = {};
    for (const id of CARDS) {
      if (merged.cards?.[id] && Number.isFinite(Number(merged.cards[id].x))) this._cardPosTouched[id] = true;
    }
    this.apply();
    this.save();
    this.onSprintThreshold?.(this.layout.joystick.sprintThreshold);
    this.onJoystickScale?.(this.layout.joystick.scale);
  }

  /** 当前页面上真实存在的 HUD 卡（stable/dev 没有视角状态卡，不进入下拉）。 */
  availableCards() {
    return CARDS.filter((id) => !!this.cards?.[id]);
  }

  /** 当前选中项的布局记录（动作按钮 / 沙盒入口 / HUD 卡）。摇杆走独立分支，返回 null。 */
  _entry(id) {
    if (id === JOYSTICK) return null;
    return this.layout.buttons[id] || this.layout.cards?.[id] || null;
  }

  setSelected(id) {
    if (SELECTABLE_IDS.includes(id) || CARDS.includes(id)) { this.selected = id; this._syncEditor(); }
  }

  /**
   * 数字输入设定 HUD 卡位置（百分比 0-100，内部仍存归一化 0..1）。
   * 走与拖动一致的 _safeCardCenter 边界/安全区夹紧；非法输入的轴保持原值。
   * 返回是否实际应用（非卡片 id / 卡片缺失时返回 false）。
   */
  setCardPositionPercent(id, xPercent, yPercent) {
    if (!CARDS.includes(id)) return false;
    const item = this.layout.cards?.[id];
    if (!item) return false;
    const nx = percentToNormalized(xPercent);
    const ny = percentToNormalized(yPercent);
    if (nx == null && ny == null) return false;
    const w = Math.max(320, innerWidth || 390), h = Math.max(320, innerHeight || 844);
    const safe = readInsets();
    const scale = clamp(item.scale, CARD_SCALE[0], CARD_SCALE[1]);
    const p = this._safeCardCenter(id, (nx ?? item.x) * w, (ny ?? item.y) * h, scale, safe, w, h);
    item.x = clamp(p.x / w, 0, 1);
    item.y = clamp(p.y / h, 0, 1);
    this._cardPosTouched[id] = true;
    this.apply();
    return true;
  }

  settingsMarkup() {
    const options = (ids) => ids.map((id) => `<option value="${id}" ${id === this.selected ? 'selected' : ''}>${LABELS[id]}</option>`).join('');
    return `<section class="touch-layout-settings" aria-label="触屏技能盘设置">
      <h4>触屏技能盘</h4><p>进入编辑后可拖动按钮、移动摇杆、HUD 卡片、视角状态卡和站立观察小地图；小地图会在编辑时临时显示。选择单个控件后可单独调尺寸和透明度。「沙盒控制」是唯一可调整的沙盒入口（即打开测试/沙盒面板的那个按钮），不会新增其他浮动按钮。「整体大小 / 整体透明度」只作用于动作按钮；摇杆、HUD 卡片和小地图请选中后用对应单项控制。摇杆内圈决定推多远进入疾跑，档位环会同步显示真实位置。</p>
      <div class="layout-setting-row"><label for="layoutGlobalScale">整体大小</label><input id="layoutGlobalScale" type="range" min="0.75" max="1.3" step="0.05" value="${this.layout.scale}"><output data-layout-value="globalScale"></output></div>
      <div class="layout-setting-row"><label for="layoutGlobalOpacity">整体透明度</label><input id="layoutGlobalOpacity" type="range" min="0.35" max="1" step="0.05" value="${this.layout.opacity}"><output data-layout-value="globalOpacity"></output></div>
      <div class="layout-setting-row"><label for="layoutSelected">单个控件</label><select id="layoutSelected"><optgroup label="动作按钮">${options(ACTIONS)}</optgroup><optgroup label="沙盒控制">${options([SANDBOX_CONTROL])}</optgroup><optgroup label="移动摇杆">${options([JOYSTICK])}</optgroup><optgroup label="HUD 卡片">${options(this.availableCards())}</optgroup></select></div>
      <div class="layout-setting-row button-row"><label for="layoutButtonScale">单项大小</label><input id="layoutButtonScale" type="range" min="0.7" max="1.35" step="0.05"><output data-layout-value="buttonScale"></output></div>
      <div class="layout-setting-row button-row"><label for="layoutButtonOpacity">单项透明度</label><input id="layoutButtonOpacity" type="range" min="0.3" max="1" step="0.05"><output data-layout-value="buttonOpacity"></output></div>
      <div class="layout-setting-row card-pos-row"><label>卡片位置（屏幕宽/高百分比）</label><span class="card-pos-inputs"><label>X <input id="layoutCardX" type="number" min="0" max="100" step="0.5" inputmode="decimal">%</label><label>Y <input id="layoutCardY" type="number" min="0" max="100" step="0.5" inputmode="decimal">%</label></span></div>
      <div class="layout-setting-row joystick-row"><label for="layoutJoystickScale">摇杆整体大小 (${Math.round(JOYSTICK_SCALE_MIN * 100)}-${Math.round(JOYSTICK_SCALE_MAX * 100)}%)</label><input id="layoutJoystickScale" type="range" min="${JOYSTICK_SCALE_MIN}" max="${JOYSTICK_SCALE_MAX}" step="0.05" value="${this.layout.joystick.scale}"><output data-layout-value="joystickScale"></output></div>
      <div class="layout-setting-row attack-core-row"><label for="layoutAttackCoreSize">攻击键内圈大小 (40-100%)</label><input id="layoutAttackCoreSize" type="range" min="0.4" max="1" step="0.01"><output data-layout-value="attackCoreSize"></output></div>
      <div class="layout-setting-row attack-core-row"><label for="layoutAttackCoreOpacity">攻击键内圈透明度 (30-100%)</label><input id="layoutAttackCoreOpacity" type="range" min="0.3" max="1" step="0.01"><output data-layout-value="attackCoreOpacity"></output></div>
      <div class="layout-setting-row"><label for="layoutSprintThreshold">摇杆内圈·疾跑触发范围 (55-95%)</label><input id="layoutSprintThreshold" type="range" min="0.55" max="0.95" step="0.01" value="${this.layout.joystick.sprintThreshold}"><output data-layout-value="sprintThreshold"></output></div>
      <div class="layout-actions" data-touch-adjust="actions"><button type="button" class="ghost-btn" data-layout-edit>进入拖动编辑</button><button type="button" class="ghost-btn" data-layout-save>保存方案 / 设为默认</button><button type="button" class="ghost-btn" data-layout-reset>恢复设计默认</button></div>
      <p class="layout-save-status" aria-live="polite">保存后当前布局成为刷新/重进后的默认方案。疾跑触发范围决定摇杆推多远开始疾跑，档位环会同步显示真实位置。</p>
    </section>`;
  }

  /**
   * 键鼠模式的 HUD 布局设置：只能调整常驻信息卡（状态/关卡/目标/沙盒状态/小地图），
   * 不提供虚拟摇杆与触屏动作按钮（键鼠模式下它们本来就不显示）。
   * 元素 id 与触屏版相同，复用 bindSettings 的事件绑定与 _syncEditor 刷新。
   */
  keyboardSettingsMarkup() {
    const cards = this.availableCards();
    const selected = cards.includes(this.selected) ? this.selected : 'hudVitals';
    const options = cards.map((id) => `<option value="${id}" ${id === selected ? 'selected' : ''}>${LABELS[id]}</option>`).join('');
    return `<section class="touch-layout-settings kb-hud-layout" aria-label="HUD 信息卡布局">
      <h4>HUD 信息卡布局（键鼠）</h4><p>进入拖动编辑会自动暂停游戏，可拖动顶部状态卡、关卡信息卡、本关目标卡、沙盒状态卡、视角状态卡与小地图改变位置；小地图仅在编辑期间强制显示，退出后恢复站立观察显隐。在下方选中单张卡片后还能调大小与透明度。键鼠模式不显示虚拟摇杆和触屏动作按钮，因此它们不参与调整。</p>
      <div class="layout-setting-row"><label for="layoutSelected">单个卡片</label><select id="layoutSelected"><optgroup label="HUD 卡片">${options}</optgroup></select></div>
      <div class="layout-setting-row button-row"><label for="layoutButtonScale">卡片大小</label><input id="layoutButtonScale" type="range" min="0.75" max="1.25" step="0.05"><output data-layout-value="buttonScale"></output></div>
      <div class="layout-setting-row button-row"><label for="layoutButtonOpacity">卡片透明度</label><input id="layoutButtonOpacity" type="range" min="0.35" max="1" step="0.05"><output data-layout-value="buttonOpacity"></output></div>
      <div class="layout-setting-row card-pos-row"><label>卡片位置（屏幕宽/高百分比）</label><span class="card-pos-inputs"><label>X <input id="layoutCardX" type="number" min="0" max="100" step="0.5" inputmode="decimal">%</label><label>Y <input id="layoutCardY" type="number" min="0" max="100" step="0.5" inputmode="decimal">%</label></span></div>
      <div class="layout-actions"><button type="button" class="ghost-btn" data-layout-edit>进入拖动编辑</button><button type="button" class="ghost-btn" data-layout-save>保存方案 / 设为默认</button><button type="button" class="ghost-btn" data-layout-reset>恢复设计默认</button></div>
      <p class="layout-save-status" aria-live="polite">进入编辑后拖动卡片调整位置，完成后点画面上方“完成编辑”按钮（也可按暂停键）。保存后刷新/重进仍保留。</p>
    </section>`;
  }

  bindSettings(container) {
    const byId = (id) => container.querySelector(`#${id}`);
    const globalScale = byId('layoutGlobalScale'), globalOpacity = byId('layoutGlobalOpacity');
    const btnScale = byId('layoutButtonScale'), btnOpacity = byId('layoutButtonOpacity');
    const selected = byId('layoutSelected');
    globalScale?.addEventListener('input', () => { this.layout.scale = Number(globalScale.value); this.apply(); });
    globalOpacity?.addEventListener('input', () => { this.layout.opacity = Number(globalOpacity.value); this.apply(); });
    selected?.addEventListener('change', () => this.setSelected(selected.value));
    btnScale?.addEventListener('input', () => {
      const item = this._entry(this.selected);
      if (!item) return;
      const isCard = CARDS.includes(this.selected);
      item.scale = clamp(Number(btnScale.value), isCard ? CARD_SCALE[0] : 0.65, isCard ? CARD_SCALE[1] : 1.5);
      this.apply();
    });
    btnOpacity?.addEventListener('input', () => {
      const item = this._entry(this.selected);
      if (!item) return;
      const isCard = CARDS.includes(this.selected);
      item.opacity = clamp(Number(btnOpacity.value), isCard ? CARD_OPACITY[0] : 0.3, 1);
      this.apply();
    });
    // HUD 卡 X/Y 数字输入：轻防抖即时移动，走与拖动相同的安全区夹紧；非法输入保持原值。
    const cardX = byId('layoutCardX'), cardY = byId('layoutCardY');
    let cardPosTimer = 0;
    const applyCardPosInput = () => {
      if (!CARDS.includes(this.selected)) return;
      this.setCardPositionPercent(this.selected, cardX?.value, cardY?.value);
    };
    const onCardPosInput = () => {
      clearTimeout(cardPosTimer);
      cardPosTimer = setTimeout(applyCardPosInput, 120);
    };
    cardX?.addEventListener('input', onCardPosInput);
    cardY?.addEventListener('input', onCardPosInput);
    cardX?.addEventListener('change', applyCardPosInput);
    cardY?.addEventListener('change', applyCardPosInput);
    // 摇杆整体大小：滑块即时缩放（apply 内经 onJoystickScale 同步 TouchControls），并立即持久化。
    const jsScale = byId('layoutJoystickScale');
    jsScale?.addEventListener('input', () => {
      this.layout.joystick.scale = clamp(Number(jsScale.value) || 1, JOYSTICK_SCALE_MIN, JOYSTICK_SCALE_MAX);
      this.apply();
      this.save();
    });
    // 攻击键内圈：拖动即时写 CSS 变量（apply 内），并立即持久化到既有布局字典。
    const coreSize = byId('layoutAttackCoreSize'), coreOpacity = byId('layoutAttackCoreOpacity');
    coreSize?.addEventListener('input', () => { this.layout.buttons.attack.coreSize = Number(coreSize.value); this.apply(); this.save(); });
    coreOpacity?.addEventListener('input', () => { this.layout.buttons.attack.coreOpacity = Number(coreOpacity.value); this.apply(); this.save(); });
    // 疾跑触发范围：真实阈值，即时生效（onSprintThreshold 由 main.js 接到 TouchControls）并持久化。
    const sprint = byId('layoutSprintThreshold');
    sprint?.addEventListener('input', () => {
      const v = clampSprintThreshold(Number(sprint.value));
      this.layout.joystick.sprintThreshold = v;
      this.onSprintThreshold?.(v);
      this._syncEditor();
      this.save();
    });
    container.querySelector('[data-layout-edit]')?.addEventListener('click', (e) => {
      this.setEditing(!this.editing); e.currentTarget.textContent = this.editing ? '完成拖动编辑' : '进入拖动编辑';
      if (this.editing) {
        this.onEditingStart?.();
        const sheet = document.getElementById('setSheet');
        if (sheet && !sheet.hidden) { sheet.hidden = true; document.body.classList.remove('settings-open'); }
      }
    });
    container.querySelector('[data-layout-save]')?.addEventListener('click', () => {
      this.save(); const status = container.querySelector('.layout-save-status'); if (status) status.textContent = '已保存：当前布局已设为默认方案。';
    });
    container.querySelector('[data-layout-reset]')?.addEventListener('click', () => {
      this.restoreDefault(); if (globalScale) globalScale.value = this.layout.scale; if (globalOpacity) globalOpacity.value = this.layout.opacity;
      if (sprint) sprint.value = this.layout.joystick.sprintThreshold;
      if (jsScale) jsScale.value = this.layout.joystick.scale;
      const status = container.querySelector('.layout-save-status'); if (status) status.textContent = '已恢复并保存设计默认排布。';
    });
    this._syncEditor();
  }

  _syncEditor() {
    const layout = document.getElementById('setBody');
    if (!layout) return;
    const isJoystick = this.selected === JOYSTICK;
    const item = isJoystick ? null : this._entry(this.selected);
    const isAttack = this.selected === 'attack';
    const corePairs = isAttack
      ? [['attackCoreSize', item?.coreSize ?? ATTACK_CORE_DEFAULTS.size], ['attackCoreOpacity', item?.coreOpacity ?? ATTACK_CORE_DEFAULTS.opacity]]
      : [];
    for (const [key, value] of [
      ['globalScale', this.layout.scale],
      ['globalOpacity', this.layout.opacity],
      ['buttonScale', item?.scale],
      ['buttonOpacity', item?.opacity],
      ['sprintThreshold', this.layout.joystick?.sprintThreshold ?? SPRINT_STICK_THRESHOLD],
      ['joystickScale', this.layout.joystick?.scale ?? 1],
      ...corePairs,
    ]) {
      const output = layout.querySelector(`[data-layout-value="${key}"]`);
      if (output) output.value = `${Math.round((value || 0) * 100)}%`;
    }
    const scale = layout.querySelector('#layoutButtonScale'), opacity = layout.querySelector('#layoutButtonOpacity');
    if (scale && item && Number(scale.value) !== item.scale) scale.value = item.scale;
    if (opacity && item && Number(opacity.value) !== item.opacity) opacity.value = item.opacity;
    // 单键两行只在选中按钮/卡片时出现；摇杆大小行只在选中摇杆时出现。
    layout.querySelectorAll('.button-row').forEach((row) => { row.style.display = isJoystick ? 'none' : ''; });
    layout.querySelectorAll('.joystick-row').forEach((row) => { row.style.display = isJoystick ? '' : 'none'; });
    const jsScale = layout.querySelector('#layoutJoystickScale');
    const jsScaleValue = this.layout.joystick?.scale ?? 1;
    if (jsScale && Number(jsScale.value) !== jsScaleValue) jsScale.value = jsScaleValue;
    // 攻击键内圈两行只在选中攻击键时出现。
    const coreSize = layout.querySelector('#layoutAttackCoreSize'), coreOpacity = layout.querySelector('#layoutAttackCoreOpacity');
    layout.querySelectorAll('.attack-core-row').forEach((row) => { row.style.display = isAttack ? '' : 'none'; });
    if (isAttack) {
      if (coreSize && Number(coreSize.value) !== item.coreSize) coreSize.value = item.coreSize;
      if (coreOpacity && Number(coreOpacity.value) !== item.coreOpacity) coreOpacity.value = item.coreOpacity;
    }
    // HUD 卡 X/Y 数字输入：仅选中卡片时显示；拖动/恢复默认后由 apply→_syncEditor 同步数值。
    const isCard = CARDS.includes(this.selected);
    const cardItem = isCard ? item : null;
    layout.querySelectorAll('.card-pos-row').forEach((row) => { row.style.display = isCard ? '' : 'none'; });
    const cardX = layout.querySelector('#layoutCardX'), cardY = layout.querySelector('#layoutCardY');
    if (cardItem) {
      const xPct = String(normalizedToPercent(cardItem.x)), yPct = String(normalizedToPercent(cardItem.y));
      if (cardX && cardX.value !== xPct && document.activeElement !== cardX) cardX.value = xPct;
      if (cardY && cardY.value !== yPct && document.activeElement !== cardY) cardY.value = yPct;
    }
    // 疾跑触发范围滑块始终显示（即便选中卡片也可调摇杆内圈）。
    const sprint = layout.querySelector('#layoutSprintThreshold');
    const sprintValue = this.layout.joystick?.sprintThreshold ?? SPRINT_STICK_THRESHOLD;
    if (sprint && Number(sprint.value) !== sprintValue) sprint.value = sprintValue;
    for (const [id, el] of [...Object.entries(this.buttons), ...Object.entries(this.cards)]) {
      el?.classList?.toggle('layout-selected', this.editing && id === this.selected);
    }
    this.joystickEl?.classList?.toggle('layout-selected', this.editing && this.selected === JOYSTICK);
  }

  _bindEditor() {
    const entry = document.getElementById('touchLayoutEntry');
    entry?.addEventListener('click', () => this.setEditing());
    for (const [id, el] of [...Object.entries(this.buttons), ...Object.entries(this.cards)]) {
      if (el) this._bindButton(id, el);
    }
    if (this.joystickEl) this._bindJoystick();
    window.addEventListener('resize', () => this.refreshCardDefaults());
    window.addEventListener('orientationchange', () => setTimeout(() => this.refreshCardDefaults(), 80));
  }

  // 单个按钮 / HUD 卡的编辑态选中/拖动绑定（幂等）。卡片拖动路由到 _safeCardCenter。
  _bindButton(id, el) {
    if (!el || el.__touchLayoutBound) return;
    el.__touchLayoutBound = true;
    el.addEventListener('click', (event) => { if (this.editing) { event.preventDefault(); event.stopImmediatePropagation(); this.setSelected(id); } }, true);
    let drag = null;
    const start = (x, y, event, pointerId = null) => {
      if (!this.editing) return false;
      event.preventDefault(); event.stopImmediatePropagation();
      this.setSelected(id);
      const rect = el.getBoundingClientRect();
      drag = { pointerId, dx: x - (rect.left + rect.width / 2), dy: y - (rect.top + rect.height / 2) };
      el.classList.add('layout-dragging');
      if (pointerId != null) { try { el.setPointerCapture(pointerId); } catch (_) {} }
      return true;
    };
    const move = (x, y) => {
      if (!drag) return;
      const w = innerWidth, h = innerHeight, safe = readInsets();
      const item = this._entry(id);
      if (!item) return;
      if (CARDS.includes(id)) this._cardPosTouched[id] = true;
      const pos = this._safeCenter(id, x - drag.dx, y - drag.dy, item.scale, safe, w, h);
      item.x = pos.x / w; item.y = pos.y / h; this.apply();
    };
    const end = () => { if (drag) { drag = null; el.classList.remove('layout-dragging'); } };
    el.addEventListener('pointerdown', (event) => { if (event.pointerType !== 'touch' && (event.pointerType === 'mouse' || this.editing)) start(event.clientX, event.clientY, event, event.pointerId); }, true);
    el.addEventListener('pointermove', (event) => { if (drag?.pointerId === event.pointerId) { event.preventDefault(); event.stopImmediatePropagation(); move(event.clientX, event.clientY); } }, true);
    for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) el.addEventListener(name, (event) => { if (drag?.pointerId === event.pointerId) end(); }, true);
    el.addEventListener('touchstart', (event) => {
      if (!this.editing || !event.changedTouches.length) return;
      const t = event.changedTouches[0]; start(t.clientX, t.clientY, event, t.identifier);
    }, { capture: true, passive: false });
    el.addEventListener('touchmove', (event) => {
      if (!drag || !this.editing) return;
      const t = [...event.changedTouches].find((x) => x.identifier === drag.pointerId);
      if (t) { event.preventDefault(); event.stopImmediatePropagation(); move(t.clientX, t.clientY); }
    }, { capture: true, passive: false });
    for (const name of ['touchend', 'touchcancel']) el.addEventListener(name, (event) => {
      if (drag && [...event.changedTouches].some((x) => x.identifier === drag.pointerId)) end();
    }, true);
  }

  // 摇杆本体的编辑态选中/拖动绑定（幂等）。非编辑态完全放行给 TouchControls 的移动输入。
  _bindJoystick() {
    const el = this.joystickEl;
    if (!el || el.__touchLayoutBound) return;
    el.__touchLayoutBound = true;
    el.addEventListener('click', (event) => { if (this.editing) { event.preventDefault(); event.stopImmediatePropagation(); this.setSelected(JOYSTICK); } }, true);
    let drag = null;
    const start = (x, y, event, pointerId = null) => {
      if (!this.editing) return false;
      event.preventDefault(); event.stopImmediatePropagation();
      this.setSelected(JOYSTICK);
      const rect = el.getBoundingClientRect();
      drag = { pointerId, dx: x - (rect.left + rect.width / 2), dy: y - (rect.top + rect.height / 2) };
      el.classList.add('layout-dragging');
      if (pointerId != null) { try { el.setPointerCapture(pointerId); } catch (_) {} }
      return true;
    };
    const move = (x, y) => {
      if (!drag) return;
      const w = innerWidth, h = innerHeight, safe = readInsets();
      const pos = this._safeJoystickCenter(x - drag.dx, y - drag.dy, this.layout.joystick.scale, safe, w, h);
      this.layout.joystick.x = pos.x / w; this.layout.joystick.y = pos.y / h; this.apply();
    };
    const end = () => { if (drag) { drag = null; el.classList.remove('layout-dragging'); } };
    el.addEventListener('pointerdown', (event) => { if (event.pointerType !== 'touch' && (event.pointerType === 'mouse' || this.editing)) start(event.clientX, event.clientY, event, event.pointerId); }, true);
    el.addEventListener('pointermove', (event) => { if (drag?.pointerId === event.pointerId) { event.preventDefault(); event.stopImmediatePropagation(); move(event.clientX, event.clientY); } }, true);
    for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) el.addEventListener(name, (event) => { if (drag?.pointerId === event.pointerId) end(); }, true);
    el.addEventListener('touchstart', (event) => {
      if (!this.editing || !event.changedTouches.length) return;
      const t = event.changedTouches[0]; start(t.clientX, t.clientY, event, t.identifier);
    }, { capture: true, passive: false });
    el.addEventListener('touchmove', (event) => {
      if (!drag || !this.editing) return;
      const t = [...event.changedTouches].find((x) => x.identifier === drag.pointerId);
      if (t) { event.preventDefault(); event.stopImmediatePropagation(); move(t.clientX, t.clientY); }
    }, { capture: true, passive: false });
    for (const name of ['touchend', 'touchcancel']) el.addEventListener(name, (event) => {
      if (drag && [...event.changedTouches].some((x) => x.identifier === drag.pointerId)) end();
    }, true);
  }
}
