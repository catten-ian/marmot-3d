/**
 * 扮演藏狐输入适配：不依赖 DOM / THREE，便于契约测试。
 * 触屏事件仍由唯一 TouchControls 实例接收，这里只转换输出并保存/恢复路由。
 */

export const PAF_TOUCH_DEAD_ZONE = 0.14;
export const PAF_DEFAULT_POUNCE_ARC_DEG = 120;

const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
const clamp = (value, min, max) => value < min ? min : value > max ? max : value;

/**
 * Pounce direction selection. The local frame is x=right, z=forward and
 * yaw=0 points along +Z. Keyboard and touch use the same vector contract;
 * diagonal input is normalized once and pounce selection is clamped to the
 * configured forward arc. It is deliberately separate from ordinary tank locomotion.
 */
export function pafDirectionFromInput({
  cameraYaw = 0,
  forward = false,
  back = false,
  left = false,
  right = false,
  axes = null,
  arcDeg = PAF_DEFAULT_POUNCE_ARC_DEG,
  deadZone = PAF_TOUCH_DEAD_ZONE,
} = {}) {
  const yaw = finite(cameraYaw, 0);
  let x = (right ? 1 : 0) - (left ? 1 : 0);
  let z = (forward ? 1 : 0) - (back ? 1 : 0);
  let source = 'keyboard';
  if (x === 0 && z === 0) {
    const ax = finite(axes?.x, 0);
    const az = finite(axes?.y, 0);
    if (Math.hypot(ax, az) >= Math.max(0, finite(deadZone, PAF_TOUCH_DEAD_ZONE))) {
      x = ax; z = az; source = 'touch';
    } else {
      x = Math.sin(yaw); z = Math.cos(yaw); source = 'fallback';
    }
  }
  const magnitude = Math.hypot(x, z);
  if (!(magnitude > 1e-9) || !Number.isFinite(magnitude)) {
    x = Math.sin(yaw); z = Math.cos(yaw); source = 'fallback';
  } else {
    x /= magnitude; z /= magnitude;
  }
  const requestedOffset = Math.atan2(x, z);
  const halfArc = clamp(Math.abs(finite(arcDeg, PAF_DEFAULT_POUNCE_ARC_DEG)), 0, 360) * Math.PI / 360;
  const offset = clamp(requestedOffset, -halfArc, halfArc);
  const worldYaw = yaw + offset;
  return {
    x: Math.sin(worldYaw),
    z: Math.cos(worldYaw),
    yaw: worldYaw,
    localX: Math.sin(offset),
    localZ: Math.cos(offset),
    offset,
    requestedOffset,
    magnitude: Math.min(1, magnitude),
    source,
  };
}

/** Tank-style normal locomotion: throttle follows facing and steering never adds lateral motion.
 * Keyboard commands take precedence when present; joystick axes are radial-dead-zoned and
 * clamped to unit length before vertical throttle / horizontal steering are read.
 * Positive yaw turns right and, with yaw=0, forward points along +Z.
 */
export function pafTankDriveFromInput({ yaw = 0, keys = {}, axes = null, dt = 0, turnRate = 2.6, deadZone = PAF_TOUCH_DEAD_ZONE } = {}) {
  const facing = finite(yaw, 0);
  const step = Math.max(0, finite(dt, 0));
  const held = ['forward', 'back', 'left', 'right'].some((key) => !!keys?.[key]);
  let throttle;
  let turn;
  let magnitude;
  let source;
  if (held) {
    throttle = Number(!!keys.forward) - Number(!!keys.back);
    turn = Number(!!keys.right) - Number(!!keys.left);
    magnitude = Math.max(Math.abs(throttle), Math.abs(turn));
    source = 'keyboard';
  } else {
    const joystick = mapPafJoystick(axes, 1, deadZone);
    throttle = joystick.throttle;
    turn = joystick.turn;
    magnitude = joystick.magnitude;
    source = magnitude > 0 ? 'touch' : 'none';
  }
  const nextYaw = facing + turn * finite(turnRate, 2.6) * step;
  return {
    x: Math.sin(nextYaw) * throttle,
    z: Math.cos(nextYaw) * throttle,
    yaw: nextYaw,
    throttle,
    turn,
    magnitude,
    active: Math.abs(throttle) > 1e-9 || Math.abs(turn) > 1e-9,
    isBackpedal: throttle < 0,
    source,
  };
}

/** Whether PAF may consume gameplay input or advance its gameplay simulation. */
export function pafInputBlocked({ running = true, paused = false, settingsOpen = false } = {}) {
  return !running || !!paused || !!settingsOpen;
}

/** Shared startPounce gate: no actions may begin while stopped, paused, in settings, or mid-phase. */
export function pafCanStartPounce({ running = true, paused = false, settingsOpen = false, phase = 'idle' } = {}) {
  return !pafInputBlocked({ running, paused, settingsOpen }) && phase === 'idle';
}

/** Clear held keyboard/touch state at pause and mode exit so no input survives release. */
export function releasePafInput({ keys, touchControls, touchState } = {}) {
  keys?.clear?.();
  if (touchState) {
    touchState.throttle = 0;
    touchState.turn = 0;
    touchState.sprint = false;
  }
  touchControls?.releaseAll?.();
}

/** 与 TouchControls 相同的径向死区/归一化口径；右拖为正 turn，配合 PAF yaw 转向右侧。 */
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
  return { throttle: y, turn: x, magnitude, sprint, stalk: !sprint };
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

/** Normal PAF key contract; arrows are always aliases, including custom keybind schemes. */
export function pafKeyboardDriveInput(binds, keys) {
  return {
    forward: pafKeyHeld(binds, keys, 'forward', ['KeyW', 'ArrowUp']),
    back: pafKeyHeld(binds, keys, 'back', ['KeyS', 'ArrowDown']),
    left: pafKeyHeld(binds, keys, ['left', 'turnLeft'], ['KeyA', 'ArrowLeft']),
    right: pafKeyHeld(binds, keys, ['right', 'turnRight'], ['KeyD', 'ArrowRight']),
  };
}

/**
 * PAF moving-pounce phase gate: a press starts a short readable windup and
 * launch is time-based; release state is retained only for route compatibility.
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
  step(dt, windTime) {
    if (!this.active) return { shouldLunge: false, charge: 0, elapsed: 0 };
    this.elapsed += Math.max(0, finite(dt, 0));
    const minWind = Math.max(0, finite(windTime, 0));
    return {
      // PAF moving pounce is press-to-trigger: release state never gates launch.
      shouldLunge: this.elapsed >= minWind,
      charge: Math.min(1, this.elapsed / Math.max(0.0001, minWind)),
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
