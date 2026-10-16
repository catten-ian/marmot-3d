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
