import { isTouchPrimary } from './performance.js?v=m20261016c';

/** Touch-first input layer. It is only enabled when touch is the primary input. */
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
    this.move = { x: 0, y: 0 };
    this.maxStick = 48;
    this.enabled = isTouchPrimary();

    // 元素缺失则无法工作。
    if (!root || !lookZone || !joystick || !stick) return;
    // 始终绑定指针监听：它们只响应真实 touch/pen 指针，桌面鼠标不会触发。
    // 这样即使内置浏览器(微信/QQ X5)谎报 pointer:fine，用户第一次触摸也能即时激活。
    this._bind();
    if (this.enabled) this.activate();
  }

  /** 激活触控模式（幂等）。可由加载时判定或首次真实触摸调用。 */
  activate() {
    if (this.enabled) return;
    this.enabled = true;
    document.body.classList.add('touch-mode');
    this.controller.touchEnabled = true;
    this.controller.touchAxes = this.move;
    // 触控设备不需要鼠标指针锁定；若此前尝试过锁定则退出，避免抢焦/误暂停。
    if (document.pointerLockElement) { try { document.exitPointerLock(); } catch (_) {} }
  }

  _bind() {
    this.lookZone.addEventListener('pointerdown', (event) => {
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
      if (this.pointerRoles.get(event.pointerId) !== 'look') return;
      const dx = event.clientX - this.lookLast.x;
      const dy = event.clientY - this.lookLast.y;
      this.lookLast.x = event.clientX;
      this.lookLast.y = event.clientY;
      this.controller.yaw -= dx * this.controller.touchLookSensitivity;
      this.controller.pitch = Math.max(-1.15, Math.min(1.05,
        this.controller.pitch - dy * this.controller.touchLookSensitivity));
      event.preventDefault();
    });
    for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) {
      this.lookZone.addEventListener(name, (event) => this._release(event.pointerId));
    }

    this.joystick.addEventListener('pointerdown', (event) => {
      if (!this._isTouchPointer(event) || !this.isActive() || this.movePointer !== null) return;
      this.movePointer = event.pointerId;
      this.pointerRoles.set(event.pointerId, 'move');
      this._capture(this.joystick, event.pointerId);
      this._updateJoystick(event);
      event.preventDefault();
      event.stopPropagation();
    });
    this.joystick.addEventListener('pointermove', (event) => {
      if (this.pointerRoles.get(event.pointerId) !== 'move') return;
      this._updateJoystick(event);
      event.preventDefault();
      event.stopPropagation();
    });
    for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) {
      this.joystick.addEventListener(name, (event) => this._release(event.pointerId));
    }

    this.root.querySelectorAll('[data-touch-action]').forEach((button) => {
      const action = button.dataset.touchAction;
      button.addEventListener('pointerdown', (event) => {
        if (!this._isTouchPointer(event) || !this.isActive()) return;
        event.preventDefault();
        event.stopPropagation();
        this._capture(button, event.pointerId);
        this.pointerRoles.set(event.pointerId, `button:${action}`);
        button.classList.add('pressed');
        this.onAction(action, true, event.pointerId);
      });
      button.addEventListener('pointerup', (event) => this._release(event.pointerId));
      button.addEventListener('pointercancel', (event) => this._release(event.pointerId));
      button.addEventListener('lostpointercapture', (event) => this._release(event.pointerId));
      button.addEventListener('contextmenu', (event) => event.preventDefault());
    });

    // Pointer capture normally routes the terminal event back to the control,
    // but a browser may cancel capture during rotation/app switching. Keep a
    // window-level safety net so no stale joystick/button state survives.
    window.addEventListener('pointerup', (event) => this._release(event.pointerId));
    window.addEventListener('pointercancel', (event) => this._release(event.pointerId));
    window.addEventListener('blur', () => this.releaseAll());
    window.addEventListener('pagehide', () => this.releaseAll());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.releaseAll();
    });
  }

  _isTouchPointer(event) {
    const isTouch = event.pointerType === 'touch' || event.pointerType === 'pen';
    if (isTouch && !this.enabled) this.activate();
    return isTouch;
  }

  _capture(element, pointerId) {
    try { element.setPointerCapture?.(pointerId); } catch (_) { /* synthetic events / Safari may reject */ }
  }

  _updateJoystick(event) {
    const rect = this.joystick.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    let dx = event.clientX - cx;
    let dy = event.clientY - cy;
    const length = Math.hypot(dx, dy);
    if (length > this.maxStick) {
      dx *= this.maxStick / length;
      dy *= this.maxStick / length;
    }
    let x = dx / this.maxStick;
    let y = -dy / this.maxStick;
    const magnitude = Math.hypot(x, y);
    // Small dead zone prevents drift from a resting thumb.
    if (magnitude < 0.14) { x = 0; y = 0; }
    else if (magnitude > 1) { x /= magnitude; y /= magnitude; }
    this.move.x = x;
    this.move.y = y;
    this.stick.style.transform = `translate(${dx}px, ${dy}px)`;
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
      this.stick.style.transform = 'translate(0, 0)';
      this.joystick.classList.remove('active');
    }
    if (role.startsWith('button:')) {
      const action = role.slice(7);
      this.onAction(action, false, pointerId);
      this.root.querySelector(`[data-touch-action="${action}"]`)?.classList.remove('pressed');
    }
  }

  releaseAll() {
    for (const pointerId of [...this.pointerRoles.keys()]) this._release(pointerId);
    this.move.x = 0;
    this.move.y = 0;
    this.joystick?.classList.remove('active');
    if (this.stick) this.stick.style.transform = 'translate(0, 0)';
    this.root?.querySelectorAll('.pressed').forEach((button) => button.classList.remove('pressed'));
  }
}
