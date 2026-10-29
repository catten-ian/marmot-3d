#!/usr/bin/env node
/** Deterministic dev-only Verdant placement bake; reads GLBs and shipped walkable rasters. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseWalkableFieldBin } from '../src/world/verdant-walkable-bin.mjs';
import { buildWalkableField } from '../src/world/verdant-collision.js';
import { chooseCentralBaseSiteCooperative, findRobustPlacementCooperative, fingerprintPlacementField, fingerprintPlacementInputs, resolveEntityGround } from '../src/world/verdant-placement.mjs';
import { BURROWS, BERRY_POINTS, SPAWN_POINTS, LEVELS, PLAYER, scalePoint, scaleRadius, setPointScale } from '../src/core/config.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ASSET_ROOT = path.join(ROOT, 'assets/verdant');
const OUT = path.join(ROOT, 'assets/world/verdant-placement-baked.json');
const BAKED_POINT_SCALE = 0.88;
const MAX_CANDIDATES = 2048;
const TIERS = ['low', 'medium', 'high'];

// Browser GLTFLoader uses a bare `three` import. Resolve that to the checked-in
// runtime module temporarily, without adding an npm dependency or persisting files.
const temporaryResolution = ensureThreePackageResolution();
try {
  globalThis.self ||= globalThis;
  globalThis.createImageBitmap ||= async () => ({ width: 1, height: 1, close() {} });
  const { GLTFLoader } = await import('../vendor/addons/loaders/GLTFLoader.js');
  const height = JSON.parse(fs.readFileSync(path.join(ASSET_ROOT, 'verdant-trail-height.json'), 'utf8'));
  setPointScale(BAKED_POINT_SCALE, 0, 0);
  const inputs = placementInputs();
  const output = { format: 1, algorithm: 'verdant-placement-v1', generatedBy: 'tools/bake-verdant-placement.mjs', generatedAt: 'deterministic', pointScale: BAKED_POINT_SCALE, inputsFingerprint: fingerprintPlacementInputs(inputs), heightSource: 'assets/verdant/verdant-trail-height.json', tiers: {} };
  for (const tier of TIERS) output.tiers[tier] = await bakeTier(tier, height, GLTFLoader);
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, `${JSON.stringify(output, null, 2)}\n`);
  for (const [tier, value] of Object.entries(output.tiers)) {
    const p = value.placements;
    console.log(`${tier}: ${value.fieldFingerprint} base=${p.burrows.base ? 'placed' : 'design-fallback'} burrows=${Object.values(p.burrows).filter((v) => v?.result).length}/5 companions=${Object.values(p.companions).filter((v) => v.recovery).length}/${Object.keys(p.companions).length}`);
  }
  console.log(`wrote ${path.relative(ROOT, OUT)}`);
} finally {
  temporaryResolution.cleanup();
}

function ensureThreePackageResolution() {
  const nm = path.join(ROOT, 'node_modules');
  const pkg = path.join(nm, 'three');
  if (fs.existsSync(pkg)) return { cleanup() {} };
  const hadNodeModules = fs.existsSync(nm);
  fs.mkdirSync(pkg, { recursive: true });
  fs.writeFileSync(path.join(pkg, 'package.json'), '{"type":"module","main":"index.js"}\n');
  fs.symlinkSync(path.relative(pkg, path.join(ROOT, 'vendor/three.module.js')), path.join(pkg, 'index.js'));
  return { cleanup() { fs.rmSync(pkg, { recursive: true, force: true }); if (!hadNodeModules) { try { fs.rmdirSync(nm); } catch (_) {} } } };
}
function readGlb(tier) {
  const file = path.join(ASSET_ROOT, `tiers/${tier}/verdant-trail-${tier}.glb`);
  const bytes = fs.readFileSync(file);
  if (bytes.toString('ascii', 0, 4) !== 'glTF' || bytes.readUInt32LE(4) !== 2) throw new Error(`${file} is not GLB v2`);
  return new Promise((resolve, reject) => {
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    new globalThis.__GLTFLoader().parse(buffer, pathToFileURL(path.dirname(file) + path.sep).href, (gltf) => resolve({ scene: gltf.scene, file }), reject);
  });
}
function sha256(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function placementInputs() { return { algorithm: 'verdant-placement-v1', pointScale: BAKED_POINT_SCALE, burrows: BURROWS, berryPoints: BERRY_POINTS, spawnPoints: SPAWN_POINTS, friends: LEVELS.map((level) => level.friend), playerRadius: PLAYER.radius, maxCandidates: MAX_CANDIDATES, centralStride: 4, candidateLimit: 64 }; }
function serializePoint(point) { return point ? JSON.parse(JSON.stringify(point)) : null; }

async function bakeTier(tier, height, GLTFLoader) {
  globalThis.__GLTFLoader = GLTFLoader;
  const binPath = path.join(ASSET_ROOT, `tiers/${tier}/walkable-field.bin`);
  const glbPath = path.join(ASSET_ROOT, `tiers/${tier}/verdant-trail-${tier}.glb`);
  const parsed = parseWalkableFieldBin(fs.readFileSync(binPath));
  const { scene } = await readGlb(tier);
  // The runtime consumes this exact shipped binary, then runs this same shared
  // field constructor (JSON fill, two hole passes, erosion, components, proxies,
  // clearance ray query). Thus placement never depends on a second rasterizer.
  const field = await buildWalkableField({ scene, heightJson: height, bounds: parsed.bounds, precomputed: parsed });
  const interest = [...BERRY_POINTS, ...SPAWN_POINTS].map(scalePoint);
  const baseDef = scaleBurrow(BURROWS[0]);
  const baseOptions = {
    interestPoints: interest, radius: baseDef.r, clearance: baseDef.openingRadius * 2.2,
    centerX: 0, centerZ: 0, stride: 4, maxCandidates: MAX_CANDIDATES,
    hasClearance: field.hasPlacementClearance, exclude: [],
  };
  console.info(`[bake] ${tier} central`);
  const baseSite = await chooseCentralBaseSiteCooperative(field, baseOptions);
  const placed = [];
  const burrowResults = {};
  for (let index = 0; index < BURROWS.length; index++) {
    console.info(`[bake] ${tier} burrow ${index}`);
    const def = scaleBurrow(BURROWS[index]);
    const exclude = placed.map((p) => ({ x: p.x, z: p.z, radius: p.r, gap: 2 }));
    const burrowOptions = {
      x: def.x, z: def.z, radius: def.slopeRadius, bodyHeight: 0.25,
      clearance: def.openingRadius * 1.8, maxSurfaceVariation: 0.45, maxDistance: 16,
      maxCandidates: MAX_CANDIDATES, avoidObstacles: true, exclude,
      hasClearance: field.hasPlacementClearance,
    };
    const site = index === 0
      ? baseSite || await findRobustPlacementCooperative(field, { x: def.x, z: def.z, radius: def.slopeRadius, bodyHeight: 0.25, clearance: def.openingRadius * 1.8, maxSurfaceVariation: 0.45, maxDistance: 16, maxCandidates: MAX_CANDIDATES, avoidObstacles: true, exclude })
      : await findRobustPlacementCooperative(field, burrowOptions);
    const result = site ? { ...site, x: site.x, z: site.z, groundY: site.y } : null;
    burrowResults[def.id] = { inputFingerprint: fingerprintPlacementInputs(index === 0 ? { ...baseOptions, hasClearance: undefined } : { ...burrowOptions, hasClearance: undefined }), result: serializePoint(result) };
    placed.push(result ? { ...def, ...result } : def);
  }
  const companions = {};
  const recoveryCache = new Map();
  for (let index = 0; index < LEVELS.length; index++) {
    console.info(`[bake] ${tier} companion ${index}`);
    const [rawX, rawZ] = LEVELS[index].friend;
    const [x, z] = scalePoint([rawX, rawZ]);
    const exactOptions = {
      radius: PLAYER.radius, bodyHeight: 0.85, maxSurfaceVariation: 0.9,
      avoidObstacles: true, hasClearance: field.hasPlacementClearance,
    };
    const exact = resolveEntityGround(field, x, z, exactOptions);
    const recoveryOptions = {
      x, z, radius: PLAYER.radius, bodyHeight: 0.85, maxSurfaceVariation: 0.9,
      maxDistance: 14, maxCandidates: MAX_CANDIDATES, avoidObstacles: true,
      hasClearance: field.hasPlacementClearance,
    };
    const recoveryKey = JSON.stringify({ x, z });
    if (!recoveryCache.has(recoveryKey)) recoveryCache.set(recoveryKey, await findRobustPlacementCooperative(field, recoveryOptions));
    const recovery = recoveryCache.get(recoveryKey);
    companions[`level-${index}`] = { input: { x, z }, exactFingerprint: fingerprintPlacementInputs(exactOptions), recoveryFingerprint: fingerprintPlacementInputs(recoveryOptions), exact: serializePoint(exact), recovery: serializePoint(recovery) };
  }
  const result = {
    inputsFingerprint: fingerprintPlacementInputs(placementInputs()),
    fieldFingerprint: fingerprintPlacementField(field),
    field: { nx: field.nx, nz: field.nz, layerCount: field.layerCount, cellSize: field.cellSize, bounds: field.bounds, componentCount: field.componentSizes.length, componentSizes: field.componentSizes },
    placements: { burrows: burrowResults, companions },
    source: { glb: path.relative(ROOT, glbPath), glbSha256: sha256(glbPath), walkableField: path.relative(ROOT, binPath), walkableFieldSha256: sha256(binPath) },
  };
  scene.traverse((obj) => { if (!obj.isMesh) return; obj.geometry?.dispose?.(); });
  return result;
}
function scaleBurrow(burrow) {
  const [x, z] = scalePoint([burrow.x, burrow.z]);
  return { ...burrow, x, z, r: scaleRadius(burrow.r) };
}
