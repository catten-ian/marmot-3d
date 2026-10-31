/* 地下洞穴纯 Node 契约测试：不启动浏览器/WebGL。 */
const fs = require('fs');
const config = fs.readFileSync('src/core/config.js', 'utf8');
const underground = fs.readFileSync('src/world/underground.js', 'utf8');
const controls = fs.readFileSync('src/core/controls.js', 'utf8');
const props = fs.readFileSync('src/world/props.js', 'utf8');
const main = fs.readFileSync('src/main.js', 'utf8');
const assert = (ok, msg) => { if (!ok) throw new Error(msg); };

assert(config.includes('openingRadius') && config.includes('slopeRadius') && config.includes('chamberDepth'), '洞穴地下参数缺失');
assert(config.includes('warmLight: true') && config.includes('warmLight: false'), '主洞/临时洞光照配置缺失');
assert(underground.includes('undergroundFloorY') && underground.includes('burrowVolumeAt'), '地下高度/体积 API 缺失');
assert(controls.includes('undergroundFloorY'), '玩家控制器未跟随地下地板');
assert(props.includes('CylinderGeometry') && props.includes('chamberDepth'), '洞穴没有暗腔/竖井几何');
assert(main.includes('burrowVolumeAt(p.x, controller.position.y, p.z'), 'inBurrow 仍按地表半径误判');

const defs = [
  { id: 'base', type: 'base', x: -52, z: 0, r: 8.2, openingRadius: 2.2, slopeRadius: 5.8, chamberRadius: 4.6, chamberDepth: 3.8 },
  { id: 'shelter', type: 'shelter', x: 18, z: 13, r: 3.15, openingRadius: 1.05, slopeRadius: 2.6, chamberRadius: 2, chamberDepth: 2 },
];
const surface = () => 0;
const floor = (x, z, b) => {
  const d = Math.hypot(x - b.x, z - b.z);
  if (d >= b.slopeRadius) return surface(x, z);
  const t = 1 - d / b.slopeRadius, e = t * t * (3 - 2 * t);
  return -b.chamberDepth * e;
};
const inside = (x, y, z, b) => Math.hypot(x - b.x, z - b.z) <= b.slopeRadius && y < -0.18 && y <= floor(x, z, b) + 0.7;
for (const b of defs) {
  assert(b.openingRadius > 0 && b.slopeRadius > b.openingRadius && b.chamberDepth > 0, `${b.id} 缺少开口/斜坡/腔室深度`);
  assert(Math.abs(floor(b.x, b.z, b)) >= b.chamberDepth - 1e-6, `${b.id} 地下深度未生效`);
  assert(inside(b.x, -b.chamberDepth, b.z, b), `${b.id} 腔室应判定为地下`);
  assert(!inside(b.x + b.r + 1, 0, b.z, b), `${b.id} 洞外装饰不应判定为地下`);
  assert(floor(b.x + b.slopeRadius + 1, b.z, b) === 0, `${b.id} 斜坡外应回到地表`);
}
assert(Math.abs(floor(defs[0].x, defs[0].z, defs[0])) > Math.abs(floor(defs[1].x, defs[1].z, defs[1])), '主洞地下深度应大于临时洞');
console.log(JSON.stringify({ ok: true, checks: ['surface-opening', 'slope-and-chamber-depth', 'underground-volume', 'fox-ground-contract', 'lighting-config'] }, null, 2));
