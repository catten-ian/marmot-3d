const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const dir = path.join(root, 'assets', 'verdant');
const catalog = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
assert.equal(catalog.format, 3);
assert.deepEqual(Object.keys(catalog.tiers).sort(), ['high', 'low', 'medium', 'ultra']);
const mainHeight = fs.readFileSync(path.join(dir, catalog.height));
const mainHash = require('node:crypto').createHash('sha256').update(mainHeight).digest('hex');
let mapping = null;
for (const tier of ['low', 'medium', 'high', 'ultra']) {
  const entry = catalog.tiers[tier];
  const manifestFile = path.join(dir, entry.manifest);
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  assert.equal(manifest.export.tier, tier);
  assert.equal(manifest.mapping.sourceHorizontalAxes.runtimeX, 'sourceY');
  assert.equal(manifest.mapping.sourceHorizontalAxes.runtimeZ, 'sourceX');
  const hfile = path.join(path.dirname(manifestFile), manifest.files.height);
  assert.ok(fs.existsSync(hfile), `${tier} height file exists`);
  const heightBytes = fs.readFileSync(hfile);
  assert.equal(require('node:crypto').createHash('sha256').update(heightBytes).digest('hex'), mainHash, `${tier} uses common height data`);
  const height = JSON.parse(heightBytes.toString('utf8'));
  assert.ok(height.gridSize >= 2 && height.heights.length === height.gridSize ** 2);
  assert.deepEqual(height.bounds, manifest.mapping.playableBounds);
  assert.ok(height.heights.every(Number.isFinite));
  if (mapping) assert.deepEqual(manifest.mapping, mapping, `${tier} xform and bounds match`);
  else mapping = manifest.mapping;
  const scene = path.join(path.dirname(manifestFile), manifest.files.scene);
  assert.ok(fs.existsSync(scene), `${tier} scene exists`);
  assert.equal(fs.statSync(scene).size, manifest.stats.fileBytes);
  assert.equal(entry.faces, manifest.stats.exportTriangles);
  assert.ok(manifest.stats.packBytes >= manifest.stats.fileBytes + manifest.stats.heightBytes);
  assert.ok(fs.existsSync(path.join(path.dirname(manifestFile), manifest.packManifest || 'pack-manifest.json')));
  if (tier === 'ultra') {
    assert.equal(manifest.export.decimation, false);
    assert.equal(manifest.stats.exportTriangles, 4298106);
    assert.match(manifest.files.scene, /\.gltf$/);
  }
}
const source = fs.readFileSync(path.join(root, 'src/core/version.js'), 'utf8');
assert.ok(source.includes('verdantWorld: IS_DEV'), 'Verdant feature stays dev-gated');
console.log(JSON.stringify({ ok: true, tiers: Object.keys(catalog.tiers), sharedHeightSha256: mainHash }, null, 2));
