# m3d-20261105 beta rev65 SmartFox integration report

- Task: `m3d-20261105-beta-rev65-smartfox`
- Worktree: `/home/fame/code/marmot3d/_int_beta_rev65_smartfox_20261105`
- Branch: `integ/beta-rev65-smartfox-20261105`
- Base: `2928ea09f5e458c3988d1b4d08a4f45968608bd9`
- Feature source reviewed: `/home/fame/code/marmot3d/m3d-beta-smartfox-ai-research-20261104`, commit `2534e54`
- Integration commit: `14cc0ebe4fd06811e4a69c0f8d0dc737eba33a05` (`feat(beta): integrate omniscient SmartFox coordination`)

## Changed files

- `src/entities/smart-fox-core.mjs`: added the SmartFox shared blackboard, real-time omniscient target observation, coordination metrics, and preserved the existing attack-slot/dynamic-attacker gates.
- `src/entities/smart-fox.js`: consumes and refreshes the shared sensory sample and records decision candidates while retaining the existing physical motion and attack state machines.
- `src/main.js`: publishes the current player target once per active sandbox frame, reuses pack tactics, and records actual SmartFox committed hits and damage.
- `tools/test-smart-fox-beta.mjs`: adds tests for omniscient shared target state, pack metrics, and the runtime damage guard.
- `tools/qa-smart-fox-managed.cjs`: allows an explicit `SMARTFOX_QA_CDP` endpoint and pins the managed QA URL to the Beta sandbox with models disabled.

## Conflict resolution and design

Commit `2534e54` was not blindly cherry-picked because its bounded visual cone, obstacle visibility, relay radius, and expiring last-known sample contradict the confirmed Beta design. Its useful blackboard, coordination, and metrics shape was ported into rev65. The Beta blackboard now receives the player's current state every frame and SmartFoxes may read it unconditionally. This is perception/shared target state only: no fox is teleported and no synthetic position is written into fox motion. Existing physical movement, turn-rate limits, terrain steering, obstacle resolution, stamina, windup, dash, recovery, and real strike/contact hit checks remain authoritative.

The synthetic training harness and its training damage values were not merged into runtime gameplay. Runtime SmartFox damage remains sourced from `FOX.damage.default`, which is `12`; no `34` training damage is used.

## Validation

Syntax checks passed with `node --check` for every changed `.js`, `.mjs`, and `.cjs` file:

- `src/entities/smart-fox-core.mjs`
- `src/entities/smart-fox.js`
- `src/main.js`
- `tools/qa-smart-fox-managed.cjs`
- `tools/test-smart-fox-beta.mjs`

Passing focused Node tests:

- `node --test tools/test-smart-fox-beta.mjs` — 31 passed.
- `node --test tools/test-smart-fox-closed-loop.mjs tools/test-smart-fox-aim-fix.mjs tools/test-smart-fox-melee.mjs tools/test-smart-fox-vitals-runtime.mjs` — 53 passed.
- PAF/Predator tests: `test-paf-pounce`, `test-paf-prey-mind`, `test-paf-evasion`, `test-paf-rock-collision`, `test-paf-touch-contract`, `test-paf-input-route`, `test-paf-camera`, and `test-paf-models` — 32 passed.
- Relevant fox/AI/vitals tests: `test-beta-fox-ai`, `test-fox-pounce`, `test-fox-tactics`, `test-fox-vitals`, and the related navigation suite — pure Node assertions passed where browser initialization was not required.
- Beta contract/gameplay/stun tests — 9 passed.

Browser/CDP status:

- `/usr/bin/google-chrome` exists and is executable.
- Shared CDP `http://127.0.0.1:18800` was unreachable (`ECONNREFUSED`), so `node tools/qa-smart-fox-managed.cjs` could not attach and exited before browser assertions.
- `tools/test-attacks.cjs` failed during dynamic module loading from `chrome-error://chromewebdata/src/systems/combat.js`.
- `tools/test-fox-navigation.cjs` failed at its browser initialization timeout.
- These are recorded as browser/Three.js acceptance failures or unexecuted checks; they are not counted as synthetic Node passes.

No push was performed. No deployment was performed. No Caddy, systemd, or online files were changed. No other worktree was modified, reset, or cleaned.
