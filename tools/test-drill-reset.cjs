/* 沙盒迎击练习复位（SANDBOX-1 回归）：
 * 旧实现 setTimeout 回调引用未定义变量 p，350ms 后必崩。
 * 这里测抽离出的纯 helper：复位坐标在玩家正前方，狐狸血量/状态/击退速度全部清零。 */
const assert = require('node:assert/strict');

(async () => {
  const { drillRespawnPose, resetDrillFox } = await import('../src/sandbox/drill.js');

  // yaw=0（朝 -Z）：复位点在玩家前方 7m 的 -Z 方向。
  const front = drillRespawnPose({ px: 0, pz: 0, yaw: 0, dist: 7 });
  assert.ok(Math.abs(front.x - 0) < 1e-12);
  assert.ok(Math.abs(front.z + 7) < 1e-12);

  // 自定义距离与朝向（朝 +X，yaw=-π/2）。
  const east = drillRespawnPose({ px: 3, pz: -2, yaw: -Math.PI / 2, dist: 7 });
  assert.ok(Math.abs(east.x - 10) < 1e-9);
  assert.ok(Math.abs(east.z + 2) < 1e-9);

  // 非法距离安全回退 7；缺参零值不崩。
  assert.ok(Math.abs(drillRespawnPose({}).z + 7) < 1e-12);
  assert.ok(Math.abs(drillRespawnPose({ px: 1, pz: 1, yaw: 0, dist: NaN }).z + 6) < 1e-9);

  // resetDrillFox：血量回满、状态 roam、击退速度/跃起清零。
  const f = { maxHp: 40, hp: 3, state: 'flee', knockbackVX: 9, knockbackVZ: -4, leap: 1.4 };
  resetDrillFox(f);
  assert.equal(f.hp, 40);
  assert.equal(f.state, 'roam');
  assert.equal(f.knockbackVX, 0);
  assert.equal(f.knockbackVZ, 0);
  assert.equal(f.leap, 0);
  assert.equal(resetDrillFox(null), null, '空对象安全返回');

  // 静态检查：main.js 不再引用未定义的 p，且坐标在 setTimeout 之前捕获。
  const fs = require('node:fs');
  const path = require('node:path');
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
  assert.ok(src.includes("drillRespawnPose({"), 'scheduleDrillReset 使用 drillRespawnPose');
  const fn = src.slice(src.indexOf('function scheduleDrillReset'), src.indexOf('function hitFox'));
  assert.ok(/const pose = drillRespawnPose\([\s\S]*?\);[\s\S]*?setTimeout/.test(fn), 'pose 在 setTimeout 之前捕获');
  assert.ok(!/f\.respawnAt\(p\.x/.test(fn), '不再引用未定义变量 p');
  assert.ok(fn.includes('resetDrillFox(f)'), '回调中调用 resetDrillFox 复位血量/状态/击退');

  console.log('drill reset logic: all assertions passed');
})().catch((e) => { console.error(e); process.exit(1); });
