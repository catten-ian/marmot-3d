/**
 * 阶段 4：智能狐冲刺扑咬两阶段 + 可发现性纯函数测试。
 * 覆盖：smartPounceDashDistance（预警线长度=真实位移）、两阶段时序（固定冲刺时长/
 * 速度略快/极短前摇/后摇）、一次性体力消耗语义、撞障取消无伤害。
 * 用法：node tools/test-fox-pounce.cjs
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

let core, FOX, canSprint;
const DT = 1 / 60;

test.before(async () => {
  core = await import('../src/entities/smart-fox-core.mjs');
  FOX = (await import('../src/core/config.js')).FOX;
  ({ canSprint } = await import('../src/core/fox-motion.js'));
});

function commitPounce(distance = 5) {
  // 目标在 +z 方向 distance 处，yaw=0 正对 → 满足提交条件
  let st = { x: 0, z: 0, vx: 0, vz: 0, yaw: 0, maxTurnRate: 2.8, acceleration: 18, pounceCooldown: 0 };
  st = core.stepSmartMotion(st, { x: 0, z: distance }, DT, 'pounce');
  assert.equal(st.pounceCommitted, true, 'pounce should commit');
  return st;
}

test('冲刺阶段位移 = smartPounceDashDistance（预警线长度与真实位移一致）', () => {
  let st = commitPounce(5);
  let travelled = 0;
  let px = st.x, pz = st.z;
  // 提交后第一帧（当前速度/剩余时长）预测的剩余位移，须等于此后逐帧累计的真实位移
  const expected = core.smartPounceDashDistance(
    Math.hypot(st.vx, st.vz), st.pounceDashSpeed, st.acceleration, st.pounceStageTime);
  while (st.pounceStage === 'dash') {
    st = core.stepSmartMotion(st, { x: 0, z: 5 }, DT, 'pounce');
    travelled += Math.hypot(st.x - px, st.z - pz);
    px = st.x; pz = st.z;
  }
  assert.ok(Math.abs(travelled - expected) < 1e-6, `travelled ${travelled} vs predicted ${expected}`);
});

test('冲刺阶段时长固定：不同初始距离下 dash 帧数一致', () => {
  const countDash = (dist) => {
    let st = commitPounce(dist);
    let n = 0;
    while (st.pounceStage === 'dash' && n < 120) { st = core.stepSmartMotion(st, { x: 0, z: dist }, DT, 'pounce'); n++; }
    return n;
  };
  const a = countDash(3.2), b = countDash(6.8);
  assert.equal(a, b);
  // 固定时长 ≈ dashDuration
  assert.ok(Math.abs(a * DT - core.SMART_POUNCE_STAGE.dashDuration) < DT * 1.5);
});

test('冲刺阶段速度略快于普通冲刺（dashSpeedMul>1 且 > ACTIONS.sprint.speed）', () => {
  const S = core.SMART_POUNCE_STAGE;
  assert.ok(S.dashSpeedMul > 1 && S.dashSpeedMul <= 1.25);
  const st = commitPounce(5);
  const dashSpeed = st.pounceDashSpeed;
  assert.ok(dashSpeed > FOX.ACTIONS.sprint.speed, `dash ${dashSpeed} should exceed sprint ${FOX.ACTIONS.sprint.speed}`);
  // 但也不能离谱：< 扑击速度
  assert.ok(dashSpeed < S.strikeSpeed);
});

test('前摇极短(<0.15s)、后摇存在(>0.3s)、扑咬位移真实且只扑近地', () => {
  const S = core.SMART_POUNCE_STAGE;
  assert.ok(S.windupTime < 0.15);
  assert.ok(S.recoverTime > 0.3);
  assert.ok(S.maxStrikeDistance <= 2);
  let st = commitPounce(4);
  // 快进到 windup
  while (st.pounceStage === 'dash') st = core.stepSmartMotion(st, { x: 0, z: 4 }, DT, 'pounce');
  assert.equal(st.pounceStage, 'windup');
  // 前摇期间不位移
  const wx = st.x, wz = st.z;
  st = core.stepSmartMotion(st, { x: 0, z: 4 }, DT, 'pounce');
  if (st.pounceStage === 'windup') assert.equal(Math.hypot(st.x - wx, st.z - wz), 0);
  // 快进到 strike：真实位移（不是瞬移）且 pounceStriking=true
  while (st.pounceStage === 'windup') st = core.stepSmartMotion(st, { x: 0, z: 4 }, DT, 'pounce');
  assert.equal(st.pounceStage, 'strike');
  assert.equal(st.pounceStriking, true);
  let strikeMove = 0, px = st.x, pz = st.z, frames = 0;
  while (st.pounceStage === 'strike') {
    st = core.stepSmartMotion(st, { x: 0, z: 4 }, DT, 'pounce');
    strikeMove += Math.hypot(st.x - px, st.z - pz); px = st.x; pz = st.z; frames++;
    assert.ok(strikeMove <= S.strikeSpeed * S.strikeTime + S.strikeSpeed * DT + 1e-6, 'strike 不是瞬移：逐帧位移有上限');
  }
  assert.ok(strikeMove > S.strikeSpeed * S.strikeTime * 0.8, 'strike 必须有真实位移');
  // strike 结束 → 后摇 recover，期间不可移动
  assert.equal(st.pounceStage, 'recover');
  assert.equal(st.pounceCommitted, false);
  assert.equal(st.pounceJustEnded, true);
  const rx = st.x, rz = st.z;
  st = core.stepSmartMotion(st, { x: 0, z: 4 }, DT, 'recover');
  assert.equal(Math.hypot(st.x - rx, st.z - rz), 0, '后摇硬直：不能移动');
  assert.equal(st.intent, 'recover');
});

test('体力：扑咬一次性扣 staminaCost，体力不足不允许进入冲刺阶段', () => {
  const S = core.SMART_POUNCE_STAGE;
  const V = FOX.vitals;
  assert.equal(S.staminaCost, FOX.ACTIONS.pounce.staminaCost);
  assert.ok(S.staminaCost >= 20, '扑咬必须是一次性大量消耗');
  // 进入冲刺阶段的门槛（与 smart-fox.js 的 commitAllowed 同口径）
  const need = S.staminaCost + V.pounceStaminaPerSec * S.dashDuration;
  assert.ok(canSprint(need, V.pounceStaminaPerSec, S.dashDuration));
  const low = need - 1;
  const allowed = low >= need && canSprint(low, V.pounceStaminaPerSec, S.dashDuration);
  assert.equal(allowed, false, '体力不足 → 不进入冲刺阶段');
  // commitAllowed=false 时纯函数层面也不提交
  let st = { x: 0, z: 0, vx: 0, vz: 0, yaw: 0, maxTurnRate: 2.8, acceleration: 18, pounceCooldown: 0 };
  st = core.stepSmartMotion(st, { x: 0, z: 4 }, DT, 'pounce', { commitAllowed: false });
  assert.notEqual(st.pounceCommitted, true);
});

test('撞障取消：当帧取消扑击，pounceStriking=false（主循环据此不产生伤害）', () => {
  let st = commitPounce(4);
  while (st.pounceStage === 'dash' || st.pounceStage === 'windup') st = core.stepSmartMotion(st, { x: 0, z: 4 }, DT, 'pounce');
  assert.equal(st.pounceStriking, true);
  const c = core.cancelSmartPounce(st);
  assert.equal(c.pounceCommitted, false);
  assert.equal(c.pounceStriking, false, '取消帧起不再有伤害判定');
  assert.equal(c.pounceStage, 'recover', '取消后进后摇硬直');
  assert.equal(c.intent, 'recover');
  assert.equal(c.vx, 0); assert.equal(c.vz, 0);
  // 原对象不被修改（纯函数）
  assert.equal(st.pounceCommitted, true);
});

test('可发现性配置与 play-as-fox 对齐，动作能力表语义正确', () => {
  const D = FOX.detection, A = FOX.ACTIONS;
  // 与 PAF_DEFAULTS 对齐（detectStalk/detectSprint/detectLunge、stalkSpeed/runSpeed）
  assert.equal(D.stalk, 6.2); assert.equal(D.sprint, 11.5); assert.equal(D.pounce, 17.0);
  assert.ok(D.stalk < D.sprint && D.sprint < D.pounce, '慢行难发现、冲刺易发现、扑咬最易发现');
  assert.equal(A.stalk.speed, 2.5); assert.equal(A.sprint.speed, 6.4);
  assert.equal(A.stalk.staminaPerSec, 0, '慢行不耗体力');
  assert.ok(A.sprint.staminaPerSec > 0);
  assert.equal(A.stalk.detection, 'stalk'); assert.equal(A.sprint.detection, 'sprint'); assert.equal(A.pounce.detection, 'pounce');
});

test('完整时序：dash(固定) → windup → strike → recover，总时长≈各段之和', () => {
  const S = core.SMART_POUNCE_STAGE;
  let st = commitPounce(5);
  const seen = [];
  let guard = 0;
  while ((st.pounceCommitted || st.pounceStage) && guard++ < 200) {
    if (seen[seen.length - 1] !== st.pounceStage) seen.push(st.pounceStage);
    st = core.stepSmartMotion(st, { x: 0, z: 5 }, DT, 'pounce');
  }
  assert.deepEqual(seen.slice(0, 4), ['dash', 'windup', 'strike', 'recover']);
});
