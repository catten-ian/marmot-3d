const assert = require('node:assert/strict');
(async () => {
  const { cooldownAngle, cooldownState, cooldownOverlayData } = await import('../src/ui/cooldown-overlay.js');
  assert.equal(cooldownAngle(5, 10), 180);
  assert.equal(cooldownState({ remaining: 0, energy: 20, cost: 10 }), 'ready');
  assert.equal(cooldownState({ remaining: 2, duration: 10, energy: 20, cost: 10 }), 'cd');
  assert.equal(cooldownState({ remaining: 0, energy: 2, cost: 10 }), 'no-energy');
  assert.equal(cooldownState({ remaining: 0, energy: 20, cost: 10, charge: 40, charging: true }), 'charging');
  assert.equal(cooldownOverlayData({ remaining: 5, duration: 10, energy: 20, cost: 10 }).angle, 180);
  console.log('cooldown overlay logic: all assertions passed');
})();
