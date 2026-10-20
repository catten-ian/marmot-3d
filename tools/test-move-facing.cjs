const assert = require('node:assert/strict');

(async () => {
  const { resolveMoveIntent, dampAngle, classifyMoveFacing, thirdPersonStrafeTarget, firstPersonStrafeTarget, resolveAttackYaw } = await import('../src/core/move-facing.mjs');
  const yaw = 0;
  const angleError = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
  const direction = (mx, mz) => {
    const i = resolveMoveIntent(mx, mz, yaw);
    return { ...i, expectedYaw: Math.atan2(-i.moveX, -i.moveZ) };
  };

  const forward = direction(0, 1);
  assert.ok(angleError(forward.facingYaw, yaw) < 1e-9, 'forward keeps camera heading');

  const left = direction(-1, 0);
  assert.ok(left.moveX < 0 && angleError(left.facingYaw, left.expectedYaw) < 1e-9,
    'left-facing follows leftward movement');
  const right = direction(1, 0);
  assert.ok(right.moveX > 0 && angleError(right.facingYaw, right.expectedYaw) < 1e-9,
    'right-facing follows rightward movement');

  const back = direction(0, -1);
  assert.equal(back.isBackpedal, true);
  assert.ok(angleError(back.facingYaw, yaw) < 1e-9, 'backpedal keeps camera heading');
  assert.equal(back.speedScale, 0.58);
  assert.equal(Math.hypot(back.moveX * back.speedScale, back.moveZ * back.speedScale), 0.58);

  for (const [mx, mz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
    const intent = resolveMoveIntent(mx, mz, yaw);
    assert.ok(Math.hypot(intent.mx, intent.mz) <= 1 + 1e-12, 'diagonal input is normalized');
    assert.ok(Math.hypot(intent.moveX, intent.moveZ) <= 1 + 1e-12, 'diagonal speed is capped');
  }
  assert.equal(resolveMoveIntent(0.1, -1, yaw).isBackpedal, true, 'small lateral input remains backpedal');
  assert.equal(resolveMoveIntent(0.5, -1, yaw).isBackpedal, false, 'back-diagonal is not slowed');

  const acrossWrap = dampAngle(3.1, -3.1, 1 / 60, 10);
  assert.ok(acrossWrap > 3.1 && acrossWrap < Math.PI + 0.1, 'turn crosses wrap via shortest arc');
  let current = 0;
  const target = Math.PI / 2;
  let firstStep = 0;
  for (let frame = 0; frame < 60; frame++) {
    const next = dampAngle(current, target, 1 / 60, 10);
    if (frame === 0) firstStep = Math.abs(next - current);
    assert.ok(Math.abs(next - current) < 0.3, 'no per-frame heading snap');
    current = next;
  }
  assert.ok(firstStep > 0 && current > 1.5, 'smooth interpolation converges over frames');
  assert.equal(classifyMoveFacing(1, 0, true).followBody, true);
  assert.equal(classifyMoveFacing(1, 0, false).followBody, false);
  // 横向主导（手指推左右带一点纵向）仍算侧向转身：1 > 0.2*1.2
  assert.equal(classifyMoveFacing(1, 0.2, true).followBody, true);
  // 纵向主导时不当作侧向：1 不大于 0.9*1.2
  assert.equal(classifyMoveFacing(1, 0.9, true).followBody, false);
  const rightRun = thirdPersonStrafeTarget(1, 0);
  assert.ok(Math.abs(rightRun.targetYaw + Math.PI / 2) < 1e-9 && rightRun.moveX > .99 && Math.abs(rightRun.moveZ) < 1e-9);
  assert.ok(Math.abs(Math.hypot(rightRun.moveX, rightRun.moveZ) - 1) < 1e-9);

  // 第一人称：推右时“眼睛”目标 yaw 也朝右，与第三人称身体横移对称。
  const fpRight = firstPersonStrafeTarget(1, 0);
  assert.ok(Math.abs(fpRight.targetYaw + Math.PI / 2) < 1e-9, 'FP right turns view clockwise');
  assert.ok(fpRight.moveX > .99 && Math.abs(fpRight.moveZ) < 1e-9, 'FP right moves toward new facing');
  const fpLeft = firstPersonStrafeTarget(-1, 0);
  assert.ok(Math.abs(fpLeft.targetYaw - Math.PI / 2) < 1e-9, 'FP left turns view counter-clockwise');
  assert.equal(firstPersonStrafeTarget(0, 0), null, 'FP target null without lateral input');
  assert.ok(Math.abs(Math.hypot(fpLeft.moveX, fpLeft.moveZ) - 1) < 1e-9);

  // —— 攻击 yaw 来源：第三人称沿身体朝向，第一人称沿镜头（第一人称不回归） ——
  assert.equal(resolveAttackYaw({ thirdPerson: true, cameraYaw: 0.9, bodyYaw: -0.4 }), -0.4,
    'TP 攻击沿角色身体朝向而非相机 yaw');
  assert.equal(resolveAttackYaw({ thirdPerson: false, cameraYaw: 0.9, bodyYaw: -0.4 }), 0.9,
    'FP 攻击沿镜头朝向（保持现有正确行为）');
  assert.equal(resolveAttackYaw({ cameraYaw: 2.2, bodyYaw: 1.1 }), 2.2,
    '默认（缺省 thirdPerson）按第一人称处理');

  console.log('move-facing logic: all assertions passed');
})();
