import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../src/world/scene.js', import.meta.url), 'utf8');
const meta = JSON.parse(fs.readFileSync(new URL('../assets/sky/citrus_orchard_road_puresky_1k.json', import.meta.url), 'utf8'));
const image = fs.readFileSync(new URL('../assets/sky/citrus_orchard_road_puresky_1k.jpg', import.meta.url));

test('beta uses only the requested citrus 1K derivative with sRGB equirectangular mapping', () => {
  assert.match(source, /if \(IS_BETA\) this\._loadCitrusSky\(\)/);
  assert.match(source, /citrus_orchard_road_puresky_1k\.jpg/);
  assert.doesNotMatch(source, /kloofendal/i);
  assert.match(source, /THREE\.EquirectangularReflectionMapping/);
  assert.match(source, /THREE\.SRGBColorSpace/);
  assert.match(source, /new THREE\.TextureLoader\(\)/);
  assert.match(source, /state: 'fallback'/);
  assert.match(source, /this\.dome\.visible = true/);
});

test('runtime sky is a small 1024x512 JPEG and metadata pins source/hash/fallback', () => {
  assert.deepEqual(meta.sourceDimensions, [8192, 4096]);
  assert.deepEqual(meta.dimensions, [1024, 512]);
  assert.match(meta.sourcePath, /citrus_orchard_road_puresky_8k\.exr$/);
  assert.ok(meta.bytes < 1_000_000);
  assert.equal(image.length, meta.bytes);
  assert.equal(image[0], 0xff); assert.equal(image[1], 0xd8); // JPEG SOI
  // JPEG SOF0 dimensions.
  const sof = image.indexOf(Buffer.from([0xff, 0xc0]));
  assert.ok(sof > 0); assert.equal(image.readUInt16BE(sof + 5), 512); assert.equal(image.readUInt16BE(sof + 7), 1024);
  assert.match(meta.fallback, /procedural gradient/i);
});
