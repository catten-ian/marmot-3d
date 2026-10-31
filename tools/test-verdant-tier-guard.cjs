const assert = require('node:assert');
const fs = require('node:fs');
(async () => {
  const { clampVerdantTierForDevice } = await import('../src/core/performance.js');
  assert.equal(clampVerdantTierForDevice('high', { mobile: true, backend: 'webgl2', deviceMemory: 8, hardwareConcurrency: 8 }), 'low');
  assert.equal(clampVerdantTierForDevice('ultra', { mobile: true, backend: 'webgpu', deviceMemory: 16, hardwareConcurrency: 8 }), 'low');
  assert.equal(clampVerdantTierForDevice('medium', { mobile: true, backend: 'webgl2', deviceMemory: 8, hardwareConcurrency: 8 }), 'low');
  assert.equal(clampVerdantTierForDevice('medium', { mobile: true, backend: 'webgpu', deviceMemory: 8, hardwareConcurrency: 8 }), 'medium');
  assert.equal(clampVerdantTierForDevice('ultra', { mobile: false, backend: 'webgl2', deviceMemory: 8, hardwareConcurrency: 8 }), 'high');
  assert.equal(clampVerdantTierForDevice('high', { mobile: false, backend: 'webgpu', deviceMemory: 16, hardwareConcurrency: 8 }), 'high');
  assert.equal(clampVerdantTierForDevice('medium', { mobile: false, backend: 'webgl2', deviceMemory: 2, hardwareConcurrency: 2 }), 'low');
  const main = fs.readFileSync('src/main.js', 'utf8');
  assert.match(main, /if \(requested\) return guarded;/, 'explicit mobile tiers retain device guards');
  assert.match(main, /if \(isTouchPrimary\(\)\) return 'low';/, 'touch auto tier always starts on low');
  assert.doesNotMatch(main, /isTouchPrimary\(\).*'medium'/, 'touch auto tier must not silently select medium');
  console.log('verdant tier guard: ok');
})().catch((e) => { console.error(e); process.exit(1); });
