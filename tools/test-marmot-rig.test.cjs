const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { createHash } = require('node:crypto');
const path = require('node:path');
const read = (p) => readFileSync(path.join(__dirname, '..', p), 'utf8');
const src = read('src/entities/marmot-rig.js').replace(/export /g, '');
const rig = new Function(`${src};return {MARMOT_CLIPS,MARMOT_MOVE_THRESHOLD,marmotClipForState,companionFollowStep,animationTransition};`)();

test('uploaded state mapping uses only the three supplied clips', () => {
  assert.deepEqual(rig.MARMOT_CLIPS, ['Run', 'StandIdle', 'StandUp']);
  for (const mode of ['idle', 'rest', 'groom', 'jump', 'interact', 'follow', 'move', 'sprint']) {
    assert.equal(rig.marmotClipForState(mode, 0), 'StandIdle', mode);
  }
  assert.equal(rig.marmotClipForState('eat', 0), 'Run');
  assert.equal(rig.marmotClipForState({ grazing: true }, 0), 'Run');
  assert.equal(rig.marmotClipForState('move', 3), 'Run');
  assert.equal(rig.marmotClipForState('sprint', 9), 'Run');
  assert.equal(rig.marmotClipForState('alert'), 'StandUp');
  assert.equal(rig.marmotClipForState({ emote: 'exclaim' }), 'StandUp');
  assert.equal(rig.marmotClipForState({ safe: true }, 3), 'Run');
});

test('follow animation is based on current displacement, including arrival and saved state', () => {
  const { companionFollowStep: step, marmotClipForState: clip } = rig;
  assert.equal(clip('follow', rig.MARMOT_MOVE_THRESHOLD), 'StandIdle');
  assert.equal(clip('follow', rig.MARMOT_MOVE_THRESHOLD + 0.001), 'Run');
  assert.equal(clip('follow', NaN), 'StandIdle');
  assert.equal(step(10, 0, 1.5, 7.2), 0);
  assert.equal(step(1, 1 / 60, 1.5, 7.2), 0);
  const dt = 1 / 60;
  let distance = 4;
  let moved = 0;
  for (let i = 0; i < 100; i++) {
    moved = step(distance, dt, 1.5, 7.2);
    assert.ok(moved <= Math.max(0, distance - 1.5));
    distance -= moved;
  }
  assert.equal(distance, 1.5);
  assert.equal(moved, 0);
  assert.equal(clip('follow', moved / dt), 'StandIdle');
  assert.equal(clip({ rest: true }, 0), 'StandIdle');
});

test('failed Beta loads retain the existing visible procedural fallback', () => {
  const main = read('src/main.js'), props = read('src/entities/props_entities.js');
  assert.match(main, /if \(!inst\) return;/);
  assert.match(main, /uploaded marmot unavailable; procedural fallback/);
  assert.match(props, /this\.proceduralMesh = buildMarmotMesh/);
  assert.match(props, /if \(!inst\) \{ this\.modelLevel = 'procedural'; return; \}/);
  assert.match(props, /this\.proceduralMesh\.visible = !useReal/);
});

test('clip transition does not restart an unchanged action', () => {
  assert.deepEqual(rig.animationTransition('Run', 'Run'), { changed: false, from: 'Run', to: 'Run', fade: 0 });
  assert.deepEqual(rig.animationTransition('StandIdle', 'Run', 0.16), { changed: true, from: 'StandIdle', to: 'Run', fade: 0.16 });
});

test('production asset matches the upload; real skin, embedded images, nonempty changing tracks', () => {
  const b = readFileSync(path.join(__dirname, '../assets/models/marmot-run-stand.glb'));
  assert.equal(b.length, 2445856);
  assert.equal(createHash('sha256').update(b).digest('hex'), '95bfb02b245af132cf4f3a73200bcd0c89f59fb09019e92b904de20a9b61e787');
  assert.equal(b.readUInt32LE(0), 0x46546c67);
  assert.equal(b.readUInt32LE(4), 2);
  assert.equal(b.readUInt32LE(8), b.length);
  const len = b.readUInt32LE(12), j = JSON.parse(b.subarray(20, 20 + len));
  const bin = b.subarray(28 + len);
  assert.equal(j.meshes.length, 1); assert.equal(j.skins.length, 1);
  assert.equal(j.skins[0].joints.length, 12); assert.equal(j.nodes.length, 14);
  assert.equal(j.images.length, 3); assert.ok(j.images.every((im) => Number.isInteger(im.bufferView) && !im.uri));
  assert.equal(j.nodes.filter((n) => n.mesh !== undefined && n.skin === 0).length, 1);
  assert.ok(j.meshes[0].primitives[0].attributes.JOINTS_0 !== undefined);
  assert.ok(j.meshes[0].primitives[0].attributes.WEIGHTS_0 !== undefined);
  assert.ok(!j.cameras && !j.extensions?.KHR_lights_punctual);
  const floats = (i) => {
    const a = j.accessors[i], v = j.bufferViews[a.bufferView];
    assert.equal(a.componentType, 5126);
    const n = { SCALAR: 1, VEC3: 3, VEC4: 4, MAT4: 16 }[a.type];
    const offset = (v.byteOffset || 0) + (a.byteOffset || 0);
    return Array.from({ length: a.count * n }, (_, k) => bin.readFloatLE(offset + k * 4));
  };
  const weights = floats(j.meshes[0].primitives[0].attributes.WEIGHTS_0);
  for (let i = 0; i < weights.length; i += 4) {
    const w = weights.slice(i, i + 4);
    assert.ok(w.every((v) => Number.isFinite(v) && v >= 0));
    assert.ok(Math.abs(w.reduce((a,b)=>a+b,0) - 1) < 1e-5);
  }
  const jointsAccessor = j.accessors[j.meshes[0].primitives[0].attributes.JOINTS_0];
  assert.equal(jointsAccessor.componentType, 5121);
  const jointsView = j.bufferViews[jointsAccessor.bufferView];
  const jointsOffset = (jointsView.byteOffset || 0) + (jointsAccessor.byteOffset || 0);
  assert.ok([...bin.subarray(jointsOffset, jointsOffset + jointsAccessor.count * 4)].every((i) => i < 12));
  assert.equal(j.accessors[j.skins[0].inverseBindMatrices].count, 12);
  for (const image of j.images) {
    const view = j.bufferViews[image.bufferView];
    assert.ok(view.byteLength > 0);assert.equal(bin.readUInt16BE(view.byteOffset || 0), 0xffd8);
  }
  assert.deepEqual(j.animations.map((a) => a.name).sort(), [...rig.MARMOT_CLIPS].sort());
  for (const a of j.animations) {
    assert.equal(a.channels.length, 36);
    let changing = 0;
    for (const ch of a.channels) {
      assert.ok(j.skins[0].joints.includes(ch.target.node));
      const s = a.samplers[ch.sampler], t = floats(s.input), values = floats(s.output);
      assert.ok(t.length > 1 && t.at(-1) > 0);
      assert.ok(values.every(Number.isFinite));
      const stride = values.length / t.length;
      if (values.some((x, k) => Math.abs(x - values[k % stride]) > 1e-5)) changing++;
    }
    assert.ok(changing > 0, `${a.name} must really change bone transforms`);
  }
});

test('Beta player/companion/preload use upload, other channel defaults remain marmot.glb', () => {
  const main = read('src/main.js'), props = read('src/entities/props_entities.js');
  assert.match(main, /if \(IS_BETA && USE_REAL_MODELS\)/);
  assert.match(main, /instantiate\('\.\/assets\/models\/marmot-run-stand.glb', 'marmot'\)/);
  assert.match(main, /new BetaMarmotModel\(inst, 0.9\)/);
  assert.match(main, /grazing: grazeTarget > 0/);
  assert.match(main, /marmotFile: IS_BETA \? 'marmot-run-stand.glb' : 'marmot.glb'/);
  assert.match(props, /IS_BETA \? 'marmot-run-stand.glb' : 'marmot.glb'/);
  assert.match(props, /IS_BETA \? new BetaMarmotModel/);
  assert.match(props, /if \(IS_BETA\) this\._lastFollowSpeed = 0/);
  assert.doesNotMatch(main + props, /marmot-screaming.glb/);
});
