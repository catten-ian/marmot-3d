const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const root = path.resolve(__dirname, '..');
const props = fs.readFileSync(path.join(root, 'src/world/props.js'), 'utf8');
const entities = fs.readFileSync(path.join(root, 'src/entities/props_entities.js'), 'utf8');
const diff = path.join(root, 'assets/verdant/tiers/low/grass_medium_02_diff_512.jpg');
const alpha = path.join(root, 'assets/verdant/tiers/low/grass_medium_02_alpha_512.png');

assert.match(props, /this\._buildGrass\(\);\s*this\._buildTexturedGrass\(\);/s);
assert.match(props, /mesh\.name = 'dev-textured-grass'/);
assert.match(props, /grassKind: 'textured'/);
assert.match(props, /edible: false/);
assert.match(props, /betaGrassEating: \{ compatible: true, enabled: false/);
assert.match(props, /assets\/verdant\/tiers\/low\/grass_medium_02_diff_512\.jpg/);
assert.match(entities, /herbivore = devOn\('herbivoreFood'\) && !!plant/);
assert.ok(fs.statSync(diff).size > 1000, 'local diffuse texture missing or empty');
assert.ok(fs.statSync(alpha).size > 1000, 'local alpha texture missing or empty');
const sha = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
console.log(JSON.stringify({
  ok: true,
  procedural: 'Scenery._buildGrass',
  textured: 'Scenery._buildTexturedGrass',
  texturedEdible: false,
  betaGrassEatingCompatible: true,
  localAssets: {
    diff: { path: 'assets/verdant/tiers/low/grass_medium_02_diff_512.jpg', bytes: fs.statSync(diff).size, sha256: sha(diff) },
    alpha: { path: 'assets/verdant/tiers/low/grass_medium_02_alpha_512.png', bytes: fs.statSync(alpha).size, sha256: sha(alpha) },
  },
}));
