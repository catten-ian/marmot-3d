const assert = require('node:assert/strict');
const fs = require('node:fs');

(async () => {
  const { LEVELS, typesForLevel } = await import('../src/core/config.js');
  const { spawnSandboxFoxes, clearSandboxFoxes } = await import('../src/sandbox/commands.js');
  const {
    SANDBOX_LEVEL, createSandboxState, placeSandboxDummy, removeSandboxDummy,
    setSandboxDummyDefeatable, stepSandboxDummyRecovery,
  } = await import('../src/sandbox/state.js');

  for (let level = 0; level < LEVELS.length; level++) {
    assert.deepEqual(typesForLevel(level), ['normal'], `level ${level} type pool`);
    assert.deepEqual(LEVELS[level].types, ['normal'], `level ${level} configured types`);
  }
  assert.deepEqual(typesForLevel(-1), ['normal']);
  assert.deepEqual(typesForLevel(LEVELS.length + 10), ['normal']);
  assert.deepEqual(SANDBOX_LEVEL.types, ['normal']);

  const state = createSandboxState();
  assert.equal('selectedType' in state, false, 'sandbox no longer stores a fox-type selection');
  const spawnedTypes = [];
  assert.equal(spawnSandboxFoxes({ count: 3, state, spawnFox: (type) => spawnedTypes.push(type) }), 3);
  assert.deepEqual(spawnedTypes, ['normal', 'normal', 'normal']);
  const removed = [];
  const first = { id: 1 }, second = { id: 2 };
  assert.equal(placeSandboxDummy({ state, createDummy: () => first }), first);
  assert.equal(placeSandboxDummy({ state, createDummy: () => second, removeDummy: (dummy) => removed.push(dummy) }), second);
  assert.deepEqual(removed, [first], 'placing again removes the previous dummy');
  assert.equal(removeSandboxDummy({ state, removeDummy: (dummy) => removed.push(dummy) }), true);
  assert.equal(state.dummy, null);
  assert.deepEqual(removed, [first, second]);
  assert.equal(removeSandboxDummy({ state }), false, 'removing an absent dummy is safe');
  state.dummy = second;
  clearSandboxFoxes({ state, clearFoxes() {} });
  assert.equal(state.dummy, null, 'clear-all drops the isolated dummy reference');
  state.dummy = second;
  assert.throws(() => clearSandboxFoxes({ state, clearFoxes() { throw new Error('clear failed'); } }), /clear failed/);
  assert.equal(state.dummy, null, 'clear-all drops the dummy reference even if disposal throws');

  const dummy = {
    isSandboxDummy: true,
    dummyDefeatable: false,
    hp: 1,
    maxHp: 3,
    dummyNoHitTimer: 1.5,
    state: 'dummy',
    mesh: { visible: true },
  };
  stepSandboxDummyRecovery(dummy, 1);
  assert.equal(dummy.hp, 1, 'no recovery before the 1.5 second no-hit delay');
  stepSandboxDummyRecovery(dummy, 0.5);
  assert.equal(dummy.hp, 1, 'the delay is not shortened');
  stepSandboxDummyRecovery(dummy, 0.5);
  assert.equal(dummy.hp, 2, 'recovery starts after the delay');
  stepSandboxDummyRecovery(dummy, 10);
  assert.equal(dummy.hp, dummy.maxHp, 'recovery is capped at max HP');

  dummy.hp = 0;
  assert.equal(setSandboxDummyDefeatable(dummy, false), true);
  assert.equal(dummy.hp, 1, 'indestructible toggle restores the positive HP floor');
  assert.equal(dummy.mesh.visible, true);
  dummy.dummyDefeatable = true;
  dummy.hp = 0;
  dummy.dummyNoHitTimer = 0;
  stepSandboxDummyRecovery(dummy, 5);
  assert.equal(dummy.hp, 0, 'defeatable zero-HP dummy remains defeated without healing');
  dummy.hp = 1;
  dummy.dummyNoHitTimer = 1.5;
  stepSandboxDummyRecovery(dummy, 2);
  assert.equal(dummy.hp, 1, 'time since the last hit is still tracked while defeatable');
  dummy.dummyDefeatable = false;
  stepSandboxDummyRecovery(dummy, 0.1);
  assert.equal(dummy.hp, 1.2, 'indestructible recovery does not impose an extra stale delay');

  const main = fs.readFileSync('src/main.js', 'utf8');
  const makeFox = main.match(/function makeFox\(i\) \{([\s\S]*?)\n\}/)?.[1];
  assert.ok(makeFox, 'campaign makeFox function exists');
  assert.match(makeFox, /new Fox\([\s\S]*?'normal'/, 'campaign spawning always requests normal');
  assert.doesNotMatch(makeFox, /'boss'|'fast'|'heavy'|'pup'|typesForLevel/);
  assert.match(main, /game\.bossDown = true;/, 'old boss levels are safely marked complete');
  assert.match(main, /f\.hp <= 0 && !f\.isSandboxDummy/, 'dummy defeat bypasses enemy repel and reward accounting');
  assert.match(main, /function disposeAllFoxes\(\) \{[\s\S]*?sandboxState\.dummy = null;/, 'dispose-all clears the sandbox dummy reference');

  const foxSource = fs.readFileSync('src/entities/fox.js', 'utf8');
  assert.match(foxSource, /type = 'normal';/, 'legacy Fox callers are normalized');
  assert.doesNotMatch(foxSource, /labelSprite|buildLabelSprite/, 'overhead type label is fully removed');
  assert.match(foxSource, /if \(this\.isSandboxDummy\)/, 'dummy has a dedicated update and hit path');
  assert.match(foxSource, /this\.mesh\.visible = this\.hp > 0;/, 'defeated dummy mesh is hidden');
  assert.match(foxSource, /this\.hpBar\.visible = this\.hp > 0 && this\.hp < this\.maxHp;/, 'HP bar is visible only for a damaged live dummy');
  assert.match(foxSource, /this\.warn\.visible = false;/, 'dummy warning stays hidden');
  assert.match(foxSource, /get alive\(\) \{ return !this\.isSandboxDummy/, 'dummy is excluded from threat and contact accounting');

  const panel = fs.readFileSync('src/sandbox/panel.js', 'utf8');
  assert.doesNotMatch(panel, /sandboxFoxType|狐狸类型|typeLabels/);
  assert.match(panel, /data-sandbox-action="placeDummy"/);
  assert.match(panel, /data-sandbox-action="removeDummy"/);
  assert.match(panel, /sandboxDummyDefeatable/);

  console.log('PASS normal-fox-only and sandbox dummy semantics');
})().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
