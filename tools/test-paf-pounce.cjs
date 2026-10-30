/**
 * Stage 1 · B1 扑击 lead/重瞄护栏 + B2 垂直捕获窗 + E3 重生防贴脸 纯逻辑测试。
 * 用法：node tools/test-paf-pounce.cjs
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadPafDefaults } = require('./paf-test-helper.cjs');

let pp, P;
test.before(async () => {
  pp = await import('../src/core/predator-prey.js');
  P = loadPafDefaults();
});

// —— B1 lead 提前量 ——

test('lead 时间 = wind 剩余 + lungeTime × 0.45', () => {
  assert.equal(P.leadLungeFraction, 0.45);
  const t = pp.windLeadTime(0.22, P);
  assert.ok(Math.abs(t - (0.22 + 0.42 * 0.45)) < 1e-12);
});

test('lead 目标点 = 猎物位置 + 速度 × leadTime', () => {
  const t = pp.windLeadTime(0.22, P);
  const aim = pp.leadTarget(0, 8, 5, 0, t);
  assert.ok(Math.abs(aim.z - 8) < 1e-12);
  assert.ok(Math.abs(aim.x - 5 * t) < 1e-12);
});

test('wind 重瞄：大偏差被钳到相对起始朝向 ±12°', () => {
  const yaw = pp.retargetWindYaw({
    startYaw: 0, yaw: 0, desiredYaw: Math.PI / 2, // 目标偏 90°
    progress: 0.3, dt: 1,
  }, P); // dt 很大 → 阻尼一步到位
  assert.ok(Math.abs(yaw - pp.deg2rad(12)) < 1e-5, `应钳到 +12°，实际 ${yaw}`);
  const yaw2 = pp.retargetWindYaw({
    startYaw: 0, yaw: 0, desiredYaw: -Math.PI / 2, progress: 0.3, dt: 1,
  }, P);
  assert.ok(Math.abs(yaw2 + pp.deg2rad(12)) < 1e-5);
});

test('wind 重瞄：60% 后锁定，不再跟随期望朝向', () => {
  const yaw = pp.retargetWindYaw({
    startYaw: 0, yaw: pp.deg2rad(5), desiredYaw: Math.PI / 2, progress: 0.61, dt: 1,
  }, P);
  assert.ok(Math.abs(yaw - pp.deg2rad(5)) < 1e-12);
  // 恰在 60% 仍允许重瞄
  const yaw2 = pp.retargetWindYaw({
    startYaw: 0, yaw: 0, desiredYaw: Math.PI / 2, progress: 0.6, dt: 1,
  }, P);
  assert.ok(Math.abs(yaw2 - pp.deg2rad(12)) < 1e-5);
});

test('wind 重瞄：渐进缓转而非瞬移（小 dt 只转一小步），且累计不越 12°', () => {
  let yaw = 0;
  let maxDelta = 0;
  for (let i = 0; i < 12; i++) {
    yaw = pp.retargetWindYaw({ startYaw: 0, yaw, desiredYaw: Math.PI / 2, progress: 0.3, dt: 1 / 60 }, P);
    maxDelta = Math.max(maxDelta, Math.abs(yaw));
  }
  assert.ok(yaw < pp.deg2rad(12), '12 帧（0.2s）不应一步打满 12°');
  assert.ok(yaw > pp.deg2rad(2), '应有可见缓转');
  assert.ok(maxDelta <= pp.deg2rad(12) + 1e-9);
});

test('lunge 语义：retarget 之外锁定方向（调用方零微调）——wind 起始基准可记录', () => {
  // 护栏参数存在且为建议值
  assert.equal(P.windRetargetDeg, 12);
  assert.equal(P.windRetargetFrac, 0.6);
});

// —— B2 垂直捕获窗 ——

test('B2 同高度贴身命中；水平超距不命中', () => {
  assert.equal(pp.canCatch(1, 0, 0, 0, P), true);
  assert.equal(P.catchRadius, 1.25);
  assert.equal(pp.canCatch(1.249, 0, 0, 0, P), true);
  assert.equal(pp.canCatch(1.25, 0, 0, 0, P), false); // strict collision reach contract
});

test('B2 腾空越过头顶不算命中（apex 1.05m 时 |1.05+0.45-0.45|=1.05 ≥ 0.8）', () => {
  // 水平重叠但狐狸在猎物上方掠过
  assert.equal(pp.canCatch(0.2, 0, 1.05, 0, P), false);
  // 上升/下落段 airY=0.3 仍在垂直窗内 → 命中
  assert.equal(pp.canCatch(0.2, 0, 0.3, 0, P), true);
  // 落地瞬间 airY=0 → 命中
  assert.equal(pp.canCatch(0.2, 0, 0, 0, P), true);
});

test('B2 地形高度差参与计算（坡地上两侧基准各自 terrain+center）', () => {
  // 狐狸所在地面比猎物低 1m：airY=0 时狐狸命中中心 -1 → 差值 1.0，窗外
  assert.equal(pp.canCatch(0.2, 0, 0, 1, P), false);
});

test('B2 坡地同高仍可命中：狐狸地面基准显式参与垂直窗', () => {
  assert.equal(pp.canCatch(0.2, 0, 0, 1, P, 1), true);
  assert.equal(pp.canCatch(0.2, 0, 1.05, 1, P, 1), false);
});

// —— E3 重生防贴脸 ——

test('E3 合格点：≥18m 且在视线中心 ±35° 之外', () => {
  const ok = pp.isRespawnOk;
  assert.equal(ok(0, 20, 0, 0, 0, P), false);  // 正前方 20m：视角内
  assert.equal(ok(20, 0, 0, 0, 0, P), true);   // 正侧方
  assert.equal(ok(0, -20, 0, 0, 0, P), true);  // 正后方
  assert.equal(ok(0, 17.9, 0, 0, 0, P), false);// 距离不足
  assert.equal(ok(0, 18, 0, 0, 0, P), false);  // 边界：距离=18 但视角内
  // 视角边界 35°（避开 sin/cos 重构的 1ulp 误差，取 34.9°/35.1°）
  const inA = pp.deg2rad(34.9), outA = pp.deg2rad(35.1);
  assert.equal(ok(Math.sin(inA) * 20, Math.cos(inA) * 20, 0, 0, 0, P), false);
  assert.equal(ok(Math.sin(outA) * 20, Math.cos(outA) * 20, 0, 0, 0, P), true);
});

test('E3 正常随机：首个候选合格即采用并记录 attempts=1', () => {
  // rng: 第一次给角度 a=π（→ -x），第二次给半径 23.75：在狐狸正后方且够远
  const calls = [0.5, 0.5];
  let i = 0;
  const rng = () => calls[i++];
  const got = pp.pickRespawnPoint({ hw: 71, hh: 45 }, { x: 0, z: 0, yaw: 0 }, P, rng);
  assert.equal(got.ok, true);
  assert.equal(got.attempts, 1);
  assert.ok(Math.abs(got.x - (-23.75)) < 1e-9, JSON.stringify(got));
});

test('E3 退化：连续 20 次不合格 → ok:false、attempts=20、取最远候选', () => {
  // rng 恒 0：a=0（正前方），r=8（贴脸），永远不合格
  const got = pp.pickRespawnPoint({ hw: 71, hh: 45 }, { x: 0, z: 0, yaw: 0 }, P, () => 0);
  assert.equal(got.ok, false);
  assert.equal(got.attempts, 20);
  assert.ok(Math.abs(got.x - 8) < 1e-9 && got.z === 0);
  assert.equal(got.dist, 8);
});

test('E3 退化取最远：第 2 次候选最远时返回它', () => {
  // 序列：候选1 (a=0 → +x, r=8) 贴脸；候选2 (a=π/2 → +z, r=30) 但 yaw=0 正前视角内
  const seq = [0, 0, 0.25, (30 - 8) / (45 * 0.7), ...new Array(40).fill(0)];
  let i = 0;
  const got = pp.pickRespawnPoint({ hw: 71, hh: 45 }, { x: 0, z: 0, yaw: 0 }, P, () => seq[i++]);
  assert.equal(got.ok, false);
  assert.ok(Math.abs(got.z - 30) < 1e-9, JSON.stringify(got));
  assert.equal(got.dist, 30);
});
