# m3d-20261025 beta 玩法调优交付报告

- 通道：**beta**
- 分支：`codex/beta-gameplay-tune-20261025`
- 基线 SHA：`1462c32d9f3d62e6897a88244b93d2eba8979bd7`（origin/beta rev26）
- 工作树：`/home/fame/code/marmot3d/m3d-beta-gameplay-tune-20261025`
- 日期：2026-10-25（Asia/Shanghai）

> 本报告随四个阶段持续更新；每阶段一个本地 commit。push/PR/部署：**未执行（禁止）**。

## 用户目标 → 14 条验收需求对照

（完成情况在每阶段后填写：完成 / 部分 / 未做 + 证据）

### A 组 狐狸与战斗平衡
- A1 rest_safe 真正回血：见阶段 1。
- A2 普通狐更耐打（打死/打跑都 >2 下）：见阶段 1。
- A3 沙盒 godMode 默认不再硬开 + 多狐攻击真掉血：见阶段 1。
- A4 普通狐打不死、按 d088054^ 旧口径逃跑+增援；首领一去不返：见阶段 1。

### B 组 沙盒操作录制
- B 沙盒录制离散操作（beta only）：阶段 2 填写。

### C 组 采食 / 打断 / 洞内
- C1~C7：阶段 3 填写。

### D 组 移速 / 可调范围
- D1 土拨鼠普通移速略降；D2 移动键可调范围放宽：阶段 4 填写。

---

## 阶段 1：A 组 狐狸与战斗平衡

### 实际完成
1. **A1 rest_safe 真正回血**
   - `src/core/fox-motion.js` `stepRestSafe()` 改为推进计时的同时按
     `FOX.retreat.regenPerSec`（0.16/s，占 maxHp）回血，封顶 `restHealTarget`（1.0=满血），
     到目标或计时到返回 `done`。
   - `src/entities/fox.js` `case 'rest_safe'` 应用 `r.hp`；并把每帧 `stepStamina` 在
     rest_safe 期间的 `hpRegenRatio` 置 0（休息态仍回体力），避免两处重复回血；
     普通喘息 `rest` 仍走 `vitals.restHpRegenRatio`（3.5%/s）。
   - 数值进配置 `FOX.retreat.{regenPerSec,restHealTarget}`。普通狐一个休息周期（6s）
     可从撤退线回到满血；不再"白等"。
2. **A2 普通狐明显更耐打**
   - `FOX.types.normal.hp` 3→6（沙盒 level0）；`heavy` 6→9（保持对普通狐的明显厚度）；
     `boss` 18 不动（不削弱压迫感）。
   - 自主撤退血线 `FOX.retreat.hpRatio` 0.45→0.32：最强常规招（迎击 stand 1.8）
     两下后 hp=2.4、比例 0.40 > 0.32，既打不死也不打跑；至少 4 下迎击才会驱退。
3. **A3 多狐攻击真掉血 / godMode 假象**
   - `enterSandbox()` 不再硬写 godMode=true（sandboxState 与 testState 均改 false，
     freezeTimer 仍开）；面板"无敌"复选框初始态与实际一致（均为关）。
   - 新增常驻可见的"🛡 无敌模式"顶部徽标（`src/sandbox/panel.js`，挂 body，面板收起也可见），
     退出沙盒隐藏。
   - 接触撕咬改为**每狐独立节流** `FOX.bite.contactCooldown=0.9s`（一次扑击一口），
     玩家被咬后的全局无敌由 1.3s 缩短到 `FOX.bite.playerInvuln=0.12s`（只防同一帧叠伤），
     多只狐接连扑击可各自造成伤害。翻滚/迎击无敌帧不变。
   - 说明（保留语义）：撤退/休息中的狐 `alive=false` 仍不造成伤害——它已脱离战斗，
     符合"撤退即威胁解除"；只有 dash 扑击造成接触伤害（既有设计，保留）。未引入玩家自然回血。
4. **A4 恢复旧口径（d088054 之前）**
   - 新增纯函数 `defeatFate(type)`、`stepDefeatCooldown(type,respawn,dt)`（fox-motion.js）：
     所有类型 hp 归零都先"夹尾逃跑"离场；非 boss 离场后按增援计时在出生点附近 `respawnAt`，
     **boss 永不倒数、一去不返**。
   - `fox.js` 恢复 hp≤0 更新块的增援倒数（`this.spawnPoint` 构造时记录）；`hit()` 在
     撤退/rest_safe 中保 1 点血（已解除威胁不可二次打跑/重复计数）。
   - `main.js hitFox` 恢复驱退流程：`startFleeing` + 驱退计数 + 回能 + "威胁已解除/首领逃走了"。
   - 帮助文案（main.js 标题面板）同步为"普通藏狐打不死…只有狐首领被打退后一去不返"。

### 改动文件（阶段1）
- `src/core/config.js`、`src/core/fox-motion.js`、`src/entities/fox.js`、`src/main.js`、
  `src/sandbox/panel.js`、`tools/test-fox-repel.cjs`（改写为断言新口径）。

### 验证
- `node --check` 对全部改动 .js 通过。
- `node tools/run-node-tests.cjs`：**OK 54/54**（22 个浏览器/CDP 测试 SKIP）。
- `node tools/test-fox-repel.cjs`：17/17，含 rest_safe 回血、defeatFate/增援倒计时、
  普通狐 >2 下耐久、撤退循环回血。
