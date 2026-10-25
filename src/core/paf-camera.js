/**
 * 扮演藏狐模式（PAF）相机纯函数模块。
 *
 * 只含数学：不 import three、不碰 DOM，返回普通对象，便于 node:test 直接单测。
 * play-as-fox.js 负责把这里算出的位姿套到 THREE 相机上。
 *
 * 两种模式：
 *  - tps（默认）：第三人称追尾，沿用既有 camDist/camHeight/camPitch/camLookAhead 口径；
 *  - fpv：第一人称，眼位在狐狸头部高度，视线（look.yaw/pitch）与身体朝向（fox.yaw）解耦。
 */

export function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

/** 指数阻尼系数：与 THREE.MathUtils.damp 同式。 */
export function dampFactor(lambda, dt) { return 1 - Math.exp(-lambda * dt); }

export function damp(cur, target, lambda, dt) {
  return cur + (target - cur) * dampFactor(lambda, dt);
}

/** 角度收到 [-PI, PI]。 */
export function wrapAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

/** 视角模式状态机：'tps' ↔ 'fpv'，往返不携带任何残留。 */
export function createViewModeState(initial = 'tps') {
  let mode = initial === 'fpv' ? 'fpv' : 'tps';
  return {
    get mode() { return mode; },
    set(next) { mode = next === 'fpv' ? 'fpv' : 'tps'; return mode; },
    toggle() { mode = mode === 'fpv' ? 'tps' : 'fpv'; return mode; },
  };
}

/** 进入 FPV 时的初始视线：正对狐狸当前朝向，俯仰取默认下视角。 */
export function enterFpvLook(foxYaw, defaultPitchDeg = -6) {
  return { yaw: foxYaw, pitch: defaultPitchDeg * Math.PI / 180 };
}

/**
 * 施加一次视线增量（鼠标或触屏拖拽）。
 * yaw 自由环绕；pitch 夹紧在 [pitchMinDeg, pitchMaxDeg]。
 * 屏幕上移（dy<0）= 抬头。
 */
export function applyLookDelta(look, dx, dy, opts) {
  const { sensitivity = 0.0026, pitchMinDeg = -55, pitchMaxDeg = 40 } = opts || {};
  look.yaw = wrapAngle(look.yaw + dx * sensitivity);
  const min = pitchMinDeg * Math.PI / 180;
  const max = pitchMaxDeg * Math.PI / 180;
  look.pitch = clamp(look.pitch - dy * sensitivity, min, max);
  return look;
}

/**
 * 视线柔和回正（扑击期间把视线锁向扑击方向）：最短弧阻尼逼近，绝不瞬移。
 * 返回本帧视线 yaw 的增量（用于测试「无瞬移」）。
 */
export function dampLookToward(look, targetYaw, targetPitchDeg, lambda, dt) {
  const dyaw = wrapAngle(targetYaw - look.yaw);
  const step = dyaw * dampFactor(lambda, dt);
  look.yaw = wrapAngle(look.yaw + step);
  look.pitch = damp(look.pitch, targetPitchDeg * Math.PI / 180, lambda, dt);
  return step;
}

/** 第三人称追尾相机：返回相机目标位置与注视点（与世界坐标同系）。 */
export function tpsCameraPose(fox, cfg) {
  const fx = Math.sin(fox.yaw), fz = Math.cos(fox.yaw);
  return {
    pos: {
      x: fox.x - fx * cfg.camDist,
      y: fox.y + cfg.camHeight + cfg.camPitch * 1.4,
      z: fox.z - fz * cfg.camDist,
    },
    lookAt: {
      x: fox.x + fx * cfg.camLookAhead,
      y: fox.y + 0.9,
      z: fox.z + fz * cfg.camLookAhead,
    },
  };
}

/**
 * 第一人称相机：眼位 = 狐狸位置 + 眼高 + 沿视线的头部前移；
 * 朝向完全由 look（yaw/pitch）决定，与 fox.yaw（移动方向）解耦。
 * groundY 用于离地钳制，防止下坡/扑击落地瞬间相机穿地。
 */
export function fpvCameraPose(fox, look, cfg, groundY = -Infinity) {
  const cp = Math.cos(look.pitch), sp = Math.sin(look.pitch);
  const sy = Math.sin(look.yaw), cy = Math.cos(look.yaw);
  const pos = {
    x: fox.x + sy * cfg.fpvHeadForward,
    y: Math.max(fox.y + cfg.fpvEyeHeight, groundY + (cfg.camMinGround ?? 0.22)),
    z: fox.z + cy * cfg.fpvHeadForward,
  };
  const dir = { x: sy * cp, y: sp, z: cy * cp };
  return { pos, dir, lookAt: { x: pos.x + dir.x, y: pos.y + dir.y, z: pos.z + dir.z } };
}
