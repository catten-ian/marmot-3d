# Beta rev54 合并发布记录

- 时间：2026-10-30
- 通道：beta only；stable/dev 未修改
- 集成基线：`2d72774`（已含 SmartFox 团队配合与分状态体力恢复）
- SmartFox R2 合并：`5650d42`
- PAF 合并：`85204dd`
- 发布戳：`rev54`

## 内容

1. SmartFox 自然接近、距离与朝向同时满足后提交扑击；修复 approachSpeed 未进入 locomotion 的问题。
2. PAF 第一/第三人称统一相机相对输入；扑击捕获半径 1.25；键盘/摇杆方向选向；默认 120° 总弧且 lil-gui 可调；移动时按下经过短前摇自动扑出，无需持续按住。

## 主控独立验证

- 合并无冲突；只修改 beta 集成树。
- 所有改动 JS/MJS `node --check` 通过。
- PAF 专项：41/41。
- 全量 Node：90/90；22 个 browser/CDP 测试跳过，不计为通过。
- `node tools/test-beta-contract.cjs` 通过。
- `node tools/public-shell.cjs --check` 通过；`index-public.html` 含 6 处 rev54、0 处 rev53。
- `git diff --check` 通过。

## 合并后真实浏览器生产 update 验收

脚本：`node tools/qa-smartfox-fastforward.cjs`；渲染后端 WebGL2 SwiftShader。固定步长仅替代 RAF tick，仍运行真实 AI、碰撞、伤害、体力与团队角色代码；没有瞬移狐狸/玩家或强制 pounceCommitted。

### 单狐

证据：`fastforward-single.json` / `summary-single.json`。

- 游戏时间推进 20 秒。
- 自然 commit：1；strike：1。
- commit 时间 8.467s，距离 6.165m，角色 striker。
- strike 时间 9.000s，距离 4.123m。
- 真实 hit events：9；玩家 HP 100 → 0。

### 多狐（保留限制，不伪称完整扑击验收）

证据：`fastforward-multi.json` / `summary-multi.json`。

- 游戏时间推进 30 秒；玩家 HP 1000 → 748；21 个真实 hit events。
- 团队角色状态存在；本轮近距离角色轮换较快，独立 pounce commit/strike 计数为 0。
- 因此多狐真实伤害已证实，多狐独立扑击提交仍未完成专项验收。

## 已知限制

- 未获得物理手机/硬件 GPU 的长时间实时性能数据；SwiftShader 证据不得冒充真机 FPS。
- PAF 浏览器证据来自 Codex 交付并已由主控审查报告与遥测；合并后全量契约回归通过。
- 多狐独立 pounce commit 未记录到，但单狐自然 commit/strike/HP 损失已满足本次发布的关键真实行为门槛。

## 发布状态

- 版本戳已生成；待提交、推送、部署和线上复验后补记。
