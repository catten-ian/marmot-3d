/**
 * GS 版第一人称控制器。
 *
 * 与主版本（WebGL）的差异：
 *   · 主版本跑在贴地 0.46m 的土拨鼠视角，这个版本要"走进去"，
 *     所以视高给到 1.6m（人的视角），才看得清脚下的草和石头。
 *   · 支持跳跃与疾行，但**不需要**主版本那套姿态/呼吸/应激系统，
 *     这里只保留移动手感 —— 目的是展示场景，不是玩法。
 *   · 连续标量插值（1 - exp(-k·dt)），帧率无关。
 */

import * as THREE from 'three';

export class Walker {
  constructor(camera, canvas, { heightAt, bounds = {} }) {
    this.camera = camera;
    this.canvas = canvas;
    this.heightAt = heightAt;
    this.bounds = bounds;      // { minX, maxX, minZ, maxZ }
    this.rocks = [];

    this.yaw = 0;
    this.pitch = 0;
    this.pos = new THREE.Vector3(0, 0, 0);
    this.vel = new THREE.Vector3();
    this.vy = 0;
    this.grounded = true;

    this.eyeHeight = 1.6;
    this.crouch = 0;
    this.bobT = 0;
    this.bobAmp = 0;
    this.speed = 0;

    // 移动手感
    this.baseSpeed = 4.6;
    this.sprintMul = 1.85;
    this.accel = 22;
    this.friction = 12;
    this.jumpV = 5.0;
    this.gravity = 17;
    this.radius = 0.5;

    this.keys = new Set();
    this.locked = false;
    this.sensitivity = 0.0022;

    this._bind();
  }

  setRocks(list) { this.rocks = list || []; }

  /** 把玩家放到指定 XZ（自动贴到地面） */
  placeAt(x, z) {
    this.pos.x = x;
    this.pos.z = z;
    this.pos.y = this.heightAt(x, z);
    this.vel.set(0, 0, 0);
    this.vy = 0;
  }

  _bind() {
    const c = this.canvas;
    this._onMove = (e) => {
      if (!this.locked) return;
      this.yaw -= e.movementX * this.sensitivity;
      this.pitch -= e.movementY * this.sensitivity;
      const lim = Math.PI / 2 - 0.02;
      this.pitch = Math.max(-lim, Math.min(lim, this.pitch));
    };
    this._onKeyDown = (e) => {
      this.keys.add(e.code);
      if (e.code === 'Space') e.preventDefault();
    };
    this._onKeyUp = (e) => this.keys.delete(e.code);
    this._onLockChange = () => {
      this.locked = document.pointerLockElement === c;
      if (!this.locked) this.keys.clear();
    };

    document.addEventListener('mousemove', this._onMove);
    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    document.addEventListener('pointerlockchange', this._onLockChange);
  }

  requestLock() {
    const p = this.canvas.requestPointerLock?.();
    // Chrome 返回 Promise（未获用户手势时会 reject），失败也不影响自由观察
    if (p && typeof p.catch === 'function') p.catch(() => {});
  }

  /** 水平前后向量（不含 Y） */
  _forward(out) {
    out.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    return out;
  }

  update(dt) {
    const k = this.keys;
    const turn = Number(k.has('KeyA')) - Number(k.has('KeyD'));
    this.yaw += turn * 2.2 * dt;

    // —— 输入向量 ——
    const f = this._forward(new THREE.Vector3());
    const right = new THREE.Vector3(-f.z, 0, f.x);
    const wish = new THREE.Vector3();
    if (k.has('KeyW') || k.has('ArrowUp')) wish.add(f);
    if (k.has('KeyS') || k.has('ArrowDown')) wish.sub(f);
    if (k.has('ArrowRight')) wish.add(right);
    if (k.has('ArrowLeft')) wish.sub(right);
    const moving = wish.lengthSq() > 0;
    if (moving) wish.normalize();

    const sprinting = (k.has('ShiftLeft') || k.has('ShiftRight'));
    const target = this.baseSpeed * (sprinting ? this.sprintMul : 1) * (moving ? 1 : 0);

    // —— 加速 / 摩擦 ——
    // 用指数趋近而非直接赋值：手感顺滑，且与帧率无关
    const rate = moving ? this.accel : this.friction;
    this.vel.x += (wish.x * target - this.vel.x) * (1 - Math.exp(-rate * dt));
    this.vel.z += (wish.z * target - this.vel.z) * (1 - Math.exp(-rate * dt));

    // —— 跳跃与重力 ——
    if (k.has('Space') && this.grounded) {
      this.vy = this.jumpV;
      this.grounded = false;
    }
    this.vy -= this.gravity * dt;

    // —— 位移 ——
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;

    // 岩石碰撞：圆形推出（让石头真正成为障碍）
    for (const r of this.rocks) {
      const dx = this.pos.x - r.x, dz = this.pos.z - r.z;
      const need = r.r + this.radius;
      const d2 = dx * dx + dz * dz;
      if (d2 < need * need && d2 > 1e-6) {
        const d = Math.sqrt(d2);
        const push = (need - d) / d;
        this.pos.x += dx * push;
        this.pos.z += dz * push;
      }
    }

    // 边界
    const b = this.bounds;
    if (b.minX !== undefined) this.pos.x = Math.max(b.minX, Math.min(b.maxX, this.pos.x));
    if (b.minZ !== undefined) this.pos.z = Math.max(b.minZ, Math.min(b.maxZ, this.pos.z));

    // 竖直：先跟地形，再叠跳跃
    const ground = this.heightAt(this.pos.x, this.pos.z);
    this.pos.y += this.vy * dt;
    if (this.pos.y <= ground) {
      this.pos.y = ground;
      this.vy = 0;
      this.grounded = true;
    } else {
      this.grounded = false;
    }

    // —— 视高与步伐晃动 ——
    const crouchTarget = k.has('KeyC') || k.has('ControlLeft') ? 1 : 0;
    this.crouch += (crouchTarget - this.crouch) * (1 - Math.exp(-11 * dt));

    this.speed = Math.hypot(this.vel.x, this.vel.z);
    const moving2 = this.speed > 0.4;
    // 上下起伏 + 左右摇摆，只在地面移动时叠加
    const targetAmp = moving2 && this.grounded ? Math.min(1, this.speed / this.baseSpeed) * 0.055 : 0;
    this.bobAmp += (targetAmp - this.bobAmp) * (1 - Math.exp(-9 * dt));
    this.bobT += dt * this.speed * 1.15;

    const eye = this.eyeHeight - this.crouch * 0.75;
    this.camera.position.set(
      this.pos.x + Math.cos(this.bobT) * this.bobAmp * 0.5,
      this.pos.y + eye + Math.sin(this.bobT * 2) * this.bobAmp,
      this.pos.z,
    );
    this.camera.rotation.set(0, 0, 0, 'YXZ');
    this.camera.rotation.y = this.yaw;
    this.camera.rotation.x = this.pitch;
    this.camera.rotation.z = Math.cos(this.bobT) * this.bobAmp * 0.12;
  }

  /** 是否在移动（供 viewmodel / 动画判断） */
  get moving() { return this.speed > 0.4; }

  dispose() {
    document.removeEventListener('mousemove', this._onMove);
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
    document.removeEventListener('pointerlockchange', this._onLockChange);
  }
}
