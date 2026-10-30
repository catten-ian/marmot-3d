# m3d-20261030 beta SmartFox team report

- Date: 2026-10-30
- Job: `/home/fame/code/marmot3d/m3d-beta-smartfox-team-20261030`
- Channel: beta only
- Branch: `fix/beta-smartfox-team-20261030`
- Base: `c94cbfa1a7073ac702fa4245d2fc3b75ba76c603`
- Implementation commit: `0aa5eef` (`fix(beta): coordinate SmartFox team roles and recovery`)
- Evidence report commit: this report is committed locally after the implementation commit above.
- Push/deploy: not performed

## Implemented behavior

`src/entities/smart-fox-core.mjs` now exposes beta team thresholds and deterministic role allocation. With three or more eligible foxes, the coordinator allows at most two attack slots (one `striker`, one `flanker`); surplus healthy foxes become `interceptor`, and depleted foxes become `rest`. Hard retreat remains `retreat`. Selection ranks distance, health ratio, stamina ratio, and fatigue with slot tie-breaking. Healthy thresholds are HP ratio `0.62`, stamina ratio `0.35`, and fatigue at most `0.72`; rest thresholds are HP ratio `0.42`, stamina ratio `0.20`, or fatigue at least `0.86`. Role hold time is `1.5s` with a `1.2s` switch cooldown. Interceptors receive a deterministic blocking point and cannot pass the pounce commit gate.

`src/entities/smart-fox.js` applies beta roles to movement, exposes `teamRole`/`roleSince`, emits role fields in SmartFox telemetry, and maps interceptors to a visible `intercept` state. Existing pounce commit, dash, strike, melee, and non-beta role behavior remain on their prior paths.

`src/core/fox-motion.js` extends the shared pure stamina stepper with state-specific recovery rates and finite/clamped inputs. Stamina recovers in non-drain states; beta SmartFox rates are rest `14/s`, recover `4.5/s`, intercept `2.5/s`, and roam `1.2/s`. Health recovery is performed only when `resting` is true. Sprint/pounce drain and exhaustion locking remain intact. Beta tuning values live in `src/core/beta-tuning.js`.

## Tests and evidence

Commands run from the job root:

```text
node --check src/core/fox-motion.js
node --check src/core/beta-tuning.js
node --check src/entities/smart-fox-core.mjs
node --check src/entities/smart-fox.js
```

Result: all four checks passed.

```text
node tools/test-fox-tactics.cjs
```

Result: 13/13 passed. Covers beta attacker cap, health/condition prioritization, rest assignment, role hysteresis/cooldown, deterministic interceptor positions, and legacy role behavior.

```text
node tools/test-fox-vitals.cjs
```

Result: 11/11 passed. Covers sprint drain, rest recovery, exhaustion locking, state-specific stamina recovery, health-only-rest recovery, immutability, and NaN/negative/over-cap clamping.

```text
git diff --check
```

Result: passed with no whitespace errors.

```text
node tools/run-node-tests.cjs
```

Result: `OK 90/90`. The repository harness skipped 22 browser/CDP tests because Chrome/CDP is unavailable in this environment. All non-browser tests passed, including the existing SmartFox beta, pounce, melee, closed-loop, tuning, and stamina suites.

## Known unverified items

- No live Chrome/CDP evidence was available because the existing harness detected no Chrome session; browser tests are explicitly recorded as skipped by `tools/run-node-tests.cjs`.
- No push, deployment, public shell, Caddy/systemd, or version-stamp changes were made.
