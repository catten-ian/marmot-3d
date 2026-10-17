const assert = require('node:assert/strict');
const fs = require('node:fs');

(async () => {
  const painter = await import('../src/splat/splat-painter.js');
  const heightfield = await import('../src/splat/heightfield.js');
  const textures = await import('../src/splat/textures.js');
  const shader = await import('../src/splat/shaders.js');
  const main = await import('../src/splat/main.js');
  const configMod = await import('../src/core/config.js');
  const fallbackSource = fs.readFileSync('src/splat/webgl1-fallback.js', 'utf8');

  const map = painter.generateSplatWeights({
    width: 1024, height: 1024,
    fieldW: heightfield.FIELD_W, fieldH: heightfield.FIELD_H,
    heightAt: heightfield.terrainHeight, normalAt: heightfield.terrainNormal, createCanvas: null,
  });
  assert.equal(map.width, 1024);
  assert.equal(map.height, 1024);
  assert.equal(map.data.length, 1024 * 1024 * 4);
  assert.ok(map.data instanceof Uint8ClampedArray);
  assert.deepEqual(Object.keys(map.counts).sort(), ['a', 'b', 'g', 'r']);
  assert.ok(Object.values(map.counts).every((count) => count > 0), 'every RGBA channel has nonzero pixels');
  assert.equal(map.canvas, null, 'Node mode does not require a DOM canvas');
  let canvasPut = false;
  const canvasMap = painter.generateSplatWeights({
    width: 4, height: 4, heightAt: () => 0.2, normalAt: () => ({ x: 0, y: 1, z: 0 }),
    createCanvas: (width, height) => ({
      getContext: () => ({
        createImageData: () => ({ data: new Uint8ClampedArray(width * height * 4) }),
        putImageData: (image) => { canvasPut = image.data.length === width * height * 4; },
      }),
    }),
  });
  assert.ok(canvasMap.canvas);
  assert.equal(canvasPut, true, 'browser Canvas2D path writes RGBA ImageData');
  const roundWeights = (w) => Object.fromEntries(Object.entries(w).map(([k, v]) => [k, Math.round(v * 1000) / 1000]));
  assert.deepEqual(roundWeights(painter.weightsFromHN(0.1, 1, 0)), { r: 0, g: 1, b: 0, a: 0 });
  assert.deepEqual(roundWeights(painter.weightsFromHN(0.5, 1, 0)), { r: 1, g: 0, b: 0, a: 0 });
  assert.deepEqual(roundWeights(painter.weightsFromHN(0.9, 1, 0)), { r: 1, g: 0, b: 0, a: 0 });
  const steep = painter.weightsFromHN(0.1, 0.4, 0);
  assert.ok(steep.a > 0.99, 'steep low-altitude terrain prioritizes rock');

  for (const [name, factory] of [
    ['grass', textures.makeGrassTexture],
    ['sand', textures.makeSandTexture],
    ['snow', textures.makeSnowTexture],
    ['rock', textures.makeRockTexture],
  ]) {
    const pixels = factory();
    assert.ok(pixels instanceof Uint8Array, `${name} returns Uint8Array`);
    assert.equal(pixels.length, 512 * 512 * 4, `${name} is 512x512 RGBA`);
    assert.ok(pixels.some((v) => v !== 0), `${name} contains generated pixels`);
  }

  assert.equal(heightfield.FIELD_W, 130);
  assert.equal(heightfield.FIELD_H, 78);
  for (let iz = 0; iz <= 8; iz++) {
    for (let ix = 0; ix <= 8; ix++) {
      const x = -heightfield.FIELD_W / 2 + ix * heightfield.FIELD_W / 8;
      const z = -heightfield.FIELD_H / 2 + iz * heightfield.FIELD_H / 8;
      assert.ok(Number.isFinite(heightfield.terrainHeight(x, z)), 'height is defined throughout the 130x78m field');
    }
  }
  const out = { x: 0, y: 0, z: 0 };
  const normal = heightfield.terrainNormal(2, 3, out);
  assert.equal(normal, out, 'terrainNormal supports the shared out-parameter signature');
  assert.deepEqual(Object.keys(normal).sort(), ['x', 'y', 'z']);
  assert.ok(Math.abs(Math.hypot(normal.x, normal.y, normal.z) - 1) < 1e-6, 'terrain normal is unit length');
  assert.ok(heightfield.terrainHeight(30, -14) > heightfield.terrainHeight(0, 34), 'main peak is present');

  for (const sampler of ['uSplat', 'uGrass', 'uSand', 'uSnow', 'uRock']) {
    assert.match(shader.SPLAT_FRAGMENT_SHADER, new RegExp(`texture2D\\s*\\(\\s*${sampler}`));
  }
  assert.match(shader.SPLAT_FRAGMENT_SHADER, /texture2D\s*\(\s*uSplat/);
  assert.match(fallbackSource, /getContext\('webgl'/, 'older X5 has a raw WebGL1 fallback');
  assert.match(fallbackSource, /gl\.drawElements\(gl\.TRIANGLES/);

  assert.equal(configMod.config.splat.enabled, true, 'splat is enabled by default');
  assert.equal(configMod.splat, configMod.config.splat, 'named splat settings share the toggle object');
  assert.equal(main.splatBootAllowed(), true);
  configMod.config.splat.enabled = false;
  assert.equal(main.splatBootAllowed(), false);
  const disabled = await main.bootSplat();
  assert.equal(disabled.mounted, false, 'disabled splat path does not create a renderer or attach to canvas');
  configMod.config.splat.enabled = true;

  const html = fs.readFileSync('index.html', 'utf8');
  assert.match(html, /requestedVersion\s*===\s*['"]splat['"]/);
  assert.match(html, /import\(['"]\.\/src\/splat\/main\.js['"]\)/);
  assert.match(html, /await import\('\.\/src\/main\.js'\)/, 'all other paths retain the original entry');
  const mainSource = fs.readFileSync('src/splat/main.js', 'utf8');
  assert.match(mainSource, /if \(!splatBootAllowed\(\)\) return \{ mounted: false/);
  assert.match(mainSource, /document\.getElementById\(splat\.canvasId\)/);
  assert.match(mainSource, /WebGL1SplatRenderer/);

  console.log('splatmap: all assertions passed');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
