# m3d-20261029-beta-tuning-defects 修复报告

## 1. 目标与边界

修复 beta 后台参数审计发现的三个缺陷：`fox.useProcedural` 未进入 schema、admin/lil-gui 暴露无运行时消费者的 `foxContact.*`、智能狐已提交扑击的体力收支不自洽；同时增加通用幽灵旋钮探测器和逐缺陷回归测试。

验收要求包括：新测试先红后绿；全量 Node 回归不低于基线；beta 四个闭环场景均保持 `commits=1 hits=1`；stable 逐场景输出与自采基线完全一致；不改玩法距离、伤害或版本戳，不生成 `index-public.html`，不触碰其他工作树，不 push、不部署。

- 工作树：`/home/fame/code/marmot3d/m3d-beta-tuning-defects-20261029`
- 分支：`fix/beta-tuning-defects-20261029`
- base SHA：`d817cea031a4728d4706f7297b70b9a804753fb3`
- 修复 commit：`3976e8fd1394aa05edd1edbbb7ecbca30a989e71`
- push/deploy：**未 push、未部署**

## 2. 缺陷根因、改法与取舍

### 缺陷 1：`fox.useProcedural` 没有进入后台条目

- 根因：原 `src/admin/tuning-schema.mjs:255` 只调用会返回对象的 `bool(...)`，遗漏 `e.push(...)`，返回值被直接丢弃。
- 改法：现 `src/admin/tuning-schema.mjs:255` 改为 `e.push(bool(...))`。
- 回归：`tools/test-beta-tuning-defects.mjs` 断言条目存在，且 `kind === 'boolean'`、`def === FOX.useProcedural`、group 为「狐狸 · 基础」、source 为 `FOX.useProcedural`。

### 缺陷 2：`foxContact.*` 是无效旋钮

- 根因：原 `src/admin/tuning-schema.mjs:272-274` 和 `src/systems/sandbox-debug.js:210` 暴露 `FOX.contact`，但实际命中在原 `src/main.js:2001` 使用 `PLAYER.radius + FOX.collisionRadius[...]`。调整 `FOX.contact` 不影响游戏。
- 改法：采用题目首选方案，删除 admin 的四条 schema 条目和 lil-gui 的四个控制器；没有修改 `src/main.js` 的命中公式。
- 保留兼容：`src/core/config.js:343-346` 保留 `FOX.contact` 并明确标注遗留数据，避免无关旧配置/审计读取破裂。运行时与测试以 `collisionRadius` 为准。
- 预览兼容：admin 预览仍读取旧的 `foxContact.*` 展示键，因此 `src/admin/tuning-schema.mjs:453-477` 仅生成不参与 schema、导出或 dirty 状态的派生预览值，公式与真实命中一致；reset/import 也同步派生值。它们不是后台条目，不会重新产生旋钮。
- 既有断言迁移：`tools/test-attacks.cjs` 与 `tools/test-fox-retask.mjs` 改用双方半径之和，保留原冲刺覆盖接触距离的不等式，没有删除、跳过或放宽断言。
- 实际行为等价：五种类型的新旧接触距离逐项完全相等。

| 类型 | 旧 `FOX.contact` | 新公式结果 | 相等 |
|---|---:|---:|---|
| pup | 1.45 | 1.45 | 是 |
| normal/default/fast | 1.70 | 1.70 | 是 |
| heavy | 1.95 | 1.95 | 是 |
| boss | 2.20 | 2.20 | 是 |

选择移除 UI 而非接入 `FOX.contact`，是因为当前唯一真实消费者已经使用双方碰撞半径；再引入第二套距离来源会造成重复真源并改变玩法。此次只修 UI 契约。

### 附加：通用幽灵旋钮探测器

- `tools/test-beta-tuning-defects.mjs` 扫描 `buildTuningEntries()` 的全部 **595** 个条目，在排除 admin 与 lil-gui 自身的运行时源文件中检查消费者。
- 类型表的末级 `boss/pup/...` 只被视为键，探测器必须找到对应 `FOX.<表>` 消费者，避免被同名无关引用误判为有效。
- 常量定义文件本身不计为消费者；文档化默认参数有专门识别；无法静态确认的 **18 条**逐项列入 `TUNING_CONSUMER_ALLOWLIST`，每条都有具体理由。
- allowlist 不含 `foxContact.*` 或 `fox.useProcedural`，并断言不允许以后加入。
- 基线重放时，探测器精确报告 `foxContact.boss/heavy/pup/default` 四项，无其他新增 unresolved 项。

### 缺陷 3：已提交扑击的中途体力缺口

- 根因：原 `src/entities/smart-fox.js:125` 在 dash→windup→strike 全程按 `pounceStaminaPerSec` 扣费，而原 `:316` 提交门只预留 dash 的持续费用；另在原 `:334` 有一次性 26 点扣费。
- 改法：采用方案 **(b)**。`src/entities/smart-fox-core.mjs:45-59` 增加可测的预留与逐帧扣费 helper；beta 只在真正 dash 阶段按扑击费率扣费，dash 尾帧按实际时段占比扣费，windup/strike 使用 stalk 费率。一次性 26 点成本不变。
- 提交门不变：现 `src/entities/smart-fox.js:325` 仍预留 `26 + 26 × 0.42 = 36.92`，没有提高门槛，因此不会因本修复降低提交率。
- stable 隔离：现 `src/entities/smart-fox.js:126-134` 传入 `IS_BETA`；stable 分支仍返回旧的 committed 扣费率，stable 行为没有被“顺便修复”或改变。
- 不选 (a)/(c)：提高预留或重平衡一次性成本都会改变提交条件/数值手感；(b) 直接消除非冲刺阶段的重复冲刺扣费，既能补齐缺口，又能保持原提交门。

默认体力收支对照：

| 版本 | 提交门预留 | 持续扣费时段 | 完整动作真实消耗 | 缺口 |
|---|---:|---:|---:|---:|
| 修复前 beta | `26 + 26×0.42 = 36.92` | `0.42+0.10+0.22 = 0.74s` | `26 + 26×0.74 = 45.24` | **8.32** |
| 修复后 beta | `26 + 26×0.42 = 36.92` | 仅 dash `0.42s` | `26 + 26×0.42 = 36.92` | **0** |

回归测试从恰好 36.92 体力开始，按 60Hz 走真实的 `stepSmartMotion`/`stepStamina` 原语，断言依次经过 dash→windup→strike→recover、全程不触发体力锁，并验证总实耗等于预留。stable helper 的旧扣费方式也有独立断言。

## 3. 改动文件

- `src/admin/tuning-schema.mjs`
- `src/core/config.js`
- `src/entities/smart-fox-core.mjs`
- `src/entities/smart-fox.js`
- `src/systems/sandbox-debug.js`
- `tools/test-beta-tuning-defects.mjs`（新增）
- `tools/test-attacks.cjs`
- `tools/test-fox-retask.mjs`
- `outputs/m3d-20261029-beta-tuning-defects-*`（本报告与 JSON/日志证据）

`tools/test-attacks.cjs` 还做了两项测试环境兼容修复：支持 `CHROME_CDP`/Linux Chrome，以及把已不存在的测试字段 `FOX.knockbackScale`、`g.FOX` 改为当前配置来源。运行时击退仍读取 `FOX.types[type].knockbackMul`，原 normal > heavy > boss 断言保持不变。该文件维持原 CRLF 行尾。

未改动：`src/core/version.js`、`index-public.html`、`tools/public-shell.cjs`、`src/main.js` 以及其他工作树/通道。

## 4. 先红后绿证据

最终测试版本在临时恢复四个缺陷相关基线源文件后运行，随后逐字节恢复修复源文件：

```text
node --test tools/test-beta-tuning-defects.mjs
修复前：tests 5, pass 0, fail 5
修复后：tests 5, pass 5, fail 0
```

修复前失败分别覆盖：缺失的程序化狐狸条目、四个 admin 幽灵条目、通用探测器、体力预留/扣费契约、恰好过门的完整动作闭环。证据：

- `outputs/m3d-20261029-beta-tuning-defects-red.log`
- `outputs/m3d-20261029-beta-tuning-defects-green.log`

## 5. 验收命令与精确结果

| 命令 | 结果 | 证据 |
|---|---|---|
| 改动前 `node tools/run-node-tests.cjs` | **OK 87/87**，22 个 browser/CDP 跳过 | `...-baseline-tests.log` |
| 8 个改动 JS/MJS/CJS 分别 `node --check` | **8/8 通过** | `...-syntax.log` |
| 改动后 `node tools/run-node-tests.cjs` | **OK 88/88**，0 失败，22 个 browser/CDP 跳过；比基线多 1 个新测试文件 | `...-final-tests.log` |
| `node tools/test-smart-fox-beta.mjs` | **22/22 通过** | `...-smart-fox-beta.log` |
| `node --test tools/test-smart-fox-closed-loop.mjs` | **1/1 通过** | `...-closed-loop-test.log` |
| `SMARTFOX_ASSERT=1 node tools/sim-smart-fox-closed-loop.mjs` | 四场景全部 `commits=1 hits=1`；与 beta 基线 JSON `cmp` 完全相同 | `...-beta-{before,after}.json` |
| `SMARTFOX_BETA=0 node tools/sim-smart-fox-closed-loop.mjs` | 与 stable 基线 JSON `cmp` 完全相同 | `...-stable-{before,after}.json` |
| `node tools/test-fox-retask.mjs` | **3/3 通过** | `...-fox-retask.log` |
| `CHROME_CDP=http://127.0.0.1:18800 node tools/test-attacks.cjs` | 进程退出 **0**；模型朝向/预警线断言通过；五项接触距离与旧值完全相等；控制台错误 0 | `...-attacks.log` |
| `node --test tools/test-beta-tuning-defects.mjs` | **5/5 通过** | `...-green.log` |

说明：本机新 headless Chrome 的调试端口无法启动，因此 `test-attacks.cjs` 使用已有托管 Chrome 的 CDP endpoint，并只创建/关闭自己的 target。静态服务在测试后已停止。全量 runner 的 22 个 browser/CDP 跳过与基线相同，不能将其计为 browser 全量通过。

## 6. 闭环仿真前后对照

### beta（必须全为 1/1）

| 场景 | 修复前 commits/hits | 修复后 commits/hits | 变化 |
|---|---:|---:|---|
| facing | 1/1 | 1/1 | 无 |
| back_turned | 1/1 | 1/1 | 无 |
| memory_one | 1/1 | 1/1 | 无 |
| multi_fox | 1/1 | 1/1 | 无 |

### stable（必须逐场景全等）

| 场景 | 修复前 commits/hits | 修复后 commits/hits | 变化 |
|---|---:|---:|---|
| facing | 0/0 | 0/0 | 无 |
| back_turned | 1/1 | 1/1 | 无 |
| memory_one | 0/0 | 0/0 | 无 |
| multi_fox | 0/0 | 0/0 | 无 |

两个档的完整 JSON（包括 submissions 的时间、距离、角度、suspicion/memory/fatigue）均通过 `cmp` 逐字节比较，不只是 commits/hits 摘要相同。

## 7. 未完成项、已知问题与影响

- 本任务三个缺陷及通用探测器均已完成，无未完成验收项。
- stable 的旧体力扣费行为按约束原样保留；本修复只作用于 beta。
- allowlist 中 18 个既有静态审计盲区已逐条显式记录，但未在本任务中扩大范围修复其他潜在旧参数问题。
- `test-attacks.cjs` 的历史报告仍打印「不同模式数 1」和「boss 单段冲刺余量 -0.3m」；该脚本原就未以这两项设置失败退出。它们不属于本次三个缺陷，未修改玩法或放宽阈值来消除提示。与缺陷 2 相关的 reach 数值保持原值，模型朝向断言和脚本退出码正常。

## 8. Codex 自评

自评：**9/10**。三个根因均以最小范围修复，新增测试完成真实基线先红和修复后复绿；体力方案没有提高提交门，beta/stable 闭环有完整前后 JSON 等价证据。额外修正了探测器自身对类型键的同名误判，并验证其在基线上精确抓住四个 `foxContact.*`。扣分项是环境限制使全量 browser/CDP 测试仍按基线跳过，仅单独执行了题目指定的 `test-attacks.cjs`，不能宣称浏览器全量覆盖。

最终状态：**本地已提交修复；未 push、未部署。**
