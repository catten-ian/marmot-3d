# m3d-20261025-dev-verdant-grounding-round2

## Result

**The 2.4176 m grounding contradiction at `(0,0)` is closed.** The final managed-Chrome CDP sample is:

| surface | before | after |
|---|---:|---:|
| visible `ground` (`visualGroundY`) | 2.4654 m | 2.4654 m |
| visual-derived height JSON (`heightJsonY`) | 2.4639 m | 2.4639 m |
| player collision (`collisionY`) | 4.8829 m | 2.4639 m |
| absolute visible/collision gap | 2.4176 m | **0.0015 m** |
| walkable | true | true |

The final maximum absolute visible/collision difference over all five walkable visual sample points is **0.0097 m**. At `(0,20)` there is correctly no visible terrain and `walkable=false`; it is not counted as supported ground. `heightJsonY === collisionY` at every final sample.

Evidence: `outputs/scene-assembly-qa/runtime-grounding.json`, `outputs/scene-assembly-qa/round2/cdp-report.json`, and `outputs/scene-assembly-qa/round2/backend-errors.json`.

## Root cause and fix

This was **not** a double export/runtime offset, tier datum shift, or local-space value missing a world transform. A live all-mesh downward raycast at `(0,0)` found:

- `boulder_01001`: `y=4.9974 m`
- `ground`: `y=2.4654 m`

`rasterizeColumns()` merged every solid upward-facing triangle into one highest-surface column. The boulder therefore replaced the terrain as the player's support height, while the QA visual ray intentionally sampled `ground`. Coarse raster interpolation caused smaller discrepancies at other points.

The source fix in `src/world/verdant-collision.js` now:

1. Rasterizes only authored `ground` / `sand` terrain for player support coverage and connected placement surfaces. Boulders, cliffs, trunks, and roots cannot replace the terrain height. Boulder/cliff obstacle-proxy handling remains separate.
2. Uses the height JSON regenerated from the shipped visual `ground` triangles as the authoritative player height. The terrain raster supplies coverage/connectivity, not a second, differently sampled height datum.
3. Removes the now-unused nearest-cell chamfer SDF and rock-top height statistics.

An intermediate run with terrain-only raster heights reduced the origin gap to `0.0760 m`, but failed the new `0.05 m` origin assertion. This exposed the remaining raster interpolation error and motivated the authoritative visual-derived JSON height; the assertion was not weakened.

`src/world/verdant.js` documents the single-datum contract. `tools/qa-verdant-round2.cjs` now fails unless all walkable visual samples are within `0.15 m`, the origin is within `0.05 m`, and the WebGL backend is healthy. `tools/test-verdant-grounding.cjs` independently applies the runtime numeric contract.

## Final runtime samples

| x,z | visual Y | height JSON Y | collision Y | visual-collision | walkable |
|---|---:|---:|---:|---:|---|
| 0,20 | null | 0.0000 | 0.0000 | null | false |
| -18,8 | 1.9185 | 1.9184 | 1.9184 | +0.0001 | true |
| 24,-18 | 4.3176 | 4.3176 | 4.3176 | 0.0000 | true |
| 0,0 | 2.4654 | 2.4639 | 2.4639 | +0.0015 | true |
| -30,-20 | 0.5307 | 0.5404 | 0.5404 | -0.0097 | true |
| 20,10 | 5.2378 | 5.2378 | 5.2378 | +0.0001 | true |

## Commands and real results

### Syntax

```sh
git status --porcelain | sed 's/^...//' | rg '\.(cjs|mjs|js)$' | while IFS= read -r f; do node --check "$f" || exit 1; printf 'OK %s\n' "$f"; done
```

Result: exit 0; `OK` for all 17 changed/untracked JS/MJS/CJS files, including `src/core/controls.js`, `src/world/verdant-collision.js`, `src/world/verdant.js`, `tools/qa-verdant-round2.cjs`, and `tools/test-verdant-grounding.cjs`.

### Project tests

```sh
node tools/run-node-tests.cjs
```

Result: exit 0, **OK 39/39**. The runner listed 22 browser/CDP tests as SKIP; the required Verdant browser path was run separately below, not counted among those Node passes. Full output: `outputs/scene-assembly-qa/node-tests-final.log`.

```text
PASS test-verdant-grounding.cjs
PASS test-verdant-obstacles.cjs
PASS test-verdant-placement.cjs
PASS test-verdant.cjs
OK 39/39
```

```sh
node --test tools/test-verdant-placement.cjs tools/test-verdant-obstacles.cjs tools/test-verdant-fall-safety.cjs
node tools/test-verdant.cjs
node tools/test-verdant-grounding.cjs
```

Results: 9/9 targeted tests passed; tier manifest test passed with shared height SHA-256 `caf28a11a80973d44e611c7d4e1f5c701a2c600ead7cb4af55cb13db7d6cc863`; grounding contract printed:

```text
verdant grounding contract ok: low/med/high grounded 39/39 backdrop 9/9 with evidence maxDatumDiff 0.0152m originRuntimeDiff 0.0015m
```

### Fresh geometry audits and datum

```sh
/home/fame/tools/blender/blender -b /home/fame/marmot3d-assets/verdant_trail/verdant_trail.blend --python tools/verdant/audit_grounding.py -- --blend /home/fame/marmot3d-assets/verdant_trail/verdant_trail.blend --out outputs/scene-assembly-qa/grounding-audit-blend-final.json
/home/fame/tools/blender/blender -b --python tools/verdant/audit_grounding.py -- --glb assets/verdant/tiers/low/verdant-trail-low.glb --source-audit outputs/scene-assembly-qa/grounding-audit-blend-r2.json --out outputs/scene-assembly-qa/grounding-audit-low-final.json
/home/fame/tools/blender/blender -b --python tools/verdant/audit_grounding.py -- --glb assets/verdant/tiers/medium/verdant-trail-medium.glb --source-audit outputs/scene-assembly-qa/grounding-audit-blend-r2.json --out outputs/scene-assembly-qa/grounding-audit-medium-final.json
/home/fame/tools/blender/blender -b --python tools/verdant/audit_grounding.py -- --glb assets/verdant/tiers/high/verdant-trail-high.glb --source-audit outputs/scene-assembly-qa/grounding-audit-blend-r2.json --out outputs/scene-assembly-qa/grounding-audit-high-final.json
```

Outputs use new `grounding-audit-*-final.json` intermediates; prior evidence was preserved. Logs are `outputs/scene-assembly-qa/audit-{blend,low,medium,high}-final.log`.

Results:

- Source blend: 42 grounded; 14 source floats retained as class-A evidence; 7/7 backdrops have distance evidence.
- Low: 39/39 grounded within 0.15 m, zero missing ground hits, 9/9 backdrop evidence.
- Medium: 39/39 grounded within 0.15 m, zero missing ground hits, 9/9 backdrop evidence.
- High: 39/39 grounded within 0.15 m, zero missing ground hits, 9/9 backdrop evidence.

```sh
python3 tools/verdant/check_ground_datum.py \
  --audit outputs/scene-assembly-qa/grounding-audit-low-final.json \
  --height assets/verdant/tiers/low/verdant-trail-low-height.json \
  --out outputs/scene-assembly-qa/datum-check.json
```

Result: 38 samples, maximum `|visual-heightJson| = 0.0152 m`.

```sh
python3 tools/verdant/assemble_grounding_audit.py --blend outputs/scene-assembly-qa/grounding-audit-blend-final.json --low outputs/scene-assembly-qa/grounding-audit-low-final.json --medium outputs/scene-assembly-qa/grounding-audit-medium-final.json --high outputs/scene-assembly-qa/grounding-audit-high-final.json --snap-low outputs/scene-assembly-qa/audit-final/snap-low.json --snap-medium outputs/scene-assembly-qa/audit-final/snap-medium.json --snap-high outputs/scene-assembly-qa/audit-final/snap-high.json --manifest-low assets/verdant/tiers/low/manifest-low.json --manifest-medium assets/verdant/tiers/medium/manifest-medium.json --manifest-high assets/verdant/tiers/high/manifest-high.json --runtime-grounding outputs/scene-assembly-qa/runtime-grounding.json --datum-check outputs/scene-assembly-qa/datum-check.json --out outputs/scene-assembly-qa/grounding-audit.json
```

Result: exit 0, 50 traced postprocess changes, runtime decision `aligned_at_sampled_points`. Full output: `outputs/scene-assembly-qa/assemble-final.log`.

### Managed-Chrome CDP

```sh
timeout 480s node tools/qa-verdant-round2.cjs
```

Used existing managed Chrome at `http://127.0.0.1:18800`; no Chrome process was spawned. Final run completed within the hard cap, with scene ready at 260 s. Result: exit 0, `pass:true`.

```text
zeroConsoleErrors: true
fiveShots: true
externalCameraModelVisible: true
walkableTerrainAligned: true
originGroundingClosed: true
backendHealthy: true
maxAbsVisualMinusCollision: 0.0097
originAbsVisualMinusCollision: 0.0015
errors: []
```

Backend: WebGL2, ANGLE Intel Mesa Iris Xe, `contextLost:false`, `glError:0`, `consoleErrors:[]`. Two non-error model slow-loading warnings remain recorded. Five fresh screenshots are in `outputs/scene-assembly-qa/round2/01-...png` through `05-...png`; third-person and overview numeric camera checks place the camera outside the player box (`5.135 m` and `34.019 m` from the model center respectively).

## Remaining risk / not closed here

- Runtime CDP was required and run on **low** only. Medium/high have fresh geometric audits, not fresh full runtime CDP passes.
- Ultra was not re-exported in round 2; its pre-existing unchanged geometry and later master/TOS handling remain outside this closure.
- Player support is now deliberately terrain-only. Standing/jumping on boulder or cliff tops is not supported by this height field; those meshes remain visible and use the separate conservative obstacle path. No rock-top traversal acceptance was claimed or run.
- No TOS upload, deployment, beta shell bump, Caddy/systemd change, or push was performed. Any later asset publication must include the corresponding modified GLBs, height JSON, tier manifests, and pack manifests together.
