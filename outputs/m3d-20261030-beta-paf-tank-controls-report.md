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
## 2026-11-02 Beta TPS marmot regression fix

- Reproduced the integrated Beta regression: `FirstPersonController.update()` fed keyboard A/D through `this.yaw`, so TPS steering could alter the orbit camera path instead of only changing marmot body facing.
- Fixed `src/core/controls.js`: TPS keyboard steering starts from `bodyYaw`, writes the computed yaw to body-facing resolution, and never writes `this.yaw`; FPV keeps the existing camera/body coupling.
- Added source-contract assertions to `tools/test-control-merge.cjs` for TPS body-yaw baseline, no camera-yaw write, and body-facing propagation.
- A/D and arrow steering remain zero-throttle/no-lateral displacement; W/S continues throttle along the newly steered body heading. Touch TPS remains on `resolveTouchDrive` and its camera yaw remains read-only.

Validation (2026-11-02):
- `node --check src/core/controls.js` — passed.
- `node --check tools/test-control-merge.cjs` — passed.
- `node tools/test-control-merge.cjs` — passed.
- `node tools/test-tps-drive.cjs` — `158/158` passed.
- `node tools/run-node-tests.cjs` — `91/91` passed, `22` browser/CDP tests skipped (environment unavailable; not counted as passes).
- `git diff --check` — passed.

Before/after contract: before, integrated TPS keyboard steering used camera `yaw` as its steering baseline and could route A/D through camera state; after, TPS A/D changes only body facing (`bodyYaw`/`moveFacingYaw`), leaves camera yaw unchanged, and produces no strafe. Touch TPS camera-read-only and FPV paths are unchanged; W/S remains forward/back throttle.

Commit: pending local commit. Push/deploy: not performed.

## 2026-11-02 Follow-up: complete marmot TPS keyboard/touch equivalence

This follow-up supersedes the preceding marmot TPS claims that A/D should steer
without displacement and W/S should remain body-relative forward/back throttle.
Those semantics are retained for FPV only. In TPS, W/up, A/left, S/down and D/right
select screen-relative movement directions; the marmot faces that direction and
moves at normal speed. S turns toward screen-down and is not backpedal. Movement
keys never write camera yaw. Diagonals are normalized.

### Source inspection and reproduction

Inspected the actual `resolveTouchDrive` TPS branch before changing the keyboard
path. Its screen-to-world basis is:

- Screen-up: `(-sin(cameraYaw), -cos(cameraYaw))` in world X/Z.
- Screen-right: `(cos(cameraYaw), -sin(cameraYaw))`.
- Body facing: `atan2(-worldX, -worldZ)`; camera yaw is read-only.

Executed the production controller from base commit
`649d900bc40a5b6af0c26a840ccebbe431899272` in Node with real vendored Three.js,
initial camera yaw `1.13`, body yaw `-0.83`, and timestep `1/60`:

| Input | Base body yaw | Base backpedal | Base velocity X/Z |
| --- | --- | --- | --- |
| W | -0.830000 | false | 0.737142 / -0.674154 |
| S | -0.830000 | true | -0.427542 / 0.391009 |
| A | -0.824371 | false | 0 / 0 |
| D | -0.835629 | false | 0 / 0 |

Camera yaw remained `1.13` in all four base cases. This reproduced the remaining
body-relative/backpedal contract defect after the prior camera-ownership fix;
it does not claim a newly observed camera-yaw change at the base revision.

### Actual changes

- `src/core/move-facing.mjs`: added an explicit TPS option to
  `resolveKeyboardDrive`. In TPS, configured turn-map left/right keys become
  screen-axis movement inputs and use the existing pure `resolveTouchDrive`
  calculation. Default/FPV steering and backpedal behavior are unchanged.
- `src/core/controls.js`: all TPS input, including combined keyboard/touch axes,
  uses that same touch resolver with the actual camera yaw. The resolver sets
  body/move facing consistently with movement. Idle preserves body facing;
  movement lock zeros the combined axes before TPS resolution. The FPV branch
  retains its existing steering, signed throttle, touch look and camera coupling.
- `tools/test-control-merge.cjs`: replaced superseded TPS body-steering source
  expectations with screen-direction/shared-resolver assertions. Existing
  steering/backpedal scenarios remain explicitly covered as FPV expectations.
- `tools/test-tps-keyboard.cjs`: added eight Node tests running the complete
  production controller and real vendored Three.js math. Only import specifiers
  are adapted for Node; no controller method is replaced. A minimal document
  listener stub permits construction; it does not validate browser event delivery.

The fixed-step matrix covers driving/classic profiles, WASD, arrow aliases and
four diagonals, at zero yaw, camera-only nonzero yaw, body-only nonzero yaw and
both nonzero. At every step it checks body facing, actual velocity, camera state
and render-camera yaw, and keyboard/touch positions and velocities. Additional
checks cover pure keyboard intent, opposing keys, aliases, mixed-input speed
caps, FPV W/S and A/D, release braking, movement lock and fresh input after
release. Source contracts check pause/settings/blur clearing and the paused
simulation gate. Existing touch pointer tests exercise real `releaseAll` using
DOM stubs. No failing scenario was deleted or counted as browser validation.

### Final validation

All commands below completed successfully against the final code/test content:

| Command | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: |
| `node --check` on each of the four changed JS/MJS/CJS files above | 4 files | 0 | 0 |
| `node tools/test-control-merge.cjs` | 1 script | 0 | 0 |
| `node tools/test-tps-drive.cjs` | 158 checks | 0 | 0 |
| `node tools/test-tps-keyboard.cjs` | 8 tests | 0 | 0 |
| `node --test tools/test-control-merge.cjs tools/test-tps-drive.cjs tools/test-move-facing.cjs tools/test-tps-keyboard.cjs tools/test-touch-pointers.cjs tools/test-touch-drive.cjs` | 13 tests | 0 | 0 |
| `node tools/run-node-tests.cjs` | 92 scripts | 0 | 22 scripts |
| `git diff --check` and staged diff check | passed | 0 | 0 |

The focused runner's 13 tests comprise the eight new named tests and five
existing script-level tests. The full runner counts files, not their internal
assertions. Its 22 browser/CDP skips are:
`test-action-layout.cjs`, `test-attack.cjs`, `test-attacks.cjs`,
`test-body-view.cjs`, `test-dev-gs.cjs`, `test-dev-turn.cjs`, `test-ecology.cjs`,
`test-fixes.cjs`, `test-fox-navigation.cjs`, `test-fox-run.cjs`,
`test-fox-types.cjs`, `test-fullscreen.cjs`, `test-glb.cjs`, `test-gs.cjs`,
`test-jump-physics.cjs`, `test-models.cjs`, `test-particles.cjs`,
`test-posture.cjs`, `test-repel.cjs`, `test-v11.cjs`, `test-v12.cjs`,
`test-viewmodel.cjs`. These are runner-classified skips, not passes or proof
that Chrome cannot run on this machine.

### Commit, scope and limitations

Implementation/test commit:
`555a8224be84b6455e2b27943a02867c05c59855`
(`fix(beta): align TPS keyboard movement with touch directions`). This report
appendix is committed separately so it can record the exact implementation ID.
The implementation diff was reviewed before committing.

No browser/CDP run, real DOM keyboard/pointer interaction, rendered gameplay
inspection, or physical desktop/mobile-device check was performed. Visual model
turn interpolation and tactile feel remain unverified; controller/move-facing
agreement is verified by Node integration tests. Pause/settings/blur wiring is
source-checked; native browser event dispatch is not tested here.

Only the two permitted source files, two focused control tests and this report
were changed. PAF files, public shell/version stamps, other worktrees, server,
Caddy and systemd were not modified. The pre-existing `.codex-lock.d/` was left
untouched and uncommitted. Push/deploy were not performed.

