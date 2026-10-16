import { isTouchPrimary } from './performance.js';

// 摇杆推过该归一化距离即进入疾跑（取代独立疾跑按钮）。
const SPRINT_STICK_THRESHOLD = 0.78;

/**
 * 触屏输入层。
 * 现代浏览器使用 Pointer Events；老旧 QQ/微信 X5 内核可能存在
 * PointerEvent / setPointerCapture 半支持问题，因此在触摸设备上
 * 同时提供传统 Touch Events 路径，优先用 Touch Events 驱动手指操作。
 */
export class TouchControls {
  constructor({ canvas, controller, root, lookZone, joystick, stick, onAction, isActive }) {
    this.canvas = canvas;
    this.controller = controller;
    this.root = root;
    this.lookZone = lookZone;
    this.joystick = joystick;
    this.stick = stick;
    this.onAction = onAction;
    this.isActive = isActive;

    this.lookPointer = null;
    this.lookLast = { x: 0, y: 0 };
    this.movePointer = null;
    this.pointerRoles = new Map();
    this.attackPointers = new Map();
    this.move = { x: 0, y: 0, mag: 0 };
    this.maxStick = 48;
    this.enabled = isTouchPrimary();

    // 老 X5 / Android WebView 对 Touch Events 的支持最稳定。
    // 只要设备具备触摸能力，手指输入优先走 Touch Events；Pointer Events 保留给笔/鼠标。
    this.useTouchEvents = ('ontouchstart' in window) || !!window.TouchEvent || navigator.maxTouchPoints > 0;
    this.gestureBlocked = false;
    this.applied = false;

    if (!root || !lookZone || !joystick || !stick) return;
    this._bind();
    if (this.enabled) this._apply();
  }

  /** 激活触控模式（幂等）。可由加载时判定或首次真实触摸调用。 */
  activate() {
    this.enabled = true;
    this._apply();
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
    document.addEventListener('contextmenu', block);
    document.addEventListener('dblclick', block);
    document.addEventListener('gesturestart', block);
    document.addEventListener('gesturechange', block);
  }

  _bindPointerInput() {
    this.lookZone.addEventListener('pointerdown', (event) => {
      // 触摸设备由 Touch Events 专门处理，避免现代浏览器双路径重复触发。
      if (this.useTouchEvents && (event.pointerType === 'touch' || event.pointerType === 'pen')) return;
      if (!this._isTouchPointer(event) || !this.isActive() || this.lookPointer !== null) return;
      this.lookPointer = event.pointerId;
      this.lookLast.x = event.clientX;
      this.lookLast.y = event.clientY;
      this.pointerRoles.set(event.pointerId, 'look');
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
      if (!this._isTouchPointer(event) || !this.isActive() || this.movePointer !== null) return;
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
        if (!this._isTouchPointer(event) || !this.isActive()) return;
        event.preventDefault();
        event.stopPropagation();
        this._capture(button, event.pointerId);
        this.pointerRoles.set(event.pointerId, 'button:' + action);
        button.classList.add('pressed');
        if (action === 'attack') this.attackPointers.set(event.pointerId, { x: event.clientX, y: event.clientY, dx: 0, dy: 0 });
        this.onAction(action, true, event.pointerId, { dx: 0, dy: 0, moved: false });
      });
      button.addEventListener('pointerup', (event) => this._release(event.pointerId));
      button.addEventListener('pointercancel', (event) => this._release(event.pointerId));
      button.addEventListener('lostpointercapture', (event) => this._release(event.pointerId));
      button.addEventListener('pointermove', (event) => {
        if (this.pointerRoles.get(event.pointerId) !== 'button:attack') return;
        const a = this.attackPointers.get(event.pointerId);
        if (!a) return;
        a.dx = event.clientX - a.x; a.dy = event.clientY - a.y;
        this.onAction('attack', true, event.pointerId, { dx: a.dx, dy: a.dy, moved: Math.hypot(a.dx, a.dy) > 18 });
        event.preventDefault();
      });
      button.addEventListener('contextmenu', (event) => event.preventDefault());
    });

    window.addEventListener('pointerup', (event) => this._release(event.pointerId));
    window.addEventListener('pointercancel', (event) => this._release(event.pointerId));
    window.addEventListener('pointermove', (event) => {
      if (this.pointerRoles.get(event.pointerId) !== 'button:attack') return;
      const a = this.attackPointers.get(event.pointerId); if (!a) return;
      a.dx = event.clientX - a.x; a.dy = event.clientY - a.y;
      this.onAction('attack', true, event.pointerId, { dx: a.dx, dy: a.dy, moved: Math.hypot(a.dx, a.dy) > 18 });
    });
  }

  _bindTouchInput() {
    // 捕获阶段的全局触摸：即便 UA/媒体查询误判，第一次触摸也立即启用触控。
    window.addEventListener('touchstart', (event) => {
      if (!this.enabled) this.activate();
    }, { passive: true, capture: true });

    const add = (element, type, handler) => {
      element.addEventListener(type, handler, { passive: false });
    };

    add(this.lookZone, 'touchstart', (event) => {
      if (!this.isActive()) return;
      for (const touch of event.changedTouches) {
        if (this.lookPointer !== null) continue;
        this.lookPointer = touch.identifier;
        this.lookLast.x = touch.clientX;
        this.lookLast.y = touch.clientY;
        this.pointerRoles.set(touch.identifier, 'look');
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
      if (!this.isActive()) return;
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
        if (!this.isActive()) return;
        for (const touch of event.changedTouches) {
          if (this.pointerRoles.has(touch.identifier)) continue;
          this.pointerRoles.set(touch.identifier, 'button:' + action);
          button.classList.add('pressed');
          if (action === 'attack') this.attackPointers.set(touch.identifier, { x: touch.clientX, y: touch.clientY, dx: 0, dy: 0 });
          this.onAction(action, true, touch.identifier, { dx: 0, dy: 0, moved: false });
        }
        event.preventDefault();
        event.stopPropagation();
      });
      add(button, 'touchmove', (event) => {
        for (const touch of event.changedTouches) {
          const role = this.pointerRoles.get(touch.identifier);
          if (role !== 'button:attack') continue;
          const a = this.attackPointers.get(touch.identifier);
          if (!a) continue;
          a.dx = touch.clientX - a.x; a.dy = touch.clientY - a.y;
          this.onAction('attack', true, touch.identifier, { dx: a.dx, dy: a.dy, moved: Math.hypot(a.dx, a.dy) > 18 });
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
          const a = this.attackPointers.get(touch.identifier);
          if (a) { a.dx = touch.clientX - a.x; a.dy = touch.clientY - a.y; }
        }
        this._release(touch.identifier);
      }
    };
    window.addEventListener('touchend', finishTouches, { passive: false });
    window.addEventListener('touchcancel', finishTouches, { passive: false });
  }

  _isTouchPointer(event) {
    const isTouch = event.pointerType === 'touch' || event.pointerType === 'pen';
    if (isTouch && !this.enabled) this.activate();
    return isTouch;
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
    const wantSprint = this.move.mag >= SPRINT_STICK_THRESHOLD;
    this.controller.touchSprint = wantSprint;
    this.joystick.classList.toggle('stick-sprint', wantSprint);
    this.stick.style.transform = 'translate(' + dx + 'px, ' + dy + 'px)';
    this.joystick.classList.add('active');
  }

  _release(pointerId) {
    const role = this.pointerRoles.get(pointerId);
    if (!role) return;
    this.pointerRoles.delete(pointerId);
    if (role === 'look' && this.lookPointer === pointerId) this.lookPointer = null;
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
      this.onAction(action, false, pointerId, a ? { dx: a.dx, dy: a.dy, moved: Math.hypot(a.dx, a.dy) > 18 } : { dx: 0, dy: 0, moved: false });
      this.attackPointers.delete(pointerId);
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
    if (this.joystick) this.joystick.classList.remove('active', 'stick-sprint');
    if (this.stick) this.stick.style.transform = 'translate(0, 0)';
    if (this.root) {
      const buttons = this.root.querySelectorAll('.pressed');
      for (const button of buttons) button.classList.remove('pressed');
    }
  }
}
