const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8').replace(/\s+/g, ' ');

test('forage settlement keeps kind-specific baseline contracts', () => {
  assert.match(source, /const gain = b\.kind === 'flower' \? energyOfFlower\(\) : b\.kind === 'grass' \? energyOfPlant\(b\.plant\) : BERRY_ENERGY/);
  assert.match(source, /b\.kind === 'flower' \? BERRY_CHARGE \* 1\.5 : BERRY_CHARGE/);
  assert.match(source, /energyOfPlant\(b\.plant\)/);
  assert.match(source, /eatLine\(b\.plant\)/);
  assert.match(source, /b\.herbivore \? colHerb : colBerry/);
});

test('beta environmental graze settlement remains wired', () => {
  assert.match(source, /scenery\.grazeAt\(/);
  assert.match(source, /scenery\.grazeAt\([\s\S]*?game\.foodCount\+\+/);
});
