/**
 * 藏狐自主撤退 / 驱退计数 / 真死路径（阶段 2 口径）纯函数测试。
 * 覆盖 fox-motion.js 的撤退决策与状态迁移：
 *   shouldRetreat / chooseRestPoint / enterRestSafe / stepRestSafe / exitRestSafe / resolveHitState
 * 用法：node tools/test-fox-repel.cjs
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

let R, shouldRetreat, chooseRestPoint, enterRestSafe, stepRestSafe, exitRestSafe, resolveHitState;

test.before(async () => {
  const motion = await import('../src/core/fox-motion.js');
  const config = await import('../src/core/config.js');
  R = config.FOX.retreat;
  ({ shouldRetreat, chooseRestPoint, enterRestSafe, stepRestSafe, exitRestSafe, resolveHitState } = motion);
});

test('FOX.retreat 存在且数值方向正确', () => {
  assert.ok(R);
  assert.ok(R.hpRatio > 0 && R.hpRatio < 1);
  assert.ok(R.staminaRatio > 0 && R.staminaRatio < 1);
  assert.ok(R.hitStreak >= 2);
  assert.ok(R.speed > 0);
  assert.ok(R.restSeconds.boss > R.restSeconds.normal); // 首领休息明显更长
});

test('shouldRetreat：血量健康 + 体力充足 + 正在蓄力 → false（攻击中不撤退）', () => {
  assert.equal(shouldRetreat({ hpRatio: 0.1, staminaRatio: 0.1, hitStreak: 9, state: 'wind' }, R), false);
  assert.equal(shouldRetreat({ hpRatio: 0.1, staminaRatio: 0.1, hitStreak: 9, state: 'dash' }, R), false);
  assert.equal(shouldRetreat({ hpRatio: 1, staminaRatio: 1, hitStreak: 0, state: 'wind' }, R), false);
});

test('shouldRetreat：血量低 + 空闲状态 → true', () => {
  assert.equal(shouldRetreat({ hpRatio: R.hpRatio - 0.01, staminaRatio: 1, hitStreak: 0, state: 'roam' }, R), true);
  assert.equal(shouldRetreat({ hpRatio: R.hpRatio, staminaRatio: 1, hitStreak: 0, state: 'rest' }, R), true);
});

test('shouldRetreat：体力低 + 空闲状态 → true', () => {
  assert.equal(shouldRetreat({ hpRatio: 1, staminaRatio: R.staminaRatio - 0.01, hitStreak: 0, state: 'roam' }, R), true);
});

test('shouldRetreat：被打次数多 → true；血量健康 → false', () => {
  assert.equal(shouldRetreat({ hpRatio: 1, staminaRatio: 1, hitStreak: R.hitStreak, state: 'roam' }, R), true);
  assert.equal(shouldRetreat({ hpRatio: 1, staminaRatio: 1, hitStreak: 0, state: 'roam' }, R), false);
  assert.equal(shouldRetreat({ hpRatio: 1, staminaRatio: 1, hitStreak: R.hitStreak - 1, state: 'circle' }, R), false);
});

test('shouldRetreat：撤退/休息/死亡中不重复触发', () => {
  for (const state of ['retreat', 'rest_safe', 'dead']) {
    assert.equal(shouldRetreat({ hpRatio: 0, staminaRatio: 0, hitStreak: 99, state }, R), false);
  }
});

test('chooseRestPoint：优先选玩家不在附近的洞穴口旁', () => {
  const rp = chooseRestPoint({
    foxX: 0, foxZ: 0, playerX: 0, playerZ: 20,
    burrows: [{ x: 0, z: -25, r: 2 }, { x: 1, z: 22, r: 2 }], // 第二个紧贴玩家，不可用
    bounds: { hw: 74, hh: 44 },
  }, R);
  // 应选中远处那个洞的背玩家一侧（z 更负），而不是玩家脚边
  assert.ok(rp.z < -20, `rest point should be near far burrow, got ${JSON.stringify(rp)}`);
});

test('chooseRestPoint：无可用洞穴 → 背离玩家方向，且在边界内', () => {
  const rp = chooseRestPoint({
    foxX: 5, foxZ: 5, playerX: -5, playerZ: -5, burrows: [], bounds: { hw: 74, hh: 44 },
  }, R);
  const away = (rp.x - -5) * (5 - -5) + (rp.z - -5) * (5 - -5); // 与"背离玩家"方向同向
  assert.ok(away > 0);
  assert.ok(Math.abs(rp.x) <= 70 && Math.abs(rp.z) <= 40);
});

test('enterRestSafe：驱退计数只发生一次（连续进入不重复计数）', () => {
  const first = enterRestSafe({ repelCounted: false }, R.restSeconds.normal);
  assert.equal(first.state, 'rest_safe');
  assert.equal(first.justCounted, true);    // 首次进入：计一次
  assert.equal(first.repelCounted, true);
  const again = enterRestSafe({ repelCounted: first.repelCounted }, R.restSeconds.normal);
  assert.equal(again.justCounted, false);   // 同回合再进入：不重复计
  assert.equal(again.repelCounted, true);
});

test('stepRestSafe：计时到或血回满 → done', () => {
  assert.equal(stepRestSafe({ timer: 0.05, hp: 3, maxHp: 10 }, 0.1).done, true);
  assert.equal(stepRestSafe({ timer: 5, hp: 10, maxHp: 10 }, 0.1).done, true); // 血满提前结束
  assert.equal(stepRestSafe({ timer: 5, hp: 3, maxHp: 10 }, 0.1).done, false);
  assert.ok(Math.abs(stepRestSafe({ timer: 5, hp: 3, maxHp: 10 }, 1).timer - 4) < 1e-9);
});

test('exitRestSafe：回到 roam，repelCounted 复位（允许第二次撤退再计数）', () => {
  const r = exitRestSafe();
  assert.equal(r.state, 'roam');
  assert.equal(r.retreating, false);
  assert.equal(r.restPoint, null);
  assert.equal(r.repelCounted, false);
  assert.equal(r.hitStreak, 0);
  // 复位后再进 rest_safe 又能计一次
  const again = enterRestSafe({ repelCounted: r.repelCounted }, R.restSeconds.normal);
  assert.equal(again.justCounted, true);
});

test('resolveHitState：血量归零 → dead（不是 flee），血量 >0 → 不死', () => {
  assert.equal(resolveHitState(0), 'dead');
  assert.equal(resolveHitState(-3), 'dead');
  assert.equal(resolveHitState(0.5), null);
});

test('撤退循环完整走一遍：roam → retreat → rest_safe(计一次) → roam(复位) → 可再计', () => {
  // 模拟 Fox 实例字段的最小子集，按 update() 的顺序串起纯函数
  let fox = { state: 'roam', hp: 2, maxHp: 10, stamina: 90, maxStamina: 100, hitStreak: 0, repelCounted: false };
  assert.equal(shouldRetreat({ hpRatio: fox.hp / fox.maxHp, staminaRatio: fox.stamina / fox.maxStamina, hitStreak: 0, state: fox.state }, R), true);
  fox.state = 'retreat';
  // 到达休息点 → 进 rest_safe，计一次
  const e1 = enterRestSafe(fox, R.restSeconds.normal);
  Object.assign(fox, e1);
  let counts = e1.justCounted ? 1 : 0;
  // 连续多帧停留 rest_safe（每帧计时推进）
  for (let i = 0; i < 100; i++) {
    const st = stepRestSafe({ timer: fox.timer, hp: fox.hp, maxHp: fox.maxHp }, 0.1);
    fox.timer = st.timer;
    if (st.done) { Object.assign(fox, exitRestSafe()); break; }
  }
  assert.equal(counts, 1);
  assert.equal(fox.state, 'roam');
  assert.equal(fox.repelCounted, false);
  // 第二次撤退又能计数
  const e2 = enterRestSafe(fox, R.restSeconds.normal);
  assert.equal(e2.justCounted, true);
});
