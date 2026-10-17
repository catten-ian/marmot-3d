/**
 * 攻击键“按住升级 + 左滑迎击”手势回归测试（纯逻辑，无需浏览器）：
 *   1. tap <120ms 无拖动        → 短刺(tap)
 *   2. hold 500ms 无拖动        → 中刺(stand)
 *   3. hold 500ms + dx=-30     → 立即迎击一次，松手不再出攻击招
 *   4. tap 80ms + dx=-30       → 立即迎击
 *   5. 左滑来回多次跨阈          → 只 fire 一次迎击（parried 闩锁）
 *   6. 阈值边界 dx=-21 不触发 / dx=-22 触发
 *   7. 附带：>650ms 重刺(lunge)、常量化阈值
 *
 * 用法：node tools/test-attack-parry.js
 */
const assert = require('node:assert/strict');

(async () => {
  const m = await import('../src/core/combat-wheel.mjs');
  const {
    AttackGesture, selectHoldMove, resolveAttackRelease,
    PARRY_DRAG_THRESHOLD, TAP_MAX_MS, SHORT_HOLD_MAX_MS, MID_HOLD_MAX_MS,
  } = m;

  assert.equal(PARRY_DRAG_THRESHOLD, 22);
  assert.equal(TAP_MAX_MS, 120);
  assert.equal(SHORT_HOLD_MAX_MS, 280);
  assert.equal(MID_HOLD_MAX_MS, 650);

  // 1) tap 80ms，无拖动 → 短刺
  {
    const g = new AttackGesture(1, 0);
    const out = g.release(80);
    assert.equal(out.parried, false);
    assert.equal(resolveAttackRelease(out), 'tap');
    assert.equal(selectHoldMove(80), 'tap');
  }

  // 2) hold 500ms，无拖动 → 中刺
  {
    const g = new AttackGesture(2, 0);
    let fired = 0;
    for (let t = 16; t <= 500; t += 16) {
      if (g.update(0, 0, t)) fired++;   // 停在原地的 move 不应触发迎击
    }
    const out = g.release(500);
    assert.equal(fired, 0);
    assert.equal(out.parried, false);
    assert.equal(resolveAttackRelease(out), 'stand');
    assert.equal(selectHoldMove(500), 'stand');
  }

  // 3) hold 500ms + dx=-30 → 立即迎击；松手结算为 null（不再出招）
  {
    const g = new AttackGesture(3, 0);
    let ctx = null;
    for (let t = 16; t < 500; t += 16) {
      const c = g.update(-10, 0, t);   // 未到阈值
      if (c) assert.fail('未跨阈值不应触发迎击');
    }
    ctx = g.update(-30, 0, 500);
    assert.ok(ctx, 'dx=-30 应触发迎击');
    assert.equal(ctx.pointerId, 3);
    assert.equal(ctx.tStart, 0);
    assert.equal(ctx.tNow, 500);
    const out = g.release(560);
    assert.equal(out.parried, true);
    assert.equal(out.holdMs, 560);
    assert.equal(resolveAttackRelease(out), null);
  }

  // 4) tap 80ms + dx=-30 → 立即迎击（tap 窗口内左滑）
  {
    const g = new AttackGesture(4, 0);
    const ctx = g.update(-30, 0, 80);
    assert.ok(ctx, 'tap 窗口内左滑也应立即迎击');
    assert.equal(ctx.tNow - ctx.tStart, 80);
    const out = g.release(90);
    assert.equal(out.parried, true);
    assert.equal(resolveAttackRelease(out), null);
  }

  // 5) 反复左滑来回跨阈 → 只 fire 一次
  {
    const g = new AttackGesture(5, 0);
    const fires = [];
    for (const [t, dx] of [[100, -30], [140, -40], [180, -8], [220, -25], [260, -60], [300, -22]]) {
      const ctx = g.update(dx, 0, t);
      if (ctx) fires.push(ctx);
    }
    assert.equal(fires.length, 1, 'parried 闩锁：一次按住只 fire 一次');
    assert.equal(fires[0].tNow, 100);
    const out = g.release(320);
    assert.equal(out.parried, true);
    assert.equal(resolveAttackRelease(out), null);
  }

  // 6) 阈值边界：-21 不触发，-22 触发
  {
    const g1 = new AttackGesture(6, 0);
    assert.equal(g1.update(-21, 0, 50), null);
    assert.equal(g1.parried, false);
    const g2 = new AttackGesture(7, 0);
    assert.ok(g2.update(-22, 0, 50));
    assert.equal(g2.parried, true);
  }

  // 7) 时长分档附带校验：120-280 短刺；280 边界中刺；650 边界重刺
  assert.equal(selectHoldMove(120), 'tap');
  assert.equal(selectHoldMove(279), 'tap');
  assert.equal(selectHoldMove(280), 'stand');
  assert.equal(selectHoldMove(649), 'stand');
  assert.equal(selectHoldMove(650), 'lunge');
  assert.equal(selectHoldMove(900), 'lunge');

  console.log('attack-parry gesture logic: all assertions passed');
})().catch((err) => { console.error(err); process.exit(1); });
