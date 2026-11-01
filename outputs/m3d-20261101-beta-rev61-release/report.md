# Beta rev61 release candidate

## Scope and base
- Preserves the live rev60 scene-filter release at ae2a70db7df76ef14f503db2df32967b3d83ce47.
- PAF final task head: c3d017601541155336813848edf239662cf5d96d.
- SmartFox final task head: 90b70dcff6b69a8cbc49ecb32ae5b953decf3610.
- Uploaded marmot final task head: 5f5acb0eb6dbe3a6cfc678016367a52ebe1e4136.
- Build commit: 95c6f2acc9f78181158d60f8a004397e0e0b2a2e (rev61).

## Behavior
- PAF hold aims, release attacks once, damage only in second half; cancellation paths clean.
- SmartFox eligible healthy foxes dynamically expand real attack capacity; headless matrix uses exactly one marmot.
- Uploaded GLB is byte-identical to the user input. Player idle/move/graze and companion follow/stop use StandIdle/Run as requested; alert uses StandUp.
- Existing rev60 scene filters remain in the integrated tree.

## Final integrated verification
- Changed-script node --check: 32.
- Full Node harness: 97/97 passed; 22 existing browser/CDP entries skipped by the harness, not counted as passed.
- Marmot production Chrome QA: 24/24 scenarios, 33 screenshots, no exceptions, three viewport sizes.
- PAF production Chrome QA: 18/18 checks, nine screenshots, no errors.
- SmartFox production Chrome QA: 4-fox and 8-fox scenarios start at 100 HP with godMode=false; >2 real attackers and actual production hits in both.
- Scene-filter regression: PASS, 31 screenshots, no exceptions. The static QA-only mirror contains the production TOS PAF MP3 (SHA b70f5931…b0137f7) to satisfy the script's local-audio precondition; the release tree itself was not modified with that extra asset.

## Limits
- Browser rendering is WebGL2 + SwiftShader. Filter performance samples are software-rendered and are not hardware-GPU or physical-phone results.
- Touch is Chrome/CDP emulation, not a physical device.
- Full 22-entry browser/CDP suite was not run.
- This report records a release candidate; the public symlink and online verification are recorded separately after deployment.
