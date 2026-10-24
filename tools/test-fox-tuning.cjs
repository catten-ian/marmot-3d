/**
 * 阶段 5 调参台覆盖层测试（纯 Node）。
 * 覆盖：SMART_POUNCE_TUNE 覆盖层默认值 / 复位 / 被真实读取 / 预警线一致性 / vitals 运行时读取。
 * 用法：node tools/test-fox-tuning.cjs
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

let core, motion, config;
test.before(async () => {
  core = await import('../src/entities/smart-fox-core.mjs');
  motion = await import('../src/core/fox-motion.js');
  config = await import('../src/core/config.js');
});

const DT = 1 / 60;
/** 与 stepSmartMotion 相同的整帧欧拉积分：先加速、再走满 dt、扣剩余时长。 */
function integrateDash(initialSpeed, dashSpeed, accel, duration, dt = DT) {
  let speed = initialSpeed, dist = 0, t = Math.max(0, duration);
  while (t > 1e-9) {
    speed += Math.max(-accel * dt, Math.min(accel * dt, dashSpeed - speed));
    dist += speed * dt;
    t -= dt;
  }
  return dist;
}
/** 从 observe 状态提交一次扑咬，返回 dash 阶段的 state。 */
function commitPounce() {
  const player = { x: 0, z: 0 };
  const fox = { x: 5, z: 0, vx: 0, vz: 0, yaw: Math.atan2(-5, 0), intent: 'observe', pounceCooldown: 0 };
  return core.stepSmartMotion(fox, player, DT, 'pounce');
}

test.afterEach(() => core.resetSmartPounceTune());

test('覆盖层默认值 == 冻结常量默认值', () => {
  for (const k of Object.keys(core.SMART_POUNCE_STAGE))
    assert.equal(core.SMART_POUNCE_TUNE[k], core.SMART_POUNCE_STAGE[k], k);
  assert.ok(Object.isFrozen(core.SMART_POUNCE_STAGE), '冻结常量必须保持 frozen');
  assert.ok(!Object.isFrozen(core.SMART_POUNCE_TUNE), '覆盖层必须可变');
});

test('resetSmartPounceTune() 完全复位', () => {
  for (const k of Object.keys(core.SMART_POUNCE_TUNE)) core.SMART_POUNCE_TUNE[k] = 999;
  core.resetSmartPounceTune();
  for (const k of Object.keys(core.SMART_POUNCE_STAGE))
    assert.equal(core.SMART_POUNCE_TUNE[k], core.SMART_POUNCE_STAGE[k], k);
});

test('改 SMART_POUNCE_TUNE.strikeTime 后扑咬时序真的跟着变', () => {
  const strikeTimeOf = () => {
    let s = commitPounce();
    assert.equal(s.pounceStage, 'dash');
    for (let i = 0; i < 600 && s.pounceStage !== 'strike'; i++)
      s = core.stepSmartMotion(s, { x: 0, z: 0 }, DT, 'pounce');
    assert.equal(s.pounceStage, 'strike');
    return s.pounceStageTime;
  };
  const t1 = strikeTimeOf();
  assert.ok(Math.abs(t1 - core.SMART_POUNCE_TUNE.strikeTime) < DT + 1e-9, 'strike 段时长应来自覆盖层');
  core.SMART_POUNCE_TUNE.strikeTime = 0.66;
  const t2 = strikeTimeOf();
  assert.ok(Math.abs(t2 - 0.66) < DT + 1e-9, `改覆盖层后 strike 段时长应变（实际 ${t2}）`);
  assert.notEqual(core.SMART_POUNCE_STAGE.strikeTime, 0.66, '冻结常量不受影响');
});

test('改 SMART_POUNCE_TUNE.windupTime 后前摇时长跟着变', () => {
  const windupOf = () => {
    let s = commitPounce();
    for (let i = 0; i < 600 && s.pounceStage !== 'windup'; i++)
      s = core.stepSmartMotion(s, { x: 0, z: 0 }, DT, 'pounce');
    assert.equal(s.pounceStage, 'windup');
    return s.pounceStageTime;
  };
  assert.ok(Math.abs(windupOf() - core.SMART_POUNCE_STAGE.windupTime) < DT + 1e-9);
  core.SMART_POUNCE_TUNE.windupTime = 0.5;
  assert.ok(Math.abs(windupOf() - 0.5) < DT + 1e-9);
});

test('smartPounceDashDistance 默认参数读覆盖层，且 == 逐帧积分（预警线 = 实际位移）', () => {
  const dashSpeed = 10.6 * core.SMART_POUNCE_TUNE.dashSpeedMul;
  for (const duration of [undefined, 0.42, 0.9, 0.13]) {
    if (duration != null) core.SMART_POUNCE_TUNE.dashDuration = duration;
    const d = duration == null ? core.SMART_POUNCE_TUNE.dashDuration : duration;
    for (const v0 of [0, 3.2, 8]) {
      const got = core.smartPounceDashDistance(v0, dashSpeed, 18); // 缺省 remaining 走覆盖层
      const want = integrateDash(v0, dashSpeed, 18, core.SMART_POUNCE_TUNE.dashDuration);
      assert.ok(Math.abs(got - want) < 1e-9, `v0=${v0} duration=${d}: ${got} != ${want}`);
    }
  }
  // 默认值随 dashDuration 改动而变化
  const a = core.smartPounceDashDistance(0, dashSpeed, 18);
  core.SMART_POUNCE_TUNE.dashDuration = 0.8;
  const b = core.smartPounceDashDistance(0, dashSpeed, 18);
  assert.ok(b > a, 'dashDuration 增大后预警线应变长');
});

test('cancelSmartPounce 的后摇读覆盖层 recoverTime', () => {
  core.SMART_POUNCE_TUNE.recoverTime = 1.3;
  const s = core.cancelSmartPounce({ pounceCommitted: true, vx: 1, vz: 0 });
  assert.equal(s.pounceStage, 'recover');
  assert.equal(s.pounceStageTime, 1.3);
});

test('FOX.vitals 改动后 stepStamina 收支随之变化', () => {
  const { FOX } = config;
  const origMax = FOX.vitals.maxStamina;
  try {
    // 休息时上限跟着 FOX.vitals.maxStamina 走（不传 options.maxStamina）
    FOX.vitals.maxStamina = 50;
    const r = motion.stepStamina({ stamina: 80, locked: 0, hp: 1 }, DT, { resting: true, regenPerSec: 14, maxHp: 3 });
    assert.equal(r.stamina, 50, '体力应 clamp 到新上限 50');
    // 锁定秒数跟着改
    FOX.vitals.staminaLockSeconds = 3;
    const e = motion.stepStamina({ stamina: 0.001, locked: 0, hp: 1 }, DT, { drainPerSec: 18 });
    assert.equal(e.exhausted, true);
    assert.equal(e.locked, 3);
  } finally {
    FOX.vitals.maxStamina = origMax;
    FOX.vitals.staminaLockSeconds = 1.2;
  }
});
