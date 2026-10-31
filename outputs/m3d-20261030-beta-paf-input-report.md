# m3d-20261030-beta-paf-input

- Branch: `fix/beta-paf-input-20261030`
- Base SHA: `2d72774a29b7563b8628c3ee8dc8fd735fca3884`
- Channel: beta
- Job: `/home/fame/code/marmot3d/m3d-beta-paf-input-20261030`
- Delivery: local commit only; no push or deploy
- Implementation commit: `8b4c3de8b8e7cd2e40224f59a6e38778d4495c92` (local)
- Report commit: documentation follow-up commit on this branch (reported with the final delivery SHA)

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

## 2026-10-31 追加契约：按住瞄准、松开扑击、后半段命中

本轮沿用同一 JOB，基于 rev58 base `e1d6c0774cb7af387fd9e7c2c6559f8c5b388d8e`。新契约取代旧的“按下即触发 / windTime 到点自动扑出”：按住只进入 wind 预备并显示预测范围，松开才启动一次 lunge；旧 `windTime` 调参项已移除，固定后半段窗口不暴露面板旋钮。

改动文件：

- `src/core/paf-input.js`：`PafPounceCharge` 改为带 pointer identity 的 press/hold/release/cancel 闸门；重复回调、多指、无关 release 均不发招；新增 `pafPounceActiveAt`、`pafPouncePathAt`、`pafPouncePreviewSegment`，统一后半段窗口和真实路径端点。
- `src/play/play-as-fox.js`：键盘、鼠标左键、TouchControls 攻击统一 hold/release；blur、暂停、设置暂停、退出会取消预备并清理预览；预览使用真实 lunge 半段扫掠胶囊和目标环标记；实际 `canCatch` 仅在 `pafPounceActiveAt(...)` 为真时结算；HUD/触控 aria 更新为“按住瞄准/显示范围，松开扑击”。预览几何与标记在释放、取消、退出时 dispose。
- `src/play/play-as-fox-debug.js`：移除已不再有运行时意义的旧 windTime 面板项。
- `tools/test-paf-input-route.cjs`：旧按下自动扑出断言改为新 hold/release、超旧 windTime 不自动攻击、release 去重、pointer identity、后半段边界和路径一致性断言。
- `tools/test-paf-entry.cjs`：独立触控 DOM 约束改为只检查 DOM id，允许共享纯逻辑函数名。
- `outputs/m3d-20261030-beta-paf-input-report.md`：追加本轮契约、实现和证据。

确定性验证：

- `node --check src/core/paf-input.js src/play/play-as-fox.js src/play/play-as-fox-debug.js`：通过。
- `node --test tools/test-paf-input-route.cjs tools/test-paf-camera.cjs tools/test-paf-pounce.cjs tools/test-paf-entry.cjs tools/test-paf-rock-collision.cjs tools/test-paf-fpv-viewmodel.cjs tools/test-paf-admin-sync.test.cjs`：45 passed, 0 failed, 0 skipped。
- `node tools/run-node-tests.cjs`：94/94 passed；22 browser/CDP tests skipped（需要 Chrome），0 failed。skip 未计入通过。
- `git diff --check`：通过。

后半段边界已明确覆盖：归一化 `t=0`、`0.25`、`0.499999` 不命中，`t=0.5` 和 `t=1` 允许进入现有 `canCatch` 几何，`t>1` 不命中；recover 不再调用命中。一次攻击通过目标 `caught` 状态只结算一次，预览阶段不改 HP/score/猎物状态。静止目标的预测语义是释放时刻及攻击路径不变则后半段命中；释放后猎物自主移动属于时间语义变化，不算预览错误。

视觉矩阵：本环境存在外部 Chrome CDP，但现有 `tools/qa-paf-stage1.cjs` 和 `tools/qa-paf-fpv-managed.cjs` 仍等待 rev58 的旧“按下自动 lunge”时序，启动后分别停在旧场景/导航等待，已中止以避免伪造证据；本轮没有把 synthetic fixture 当作实机通过。390×844、768×1024、1280×720 的真实 TPS/FPV/触控截图和“按住无捕获、松开攻击”的实机证据因此未验证，记录为阻塞项，不能宣称视觉验收通过。

资源清理：预览 group、CapsuleGeometry、材质和目标环在每次释放/取消/暂停/退出时移除并 dispose；TouchControls 仍由共享 route 管理，退出先 `releaseAll()` 再 restore，避免重复监听或跨次输入残留。未修改 `src/main.js`、智能狐 AI、rig/动画、public shell、版本戳或其他工作树；push/deploy 未执行。

本轮本地实现 commit：交付时 `git rev-parse HEAD`；push/deploy 未执行。
