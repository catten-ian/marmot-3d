import test from 'node:test';
import assert from 'node:assert/strict';
import { BETA_TUNE } from '../src/core/beta-tuning.js';
import {
  installEnergyAlias, fatConversionFraction, applyNutrition, ingestGraze,
  chewMouth, createFlowerRecovery, stepFlowerRecovery,
} from '../src/core/stamina.mjs';

const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);

test('stamina is canonical and legacy energy remains a two-way compatibility alias', () => {
  const p = installEnergyAlias({ energy: 70 });
  p.stamina = 64; assert.equal(p.energy, 64);
  p.energy = 72; assert.equal(p.stamina, 72);
});

test('fat curve is 0 through 60%, increasing above 60%, and 100% at full', () => {
  assert.equal(fatConversionFraction(50), 0);
  assert.equal(fatConversionFraction(60), 0);
  near(fatConversionFraction(80), 0.5);
  assert.equal(fatConversionFraction(100), 1);
  const a = applyNutrition({ stamina: 80, fat: 4 }, 10);
  near(a.stamina, 85); near(a.fat, 9);
  const full = applyNutrition({ stamina: 100, fat: 4 }, 10);
  near(full.stamina, 100); near(full.fat, 14);
  // No path removes fat; overflowing full stamina also conserves nutrition as fat.
  const crossing = applyNutrition({ stamina: 60, fat: 0 }, 80);
  near(crossing.stamina, 100); near(crossing.fat, 40);
});

test('mouth is finite, immediate share is small, overflow is explicit, chewing only works standing', () => {
  let s = ingestGraze({ stamina: 50, fat: 0, mouth: 0 }, 10);
  near(s.stamina, 51.2); near(s.mouth, 8.8); near(s.spilled, 0);
  assert.ok(BETA_TUNE.grazeImmediateShare < 0.2);
  s = ingestGraze({ stamina: 50, fat: 0, mouth: 35 }, 10);
  near(s.mouth, 36); near(s.spilled, 7.8);
  const moving = chewMouth(s, 1, { running: true });
  assert.equal(moving.chewed, 0); near(moving.mouth, 36);
  const grazing = chewMouth(s, 1, { grazing: true });
  assert.equal(grazing.chewed, 0); near(grazing.mouth, 36);
  const chewed = chewMouth(s, 1);
  near(chewed.chewed, BETA_TUNE.chewPerSec); near(chewed.mouth, 36 - BETA_TUNE.chewPerSec);
  assert.ok(chewed.stamina > s.stamina);
});

test('both burrows chew only the mouth; main > temporary and no mouth means zero recovery', () => {
  const initial = { stamina: 20, fat: 3, mouth: 20 };
  const main = chewMouth(initial, 1, { burrowType: 'base', running: true });
  const temp = chewMouth(initial, 1, { burrowType: 'shelter', running: true });
  near(main.chewed, BETA_TUNE.mainBurrowChewPerSec);
  near(temp.chewed, BETA_TUNE.temporaryBurrowChewPerSec);
  assert.ok(main.staminaGain > temp.staminaGain);
  assert.ok(main.mouth < temp.mouth);
  for (const burrowType of ['base', 'shelter']) {
    const empty = chewMouth({ stamina: 20, fat: 3, mouth: 0 }, 10, { burrowType });
    assert.equal(empty.chewed, 0); assert.equal(empty.staminaGain, 0);
    assert.equal(empty.fatGain, 0); assert.equal(empty.stamina, 20); assert.equal(empty.fat, 3);
  }
});

test('flower recovery has fixed total, diminishing equal-step rates, and is movement independent', () => {
  let recovery = createFlowerRecovery();
  let hp = 0, nutrition = 0, previousHp = Infinity;
  for (let i = 0; i < 8; i++) {
    const step = stepFlowerRecovery(recovery, 1, { running: i % 2 === 0 });
    assert.ok(step.hp < previousHp); previousHp = step.hp;
    hp += step.hp; nutrition += step.nutrition; recovery = step.recovery;
  }
  near(hp, BETA_TUNE.flowerHpTotal); near(nutrition, BETA_TUNE.flowerStaminaTotal);
  assert.equal(recovery, null);
  const converted = applyNutrition({ stamina: 100, fat: 0 }, BETA_TUNE.flowerStaminaTotal);
  assert.equal(converted.stamina, 100); near(converted.fat, BETA_TUNE.flowerStaminaTotal);
});
