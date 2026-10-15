/**
 * 第一人称控制器（PointerLock）。
 * 土拨鼠视角：视高仅 0.46m，贴地。需要处理
 *   - 鼠标视角（灵敏度可调）
 *   - 地形跟随 + 岩石碰撞
 *   - 跑动头部摆动、攻击前冲、受击镜头冲击
 *   - 蹲伏（在洞口的低姿态）
 */
import * as THREE from 'three';
import { PLAYER, ROCKS, DEFAULT_MOVE_MAP, moveBounds, scalePoint, scaleRadius } from '../core/config.js';
import { terrainHeight, clamp } from '../core/utils.js';

export class FirstPersonController {
  constructor(camera, domElement) {
    this.camera = camera;
    this.dom = domElement;

    this.position = new THREE.Vector3(0, 0, 0);
    this.velocity = new THREE.Vector3();
    this.externalVelocity = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this.sensitivity = 0.0022;
    this.touchLookSensitivity = 0.006;
    this.touchAxes = { x: 0, y: 0 };
    this.touchSprint = false;
    this.touchEnabled = false;

    this.onGroundY = 0;
    this.bobPhase = 0;
    this.bobAmount = 0;
    // 姿态：0 = 站立，1 = 俯伏。始终连续插值，支持中途反向
    this.crouch = 0;
    this.postureSpeed = 0;
    this.baseFov = camera.fov;
    // 垂直运动
    this.vy = 0;
    this.grounded = true;
    this.jumpCD = 0;
    this.airHeight = 0;
    this.kickZ = 0; // 攻击前冲
    this.kickPitch = 0;
    this.shake = 0;
    this.shakeDecay = 6;
    this.locked = false;
    this.thirdPerson = false;
    this.cameraDistance = 3.6;
    this.cameraHeight = 1.9;
    this.cameraLookDown = -0.38;

    this._forward = new THREE.Vector3();
    this._right = new THREE.Vector3();

    this._bindEvents();
  }

  _bindEvents() {
    const onMouseMove = (e) => {
      if (!this.locked) return;
      this.yaw -= e.movementX * this.sensitivity;
      this.pitch -= e.movementY * this.sensitivity;
      this.pitch = clamp(this.pitch, -1.15, 1.05);
    };
    document.addEventListener('mousemove', onMouseMove);

    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.dom;
      if (!this.locked) this.keys && this.keys.clear();
      this.onLockChange && this.onLockChange(this.locked);
    });

    this._dispose = () => document.removeEventListener('mousemove', onMouseMove);
  }

  requestLock() {
    // Touch screens use the explicit look zone instead of Pointer Lock. Calling
    // requestPointerLock from a touch gesture is rejected by mobile browsers
    // and can steal the gesture from the game buttons.
    if (this.touchEnabled) return Promise.resolve(false);
    if (!this.dom.requestPointerLock) return Promise.resolve(false);
    // Chrome 返回 Promise，可能因 Esc 退出锁后的短暂冷却 / 手势时机被拒。
    // 把结果交给调用方，便于在恢复游戏失败时提示"点击画面继续"。
    const p = this.dom.requestPointerLock();
    if (p && p.then) {
      return p.then(() => true).catch(() => false);
    }
    return Promise.resolve(true);
  }

  exitLock() {
    if (document.exitPointerLock && document.pointerLockElement === this.dom) {
      document.exitPointerLock();
    }
  }

  setThirdPerson(enabled) {
    this.thirdPerson = !!enabled;
    this.camera.fov = this.baseFov;
    this.camera.updateProjectionMatrix();
  }

  /** 攻击时的镜头前冲 */
  attackKick(power = 1) {
    this.kickZ = 0.16 * power;
    this.kickPitch = -0.07 * power;
  }

  /** 受击镜头冲击与水平击退冲量 */
  hitShake(strength = 1, impulseX = 0, impulseZ = 0) {
    this.shake = Math.min(1.4, this.shake + strength);
    this.externalVelocity.x = clamp(this.externalVelocity.x + impulseX, -8, 8);
    this.externalVelocity.z = clamp(this.externalVelocity.z + impulseZ, -8, 8);
  }

  /** 突进/爆发时的推进感 */
  dashForward(power = 1) {
    this.kickZ = 0.5 * power;
  }

  teleport(x, z, yaw = 0) {
    this.position.set(x, terrainHeight(x, z), z);
    this.yaw = yaw;
    this.pitch = 0;
    this.velocity.set(0, 0, 0);
    this.externalVelocity.set(0, 0, 0);
    this.bobPhase = 0;
    this.kickZ = 0;
    this.shake = 0;
    // 重置姿态与视野，避免跨关卡残留俯伏状态
    this.crouch = 0;
    this.bobAmount = 0;
    // 重置垂直状态，避免传送后仍在空中或卡在地下
    this.vy = 0;
    this.grounded = true;
    this.jumpCD = 0;
    this.airHeight = 0;
    if (this.camera.fov !== this.baseFov) {
      this.camera.fov = this.baseFov;
      this.camera.updateProjectionMatrix();
    }
  }

  /**
   * 跳跃。返回是否成功起跳。
   * 土拨鼠是挖掘动物，跳跃能力有限 —— 给一个短促的小跳，
   * 主要用途是躲过突进中的藏狐接触判定，而不是跨越地形。
   */
  jump() {
    const J = PLAYER.jump;
    // 地面才能起跳；滞空时间短，避免连续刷跳
    if (!this.grounded || this.jumpCD > 0) return false;
    // 起跳前先把 y 吸附到当前地面高度：否则在斜坡上位置还滞后于地形，
    // 会导致起跳基准偏低（滞空高度被"吃掉"一部分）。
    this.position.y = terrainHeight(this.position.x, this.position.z);
    this.vy = J.velocity;
    this.grounded = false;
    this.jumpCD = J.cooldown;
    return true;
  }

  /**
   * @param keys Set<string> 键盘状态（由键位方案解析而来）
   * @param speedMul 战斗系统给出的速度倍率
   */
  update(
    dt,
    keys,
    speedMul = 1,
    moveMap = DEFAULT_MOVE_MAP,
    windAccelX = 0,
    turnMap = null,
  ) {
    const base = PLAYER.speed * speedMul;
    if (turnMap) {
      const turn = Number(keys.has(turnMap.left)) - Number(keys.has(turnMap.right));
      this.yaw += turn * 2.2 * dt;
    }
    let mx = 0, mz = 0;
    // 通过键位方案查表取移动键，而不是硬编码 KeyW
    if (keys.has(moveMap.forward) || keys.has(moveMap.forwardAlt)) mz += 1;
    if (keys.has(moveMap.back) || keys.has(moveMap.backAlt)) mz -= 1;
    if (keys.has(moveMap.left) || keys.has(moveMap.leftAlt)) mx -= 1;
    if (keys.has(moveMap.right) || keys.has(moveMap.rightAlt)) mx += 1;
    // Touch joystick axes share the same acceleration/collision path as WASD.
    // The combined vector is normalized below, so mixing keyboard and touch
    // never increases movement speed beyond the existing diagonal cap.
    mx += this.touchAxes.x;
    mz += this.touchAxes.y;

    // 外力（阵风、受击）以速度积分；与玩家输入分开，仍共用后续碰撞处理。
    this.externalVelocity.x = clamp(
      this.externalVelocity.x + windAccelX * dt, -4.5, 4.5,
    );
    if (Math.abs(this.externalVelocity.x) + Math.abs(this.externalVelocity.z) > 1e-4) {
      const drag = Math.exp(-3.2 * dt);
      this.externalVelocity.x *= drag;
      this.externalVelocity.z *= drag;
    }

    const moving = mx !== 0 || mz !== 0;
    if (moving) {
      const len = Math.hypot(mx, mz);
      mx /= len; mz /= len;
      // 前向 = yaw 方向
      const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
      const rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);
      const targetVx = (fx * mz + rx * mx) * base;
      const targetVz = (fz * mz + rz * mx) * base;
      // 平滑加速，手感更稳
      const accel = 1 - Math.exp(-14 * dt);
      this.velocity.x += (targetVx - this.velocity.x) * accel;
      this.velocity.z += (targetVz - this.velocity.z) * accel;
    } else {
      const decel = 1 - Math.exp(-18 * dt);
      this.velocity.x -= this.velocity.x * decel;
      this.velocity.z -= this.velocity.z * decel;
    }

    const prevX = this.position.x, prevZ = this.position.z;
    this.position.x += (this.velocity.x + this.externalVelocity.x) * dt;
    this.position.z += (this.velocity.z + this.externalVelocity.z) * dt;

    // 场地边界（GS 版按缩放后的活动场取，稳定版与历史值一致）
    const { hw, hh } = moveBounds();
    this.position.x = clamp(this.position.x, -hw, hw);
    this.position.z = clamp(this.position.z, -hh, hh);

    // 岩石碰撞：沿法线推出。
    // ROCKS 是设计坐标，GS 版必须缩放到运行时位置/半径，
    // 否则视觉上缩小的岩石仍按原位大半径碰撞（隐形墙）。
    for (const rp of ROCKS) {
      const [rx, rz] = scalePoint(rp);
      const rr = scaleRadius(rp[2]);
      const dx = this.position.x - rx, dz = this.position.z - rz;
      const minD = rr + PLAYER.radius;
      const d = Math.hypot(dx, dz);
      if (d < minD && d > 0.0001) {
        const push = (minD - d);
        this.position.x += (dx / d) * push;
        this.position.z += (dz / d) * push;
        // 撞墙时衰减速度，避免贴墙抖动
        const dot = ((this.velocity.x * dx) + (this.velocity.z * dz)) / d;
        if (dot < 0) {
          this.velocity.x -= (dx / d) * dot;
          this.velocity.z -= (dz / d) * dot;
        }
        const externalDot = ((this.externalVelocity.x * dx) + (this.externalVelocity.z * dz)) / d;
        if (externalDot < 0) {
          this.externalVelocity.x -= (dx / d) * externalDot;
          this.externalVelocity.z -= (dz / d) * externalDot;
        }
      }
    }

    const actualMoved = Math.hypot(this.position.x - prevX, this.position.z - prevZ);
    this.movingThisFrame = actualMoved > 0.0015;

    // 地形跟随
    const groundY = terrainHeight(this.position.x, this.position.z);
    this.onGroundY = groundY;

    // ---- 垂直运动（跳跃 / 重力）----
    const J = PLAYER.jump;
    this.jumpCD = Math.max(0, this.jumpCD - dt);
    if (!this.grounded) {
      this.vy -= J.gravity * dt;
      this.position.y += this.vy * dt;
      // 落到地面：钳位并清零竖直速度，避免反复触发落地
      if (this.position.y <= groundY) {
        this.position.y = groundY;
        this.vy = 0;
        this.grounded = true;
      }
    } else {
      // 地面状态：跟随地形起伏。
      // 上坡时留一点滞后（不瞬移，避免视觉抖动），下坡时立即贴地
      // （否则会出现"悬空"一小段）。
      const diff = groundY - this.position.y;
      if (diff < 0) this.position.y = groundY;
      else this.position.y += diff * (1 - Math.exp(-18 * dt));
      this.vy = 0;
    }
    // 腾空高度（供玩法判断：能否躲开接触伤害）
    this.airHeight = Math.max(0, this.position.y - groundY);

    // 头部摆动：跑动越快摆动越大
    const speedRatio = clamp(actualMoved / dt / PLAYER.speed, 0, 1.4);
    this.bobAmount += (speedRatio - this.bobAmount) * (1 - Math.exp(-8 * dt));
    this.bobPhase += dt * (7 + speedRatio * 5);

    this._updatePosture(dt, speedRatio);

    // 攻击前冲衰减
    this.kickZ -= this.kickZ * (1 - Math.exp(-11 * dt));
    this.kickPitch -= this.kickPitch * (1 - Math.exp(-11 * dt));

    // 受击抖动衰减
    if (this.shake > 0) this.shake = Math.max(0, this.shake - dt * this.shakeDecay);

    // 应用到相机。注意用 this.position.y（含跳跃高度）而非地面高度，
    // 否则起跳瞬间相机会"粘"在地面上。
    this._applyCamera(this.position.y, speedRatio);
  }

  /**
   * 姿态：静止站立 ↔ 奔跑下伏（贴地冲刺姿态）。
   *
   * 关键点是**必须在"站起到一半"时能立刻反向趴下，且不能跳变**。
   * 实现方式：
   *   1. crouch 是一个 0→1 的连续标量，始终从当前值朝目标值做指数插值，
   *      而不是直接赋值 —— 所以任何时刻切换方向都是连续的。
   *   2. 起卧用不同速率（下伏快、起身慢），符合生物起身比趴下更费力的直觉。
   *   3. 速率用指数插值 (1 - exp(-k*dt))，与帧率无关，且 dt 抖动时也稳定。
   */
  _updatePosture(dt, speedRatio) {
    const P = PLAYER.posture;
    // 速度超过阈值即视为在奔跑
    const target = speedRatio > P.speedThreshold ? 1 : 0;

    // 非对称速率：趴下利落，起身稍缓
    const rate = target > this.crouch ? P.crouchRate : P.standRate;
    // 指数插值，保证中途反向切换连续且与帧率无关
    this.crouch += (target - this.crouch) * (1 - Math.exp(-rate * dt));

    // 极接近目标时吸附，避免留下永不归零的微小残值
    if (Math.abs(target - this.crouch) < 0.001) this.crouch = target;

    this.postureSpeed = speedRatio;
  }

  _applyCamera(groundY, speedRatio) {
    const P = PLAYER.posture;
    const c = this.crouch;

    // 姿态对相机的影响，全部乘以 c —— 保证中途反向时整体线性连续
    // 趴下：视高降低、俯仰下压、视野收窄（冲刺时专注前方）
    const eyeH = PLAYER.eyeHeight - P.eyeDrop * c;
    const pitchBias = -P.pitchDrop * c;
    const fovNow = this.baseFov - (this.thirdPerson ? 0 : P.fovNarrow * c);
    if (Math.abs(this.camera.fov - fovNow) > 0.01) {
      this.camera.fov = fovNow;
      this.camera.updateProjectionMatrix();
    }

    // 俯伏时头部摆动幅度更大（贴地冲刺的颠簸感更强）
    const bobScale = 1 + P.bobBoost * c;
    const bobY = Math.sin(this.bobPhase) * 0.035 * this.bobAmount * bobScale;
    const bobX = Math.cos(this.bobPhase * 0.5) * 0.028 * this.bobAmount;
    const shakeX = this.shake > 0 ? (Math.random() - 0.5) * this.shake * 0.12 : 0;
    const shakeY = this.shake > 0 ? (Math.random() - 0.5) * this.shake * 0.12 : 0;

    // 前冲：沿视线方向推近
    const fwdX = -Math.sin(this.yaw), fwdZ = -Math.cos(this.yaw);
    const kickDist = this.kickZ;

    const rollBob = Math.cos(this.bobPhase * 0.5) * 0.012 * this.bobAmount;
    const cameraPitch = this.pitch + this.kickPitch + (this.thirdPerson ? this.cameraLookDown : pitchBias);
    this.camera.rotation.set(0, 0, 0);
    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.y = this.yaw + (this.thirdPerson ? 0 : bobX * 0.12);
    this.camera.rotation.x = cameraPitch;
    this.camera.rotation.z = this.thirdPerson ? 0
      : rollBob + (this.shake > 0 ? (Math.random() - 0.5) * this.shake * 0.06 : 0);

    if (this.thirdPerson) {
      const horizontalDistance = Math.cos(cameraPitch) * this.cameraDistance;
      this.camera.position.set(
        this.position.x + Math.sin(this.yaw) * horizontalDistance + shakeX * 0.3,
        groundY + this.cameraHeight + shakeY * 0.3,
        this.position.z + Math.cos(this.yaw) * horizontalDistance,
      );
    } else {
      this.camera.position.set(
        this.position.x + fwdX * kickDist + shakeX,
        groundY + eyeH + bobY + shakeY,
        this.position.z + fwdZ * kickDist,
      );
    }
  }

  /** 视线方向单位向量（水平投影，用于扇形攻击判定） */
  forwardFlat(out = new THREE.Vector3()) {
    out.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    return out;
  }

  dispose() {
    this._dispose && this._dispose();
  }
}