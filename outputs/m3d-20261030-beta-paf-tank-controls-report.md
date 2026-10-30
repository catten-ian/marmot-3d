# m3d-20261030-beta-paf-tank-controls

## Scope and corrected behavior

This correction keeps the delivered tank-control design, input gates, release helper, pounce separation, and report structure while fixing the handedness defect identified in review.

The proven PAF frame is used directly: `f(yaw) = (sin yaw, 0, cos yaw)`, local +Z is forward, yaw 0 faces +Z, and TPS screen-right / the fox's own right is `screenRight(yaw) = cross(f, up) = (-cos yaw, 0, sin yaw)`. Since `dot(d(f)/d(yaw), screenRight) = -1`, increasing yaw turns screen-left and decreasing yaw turns screen-right. This matches mouse-look in `src/play/play-as-fox.js`, where `fox.yaw -= e.movementX * cfg.mouseTurn`.

- Keyboard steering now uses `turn = left - right`: A/Left increases yaw and turns screen-left; D/Right decreases yaw and turns screen-right.
- `TouchControls._updateJoystick` establishes `move.x > 0` for a rightward drag. `mapPafJoystick` now maps that to `turn = -x`, so joystick right drag matches mouse-right and D/Right.
- WASD and arrow aliases remain mapped to the existing `forward`, `back`, `left`/`turnLeft`, and `right`/`turnRight` action IDs. Vertical joystick input remains throttle along the current body facing; steering produces no lateral displacement.
- Pounce direction selection remains independent of ordinary locomotion. Its local horizontal input is aligned to the same frame: D/right selects the fox's own right with a negative local yaw offset; A/left selects the fox's own left with a positive offset. Arc clamping, keyboard/touch/fallback source semantics, diagonal normalization, and dead-zone behavior remain intact.
- During wind, the selected pounce direction may update from deliberate input; once lunge begins, `fox.lungeYaw` is used for all lunge displacement and ordinary locomotion cannot rewrite it. The existing wind/launch code retains the last deliberate selection when input is released.
- Settings-open, paused, stopped, and mode-exit gates remain active. Release still clears held keys, touch state, and shared TouchControls pointers.

## Geometry and camera checks

`src/entities/paf-fox-model.js` already faces local +Z at yaw 0: the body comment states `面朝 +Z`, the head is at positive local Z, the chest is forward at positive Z, the muzzle and nose extend farther positive Z, and the tail is at negative Z. No geometry heading correction was required.

TPS uses the documented trailing camera pose and screen-right frame. FPV uses `fpvCameraPose` direction from `look.yaw`/`look.pitch`, while `fox.yaw` remains the independent body steering heading. The focused camera test confirms equal look state gives equal FPV direction even when body yaw differs; corrected tank steering still uses the body's own right.

## Changed files

- `src/core/paf-input.js` — corrected keyboard, joystick, and pounce handedness; fixed frame comments; retained gates, aliases, normalization, fallback, and release behavior.
- `tools/test-paf-input-route.cjs` — replaced mirrored yaw-sign assertions with screen-space dot-product checks and corrected pounce offsets/joystick signs.
- `outputs/m3d-20261030-beta-paf-tank-controls-report.md` — this correction report.

No changes were needed in `src/play/play-as-fox.js`, `src/core/paf-camera.js`, `src/core/touch-controls.js`, or `src/entities/paf-fox-model.js`.

## Validation

- `node --check src/core/paf-input.js` — passed.
- `node --check src/play/play-as-fox.js` — passed.
- `node --check tools/test-paf-input-route.cjs` — passed.
- `node --check tools/test-paf-audio-settings.test.cjs` — passed.
- Focused PAF suite: `node --test tools/test-paf-input-route.cjs tools/test-paf-camera.cjs tools/test-paf-pounce.cjs tools/test-paf-entry.cjs tools/test-paf-rock-collision.cjs tools/test-paf-fpv-viewmodel.cjs tools/test-paf-admin-sync.test.cjs` — **44 passed, 0 failed, 0 skipped**.
- Model/audio/settings checks: `node --test tools/test-paf-models.cjs tools/test-paf-audio-settings.test.cjs` — **15 passed, 0 failed, 0 skipped**.
- Full suite: `node tools/run-node-tests.cjs` — **91 passed, 0 failed, 22 skipped**. All 22 skips are browser/CDP tests requiring Chrome and are not counted as passes.
- `git diff --check` — passed.

The screen-space steering tests compute the heading vector at a fixed nonzero yaw and dot it with `screenRight(yaw)`: right input must be positive, left input negative. The same method covers A/D, arrow aliases, joystick drags, and diagonal steering while preserving throttle-along-facing and no-lateral-strafe assertions.

## Limitations

No browser/CDP or physical-device testing was performed; browser/CDP is not a release gate for this Beta task. Logic tests do not measure tactile feel or browser event delivery on a phone. The joystick sign is validated from the production `TouchControls._updateJoystick` implementation (`clientX - centerX`, so right drag gives positive `move.x`) and the PAF adapter contract.

## Git / release state

- Branch: `fix/beta-paf-tank-controls-20261030`
- Base: `78ab70c143d4dfb3615767989f2f1c338a75cfff`
- Prior commits reviewed: `25951cb`, `245cac3`
- Correction commit: to be recorded after validation
- Push/deploy: **not performed**.
