'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const lib = require('./lib/glb-offline.cjs');
const file = path.join(__dirname, '..', 'assets/models/marmot-screaming.glb');

test('marmot GLB skins have matching joints and inverse bind matrices', () => {
  const {gltf, bin} = lib.parseGLB(file);
  assert.equal(gltf.skins.length, 3);
  for (const [i, skin] of gltf.skins.entries()) {
    const raw = lib.readAccessor(gltf, bin, skin.inverseBindMatrices);
    assert.equal(raw.count, skin.joints.length, `skin ${i}`);
  }
});

test('linear blend skinning changes a weighted vertex and preserves zero weights', () => {
  const {gltf, bin} = lib.parseGLB(file);
  const prims = lib.buildPrimitives(gltf, bin, {tintNearBlack:true});
  const skinned = prims.filter(p => p.skinIndex !== null);
  assert.ok(skinned.length >= 2);
  let changed = 0;
  for (const p of skinned) {
    const raw = lib.buildPrimitives(gltf, bin, {tintNearBlack:true, applySkin:false}).find(q => q.skinIndex === p.skinIndex);
    let localMax = 0;
    for (let i=0;i<p.P[0].length;i++) {
      localMax = Math.max(localMax, Math.hypot(p.P[0][i]-raw.P[0][i], p.P[1][i]-raw.P[1][i], p.P[2][i]-raw.P[2][i]));
    }
    if (localMax > 1e-5) changed++;
  }
  assert.ok(changed >= 1, 'at least one skinned primitive must move');
  const fakeSkin={matrices:[lib.mat4Identity()]};
  const zero=lib.skinVertex(fakeSkin,{data:[new Float64Array([0]),new Float64Array([0]),new Float64Array([0]),new Float64Array([0])]}, {data:[new Float64Array([0]),new Float64Array([0]),new Float64Array([0]),new Float64Array([0])]},0,[1,2,3],[0,1,0]);
  assert.deepEqual(zero.p,[1,2,3]);
  assert.deepEqual(zero.n,[0,1,0]);
});
