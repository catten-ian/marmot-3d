/* Pure Node contracts for the three rev8 feedback fixes. */
const assert = require('node:assert/strict');
const fs = require('node:fs');

const main = fs.readFileSync('src/main.js', 'utf8');
const effects = fs.readFileSync('src/systems/effects.js', 'utf8');
const layout = fs.readFileSync('src/ui/touch-layout.js', 'utf8');
const css = fs.readFileSync('styles.css', 'utf8');
const moveFacing = fs.readFileSync('src/core/move-facing.mjs', 'utf8');

// Weather is suppressed from the same burrowVolumeAt/inBurrow state used by gameplay.
assert.match(main, /function updateEnv\(dt, inBurrow = false\)/,
  'weather update must accept the existing inBurrow state');
assert.match(main, /const weatherInBurrow = game\.inBurrow \|\| !!burrowVolumeAt\(/,
  'main loop must preflight weather with burrowVolumeAt');
assert.match(main, /weatherInBurrow \? 0 : env\.gust \* env\.gustDir/,
  'wind acceleration must be zero while the player is in a burrow');
assert.match(main, /if \(weatherInBurrow\) controller\.externalVelocity\.x = 0;/,
  'wind velocity left from the previous frame must be cleared inside a burrow');
assert.match(main, /if \(game\.inBurrow !== weatherInBurrow\) updateEnvNotice\(updateEnv\(0, game\.inBurrow\)\)/,
  'crossing the opening must immediately restore/suppress weather visibility');
assert.match(main, /env\.sandOn = !weatherSuppressed && stormOn/,
  'sandstorm visibility must be suppressed inside a burrow');
assert.match(main, /if \(!env\.sandOn\) \{\s*scene\.fog\.near = env\.fogBase;/,
  'suppressed sand must restore the ordinary level fog');

// Third-person display and hit testing share one attack-yaw source.
const strike = main.slice(main.indexOf('function strike('), main.indexOf('// 迎击练习'));
assert.match(strike, /const attackYaw = resolveAttackYaw\(/,
  'strike must resolve one attack yaw');
assert.match(strike, /claw\.fire\([^;]*attackYaw, baseRange/s,
  'attack fan effect must receive the real attack yaw');
assert.doesNotMatch(strike, /claw\.fire\([^;]*controller\.yaw/s,
  'attack fan effect must not use camera yaw directly');
assert.match(moveFacing, /export function resolveAttackYaw\(/,
  'attack yaw resolver remains the single mode-aware source');
assert.match(effects, /this\.group\.rotation\.y = yaw \+ Math\.PI/,
  'claw geometry must align its local normal with the real forward convention');
assert.match(effects, /userData\.attackYaw = yaw/,
  'claw effect must retain the resolved yaw for inspection');

// The draggable sandbox entry is independent from the fixed panel surface.
assert.match(layout, /if \(id === SANDBOX_CONTROL\) \{[\s\S]*?el\.style\.bottom = 'auto';/,
  'only sandboxControl receives the legacy bottom-anchor cleanup');
assert.doesNotMatch(layout, /testPanel[^\n]*style\.(left|top|transform|zIndex)/,
  'touch layout must not write panel positioning');
assert.match(css, /\.test-panel \{[\s\S]*?position:\s*fixed;[\s\S]*?box-sizing:\s*border-box;/,
  'sandbox panel must remain an independent fixed, border-box surface');
assert.match(css, /\.test-panel \{[\s\S]*?max-height:\s*calc\(100dvh/s,
  'sandbox panel must fit short and rotated viewports');
assert.match(css, /\.test-panel header button \{[\s\S]*?flex:\s*0 0 28px;[\s\S]*?transform:\s*none;/,
  'panel close button must stay in the header and avoid draggable transforms');

console.log('feedback fixes: weather, attack yaw, and sandbox panel contracts passed');
