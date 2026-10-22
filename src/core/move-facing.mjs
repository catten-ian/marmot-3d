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

/** Resolve keyboard movement and optional steering independently, then combine them. */
export function resolveKeyboardDrive(keys, moveMap, turnMap, yaw, turnRate, dt, backpedalSpeed = 0.58) {
  const down = (code) => !!code && keys.has(code);
  const turn = Number(down(turnMap?.left) || down(turnMap?.leftAlt))
    - Number(down(turnMap?.right) || down(turnMap?.rightAlt));
  const nextYaw = yaw + turn * turnRate * dt;
  let mx = 0, mz = 0;
  if (down(moveMap?.forward) || down(moveMap?.forwardAlt)) mz += 1;
  if (down(moveMap?.back) || down(moveMap?.backAlt)) mz -= 1;
  if (down(moveMap?.left) || down(moveMap?.leftAlt)) mx -= 1;
  if (down(moveMap?.right) || down(moveMap?.rightAlt)) mx += 1;
  const turnActive = down(turnMap?.left) || down(turnMap?.leftAlt)
    || down(turnMap?.right) || down(turnMap?.rightAlt);
  return {
    yaw: nextYaw, mx, mz, turn, turnActive,
    intent: resolveMoveIntent(mx, mz, nextYaw, backpedalSpeed),
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
 * 触屏摇杆的第一人称“转向 + 油门”模型，以及不写镜头的第三人称方向跑动。
 * 第一人称：x 连续控制角速度，y 是带符号的前进/后退速度；两者同帧叠加，
 * 后退只反转移动向量并乘 backpedalSpeed，不掉头。
 * 第三人称：保留现有屏幕方向跑动语义，cameraYaw 只读不写。
 */
export function resolveTouchDrive(input) {
  const {
    bodyYaw, cameraYaw, x, y, dt,
    turnRate = 2.7,
    backpedalSpeed = 0.58,
    thirdPerson = false,
  } = input;
  const dead = 0.14;
  const rawMag = Math.hypot(x, y);
  if (rawMag < dead) {
    return {
      bodyYaw, throttle: 0, moveX: 0, moveZ: 0, isBackpedal: false,
      speedScale: 1, uTurn: false, finishedTurn: false, cameraYaw,
    };
  }

  // 与摇杆触控层一致：输入半径最多为 1，斜向总幅度不超过满杆。
  const axisScale = rawMag > 1 ? 1 / rawMag : 1;
  const sx = x * axisScale;
  const sy = y * axisScale;
  const mag = Math.min(1, rawMag);

  if (thirdPerson) {
    // 屏幕向量(x,y)按当前相机 yaw 旋转成世界方向；镜头由 lookZone 单独负责。
    const wx = Math.cos(cameraYaw) * sx - Math.sin(cameraYaw) * sy;
    const wz = -Math.sin(cameraYaw) * sx - Math.cos(cameraYaw) * sy;
    const nextYaw = Math.atan2(-wx, -wz);
    return {
      bodyYaw: wrapAngle(nextYaw), throttle: mag,
      moveX: -Math.sin(nextYaw) * mag, moveZ: -Math.cos(nextYaw) * mag,
      isBackpedal: false, speedScale: 1, uTurn: false, finishedTurn: false, cameraYaw,
    };
  }

  const nextYaw = wrapAngle(bodyYaw - sx * turnRate * dt);
  const throttle = sy;
  const isBackpedal = throttle < 0;
  const speedScale = isBackpedal ? backpedalSpeed : 1;
  return {
    bodyYaw: nextYaw, throttle,
    moveX: -Math.sin(nextYaw) * throttle,
    moveZ: -Math.cos(nextYaw) * throttle,
    isBackpedal, speedScale, uTurn: false, finishedTurn: false, cameraYaw,
  };
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

/**
 * 攻击朝向来源（纯函数）：
 *   第三人称：攻击沿角色身体朝向/移动朝向发起 → bodyYaw；
 *   第一人称：镜头即眼睛，攻击沿视线 → cameraYaw（保持现有正确行为）。
 */
export function resolveAttackYaw({ thirdPerson = false, cameraYaw = 0, bodyYaw = 0 } = {}) {
  return thirdPerson ? bodyYaw : cameraYaw;
}
