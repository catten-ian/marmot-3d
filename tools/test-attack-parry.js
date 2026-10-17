/**
 * 攻击键真实三招手势回归测试（纯逻辑，无需浏览器）：
 *   1. tap / 非奔跑长按松手          → 推击(tap)
 *   2. 奔跑中长按过扑击阈值松手       → 扑击(lunge)
 *   3. 左滑过阈                       → 立即迎击(stand)一次，松手不补招
 *   4. 右滑过阈                       → 立即翻滚(roll)一次，松手不补攻击
 *   5. 左右闩锁互斥：一次按住最多触发一个方向招式
 *   6. 阈值边界 dx=±21 不触发 / ±22 触发；纵向主导不触发
 *
 * 用法：node tools/test-attack-parry.js
 */
const assert = require('node:assert/strict');

(async () => {
  const {
    AttackGesture, resolveAttackRelease,
    PARRY_DRAG_THRESHOLD, ROLL_DRAG_THRESHOLD, POUNCE_HOLD_MS,
  } = await import('../src/core/combat-wheel.mjs');

  assert.equal(PARRY_DRAG_THRESHOLD, 22);
  assert.equal(ROLL_DRAG_THRESHOLD, 22);
  assert.equal(POUNCE_HOLD_MS, 650);

  // 1) 点按 / 非奔跑长按 → 推击
  {
    const g = new AttackGesture(1, 0);
    const out = g.release(80);
    assert.equal(out.fired, null);
    assert.equal(resolveAttackRelease(out), 'tap');
  }
  {
    const g = new AttackGesture(2, 0);
    for (let t = 16; t <= 900; t += 16) assert.equal(g.update(0, 0, t), null);
    const out = g.release(900);
    assert.equal(resolveAttackRelease({ ...out, sprinting: false }), 'tap', '非奔跑长按 900ms 仍是推击');
  }

  // 2) 奔跑长按 ≥650ms → 扑击；奔跑但不足阈值 → 推击
  {
    const g = new AttackGesture(3, 0);
    const out = g.release(700);
    assert.equal(resolveAttackRelease({ ...out, sprinting: true }), 'lunge');
    const g2 = new AttackGesture(4, 0);
    const out2 = g2.release(500);
    assert.equal(resolveAttackRelease({ ...out2, sprinting: true }), 'tap');
  }

  // 3) 左滑 → 立即迎击；松手结算 null
  {
    const g = new AttackGesture(5, 0);
    let ctx = null;
    for (let t = 16; t < 500; t += 16) {
      if (g.update(-10, 0, t)) assert.fail('未跨阈值不应触发迎击');
    }
    ctx = g.update(-30, 0, 500);
    assert.ok(ctx && ctx.kind === 'parry');
    assert.equal(ctx.pointerId, 5);
    assert.equal(ctx.tStart, 0);
    assert.equal(ctx.tNow, 500);
    const out = g.release(560);
    assert.equal(out.parried, true);
    assert.equal(out.rolled, false);
    assert.equal(resolveAttackRelease({ ...out, sprinting: true }), null);
  }

  // 4) 右滑 → 立即翻滚；松手结算 null（不补攻击）
  {
    const g = new AttackGesture(6, 0);
    const ctx = g.update(34, 2, 90);
    assert.ok(ctx && ctx.kind === 'roll');
    assert.equal(ctx.dx, 34);
    const out = g.release(140);
    assert.equal(out.rolled, true);
    assert.equal(out.parried, false);
    assert.equal(resolveAttackRelease(out), null);
  }

  // 5) 左右互斥且各只触发一次（来回跨阈）
  {
    const g = new AttackGesture(7, 0);
    const fires = [];
    for (const [t, dx, dy] of [[100, -30, 0], [140, -40, 0], [180, 30, 0], [260, -60, 0]]) {
      const ctx = g.update(dx, dy, t);
      if (ctx) fires.push(ctx);
    }
    assert.equal(fires.length, 1, '一次按住只 fire 一个方向招式');
    assert.equal(fires[0].kind, 'parry');
    assert.equal(g.release(320).fired, 'parry');
  }
  {
    const g = new AttackGesture(8, 0);
    const fires = [];
    for (const [t, dx, dy] of [[100, 30, 0], [140, 60, 0], [180, -30, 0]]) {
      const ctx = g.update(dx, dy, t);
      if (ctx) fires.push(ctx);
    }
    assert.equal(fires.length, 1);
    assert.equal(fires[0].kind, 'roll');
  }

  // 6) 阈值边界 + 水平主导
  {
    assert.equal(new AttackGesture(9, 0).update(-21, 0, 30), null);
    assert.equal(new AttackGesture(10, 0).update(21, 0, 30), null);
    assert.equal(new AttackGesture(11, 0).update(-22, 0, 30)?.kind, 'parry');
    assert.equal(new AttackGesture(12, 0).update(22, 0, 30)?.kind, 'roll');
    // 纵向主导（斜向）不触发
    assert.equal(new AttackGesture(13, 0).update(-40, 40, 30), null);
    assert.equal(new AttackGesture(14, 0).update(40, -40, 30), null);
    // tap 窗口内左滑也立即迎击
    const tap = new AttackGesture(15, 0);
    assert.equal(tap.update(-30, 0, 80)?.kind, 'parry');
    assert.equal(tap.release(90).fired, 'parry');
  }

  console.log('attack-parry gesture logic: all assertions passed');
})().catch((err) => { console.error(err); process.exit(1); });
