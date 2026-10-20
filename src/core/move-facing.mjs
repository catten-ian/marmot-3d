// Pure movement-facing math shared by the controller and its Node logic tests.
export function resolveMoveIntent(mx, mz, yaw, backpedalSpeed = 0.58) {
  const length = Math.hypot(mx, mz);
  if (length < 1e-6) {
    return { mx: 0, mz: 0, moveX: 0, moveZ: 0, facingYaw: yaw, isBackpedal: false, speedScale: 1 };
  }

  const nx = mx / length;
  const nz = mz / length;
  const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
  const rx = Math.cos(yaw), rz = -Math.sin(yaw);
  const moveX = fx * nz + rx * nx;
  const moveZ = fz * nz + rz * nx;
  const isBackpedal = mz < 0 && Math.abs(mx) <= Math.abs(mz) * 0.35;

  return {
    mx: nx,
    mz: nz,
    moveX,
    moveZ,
    facingYaw: isBackpedal ? yaw : Math.atan2(-moveX, -moveZ),
    isBackpedal,
    speedScale: isBackpedal ? backpedalSpeed : 1,
  };
}

export function dampAngle(current, target, dt, rate) {
  const delta = Math.atan2(Math.sin(target - current), Math.cos(target - current));
  return current + delta * (1 - Math.exp(-rate * dt));
}

export function wrapAngle(a) {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

/**
 * Touch movement wheel contract:
 * x is steering, y is forward/back throttle. Horizontal input turns in place;
 * backward steering reverses; cameraYaw is returned for callers that keep the
 * right-hand look zone as a separate camera authority.
 */
export function resolveTouchDrive(input = {}) {
  const {
    bodyYaw = 0,
    cameraYaw = 0,
    x = 0,
    y = 0,
    dt = 0,
    turnRate = 2.7,
    backpedalSpeed = 0.58,
    deadzone = 0.14,
  } = input;

  const axis = (value) => {
    const n = Number(value) || 0;
    if (Math.abs(n) < deadzone) return 0;
    return Math.max(-1, Math.min(1, n));
  };
  const turnAxis = axis(x);
  const moveAxis = axis(y);
  const backpedal = moveAxis < 0;
  const turn = turnAxis === 0 ? 0 : -turnAxis * (backpedal ? -1 : 1);
  const nextYaw = wrapAngle(bodyYaw + turn * turnRate * dt);
  const throttle = Math.abs(moveAxis);
  const direction = moveAxis > 0 ? 1 : moveAxis < 0 ? -1 : 0;

  return {
    bodyYaw: nextYaw,
    turn,
    throttle,
    direction,
    backpedal,
    isBackpedal: backpedal,
    speedScale: backpedal ? backpedalSpeed : 1,
    cameraYaw,
  };
}
