const assert = require('node:assert/strict');
(async () => {
const { PLAYER, FOX } = await import('../src/core/config.js');
const { strikeVolumeHit, foxAttackVerticalHit } = await import('../src/systems/combat.js');
const { objectivesComplete } = await import('../src/core/objectives.js');
const { stepFoxRecovery } = await import('../src/core/fox-motion.js');

const peak = PLAYER.jump.velocity ** 2 / (2 * PLAYER.jump.gravity);
const airtime = 2 * PLAYER.jump.velocity / PLAYER.jump.gravity;
assert(Math.abs(peak - 0.522) < 0.01);
assert(Math.abs(airtime - 0.653) < 0.02);

const hit = (forward, lateral, dy) => strikeVolumeHit({ forward, lateral,
  playerBottom: 0, targetBottom: 0.65 + dy, targetHeight: 0.2, range: 2.4 });
assert(hit(1.8, 0, 0), 'same-height target should hit');
assert(hit(1.8, 1.2, 0), 'wide forward arc should hit');
assert(!hit(-1.0, 0, 0), 'behind player must miss');
assert(!hit(2.5, 0, 0), 'out of range must miss');
assert(!hit(1.8, 0, 1.5), 'target above claw volume must miss');
assert(!hit(1.8, 0, -0.8), 'target below claw volume must miss');

const ground = (airHeight) => foxAttackVerticalHit({
  playerBottom: airHeight, playerHeight: PLAYER.collisionHeight,
  foxBottom: 0, foxHeight: FOX.collisionHeight.normal,
  groundAttackHeight: FOX.groundAttackHeight, mode: 'straight', state: 'dash',
});
assert(ground(0), 'standing player is vulnerable to straight dash');
assert(!ground(peak), 'jump apex clears ground attack box');
assert(ground(0.04), 'takeoff phase remains vulnerable');
assert(!foxAttackVerticalHit({ playerBottom: peak, playerHeight: PLAYER.collisionHeight,
  foxBottom: 0, foxHeight: 0.48, groundAttackHeight: FOX.groundAttackHeight, mode: 'leap', state: 'dash' }), 'leap below apex can still miss');
assert(foxAttackVerticalHit({ playerBottom: peak, playerHeight: PLAYER.collisionHeight,
  foxBottom: 0.45, foxHeight: 0.9, groundAttackHeight: FOX.groundAttackHeight, mode: 'leap', state: 'dash' }), 'leap intersecting air path can hit');
assert(!foxAttackVerticalHit({ playerBottom: 0, playerHeight: PLAYER.collisionHeight,
  foxBottom: 0, foxHeight: 0.5, groundAttackHeight: FOX.groundAttackHeight, mode: 'straight', state: 'roam' }), 'roaming fox is not an attack');

assert(FOX.handling.maxTurnRate < PLAYER.handling.turnRate);
assert(FOX.handling.brakeLerp < PLAYER.handling.brake);
assert(FOX.attacks.normal.turnRate < PLAYER.handling.turnRate);
assert(FOX.attacks.boss.turnRate < PLAYER.handling.turnRate);
assert(objectivesComplete({ foodCount: 3, foodGoal: 3, friendSaved: true, inBurrow: true }));
assert(!objectivesComplete({ foodCount: 3, foodGoal: 3, friendSaved: true, inBurrow: false }));
const recovery = stepFoxRecovery(1.15, 14.5, 0, 0.1);
assert.equal(recovery.state, 'rest');
assert(Math.hypot(recovery.vx, recovery.vz) <= FOX.handling.recoverySpeedMax);

console.log(JSON.stringify({ peak, airtime, recovery: { normal: 1.15, fast: 0.9, leap: 1.05 }, ok: true }));
})();
