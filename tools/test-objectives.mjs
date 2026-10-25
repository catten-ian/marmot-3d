import test from 'node:test';
import assert from 'node:assert/strict';
import { objectivesComplete } from '../src/core/objectives.js';
import { LEVELS } from '../src/core/config.js';

test('beta campaign objective uses configured irreversible fat rather than food count', () => {
  const common = { foodCount: 0, foodGoal: 4, fatGoal: 24, friendSaved: true, inBurrow: true };
  assert.equal(objectivesComplete({ ...common, fat: 23, beta: true }), false);
  assert.equal(objectivesComplete({ ...common, fat: 24, beta: true }), true);
  assert.equal(objectivesComplete({ ...common, foodCount: 99, fat: 0, beta: true }), false);
  assert.equal(objectivesComplete({ ...common, fat: 24, beta: true, inBurrow: false }), false);
  assert.equal(objectivesComplete({ ...common, foodCount: 4, fat: 0, beta: false }), true);
  for (const level of LEVELS) assert.ok(level.fatGoal > 0, `${level.name} needs a fat target`);
});
