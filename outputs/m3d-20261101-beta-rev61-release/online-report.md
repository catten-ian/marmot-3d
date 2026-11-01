# Beta rev61 online release verification

## Deployed code and rollback
- Public URL: https://www.catten.cyou/marmot3d-beta/
- Deployed runtime code commit: `b2c9b5962cb7f7b13065314f84951dee7646009b`.
- Build commit: `95c6f2acc9f78181158d60f8a004397e0e0b2a2e`; public stamp `rev61`.
- Live directory: `/var/www/m3d-releases/beta-rev61-paf-smartfox-marmot-20261101`.
- Rollback link: `/var/www/m3d-releases/.last-beta-link` → `beta-rev60-scene-filters-20261101`.
- Public `index-public.html` and `src/core/version.js` both report rev61.
- Public `src/main.js` SHA-256: `fcb2a39f1688c7db0b2501e84695fb828a597fadfa1ddae6f3ec171248edafd5`.
- Public uploaded GLB SHA-256: `95bfb02b245af132cf4f3a73200bcd0c89f59fb09019e92b904de20a9b61e787`.
- Six rev60 core runtime files were hashed before extraction and rechecked after switching: all OK; the old release was not written through hard links.
- Server download used the exact GitHub commit archive. The gzip ETag was not treated as a stable SHA. The archive top-level commit and core runtime hashes were verified. An additional full-tree Python helper was not run because the remote channel lacked interactive approval; it is not claimed as completed.
- Temporary server archive/extraction files were removed. No historical release was removed. Free disk space recovered from about 345 MiB to 672 MiB.

## Public production browser QA
All scripts ran against the real public Beta URL, with fresh managed Chrome profiles and serial browser execution.

### Uploaded marmot
- 24/24 scenarios passed across 1280x720, 768x1024 and 390x844.
- 33 screenshots; zero uncaught exceptions.
- Player StandIdle/Run/graze and companion StandIdle/follow/stop/StandUp passed; real skin deformation, texture, orientation and grounding assertions passed.
- Evidence: `/home/fame/codex-runs/m3d-20261101-beta-rev61-online/outputs/m3d-20261101-beta-marmot-upload/visual/`.

### PAF release attack
- 18/18 distinct behavior assertions passed, with nine screenshots.
- Keyboard, mouse, tablet and Chrome touch-emulation cases cover hold-only aiming, real prediction, one catch only in the second half, quick tap, pause/blur/settings/touch cancellation and resource cleanup.
- Online execution was split after the first run passed 13 desktop/FPV checks and then hit a 40-second tablet boot timeout. The remaining five tablet/touch checks passed with a 120-second resource-load wait. No combat assertion was changed or removed.
- The initial helper-import failure was in the QA-only copy: `/src/...` was corrected to `/marmot3d-beta/src/...`. Product module references were already relative and were not modified.
- Combined evidence: `/home/fame/codex-runs/m3d-20261101-beta-rev61-online/paf-online-final/qa-results.json`; original attempt logs remain in the same RUN.

### SmartFox dynamic attackers
- 4 foxes: HP 100→40, godMode=false, four distinct real attackers, four hitters, five real production hits, zero console errors.
- 8 foxes: HP 100→40, godMode=false, five distinct real attackers in the measured window, three hitters, five real production hits, zero console errors.
- Both cases assert more than two real attackers, a living full-HP start and actual production HP reduction; no HP write, godMode, forced commit or frozen AI was used.
- Evidence: `/home/fame/codex-runs/m3d-20261101-beta-rev61-online/smartfox-online/`.

### Visual inspection
Representative public screenshots were inspected for the uploaded player, mobile companion, PAF touch prediction and 4/8-fox combat. Models/textures and the PAF preview are present; no new grounding, orientation or HUD defect was identified in these samples. Close first-person fox framing in combat is visible and is not presented as a full visual-quality audit.

## Limits and follow-up
- Renderer: WebGL2 with ANGLE Vulkan SwiftShader. This is not a hardware-GPU result.
- Touch/mobile cases use viewport or Chrome touch emulation, not a physical phone.
- The full 22 browser/CDP entries skipped by the Node harness were not converted into passes.
- The previously deployed rev60 scene-filter functionality remains in the integrated runtime; its final integrated regression passed before deployment.
- SmartFox original task resumed separately after rev61 verification. Backend activation, spawn-vitals and further headless-lab work must not be considered complete merely because rev61 is live.
