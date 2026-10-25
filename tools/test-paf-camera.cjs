/**
 * PAF 相机纯函数契约测试（第一人称/第三人称视角）。
 * 覆盖：眼位高度、pitch 夹紧、视线与身体朝向解耦、视角切换往返无残留、
 * 扑击视线锁定无瞬移、TPS 公式与旧口径一致。
 * 用法：node --test tools/test-paf-camera.cjs
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

let cam;
test.before(async () => { cam = await import('../src/core/paf-camera.js'); });

const CFG = {
  camDist: 5.2, camHeight: 2.3, camPitch: 0.32, camLookAhead: 2.2, camDamp: 12,
  fpvEyeHeight: 0.85, fpvHeadForward: 0.45, fpvPitchMin: -55, fpvPitchMax: 40,
  fpvMouseLook: 0.0026, fpvDefaultPitch: -6, fpvPounceLockDamp: 7, fpvPouncePitch: -10,
  camMinGround: 0.22,
};
const FOX = { x: 3, y: 1.2, z: -4, yaw: 0.7 };

test('pitch 夹紧在 [fpvPitchMin, fpvPitchMax]', () => {
  const look = { yaw: 0, pitch: 0 };
  cam.applyLookDelta(look, 0, 1e6, { sensitivity: CFG.fpvMouseLook, pitchMinDeg: CFG.fpvPitchMin, pitchMaxDeg: CFG.fpvPitchMax });
  assert.ok(Math.abs(look.pitch - CFG.fpvPitchMin * Math.PI / 180) < 1e-9, `下夹紧 ${look.pitch}`);
  cam.applyLookDelta(look, 0, -1e6, { sensitivity: CFG.fpvMouseLook, pitchMinDeg: CFG.fpvPitchMin, pitchMaxDeg: CFG.fpvPitchMax });
  assert.ok(Math.abs(look.pitch - CFG.fpvPitchMax * Math.PI / 180) < 1e-9, `上夹紧 ${look.pitch}`);
});

test('yaw 自由环绕（wrap 到 ±π）', () => {
  const look = { yaw: 0, pitch: 0 };
  cam.applyLookDelta(look, 1e6, 0, { sensitivity: CFG.fpvMouseLook });
  assert.ok(look.yaw <= Math.PI && look.yaw >= -Math.PI);
});

test('FPV 眼位：y = fox.y + fpvEyeHeight，且沿视线前移', () => {
  const look = { yaw: 0, pitch: 0 };
  const pose = cam.fpvCameraPose(FOX, look, CFG, FOX.y);
  assert.ok(Math.abs(pose.pos.y - (FOX.y + CFG.fpvEyeHeight)) < 1e-9);
  assert.ok(Math.abs(pose.pos.z - (FOX.z + CFG.fpvHeadForward)) < 1e-9); // yaw=0 → +Z
  assert.ok(Math.abs(pose.pos.x - FOX.x) < 1e-9);
});

test('FPV 相机不穿地：低于地面时钳到 groundY + camMinGround', () => {
  const lowFox = { x: 0, y: -5, z: 0, yaw: 0 };
  const pose = cam.fpvCameraPose(lowFox, { yaw: 0, pitch: 0 }, CFG, 2.0);
  assert.ok(Math.abs(pose.pos.y - (2.0 + CFG.camMinGround)) < 1e-9);
});

test('视线与身体朝向解耦：look 相同、fox.yaw 不同 → FPV 朝向相同', () => {
  const look = { yaw: 1.1, pitch: -0.2 };
  const a = cam.fpvCameraPose({ ...FOX, yaw: 0 }, look, CFG, -1e9);
  const b = cam.fpvCameraPose({ ...FOX, yaw: 2.9 }, look, CFG, -1e9);
  assert.deepEqual(a.dir, b.dir);
  // 身体朝向不同也不影响注视点
  assert.deepEqual(a.lookAt, b.lookAt);
});

test('TPS 相机公式与旧追尾口径一致', () => {
  const pose = cam.tpsCameraPose(FOX, CFG);
  const fx = Math.sin(FOX.yaw), fz = Math.cos(FOX.yaw);
  assert.ok(Math.abs(pose.pos.x - (FOX.x - fx * CFG.camDist)) < 1e-9);
  assert.ok(Math.abs(pose.pos.y - (FOX.y + CFG.camHeight + CFG.camPitch * 1.4)) < 1e-9);
  assert.ok(Math.abs(pose.lookAt.x - (FOX.x + fx * CFG.camLookAhead)) < 1e-9);
  assert.ok(Math.abs(pose.lookAt.y - (FOX.y + 0.9)) < 1e-9);
});

test('视角切换往返：tps→fpv→tps，模式正确且无残留', () => {
  const vm = cam.createViewModeState('tps');
  assert.equal(vm.mode, 'tps');              // 默认第三人称
  assert.equal(vm.toggle(), 'fpv');
  const look = cam.enterFpvLook(FOX.yaw, CFG.fpvDefaultPitch);
  assert.ok(Math.abs(look.yaw - FOX.yaw) < 1e-9);                       // 进入时继承身体朝向
  assert.ok(Math.abs(look.pitch - CFG.fpvDefaultPitch * Math.PI / 180) < 1e-9);
  cam.applyLookDelta(look, 500, -200, { sensitivity: CFG.fpvMouseLook });
  assert.equal(vm.toggle(), 'tps');          // 切回第三人称
  assert.equal(vm.mode, 'tps');
  // 往返后再进 FPV：视线重置自身体朝向，不残留上次的 look
  const look2 = cam.enterFpvLook(FOX.yaw, CFG.fpvDefaultPitch);
  assert.ok(Math.abs(look2.yaw - FOX.yaw) < 1e-9);
  assert.notEqual(look2.yaw, look.yaw);
});

test('扑击视线锁定：阻尼回正、不瞬移、有限步内收敛', () => {
  const look = { yaw: FOX.yaw + 1.2, pitch: 0.5 };
  const targetYaw = FOX.yaw;
  const dt = 1 / 60;
  let prevGap = Math.abs(cam.wrapAngle(targetYaw - look.yaw));
  for (let i = 0; i < 30; i++) {
    const step = cam.dampLookToward(look, targetYaw, CFG.fpvPouncePitch, CFG.fpvPounceLockDamp, dt);
    assert.ok(Math.abs(step) < prevGap + 1e-9, '单步增量不超过剩余差距（无瞬移/越过）');
    const gap = Math.abs(cam.wrapAngle(targetYaw - look.yaw));
    assert.ok(gap < prevGap + 1e-9, '差距单调不增');
    prevGap = gap;
  }
  assert.ok(prevGap < 0.05, `30 帧后基本锁定（残余 ${prevGap}）`);
  assert.ok(Math.abs(look.pitch - CFG.fpvPouncePitch * Math.PI / 180) < 0.05);
});
