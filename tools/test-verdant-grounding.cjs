/**
 * Verdant round-2 grounding contract tests (TASK_scene_round2.md).
 *
 * Reads the deterministic audit artifacts produced by
 * tools/verdant/audit_grounding.py + assemble_grounding_audit.py and asserts:
 *  1. grounded meshes never float: gap <= threshold (0.15m). Negative gap is
 *     intentional soil penetration and must carry bottom-vertex evidence.
 *  2. grounded footprints resolve to a real ground triangle sample
 *     (never null, never a fake-0 sea-plane fallback).
 *  3. backdrop meshes must carry horizontal-distance / fog evidence — no
 *     "backdrop by convenience".
 *  4. known near-field artifacts (bacground_ground slab, shadow_* fake
 *     shadow planes) are excluded from every shipped tier GLB.
 *  5. visual ground and the regenerated height.json share a datum:
 *     |visual - heightJson| <= 0.05m at every audited footprint.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const qaDir = path.join(root, 'outputs', 'scene-assembly-qa');

const audit = JSON.parse(fs.readFileSync(path.join(qaDir, 'grounding-audit.json'), 'utf8'));
const THRESHOLD = 0.15;
assert.ok(audit.thresholdMeters <= THRESHOLD, 'audit threshold within 0.15m');

for (const tier of ['low', 'medium', 'high']) {
  const doc = audit.tiers[tier];
  assert.ok(doc, `${tier} tier audit present`);
  assert.equal(doc.summary.groundedOverThreshold.length, 0, `${tier} no grounded mesh floats above threshold`);
  assert.equal(doc.summary.groundedNoGroundTriangle.length, 0, `${tier} no grounded footprint misses the ground mesh`);
  assert.equal(doc.summary.groundedTotal, doc.summary.groundedWithinThreshold, `${tier} every grounded mesh passes`);
  for (const mesh of doc.meshes) {
    if (mesh.category === 'grounded') {
      assert.ok(mesh.gap !== null && mesh.gap <= THRESHOLD + 1e-9, `${tier}/${mesh.name} grounded gap ${mesh.gap} <= ${THRESHOLD}`);
      assert.ok(Number.isFinite(mesh.groundYBelow), `${tier}/${mesh.name} has a real ground sample (no fake-0 fallback)`);
      if (mesh.gap < -THRESHOLD) {
        // Embedded (buried) meshes must be backed by real ground-triangle hits
        // across the footprint grid, not by a no-hit-to-zero fallback.
        assert.ok((mesh.gridHits ?? 0) > 0 && Number.isFinite(mesh.groundYBelow),
          `${tier}/${mesh.name} embedded mesh keeps footprint ground evidence`);
      }
    }
    if (mesh.category === 'backdrop') {
      const ev = mesh.backdropEvidence;
      assert.ok(ev, `${tier}/${mesh.name} backdrop has distance evidence`);
      const dist = Math.max(ev.distanceToPlayableBoundsMeters ?? 0, ev.distanceToPlayableCenterMeters ?? 0);
      assert.ok(
        (ev.distanceToPlayableBoundsMeters ?? 0) >= 8 || (ev.distanceToPlayableCenterMeters ?? 0) >= 40 || ev.behindFogFar === true,
        `${tier}/${mesh.name} backdrop distance evidence holds (bounds ${ev.distanceToPlayableBoundsMeters}m, center ${ev.distanceToPlayableCenterMeters}m, fog ${ev.behindFogFar})`
      );
      assert.ok(Number.isFinite(dist), `${tier}/${mesh.name} backdrop distance finite`);
    }
    assert.ok(!/^(bacground_ground|shadow_tree|shadow_cubes)/.test(mesh.name), `${tier}/${mesh.name} artifact not present in shipped GLB`);
  }
}

// Source blend audit keeps the floating-defect evidence (class A) on record.
const blend = audit.blendSummary;
assert.ok(blend.groundedOverThreshold.includes('tree_small_02_a'), 'source blend documents the floating dead tree (class A)');

// Every net Y translation is traceable.
for (const change of audit.postprocessChanges) {
  assert.ok(Number.isFinite(change.netDeltaY), `${change.tier}/${change.name} netDeltaY recorded`);
}

// Datum repair check (class B): regenerated height.json matches the visual ground.
const datum = JSON.parse(fs.readFileSync(path.join(qaDir, 'datum-check.json'), 'utf8'));
assert.ok(datum.maxAbsVisualMinusHeightJsonMeters <= 0.05, `visual vs heightJson datum aligned (${datum.maxAbsVisualMinusHeightJsonMeters}m)`);
assert.ok(datum.samples.length >= 30, 'datum check covers the audited footprints');

// Runtime player support must use the rendered terrain, not a prop above it.
const runtime = JSON.parse(fs.readFileSync(path.join(qaDir, 'runtime-grounding.json'), 'utf8'));
const aligned = runtime.samples.filter((s) => s.walkable && Number.isFinite(s.visualGroundY));
assert.ok(aligned.length >= 5, 'runtime has enough walkable visual/collision comparisons');
for (const sample of aligned) {
  assert.ok(Math.abs(sample.visualMinusCollision) <= THRESHOLD,
    `runtime (${sample.x},${sample.z}) visual/collision gap ${sample.visualMinusCollision} <= ${THRESHOLD}`);
}
const origin = runtime.samples.find((s) => s.x === 0 && s.z === 0);
assert.ok(origin?.walkable && Math.abs(origin.visualMinusCollision) <= 0.05,
  'runtime origin boulder no longer replaces terrain support');

console.log('verdant grounding contract ok:',
  `low/med/high grounded ${audit.tiers.low.summary.groundedWithinThreshold}/${audit.tiers.low.summary.groundedTotal}`,
  `backdrop ${audit.tiers.low.summary.backdropWithDistanceEvidence}/${audit.tiers.low.summary.backdropTotal} with evidence`,
  `maxDatumDiff ${datum.maxAbsVisualMinusHeightJsonMeters}m`,
  `originRuntimeDiff ${origin.visualMinusCollision}m`);
