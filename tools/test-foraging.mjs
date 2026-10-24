import assert from 'node:assert/strict';
import {
  FORAGE, stepForageProgress, isForagingEmergency, chooseFlowerIndices, energyOfFlower,
} from '../src/core/ecology.js';

let p = 0;
for (let t = 0; t < FORAGE.grassSeconds; t += 0.01) p = stepForageProgress(p, 0.01, { inRange: true, kind: 'grass', emergency: false });
assert.ok(p >= .99);
let slow = 0;
for (let t = 0; t < FORAGE.grassSeconds; t += 0.01) slow = stepForageProgress(slow, 0.01, { inRange: true, kind: 'grass', emergency: true });
assert.ok(slow > 0 && slow < .4);
assert.ok(stepForageProgress(0, FORAGE.flowerSeconds, { inRange: true, kind: 'flower' }) >= .99);
assert.ok(stepForageProgress(0, FORAGE.berrySeconds, { inRange: true, kind: 'berry' }) >= .99);
assert.equal(stepForageProgress(.7, .1, { inRange: false }), 0);
let applied = 0; let progress = 0;
for (let i = 0; i < 20 && applied === 0; i++) { progress = stepForageProgress(progress, .1, { inRange: true, kind: 'flower' }); if (progress >= 1) { applied++; progress = 0; } }
assert.equal(applied, 1);
assert.equal(isForagingEmergency({ inBurrow: true, foxes: [{ x: 1, z: 0, alive: true }] }), false);
assert.equal(isForagingEmergency({ foxes: [{ x: 5, z: 0, alive: true }] }), true);
assert.equal(isForagingEmergency({ foxes: [{ x: 20, z: 0, alive: true }] }), false);
assert.equal(isForagingEmergency({ foxes: [{ x: 15, z: 0, alive: true, type: 'smart', pounceCommitted: true }] }), true);
assert.equal(isForagingEmergency({ sprinting: true }), true);
const a = chooseFlowerIndices(12, 2), b = chooseFlowerIndices(12, 2);
assert.deepEqual(a, b); assert.ok(a.length >= 1 && a.length <= 2); assert.equal(new Set(a).size, a.length); assert.ok(a.every((i) => i >= 0 && i < 12));
assert.ok(energyOfFlower() > 24);
console.log('foraging pure logic OK');
