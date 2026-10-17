const assert = require('node:assert/strict');

(async () => {
  const { resolveTouchDrive, wrapAngle } = await import('../src/core/move-facing.mjs');

  // 持续左推：每帧身体都应继续向左（逆时针，yaw 增大），且始终有油门 → 向左跑圈。
  let body = 0;
  const dt = 1 / 60;
  let prev = 0;
  let totalTurn = 0;
  for (let i = 0; i < 120; i++) {
    const r = resolveTouchDrive({ bodyYaw: body, cameraYaw: 0, x: -1, y: 0, dt, turnRate: 2.7, uTurnRate: 3.4 });
    body = r.bodyYaw;
    assert.ok(r.throttle >= 0.8, '持续左推始终有前进油门');
    if (i > 0) {
      const d = wrapAngle(body - prev);
      totalTurn += d;
      assert.ok(d > 0, `持续左推应持续左转 frame=${i} d=${d}`);
    }
    prev = body;
  }
  assert.ok(totalTurn > 5.0, `持续左推 2 秒应累计转一圈以上，got ${totalTurn}`);

  // 纯右推则 yaw 持续减小。
  let b2 = 0;
  for (let i = 0; i < 30; i++) {
    b2 = resolveTouchDrive({ bodyYaw: b2, cameraYaw: 0, x: 1, y: 0, dt, turnRate: 2.7, uTurnRate: 3.4 }).bodyYaw;
  }
  assert.ok(wrapAngle(b2) < 0, '持续右推应右转');

  // 无输入：油门 0，bodyYaw 不变。
  const idle = resolveTouchDrive({ bodyYaw: 0.5, cameraYaw: 0, x: 0, y: 0, dt, turnRate: 2.7, uTurnRate: 3.4 });
  assert.equal(idle.throttle, 0);
  assert.equal(idle.bodyYaw, 0.5);

  // 后拉 U-turn：从 yaw=0 平滑转到 π（镜头正后方），中途不跳变，最终附近结束。
  let b3 = 0;
  let uTurn = false;
  let maxStep = 0;
  for (let i = 0; i < 240; i++) {
    const before = b3;
    const r = resolveTouchDrive({ bodyYaw: b3, cameraYaw: 0, x: 0, y: -1, dt, turnRate: 2.7, uTurnRate: 3.4, uTurn });
    uTurn = r.uTurn;
    b3 = r.bodyYaw;
    maxStep = Math.max(maxStep, Math.abs(wrapAngle(b3 - before)));
    if (r.finishedTurn) break;
  }
  assert.ok(Math.abs(Math.abs(b3) - Math.PI) < 0.15, `U-turn 应转到镜头后方，got b3=${b3}`);
  assert.ok(maxStep < 0.2, `U-turn 不应突变，maxStep=${maxStep}`);

  console.log('touch-drive logic: all assertions passed');
})().catch((e) => { console.error(e); process.exit(1); });
