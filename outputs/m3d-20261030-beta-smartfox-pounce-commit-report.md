# beta SmartFox pounce commit 修复报告

根因是 beta 非提交态虽然已经 `intent=pounce`，仍以 sprint 速度把导航目标设为玩家当前位置；狐狸穿过玩家后，距离门、朝向门和 windup 门不再在同一帧重合。审计复现为 906 帧中 858 帧未提交，距离门失败 707 帧、朝向门失败 757 帧、windup 重置 856 帧；reachable、体力、striker、谨慎期、recover、evade、coordinator 均未阻塞。代码位置为 `src/entities/smart-fox.js` 的非提交导航和 `src/entities/smart-fox-core.mjs` 的提交门。

修复在 beta 守卫下新增 `approach → align → reposition → commit` 纯状态机。狐狸先停靠在 4.2–6.2m 提交环，align 阶段降为零速并锁定朝向；进入内环后侧向重新定位。提交仍由原有距离、角度、可达、体力、角色、谨慎期和协调门共同决定，提交后 `pounceCommitted` 不可取消。melee 在 pounce 意图或 recover 锁期间不启动，因此不会打断下一次定位。`beta.smartPounceDashEndDistance` 已从 Beta 默认值和后台 schema 移除；冲刺末端使用 `SMART_POUNCE_TUNE.maxStrikeDistance` 的唯一语义。

Node 验证：`test-smart-fox-beta.mjs` 24/24；`test-smart-fox-melee.mjs` 8/8；`node tools/run-node-tests.cjs` 90/90 通过，22 个既有 browser/CDP 用例按项目入口跳过；所有改动 JS/MJS `node --check` 通过；`git diff --check` 通过。Beta 闭环四场景为 facing 1/1、back_turned 1/1、memory_one 1/1、multi_fox 1/1。stable 对照运行同一闭环为 facing 0/0、back_turned 1/1、memory_one 0/0、multi_fox 0/0；共享运动默认路径未改变，新增行为均由 `IS_BETA` 守卫控制。

真实 Chrome 证据写入 `outputs/m3d-20261030-beta-smartfox-pounce-commit/`：桌面 1280×720 使用 WebGL2（ANGLE Intel Mesa，console errors 0），真实 AI 循环观察到 1 次提交，提交距离 4.533m、角度误差 0；移动玩家与三狐场景本次采样分别为 0 次和各 0 次。手机仿真 390×844、DPR3、touch points 5、CPU 4x 无崩溃，页面 scrollWidth/scrollHeight 为 390/844，HUD 页面保持有效。截图和结构化记录见 `desktop-stationary.png`、`desktop-moving.png`、`desktop-multi.png`、`mobile-390x844-dpr3-cpu4x.png`、`browser-pounce-report.json`。

未完成项与风险：本次真实浏览器采样尚未达到用户要求的单狐静止/移动各 30 次提交和多狐错峰统计；Node 纯逻辑闭环已稳定通过，但真实场景在首轮提交后的长期再定位仍需继续调试。该限制已如实记录，不能把纯函数模拟计数冒充 Chrome 提交。

分支 `fix/beta-smartfox-pounce-commit-20260730`，base `28f0bcb0a6f0c195568c9cb0364044a0732a1c27`。本任务未 push、未部署。
