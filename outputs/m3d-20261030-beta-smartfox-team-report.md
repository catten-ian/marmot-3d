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

## 2026-10-31 follow-up rework (rev58 base)

- User goal: Beta SmartFox teammates must actively reinforce/attack during a player fight; a retreating fox must leave quickly to a genuinely distant safe rest point under teammate pressure; a defeated Beta SmartFox must remain dead for the current run.
- Base SHA: `e1d6c0774cb7af387fd9e7c2c6559f8c5b388d8e` (rev58).
- Modified files: `src/core/fox-motion.js`, `src/core/beta-tuning.js`, `src/entities/fox.js`, `src/entities/smart-fox.js`, `src/entities/smart-fox-core.mjs`, `tools/test-fox-repel.cjs`, `tools/test-fox-tactics.cjs`, and this report.

### Behavior changes

- Beta pack attacker budget now opens at two eligible foxes, capped at two attackers. In a two-fox encounter the roles are `striker` + `flanker`; with three healthy foxes at least those two roles are assigned and only surplus members become `interceptor`. Retreating, dead, rest, and depleted foxes are excluded from attack slots.
- Beta flankers are mapped to a real `pounce`/melee path and are admitted by the pounce commit gate. Interceptors are no longer forced into `feint`; they approach/observe as pressure while attack slots remain reserved for healthy attackers. The existing coordinator commit window remains in place.
- `defeatFate`/`stepDefeatCooldown` accept a beta guard. Beta `smart` has `respawns:false`; stable/dev and normal/pup/fast/heavy retain their prior respawn contract.
- Beta SmartFox retreat tuning uses runtime consumers `beta.smartRestMinPlayerDistance = 60` and `beta.smartRetreatSpeed = 10.5`. Rest-point selection evaluates legal burrow/boundary candidates by player distance, preserves roam bounds and obstacle clearance, returns the farthest reachable fallback when 60m is not attainable, and records `playerDistance`/`reachableMaxPlayerDistance` on fallback data. If the player makes the target unsafe during retreat, a new legal far target is selected. HP recovery remains confined to `rest_safe`.

### Validation

All changed JS/MJS files passed:

```text
node --check src/core/fox-motion.js
node --check src/core/beta-tuning.js
node --check src/entities/fox.js
node --check src/entities/smart-fox.js
node --check src/entities/smart-fox-core.mjs
```

Focused deterministic tests:

```text
node tools/test-fox-repel.cjs                  # 20/20 passed
node tools/test-fox-tactics.cjs                # 15/15 passed
node tools/test-beta-tuning-audit-remainders.mjs # 4/4 passed
node tools/test-beta-tuning-defects.mjs        # 5/5 passed
node tools/test-fox-tuning.cjs                 # 7/7 passed
node tools/test-smart-fox-closed-loop.mjs      # 26/26 passed
node tools/test-smart-fox-melee.mjs            # 8/8 passed
node tools/test-smart-fox-beta.mjs             # 26/26 passed
node tools/test-fox-vitals.cjs                 # 11/11 passed
node tools/test-fox-navigation.cjs             # passed
node tools/test-beta-fox-ai.cjs                # passed
```

Full harness:

```text
node tools/run-node-tests.cjs
```

Result: `OK 94/94`; 22 browser/CDP tests were skipped because no Chrome/CDP session was available. No browser or hardware-GPU acceptance is claimed.

```text
git diff --check
```

Result: passed.

- Evidence paths: `tools/test-fox-repel.cjs`, `tools/test-fox-tactics.cjs`, and harness output above; no synthetic browser play evidence was available.
- Unfinished items: live browser verification of teammate attacks, distant retreat visibility, and post-death persistence could not run because Chrome/CDP was unavailable.
- Push/deploy: not performed.

## 阶段 0：SmartFox 后台/runtime 收尾 checkpoint（2026-10-31）

- 工作树/分支：`/home/fame/code/marmot3d/m3d-beta-smartfox-team-20261030` / `fix/beta-smartfox-team-20261030`
- 阶段基线：`e9cb773798b340aa069e8ca96e150bdb64be00f6`
- 变更范围：仅 Beta SmartFox 后台运行时、出生状态、体力/恢复/撤退读取与测试；未改 PAF、滤镜、黑匣子、rig/动画、public shell、`index-public.html`、线上 active、Caddy/systemd。
- 独立后台组：`智能狐 · 生命/体力/恢复/撤退`，共 62 个 `beta.smart*` 参数，全部 `runtime` capability。已补齐扑击提交环爬行/对齐、团队提交窗口/间隔、意图去抖等此前遗漏项；默认值来自当前真实消费端。
- 运行时路径：admin `beta.*` 值经 `runtimePayloadFromAdminConfig` → schemaVersion 1 payload → `sanitizeRuntimeValues`（有限数、非负、比例/上下限 clamp，合法 0 保留）→ active 配置；显式 `?betaConfig=` 覆盖 active，storage 仅作回退。SmartFox 构造时快照 `createSmartFoxTuning/createSmartFoxVitals/createSmartFoxRetreat`，普通狐继续读取共享 `FOX.vitals/FOX.retreat`。
- 出生根因/修复：此前 `opts.hp` 同时承担上限和当前血量，导致生成后状态混淆；现在默认 `hp=maxHp`、`stamina=maxStamina`、锁定/连击/撤退/死亡均为清零/关闭，只有显式 `initialHp` 进入测试/回放语义并 clamp。新实例读取激活后的新快照，已有实例不半截热更新。
- 浏览器证据（上一轮已生成，未重复矩阵）：`outputs/m3d-20261030-beta-smartfox-team/vitals-admin/admin-group.png`、`admin-activated.png`、`sandbox-spawn.png`、`state-assertions.json`、`active-config.local-only.json`、`commands.txt`。本地测试服务，未写线上配置；`WebGLRenderer` / WebGL 2.0 / ANGLE SwiftShader 软件渲染，console errors=0。断言覆盖后台保存激活、显式 URL、自定义上限满状态、首帧静置无异常 recover/retreat、多实例独立、真实受击消耗/漫游恢复/撤退阈值/远撤/安全回血/死亡不复活、扑击和近战消耗。

验证结果：

- 指定聚焦测试：admin 6/6；runtime 4/4；fox vitals 11/11；fox tactics 15/15；smart fox beta 26/26；fox tuning 7/7；新增 SmartFox vitals/runtime 10/10；机制文档 4/4。
- `node tools/run-node-tests.cjs`：`OK 95/95`，22 个 browser/CDP 项按 harness 规则 skipped（需要 Chrome/CDP），不计为通过。
- `git diff --check`：通过。
- 阶段 0 checkpoint commit：待本节提交后记录；push/deploy：未执行。
