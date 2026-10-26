/** PAF entry module integrity and ownership contract regression. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const paf = fs.readFileSync(path.join(root, 'src/play/play-as-fox.js'), 'utf8');
const main = fs.readFileSync(path.join(root, 'src/main.js'), 'utf8');

test('PAF module owns one stable touch state and no merged duplicate/shared route remains', () => {
  assert.equal((paf.match(/\b(?:const|let)\s+touch\s*=/g) || []).length, 1);
  assert.match(paf, /const touch = \{ throttle: 0, turn: 0, sprint: false \}/);
  assert.match(paf, /fox\.sprint = keyboardSprint \|\| touch\.sprint/);
  assert.doesNotMatch(paf, /touch\s*=\s*mapPafJoystick|mapPafJoystick|PafInputRoute|touchRoute/);
});

test('Beta entry hands off to the independent PAF update loop and exit callback returns to title', () => {
  assert.match(main, /pafBtn\) pafBtn\.onclick = enterPlayAsFox/);
  assert.match(main, /playAsFox = createPlayAsFox\([\s\S]*?onExit: \(\) => \{[\s\S]*?title\(\)/);
  assert.match(main, /if \(playAsFox\) \{[\s\S]*?playAsFox\.update\(dt\);[\s\S]*?return;/);
  assert.match(paf, /const api = \{ update, exit, get active\(\) \{ return running; \} \}/);
});
