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

## 2026-11-01 rev61 专项续接：后台/出生正常输入验收与远撤修复

本轮继续同一 JOB/branch/task；base=`b2c9b5962cb7f7b13065314f84951dee7646009b`，审计 checkpoint=`deacc51`。保留 rev61 与此前独立验收结论。没有 reset/clean/stash、push、PR 或 deploy。本节是 worker 实测报告，不等于主控独立验收或上线。

### 后台参数、持久化及出生语义

62 项完整参数/default/min/max/step/单位/runtime 标记及直接消费文件/行号见 `rev61-audit/admin-parameter-coverage.md/json`。覆盖生命/体力上限，潜行/非扑击冲刺/扑击每秒与一次性消耗、近战/受击消耗，rest/recover/intercept/roam 恢复，普通休息与安全休息回血，锁定、低血速度/伤害、连击及撤退阈值/衰减、速度/到达半径/休息时长/目标/远撤距离，以及扑击/近战冷却、时序、团队参数。

读取路径：admin `beta.*` → `runtimePayloadFromAdminConfig` → `sanitizeRuntimeValues` → active/explicit/storage → 本页 `BETA_TUNE` → 新 SmartFox 的 `smartTuning/smartVitals/smartRetreat` 独立快照 → SmartFox 收支/动作核心、Fox 受击/撤退/血条。主循环接触距离仍读本页 BETA_TUNE。语义是**重新打开游戏后生成的新实例**全部生效；不提供既有实例上限热更新承诺，也不把预览当即时应用。schemaVersion 仍为 1；局部旧配置保留缺项默认，显式 URL 优先覆盖 active，合法 storage 作回退。非有限/非法类型拒绝，负数/越界按 key clamp，上限≥1、比例 0..1、消耗/时间非负；合法 0 保留。没有展开写回 FOX 全局，普通狐仍使用 FOX 默认配置。

本轮实际打开 `admin.html`，在“智能狐 · 生命/体力/恢复/撤退”组搜索、编辑，确认滑块/数值输入及“运行时生效”。通过 **127.0.0.1:8338 的内存测试 API** 使用现有保存/激活 UI，保存 `vitals_qa` 并激活；随后无显式 URL 的新游戏真实读取 local active，生成上限 8/160。另以显式 betaConfig URL 覆盖进行受击/远撤/低目标/死亡场景。没有访问或写线上 active，也不新增账号或密钥。截图、实际 active JSON、断言及命令位于 `rev61-audit/runtime-browser/`。

默认出生：4/4 HP、100/100 体力；自定义出生：8/8、160/160。均验证 staminaLocked=0、hitStreak=0、非撤退/休息/死亡、血条/体力条 fill=1，多实例快照独立；首帧和远离目标静置 300 tick 后无异常 recover/rest_safe/retreat。新实例明确从 maxHp 填满，只有显式 initialHp 作为测试/回放伤血语义并 clamp。近处真实 AI 正常发动攻击后 recover 仍允许。满状态不撤退另覆盖阈值=1 的合法边界；低血阈值=0 不产生 0/0 NaN。默认上限仍为 4/100，**本轮没有改任何平衡默认数值**。

### 数据驱动生产修复：受伤远撤不能在近处假安全回血

新 QA 使用正常键盘移动离开洞穴；新建生产 SmartFox 仅指定初始 QA 场景摆位，之后不改坐标/HP/状态。通过真实 Space 输入命中，记录 HP 8→6.75、体力160→149（配置受击消耗11）、hitStreak=1。该场景暴露真实生产缺陷，证据保留：

- `runtime-browser-failed-far-retreat/state-assertions.json`：实际距离 **13.418m** 时，撤退进度判定 stalled，随后进入 rest_safe 并回血，违反70m配置。
- `runtime-browser-failed-turn-reset/state-assertions.json`：禁止近处回血后，又显示撤退转弯半径异常大，20秒仍未到目标，HP保持6.75；未将其标成通过。
- 根因一：原进度逻辑只看距休息点的历史最短距离；正常转身/绕障期间短暂增加距离就累计“卡住”，然后直接在当前位置安全休息。新增共享 `stepSmartRetreatNavigation`，按实际位移判断停滞；失败/超时重选路，必须真实玩家距离达到配置值才可休息；休息时若玩家靠近也重返撤退。
- 根因二：`_moveGround` 已积分 yaw 和 turnVelocity，Fox 帧末又对同一位移朝向调用转向，将角速度归零，造成只剩每帧很小的加速量。仅 Beta SmartFox retreat 分支保留已积分结果。普通狐/其他通道原分支保持。
- 同样发现合法低回血目标可能把当前 HP 直接裁到目标值。Beta SmartFox 使用内部 preserveCurrentHp 守卫：目标仅限制新增回复，不扣当前血；HP≤0不恢复。普通配置路径保持。

同一正常输入场景修复后：tick675 真实到达 **109.028m**、resolution=arrival 才进入 rest_safe；tick676 首次回血6.75→6.7766667，符合0.2×8/60；最终8HP/160体力，玩家始终100HP。低目标0.1场景真实到达远处后保持6.75HP，没有削血。1HP测试上限下真实推击致死，后续600tick HP始终0、最终state=dead，没有复活或回血。对比 JSON：`production-retreat-comparison.json`。没有瞬移、无敌、强制 commit/strike、写 HP、冻结 AI 或放宽接触/迎击条件。

其他真实行为：UI生成实体的扑击进入 strike 扣13体力，合法 recover 后恢复6/s；后台值不只是存在于 payload。runtime browser **18/18断言通过、console error=0**。

### 无渲染 lab 审计与修正；不冒称完整生产对战复制

共享路径已核对：lab 与 live SmartFox 导入相同的感知/效用/角色分工/pack/扑击运动/近战核心、stepStamina、shouldRetreat；Fox 撤退与 lab 新共享 `stepSmartRetreatNavigation`、`stepFoxLocomotion`、`steerGroundDirection`；安全回血共用 stepRestSafe。依赖契约测试同时检查 SmartFox/Fox/lab 的这些接线。普通 Node 执行，不创建 renderer/DOM、不加载模型贴图，固定dt与注入PRNG，无 wall-clock 决策。

发现并修正的 **lab 适配问题（不是生产 AI 优化）**：

1. makeMarmot 多了一个未传入参数，movement 实际落在 target，五种标签全都在追击。现已正确传入策略并记录每0.25秒真实轨迹；zigzag 连续带seed变向。parry 开场先真实接近，真实迎击并跟进推击后才进入所选移动策略；chase-pounce 开场也先真实接近，成功一次扑击后改连续推击，再进入所选策略。未删除任何组合。
2. 旧 no_progress 用存活数量不变代替运动进展，180例全误报。现按真实位移/状态/HP/体力/攻击变化识别；新矩阵0例误报。
3. 适配层遗漏远撤最小距离、阈值外又硬卡HP<0.7，并在安全休息两处回血。现对接真实距离配置/硬阈值/同一导航与唯一安全回血入口，补连击衰减，保持死亡不回血。
4. dt/duration/count/seed/命令/策略校验，actor-tick预算；override走与后台同一 sanitize；每tick检查有限数/资源上下界/死亡状态。非法输入机器JSON failed、exit2；场景失败exit1。记录实际执行tick、有效配置、HEAD/dirty来源；trace有界。始终恰好1只土拨鼠，参数marmots不会扩增实例。

**仍有明确的 lab 共享边界/未完成项**：lab 是生产纯函数的数值适配器，尚未直接执行整个 SmartFox.update/Fox.update/main.js 世界循环。main.js 中扑击 swept contact/玩家无敌帧、完整玩家按住蓄力→能量消耗→硬直/击退结算尚未全部抽出；当前 lab 的 pounceHits 仍未完整接线、玩家HP/伤害/能量模型也非完整生产结算。团队核心虽共用，世界障碍与 live 感知/记忆/增援事件接线不完全等价。**因此不能把本次180 completed称为“完整生产无头对战验收通过”，不能用这些伤害指标调真实难度。** 本轮不为伪造对等性扩大 main.js/PAF 改动；该剩余工作需要后续专项共享适配重构与独立验收。已接受的生产4/8狐围攻/parry结论不受此工具边界影响。

### 固定180矩阵与量化对照

命令见 `rev61-audit/commands.txt`。矩阵为1/2/4/8狐 × 五移动 × 三场景 × seed20261031/20261132/20261233，dt=1/60，horizon6秒。`before-matrix-180.json` 与 `after-matrix-180.json` 原始每狐事件/状态完整保留；汇总 `matrix-comparison.json`。after **180/180 completed、0 failed、每例1土拨鼠、0不变量失败、60/60 parry场景**均具备真实输入窗→strike接触→resolveParryOutcome成功→后续推击；未接受失败为预期或放宽距离。没有失败case被删去，failedTrace为空。

before 64,800tick/wall1.088768s；after60,817实际tick（终局死亡会提前结束）/wall1.401537s，累计模拟时间约723.22倍实时。before的五标签其实同追击，**不能将两批伤害差异解读为生产优化增益**。以下为lab适配回归数据，非线上平衡指标：

| 狐数（各45例） | commit前→后 | strike前→后 | melee hit前→后 | 玩家伤害前→后 | 撤退前→后 | 死亡前→后 | after最多不同攻击者 |
|---:|---:|---:|---:|---:|---:|---:|---:|
|1|45→43|45→42|45→39|45→39|45→34|0→25|1|
|2|60→70|60→63|75→71|75→71|60→51|0→18|2|
|4|105→132|105→131|165→129|165→129|60→56|0→0|4|
|8|225→290|225→277|360→302|360→263|105→69|0→0|8|

另有16秒真实受击远撤60/70m、低/零回血目标、不复活的自动回归；输入无界/非有限失败与五策略实际轨迹均测试。工具诊断修正和上面的生产远撤修复严格区分。

### 有效4/8狐生产浏览器回归、验证及范围

本轮初始BROWSER_HOLD存在，仅做Node；主控外部移除后开始本地QA。发现另一个私有浏览器出现时结束/暂缓本任务浏览器工作，待其退出再执行；脚本新增hold及其他私有Chrome启动门禁。没有连接共享18800，没有改门禁文件。最终专项与4/8浏览器顺序执行。

`rev61-audit/dynamic-browser/`：两例均生产实体、玩家100/100HP、mode=play、godMode=false开局；6秒后均40HP且存活。4狐：4个不同committer/真实攻击者，4个hitter、5次真实hit。8狐：6个不同committer/真实攻击者，3个hitter、5次真实hit；slot2/5没有攻击、slot4/7尚未strike，如实记录，不强凑全员命中。每狐commit/strike/hit、最终HP/体力、生产player-hit关联及截图保留；两例各5/5断言通过，console error=0。

renderer=`WebGLRenderer`/WebGL2/ANGLE Vulkan **SwiftShader软件渲染**。截图已打开检查。本证据不代表硬件GPU、物理手机、触控、视觉质量验收，也没有补跑整套22项browser/CDP suite。

验证日志均在rev61-audit：

- 10个变更/新增JS/MJS/CJS `node --check`通过（node-check.txt）；git diff --check通过。
- 聚焦：admin6/6、runtime4/4、fox-vitals11/11、tactics17/17、smart-fox-beta28/28、foxtune7/7、repel20/20、SmartFox vitals13/13、lab16/16，均0fail/0skip。
- 完整Node harness：**97/97文件通过、0失败，22 browser/CDP文件skipped另列**，没有把skipped计入通过（after-node-tests.txt）。
- 改动：beta-tuning/fox-motion、Beta守卫下Fox撤退、headless lab、CLI、vitals/lab测试、QA脚本、审计证据/本报告。未改main.js、PAF、普通狐默认、Stable/Dev、rig/动画、滤镜/黑匣子、版本/public shell、其他工作树、线上服务/配置。`.codex-cli-write.lock`保留不stage。
- 实现与证据commit在提交后追加；push=未执行、deploy=未执行。剩余：完整生产lab共享接线、主控专项独立验收、硬件/手机/完整browser suite。不得据本报告宣称全部原任务已完成或已上线。

本轮提交记录：审计checkpoint `deacc51`；实现/测试/原始证据 `ff16fe8`（`fix(beta): preserve SmartFox health and far retreat navigation`）。提交后在干净代码HEAD再次运行180矩阵，cases与已保存after原始数据逐项完全一致，180/180 completed、每例1土拨鼠；commit/dirty=[]/case数据SHA256见 `rev61-audit/committed-replay-summary.json`。最终docs提交只追加这条提交链与重放摘要；工作区仅保留未跟踪且未stage的`.codex-cli-write.lock`。push/deploy=未执行；完整生产lab对等性仍待后续，不宣称全任务已完成。
