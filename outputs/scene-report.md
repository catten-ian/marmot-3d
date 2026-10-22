# Verdant Trail 真实场景交付报告

日期：2026-10-22
分支：`codex/verdant-hqfox-visual-20261021`

## 结果

真实 Blender Megascans 场景已替换 dev 的低多边形占位场景。场景保留 `ground` 高度采样，并沿用旧导出器的坐标映射：runtime X=source Y、runtime Z=source X，水平范围约 130×78。狐狸仍由已有 `USE_DEV_HQ_FOX` 路径加载；本回合没有修改狼、TOS 或 stable/beta。

最终产物：

- GLB：`assets/verdant/verdant-trail.glb`
- GLB 字节数：52,825,048（约 50.4 MiB）
- GLB SHA256：`5eb840cd02ed023eef9e8ec558285f8011f4f9cb81b99b0ff615b67cd8b12a8b`
- height JSON：197,996 bytes
- 导出源对象：55
- 源三角面：2,783,719
- 导出三角面：347,786
- PBR 贴图：124 张，嵌入 GLB；导出器统计纹理字节 41,978,027
- 贴图策略：diffuse/rough 使用 JPEG；normal 使用 PNG；alpha 使用 PNG；displacement 不导出；近景颜色贴图上限 1K，远景 512，法线统一 512 级；运行时开启 mipmap、线性过滤和最高 8 级各向异性。

52.8 MB 已低于 GitHub 100 MB 限制，并比中断时 146.6 MB 减少 64%。仍高于理想的 30–40 MB，原因是 124 张法线/透明纹理必须保持无损且嵌入式 GLB 会叠加解码开销。

## 发虚根因与修复

1. 没有发现 Three.js DOF、Bokeh 或 motion blur 后处理；HUD 的 CSS blur 只作用于界面。
2. `round3b` 使用了旧标签和低生命状态，图像被游戏状态污染，不能作为场景清晰度证据。MiniMax 检查确认其中心和边缘存在强烈状态模糊，且生命值为 4/100。
3. 真实体积根因是贴图采样和资产体积：原导出器把很多 1K/2K/4K 法线以 PNG 直接嵌入，单张法线可达 5–6 MB。新导出器把远景和法线分级降采样，并在 loader 里显式设置 mipmap、颜色空间和 anisotropy。
4. Verdant 专用雾曾在 `loadLevel()` 中被关卡默认值覆盖；现在 dev Verdant 始终使用 near=42、far=175，stable/beta 保持原逻辑。
5. 第一轮曾隐藏 dome，造成黑背景；现在恢复 dome，并使用阴天 Verdant 光照：冷色 hemi、柔和方向光、ACEsFilmic/sRGB 输出。

## 视觉迭代

- Round 1：`outputs/verdant-qa/01-path-ground.png` 等 5 张。真实地面、岩石、枯木已显示，但地面偏平、远景偏糊，dome 隐藏时背景偏黑。
- Round 2：`outputs/verdant-qa/round2/01-path-ground.png` 至 `05-overview.png`。恢复天空穹顶和真实材质后，岩石法线、粗糙度与枯木网格可见；MiniMax 指出地面/远景纹理密度不足、局部接地和地块切边明显。
- Round 3：`outputs/verdant-qa/round3-01...05.png`。调整阴天光照与机位，确认远景纵深和狐狸/玩家同框路径。
- Round 3b：`outputs/verdant-qa/round3b-01...05.png`。判定为无效 QA：复用旧标签后玩家处于濒死/受伤状态，画面出现强烈状态模糊；不用于最终清晰度结论。
- Round 4 sharp：新端口 8341、全新托管标签、玩家生命重置到 100，并尝试 `outputs/verdant-qa/round4-final*`。CDP Runtime 可用，但重场景解码期间 Chrome compositor 长时间不返回 `Page.captureScreenshot`；通过 `canvas.toDataURL()` 读取到空 backbuffer，未将这组黑图当作视觉证据。没有启动 headless Chrome。

## 运行与测试

- `node --check src/main.js`：通过
- `node --check src/world/verdant.js`：通过
- `node --check tools/qa-verdant-managed.cjs`：通过
- `node tools/run-node-tests.cjs`：27/29 OK；2 个失败为既有问题：`test-beta-contract.cjs` 的既有 public-shell stylesheet URL 检查，以及 `test-verdant-pack.cjs` 查找不存在的 `release/verdant-dev-pack`。本回合没有新增纯 Node 回归。
- 浏览器截图链：OpenClaw CDP `http://127.0.0.1:18800` 可连接并执行 Runtime；大 GLB 解码时 `Page.captureScreenshot` 被 Chrome compositor 阻塞，因此报告保留此前可用截图并明确标注无效 round3b。
- 导出三角面 347,786，dev 运行时目标是 30 FPS 以上；本轮未能在 compositor 阻塞期间取得稳定 FPS 样本。GLB 首次加载在托管浏览器中明显受纹理解码影响，建议后续做外置纹理/分包。

## 后续建议

- 优先把 GLB 拆为几何 GLB + 外置纹理，或采用 KTX2/BasisU；这会减少首屏主线程解码峰值。
- 对背景巨崖做独立低 LOD，对近景 ground/hero 岩石保留 1K 法线；必要时再启用 Draco，并在 Three.js 中接本地 DRACOLoader。
- 继续增加远景植被密度和地面边缘 LOD，修复素材包中少量悬空树根/地块切边；这属于几何与构图问题，不是本轮截图模糊根因。
