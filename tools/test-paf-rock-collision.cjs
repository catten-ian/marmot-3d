/* PAF 岩石碰撞推出：pushOutCircles 纯函数 + PAF 接入点静态断言 */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

async function main() {
  const { pushOutCircles } = await import('../src/core/predator-prey.js');

  // 1. 圆外不动
  {
    const p = { x: 10, z: 0 };
    assert.strictEqual(pushOutCircles(p, 0.5, [{ x: 0, z: 0, r: 2 }]), false);
    assert.deepStrictEqual(p, { x: 10, z: 0 });
  }
  // 2. 圆内沿径向推出到 r + bodyR 边界
  {
    const p = { x: 1, z: 0 };
    assert.strictEqual(pushOutCircles(p, 0.5, [{ x: 0, z: 0, r: 2 }]), true);
    const d = Math.hypot(p.x, p.z);
    assert.ok(Math.abs(d - 2.5) < 1e-9, `推出后距离 ${d} 应等于 2.5`);
    assert.ok(p.x > 0 && Math.abs(p.z) < 1e-9, '沿 +x 径向');
  }
  // 3. 恰在圆心：沿 +x 推出（不 NaN）
  {
    const p = { x: 0, z: 0 };
    pushOutCircles(p, 0.5, [{ x: 0, z: 0, r: 2 }]);
    assert.ok(Number.isFinite(p.x) && Number.isFinite(p.z));
    assert.ok(Math.abs(Math.hypot(p.x, p.z) - 2.5) < 1e-9);
  }
  // 4. 多障碍连续推出；null/空数组安全
  {
    const p = { x: 0, z: 0 };
    const cols = [{ x: 1, z: 0, r: 1.5 }, { x: -3, z: 0, r: 1 }];
    pushOutCircles(p, 0.5, cols);
    for (const c of cols) assert.ok(Math.hypot(p.x - c.x, p.z - c.z) >= c.r + 0.5 - 1e-9);
    assert.strictEqual(pushOutCircles(p, 0.5, null), false);
    assert.strictEqual(pushOutCircles(p, 0.5, []), false);
  }
  // 5. 斜向进入：方向保持径向
  {
    const p = { x: 0.5, z: 0.5 };
    pushOutCircles(p, 0.4, [{ x: 0, z: 0, r: 1 }]);
    const d = Math.hypot(p.x, p.z);
    assert.ok(Math.abs(d - 1.4) < 1e-9);
    assert.ok(Math.abs(p.x - p.z) < 1e-9, '45° 径向');
  }

  // 6. PAF 接入点静态断言
  const src = fs.readFileSync(path.join(__dirname, '../src/play/play-as-fox.js'), 'utf8');
  assert.ok(/pushOutCircles\(fox, cfg\.foxRadius/.test(src), '狐狸移动须接岩石推出');
  assert.ok(/pushOutCircles\(this, cfg\.preyRadius/.test(src), '猎物移动须接岩石推出');
  assert.ok(/ctx\.scenery\?\.rockColliders/.test(src), '须从 ctx.scenery 取碰撞体');
  assert.ok(/fox\.yaw -= e\.movementX/.test(src), '鼠标转向须与正常模式同号（-=）');
  assert.ok(/applyLookDelta\(look, -e\.movementX/.test(src), 'FPV 鼠标须取反 dx');
  const mainSrc = fs.readFileSync(path.join(__dirname, '../src/main.js'), 'utf8');
  assert.ok(/touchControls, binds, scenery,/.test(mainSrc), 'main.js 须传 scenery 入 PAF ctx');

  console.log('test-paf-rock-collision: PASS');
}
main().catch((e) => { console.error(e); process.exit(1); });
