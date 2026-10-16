const assert = require('node:assert/strict');
(async () => {
  const { selectAttackMove, selectAttackMoveFromInput } = await import('../src/core/combat-wheel.mjs');
  assert.equal(selectAttackMove({ dx: 5, dy: 5, moved: true }), 'tap');
  assert.equal(selectAttackMove({ dx: 0, dy: -30, moved: true }), 'lunge');
  assert.equal(selectAttackMove({ dx: -30, dy: 0, moved: true }), 'stand');
  assert.equal(selectAttackMove({ dx: 30, dy: 0, moved: true }), 'dodge');
  assert.equal(selectAttackMove({ dx: 30, dy: -10, moved: true }), 'dodge');
  assert.equal(selectAttackMove({ dx: -30, dy: -10, moved: true }), 'stand');
  assert.equal(selectAttackMove({ dx: 0, dy: 20, moved: true }), 'tap');
  assert.equal(selectAttackMoveFromInput(0, 1), 'lunge');
  assert.equal(selectAttackMoveFromInput(-1, 0), 'stand');
  assert.equal(selectAttackMoveFromInput(1, 0), 'dodge');
  assert.equal(selectAttackMoveFromInput(0, 0), 'tap');
  console.log('combat-wheel logic: all assertions passed');
})();
