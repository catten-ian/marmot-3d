const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const base = path.join(root, 'assets', 'verdant');
const catalog = JSON.parse(fs.readFileSync(path.join(base, 'manifest.json'), 'utf8'));
for (const tier of ['low','medium','high','ultra']) {
  const entry = catalog.tiers?.[tier];
  if (!entry) throw new Error(`missing tier ${tier}`);
  const manifestPath = path.join(base, entry.manifest.replace(/^tiers\//, 'tiers/'));
  if (!fs.existsSync(manifestPath)) throw new Error(`missing ${tier} manifest`);
  const m = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const dir = path.dirname(manifestPath);
  for (const key of ['scene','height']) if (!fs.existsSync(path.join(dir, m.files[key]))) throw new Error(`missing ${tier} ${key}`);
  if (m.export?.tier !== tier) throw new Error(`tier mismatch ${tier}`);
}
const total = Object.values(catalog.tiers).reduce((n, e) => n + fs.statSync(path.join(base, e.scene)).size, 0);
console.log(JSON.stringify({ ok: true, tiers: Object.keys(catalog.tiers), sceneBytes: total }, null, 2));
