'use strict';
const assert = require('node:assert/strict');
(async () => {
  const mod = await import('../src/core/graphics-preference.js');
  const { normalizeGraphicsPreference, readGraphicsPreference, writeGraphicsPreference, adapterPowerPreference } = mod;
  for (const value of ['auto', 'high-performance', 'power-saving']) assert.equal(normalizeGraphicsPreference(value), value);
  for (const value of [null, '', 'HIGH', {}, 'low-power']) assert.equal(normalizeGraphicsPreference(value), 'auto');
  assert.equal(adapterPowerPreference('power-saving'), 'low-power');
  assert.equal(adapterPowerPreference('auto'), 'high-performance');
  assert.equal(adapterPowerPreference('high-performance'), 'high-performance');
  const store = new Map([['marmot.graphics-adapter.v1', 'power-saving']]);
  const storage = { getItem: (key) => store.get(key) ?? null, setItem: (key, value) => store.set(key, value) };
  assert.equal(readGraphicsPreference(storage), 'power-saving');
  assert.equal(readGraphicsPreference({ getItem() { throw new Error('blocked'); } }), 'auto');
  assert.equal(writeGraphicsPreference('bad', storage), 'auto');
  assert.equal(store.get('marmot.graphics-adapter.v1'), 'auto');
  console.log('graphics preference normalization/storage/adapter mapping: ok');
})();
