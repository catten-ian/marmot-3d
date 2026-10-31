/**
 * 振刀式迎击 + 站立连续推击 + PC 输入路径回归测试（纯 Node，不启动浏览器）：
 *
 *  A. resolveParryOutcome（迎击判定纯函数）：
 *     - 准：迎击窗口内 + 狐狸 dash + 接触距离 + 正面 → 成功
 *     - 早：窗口还在但狐狸还在 wind 蓄力 / roam 空闲 → 失败（fox-not-attacking）
 *     - 晚：狐狸 dash 已结束（rest）或窗口已过期 → 失败
 *     - 闲：狐狸空闲/巡逻，玩家普通碰到 → 失败
 *     - 距离/朝向不满足 → 失败
 *  B. strikeGateOpen（出招门控纯函数）：站立/观察不再是门控条件；
 *     模拟站立连续短按：冷却中点击被吞、冷却结束立即稳定触发。
 *  C. 攻击 yaw 来源接线（源码断言）：strike() 用 resolveAttackYaw，
 *     不再用 controller.forwardFlat / controller.yaw 作为攻击方向；
 *     迎击判定走 resolveParryOutcome；输入侧不再无条件播报“迎击成功”。
 *  D. PC 输入路径（源码断言 + 纯函数）：鼠标左键/键盘 attack 的
 *     begin/release 接线、650ms 蓄力扑击、1500ms 自动释放、空中 0.55 倍弱化。
 *
 * 用法：node tools/test-parry-window.cjs
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');

let checks = 0;
function ok(cond, msg) { assert.ok(cond, msg); checks++; }
function eq(a, b, msg) { assert.equal(a, b, msg); checks++; }

(async () => {
  const {
    resolveParryOutcome, strikeGateOpen, FOX_ATTACK_STATE, DEFAULT_PARRY_HALF_ANGLE,
    resolveAttackRelease, isWeakAerialPounce, advanceAttackCharge,
    POUNCE_HOLD_MS, MAX_ATTACK_CHARGE_MS, AERIAL_POUNCE_DAMAGE_MUL,
  } = await import('../src/core/combat-wheel.mjs');
  const { resolveAttackYaw } = await import('../src/core/move-facing.mjs');

  // ---------- A. 迎击：早 / 准 / 晚 / 空闲 ----------
  eq(FOX_ATTACK_STATE, 'dash', '狐狸攻击有效窗口 = dash');
  const reach = 1.6;
  const base = { parryWindowT: 0.2, foxState: 'dash', dist: 1.2, reach, facingDot: 1 };

  const onTime = resolveParryOutcome(base);
  eq(onTime.success, true, '准：窗口内正面接住 dash → 迎击成功');
  eq(onTime.reason, 'success');

  // 早：玩家已出手（窗口仍在）但狐狸还在蓄力/绕圈/接近 —— 不算迎击。
  for (const st of ['wind', 'circle', 'roam', 'linger', 'abandon']) {
    const r = resolveParryOutcome({ ...base, foxState: st });
    eq(r.success, false, `早/非攻击态：狐狸 ${st} 不算迎击`);
    eq(r.foxAttacking, false);
    eq(r.reason, 'fox-not-attacking');
  }
  // 闲：狐狸空闲/巡逻，玩家普通碰到（无窗口） → 不算迎击。
  const idleTouch = resolveParryOutcome({ parryWindowT: 0, foxState: 'roam', dist: 0.9, reach, facingDot: 1 });
  eq(idleTouch.success, false, '狐狸空闲时普通接触不算迎击');
  eq(idleTouch.reason, 'timing');

  // 过早：输入后窗口已过期，狐狸 dash 才到 → 不算迎击。
  const expired = resolveParryOutcome({ ...base, parryWindowT: 0 });
  eq(expired.success, false, '窗口过期后才接触 = 过早，不算迎击');
  eq(expired.reason, 'timing');

  // 过晚：狐狸 dash 已结束（rest/被障碍拦停） → 不算迎击。
  const late = resolveParryOutcome({ ...base, foxState: 'rest' });
  eq(late.success, false, '狐狸冲刺结束后 = 过晚，不算迎击');
  eq(late.reason, 'fox-not-attacking');

  // 距离 / 朝向边界
  eq(resolveParryOutcome({ ...base, dist: reach + 0.01 }).success, false, '超出接触距离不算迎击');
  eq(resolveParryOutcome({ ...base, dist: reach + 0.01 }).reason, 'out-of-range');
  const edge = Math.cos(DEFAULT_PARRY_HALF_ANGLE);
  eq(resolveParryOutcome({ ...base, facingDot: edge }).success, true, '朝向恰在半角边界算正面');
  const off = resolveParryOutcome({ ...base, facingDot: edge - 0.01 });
  eq(off.success, false, '背后/侧面冲来的狐狸不能迎击');
  eq(off.reason, 'not-facing');
  // 自定义半角生效
  eq(resolveParryOutcome({ ...base, facingDot: 0, parryHalfAngle: Math.PI / 3 }).success, false,
    '自定义半角（60°）下侧向 90° 不算正面');

  // 模拟完整时序：wind 期出手 → dash 接触时窗口已过期 = 过早失败；
  // dash 前 0.2s 出手 → 接触时窗口仍在 = 成功。
  const WINDOW = 0.3;
  const timeline = (inputAt, contactAt, foxStateAtContact) => resolveParryOutcome({
    parryWindowT: Math.max(0, WINDOW - (contactAt - inputAt)),
    foxState: foxStateAtContact, dist: 1.0, reach, facingDot: 0.99,
  }).success;
  eq(timeline(0, 0.9, 'dash'), false, '狐狸 wind 期出手，0.9s 后 dash 接触：过早失败');
  eq(timeline(0.7, 0.9, 'dash'), true, 'dash 前 0.2s 出手：准时成功');
  eq(timeline(0.85, 0.9, 'rest'), false, '接触时冲刺已结束：过晚失败');

  // ---------- B. 站立连续短按：门控不含 observing，节奏=冷却 ----------
  eq(strikeGateOpen({ attackCD: 0, inBurrow: false }), true, '站立（非洞穴、无冷却）可以出招');
  eq(strikeGateOpen({ attackCD: 0.2, inBurrow: false }), false, '冷却中不能出招');
  eq(strikeGateOpen({ attackCD: 0, inBurrow: true }), false, '洞穴内不能攻击');
  // 门控参数里没有 observing：站立静止与移动共用同一节奏。
  eq(strikeGateOpen.length <= 1, true, '门控只接受 { attackCD, inBurrow }');

  // 站立连续短按时序模拟：0.58s 冷却节奏；冷却中点击被吞，之后点击稳定触发。
  {
    const COOLDOWN = 0.58;
    let cd = 0, t = 0;
    const dt = 1 / 120;
    const clicks = [0, 0.2, 0.6, 0.9, 1.2, 1.21, 1.8];
    const firedAt = [];
    let ci = 0;
    while (t <= 2.0 + 1e-9) {
      while (ci < clicks.length && Math.abs(clicks[ci] - t) < dt / 2) {
        if (strikeGateOpen({ attackCD: cd, inBurrow: false })) { firedAt.push(clicks[ci]); cd = COOLDOWN; }
        ci++;
      }
      cd = Math.max(0, cd - dt);
      t += dt;
    }
    assert.deepEqual(firedAt, [0, 0.6, 1.2, 1.8],
      `站立连续短按按 0.58s 节奏稳定触发（冷却中的 0.2/0.9/1.21 被吞），got ${firedAt}`);
    checks++;
  }

  // ---------- C. 攻击 yaw 来源 / 迎击接线（源码断言） ----------
  const main = fs.readFileSync('src/main.js', 'utf8');
  const strikeStart = main.indexOf('function strike(');
  const strikeEnd = main.indexOf('\nfunction ', strikeStart + 1);
  ok(strikeStart >= 0 && strikeEnd > strikeStart, 'strike() 源码存在');
  const strikeSrc = main.slice(strikeStart, strikeEnd);

  ok(strikeSrc.includes('strikeGateOpen(game)'), 'strike() 使用 strikeGateOpen 纯门控');
  ok(!/game\.observing/.test(strikeSrc), 'strike() 不再以 observing（站立静止）拦截出招');
  ok(!/allowObserving/.test(main), 'allowObserving 后门参数已移除');
  ok(strikeSrc.includes('resolveAttackYaw({'), 'strike() 攻击朝向来自 resolveAttackYaw');
  ok(!/controller\.forwardFlat/.test(strikeSrc), 'strike() 不再用相机 yaw 计算攻击扇形');
  ok(!/claw\.fire\([^)]*controller\.yaw/.test(strikeSrc), '爪痕特效不再用相机 yaw');
  ok(/claw\.fire\([^)]*attackYaw/.test(strikeSrc), '爪痕特效跟随攻击朝向');

  const contactStart = main.indexOf('// 接触伤害');
  ok(contactStart >= 0, '接触伤害段存在');
  const contactEnd = main.indexOf('// —— 应激轴', contactStart);
  const contactSrc = main.slice(contactStart, contactEnd);
  ok(contactSrc.includes('resolveParryOutcome({'), '迎击判定走 resolveParryOutcome 纯函数');
  ok(contactSrc.includes('foxState: f.state'), '迎击判定传入狐狸实时状态');
  ok(contactSrc.includes("hud.say('迎击成功"), '迎击成功反馈在真实成功分支（沙盒提示）');
  ok(contactSrc.indexOf("hud.say('迎击成功") > contactSrc.indexOf('if (parryOK) {'),
    '“迎击成功”只在判定成功之后播报');

  const gestureStart = main.indexOf('function triggerParryGesture(');
  const gestureEnd = main.indexOf('\nfunction ', gestureStart + 1);
  const gestureSrc = main.slice(gestureStart, gestureEnd);
  ok(!/迎击成功/.test(gestureSrc), '迎击输入（左滑出手）不再无条件播报“迎击成功”');

  // ---------- D. PC 输入路径 ----------
  // 纯函数契约：650ms 蓄力扑击 / 1500ms 自动释放 / 空中短按 0.55 倍弱化。
  eq(POUNCE_HOLD_MS, 650, '地面蓄力扑击阈值 650ms');
  eq(MAX_ATTACK_CHARGE_MS, 1500, '蓄力上限 1500ms');
  eq(AERIAL_POUNCE_DAMAGE_MUL, 0.55, '空中短按扑击 0.55 倍弱化');
  eq(resolveAttackRelease({ holdMs: 120, grounded: true }), 'tap', 'PC 左键短按 = 推击');
  eq(resolveAttackRelease({ holdMs: 649, grounded: true }), 'tap', '649ms 仍是推击');
  eq(resolveAttackRelease({ holdMs: 650, grounded: true }), 'lunge', '650ms = 扑击');
  eq(advanceAttackCharge(1490, 16).autoRelease, true, '1500ms 自动释放');
  eq(resolveAttackRelease({ holdMs: 1500, grounded: true }), 'lunge', '自动释放按扑击结算');
  eq(resolveAttackRelease({ holdMs: 80, grounded: false }), 'lunge', '空中短按 = 扑击');
  eq(isWeakAerialPounce({ holdMs: 80, grounded: false }), true, '空中短按扑击弱化');
  eq(isWeakAerialPounce({ holdMs: 650, grounded: false }), false, '空中蓄满扑击不弱化');

  // 键鼠接线（源码断言）：左键/键盘 attack → beginAttack/releaseAttack。
  ok(/window\.addEventListener\('keydown'[\s\S]*?beginAttack\('key'\)/.test(main), '键盘 attack 按下 beginAttack(key)');
  ok(/window\.addEventListener\('keyup'[\s\S]*?attackCharge\.via === 'key'[\s\S]*?releaseAttack\(\)/.test(main),
    '键盘 attack 松开 releaseAttack');
  ok(/canvas\.addEventListener\('mousedown'[\s\S]*?beginAttack\('mouse'\)/.test(main), '鼠标左键按下 beginAttack(mouse)');
  ok(/window\.addEventListener\('mouseup'[\s\S]*?attackCharge\.via === 'mouse'[\s\S]*?releaseAttack\(\)/.test(main),
    '鼠标左键松开 releaseAttack');
  ok(/releaseAttack\(\{ auto: true \}\)/.test(main), '蓄满自动释放走 releaseAttack({auto:true})');

  // 触屏路径不回归：attack action 仍走 begin/release。
  ok(/onAction:[\s\S]*?action === 'attack'[\s\S]*?beginAttack\('touch', pointerId\)/.test(main),
    '触屏 attack 按下 beginAttack(touch)');
  ok(/attackCharge\.pointerId === pointerId[\s\S]*?releaseAttack\(\)/.test(main), '触屏 attack 松开 releaseAttack');

  // 攻击 yaw 来源纯函数契约
  eq(resolveAttackYaw({ thirdPerson: true, cameraYaw: 1.1, bodyYaw: -0.7 }), -0.7, 'TP 攻击沿身体朝向');
  eq(resolveAttackYaw({ thirdPerson: false, cameraYaw: 1.1, bodyYaw: -0.7 }), 1.1, 'FP 攻击沿镜头朝向');

  console.log(`parry-window / standing-tap / PC-input: all assertions passed (${checks} checks)`);
})().catch((err) => { console.error(err); process.exit(1); });
