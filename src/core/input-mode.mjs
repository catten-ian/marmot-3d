/**
 * 输入模式偏好（纯逻辑模块，Node 逻辑测试与浏览器共用）。
 *
 * 三种偏好：
 * - auto（默认）：按 isTouchPrimary() 静态检测；微信/QQ X5 等谎报能力的
 *   内置浏览器在首次真实触摸时运行时升级为触屏；
 * - touch（强制触屏）：任何设备都启用触屏摇杆 / look zone / 动作按钮；
 * - keyboard（强制键鼠）：任何设备都保持键盘 + 鼠标 / Pointer Lock，
 *   收到 touchstart 也不允许切换到触屏。
 *
 * 持久化使用独立、带版本的 key；读取到损坏/未知值一律回退 auto。
 * 自动模式的运行时升级只影响“有效模式”，不会改写用户偏好本身。
 */
import { isTouchPrimary } from './performance.js';

export const INPUT_MODE_STORAGE_KEY = 'marmot.input-mode.v1';
export const INPUT_MODE_AUTO = 'auto';
export const INPUT_MODE_TOUCH = 'touch';
export const INPUT_MODE_KEYBOARD = 'keyboard';
export const INPUT_MODES = [INPUT_MODE_AUTO, INPUT_MODE_TOUCH, INPUT_MODE_KEYBOARD];

/** 任意外部输入归一化为合法偏好；损坏/未知值回退 auto。 */
export function normalizeInputMode(value) {
  return INPUT_MODES.includes(value) ? value : INPUT_MODE_AUTO;
}

export function readInputModePreference(storage = globalThis.localStorage) {
  try { return normalizeInputMode(storage?.getItem?.(INPUT_MODE_STORAGE_KEY)); }
  catch (_) { return INPUT_MODE_AUTO; }
}

export function writeInputModePreference(mode, storage = globalThis.localStorage) {
  const next = normalizeInputMode(mode);
  try { storage?.setItem?.(INPUT_MODE_STORAGE_KEY, next); }
  catch (error) { globalThis.console?.warn?.('输入模式无法写入本地存储', error); }
  return next;
}

/**
 * 输入模式状态机：用户偏好 + 自动模式的设备检测 / 首次触摸运行时升级。
 * effective() 是唯一权威的有效输入解析；偏好与升级状态分开保存，
 * 因此“自动 + 当前触屏”永远不会被错写成用户强制触屏。
 */
export class InputModeManager {
  constructor({ storage = globalThis.localStorage, detectTouch = isTouchPrimary } = {}) {
    this._storage = storage;
    this._detectTouch = typeof detectTouch === 'function' ? detectTouch : () => false;
    this._preference = readInputModePreference(storage);
    // 运行时首次真实触摸升级（仅自动模式、且静态检测未判定触屏时有意义）。
    this._runtimeTouch = false;
    this._deviceTouch = this._preference === INPUT_MODE_AUTO ? !!this._detectTouch() : false;
    this._listeners = new Set();
  }

  get preference() { return this._preference; }
  /** 自动模式下的静态设备检测结果（强制模式下不参与判定）。 */
  get deviceTouch() { return this._deviceTouch; }
  /** 自动模式下是否已被首次真实触摸动态升级。 */
  get runtimeTouch() { return this._runtimeTouch; }

  /** 有效输入模式：'touch' | 'keyboard'。 */
  effective() {
    if (this._preference === INPUT_MODE_TOUCH) return INPUT_MODE_TOUCH;
    if (this._preference === INPUT_MODE_KEYBOARD) return INPUT_MODE_KEYBOARD;
    return (this._deviceTouch || this._runtimeTouch) ? INPUT_MODE_TOUCH : INPUT_MODE_KEYBOARD;
  }

  isTouch() { return this.effective() === INPUT_MODE_TOUCH; }

  /** 只有自动模式且尚未判定触屏时，真实触摸才允许运行时升级。 */
  canRuntimeUpgrade() {
    return this._preference === INPUT_MODE_AUTO && !this._deviceTouch && !this._runtimeTouch;
  }

  /**
   * 收到真实手指触摸（pointerdown touch/pen 或 touchstart）时调用。
   * 强制键鼠 / 强制触屏 / 已是触屏的自动模式均为幂等 no-op，返回 false。
   */
  notifyRealTouch() {
    if (!this.canRuntimeUpgrade()) return false;
    this._runtimeTouch = true;
    this._emit();
    return true;
  }

  /** 切换偏好并持久化；切回 auto 时重新做设备检测。返回归一化后的偏好。 */
  setPreference(mode) {
    const next = writeInputModePreference(mode, this._storage);
    const beforePref = this._preference;
    const beforeEffective = this.effective();
    this._preference = next;
    this._deviceTouch = next === INPUT_MODE_AUTO ? !!this._detectTouch() : false;
    if (beforePref !== next || beforeEffective !== this.effective()) this._emit();
    return next;
  }

  /**
   * 面向日志 / 反馈快照的状态描述。自动模式升级后仍明确表达
   * “自动 + 当前触屏”（auto+runtime-touch），不混淆为强制触屏。
   */
  describe() {
    if (this._preference !== INPUT_MODE_AUTO) return this._preference;
    if (this._runtimeTouch && !this._deviceTouch) return 'auto+runtime-touch';
    return `auto(${this.effective()})`;
  }

  onChange(fn) {
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }

  _emit() {
    for (const fn of this._listeners) {
      try { fn(this); } catch (_) { /* 监听者异常不应阻断输入模式切换 */ }
    }
  }
}
