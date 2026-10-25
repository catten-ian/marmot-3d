/**
 * 扮演藏狐输入适配：不依赖 DOM / THREE，便于契约测试。
 * 触屏事件仍由唯一 TouchControls 实例接收，这里只转换输出并保存/恢复路由。
 */

export const PAF_TOUCH_DEAD_ZONE = 0.14;

/** 与 TouchControls 相同的径向死区/归一化口径；右拖为负 turn（顺时针右转）。 */
export function mapPafJoystick(axes = {}, sprintThreshold = 0.78, deadZone = PAF_TOUCH_DEAD_ZONE) {
  let x = Number.isFinite(axes?.x) ? axes.x : 0;
  let y = Number.isFinite(axes?.y) ? axes.y : 0;
  const rawMagnitude = Math.hypot(x, y);
  const magnitude = Math.min(1, rawMagnitude);
  if (rawMagnitude > 1) { x /= rawMagnitude; y /= rawMagnitude; }
  if (magnitude < deadZone) {
    return { throttle: 0, turn: 0, magnitude: 0, sprint: false, stalk: true };
  }
  const sprint = magnitude >= sprintThreshold;
  return { throttle: y, turn: -x, magnitude, sprint, stalk: !sprint };
}

/** 玩家方案优先，同时保留藏狐原有 WASD/方向键/Shift/Space 兜底。 */
export function isPafKey(binds, code, actionIds, fallbackCodes = []) {
  const ids = Array.isArray(actionIds) ? actionIds : [actionIds];
  for (const id of ids) {
    try { if (binds?.isAction?.(code, id)) return true; } catch { /* 无方案时走默认键 */ }
  }
  return fallbackCodes.includes(code);
}

export function pafKeyHeld(binds, keys, actionIds, fallbackCodes = []) {
  for (const code of keys) if (isPafKey(binds, code, actionIds, fallbackCodes)) return true;
  return false;
}

/**
 * 触屏攻击蓄力状态机：短按松手仍经过 windTime 后扑出；持续按住可延长蓄力，
 * 松手或达到 maxChargeTime 时扑出。只决定相位，不改变既有位移/捕获规则。
 */
export class PafPounceCharge {
  constructor() { this.reset(); }
  reset() { this.active = false; this.held = false; this.released = false; this.elapsed = 0; }
  press() {
    if (this.active) return false;
    this.active = true; this.held = true; this.released = false; this.elapsed = 0;
    return true;
  }
  release() {
    if (!this.active) return false;
    this.held = false; this.released = true;
    return true;
  }
  step(dt, windTime, maxChargeTime) {
    if (!this.active) return { shouldLunge: false, charge: 0, elapsed: 0 };
    this.elapsed += Math.max(0, Number.isFinite(dt) ? dt : 0);
    const minWind = Math.max(0, windTime);
    const maxCharge = Math.max(minWind, maxChargeTime);
    const shouldLunge = (this.released && this.elapsed >= minWind) || this.elapsed >= maxCharge;
    return {
      shouldLunge,
      charge: Math.min(1, this.elapsed / Math.max(0.0001, maxCharge)),
      elapsed: this.elapsed,
    };
  }
}

/**
 * 临时切换 TouchControls 的输出端，不新增/解绑任何 DOM 监听。
 * restore() 先 releaseAll，因此 attack、摇杆、look、手势均不会跨模式残留。
 */
export class PafInputRoute {
  constructor(touchControls) {
    this.touchControls = touchControls;
    this.snapshot = null;
    this.controller = null;
  }
  get active() { return !!this.snapshot; }
  activate({ onAction, onLook, lookSensitivity = 0.006 } = {}) {
    if (this.active || !this.touchControls) return false;
    const tc = this.touchControls;
    this.snapshot = {
      controller: tc.controller, onAction: tc.onAction,
      onParryGesture: tc.onParryGesture, onRollGesture: tc.onRollGesture,
    };
    tc.releaseAll();
    let yaw = 0;
    const route = this;
    this.controller = {
      touchEnabled: !!tc.applied && !!tc.enabled,
      touchAxes: tc.move,
      touchSprint: false,
      touchLookActive: false,
      touchLookSensitivity: lookSensitivity,
      pitch: 0,
      get yaw() { return yaw; },
      set yaw(next) {
        const previous = yaw;
        yaw = next;
        // TouchControls 向右拖会减小 yaw；藏狐与普通鼠标一致，向右拖增大朝向。
        onLook?.(previous - next);
      },
    };
    tc.controller = this.controller;
    tc.onAction = (action, pressed, pointerId, gesture) => {
      if (route.active) onAction?.(action, pressed, pointerId, gesture);
    };
    // 藏狐没有迎击/翻滚手势，屏蔽共享攻击键上的土拨鼠滑动语义。
    tc.onParryGesture = null;
    tc.onRollGesture = null;
    return true;
  }
  restore() {
    if (!this.snapshot) return false;
    const tc = this.touchControls;
    const saved = this.snapshot;
    // 先清掉路由期间所有指针，再切回，避免 release 回调送进普通模式。
    this.snapshot = null;
    tc.releaseAll();
    tc.controller = saved.controller;
    tc.onAction = saved.onAction;
    tc.onParryGesture = saved.onParryGesture;
    tc.onRollGesture = saved.onRollGesture;
    tc.controller.touchEnabled = !!tc.applied && !!tc.enabled;
    tc.controller.touchAxes = tc.move;
    tc.controller.touchSprint = false;
    tc.controller.touchLookActive = false;
    if (this.controller) {
      this.controller.touchSprint = false;
      this.controller.touchLookActive = false;
    }
    this.controller = null;
    return true;
  }
}
