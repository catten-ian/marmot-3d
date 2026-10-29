# m3d-20261029-beta-scream-marmot

## 目标与边界

用户明确取消 fixed/fixed2 rig 修复线，要求 beta 改接素材包中的尖叫土拨鼠。仅修改 beta 的玩家第三人称模型、伙伴模型及对应预载/状态提示；stable/dev 保持原路径。未 push、未部署、未修改版本戳或 public shell。

## 实际改动

- 新增原样素材 `assets/models/marmot-screaming.glb`（526,980 bytes；与 dev 素材 MD5 `b59b9e686b14cafd62beecf21963dbab` 一致）。
- beta 玩家第三人称加载尖叫土拨鼠，归一化高度 0.9；真实模型可用后才隐藏程序化兜底。
- beta 伙伴直接加载尖叫土拨鼠，归一化高度 0.75；不再优先加载 `marmot-rig.glb`，不创建旧 rig mixer。
- beta 预载文件同步改为尖叫素材；stable/dev 仍为 `marmot.glb`。
- 玩家、伙伴和预载统一使用加载状态键 `marmot`，避免模型可见但 HUD 错报“未加载”。
- 保留静态模型/程序化模型回退及既有材质双面渲染、金属度/粗糙度修正。

改动文件：`src/main.js`、`src/entities/props_entities.js`、`tools/test-marmot-rig.test.cjs`、新增 GLB 与本报告/验收证据。

## 验证

- `node --check src/main.js src/entities/props_entities.js tools/test-marmot-rig.test.cjs`：通过。
- `node --test tools/test-marmot-rig.test.cjs`：4/4 通过。契约已随用户新需求更新为“beta 使用尖叫素材且不再引用 rig”，不是删除或跳过旧断言。
- `node tools/run-node-tests.cjs`：**87/87 通过**；22 个浏览器/CDP 用例按入口规则跳过。
- `git diff --check`：通过。
- 真实 Chrome/CDP，1280×720，URL 强制 `webgl=1`，实际走 WebGL 渲染路径（不作为 WebGPU 验收）：
  - 进入真实沙盒，`mode=play`；
  - CDP 发送真实 W 键输入，位置从 `(-48, 2)` 到 `(-31.2749, 1.3031)`，水平位移 **16.7396m**；
  - 第三人称玩家真实模型可见，程序化模型隐藏；尖叫模型高度 0.9，脚底随控制器地面位置移动；
  - 伙伴真实模型存在且可见，高度 0.75，无旧 rig mixer；
  - 加载状态：`marmot=geometry-only`（15,856 面）、`fox=full`，不再停留 `pending`；
  - 控制台未捕获异常/error：**0**。
- 证据：`outputs/m3d-20261029-beta-scream-marmot/result.json`、`sandbox-third-person.png`。
- 主控视觉复核：模型在第三人称画面中可见，比例合理、贴地，无旧 rig 的网格撕裂。该素材在当前加载链中为 geometry-only（无可用贴图，使用材质/顶点色），不伪称 full textured。

## 过程中的失败与修正

首轮真实浏览器发现玩家分支漏导入 `USE_REAL_MODELS`，导致初始化中断；已修复并复跑。随后发现加载状态键不一致导致 HUD 错报“未加载”，已统一为 `marmot` 并以 `getModelStatus()` 验证。最终上述验收全部通过。

## 未完成/后续

- 本次只负责模型替换，不宣称解决智能狐、后台配置或全面审计中的其它问题。
- 未做实体手机真机视觉验收；本次为桌面 Chrome 实测。
- 待主控集成到 beta release worktree、生成下一版 shell 并部署后再做线上复验。
