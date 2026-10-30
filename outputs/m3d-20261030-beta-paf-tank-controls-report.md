# m3d-20261030-beta-paf-tank-controls

## Scope and behavior

Restored tank-style normal locomotion in PAF, matching the requested throttle + steering contract:

- W / Up and S / Down move forward/back along the fox's body facing.
- A / Left and D / Right turn the fox left/right; steering input does not directly produce lateral displacement.
- The touch joystick's vertical axis supplies signed throttle and its horizontal axis supplies steering. Existing radial clamp/dead-zone behavior is retained; diagonal inputs are normalized by the shared touch mapping.
- TPS and FPV share the same body-facing movement and steering update. FPV camera look remains decoupled from body yaw.
- Pounce direction remains separate: its direction selector still reads keyboard and joystick input while a pounce is winding up. It is not converted into normal drive or removed.
- Settings-open and paused states gate update/input/action starts. Pause and mode exit clear held keys and PAF touch state and call the shared touch release routine.

No pounce speed, damage, stamina, AI balance, shell, index, or version stamp changes were made.

## Changed files

- `src/core/paf-input.js` — added tank-drive mapping, keyboard aliases, action/update gates and shared input release; corrected PAF joystick steering sign.
- `src/play/play-as-fox.js` — drives PAF locomotion through body-facing throttle/steering in both views; keeps the pounce direction context separate; gates settings/pause and releases inputs.
- `tools/test-paf-input-route.cjs` — deterministic vector/yaw tests at nonzero facing, WASD/arrow aliases, touch vertical/horizontal/diagonal/dead-zone, pounce selection, and pause/release tests.
- `tools/test-paf-audio-settings.test.cjs` — updated settings/input gate assertions to match the production helper contract.

## Validation

- `node --check src/core/paf-input.js && node --check src/play/play-as-fox.js && node --check tools/test-paf-input-route.cjs && node --check tools/test-paf-audio-settings.test.cjs` — **4/4 passed**.
- `node --test tools/test-paf-input-route.cjs tools/test-paf-audio-settings.test.cjs` — **18 passed, 0 failed, 0 skipped**.
- `node --test tools/test-paf-input-route.cjs tools/test-paf-camera.cjs tools/test-paf-pounce.cjs tools/test-paf-entry.cjs tools/test-paf-rock-collision.cjs tools/test-paf-fpv-viewmodel.cjs tools/test-paf-admin-sync.test.cjs` — **44 passed, 0 failed, 0 skipped**.
- `node tools/test-control-merge.cjs` — **all assertions passed** (legacy shared control policy unchanged).
- `node tools/run-node-tests.cjs` — **91/91 Node tests passed; 22 browser/CDP tests skipped by the repository runner; 0 failed**. Skips are not counted as passes.
- `git diff --check` and staged diff check — passed.

## Evidence and limitations

Movement contracts are exercised through the production `pafTankDriveFromInput` helper, asserting world-space x/z vectors and yaw signs at a fixed nonzero facing (0.73 rad). Keyboard alias mapping is tested through the production `pafKeyboardDriveInput`; settings pause routing is tested with the actual shared `createSettingsPauseHooks`; pounce selection remains covered through `pafDirectionFromInput` and the independent pounce helper contract.

No browser/CDP or physical-device testing was performed; browser/CDP is not a release gate for this Beta task. The deterministic logic tests do not validate gamepad/browser event delivery or tactile feel on a physical phone. The touch adapter consumes the existing shared joystick axis values and dead zone.

## Git / release state

- Branch: `fix/beta-paf-tank-controls-20261030`
- Base: `78ab70c143d4dfb3615767989f2f1c338a75cfff`
- Commit: `25951cb` (`fix(beta): restore PAF tank controls`)
- Push/deploy: **not performed**.
