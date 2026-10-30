# m3d-20261030-beta-paf-input

- Branch: `fix/beta-paf-input-20261030`
- Base SHA: `2d72774a29b7563b8628c3ee8dc8fd735fca3884`
- Channel: beta
- Job: `/home/fame/code/marmot3d/m3d-beta-paf-input-20261030`
- Delivery: local commit only; no push or deploy
- Implementation commit: recorded in the final delivery response after the local commit

## Goal and acceptance matrix

| Requirement | Result | Evidence |
|---|---|---|
| PAF FPV/TPS movement/action parity with camera-relative mapping | PASS | Shared `pafMovementFromInput`/`pafDirectionFromInput`; focused parity tests; browser W movement in TPS and FPV |
| PAF pounce reach is 1.25 using the real collision contract | PASS | `PAF_DEFAULTS.catchRadius = 1.25`; `canCatch` strict boundary tests; browser telemetry reports `catchRadius: 1.25` |
| Keyboard pounce choices W/A+W/A/D/W+D, touch equivalent, default 120° arc | PASS | Focused direction tests cover W, AW, A, D, WD, diagonal normalization, touch axes, finite fallback, configurable arc; browser A selection commits `-1.0471975516` rad (−60°) |
| Direction follows input through wind and commits to actual motion | PASS | Wind/lunge telemetry keeps committed yaw; desktop lunge position deltas match yaw and speed; touch wind/lunge telemetry keeps `0.9505471937` rad |
| Moving pounce is press-triggered and does not require hold/release | PASS | `PafPounceCharge` launches after wind time regardless of release; repeated press is rejected; touch browser sequence reaches wind → lunge → recover after a press |
| No repeated auto-trigger from held key | PASS | Keydown repeat is ignored and phase/state gate rejects re-arm; focused no-repeat test |
| Touch labels/debug text contain no stale hold-to-charge instruction | PASS | Touch screenshot and telemetry tip: `扑击按下后自动扑出`; source scan has no stale hold-charge wording |
| PAF config/debug arc parameter is clamped and exposed | PASS | `pounceArcDeg` default 120, runtime clamp 0–360, lil-gui slider, saved PAF config path remains active |
| Ordinary marmot controls and unrelated systems | PASS by scope review | Only PAF input, PAF debug, PAF tests, and PAF pounce default changed |

## Changed files

- `src/core/paf-input.js` — shared camera-relative movement/pounce direction helpers and press-based windup gate.
- `src/play/play-as-fox.js` — PAF parity movement, live wind direction selection, 1.25 reach, press-only pounce, touch copy and telemetry hook.
- `src/play/play-as-fox-debug.js` — configurable `pounceArcDeg` slider and updated pounce wording.
- `tools/test-paf-input-route.cjs` — parity, keyboard combination, touch direction, arc, press/no-repeat regression coverage.
- `tools/test-paf-pounce.cjs` — 1.25 collision reach boundary coverage.
- `outputs/m3d-20261030-beta-paf-input/` — browser screenshots and structured telemetry.

## Tests and validation

Syntax checks passed with `node --check` for every changed JS/MJS file:

- `src/core/paf-input.js`
- `src/play/play-as-fox.js`
- `src/play/play-as-fox-debug.js`
- `src/core/paf-camera.js` (read-only validation of the requested camera module)

Focused PAF command:

```text
node --test tools/test-paf-input-route.cjs tools/test-paf-camera.cjs tools/test-paf-pounce.cjs tools/test-paf-entry.cjs tools/test-paf-rock-collision.cjs tools/test-paf-fpv-viewmodel.cjs tools/test-paf-admin-sync.test.cjs
41 passed, 0 failed, 0 skipped
```

Full required Node runner:

```text
node tools/run-node-tests.cjs
90 PASS, 22 SKIP (browser/CDP), 0 FAIL
```

The 22 skips are the runner's browser/CDP tests and are explicitly skips, not passes. `git diff --check` also passed.

## Browser evidence

A local server and headless Chrome CDP were used for real interaction. Renderer telemetry:

```json
{"backend":"WebGL2","renderer":"ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver"}
```

Desktop (1280×720):

- TPS before/after movement captured in `desktop-tps-before.png` and `desktop-paf-after.png`; W moved z from `-6` to `-5.875`.
- FPV captured in `desktop-fpv-after-view.png`.
- Holding A while pressing Space produced wind telemetry at `pounceYaw = -1.0471975516` rad, the configured −60° arc edge. Lunge samples retained that yaw and moved by approximately `(-0.5846, +0.3375)` per sample, consistent with the committed direction and configured speed.
- `desktop-paf-wind.png` and `desktop-paf-after.png` capture before/after action state.

Mobile emulation (390×844 CSS pixels, DPR3; screenshots are 1170×2532 PNG):

- `mobile-390x844-tps-before.png` and `mobile-390x844-during-after.png`.
- Real touch joystick and attack dispatch reached `idle → wind → lunge → recover`.
- Touch joystick direction produced wind/lunge `pounceYaw = 0.9505471937` rad and retained it through lunge.
- Touch route was active (`touch-mode touch-playing paf-touch-route`), and the rendered help text was `左下摇杆移动 · 冲刺切换潜行 · 扑击按下后自动扑出（潜行）`.
- No console errors were recorded.

Structured data is in [`browser-telemetry.json`](./m3d-20261030-beta-paf-input/browser-telemetry.json); desktop-only early readback is in [`browser-telemetry-desktop.json`](./m3d-20261030-beta-paf-input/browser-telemetry-desktop.json). Screenshots are in the same directory.

## Unverified items

- Browser evidence used headless Chrome with SwiftShader WebGL2. A hardware accelerated desktop GPU path and a physical phone were not available in this environment.
- The browser sequence exercised W and A on desktop plus a continuous touch joystick direction; every listed keyboard combination is covered by deterministic direction-contract tests.
- The existing repository PAF FPV harness was also inspected; its older touch-button assumptions do not match the current shared touch layout, so its unrelated tracked artifacts were reverted. The dedicated run above is the authoritative evidence for this change.
