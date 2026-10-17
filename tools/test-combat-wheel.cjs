const assert = require('node:assert/strict');
(async () => {
  const {
    selectChargedMove, selectHoldMove, resolveAttackRelease,
    rollDirection, ATTACK_DEAD_ZONE,
  } = await import('../src/core/combat-wheel.mjs');

  // 旧四向手势轮盘已废弃：现在攻击键只有“按住分档 + 左滑迎击”。
  // selectChargedMove 入参为秒；sprinting 已不再影响分档（重刺站立可用）。
  assert.equal(selectChargedMove(0.08), 'tap');   // tap <120ms → 短刺
  assert.equal(selectChargedMove(0.2), 'tap');    // 120-280ms 早松 → 短刺
  assert.equal(selectChargedMove(0.28), 'stand'); // 280-650ms → 中刺
  assert.equal(selectChargedMove(0.5), 'stand');
  assert.equal(selectChargedMove(0.5, true), 'stand');
  assert.equal(selectChargedMove(0.65), 'lunge'); // ≥650ms → 重刺（不再要求奔跑）
  assert.equal(selectChargedMove(0.8, false), 'lunge');

  // 毫秒版纯函数 + 松手结算：迎击命中后松手返回 null（不再出招）。
  assert.equal(selectHoldMove(80), 'tap');
  assert.equal(selectHoldMove(500), 'stand');
  assert.equal(selectHoldMove(700), 'lunge');
  assert.equal(resolveAttackRelease({ holdMs: 500, parried: false }), 'stand');
  assert.equal(resolveAttackRelease({ holdMs: 700, parried: true }), null);
  assert.equal(resolveAttackRelease({ holdMs: 80, parried: true }), null);

  // 死区常量仍供输入层引用。
  assert.equal(ATTACK_DEAD_ZONE, 18);

  // 翻滚方向：有速度用速度方向，静止用身体朝向。
  const moving = rollDirection({ velX: 3, velZ: 4 });
  assert.ok(moving.moving);
  assert.ok(Math.abs(Math.hypot(moving.x, moving.z) - 1) < 1e-9);
  assert.ok(Math.abs(moving.x - 0.6) < 1e-9 && Math.abs(moving.z - 0.8) < 1e-9);
  const idle = rollDirection({ velX: 0, velZ: 0, bodyYaw: 0 });
  assert.equal(idle.moving, false);
  assert.ok(Math.abs(idle.x - 0) < 1e-9 && Math.abs(idle.z + 1) < 1e-9);

  console.log('combat-wheel logic: all assertions passed');
})().catch((err) => { console.error(err); process.exit(1); });
