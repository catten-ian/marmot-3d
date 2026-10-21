'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const renderer = fs.readFileSync('src/core/renderer.js', 'utf8');
const gs = fs.readFileSync('src/gs/bootstrap.js', 'utf8');
for (const [name, source] of [['core renderer', renderer], ['GS bootstrap', gs]]) {
  assert.match(source, /graphics-preference\.js/, `${name} imports shared preference module`);
  assert.match(source, /adapterPowerPreference\(graphicsPreference\)/, `${name} maps preference for adapter/renderer`);
  assert.match(source, /powerPreference: adapterPowerPreference\(graphicsPreference\)/, `${name} passes mapped hint to renderer`);
}
assert.match(renderer, /probeWebGPU\(graphicsPreference\)/);
assert.match(gs, /detectWebGPU\(graphicsPreference/);
console.log('both renderer paths consume shared graphics preference: ok');
(async () => {
  const { AdaptiveRenderController, getRenderProfile } = await import('../src/core/performance.js');
  const controller = new AdaptiveRenderController({ windowMs: 900, degradeAfterMs: 450, recoverAfterMs: 700, changeCooldownMs: 300 });
  let now = 0;
  const feed = (ms, duration) => {
    for (let elapsed = 0; elapsed < duration; elapsed += ms) {
      now += ms;
      controller.sample(ms, now);
    }
  };
  feed(16.7, 1500);
  assert.equal(controller.tier, 0, 'normal 60Hz samples keep native quality');
  controller.sample(100, now + 16.7);
  now += 16.7;
  assert.equal(controller.tier, 0, 'one isolated long frame cannot change quality');
  feed(30, 6000);
  assert.equal(controller.tier, 3, 'sustained slow samples step down gradually');
  const desktop = { ...getRenderProfile(false), pixelRatio: 2, shadowMapSize: 2048, shadows: true };
  const tier3 = controller.apply(desktop);
  assert.equal(tier3.pixelRatio, 1.7);
  assert.equal(tier3.shadowMapSize, 1024);
  assert.equal(tier3.shadows, false);
  assert.equal(getRenderProfile(false).pixelRatio, 1, 'adaptive state never mutates static profile');
  const changes = [];
  for (let i = 0; i < 5000 && controller.tier > 0; i++) {
    now += 16.7;
    const transition = controller.sample(16.7, now);
    if (transition) changes.push(transition);
  }
  assert.equal(controller.tier, 0, 'stable recovery returns to native quality');
  assert.deepEqual(changes.map((change) => [change.from, change.to]), [[3, 2], [2, 1], [1, 0]]);
  console.log('adaptive quality hysteresis and reversible budgets: ok');
})().catch((error) => { console.error(error); process.exitCode = 1; });
