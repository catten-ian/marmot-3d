/**
 * 藏狐自主撤退 / 驱退计数 / rest_safe 回血 / 旧口径"打不死、会增援、首领不回来"纯函数测试。
 * 覆盖 fox-motion.js：
 *   shouldRetreat / chooseRestPoint / enterRestSafe / stepRestSafe / exitRestSafe
 *   defeatFate / stepDefeatCooldown
 * 用法：node tools/test-fox-repel.cjs
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

let R, CFG, shouldRetreat, chooseRestPoint, enterRestSafe, stepRestSafe, exitRestSafe,
  defeatFate, stepDefeatCooldown, stepRetreatProgress;

test.before(async () => {
  const motion = await import('../src/core/fox-motion.js');
  const config = await import('../src/core/config.js');
  R = config.FOX.retreat;
  CFG = config;
  ({
    shouldRetreat, chooseRestPoint, enterRestSafe, stepRestSafe, exitRestSafe,
    defeatFate, stepDefeatCooldown, stepRetreatProgress,
  } = motion);
});

test('FOX.retreat 存在且数值方向正确（含独立回血配置）', () => {
  assert.ok(R);
  assert.ok(R.hpRatio > 0 && R.hpRatio < 1);
  assert.ok(R.staminaRatio > 0 && R.staminaRatio < 1);
  assert.ok(R.hitStreak >= 2);
  assert.ok(R.speed > 0);
  assert.ok(R.restSeconds.boss > R.restSeconds.normal); // 首领休息明显更长
  assert.ok(R.regenPerSec > 0, 'rest_safe 必须配置正的回血速率');
  assert.ok(R.restHealTarget > 0 && R.restHealTarget <= 1);
});

test('shouldRetreat：血量健康 + 体力充足 + 正在蓄力 → false（攻击中不撤退）', () => {
  assert.equal(shouldRetreat({ hpRatio: 0.1, staminaRatio: 0.1, hitStreak: 9, state: 'wind' }, R), false);
  assert.equal(shouldRetreat({ hpRatio: 0.1, staminaRatio: 0.1, hitStreak: 9, state: 'dash' }, R), false);
  assert.equal(shouldRetreat({ hpRatio: 1, staminaRatio: 1, hitStreak: 0, state: 'wind' }), false);
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
  assert.ok(rp.z < -20, `rest point should be near far burrow, got ${JSON.stringify(rp)}`);
});

test('chooseRestPoint：无可用洞穴 → 背离玩家方向，且在边界内', () => {
  const rp = chooseRestPoint({
    foxX: 5, foxZ: 5, playerX: -5, playerZ: -5, burrows: [], bounds: { hw: 74, hh: 44 },
  }, R);
  const away = (rp.x - -5) * (5 - -5) + (rp.z - -5) * (5 - -5);
  assert.ok(away > 0);
  assert.ok(Math.abs(rp.x) <= 70 && Math.abs(rp.z) <= 40);
});


test('chooseRestPoint：beta 导航余量把休息点放在洞穴避让带外', () => {
  const obstacles = [{ x: 18, z: 13, r: 5.65 }];
  const rp = chooseRestPoint({
    foxX: 5, foxZ: 7, playerX: 0, playerZ: 0,
    burrows: [{ x: 18, z: 13, r: 3.15 }], bounds: { hw: 74, hh: 44 }, obstacles,
  }, R);
  const required = obstacles[0].r + R.speed * 0.45 + R.arriveRadius + 0.35;
  assert.ok(Math.hypot(rp.x - 18, rp.z - 13) >= required - 1e-9,
    `rest point must clear navigation band: ${JSON.stringify({ rp, required })}`);
});

test('stepRetreatProgress：停滞和超时都给出有界迁移信号', () => {
  let p = { elapsed: 0, stall: 0, lastDistance: 10 };
  p = stepRetreatProgress(p, 10, 1, { stallLimit: 1.5, timeout: 4 });
  assert.equal(p.stalled, false);
  p = stepRetreatProgress(p, 10, 0.6, { stallLimit: 1.5, timeout: 4 });
  assert.equal(p.stalled, true);
  p = stepRetreatProgress({ elapsed: 3.9, stall: 0, lastDistance: 10 }, 9, 0.2, { timeout: 4 });
  assert.equal(p.timedOut, true);
  assert.equal(p.improved, true);
});

test('enterRestSafe：驱退计数只发生一次（连续进入不重复计数）', () => {
  const first = enterRestSafe({ repelCounted: false }, R.restSeconds.normal);
  assert.equal(first.state, 'rest_safe');
  assert.equal(first.justCounted, true);
  assert.equal(first.repelCounted, true);
  const again = enterRestSafe({ repelCounted: first.repelCounted }, R.restSeconds.normal);
  assert.equal(again.justCounted, false);
  assert.equal(again.repelCounted, true);
});

test('stepRestSafe：休息期间确实回复生命（不再白等）', () => {
  // 低血进入安全休息，推进 1 秒：hp 必须严格上升，timer 推进，未到点不 done
  const low = 2, maxHp = 10;
  const r1 = stepRestSafe({ timer: 6, hp: low, maxHp }, 1);
  assert.ok(r1.hp > low, `rest_safe 必须实际回血，got hp=${r1.hp}`);
  assert.ok(Math.abs(r1.hp - (low + maxHp * R.regenPerSec)) < 1e-9);
  assert.equal(r1.done, false);
});

test('stepRestSafe：回到目标血量或计时到 → done（且回血封顶不溢出）', () => {
  const rTimer = stepRestSafe({ timer: 0.05, hp: 3, maxHp: 10 }, 0.1);
  assert.equal(rTimer.done, true);
  const rFull = stepRestSafe({ timer: 5, hp: 10, maxHp: 10 }, 0.1);
  assert.equal(rFull.done, true); // 到目标血量提前结束
  assert.equal(rFull.hp, 10);
  const rMid = stepRestSafe({ timer: 5, hp: 3, maxHp: 10 }, 0.1);
  assert.equal(rMid.done, false);
  assert.ok(Math.abs(rMid.timer - 4.9) < 1e-9);
  // 回血不超过 maxHp × restHealTarget
  const capped = stepRestSafe({ timer: 99, hp: 9.99, maxHp: 10 }, 5);
  assert.ok(capped.hp <= 10 + 1e-9 && capped.done === true);
});

test('stepRestSafe：普通狐在一个休息周期内能从撤退线回到接近满血', () => {
  // 沙盒普通狐 maxHp=6；从撤退阈值附近开始，restSeconds.normal 内应回到目标（近满血/满血）
  const maxHp = CFG.FOX.types.normal.hp;
  let hp = maxHp * R.hpRatio;
  let timer = R.restSeconds.normal;
  let done = false;
  for (let i = 0; i < 200 && !done; i++) {
    const r = stepRestSafe({ timer, hp, maxHp }, 0.1);
    timer = r.timer; hp = r.hp; done = r.done;
  }
  assert.ok(done, '休息周期结束必须 done');
  assert.ok(hp >= maxHp * R.restHealTarget - 1e-6, `应回到目标血量，got ${hp}/${maxHp}`);
});

test('exitRestSafe：回到 roam，repelCounted 复位（允许第二次撤退再计数）', () => {
  const r = exitRestSafe();
  assert.equal(r.state, 'roam');
  assert.equal(r.retreating, false);
  assert.equal(r.restPoint, null);
  assert.equal(r.repelCounted, false);
  assert.equal(r.hitStreak, 0);
  const again = enterRestSafe({ repelCounted: r.repelCounted }, R.restSeconds.normal);
  assert.equal(again.justCounted, true);
});

test('defeatFate：普通狐打不死（会逃跑且增援），首领逃跑但一去不返', () => {
  for (const type of ['normal', 'pup', 'fast', 'heavy', 'smart']) {
    const fate = defeatFate(type);
    assert.equal(fate.flees, true, `${type} 血量归零必须先逃跑离场`);
    assert.equal(fate.respawns, true, `${type} 过段时间应增援回来`);
  }
  const boss = defeatFate('boss');
  assert.equal(boss.flees, true);      // 首领也有可见逃跑过程
  assert.equal(boss.respawns, false); // 但一去不返
});

test('stepDefeatCooldown：普通狐离场后倒数到 0 → shouldRespawn；首领永不重生', () => {
  // 增援 5 秒
  let cd = stepDefeatCooldown('normal', 5, 1);
  assert.equal(cd.shouldRespawn, false);
  assert.ok(cd.respawn < 5);
  cd = stepDefeatCooldown('normal', cd.respawn, 5); // 一次性走完
  assert.equal(cd.respawn, 0);
  assert.equal(cd.shouldRespawn, true);
  // boss：无论推进多久都不倒数、不重生
  for (let t = 0; t < 10; t++) {
    const b = stepDefeatCooldown('boss', 99, 1);
    assert.equal(b.shouldRespawn, false);
    assert.equal(b.respawn, 99);
  }
});

test('普通狐耐打：最强常规招（迎击 1.8）两下既打不死也打不跑', () => {
  const maxHp = CFG.FOX.types.normal.hp;
  const strongest = CFG.PLAYER.combatWheel.stand.damageMul; // 非大招常规最强一击
  assert.equal(strongest, 1.8);
  const hpAfter2 = maxHp - strongest * 2;
  assert.ok(hpAfter2 > 0, '两下不能打死（更不会 hp≤0 逃跑）');
  assert.ok(hpAfter2 / maxHp > R.hpRatio, '两下后血量比例仍高于自主撤退线（不会两下就打跑）');
  assert.ok(maxHp / strongest > 2, '击杀所需攻击次数必须明显多于 2');
});

test('撤退循环完整走一遍：roam → retreat → rest_safe(计一次+回血) → roam(复位)', () => {
  let fox = { state: 'roam', hp: 2, maxHp: 10, stamina: 90, maxStamina: 100, hitStreak: 0, repelCounted: false };
  assert.equal(shouldRetreat({ hpRatio: fox.hp / fox.maxHp, staminaRatio: fox.stamina / fox.maxStamina, hitStreak: 0, state: fox.state }, R), true);
  fox.state = 'retreat';
  const e1 = enterRestSafe(fox, R.restSeconds.normal);
  Object.assign(fox, e1);
  let counts = e1.justCounted ? 1 : 0;
  const hpBeforeRest = fox.hp;
  for (let i = 0; i < 200; i++) {
    const st = stepRestSafe({ timer: fox.timer, hp: fox.hp, maxHp: fox.maxHp }, 0.1);
    fox.timer = st.timer; fox.hp = st.hp;
    if (st.done) { Object.assign(fox, exitRestSafe()); break; }
  }
  assert.equal(counts, 1);
  assert.equal(fox.state, 'roam');
  assert.equal(fox.repelCounted, false);
  assert.ok(fox.hp > hpBeforeRest, '一个休息周期内血量应明显高于进入时');
  const e2 = enterRestSafe(fox, R.restSeconds.normal);
  assert.equal(e2.justCounted, true);
});
