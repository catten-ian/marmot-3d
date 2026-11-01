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

## 阶段 1：无头 SmartFox combat lab（最终 checkpoint）

阶段 0 commit：`6ac0ebb` (`fix(beta): expose SmartFox vitals in admin runtime`)。

新增无渲染共享适配：

- `src/headless/smartfox-combat-lab.mjs`：纯数值状态，不创建 renderer、不加载模型/贴图/DOM；直接调用生产 `smart-fox-core.mjs` 的 `utilityScores/updatePerception/assignRoles/stepSmartMotion/advanceSmartMelee/smartMeleeContactHit`，生产 `fox-motion.js` 的 `stepStamina/shouldRetreat/chooseRestPoint/stepRestSafe`，生产 `systems/combat.js` 的 `resolveStrikeProfile/strikeVolumeHit`，以及 SmartFox vitals/retreat 构造器。浏览器实体只负责 Three.js 适配。
- `tools/smartfox-headless-lab.mjs`：`matrix` 与 `repro` CLI，固定 dt、注入 PRNG、seed、数量、移动策略、场景和 JSON 输出；失败场景返回非零退出码。输出含 config、commit、wallMs、ticks、实体最终血量/体力/状态、攻击尝试/命中/迎击、扑击提交、撤退、死亡、不变量和有限事件 trace。
- `tools/test-smartfox-headless-lab.mjs`：6/6，包含确定性、出生满状态、自定义上限、三种指定开场、数量矩阵、live/headless 共享核心契约、死亡不复活。

CLI 示例：

```bash
node tools/smartfox-headless-lab.mjs repro --seed 1003 --scenario parry-tap --movement stationary --foxes 1 --marmots 1 --duration 12 --out outputs/m3d-20261030-beta-smartfox-team/headless/repro-parry.json
node tools/smartfox-headless-lab.mjs matrix --duration 8 --out outputs/m3d-20261030-beta-smartfox-team/headless/matrix.json
node tools/smartfox-headless-lab.mjs repro --config /tmp/smartfox-lab-config.json --out outputs/m3d-20261030-beta-smartfox-team/headless/config-repro.json
```

场景支持：`faceoff-tap`（面对面持续真实 tap）、`chase-pounce-tap`（追击、生产扑击提交/strike 后持续 tap）、`parry-tap`（只有真实前摇窗口和共享攻击体积/方向满足才记录 `parry_success`，否则场景失败）；移动策略：`stationary/chase/orbit/kite/zigzag`。默认 matrix 代表 1/2/4/8 狐狸与 1/2/4 土拨鼠的单狐、团队、多目标和压力组合。

基线→定位→修复→回归：

- `headless/baseline-before-fix.json` 保留初始失败：静态 faceoff 被错误 no-progress 判失败；追击和迎击没有形成真实扑击窗口（0 pounce / 0 parry）。
- 修复内容：保留静态 faceoff 为合法场景；为追击/迎击只在真实距离/朝向提交门内冻结前摇，仍由 `stepSmartMotion` 决定 commit；迎击仅在 `pounceStage=windup`、真实距离和攻击方向满足时成功；修正休息安全状态迁移，避免每帧重复 retreat/rest_safe；一次性扑击成本记录并实际扣除。
- 同 seed 修复后：`baseline-faceoff.json` completed，1 次生产扑击提交、4 次真实土拨鼠命中；`baseline-chase.json` completed，1 次生产扑击提交、4 次真实土拨鼠命中；`baseline-parry.json` completed，1 次生产扑击提交、1 次 `parry_success`、6 次真实土拨鼠命中。三者均 `invariants=[]`。
- `baseline-matrix.json`：5 个代表 case 全部 completed、无 NaN/越界；8 狐/4 土拨鼠压力 case 记录 3 只真实死亡，死亡实体最终 `hp=0,state=dead`，无复活。

性能/边界：默认固定步长（默认 1/60，可由 `--dt` 覆盖）；`--config FILE` 支持 seed/数量/场景/移动和 tune overrides；上述 12 秒单场 wall time 约 12–15ms，8 秒 matrix 更低于 100ms；无 wall-clock AI 随机，事件 trace 上限 5000。无头结果只证明共享数值战斗逻辑，不替代浏览器视觉/GPU/手机验收。

- 阶段 1 commit：`9b1b0a5` (`test(beta): add headless SmartFox combat lab`)。最终 commits：`6ac0ebb`, `9b1b0a5`。push/deploy：未执行。未完成项：无头实验场不替代浏览器视觉/GPU/手机验收；主控独立验收与上线均未宣称。

最终提交修正：阶段 1 实际提交为 `056ffa4`（无头实验场）与 `689ed36`（`--config` 覆盖入口）；阶段 0 为 `6ac0ebb`。以上均为本地 commit，push/deploy 未执行。

---

## 2026-11-01 动态攻击者扩展（同一任务续接）

### 范围与实际规则

- Base：`b90c0e0d62ba1d9a78c7c8cacf6de8e1bbf7b8f7`。只改 Beta SmartFox 核心/实体、无头 lab、相关测试和本任务证据；`main.js`、PAF、Stable/Dev、普通狐、rig/动画、滤镜、黑匣子和 public shell 均未改。
- Beta 角色分配不再读取 `maxAttackers` / `minFoxesForMultiAttackers`。符合 `attackReachable !== false`、HP 比例 ≥0.62、体力比例 ≥0.35、疲劳 ≤0.72 的 eligible 狐全部成为真实攻击者：1 只 striker，其余 flanker；数量无固定上限。eligible 已排除撤退、`rest_safe`、死亡，以及低血/低体力/高疲劳休息者。若整群都不满足健康门槛，只保留 1 只最近 eligible 狐作 fallback，避免全队死锁；其余可成为 interceptor。
- 这不是角色标签改动：生产 `SmartFox` 的既有真实扑击门允许 striker/flanker，并继续检查真实可达、体力、recover lock、cautious/evade 和朝向/距离。Beta 在实体更新中启用 coordinator 的动态提交模式；1.2 秒窗内不再限制最多两个 commit。保留 `smartPackSpacing + (slot % 3) * smartPackSlotSpacing` 的短暂错峰、既有 separation/局部避碰，不增加无敌或伤害。
- 1–4 狐包抄槽位保持旧布局；超过 4 狐使用 `2π/n` 全圆分布，消除重复 60° 槽位。Stable/default `createSmartPack()` 仍保留原两 commit 窗限制，非 Beta `assignRoles` 仍是单主攻旧路径。
- 未改任何默认 HP、体力、伤害、消耗、恢复或撤退数值；远撤回血、死亡当局不复活/不回血语义保持。

### 无头 lab 与生产共享边界

- 无渲染 lab 直接调用生产 `assignRoles`、`createSmartPack`、`utilityScores`、`updatePerception`、`stepSmartMotion`、`advanceSmartMelee`、`smartMeleeContactHit`、`stepStamina`、`shouldRetreat` 等；本论生产变更就在上述共享核心。`src/entities/smart-fox.js` 是浏览器实体适配层，负责可达障碍、视觉状态、生产输入与实际 hit/combat 接入。
- lab 始终恰好 1 只土拨鼠，即使 repro 传入更大 `marmots` 也不例外。默认 matrix 为 1/2/4/8 狐 × stationary/chase/orbit/kite/zigzag × faceoff-tap/chase-pounce-tap/parry-tap × 3 seeds，固定 `dt=1/60`，每例 6 秒，共 180 例。每狐输出 commit/pounce strike/melee strike/hit、状态时间、撤退和死亡；场景输出玩家伤害/受击、攻击压力、峰值攻击角色/并发扑击/窗内 commit。
- lab 适配修复（单土拨鼠、zigzag seeded phase、contact cooldown、统计和重复 strike 计数）不称为生产 AI 优化。生产行为变化仅为动态角色、动态提交窗和大群体包抄槽位。

### 同 seed 前后量化

原始数据、每狐事件和完整配置：

- `headless/dynamic-attackers/before-matrix.json`（旧生产核心 + 新 lab 仪表）
- `headless/dynamic-attackers/after-matrix.json`（动态生产核心）
- `headless/dynamic-attackers/comparison.json`、`summary.md`、`commands.txt`

| 狐数 | 侧 | 完成/失败 | 最大不同扑击提交者 | 最大实际攻击者 | commit | 扑击 strike | 近战 strike | 近战 hit | 玩家伤害 | 攻击压力 | 撤退 | 死亡 |
|---:|:---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | before | 45/0 | 1 | 1 | 45 | 30 | 45 | 45 | 45 | 75 | 45 | 0 |
| 1 | after | 45/0 | 1 | 1 | 45 | 30 | 45 | 45 | 45 | 75 | 45 | 0 |
| 2 | before | 45/0 | 2 | 2 | 60 | 45 | 75 | 75 | 75 | 120 | 75 | 0 |
| 2 | after | 45/0 | 2 | 2 | 60 | 30 | 75 | 75 | 75 | 105 | 75 | 0 |
| 4 | before | 45/0 | 3 | 4 | 135 | 105 | 240 | 210 | 210 | 345 | 90 | 0 |
| 4 | after | 30/15 | 4 | 4 | 90 | 90 | 180 | 135 | 135 | 270 | 105 | 0 |
| 8 | before | 45/0 | 4 | 8 | 180 | 165 | 375 | 345 | 345 | 540 | 0 | 0 |
| 8 | after | 45/0 | 8 | 8 | 240 | 210 | 435 | 255 | 255 | 645 | 105 | 0 |

“最大不同提交者/实际攻击者”是整例 unique 计数，不能单独代表同一时刻；另记录峰值。相同 seed=20261031、stationary faceoff：

- 4 狐：before 不同 committer=3（0/1/2）；after=4（0/1/2/3），实际攻击者=4，峰值攻击角色=4、并发扑击=3、1.2 秒窗内 commit=3。
- 8 狐：before 不同 committer=4（0/1/2/7）；after=8（0–7），实际攻击者=8，峰值攻击角色=8、并发扑击=3、1.2 秒窗内 commit=4。

这些数字不宣称所有场景伤害都上升：4 狐总伤害反而从 210 降到 135，8 狐从 345 降到 255；攻击范围扩大后，受击/撤退时序也改变。保留原始结果而不挑选只改善的指标。

After matrix 为 **165 completed / 15 failed**。15 例全部是 4 狐 `parry-tap`（5 移动 × 3 seeds），原因是整个固定时长内未出现真实 `parry_success`，被明确标为 setup/scenario failed；before 为 180/180 completed。未删除失败、未伪造迎击、未把它们计入通过。Node 自测将这 15 个已知 setup 失败的数量/类型固定为回归证据，其余 165 例均 completed，全部 180 例无数值越界。此项仍是剩余问题，不宣称三种开场在全部数量组合均成功。

性能：before 921.658 ms，after 971.231 ms；180×6 秒名义模拟共 1080 秒，after 约 1112× 实时（纯 Node、无 renderer）。每例 360 tick，无超时；after 的 15 个失败均为真实迎击 setup 失败，不是异常/NaN/超时。

### 真实生产浏览器代表 smoke

命令：`node tools/qa-smartfox-dynamic-attackers.cjs`。本地静态服务 + Beta sandbox，经正常 UI 生成 SmartFox；固定步进调用生产 `qaStep`，玩家位置通过正常移动离开洞穴排斥区。未 teleport、未写 HP、未强制 commit/strike、未改命中阈值或冻结 AI。

- 4 狐：不同真实攻击者 4（0/1/2/3，均执行近战）；其中 2 只（2/3）提交并执行扑击。
- 8 狐：不同真实攻击者 6（1/2/3/4/5/7）；其中 3 只（4/5/7）提交并执行扑击，3 只（1/2/3）执行近战。
- 两例均确认生产 `sandboxState.smartPack.dynamicAttackers === true`，`moreThanTwoRealAttackers=true`，console error=0。
- 证据：`browser-4fox.json`、`browser-8fox.json`、对应 PNG 和 `browser-commands.txt`。WebGL2 / `WebGLRenderer`，ANGLE Vulkan **SwiftShader 软件渲染**；不是硬件 GPU 验收。截图是运行结束时的代表帧，视觉/手机/主控独立验收不在此自评范围内。

### 验证

- 7 个变更 JS/MJS/CJS 全部 `node --check` 通过，日志：`node-check.log`。
- 聚焦测试全部通过：`test-fox-tactics` 17/17、`test-smart-fox-beta` 27/27、`test-smartfox-headless-lab` 7/7、`test-fox-vitals` 11/11、`test-smart-fox-vitals-runtime` 10/10、`test-beta-tuning-audit-remainders` 4/4、`test-beta-tuning-defects` 5/5、`test-smart-fox-melee` 8/8、`test-runtime-config` 4/4、`test-admin-tuning` 6/6；`test-smart-fox-closed-loop` 脚本成功。日志：`focused-tests.log`。
- 完整 `node tools/run-node-tests.cjs`：**96/96 passed，0 failed，22 browser/CDP skipped**；skipped 未计入通过。日志：`full-node-tests.log`。
- `git diff --check` 通过；最终 stage 仅本任务文件，`.codex-cli-write.lock` 未纳入。

### 改动文件与剩余问题

- 生产：`src/entities/smart-fox-core.mjs`、`src/entities/smart-fox.js`。
- lab/测试/浏览器：`src/headless/smartfox-combat-lab.mjs`、`tools/test-fox-tactics.cjs`、`tools/test-smart-fox-beta.mjs`、`tools/test-smartfox-headless-lab.mjs`、`tools/qa-smartfox-dynamic-attackers.cjs`。
- 证据：仅 `outputs/m3d-20261030-beta-smartfox-team/headless/dynamic-attackers/` 与本报告。
- 剩余：4 狐 parry-tap 的 15 个固定矩阵组合未形成真实迎击，需要后续诊断土拨鼠目标选择/距离与多狐前摇时序；没有为通过矩阵而强制迎击。主控独立验收未执行，本 worker 自报不等于上线。

实现 commit：`e1e1e5965595ba97ce104c2ea639a568a365fea8`（含代码、测试与浏览器/矩阵证据）；本报告 hash 记录另作 docs checkpoint。push=未执行，deploy=未执行。

---

## 2026-11-01 主控 changes-requested 回应：parry 回归与有效生产 QA

- 本轮基线：`fba2555d9d71bd65ab89ff31b63add1d39e323bb`；保留 `e1e1e5965595ba97ce104c2ea639a568a365fea8` 与 `fba2555`，未 reset/clean/stash。
- 范围仍限 Beta SmartFox 核心/实体、headless lab、QA、测试、证据与报告；未改 `main.js`、PAF、Stable/Dev、普通狐、rig/动画、滤镜、黑匣子、版本或 public shell。

### 1. 4 狐 parry-tap 回归：根因、真实修复与 180 例复跑

定位发现两层问题，未将失败改成预期：

1. 旧 lab 把“3.2m 内看到 windup”直接记作迎击成功，没有走完生产的前摇输入、有效攻击帧、真实接触距离/朝向与垂直重叠结算。这个捷径会掩盖多狐攻击时序问题，不能继续用来凑 completed。
2. live 与 lab 共用的扑击接近段存在时长上限缺陷：旧二分以 `SMART_POUNCE_TUNE.dashDuration=0.42s` 为固定上限；默认加速下最多约覆盖 1.755m，而 5–7m 提交需要更长的接近段才能进入原有 strike 接触带。动态攻击者扩展后，该缺陷使 15 个 4 狐 parry 组合无法形成真实迎击。

实际修改：

- 新增共享 `smartPounceDashDurationForDistance()`，live `SmartFox` 的 Beta 路径与 headless lab 都调用它。接近段时长按原目标距离计算，必要时超过 0.42s、最高 2s；只延长真实加速移动时间，**未改伤害、体力消耗、strike 时长、命中体积或迎击阈值**。
- lab 改用生产 `resolveParryOutcome`、`foxAttackVerticalHit` 以及生产玩家/狐狸碰撞半径和 `smartPounceHitRadiusCap`。土拨鼠在真实 windup 时输入并开启既有 0.3s 迎击窗；只有后续 strike 接触满足距离、朝向和垂直重叠才记录一次 `parry_success`，之后进入真实连续推击。新增 `parry_attempt`、接触距离/reach 和失败原因事件。
- `selectMarmotTarget` 在迎击准备阶段选择真实 windup 攻击者，不再被更近的 idle 狐抢走目标；输入本身不等于成功。没有强制 commit、冻结玩家、瞬移、改 HP 或放宽断言。
- 回归测试现在要求完整 6 秒 matrix **180/180 completed**、每个 parry case 恰有一次真实 `parry_success`、成功距离不超过生产 reach、之前存在有效输入且之后有真实推击；旧的“固定接受 15 个失败”断言已移除。

正式命令与原始证据：

```bash
node tools/smartfox-headless-lab.mjs matrix --duration 6 \
  --out outputs/m3d-20261030-beta-smartfox-team/headless/dynamic-attackers/changes-requested/matrix-180-after.json
node tools/qa-smartfox-dynamic-attackers.cjs
node tools/run-node-tests.cjs
```

结果：**180/180 completed，0 failed**；全部 180 例恰好 1 只土拨鼠；60 个 parry 场景全部有真实 `parry_success`；此前失败的 **15/15 个 4 狐 parry 组合全部 completed**。共 64,800 tick，Node matrix wall time 1.0794s（`/usr/bin/time` 为 1.11s），无超时/NaN/越界。动态攻击能力未回退：stationary faceoff、seed=20261031 下，4 狐为 4 个不同 committer/striker，8 狐为 8 个不同 committer/striker。

修复后全矩阵按狐数汇总（原始每狐事件未删减）：

| 狐数 | completed/failed | commit | 扑击 strike | 近战 strike | 近战 hit | 玩家伤害 | 撤退 | 死亡 | 最大不同 committer/attacker |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | 45/0 | 45 | 45 | 45 | 45 | 45 | 45 | 0 | 1/1 |
| 2 | 45/0 | 60 | 60 | 75 | 75 | 75 | 60 | 0 | 2/2 |
| 4 | 45/0 | 105 | 105 | 210 | 165 | 165 | 60 | 0 | 4/4 |
| 8 | 45/0 | 225 | 225 | 420 | 360 | 360 | 105 | 0 | 8/8 |

旧 `before-matrix.json`（180/180）与有回归的 `after-matrix.json`（165/180）均保留作对照；新数据位于 `changes-requested/matrix-180-after.json`。汇总见 `matrix-180-summary.json` 与 `matrix-180-regression-summary.json`，命令、wall time 分别见 `matrix-180-command.txt`、`matrix-180-time.txt`。

### 2. 有效生产实体浏览器 QA：满血存活开局与真实 hit

`tools/qa-smartfox-dynamic-attackers.cjs` 现在先暂停固定步进、清场，用正常键盘移动离开洞穴排斥区，再一次性生成整批狐狸，随后才记录 `hpBefore` 并推进 6 秒战斗。旧流程在逐只生成之间推进 90 帧，先生成的狐会在计时前攻击，导致无效的 `hpBefore=0`；该 setup 已移除。

- 开局硬断言：玩家 `hp=maxHp=100`、`mode=play`、`godMode=false`。QA 不写 HP、不注入死亡、不 teleport、不强制攻击、不冻结 AI、不关闭闪避、不改命中阈值。
- 每狐记录 commit/pounce strike/melee strike/hit。hit 不是由 strike 推断：通过生产实际接触后该狐 `contactCd` 的跳变，关联同帧生产 `player-hit` 日志，并保留 attackKind、damage、hpBefore/hpAfter、preventedByGodMode。
- 4 狐：HP **100→40**；4 只不同真实攻击者（slot 0/1/2/3），4 只均有真实 hit；共 5 次生产 hit（4 次 pounce、1 次 melee），玩家结束仍存活。
- 8 狐：HP **100→40**；6 只不同真实攻击者（slot 0/1/3/4/6/7），3 只有真实 hit；共 5 次生产 hit（3 次 pounce、2 次 melee），玩家结束仍存活。6 秒窗内 slot 2/5 没有实际攻击，slot 4/7 有 commit 但尚未形成 strike；没有为凑全员命中而延长时间、关闭闪避或改数值。每狐最终 HP/体力/状态见 JSON `perFox`。
- 两例所有 QA 断言通过，**console error=0**。测量结束保持暂停，确保截图 HP 与 JSON 结束状态一致，不让 wall-clock 帧在截图前增加未记录伤害。
- 证据：`changes-requested/browser-4fox.json`、`browser-8fox.json`、对应 PNG、`browser-run.log`、`browser-commands.txt`。

renderer/backend 为 `WebGLRenderer` / WebGL 2.0 / ANGLE Vulkan **SwiftShader 软件渲染**。这些证据只覆盖本地真实生产实体与战斗流程，**不代表硬件 GPU、手机、视觉质量或主控独立验收**。

### 3. 验证、改动与限制

- 6 个变更 JS/MJS/CJS 全部 `node --check` 通过，见 `changes-requested/node-check.txt`。
- 聚焦测试：`test-smartfox-headless-lab` 8/8、`test-smart-fox-beta` 28/28、`test-fox-tactics` 17/17、`test-fox-pounce` 8/8、`test-parry-window` 72 checks、`test-fox-vitals` 11/11、`test-fox-tuning` 7/7，全部通过、0 skipped；日志 `focused-tests.txt`。
- 完整 `node tools/run-node-tests.cjs`：**96/96 passed，0 failed，22 browser/CDP skipped**。22 个 skipped 没有计入通过；上述 4/8 狐 QA 是另外实际执行的浏览器代表场景，不把整套 skipped browser matrix 冒充已运行。日志 `run-node-tests.txt`。
- `git diff --check` 通过；只 stage 本任务代码、测试、证据和报告，`.codex-cli-write.lock` 未纳入。
- 改动文件：`src/entities/smart-fox-core.mjs`、`src/entities/smart-fox.js`、`src/headless/smartfox-combat-lab.mjs`、`tools/qa-smartfox-dynamic-attackers.cjs`、`tools/test-smart-fox-beta.mjs`、`tools/test-smartfox-headless-lab.mjs`、本报告及 `changes-requested/` 证据。
- 剩余限制：未执行完整 22 项 browser/CDP 套件；未做硬件 GPU、手机或视觉验收；主控独立验收仍待后续。本 worker 自报不等于上线。
- 实现/证据 commit：`aa1426d891f29feffd2a1cd7f4b6c41db19a80af`（`fix(beta): restore real SmartFox parry contacts`）；报告 docs checkpoint 为本次追加。push=未执行，deploy=未执行。

## 2026-11-01 rev61 专项续接：审计 checkpoint

本轮 base=`b2c9b5962cb7f7b13065314f84951dee7646009b`。保留此前所有提交；动态围攻/parry 的主控独立验收与 rev61 上线是已确认成果，本轮不重做其功能。后台 `6ac0ebb`、lab `056ffa4/689ed36` 已存在实现和旧 worker 证据，但其专项独立验收不能由旧自报替代。

`/home/fame/codex-runs/m3d-20261030-beta-smartfox-team/BROWSER_HOLD` 存在（2026-11-01 本轮检查），因此没有启动 Chrome/CDP，没有连接共享 18800；不修改门禁文件。真实生产浏览器专项验收及 4/8 狐 hit smoke 等待主控解除门禁。

已保存 rev61 基线：`rev61-audit/before-matrix-180.json`，180/180 completed、每例 1 土拨鼠，固定 1/60、6 秒、多 seed；全量 Node `97/97 passed, 0 failed, 22 browser/CDP skipped`（`baseline-node-tests.txt`）。完整 62 项后台默认值/min/max/step/单位/runtime 与生产读取路径见 `admin-parameter-coverage.md/json`。新实例构造时快照生效，已有实例不半截改上限；runtime schemaVersion 仍为 1，显式 URL 覆盖 active，storage 为回退，普通 FOX 配置未展开写回。

代码审计发现需要明确的验收边界：旧 vitals browser 脚本曾直接写 HP/状态、teleport、注入攻击阶段验证收支；其证据只能称为实体接线诊断，不符合本轮正常战斗专项验收要求，不据此宣称本轮浏览器通过。生产主战斗实体已通过的动态攻击者验收不受此判断影响。

数据审计另发现 lab 的 no_progress 依据存活实体数不变，而不是运动/攻击进展，会在仍有战斗时误报；lab 输入直接展开 tune 且 dt/duration 未校验，可能让非法值绕过 runtime clamp 或造成无界运行。下一 checkpoint 只针对有复现依据的实验工具诊断/输入缺陷，不为产出而提高生产难度或更改已验收 AI 数值。

本 checkpoint 仅审计/证据/报告；push/deploy=未执行；浏览器专项仍未完成，Codex 自报不等于主控独立验收。
