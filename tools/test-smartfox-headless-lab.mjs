import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runScenario, runMatrix, createSeededRandom, selectMarmotTarget } from '../src/headless/smartfox-combat-lab.mjs';
import { BETA_TUNE, createSmartFoxSpawnState, createSmartFoxVitals } from '../src/core/beta-tuning.js';

test('headless lab is deterministic and uses fixed-step seeded scenarios', () => {
  const a = runScenario({ seed: 11, scenario: 'faceoff-tap', duration: 4 });
  const b = runScenario({ seed: 11, scenario: 'faceoff-tap', duration: 4 });
  assert.deepEqual(a, b);
  const r = createSeededRandom(11); assert.equal(r(), createSeededRandom(11)());
  assert.equal(a.ticks, 240); assert.deepEqual(a.invariants, []);
});

test('birth invariant is full and independent for custom limits', () => {
  const a = createSmartFoxSpawnState({}, createSmartFoxVitals(BETA_TUNE));
  const b = createSmartFoxSpawnState({}, createSmartFoxVitals({ ...BETA_TUNE, smartMaxHp: 9, smartMaxStamina: 180 }));
  assert.deepEqual([a.hp, a.maxHp, a.stamina, a.maxStamina], [4, 4, 100, 100]);
  assert.deepEqual([b.hp, b.maxHp, b.stamina, b.maxStamina], [9, 9, 180, 180]);
});

test('three requested openings run through real shared attack events', () => {
  const face = runScenario({ seed: 1001, scenario: 'faceoff-tap', movement: 'stationary', duration: 8 });
  const chase = runScenario({ seed: 1002, scenario: 'chase-pounce-tap', movement: 'chase', duration: 8 });
  const parry = runScenario({ seed: 1003, scenario: 'parry-tap', movement: 'stationary', duration: 8 });
  assert.equal(face.status, 'completed'); assert.ok(face.metrics.marmotHits > 0);
  assert.equal(chase.status, 'completed'); assert.ok(chase.metrics.pounceCommits > 0);
  assert.equal(parry.status, 'completed'); assert.equal(parry.metrics.parrySuccesses, 1);
  assert.ok(parry.events.some((e) => e.type === 'parry_success'));
});

test('matrix covers 1/2/4/8 foxes, one marmot, all moves/openings/seeds without NaN', () => {
  const rows = runMatrix({ seed: 20261031, duration: 6 });
  assert.equal(rows.length, 180);
  assert.ok(rows.every((r) => r.invariants.length === 0));
  assert.ok(rows.every((r) => r.status === 'completed'), JSON.stringify(rows.filter((r) => r.status !== 'completed').map((r) => ({ foxes:r.foxes.length, scenario:r.scenario, movement:r.movement, seed:r.seed, failure:r.failure }))));
  assert.ok(rows.every((r) => r.marmots.length === 1));
  for (const r of rows.filter((r) => r.scenario === 'parry-tap')) {
    const successes = r.events.filter((e) => e.type === 'parry_success');
    assert.equal(successes.length, 1);
    assert.ok(successes[0].distance <= successes[0].reach, 'success uses real production contact reach');
    assert.ok(r.events.some((e) => e.type === 'parry_attempt' && e.t <= successes[0].t && e.window > 0));
    assert.ok(r.events.some((e) => e.type === 'marmot_hit' && e.t > successes[0].t), 'real tap pressure follows the successful parry');
  }
  assert.deepEqual([...new Set(rows.map((r) => r.foxes.length))].sort((a, b) => a - b), [1, 2, 4, 8]);
  assert.deepEqual([...new Set(rows.map((r) => r.movement))].sort(), ['chase', 'kite', 'orbit', 'stationary', 'zigzag']);
  assert.deepEqual([...new Set(rows.map((r) => r.scenario))].sort(), ['chase-pounce-tap', 'faceoff-tap', 'parry-tap']);
});

test('4/8 fox scenarios exceed two distinct real attackers without a global two-commit cap', () => {
  for (const foxes of [4, 8]) {
    const result = runScenario({ seed: 20261031, scenario: 'faceoff-tap', movement: 'stationary', foxes, marmots: 99, duration: 6 });
    assert.equal(result.marmots.length, 1, 'lab always runs exactly one marmot');
    assert.ok(result.metrics.activeAttackers > 2, `${foxes} foxes: ${JSON.stringify(result.metrics)}`);
    assert.ok(result.foxes.filter((f) => f.attacks.commits + f.attacks.pounceStrikes + f.attacks.meleeStrikes > 0).length > 2);
    assert.ok(result.metrics.peakAttackRoles >= foxes);
    assert.ok(result.metrics.peakWindowCommits > 2, 'more than two real commits coexist in the production pack window');
  }
});


test('parry target selection follows a real windup attacker, not a closer idle fox', () => {
  const m = { x:0, z:0, parryCooldown:0 };
  const idle = { slot:0, alive:true, x:0, z:1, smart:{ pounceCommitted:false, pounceStage:null } };
  const attacker = { slot:1, alive:true, x:0, z:2.5, smart:{ pounceCommitted:true, pounceStage:'windup' } };
  const tooFar = { slot:2, alive:true, x:0, z:8, smart:{ pounceCommitted:true, pounceStage:'windup' } };
  assert.equal(selectMarmotTarget(m, [idle, attacker, tooFar], 'parry-tap'), attacker);
  assert.equal(selectMarmotTarget(m, [idle, tooFar], 'parry-tap'), tooFar, 'windup input may be armed at distance; contact still uses production reach');
  assert.equal(selectMarmotTarget(m, [idle, attacker], 'faceoff-tap'), idle);
});

test('live SmartFox and headless lab import the same decision core contract', async () => {
  const [live, lab] = await Promise.all([
    readFile(new URL('../src/entities/smart-fox.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/headless/smartfox-combat-lab.mjs', import.meta.url), 'utf8'),
  ]);
  for (const token of ['utilityScores', 'updatePerception', 'assignRoles', 'stepSmartMotion', 'advanceSmartMelee', 'stepStamina', 'shouldRetreat', 'smartPounceDashDurationForDistance']) {
    assert.match(live, new RegExp(`\\b${token}\\b`), token);
    assert.match(lab, new RegExp(`\\b${token}\\b`), token);
  }
});

test('dead SmartFox remains dead and is never healed or respawned in the same run', () => {
  // Test-only one-HP vitality makes the ordinary real marmot hit lethal; no HP
  // is assigned after spawn and no hit/death result is forced by the harness.
  const result = runScenario({ seed: 20261034, scenario: 'faceoff-tap', movement: 'stationary', foxes: 1, duration: 8, tune: { smartMaxHp: 1 } });
  const dead = result.foxes.filter((f) => f.dead);
  assert.ok(dead.length > 0);
  for (const f of dead) { assert.equal(f.hp, 0); assert.equal(f.state, 'dead'); }
});
