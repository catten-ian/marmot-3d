const assert = require('node:assert/strict');
(async () => {
  const m = await import('../src/core/combat-wheel.mjs');
  const {
    selectChargedMove, resolveAttackRelease, AttackGesture,
    rollDirection, ATTACK_DEAD_ZONE, ATTACK_MOVES,
    PARRY_DRAG_THRESHOLD, ROLL_DRAG_THRESHOLD, POUNCE_HOLD_MS,
    GESTURE_HORIZONTAL_RATIO,
  } = m;

  // 攻击招式集合严格只有三种：推击 / 迎击 / 扑击（翻滚不是攻击）。
  assert.deepEqual(ATTACK_MOVES, ['tap', 'stand', 'lunge']);
  assert.equal(PARRY_DRAG_THRESHOLD, 22);
  assert.equal(ROLL_DRAG_THRESHOLD, 22);
  assert.equal(POUNCE_HOLD_MS, 650);
  assert.equal(ATTACK_DEAD_ZONE, 18);
  assert.ok(GESTURE_HORIZONTAL_RATIO > 1);

  // —— 地面松手结算：短按推击，蓄力过阈值扑击 ——
  assert.equal(resolveAttackRelease({ holdMs: 80 }), 'tap', '点按 → 推击');
  assert.equal(resolveAttackRelease({ holdMs: 500 }), 'tap', '蓄力阈值前松手为推击');
  assert.equal(resolveAttackRelease({ holdMs: 900 }), 'lunge', '地面长按过阈值为扑击');
  assert.equal(resolveAttackRelease({ holdMs: 500, sprinting: true }), 'tap', '未到蓄力阈值 → 推击');
  assert.equal(resolveAttackRelease({ holdMs: 650 }), 'lunge', '地面 650ms → 扑击');
  assert.equal(resolveAttackRelease({ holdMs: 900, sprinting: true }), 'lunge', '地面长按 → 扑击');
  // 已触发左滑迎击 / 右滑翻滚后松手一律不补招。
  assert.equal(resolveAttackRelease({ holdMs: 80, fired: 'parry' }), null);
  assert.equal(resolveAttackRelease({ holdMs: 900, sprinting: true, fired: 'roll' }), null);
  assert.equal(resolveAttackRelease({ holdMs: 900, sprinting: true, parried: true }), null);

  // —— 秒单位兼容入口 selectChargedMove ——
  assert.equal(selectChargedMove(0.08), 'tap');
  assert.equal(selectChargedMove(0.5), 'tap');
  assert.equal(selectChargedMove(0.9, false), 'lunge', '地面长按过阈值为扑击');
  assert.equal(selectChargedMove(0.65, true), 'lunge');
  assert.equal(selectChargedMove(0.9, true), 'lunge');
  assert.equal(selectChargedMove(0.5, true), 'tap');
  // cfg.heavyHold 可改扑击阈值（秒）。
  assert.equal(selectChargedMove(0.5, true, { heavyHold: 0.45 }), 'lunge');

  // —— AttackGesture：左滑迎击 / 右滑翻滚，独立闩锁 ——
  {
    // 左滑跨阈当帧返回 parry 事件，只触发一次。
    const g = new AttackGesture(3, 0);
    assert.equal(g.update(-10, 0, 40), null);
    const ev = g.update(-30, 0, 80);
    assert.ok(ev && ev.kind === 'parry');
    assert.equal(ev.pointerId, 3);
    assert.equal(ev.dx, -30);
    assert.equal(g.update(-60, 0, 120), null, '闩锁：继续左滑不重复触发');
    // 已出迎击后再右滑也不触发翻滚：一次按住最多一个方向招式。
    assert.equal(g.update(40, 0, 160), null);
    assert.equal(g.fired, 'parry');
    const out = g.release(200);
    assert.equal(out.fired, 'parry');
    assert.equal(out.parried, true);
    assert.equal(out.rolled, false);
    assert.equal(resolveAttackRelease({ ...out, sprinting: true }), null, '迎击后奔跑松手也不补扑击');
  }
  {
    // 右滑跨阈当帧返回 roll 事件，只触发一次，松手不补攻击。
    const g = new AttackGesture(4, 0);
    const ev = g.update(30, 0, 70);
    assert.ok(ev && ev.kind === 'roll');
    assert.equal(g.rolled, true);
    assert.equal(g.update(60, 2, 110), null);
    assert.equal(g.update(-40, 0, 150), null, '翻滚后左滑不再出迎击');
    const out = g.release(180);
    assert.equal(out.fired, 'roll');
    assert.equal(resolveAttackRelease({ ...out }), null);
  }
  {
    // 阈值边界：-21/+21 不触发，-22/+22 触发。
    const gl = new AttackGesture(1, 0);
    assert.equal(gl.update(-21, 0, 20), null);
    const gr = new AttackGesture(2, 0);
    assert.equal(gr.update(21, 0, 20), null);
    assert.ok(new AttackGesture(5, 0).update(-22, 0, 20)?.kind === 'parry');
    assert.ok(new AttackGesture(6, 0).update(22, 0, 20)?.kind === 'roll');
  }
  {
    // 水平主导：纵向分量过大不触发，避免上下摇动误出迎击/翻滚。
    const gv1 = new AttackGesture(7, 0);
    assert.equal(gv1.update(-30, -30, 20), null, '45° 斜向左上不触发迎击');
    assert.equal(gv1.fired, null);
    const gv2 = new AttackGesture(8, 0);
    assert.equal(gv2.update(30, 28, 20), null, '纵向接近水平不触发翻滚');
    // 水平明显占优时仍可触发。
    assert.ok(gv2.update(30, 20, 40)?.kind === 'roll', '|dx|≥1.1|dy| 时触发翻滚');
  }

  // —— 翻滚方向：有速度用速度方向，静止用身体朝向 ——
  const moving = rollDirection({ velX: 3, velZ: 4 });
  assert.ok(moving.moving);
  assert.ok(Math.abs(Math.hypot(moving.x, moving.z) - 1) < 1e-9);
  assert.ok(Math.abs(moving.x - 0.6) < 1e-9 && Math.abs(moving.z - 0.8) < 1e-9);
  const idle = rollDirection({ velX: 0, velZ: 0, bodyYaw: 0 });
  assert.equal(idle.moving, false);
  assert.ok(Math.abs(idle.x - 0) < 1e-9 && Math.abs(idle.z + 1) < 1e-9);

  console.log('combat-wheel logic: all assertions passed');
})().catch((err) => { console.error(err); process.exit(1); });
