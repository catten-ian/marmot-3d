const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const pack = path.join(root, 'release', 'verdant-dev-pack');
const required = [
  'assets/verdant/manifest.json',
  'assets/verdant/verdant-trail-height.json',
  'assets/verdant/verdant-trail.glb',
  'assets/models/marmot.glb',
  'assets/models/fox-segmented.glb',
];
for (const file of required) if (!fs.existsSync(path.join(pack, file))) throw new Error(`missing pack file: ${file}`);
const manifest = JSON.parse(fs.readFileSync(path.join(pack, required[0]), 'utf8'));
if (manifest.files.scene !== 'verdant-trail.glb' || manifest.files.height !== 'verdant-trail-height.json') throw new Error('manifest paths changed');
if (!fs.existsSync(path.join(root, 'release', 'verdant-dev-pack.zip'))) throw new Error('missing zip output');
const total = required.reduce((n, f) => n + fs.statSync(path.join(pack, f)).size, 0);
console.log(JSON.stringify({ ok: true, required, sourceBytes: total, zipBytes: fs.statSync(path.join(root, 'release', 'verdant-dev-pack.zip')).size }, null, 2));
