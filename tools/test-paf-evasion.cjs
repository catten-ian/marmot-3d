/**
 * Stage 1 · A3 近距离 zigzag + A4 轨迹回避 纯逻辑测试。
 * 用法：node tools/test-paf-evasion.cjs
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadPafDefaults } = require('./paf-test-helper.cjs');

let pp, P;
test.before(async () => {
  pp = await import('../src/core/predator-prey.js');
  P = loadPafDefaults();
});

test('zigzag 触发：<10m 或 wind/lunge 启用，远距非威胁关闭', () => {
  assert.equal(pp.zigzagActive(9, false, P), true);
  assert.equal(pp.zigzagActive(10.5, false, P), false);
  assert.equal(pp.zigzagActive(30, true, P), true);
});

test('zigzag 初始化：sign=±1、偏角在 35°–60°、周期在包络 [0.224,0.54]s 内', () => {
  for (let i = 0; i < 1000; i++) {
    const z = pp.stepZigzag({ active: false }, true, 0.016, P);
    assert.ok(z.sign === 1 || z.sign === -1);
    assert.ok(z.angle >= pp.deg2rad(35) - 1e-9 && z.angle <= pp.deg2rad(60) + 1e-9);
    assert.ok(z.timer >= 0.28 * 0.8 - 1e-9 && z.timer <= 0.45 * 1.2 + 1e-9);
    assert.equal(z.active, true);
  }
});

test('zigzag 反转：周期到 sign 翻转且角度重抽，逐腿时长落在随机带', () => {
  const dt = 1 / 240;
  let z = { active: false };
  let legT = 0;
  const legDurations = [];
  const signs = [];
  for (let i = 0; i < 240 * 20; i++) { // 20s
    const prevSign = z.sign;
    z = pp.stepZigzag(z, true, dt, P);
    legT += dt;
    if (z.flipped) {
      legDurations.push(legT);
      signs.push([prevSign, z.sign]);
      legT = 0;
    }
  }
  assert.ok(legDurations.length > 25, `20s 内应反转 25 次以上，实际 ${legDurations.length}`);
  for (const d of legDurations) {
    assert.ok(d >= 0.28 * 0.8 - 0.02 && d <= 0.45 * 1.2 + 0.02, `越界腿时长 ${d}`);
  }
  assert.ok(signs.every(([a, b]) => a === -b), '每次必须反向');
  // 防背板：周期不应全部相同
  assert.ok(new Set(legDurations.map((d) => d.toFixed(3))).size > 3);
});

test('zigzag 停用立即复位（远距直线逃）', () => {
  let z = pp.stepZigzag({ active: false }, true, 0.016, P);
  z = pp.stepZigzag(z, false, 0.016, P);
  assert.deepEqual(z, { active: false, sign: 0, angle: 0, timer: 0, flipped: false });
});

test('zigzag 速度系数护栏：默认 0.9 且不低于 0.85', () => {
  assert.ok(P.zigzagSpeedFactor >= 0.85);
  assert.equal(P.zigzagSpeedFactor, 0.9);
});

test('A4 预测着陆点 = pos + dir(yaw) × lungeSpeed × lungeTime × 0.7', () => {
  const land = pp.predictLandingPoint(0, 0, 0, P);
  const reach = 13.5 * 0.42 * 0.7;
  assert.ok(Math.abs(land.x) < 1e-12);
  assert.ok(Math.abs(land.z - reach) < 1e-9);
  // yaw=90° → +x
  const side = pp.predictLandingPoint(1, 2, Math.PI / 2, P);
  assert.ok(Math.abs(side.x - (1 + reach)) < 1e-9 && Math.abs(side.z - 2) < 1e-9);
});

test('A4 回避向量：当前位置 0.4 / 着陆点 0.6 加权（侧向着陆点把逃向拉向反侧）', () => {
  // 猎物在原点，狐狸在 +x 10m，预测着陆点在 -x 10m：
  // 逃离狐狸 → -x，逃离着陆点 → +x；权重 0.4/0.6 合向量为 +x
  const ev = pp.evadeVector(0, 0, 10, 0, -10, 0, P);
  assert.equal(ev.ok, true);
  assert.ok(ev.x > 0.99, `合方向应 +x，实际 ${ev.x}`);
  assert.ok(Math.abs(ev.z) < 1e-9);
  // 两威胁源同向时直接反向
  const away = pp.evadeVector(0, 5, 0, 0, 0, 3.96, P);
  assert.ok(Math.abs(away.z - 1) < 1e-9 && Math.abs(away.x) < 1e-9);
  assert.ok(Math.abs(away.yaw) < 1e-9);
});

test('A4 退化：一个威胁源与猎物重合时权重自动让给另一源；都重合返回 ok:false', () => {
  // 狐狸贴在猎物上（a 零向量），着陆点在 +z → 应逃 -z
  const ev = pp.evadeVector(0, 0, 0, 0, 0, 8, P);
  assert.equal(ev.ok, true);
  assert.ok(Math.abs(ev.z + 1) < 1e-9);
  const none = pp.evadeVector(0, 0, 0, 0, 0, 0, P);
  assert.equal(none.ok, false);
});

test('权重可调（建议书：0.6 是起点，必须可调）', () => {
  assert.equal(P.evadeCurrentWeight, 0.4);
  assert.equal(P.evadeLandingWeight, 0.6);
  assert.equal(P.landingPredict, 0.7);
  const cfg2 = { ...P, evadeCurrentWeight: 1, evadeLandingWeight: 0 };
  const ev = pp.evadeVector(0, 0, 10, 0, -10, 0, cfg2);
  assert.ok(ev.x < -0.99, '全压当前位置权重时应逃 -x');
});
