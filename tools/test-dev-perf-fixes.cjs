const assert = require('node:assert/strict');
const fs = require('node:fs');
(async () => {
  const { StaticPlacementCache, resolvePlacementWithFallback, buildSurfaceComponents, resolveEntityGround } = await import('../src/world/verdant-placement.mjs');
  const cache = new StaticPlacementCache();
  const valid = { x: 1, z: 1, y: 2, component: 0 };
  cache.set(1, 1, valid);
  assert.equal(cache.get(1, 1), valid, 'stationary validated support is reused');
  assert.equal(cache.get(1.01, 1), null, 'movement invalidates support cache');
  cache.set(1, 1, valid); assert.equal(cache.get(1, 1, true), null, 'dirty/teleport invalidates support cache');
  cache.set(1, 1, null); assert.equal(cache.get(1, 1), null, 'failed support is not cached as success');
  let rescueQueries = 0; const rescued = resolvePlacementWithFallback(new StaticPlacementCache(), { x: 9, z: 9, fallbackX: 8, fallbackZ: 8, resolver: (x, z) => { rescueQueries++; return x === 8 ? { x, z, y: 3 } : null; } });
  assert.deepEqual([rescued.x, rescued.z, rescued.result.y], [8, 8, 3], 'blocked rescue-follow move restores the previous validated pose');
  assert.equal(rescueQueries, 2, 'rescue fallback still performs exact validation before reuse');

  // Parallel decks must remain separate and a previous component reference must win.
  const nx = 7, nz = 7, layerCount = 4, cellSize = 1;
  const walkable = new Uint8Array(nx * nz).fill(1);
  const surfaceLayers = new Float32Array(nx * nz * layerCount).fill(NaN);
  for (let k = 0; k < nx * nz; k++) { surfaceLayers[k * layerCount] = 2; surfaceLayers[k * layerCount + 1] = 5; }
  const comps = buildSurfaceComponents({ surfaceLayers, walkable, nx, nz, cellSize, layerCount });
  const field = { nx, nz, bounds: { minX: 0, maxX: nx, minZ: 0, maxZ: nz }, cellSize, walkable, surfaceLayers, layerCount, layerLabels: comps.labels, obstacleMask: new Uint8Array(nx * nz) };
  const lower = resolveEntityGround(field, 3.5, 3.5, { radius: 0, bodyHeight: 0.8, referenceY: 2 });
  const upper = resolveEntityGround(field, 3.5, 3.5, { radius: 0, bodyHeight: 0.8, referenceY: 5 });
  assert.equal(lower.y, 2); assert.equal(upper.y, 5); assert.notEqual(lower.component, upper.component, 'cross-layer resolution retains component identity');
  assert.equal(resolveEntityGround(field, 3.5, 3.5, { radius: 0, bodyHeight: 0.8, component: lower.component, referenceY: 5 }).y, 2, 'recovery cannot jump to an adjacent deck');

  const mem = await import('../src/core/memory-budget.mjs');
  const texture = { uuid: 'shared', image: { width: 128, height: 128 } };
  assert.equal(mem.estimateUniqueTextureBytes([texture, texture]), mem.estimateUniqueTextureBytes([texture]), 'unique texture estimate de-duplicates shared references');
  assert.ok(mem.estimateUniqueTextureBytes([texture, { uuid: 'second', image: { width: 128, height: 128 } }]) > mem.estimateUniqueTextureBytes([texture]));

  const fallback = await import('../src/core/verdant-auto-fallback.mjs');
  assert.deepEqual(fallback.nextAutomaticVerdantFallback('ultra'), { tier: 'high', useSimpleFallback: false });
  assert.deepEqual(fallback.nextAutomaticVerdantFallback('high'), { tier: 'medium', useSimpleFallback: false });
  assert.deepEqual(fallback.nextAutomaticVerdantFallback('medium'), { tier: 'low', useSimpleFallback: false });
  assert.deepEqual(fallback.nextAutomaticVerdantFallback('low'), { tier: null, useSimpleFallback: true }, 'auto low failure proceeds to simple scene rather than a blocking failure panel');

  const keys = await import('../src/core/keybinds.js');
  const kb = new keys.Keybinds(); kb.setScheme('compatible');
  assert.equal(kb.isActionDown('sprint'), false, 'binding alone is not a pressed action');
  kb.setKeyDown('ShiftLeft', true); assert.equal(kb.isActionDown('sprint'), true);
  kb.setKeyDown('ShiftLeft', false); assert.equal(kb.isActionDown('sprint'), false, 'keyup clears action-down state');
  kb.setKey('sprint', 'KeyX');
  kb.setKeyDown('ShiftLeft', true); assert.equal(kb.isActionDown('sprint'), false, 'custom mapping ignores old key');
  kb.setKeyDown('KeyX', true); assert.equal(kb.isActionDown('sprint'), true, 'custom mapping tracks pressed state');

  const disposal = await import('../src/entities/resource-disposal.mjs');
  const makeNode = (geometry, material, children = []) => ({ geometry, material, children, traverse(fn) { fn(this); for (const c of children) c.traverse(fn); } });
  let geometryDisposals = 0, materialDisposals = 0;
  const geoShared = { dispose() { geometryDisposals++; } }, geoOwned = { dispose() { geometryDisposals++; } };
  const tex = { dispose() { throw new Error('shared texture must remain cached'); } };
  const sharedMat = { map: tex, dispose() { materialDisposals++; } }, ownedMat = { dispose() { materialDisposals++; } };
  const instanceSharedMat = { map: tex, dispose() { materialDisposals++; } };
  const sharedModel = makeNode(null, null, [makeNode(geoShared, sharedMat)]);
  const instance = makeNode(null, null, [makeNode(geoOwned, ownedMat), makeNode(geoShared, instanceSharedMat)]);
  const first = disposal.disposeOwnedTree(instance, sharedModel);
  assert.equal(first.geometries, 1); assert.equal(first.materials, 2);
  assert.equal(geometryDisposals, 1); assert.equal(materialDisposals, 2);
  const secondInstanceMat = { map: tex, dispose() { materialDisposals++; } };
  const secondInstance = makeNode(null, null, [makeNode(geoOwned, ownedMat), makeNode(geoShared, secondInstanceMat)]);
  disposal.disposeOwnedTree(secondInstance, sharedModel);
  assert.equal(geometryDisposals, 2, 'repeat instance disposal releases only owned procedural geometry');
  assert.equal(materialDisposals, 4, 'each instance material is released without disposing its texture');
  assert.equal(sharedModel.children[0].geometry, geoShared, 'cached geometry stays available for next instantiate');

  const THREE = require('../vendor/three.module.js');
  const { normalizeParticleColor } = await import('../src/systems/particle-color.mjs');
  const particleColor = normalizeParticleColor(0xd6a1ff, THREE.Color);
  const particleMesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.07, 0), new THREE.MeshBasicMaterial(), 2);
  particleMesh.setColorAt(0, particleColor);
  assert.ok([...particleMesh.instanceColor.array].every(Number.isFinite), 'all populated instanceColor channels are finite');
  assert.ok([particleColor.r, particleColor.g, particleColor.b].every(Number.isFinite));

  const effects = fs.readFileSync('src/systems/effects.js', 'utf8');
  const main = fs.readFileSync('src/main.js', 'utf8');
  assert.match(effects, /normalizeParticleColor\(color, THREE\.Color\)/);
  assert.match(main, /new THREE\.Color\(0xd6a1ff\)/);
  assert.match(effects, /DAMAGE_TEXT_CACHE_LIMIT = 96/);
  assert.match(main, /rawDt = Math\.max\(0, \(now - last\) \/ 1000\)/);
  assert.match(main, /mainRenderStats/);
  assert.match(main, /const sprinting = controller\.touchSprint \|\| binds\.isActionDown\('sprint'\)/);
  assert.doesNotMatch(main, /binds\.isAction\('Shift(?:Left|Right)', 'sprint'\)/, 'sprint runtime state never uses binding-only lookup');
  assert.match(main, /verdantBootOverride = true;[\s\S]{0,260}自动档位加载失败，已切换到简化地图/);
  console.log('dev perf pure regression tests: 31 assertions passed');
})().catch((error) => { console.error(error); process.exitCode = 1; });
