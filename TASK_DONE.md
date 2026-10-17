# TASK DONE — feat/attack-parry：攻击键内圈可调 + 迎击改左滑手势

分支：`feat/attack-parry`（基于 `release/beta-rev2` @ 7e504e2）

## 改动文件清单

| 文件 | 改动 |
| --- | --- |
| `index.html` | 攻击键加 `class="touch-btn attack"`，内嵌 `<span class="attack-core">`（内圈核心）；aria-label 更新为“点按短刺 / 按住中刺·重刺 / 按住左滑迎击”。未触碰 `.stick-dodge`。 |
| `styles.css` | 新增 `.attack-core`：绝对居中的圆形核心，尺寸=`scale(var(--attack-core-scale,.55))`、透明度=`var(--attack-core-opacity,.92)`；`<b>/<small>` 提层到核心之上。按下缩放/升级动画仍绑在外圈 button 上，未改动。 |
| `src/core/combat-wheel.mjs` | 顶部集中常量 `TAP_MAX_MS=120` / `SHORT_HOLD_MAX_MS=280` / `MID_HOLD_MAX_MS=650` / `PARRY_DRAG_THRESHOLD=22`，并写入短刺/中刺/重刺/左滑迎击协调规则注释；新增 `AttackGesture` 单指手势状态机（左滑跨阈当帧返回 `{pointerId,tStart,tNow}`，`parried` 闩锁只 fire 一次）、`selectHoldMove(holdMs)`、`resolveAttackRelease({holdMs,parried})`；`selectChargedMove` 改为新三档（秒入参，sprinting 参数保留但不再影响分档，兼容旧 cfg 键）；`rollDirection` 等旧导出保留。 |
| `src/core/touch-controls.js` | Pointer Events / Touch Events 双路径的 attack 跟踪统一到 `AttackGesture`（`_startAttackPointer` / `_trackAttackMove`）；左滑跨阈当帧回调构造参数 `onParryGesture(ctx)`；松手 `onAction` data 增加 `parried` / `holdMs`。阈值不在本文件硬编码。dodge 路径原样保留。 |
| `src/main.js` | `attackCharge` 增加 `parried` 闩锁；新增 `triggerParryGesture(ctx)`（只认当前蓄力手指；沙盒弹一次“迎击成功”提示，正式/沙盒均走 `strike('stand',{fromParryGesture:true})` 的无敌帧+反击逻辑）；`releaseAttack` 在迎击后松手不再出招；`strike` 迎击窗口仅在来自左滑手势时开启，重刺不再要求奔跑姿态；蓄力提示环文案改“短刺/中刺/重刺”，阈值读 `charge.shortHold/heavyHold`。 |
| `src/core/config.js` | `PLAYER.combatWheel.charge` 改 `{ shortHold: 0.28, heavyHold: 0.65 }`。 |
| `src/ui/touch-layout.js` | `defaultLayout().buttons.attack` 新增 `coreSize:.55` / `coreOpacity:.92`；`_normalize` 夹紧（40-100% / 30-100%）并兼容平铺别名 `attackCoreSize`/`attackCoreOpacity`；`apply()` 对攻击键写 `--attack-core-scale` / `--attack-core-opacity`；编辑面板选中 attack 时出现“内圈大小 (40-100%)”“内圈透明度 (30-100%)”两滑块，拖动即时生效并 save；`save()` 同时写平铺别名。外圈通用大小/透明度逻辑未动。 |
| `tools/test-attack-parry.js` | 新增纯逻辑回归（见下）。 |
| `tools/test-combat-wheel.cjs` | 旧用例引用的四向轮盘 API（`selectAttackMove` 等）在 d3b9390 已删除、基线即失败；重写为当前 API（新分档 + `resolveAttackRelease` + `rollDirection`）。 |
| `tools/run-node-tests.cjs` | 新增：跑全部纯 Node 的 `tools/test-*.{cjs,js}`，浏览器/CDP 用例标记 SKIP（本环境禁止 Chrome），输出 `OK N/N`。 |

## 手势协调规则（已写入 combat-wheel.mjs 顶部注释）

- tap (<120ms) → 短刺(tap)；tap 窗口内 dx≤-22 → 立即迎击，松手不再出招
- hold 120-280ms 早松 → 短刺(tap)；280-650ms 中松 → 中刺(stand)；>650ms 晚松 → 重刺(lunge)
- hold 期间任意时刻 dx≤-22 → 立即迎击(stand)，parried 闩锁一次按住只触发一次，松手不再出招

## 测试结果

- `node --check`：全部改动 JS/MJS 通过。
- `node tools/test-attack-parry.js`：覆盖 ①tap<120 短刺 ②hold500 无拖动中刺 ③hold500+dx-30 迎击且松手不出招 ④tap80+dx-30 迎击 ⑤反复跨阈只 fire 一次 ⑥dx=-21 不触发/dx=-22 触发，另含 280/650 边界，全过。
- 另用 fake-DOM harness 验证 `TouchControls` Pointer 路径：-30 只回调一次 `onParryGesture`、松手 data 带 `parried/holdMs`、-21/-22 边界、无拖动 `parried=false`。
- `node tools/run-node-tests.cjs` → **OK 9/9**（attack-parry.js、combat-wheel、combat-realism、cooldown-overlay、feedback、move-facing、multi-burrow、procedural-fox、underground-burrow）。22 个浏览器/CDP 用例（test-action-layout、test-attacks 等）SKIP：本环境禁止下载/启动 Chrome，按任务书由外层浏览器截图流水线验证。

## 已知遗留 / 决策说明

1. 持久化实际 key 是既有的 `marmot.touch-layout.v1`（任务书所述 `marmot.touchLayout` 应为旧名记忆偏差）；内圈参数主存于 `buttons.attack.coreSize/coreOpacity`，并额外平铺 `attackCoreSize/attackCoreOpacity` 别名，读取两边都兼容。
2. 沙盒模式除弹“迎击成功”外仍执行 `strike('stand')`：沙盒“迎击练习”依赖同一无敌帧窗口，toast-only 会让练习无法迎击。
3. 中刺（蓄力 280-650ms 松手的 stand）保留了原 stand 的伤害/位移锁定，但不再附带迎击无敌帧窗口（窗口只由左滑手势开启）。
4. 浏览器/CDP 用例未在本机运行（无 Chrome 且任务书禁止启动 CDP）；触屏真机手感（22px 阈值是否跟手）建议外层截图/真机过一遍。
5. 未触碰：`move-facing.mjs`、`index.html` 的 `.stick-dodge`、touch-layout 的 sandbox 按钮部分；未 push、未 clone、未执行任何 reset/restore/checkout。
