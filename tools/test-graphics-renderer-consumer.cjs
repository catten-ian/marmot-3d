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
