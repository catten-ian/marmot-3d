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

export function classifyMoveFacing(mx, mz, thirdPerson = false) {
  // 手指推“左右”几乎总会带一点前后分量，不能要求前后严格为 0；
  // 只要横向明显主导（约 1.2 倍）就按侧向移动处理。
  const lateralOnly = Math.abs(mx) > 1e-6 && Math.abs(mx) > Math.abs(mz) * 1.2;
  return { lateralOnly, followBody: !!thirdPerson && lateralOnly };
}

export function thirdPersonStrafeTarget(mx, yaw) {
  if (Math.abs(mx) < 1e-6) return null;
  const targetYaw = yaw - Math.sign(mx) * Math.PI / 2;
  return { targetYaw, moveX: -Math.sin(targetYaw), moveZ: -Math.cos(targetYaw) };
}

// 第一人称：镜头即土拨鼠的眼睛。左右输入应让“眼睛/视角”转向该侧，
// 身体随之朝新朝向跑。转头量随摇杆横向幅度缩放：轻推轻转、满杆约 90°，
// 比“非 0 即 90°”更像自然转头，也更容易感知到视角在动。
export function firstPersonStrafeTarget(mx, yaw) {
  if (Math.abs(mx) < 1e-6) return null;
  const amount = Math.min(1, Math.abs(mx));
  const targetYaw = yaw - Math.sign(mx) * (Math.PI / 2) * amount;
  return { targetYaw, moveX: -Math.sin(targetYaw), moveZ: -Math.cos(targetYaw) };
}
