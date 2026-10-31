const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const wolf = fs.readFileSync(path.join(root, 'assets/models/wolf.glb'));
assert.equal(wolf.readUInt32LE(0), 0x46546c67, 'wolf is GLB');
let off = 12; let gltf = null;
while (off < wolf.length) { const len = wolf.readUInt32LE(off); const type = wolf.readUInt32LE(off + 4); if (type === 0x4e4f534a) gltf = JSON.parse(wolf.subarray(off + 8, off + 8 + len).toString('utf8')); off += 8 + len; }
assert.ok(gltf, 'wolf JSON chunk exists');
assert.equal(gltf.skins?.[0]?.joints?.length, 44, 'wolf keeps all 44 bones');
assert.deepEqual(gltf.animations.map((x) => x.name).sort(), ['attack', 'idle', 'run']);
const fox = fs.readFileSync(path.join(root, 'src/entities/fox.js'), 'utf8');
const loader = fs.readFileSync(path.join(root, 'src/models/loader.js'), 'utf8');
assert.match(fox, /AnimationMixer/); assert.match(fox, /_setWolfAnimation/); assert.match(fox, /_triggerWolfAttack/);
assert.match(loader, /SkeletonUtils|cloneSkeleton/); assert.match(loader, /animations: gltf\.animations/);
console.log(JSON.stringify({ ok: true, bones: 44, clips: ['idle','run','attack'], bytes: wolf.length }, null, 2));
