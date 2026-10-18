import { isTouchPrimary } from './performance.js';
import { AttackGesture } from './combat-wheel.mjs';
import {
  SPRINT_STICK_THRESHOLD,
  clampSprintThreshold,
} from './touch-settings.mjs';

/**
 * 触屏输入层。
 * 现代浏览器使用 Pointer Events；老旧 QQ/微信 X5 内核可能存在
 * PointerEvent / setPointerCapture 半支持问题，因此在触摸设备上
 * 同时提供传统 Touch Events 路径，优先用 Touch Events 驱动手指操作。
 */
export class TouchControls {
  constructor({ canvas, controller, root, lookZone, joystick, stick, onAction, onParryGesture, onRollGesture, isActive, enabled, allowAutoActivate, allowMouse }) {
    this.canvas = canvas;
    this.controller = controller;
    this.root = root;
    this.lookZone = lookZone;
    this.joystick = joystick;
    this.stick = stick;
    this.onAction = onAction;
    this.onParryGesture = onParryGesture;
    this.onRollGesture = onRollGesture;
    this.isActive = isActive;

    this.lookPointer = null;
    this.lookLast = { x: 0, y: 0 };
    this.movePointer = null;
    this.pointerRoles = new Map();
    this.attackPointers = new Map();
    // 独立翻滚键的拖动定向：记录起点与当前拖动（屏幕坐标，右+、上-）。
    this.dodgePointers = new Map();
    this.move = { x: 0, y: 0, mag: 0 };
    this.maxStick = 48;
    // 疾跑触发范围（摇杆归一化行程阈值），可由设置面板实时调整。
    this.sprintThreshold = clampSprintThreshold(SPRINT_STICK_THRESHOLD);
    // 初始启用状态可由外层（输入模式设置）显式指定，省略时维持原有设备检测。
    this.enabled = typeof enabled === 'boolean' ? enabled : isTouchPrimary();
    // 首次真实触摸 / 触摸型 pointer 是否允许运行时自动激活（强制键鼠时返回 false）。
    this.allowAutoActivate = typeof allowAutoActivate === 'function' ? allowAutoActivate : () => true;
    // 强制触屏且无真实触摸能力的桌面调试：允许鼠标指针驱动摇杆/按钮/look zone。
    this.allowMouse = !!allowMouse;

    // 老 X5 / Android WebView 对 Touch Events 的支持最稳定。
    // 只要设备具备触摸能力，手指输入优先走 Touch Events；Pointer Events 保留给笔/鼠标。
    this.useTouchEvents = ('ontouchstart' in window) || !!window.TouchEvent || navigator.maxTouchPoints > 0;
    this.gestureBlocked = false;
    this.applied = false;

    if (!root || !lookZone || !joystick || !stick) return;
    this._bind();
    this._applySprintRing();
    if (this.enabled) this._apply();
  }

  /**
   * 调整疾跑触发范围（归一化行程，0.55-0.95），立即生效：
   * 疾跑判定与可视档位环同步更新；布局层负责持久化。
   */
  setSprintThreshold(v) {
    this.sprintThreshold = clampSprintThreshold(v);
    this._applySprintRing();
    // 手指正推在杆上时，立刻按新阈值重算疾跑状态，无需等下一帧移动。
    if (this.movePointer !== null) {
      const wantSprint = this.move.mag >= this.sprintThreshold;
      this.controller.touchSprint = wantSprint;
      this.joystick.classList.toggle('stick-sprint', wantSprint);
    }
  }

  /** 档位环半径(px) = 阈值 × 归一化满行程(maxStick)，与疾跑判定同一口径。 */
  _applySprintRing() {
    if (!this.joystick) return;
    const radius = this.sprintThreshold * this.maxStick;
    const radiusPx = `${radius.toFixed(2)}px`;
    // 用预先计算的长度避免 CSS `calc(2 * var(...))`：老 QQ/微信 X5
    // 可能不支持乘法 calc，但自定义属性中的具体 px 长度可直接解析。
    this.joystick.style.setProperty('--stick-sprint-radius', radiusPx);
    this.joystick.style.setProperty('--stick-sprint-size', `${(radius * 2).toFixed(2)}px`);
    this.joystick.style.setProperty('--stick-sprint-offset', `${(-radius).toFixed(2)}px`);
  }

  /** 激活触控模式（幂等）。可由加载时判定或首次真实触摸调用。 */
  activate() {
    this.enabled = true;
    this._apply();
  }

  /** 停用触控模式（幂等）：释放所有指针、脱离控制器、移除触屏 body class 与手势拦截。 */
  deactivate() {
    this.enabled = false;
    if (!this.applied) return;
    this.applied = false;
    this.releaseAll();
    this.controller.touchEnabled = false;
    document.body.classList.remove('touch-mode');
    this._removeGestureBlockers();
  }

  /** 真正把触控层接入控制器/页面（幂等，不能因 enabled 已为 true 而跳过）。 */
  _apply() {
    if (this.applied) return;
    this.applied = true;
    document.body.classList.add('touch-mode');
    this.controller.touchEnabled = true;
    this.controller.touchAxes = this.move;
    if (document.pointerLockElement) {
      try { document.exitPointerLock(); } catch (_) { /* 老内核可能不支持 */ }
    }
    this._installGestureBlockers();
  }

  _bind() {
    this._bindPointerInput();
    if (this.useTouchEvents) this._bindTouchInput();

    window.addEventListener('blur', () => this.releaseAll());
    window.addEventListener('pagehide', () => this.releaseAll());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.releaseAll();
    });
  }

  _installGestureBlockers() {
    if (this.gestureBlocked) return;
    this.gestureBlocked = true;
    const block = (event) => event.preventDefault();
    this._gestureBlock = block;
    document.addEventListener('contextmenu', block);
    document.addEventListener('dblclick', block);
    document.addEventListener('gesturestart', block);
    document.addEventListener('gesturechange', block);
  }

  _removeGestureBlockers() {
    if (!this.gestureBlocked) return;
    this.gestureBlocked = false;
    const block = this._gestureBlock;
    this._gestureBlock = null;
    if (!block) return;
    document.removeEventListener?.('contextmenu', block);
    document.removeEventListener?.('dblclick', block);
    document.removeEventListener?.('gesturestart', block);
    document.removeEventListener?.('gesturechange', block);
  }

  _bindPointerInput() {
    this.lookZone.addEventListener('pointerdown', (event) => {
      // 触摸设备由 Touch Events 专门处理，避免现代浏览器双路径重复触发。
      if (this.useTouchEvents && (event.pointerType === 'touch' || event.pointerType === 'pen')) return;
      if (!this.enabled || !this._isTouchPointer(event) || !this.isActive() || this.lookPointer !== null) return;
      this.lookPointer = event.pointerId;
      this.lookLast.x = event.clientX;
      this.lookLast.y = event.clientY;
      this.pointerRoles.set(event.pointerId, 'look');
      this.controller.touchLookActive = true;
      this._capture(this.lookZone, event.pointerId);
      event.preventDefault();
      event.stopPropagation();
    });

    this.lookZone.addEventListener('pointermove', (event) => {
      if (this.useTouchEvents && (event.pointerType === 'touch' || event.pointerType === 'pen')) return;
      if (this.pointerRoles.get(event.pointerId) !== 'look') return;
      this._applyLook(event.clientX, event.clientY, event.pointerId);
      event.preventDefault();
    });

    for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) {
      this.lookZone.addEventListener(name, (event) => this._release(event.pointerId));
    }

    this.joystick.addEventListener('pointerdown', (event) => {
      if (this.useTouchEvents && (event.pointerType === 'touch' || event.pointerType === 'pen')) return;
      if (!this.enabled || !this._isTouchPointer(event) || !this.isActive() || this.movePointer !== null) return;
      this.movePointer = event.pointerId;
      this.pointerRoles.set(event.pointerId, 'move');
      this._capture(this.joystick, event.pointerId);
      this._updateJoystick(event.clientX, event.clientY);
      event.preventDefault();
      event.stopPropagation();
    });

    this.joystick.addEventListener('pointermove', (event) => {
      if (this.useTouchEvents && (event.pointerType === 'touch' || event.pointerType === 'pen')) return;
      if (this.pointerRoles.get(event.pointerId) !== 'move') return;
      this._updateJoystick(event.clientX, event.clientY);
      event.preventDefault();
      event.stopPropagation();
    });

    for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) {
      this.joystick.addEventListener(name, (event) => this._release(event.pointerId));
    }

    this.root.querySelectorAll('[data-touch-action]').forEach((button) => {
      const action = button.dataset.touchAction;
      button.addEventListener('pointerdown', (event) => {
        if (this.useTouchEvents && (event.pointerType === 'touch' || event.pointerType === 'pen')) return;
        if (!this.enabled || !this._isTouchPointer(event) || !this.isActive()) return;
        event.preventDefault();
        event.stopPropagation();
        this._capture(button, event.pointerId);
        this.pointerRoles.set(event.pointerId, 'button:' + action);
        button.classList.add('pressed');
        if (action === 'attack') this.attackPointers.set(event.pointerId, this._startAttackPointer(event.pointerId, event.clientX, event.clientY));
        if (action === 'dodge') this.dodgePointers.set(event.pointerId, { x: event.clientX, y: event.clientY, dx: 0, dy: 0 });
        this.onAction(action, true, event.pointerId, { dx: 0, dy: 0, moved: false });
      });
      button.addEventListener('pointerup', (event) => this._release(event.pointerId));
      button.addEventListener('pointercancel', (event) => this._release(event.pointerId));
      button.addEventListener('lostpointercapture', (event) => this._release(event.pointerId));
      button.addEventListener('pointermove', (event) => {
        const role = this.pointerRoles.get(event.pointerId);
        if (role === 'button:attack') {
          this._trackAttackMove(event.pointerId, event.clientX, event.clientY);
        } else if (role === 'button:dodge') {
          const g = this.dodgePointers.get(event.pointerId);
          if (g) { g.dx = event.clientX - g.x; g.dy = event.clientY - g.y; }
        }
        event.preventDefault();
      });
      button.addEventListener('contextmenu', (event) => event.preventDefault());
    });

    window.addEventListener('pointerup', (event) => this._release(event.pointerId));
    window.addEventListener('pointercancel', (event) => this._release(event.pointerId));
    window.addEventListener('pointermove', (event) => {
      const role = this.pointerRoles.get(event.pointerId);
      if (role === 'button:attack') {
        this._trackAttackMove(event.pointerId, event.clientX, event.clientY);
      } else if (role === 'button:dodge') {
        const g = this.dodgePointers.get(event.pointerId);
        if (g) { g.dx = event.clientX - g.x; g.dy = event.clientY - g.y; }
      }
    });
  }

  _bindTouchInput() {
    // 捕获阶段的全局触摸：即便 UA/媒体查询误判，第一次触摸也立即启用触控。
    window.addEventListener('touchstart', (event) => {
      if (!this.enabled && this.allowAutoActivate()) this.activate();
    }, { passive: true, capture: true });

    const add = (element, type, handler) => {
      element.addEventListener(type, handler, { passive: false });
    };

    add(this.lookZone, 'touchstart', (event) => {
      if (!this.enabled || !this.isActive()) return;
      for (const touch of event.changedTouches) {
        if (this.lookPointer !== null) continue;
        this.lookPointer = touch.identifier;
        this.lookLast.x = touch.clientX;
        this.lookLast.y = touch.clientY;
        this.pointerRoles.set(touch.identifier, 'look');
        this.controller.touchLookActive = true;
      }
      event.preventDefault();
      event.stopPropagation();
    });

    add(this.lookZone, 'touchmove', (event) => {
      for (const touch of event.changedTouches) {
        if (this.pointerRoles.get(touch.identifier) !== 'look') continue;
        this._applyLook(touch.clientX, touch.clientY, touch.identifier);
      }
      event.preventDefault();
      event.stopPropagation();
    });

    add(this.joystick, 'touchstart', (event) => {
      if (!this.enabled || !this.isActive()) return;
      for (const touch of event.changedTouches) {
        if (this.movePointer !== null) continue;
        this.movePointer = touch.identifier;
        this.pointerRoles.set(touch.identifier, 'move');
        this._updateJoystick(touch.clientX, touch.clientY);
      }
      event.preventDefault();
      event.stopPropagation();
    });

    add(this.joystick, 'touchmove', (event) => {
      for (const touch of event.changedTouches) {
        if (this.pointerRoles.get(touch.identifier) !== 'move') continue;
        this._updateJoystick(touch.clientX, touch.clientY);
      }
      event.preventDefault();
      event.stopPropagation();
    });

    this.root.querySelectorAll('[data-touch-action]').forEach((button) => {
      const action = button.dataset.touchAction;
      add(button, 'touchstart', (event) => {
        if (!this.enabled || !this.isActive()) return;
        for (const touch of event.changedTouches) {
          if (this.pointerRoles.has(touch.identifier)) continue;
          this.pointerRoles.set(touch.identifier, 'button:' + action);
          button.classList.add('pressed');
          if (action === 'attack') this.attackPointers.set(touch.identifier, this._startAttackPointer(touch.identifier, touch.clientX, touch.clientY));
          if (action === 'dodge') this.dodgePointers.set(touch.identifier, { x: touch.clientX, y: touch.clientY, dx: 0, dy: 0 });
          this.onAction(action, true, touch.identifier, { dx: 0, dy: 0, moved: false });
        }
        event.preventDefault();
        event.stopPropagation();
      });
      add(button, 'touchmove', (event) => {
        for (const touch of event.changedTouches) {
          const role = this.pointerRoles.get(touch.identifier);
          if (role === 'button:attack') {
            this._trackAttackMove(touch.identifier, touch.clientX, touch.clientY);
          } else if (role === 'button:dodge') {
            const g = this.dodgePointers.get(touch.identifier);
            if (g) { g.dx = touch.clientX - g.x; g.dy = touch.clientY - g.y; }
          }
        }
        event.preventDefault();
      });
      add(button, 'contextmenu', (event) => event.preventDefault());
    });

    // touchend 会发送到触摸开始时的原始目标；window 再做一层兜底。
    const finishTouches = (event) => {
      for (const touch of event.changedTouches) {
        const role = this.pointerRoles.get(touch.identifier);
        if (role === 'button:attack') {
          this._trackAttackMove(touch.identifier, touch.clientX, touch.clientY, true);
        } else if (role === 'button:dodge') {
          const g = this.dodgePointers.get(touch.identifier);
          if (g) { g.dx = touch.clientX - g.x; g.dy = touch.clientY - g.y; }
        }
        this._release(touch.identifier);
      }
    };
    window.addEventListener('touchend', finishTouches, { passive: false });
    window.addEventListener('touchcancel', finishTouches, { passive: false });
  }

  /** 攻击键按下：建立单指手势状态（起点 + 时间）。 */
  _startAttackPointer(pointerId, clientX, clientY) {
    const gesture = new AttackGesture(pointerId);
    gesture.x = clientX;
    gesture.y = clientY;
    return gesture;
  }

  /**
   * 攻击键按住中的拖动：更新位移；水平主导且跨过方向阈值的当帧，
   * 左滑通过 onParryGesture 立即触发一次迎击，右滑通过 onRollGesture
   * 立即触发一次翻滚（AttackGesture 闩锁保证一次按住最多触发一个方向招式）。
   * silent=true 用于 touchend 兜底位移：只更新状态/可能触发招式，不再补发按下回调。
   */
  _trackAttackMove(pointerId, clientX, clientY, silent = false) {
    const a = this.attackPointers.get(pointerId);
    if (!a) return;
    const dx = clientX - a.x;
    const dy = clientY - a.y;
    const ev = a.update(dx, dy);
    if (ev) {
      if (ev.kind === 'parry' && this.onParryGesture) this.onParryGesture(ev);
      if (ev.kind === 'roll' && this.onRollGesture) this.onRollGesture(ev);
    }
    if (!silent) {
      this.onAction('attack', true, pointerId, {
        dx, dy, moved: Math.hypot(dx, dy) > 18,
        fired: a.fired, parried: a.parried, rolled: a.rolled,
      });
    }
  }

  _isTouchPointer(event) {
    const isTouch = event.pointerType === 'touch' || event.pointerType === 'pen';
    if (isTouch) {
      if (!this.enabled && this.allowAutoActivate()) this.activate();
      return true;
    }
    // 强制触屏的桌面调试：允许鼠标驱动触控层；其余情况鼠标仍走 Pointer Lock 路径。
    return this.enabled && !!this.allowMouse;
  }

  _capture(element, pointerId) {
    try {
      if (element.setPointerCapture) element.setPointerCapture(pointerId);
    } catch (_) {
      // Safari / 旧 X5 可能拒绝或不存在，传统 Touch Events 不依赖 capture。
    }
  }

  _applyLook(x, y, id) {
    const dx = x - this.lookLast.x;
    const dy = y - this.lookLast.y;
    this.lookLast.x = x;
    this.lookLast.y = y;
    this.controller.yaw -= dx * this.controller.touchLookSensitivity;
    this.controller.pitch = Math.max(-1.15, Math.min(1.05,
      this.controller.pitch - dy * this.controller.touchLookSensitivity));
  }

  _updateJoystick(clientX, clientY) {
    const rect = this.joystick.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    let dx = clientX - cx;
    let dy = clientY - cy;
    const length = Math.hypot(dx, dy);
    if (length > this.maxStick) {
      dx *= this.maxStick / length;
      dy *= this.maxStick / length;
    }
    let x = dx / this.maxStick;
    let y = -dy / this.maxStick;
    const magnitude = Math.hypot(x, y);
    if (magnitude < 0.14) {
      x = 0;
      y = 0;
    } else if (magnitude > 1) {
      x /= magnitude;
      y /= magnitude;
    }
    this.move.x = x;
    this.move.y = y;
    // 疾跑由摇杆拖动距离决定（取代独立疾跑按钮）：推过档位环即疾跑。
    this.move.mag = Math.min(1, magnitude);
    const wantSprint = this.move.mag >= this.sprintThreshold;
    this.controller.touchSprint = wantSprint;
    this.joystick.classList.toggle('stick-sprint', wantSprint);
    this.stick.style.transform = 'translate(' + dx + 'px, ' + dy + 'px)';
    this.joystick.classList.add('active');
  }

  _release(pointerId) {
    const role = this.pointerRoles.get(pointerId);
    if (!role) return;
    this.pointerRoles.delete(pointerId);
    if (role === 'look' && this.lookPointer === pointerId) {
      this.lookPointer = null;
      this.controller.touchLookActive = false;
    }
    if (role === 'move' && this.movePointer === pointerId) {
      this.movePointer = null;
      this.move.x = 0;
      this.move.y = 0;
      this.move.mag = 0;
      this.controller.touchSprint = false;
      this.joystick.classList.remove('stick-sprint');
      this.stick.style.transform = 'translate(0, 0)';
      this.joystick.classList.remove('active');
    }
    if (role.indexOf('button:') === 0) {
      const action = role.slice(7);
      const a = this.attackPointers.get(pointerId);
      const g = this.dodgePointers.get(pointerId);
      let data;
      if (action === 'dodge' && g) {
        data = { dx: g.dx, dy: g.dy, moved: Math.hypot(g.dx, g.dy) > 22 };
      } else if (a) {
        const out = a.release();
        data = {
          dx: out.dx, dy: out.dy, moved: Math.hypot(out.dx, out.dy) > 18,
          holdMs: out.holdMs, fired: out.fired, parried: out.parried, rolled: out.rolled,
        };
      } else {
        data = { dx: 0, dy: 0, moved: false };
      }
      this.onAction(action, false, pointerId, data);
      this.attackPointers.delete(pointerId);
      this.dodgePointers.delete(pointerId);
      const button = this.root.querySelector('[data-touch-action="' + action + '"]');
      if (button) button.classList.remove('pressed');
    }
  }

  releaseAll() {
    const ids = Array.from(this.pointerRoles.keys());
    for (const pointerId of ids) this._release(pointerId);
    this.move.x = 0;
    this.move.y = 0;
    this.move.mag = 0;
    this.controller.touchSprint = false;
    this.controller.touchLookActive = false;
    if (this.joystick) this.joystick.classList.remove('active', 'stick-sprint');
    if (this.stick) this.stick.style.transform = 'translate(0, 0)';
    if (this.root) {
      const buttons = this.root.querySelectorAll('.pressed');
      for (const button of buttons) button.classList.remove('pressed');
    }
  }
}
