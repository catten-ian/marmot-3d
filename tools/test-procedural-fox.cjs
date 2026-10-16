const assert = require('node:assert/strict');
const fs = require('node:fs');

class Color {
  constructor(value = 0xffffff) { this.set(value); }
  set(value) { this.value = typeof value === 'number' ? value : Number(value); return this; }
  copy(c) { this.value = c.value; return this; }
  multiplyScalar(n) { this.value = Math.round(this.value * n); return this; }
  getHSL() { return { l: ((this.value & 255) / 255) }; }
  setHSL(h, s, l) { this.value = Math.round(l * 255); return this; }
}
class Group {
  constructor() { this.children = []; this.position = vector(); this.rotation = vector(); this.scale = vector(); }
  add(o) { this.children.push(o); o.parent = this; }
}
class Mesh extends Group { constructor(geometry, material) { super(); this.geometry = geometry; this.material = material; } }
class Material { constructor({ color }) { this.color = new Color(color); } }
class Geometry { constructor(...args) { this.args = args; } }
function vector() { return { x: 0, y: 0, z: 0, set(x, y, z) { Object.assign(this, { x, y, z }); } }; }
const THREE = {
  Group, Mesh, Color, MeshLambertMaterial: Material,
  SphereGeometry: Geometry, ConeGeometry: Geometry, CylinderGeometry: Geometry,
};
(async () => {
  const source = fs.readFileSync('src/entities/procedural-fox.js', 'utf8')
    .replace("import * as THREE from 'three';", 'const THREE = globalThis.__THREE;');
  globalThis.__THREE = THREE;
  const { createProceduralFox } = await import(`data:text/javascript,${encodeURIComponent(source)}`);
  const fox = createProceduralFox();
  assert.ok(fox.root);
  assert.equal(fox.legs.length, 4);
  assert.ok(fox.tail && fox.head && fox.body);
  assert.equal(fox.ears.length, 2);
  assert.ok(fox.head.position.z > 0 && fox.muzzle.position.z > 0);
  const fur = fox.group.children[0].children[0].material.color.value;
  fox.setColor(0x336699);
  assert.notEqual(fox.group.children[0].children[0].material.color.value, fur);
  fox.setAnimState({ anim: 'idle', phase: 0 }); fox.update(0.2);
  const idle = fox.legs.map((leg) => leg.rotation.x);
  fox.setAnimState({ anim: 'walk', phase: 0 }); fox.update(0.2);
  assert.notDeepEqual(fox.legs.map((leg) => leg.rotation.x), idle);
  console.log('procedural fox: all assertions passed');
})().catch((error) => { console.error(error); process.exitCode = 1; });
