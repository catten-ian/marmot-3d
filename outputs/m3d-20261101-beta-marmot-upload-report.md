# m3d-20261101-beta-marmot-upload — 交付报告

## 范围与行为
- 通道：仅 Beta；基线 `b6e40144f608c0864301de49d255d0990925ada5`；分支 `fix/beta-marmot-upload-20261101`。
- Beta 玩家与同伴采用新上传 `marmot-run-stand.glb`，两者各自实例化真实 `AnimationMixer`，每帧更新 clip 并在状态切换间淡入淡出。Stable/Dev 继续从各自 `marmot.glb` 路径读取，狐狸/SmartFox、shell/version stamp 未更改。
- 映射：站立/一般闲置/无对应专用 clip 的 rest、groom、jump、interact → `StandIdle`；玩家真实位移超过 0.05 m/s → `Run`（含 sprint）；Beta 正在啃环境草 → `Run`（即使玩家本帧不移动）；同伴按本帧实际跟随距离/速度 → `Run`，抵达队形间距、dt=0 或停止即 `StandIdle`；现存警觉/惊叹状态 → 单次 `StandUp`，完成后保持尾帧。没有创建假的 Jump/Bite/Groom/Rest clips。
- 同伴 follow 移动步长不越过目标间距；Beta 每帧先将跟随速度清零，消除到达后保留上一帧速度导致的滑步/假跑。
- 模型失败沿用当前程序化玩家/同伴回退。新模型缺少任一要求 clip/非空轨道时拒绝接入并走原回退，不会静默以旧尖叫模型为成功默认。

## 资产检查
- 新生产文件：`assets/models/marmot-run-stand.glb`，字节原样复制，无修改输入源。2445856 bytes，SHA-256 `95bfb02b245af132cf4f3a73200bcd0c89f59fb09019e92b904de20a9b61e787`。
- 结构：1 个 skinned mesh，1 skin / 12 joints，14 nodes，28,988 vertices / 26,254 triangles，3 张 bufferView 内嵌 JPEG，0 相机、0 灯；顶点 joint weights 归一。`Run` 36 channels/0.5s，`StandIdle` 36 channels/2s，`StandUp` 36 channels/1s；三个 clip 都有多时刻且变化的骨骼通道。程序化测试逐条验证通道映射、目标 joints、帧时间和值。
- 哈希/指标证据：`outputs/m3d-20261101-beta-marmot-upload/validation/asset.json`。
- 上传 zip 的 SHA-256 已核对；未解压或执行 zip 中任何文件。

## 实施文件
- `assets/models/marmot-run-stand.glb`
- `src/entities/beta-marmot-model.js`：Beta clip/mixer/淡变、蒙皮姿态下包围盒接地、材质与实例清理。
- `src/entities/marmot-rig.js`：仅含上传动画名、状态映射与同伴限距步进策略。
- `src/entities/props_entities.js`：同伴模型/动画连接、真实移动速度和立即停止映射。
- `src/main.js`：Beta 玩家真实模型接入；根据控制器经碰撞后的位移测速；使用 actual grazing 状态映射 Run；Beta 预加载新文件；QA 暴露只读 rig 观测引用。
- `tools/test-marmot-rig.test.cjs`、`tools/qa-marmot-upload.cjs`。

## 验证
- 修改的 JS 逐个 `node --check`：`src/main.js`、`src/entities/props_entities.js`、`src/entities/marmot-rig.js`、`src/entities/beta-marmot-model.js`、`tools/test-marmot-rig.test.cjs`、`tools/qa-marmot-upload.cjs` 全部通过。
- 聚焦：`node tools/test-marmot-rig.test.cjs` — 6 passed / 0 failed / 0 skipped。
- 全量：`node tools/run-node-tests.cjs` — 94 passed / 0 failed / 22 skipped（原入口判定为 CDP/浏览器测试）；完整日志 `outputs/m3d-20261101-beta-marmot-upload/node-tests.log`。
- `git diff --check` 通过。
- 生产游戏浏览器脚本：`node tools/qa-marmot-upload.cjs`，自管 Chrome/CDP 临时端口，明确未用共享 18800；`?version=beta`，生产 `index.html` 与正常 game update。24 场景（8 场景 × 3 viewport）全通过，未捕获 JS exception；截图 33 张（idle/Run/sprint/grass/run/follow/stop/alert 各尺寸，另含移动帧样本）及 `manifest.json`、轨迹/骨骼/速度/动画时钟/包围盒证据在 `outputs/m3d-20261101-beta-marmot-upload/visual/`；24 场景完整输出在 `visual/run.log`。
- 三尺寸：1280×720、768×1024、390×844；场景玩家 Idle、Run、Sprint、Graze；同伴 Idle、Follow、Stop、Alert。运行时确认一个 skin / 12 joints / 贴图已解码；动画器时钟、骨骼姿态、蒙皮采样顶点在前后帧均变化。Run 玩家约 5.088 m/s、sprint 7.225 m/s，follow 9.6 m/s；草地啃食 clip=Run；跟随停止轨迹验证速度变 0 的首帧及之后始终 StandIdle；移动时骨骼前向与世界位移同向。活动 skin bounds 的最低点与 actor ground 误差小于 1e-6 m。图像已抽查直立/四足姿态；焦点真实场景显示地表、纹理和角色。
- 渲染后端实测 WebGL2，ANGLE Vulkan SwiftShader 软件实现。不是硬件 GPU，也不是物理手机；390×844 使用 Chrome viewport 仿真。首轮软件渲染天空 shader 引起 context lost 的探测未作为验收截图；最终独立运行加入 contextLost=false 断言后 24 场景全通过。

## 文件范围与风险说明
- 未更改 stable/dev 默认资产、狐狸/SmartFox、公共 shell、版本戳；无网络提交、部署、服务配置改动。
- 软件渲染的可视验收不替代真实移动硬件 GPU 测试；浏览器自动化是本地生产 `index.html` 入口由静态 server 提供，不代表线上服务器发布检查。
- QA 自管 Chrome 只做尺寸 viewport 仿真，没有声称物理手机通过。

## Git
- 实现与证据提交：`05ce51a`（`feat(beta): use uploaded marmot run and idle clips`）；报告随后的独立本地提交。
- push/deploy：否。由主控进行独立复核；本报告不构成主控验收。
