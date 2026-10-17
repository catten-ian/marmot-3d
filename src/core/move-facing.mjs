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
 * 触屏跑动模型：摇杆是“油门 + 连续转向”，不是瞬时方向平移。
 *
 * - 左右按住：bodyYaw 每帧持续朝该侧旋转，同时仍向前跑，所以持续左推会跑圈；
 * - 前推/斜推：沿当前身体朝向给油门，横向分量负责弧线；
 * - 后拉：平滑 U-turn 到镜头后方，掉头后继续向前跑（没有后退步）。
 *
 * cameraYaw 与 bodyYaw 分离：第三人称移动只转 bodyYaw，不转镜头。
 */
export function resolveTouchDrive(input) {
  const {
    bodyYaw, cameraYaw, x, y, dt,
    turnRate = 2.7,
    uTurnRate = 3.4,
    uTurn = false,
  } = input;
  const dead = 0.14;
  const ax = Math.abs(x);
  const ay = Math.abs(y);
  const mag = Math.hypot(x, y);
  if (mag < dead) return { bodyYaw, throttle: 0, uTurn: false, finishedTurn: false };

  let nextYaw = bodyYaw;
  let throttle = Math.min(1, mag);
  let finishedTurn = false;
  let nextUTurn = uTurn;

  if (y < -0.35) {
    // 后拉：以镜头正后方为目标做一次平滑掉头；掉正后自动退出。
    nextUTurn = true;
    const target = cameraYaw + Math.PI;
    const before = Math.abs(wrapAngle(target - nextYaw));
    nextYaw = dampAngle(nextYaw, target, dt, uTurnRate);
    const after = Math.abs(wrapAngle(target - nextYaw));
    finishedTurn = after < 0.08 || after > before;
    if (finishedTurn) nextUTurn = false;
    throttle = Math.max(0.25, -y);
  } else {
    nextUTurn = false;
    // 纯横推也要给基础油门：这样“一直向左”=边向前跑边持续左转=画圈。
    const forwardThrottle = y > 0 ? y : ax * 0.82;
    throttle = Math.max(0.2, Math.min(1, Math.hypot(Math.max(0, y), x * 0.82), forwardThrottle));
    if (ax > dead) {
      nextYaw -= x * turnRate * dt;
    }
    // 前推时如果身体和镜头朝向偏离很大（例如刚 U-turn / 转了圈），柔和回到镜头前方。
    if (y > 0.35 && ax < 0.45) {
      nextYaw = dampAngle(nextYaw, cameraYaw, dt, 1.15 * Math.max(0.15, y));
    }
  }

  return { bodyYaw: wrapAngle(nextYaw), throttle, uTurn: nextUTurn, finishedTurn };
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
