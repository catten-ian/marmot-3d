# Dev Verdant tier sizing report

- Task: `m3d-20261025-dev-verdant-tier-sizing`
- Channel/worktree: dev / `fix/dev-scene-assembly`
- Base: `9f65f10e83f7` (grounding round2 was already present at startup; current HEAD before this work was `db6c478`)
- Scope: local asset/export sizing only. No push, deployment, version stamp, stable, or beta changes.

## Dirty-worktree protection

Startup status was ` M tools/verdant/export_real_scene.py`; it was preserved and treated as the in-progress sizing change. No reset, clean, stash, or overwrite of unrelated files was performed. No `index.html` or `index-public.html` change was present in the startup status or final task diff.

## Tier comparison

Values are regenerated local assets and pack manifests after `node tools/verdant/build_pack_manifests.cjs assets/verdant`.

| tier | scene | pack total | files | exported triangles | texture files | texture policy (near/far/normal) | export mode |
|---|---:|---:|---:|---:|---:|---|---|
| low | 37.14 MiB | 61.80 MiB | 127 | 347,580 | 124 | 768/384/384 | decimated |
| medium | 53.25 MiB | 95.88 MiB | 127 | 392,945 | 124 | 1024/512/512 | decimated |
| high | 161.94 MiB | 327.83 MiB | 127 | 536,392 | 124 | 2048/1536/1024 | decimated |
| ultra | 0.11 MiB glTF JSON + native external pack | 2,167.61 MiB | 145 | 4,298,106 | native external pack | native source pack; 2048/512/1024 metadata | non-decimated |

The meaningful medium→high separation is now `3.42x` scene bytes and `3.42x` pack bytes (previously approximately `1.06x`). low→medium is `1.44x`; high→ultra pack is `6.61x`. Geometry and texture resolutions both increase, so the gradient is not a manifest-only padding change.

Loading-time planning follows pack bytes and is expected to be approximately proportional under equivalent cache/network conditions: low 1.00x, medium 1.55x, high 5.29x, ultra 35.32x relative to the low pack. Exact wall-clock loading depends on transport/cache/device and was not fabricated.

## Changes

- `tools/verdant/export_real_scene.py`: low/medium texture limits reduced to 768/384 and 1024/512; high raised to 2048/1536 with 1024 normal maps; high geometry ratios raised independently from medium.
- `assets/verdant/tiers/{low,medium,high}`: regenerated GLBs, texture sets, per-tier manifests and pack manifests.
- `assets/verdant/tiers/{low,medium,high}/verdant-trail-*-height.json`: regenerated exports retain the shared grounding height data and its canonical SHA.
- `assets/verdant/tiers/ultra/{manifest-ultra,pack-manifest}.json`: rebuilt pack metadata.
- `assets/verdant/manifest.json`: updated tier bytes, faces, hashes, pack bytes and file counts.
- `outputs/m3d-20261025-dev-verdant-tier-sizing-report.md`: this report.

All pack manifests have internally matching file paths, sizes, SHA-256/MD5 entries, and counts. Shared height SHA is `caf28a11a80973d44e611c7d4e1f5c701a2c600ead7cb4af55cb13db7d6cc863`.

## Verification

Passed:

- `python3 -m py_compile tools/verdant/export_real_scene.py`
- `node tools/test-verdant.cjs`
- `node tools/test-verdant-pack.cjs`
- `node tools/test-resource-loading.cjs`
- `node tools/verdant/build_pack_manifests.cjs assets/verdant`

Existing grounding evidence from round2 remains in `outputs/scene-assembly-qa/grounding-audit-*-final.json`; this task did not alter the grounding algorithm or collision assets. The exporter regenerated the same 257x257 shared height data and preserved the task's accepted grounding behavior.

## Known notes

Blender export emits pre-existing warnings for `trail_foliage` decimate modifiers requiring more than three input faces; export completes and contract tests pass. Ultra remains intentionally external/native and is not loaded as a single embedded GLB.

## Delivery

- Branch: `fix/dev-scene-assembly`
- Push/deploy: not performed
- Version stamp: not changed
- Stable/beta: not touched
