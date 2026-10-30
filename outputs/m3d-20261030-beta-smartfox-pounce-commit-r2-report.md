# SmartFox beta pounce commit R2 report

- Task: `m3d-20261030-beta-smartfox-pounce-commit` (retry R2)
- Channel: beta
- Branch: `fix/beta-smartfox-pounce-commit-r2-20261030`
- Base: `2d72774`
- Commit: `17c66b8` (implementation commit; report metadata follow-up is local only)
- Scope: local source/tests/QA/report only; no push or deploy

## Diagnosis and fix

The failure was in the approach/locomotion handoff. `SmartFox.update()` computed a braking `approachSpeed`, but the `stepSmartMotion()` options selected sprint speed from `intent === 'pounce'`; the computed approach speed never reached the locomotion primitive. The fox therefore retained enough forward momentum to cross the 4.2 m inner edge while its yaw error was still above 20 degrees. The approach FSM then entered `backoff`, so strict range and angle readiness never overlapped.

The fix passes the beta pre-commit `approachSpeed` into `stepSmartMotion` as `speedTarget` and gives only pre-commit locomotion stronger braking authority (`locomotionAcceleration: 60`). Committed dash acceleration and locked yaw remain unchanged. The second edge was hysteresis: the FSM can report `phase: align` in its ±0.28 m tolerance band while still outside the strict 4.2–6.2 m gate. The controller now holds still only when `ready === true`; otherwise it continues creeping toward the strict window.

The fast-forward harness now freezes only the RAF tick and calls the production `update(dt)` through a QA hook, so the real AI, collision, contact damage, stamina, and role code run with fixed 1/60 s game time. Setup uses ordinary keyboard locomotion to move away from the base burrow; it does not teleport the player or fox.

## Verification

### Node and focused tests

- `node --check` passed for all changed JS/MJS files.
- `node tools/run-node-tests.cjs`: `OK 90/90`.
- Focused SmartFox tests passed: `test-smart-fox-closed-loop.mjs`, `test-smart-fox-aim-fix.mjs`, `test-smart-fox-melee.mjs`.
- Regression coverage starts a fox at 9 m with a 180° yaw error, simulates the approach controller, requires simultaneous strict distance+angle readiness, and requires one real `stepSmartMotion` commit.

### Production-update fast-forward, single fox

Evidence: `outputs/m3d-20261030-smartfox-difficulty-qa/fastforward-single-final.json`.

- Renderer: WebGL2, SwiftShader; console errors: 0.
- Setup game time: 6.867 s; measured run: 20.000 s of fixed game time.
- Natural commit: 1 at game time 8.467 s, distance 6.165 m, role `striker`.
- Strike transition: 1 at game time 9.000 s, distance 4.123 m.
- Minimum distance: 1.072 m.
- Real production hit events: 9; `game.hits` increased from 0 to 11.
- Player HP: 100 → 0.
- No actor repositioning or forced `pounceCommitted` state was used.

### Production-update fast-forward, three foxes

Evidence: `outputs/m3d-20261030-smartfox-difficulty-qa/fastforward-multi-final.json` and `fastforward-multi-hp1000.json`.

- Three live SmartFoxes ran through the team-role allocator.
- Role evidence included `striker`, `rest`, `flanker`, and `interceptor` during the run; the final 20 s sample ended with one `striker` and two `rest` foxes.
- With normal HP 100, real player HP fell 100 → 0 with 9 hit events and no console errors.
- A 1000 HP endurance run advanced 30.000 s of game time and reduced HP 1000 → 748 across 21 real hit events.
- The multi-fox setup caused close-range role churn before a separate pounce commit could be captured in the same short run; the single-fox production run above is the direct pounce commit/strike proof. This multi-fox pounce-count item remains unverified.

### Real-time browser checks

The harness was also exercised against isolated Chrome CDP with desktop WebGL2 SwiftShader and mobile emulation support in the QA scripts (`390x844`, DPR 3, touch, CPU throttling 4x). The fixed-step production-update runs are healthy and report exact game time. A complete long wall-clock real-time desktop+mobile acceptance run was not completed in this environment because SwiftShader asset/render startup was too slow; no success claim is made for that unverified portion. The managed Chrome at port 18800 was not disturbed.

## Changed files

- `src/entities/smart-fox.js`
- `src/entities/smart-fox-core.mjs`
- `src/main.js` (QA-only fixed-step hook; normal RAF behavior unchanged)
- `tools/test-smart-fox-closed-loop.mjs`
- `tools/qa-smartfox-fastforward.cjs`
- `tools/qa-smartfox-gate.cjs`
- `tools/qa-smartfox-difficulty.cjs`

No release, push, deploy, public shell, version stamp, Caddy, systemd, dev, or integration tree was modified.
