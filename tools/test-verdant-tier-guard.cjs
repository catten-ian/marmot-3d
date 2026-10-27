const assert = require('node:assert');
(async () => {
  const { clampVerdantTierForDevice } = await import('../src/core/performance.js');
  assert.equal(clampVerdantTierForDevice('high', { mobile: true, backend: 'webgl2', deviceMemory: 8, hardwareConcurrency: 8 }), 'low');
  assert.equal(clampVerdantTierForDevice('ultra', { mobile: true, backend: 'webgpu', deviceMemory: 16, hardwareConcurrency: 8 }), 'low');
  assert.equal(clampVerdantTierForDevice('medium', { mobile: true, backend: 'webgl2', deviceMemory: 8, hardwareConcurrency: 8 }), 'low');
  assert.equal(clampVerdantTierForDevice('medium', { mobile: true, backend: 'webgpu', deviceMemory: 8, hardwareConcurrency: 8 }), 'medium');
  assert.equal(clampVerdantTierForDevice('ultra', { mobile: false, backend: 'webgl2', deviceMemory: 8, hardwareConcurrency: 8 }), 'high');
  assert.equal(clampVerdantTierForDevice('high', { mobile: false, backend: 'webgpu', deviceMemory: 16, hardwareConcurrency: 8 }), 'high');
  assert.equal(clampVerdantTierForDevice('medium', { mobile: false, backend: 'webgl2', deviceMemory: 2, hardwareConcurrency: 2 }), 'low');
  console.log('verdant tier guard: ok');
})().catch((e) => { console.error(e); process.exit(1); });
