/* 多洞/避敌/小地图契约测试：不启动 WebGL，不依赖浏览器。 */
const fs = require('fs');
const config = fs.readFileSync('src/core/config.js', 'utf8');
const fox = fs.readFileSync('src/entities/fox.js', 'utf8');
const minimap = fs.readFileSync('src/ui/minimap.js', 'utf8');

function assert(ok, msg) { if (!ok) throw new Error(msg); }
const burrowRows = [...config.matchAll(/\{ id: '([^']+)', type: '(base|shelter)', x: (-?\d+), z: (-?\d+), r: ([\d.]+)/g)]
  .map((m) => ({ id: m[1], type: m[2], x: +m[3], z: +m[4], r: +m[5] }));
const base = config.match(/export const BURROW = \{ x: (-?\d+), z: (-?\d+), r: ([\d.]+)/);
assert(base, '兼容 BURROW 缺失');
burrowRows.unshift({ id: 'base', type: 'base', x: +base[1], z: +base[2], r: +base[3] });
assert(burrowRows.length >= 4, '需要主洞 + 至少 3 个临时洞');
assert(burrowRows.filter((b) => b.type === 'base').length === 1, '主洞必须唯一');
assert(burrowRows.filter((b) => b.type === 'shelter').every((b) => b.r < burrowRows[0].r), '临时洞半径必须小于主洞');

const berries = [[-28,-24],[-14,8],[-4,-32],[10,20],[30,12],[44,-24],[32,30],[16,-18],[-22,26],[4,0],[50,28],[-34,-6]];
const spawns = [[50,-28],[46,30],[26,-32],[56,4],[22,32],[38,-18],[-8,34],[0,-34]];
const rocks = [[-20,-14,3.4],[8,26,4.1],[34,-8,3],[-30,16,3.6],[18,-26,2.7],[42,20,3.3],[-2,34,3.8],[26,34,2.4],[-44,-26,4.4],[50,-14,3.2],[-36,-34,3.6],[12,-6,2.2]];
for (const b of burrowRows) {
  assert(Math.abs(b.x) + b.r <= 65 && Math.abs(b.z) + b.r <= 39, `${b.id} 越界`);
  for (const [x,z,r] of rocks) assert(Math.hypot(b.x-x,b.z-z) >= b.r+r+2, `${b.id} 与岩石过近`);
  for (const [x,z] of [...berries,...spawns]) assert(Math.hypot(b.x-x,b.z-z) >= b.r+2, `${b.id} 与点位过近`);
}
assert(fox.includes("case 'linger'") && fox.includes("case 'abandon'"), '狐狸缺少徘徊/放弃状态');
assert(fox.includes('alertCooldown') && fox.includes('exitMemory'), '狐狸缺少出洞警戒冷却');
assert(fox.includes('Array.isArray(burrows)'), '狐狸导航未覆盖多洞');
assert(minimap.includes('base') && minimap.includes('shelters') && minimap.includes('berries') && minimap.includes('foxes'), '小地图标记集合不完整');
console.log(JSON.stringify({ ok: true, burrows: burrowRows.length, checks: ['classification','scaled-layout-contract','avoidance','fox-linger-abandon-memory','minimap-markers'] }, null, 2));
