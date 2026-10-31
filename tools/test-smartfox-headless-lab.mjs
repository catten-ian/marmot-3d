import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runScenario, runMatrix, createSeededRandom } from '../src/headless/smartfox-combat-lab.mjs';
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

test('matrix covers single/team/multi-target pressure and no NaN invariants', () => {
  const rows = runMatrix({ seed: 20261031, duration: 4 });
  assert.equal(rows.length, 5); assert.ok(rows.every((r) => r.status === 'completed'));
  assert.ok(rows.every((r) => r.invariants.length === 0));
  assert.ok(rows.some((r) => r.foxes.length === 8 && r.marmots.length === 4));
});

test('live SmartFox and headless lab import the same decision core contract', async () => {
  const [live, lab] = await Promise.all([
    readFile(new URL('../src/entities/smart-fox.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/headless/smartfox-combat-lab.mjs', import.meta.url), 'utf8'),
  ]);
  for (const token of ['utilityScores', 'updatePerception', 'assignRoles', 'stepSmartMotion', 'advanceSmartMelee', 'stepStamina', 'shouldRetreat']) {
    assert.match(live, new RegExp(`\\b${token}\\b`), token);
    assert.match(lab, new RegExp(`\\b${token}\\b`), token);
  }
});

test('dead SmartFox remains dead and is never healed or respawned in the same run', () => {
  const result = runScenario({ seed: 20261034, scenario: 'chase-pounce-tap', movement: 'orbit', foxes: 8, marmots: 4, duration: 8 });
  const dead = result.foxes.filter((f) => f.dead);
  assert.ok(dead.length > 0);
  for (const f of dead) { assert.equal(f.hp, 0); assert.equal(f.state, 'dead'); }
});
