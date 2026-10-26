/** PAF entry module integrity and ownership contract regression. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const paf = fs.readFileSync(path.join(root, 'src/play/play-as-fox.js'), 'utf8');
const main = fs.readFileSync(path.join(root, 'src/main.js'), 'utf8');

test('PAF reuses the shared TouchControls route and has no independent touch DOM', () => {
  assert.match(paf, /new PafInputRoute\(touchControls\)/);
  assert.match(paf, /pafRoute\.activate/);
  assert.match(paf, /pafRoute\.restore/);
  assert.doesNotMatch(paf, /id=\"pafTouch\"|pafStick|pafPounce|pafSprint|pafLook/);
  assert.match(paf, /data-touch-action=\"attack\"/);
  assert.match(paf, /data-touch-action=\"dodge\"/);
  assert.match(paf, /data-touch-action=\"jump\"/);
});

test('Beta entry hands off to the independent PAF update loop and exit callback returns to title', () => {
  assert.match(main, /pafBtn\) pafBtn\.onclick = enterPlayAsFox/);
  assert.match(main, /playAsFox = createPlayAsFox\([\s\S]*?onExit: \(\) => \{[\s\S]*?title\(\)/);
  assert.match(main, /if \(playAsFox\) \{[\s\S]*?playAsFox\.update\(dt\);[\s\S]*?return;/);
  assert.match(paf, /const api = \{ update, exit, get active\(\) \{ return running; \} \}/);
});
