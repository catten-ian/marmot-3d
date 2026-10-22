const assert = require('node:assert/strict');

(async () => {
  const { resolveTouchDrive, wrapAngle } = await import('../src/core/move-facing.mjs');
  const dt = 1 / 60;
  const angleError = (a, b) => Math.abs(wrapAngle(a - b));

  // 第一人称纯横推只转向，不凭空给前进油门。
  let body = 0;
  const left = resolveTouchDrive({ bodyYaw: body, cameraYaw: 0, x: -1, y: 0, dt });
  assert.ok(left.bodyYaw > 0, '左推持续增加 yaw');
  assert.equal(left.throttle, 0, '纯横推不自动前进');
  assert.ok(Math.abs(left.moveX) < 1e-12);
  const right = resolveTouchDrive({ bodyYaw: 0, cameraYaw: 0, x: 1, y: 0, dt });
  assert.ok(right.bodyYaw < 0, '右推持续减少 yaw');
  assert.equal(right.throttle, 0);

  // 无输入：油门 0，bodyYaw 不变。
  const idle = resolveTouchDrive({ bodyYaw: 0.5, cameraYaw: 0, x: 0, y: 0, dt });
  assert.equal(idle.throttle, 0);
  assert.equal(idle.bodyYaw, 0.5);

  // 直向下是实际后退：方向不掉头，后退减速沿用 PLAYER.backpedalSpeed。
  const back = resolveTouchDrive({ bodyYaw: 0, cameraYaw: 0, x: 0, y: -1, dt, backpedalSpeed: 0.58 });
  assert.equal(back.throttle, -1);
  assert.equal(back.isBackpedal, true);
  assert.equal(back.speedScale, 0.58);
  assert.equal(back.uTurn, false, '默认无掉头手势');
  assert.ok(back.moveZ > 0.99 && Math.abs(back.moveX) < 1e-9, '朝向不变，沿后方移动');
  assert.equal(angleError(back.bodyYaw, 0), 0, '直向下不转头');

  // 右下斜推：同时右转和后退，保留带符号油门且不触发 U-turn。
  const rearRight = resolveTouchDrive({ bodyYaw: 0, cameraYaw: 0, x: 0.7, y: -0.7, dt, backpedalSpeed: 0.58 });
  assert.ok(rearRight.bodyYaw < 0, '斜后右推产生右转');
  assert.ok(rearRight.throttle < 0, '斜后右推仍为负油门');
  assert.equal(rearRight.isBackpedal, true);
  assert.equal(rearRight.speedScale, 0.58);
  assert.equal(rearRight.uTurn, false, '斜后推不触发掉头');
  assert.ok(rearRight.moveZ > 0 && rearRight.moveX < 0, '斜后右推沿转后朝向的后方形成弧线');
  assert.equal(rearRight.cameraYaw, 0, '摇杆纯函数不改相机 yaw');

  // 连续斜后推：每帧小幅持续转向，后退速度连续，不发生镜头掉头跳变。
  let yaw = 0;
  let maxStep = 0;
  for (let i = 0; i < 60; i++) {
    const prev = yaw;
    const r = resolveTouchDrive({ bodyYaw: yaw, cameraYaw: 0, x: 0.5, y: -0.7, dt });
    yaw = r.bodyYaw;
    maxStep = Math.max(maxStep, Math.abs(wrapAngle(yaw - prev)));
    assert.ok(r.throttle < 0 && r.uTurn === false);
  }
  assert.ok(yaw < 0, '持续右后推持续右转');
  assert.ok(maxStep < 0.1, `转向连续，无单帧掉头 maxStep=${maxStep}`);

  console.log('touch-drive logic: all assertions passed');
})().catch((e) => { console.error(e); process.exit(1); });
