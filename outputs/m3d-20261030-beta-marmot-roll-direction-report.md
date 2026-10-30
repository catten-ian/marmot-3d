# Beta marmot roll-direction delivery report

## Delivery

- Base: `78ab70c143d4dfb3615767989f2f1c338a75cfff` (`78ab70c`)
- Implementation commit: `5d1699f9683aa077306a9b5aa636f8ff67669af8`
- Files changed for the task:
  - `src/core/combat-wheel.mjs`
  - `src/main.js`
  - `tools/test-marmot-roll-direction.cjs`
  - `outputs/m3d-20261030-beta-marmot-roll-direction-report.md` (this report)

## Behavior and evidence

- Added one production resolver shared by `doRoll()` and the combat-wheel `move === 'dodge'` branch. Both synchronously resolve and pass a world-space vector to `controller.roll()`, which latches the impulse at action start.
- Keyboard/mouse no-direction roll is camera/screen-right regardless of residual velocity or body yaw. Keyboard movement intent resolves camera-relative; diagonals normalize, and opposite directions cancel per axis (cancellation falls through to right unless a higher-priority input applies).
- Active configured movement keys, standard WASD actions, resolved movement-map aliases (including arrows), and active turn-map left/right bindings are sampled from the held-key set at roll start. This covers custom binds and beta driving controls without changing the locomotion update/resolver.
- Input priority is independent drag, joystick over the existing roll threshold (`> 0.18`), held movement direction, then fallback. Touch joystick axes are already stored as `{x: right+, y: up+}`; the touch producer assigns `y = -dy / maxStick` and zeroes magnitudes below `0.14`. The roll resolver preserves the prior `0.18` roll activation threshold. Touch-origin no-direction rolls keep the previous velocity/body-facing fallback; keyboard/mouse does not use it.
- Existing roll speed, energy, recovery, invulnerability, camera, PAF, pounce, and combat tuning were not changed. The movement resolver itself was not modified. The focused test checks the ordinary diagonal movement normalization and backpedal speed contract.
- `tools/test-marmot-roll-direction.cjs` deterministically exercises four nonzero/zero camera yaw values, default-right despite velocity/body yaw, W/S/A/D, AW/SD, opposing inputs, arrows/custom binds/driving turn-map binds, joystick direction/dead zone, drag priority, start-time latching, touch fallback, shared direct/combat-wheel resolver wiring, touch-axis producer sign/dead-zone wiring, and ordinary movement behavior.

## Commands and results

Syntax checks:

```sh
for f in src/core/combat-wheel.mjs src/main.js tools/test-marmot-roll-direction.cjs; do node --check "$f"; done
```

Result: **3 files checked, 0 syntax errors**.

Focused tests:

```sh
node tools/test-marmot-roll-direction.cjs
node tools/test-combat-wheel.cjs
node tools/test-move-facing.cjs
node tools/test-keybind-cameraview.cjs
node tools/test-input-mode.cjs
```

Result: **5/5 commands passed**. The keybind test reported 4 pass / 0 fail / 0 skipped. The input-mode test emitted its expected denied-storage diagnostic from its failure-path case and ended with `test-input-mode: OK`.

Full Node suite:

```sh
node tools/run-node-tests.cjs
```

Result: **92 passed, 0 failed, 22 skipped** (114 discovered test files). Skips are browser/CDP tests requiring Chrome; they are not counted as passes. The runner printed `OK 92/92` and listed all 22 skipped test filenames.

Whitespace check:

```sh
git diff --check
```

Result: **passed**.

## Limitations

- Browser/CDP interaction was not run; the suite classified and skipped 22 Chrome-dependent tests. No browser result is claimed.
- No push, deploy, public-shell/version/index-public edits, or changes to other worktrees were performed.
