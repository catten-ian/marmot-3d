/**
 * 键位方案系统。
 *
 * 提供三套方案：
 *   compatible 兼容方案 —— 保持 v1.0 原样（WASD + J/K/E），零迁移成本
 *   optimized  优化方案 —— 重新设计，考虑键盘物理位置与主流 FPS 惯例
 *   custom     自定义 —— 玩家自行绑定，localStorage 持久化
 *
 * 优化方案的设计依据（不是随意排列）：
 *   1. 移动键不动：WASD 是肌肉记忆，改它反而增加负担
 *   2. 攻击交给鼠标左键：手不用离开鼠标，是 FPS 最自然的攻击键
 *   3. 跳跃给鼠标右键 / 空格：空格在 WASD 正下方，右手食指自然下垂即可按；
 *      右键由中指或无名指负责，与左键形成"左右手分工"
 *   4. 技能簇放 Q-E-R 一线：Q/E/R 呈一条水平线，左手食指到中指可连续扫过，
 *      比原来的 J/K/E（J 与 K 之间隔了半个键盘）更省移动
 *   5. 交互放 F：位于 WASD 右下方，是"拾取/互动"类动作的社区惯例
 *   6. 疾行放 Shift：与主流游戏一致
 *   7. 暂停/重试/重开放到远离战斗区的功能键，避免误触
 */

import { IS_BETA, IS_DEV } from './version.js';
import { interactionSemantics } from './interaction-semantics.mjs';

export const CONTROL_MODE_STORAGE_KEY = 'marmot3d.control-mode';
export const CONTROL_MODE_OPTIONS = [
  { id: 'driving', name: '转向驾驶', desc: '左右转向，前后移动；转向与油门可同时输入。' },
  { id: 'classic', name: '经典横移', desc: 'WASD 横移，保留旧式平面移动。' },
];

export function normalizeControlMode(value, fallback = 'classic') {
  return value === 'driving' || value === 'classic' ? value : fallback;
}

export function resolveDefaultControlMode(version, storedValue = null) {
  return normalizeControlMode(storedValue, version === 'beta' ? 'driving' : 'classic');
}

// 动作定义（id 即为配置键）
export const ACTIONS = [
  { id: 'forward',    label: '向前',   type: 'move' },
  { id: 'back',       label: '向后',   type: 'move' },
  { id: 'left',       label: '向左',   type: 'move' },
  { id: 'right',      label: '向右',   type: 'move' },
  { id: 'turnLeft',   label: '视角左转', type: 'move' },
  { id: 'turnRight',  label: '视角右转', type: 'move' },
  { id: 'attack',     label: '攻击',   type: 'combat' },
  { id: 'parry',      label: '迎击',   type: 'combat' },
  { id: 'dodge',      label: '翻滚',   type: 'combat' },
  { id: 'jump',       label: '跳跃',   type: 'combat' },
  { id: 'burst',      label: '应急爆发', type: 'combat' },
  { id: 'ultimate',   label: '协同大招', type: 'combat' },
  { id: 'interact',   label: interactionSemantics(IS_BETA).actionLabel, type: 'combat' },
  { id: 'sprint',     label: '疾行',   type: 'combat' },
  { id: 'pause',      label: '暂停',   type: 'system' },
  { id: 'cameraView', label: '切换视角', type: 'system' },
  { id: 'retry',      label: '重试本关', type: 'system' },
  { id: 'restart',    label: '从第一关重开', type: 'system' },
  { id: 'fullscreen', label: '全屏',   type: 'system' },
];

/** 兼容方案：与 v1.0 完全一致 */
const COMPAT = {
  forward: 'KeyW', back: 'KeyS', left: 'KeyA', right: 'KeyD',
  attack: 'Space', parry: 'KeyB', dodge: 'KeyC', jump: 'KeyF', burst: 'KeyJ', ultimate: 'KeyK',
  interact: 'KeyE', sprint: 'ShiftLeft',
  pause: 'KeyP', retry: 'KeyT', restart: 'KeyR', fullscreen: 'F11',
  cameraView: 'KeyV',
};

/**
 * 优化方案。
 * 注意 attack 映射为 [] —— 攻击由鼠标左键负责，不占键盘位置。
 * 这样 E 从"交互"让出后，F 附近形成 F/G 的操作簇。
 */
const OPTIMIZED = {
  // 仅 dev 版把 A/D 用作视角转向；正式版维持 WASD 横移。
  forward: 'KeyW', back: 'KeyS',
  left: IS_DEV ? null : 'KeyA', right: IS_DEV ? null : 'KeyD',
  turnLeft: IS_DEV ? 'KeyA' : null,
  turnRight: IS_DEV ? 'KeyD' : null,
  // 攻击：鼠标左键（KeyboardEvent 里为空数组）；迎击保留 B，鼠标中键为额外快捷键。
  attack: [],
  parry: 'KeyB',
  // 跳跃：右键 或 空格（空格在 WASD 正下方，右手下垂可及）
  // 注意：不能再绑 KeyF —— F 已分配给 interact，双键同绑会导致一次按键
  // 同时触发跳跃与交互（跳跃的键盘备选靠空格，右键由鼠标处理）。
  jump: ['Space'],
  // 技能簇：Q-E-R 一线，左手指可连续扫过
  burst: 'KeyQ',
  ultimate: 'KeyR',
  // 交互：F（WASD 右下方，社区惯例）
  interact: 'KeyF',
  // 翻滚：G（技能簇 Q-E-R-G 一线）
  dodge: 'KeyG',
  // 疾行：Shift（通用）
  sprint: 'ShiftLeft',
  // 系统键：远离战斗区，防误触
  pause: 'Escape',
  retry: 'KeyT',
  restart: 'KeyY',
  fullscreen: 'F11',
  // 第一/第三人称切换：默认 V，可在自定义方案中改键
  cameraView: 'KeyV',
};

/** 为移动方向补充方向键作为备选（无论哪个方案都保留，照顾习惯用方向键的玩家） */
const MOVE_ALTS = {
  forward: 'ArrowUp', back: 'ArrowDown',
  left: 'ArrowLeft', right: 'ArrowRight',
};

/** Version-aware key-map policy. Dev's optimized turning contract stays untouched. */
export function resolveControlMaps({ version = 'stable', scheme = 'compatible', controlMode = 'classic', bindings = {} } = {}) {
  const devTurning = version === 'dev' && scheme === 'optimized';
  const driving = version === 'beta' && normalizeControlMode(controlMode) === 'driving';
  const moveMap = {
    forward: bindings.forward ?? null, forwardAlt: MOVE_ALTS.forward,
    back: bindings.back ?? null, backAlt: MOVE_ALTS.back,
    left: bindings.left ?? null, leftAlt: MOVE_ALTS.left,
    right: bindings.right ?? null, rightAlt: MOVE_ALTS.right,
  };
  if (devTurning) {
    return {
      profile: 'dev-optimized-turning', turningEnabled: true,
      moveMap,
      turnMap: { left: bindings.turnLeft ?? null, right: bindings.turnRight ?? null },
    };
  }
  if (driving) {
    moveMap.left = null; moveMap.leftAlt = null;
    moveMap.right = null; moveMap.rightAlt = null;
    // beta optimized 的历史表把 A/D 留在 dev 专用 turnLeft/turnRight 字段；
    // 驾驶模式仍必须给出可用的 A/D，且自定义 left/right 优先。
    const left = bindings.left ?? bindings.turnLeft ?? 'KeyA';
    const right = bindings.right ?? bindings.turnRight ?? 'KeyD';
    return {
      profile: 'driving', turningEnabled: true, moveMap,
      turnMap: { left, right, leftAlt: MOVE_ALTS.left, rightAlt: MOVE_ALTS.right },
    };
  }
  return {
    profile: 'classic', turningEnabled: false, moveMap,
    turnMap: version === 'beta' ? null : { left: null, right: null },
  };
}

export class Keybinds {
  constructor() {
    this.scheme = 'compatible';
    this.controlMode = resolveDefaultControlMode(IS_DEV ? 'dev' : IS_BETA ? 'beta' : 'stable');
    this.custom = { ...COMPAT };
    this.listeners = new Set();
    this._load();
  }

  _load() {
    try {
      this.controlMode = normalizeControlMode(
        localStorage.getItem(CONTROL_MODE_STORAGE_KEY), this.controlMode,
      );
    } catch (e) { /* 无存储时使用版本默认 */ }
    try {
      const raw = localStorage.getItem('marmot3d.keybinds');
      if (!raw) return;
      const data = JSON.parse(raw);
      if (data.scheme) this.scheme = data.scheme;
      if (data.custom) this.custom = { ...COMPAT, ...data.custom };
    } catch (e) {
      // localStorage 不可用（隐私模式等）时静默降级为默认方案
    }
  }

  _save() {
    try {
      localStorage.setItem('marmot3d.keybinds', JSON.stringify({
        scheme: this.scheme, custom: this.custom,
      }));
    } catch (e) { /* 忽略写入失败 */ }
  }

  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  _emit() { for (const fn of this.listeners) fn(this); }

  setScheme(name) {
    if (!['compatible', 'optimized', 'custom'].includes(name)) return;
    this.scheme = name;
    this._save();
    this._emit();
  }

  setControlMode(name) {
    const next = normalizeControlMode(name, null);
    if (!next) return;
    this.controlMode = next;
    try { localStorage.setItem(CONTROL_MODE_STORAGE_KEY, next); } catch (e) { /* 忽略写入失败 */ }
    this._emit();
  }

  /** 自定义时设置单个动作的按键 */
  setKey(actionId, code) {
    this.custom[actionId] = code;
    this.scheme = 'custom'; // 改键自动切到自定义，符合直觉
    this._save();
    this._emit();
  }

  resetCustom() {
    this.custom = { ...COMPAT };
    this.scheme = 'custom';
    this._save();
    this._emit();
  }

  /**
   * 应用导入的键位配置（beta「导入配置」）。输入须先经 config-transfer 的
   * sanitizeConfig 白名单/格式清洗；这里再做一层防御，逐字段校验后才写入，
   * 并统一 _save + _emit，让键位提示/技能条/设置面板一次性刷新。
   */
  applyImported({ scheme, custom, controlMode } = {}) {
    if (custom && typeof custom === 'object') {
      const ids = new Set(ACTIONS.map((a) => a.id));
      const merged = { ...COMPAT, ...this.custom };
      for (const [actionId, value] of Object.entries(custom)) {
        if (!ids.has(actionId)) continue;
        if (value == null || typeof value === 'string') merged[actionId] = value;
        else if (Array.isArray(value)) merged[actionId] = value.filter((c) => typeof c === 'string');
      }
      this.custom = merged;
    }
    if (['compatible', 'optimized', 'custom'].includes(scheme)) this.scheme = scheme;
    else if (custom) this.scheme = 'custom';
    const mode = normalizeControlMode(controlMode, null);
    if (mode) {
      this.controlMode = mode;
      try { localStorage.setItem(CONTROL_MODE_STORAGE_KEY, mode); } catch (e) { /* 忽略写入失败 */ }
    }
    this._save();
    this._emit();
  }

  /** 当前生效的绑定表 */
  get map() {
    return this.scheme === 'custom' ? this.custom
      : this.scheme === 'optimized' ? OPTIMIZED
      : COMPAT;
  }

  /** 取某动作的主键（返回单个 code） */
  key(actionId) {
    const v = this.map[actionId];
    return Array.isArray(v) ? v[0] : v;
  }

  /** 取某动作的所有绑定键 */
  keys(actionId) {
    const v = this.map[actionId];
    if (v == null) return [];
    return Array.isArray(v) ? v : [v];
  }

  /** 当前输入行为；beta 设置可选择驾驶/经典，dev 保持既有方案约定。 */
  get controlMaps() {
    const version = IS_DEV ? 'dev' : IS_BETA ? 'beta' : 'stable';
    return resolveControlMaps({ version, scheme: this.scheme, controlMode: this.controlMode, bindings: this.map });
  }

  get controlProfile() { return this.controlMaps.profile; }
  get turningEnabled() { return this.controlMaps.turningEnabled; }

  /** 移动与转向映射共享一个版本/操控模式策略，避免键位卡片与实际输入分叉。 */
  get moveMap() { return this.controlMaps.moveMap; }
  get turnMap() { return this.controlMaps.turnMap; }

  /** 判断某次 keydown code 是否触发指定动作（不含 repeat） */
  isAction(code, actionId) {
    return this.keys(actionId).includes(code);
  }

  /** 生成用于展示的按键名称 */
  static pretty(code) {
    if (!code) return '—';
    if (code.startsWith('Key')) return code.slice(3);
    if (code.startsWith('Digit')) return code.slice(5);
    if (code.startsWith('Arrow')) {
      return { ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→' }[code] || code;
    }
    const map = {
      Space: '空格', ShiftLeft: '左Shift', ShiftRight: '右Shift',
      ControlLeft: '左Ctrl', ControlRight: '右Ctrl',
      Escape: 'Esc', Enter: 'Enter', Tab: 'Tab', Backquote: '`',
      Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']',
      Backslash: '\\', Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/',
    };
    return map[code] || code;
  }

  /** 当前方案的完整展示数据，供设置界面使用 */
  describe() {
    const showTurning = IS_DEV && this.scheme === 'optimized';
    const actions = showTurning
      ? ACTIONS
      : ACTIONS.filter((a) => a.id !== 'turnLeft' && a.id !== 'turnRight');
    return actions.map((a) => {
      const keys = this.keys(a.id);
      // 移动动作额外展示方向键备选
      const alt = a.type === 'move' && MOVE_ALTS[a.id] ? MOVE_ALTS[a.id] : null;
      const label = this.controlProfile === 'driving'
        ? ({ left: '左转向', right: '右转向' }[a.id] || a.label)
        : a.label;
      return {
        ...a, label,
        keys: keys.map(Keybinds.pretty),
        alt: alt ? Keybinds.pretty(alt) : null,
        empty: keys.length === 0,
      };
    });
  }
}

/** 键位冲突检测：返回 code -> [冲突的动作名] */
export function findConflicts(bindings) {
  const map = new Map();
  for (const [action, v] of Object.entries(bindings)) {
    if (v == null) continue;
    const list = Array.isArray(v) ? v : [v];
    for (const code of list) {
      if (!code) continue;
      if (!map.has(code)) map.set(code, []);
      map.get(code).push(action);
    }
  }
  const conflicts = new Map();
  for (const [code, actions] of map) {
    if (actions.length > 1) conflicts.set(code, actions);
  }
  return conflicts;
}
