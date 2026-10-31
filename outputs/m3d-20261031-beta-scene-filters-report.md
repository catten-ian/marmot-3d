# m3d-20261031-beta-scene-filters

- 用户目标：Beta 设置中提供无滤镜及多种真实场景滤镜，支持强度、即时预览、持久化、失败回退，并覆盖普通模式与 PAF。
- channel：beta
- base SHA：`e1d6c0774cb7af387fd9e7c2c6559f8c5b388d8e`（rev58）
- 当前 renderer/backend：真实 Beta 浏览器路径；`THREE.WebGLRenderer`、WebGL2。视觉 QA 使用 SwiftShader 软件 GPU，仅用于管线/回归证据，不能作为真机 GPU 性能验收。
- commit：`b67b1b4772abac1942159f41f823e8798d2301bb`
- push/deploy：未执行

## 设置与预设行为

设置面板新增“场景滤镜”区块：

- 无滤镜：默认值，0% 强度，直接走原始 `renderer.render(scene,camera)` bypass。
- 自然增强：自然饱和度、轻微 S 曲线对比度、阴影抬升和柔和高光肩部。
- 清透晨光：空气感提亮、青蓝天空平衡、保留草地暗部。
- 暖阳电影：金色高光与轻微青绿阴影，带克制电影感。
- 冷雾远山：蓝青远景层次与温和草地对比。
- 青翠层次：植被层次、土石暖色、压低高光，适合白天探索。

黑白/旧 `mono` 预设已经完全移除：不再出现在设置、预设表、shader uniform、配置导出或视觉截图中。旧存储中的该值被视为未知值，安全回退为无滤镜。

强度为 0–100%，滑块事件立即更新运行时画面和保存值；0% 会规范化为 `{preset:"none",intensity:0}`。设置面板显示值、运行时快照和 localStorage 始终来自同一份规范化状态。恢复无滤镜按钮、触控滑块和桌面选择器均已覆盖。

## 架构与色彩空间

新增 `src/core/scene-filter-renderer.mjs`，只在滤镜启用时懒创建一个 HalfFloat render target、一个全屏材质和一个全屏 pass。主场景先在未 tone-map 的线性 HDR target 中渲染，shader 在 scene-linear 空间执行：

- 可控自然饱和度、对比度和亮度；
- 阴影 lift；
- 高光柔化 shoulder；
- 轻微 filmic 压缩；
- 预设色彩矩阵式 tint。

随后恢复原有 ACESFilmicToneMapping，shader 只做一次 tone mapping 和 sRGB 输出转换，避免双重 sRGB/曝光。第一人称 viewmodel 在主场景之后独立叠加，HUD、准星、暂停面板、设置面板没有经过滤镜。普通模式和 PAF 都调用相同的 `sceneFilterRenderer.render(scene,camera)`。

无滤镜路径明确 bypass，持续零后处理 pass、零 render target。启用时 target 随 DPR/resize 更新；强度归零、恢复默认、shader 初始化失败、context lost 都释放资源并回到原始渲染。测试中 12 次启用/归零循环的 target 创建数与释放数相等。

## 持久化与回退

- key：`marmot.settings.sceneFilter.v1`。
- 缺失、非法对象、未知预设、NaN、非有限值、越界强度都走 fail-closed；强度 clamp 到 0–100，0% 规范化为无滤镜。
- localStorage 读取/写入失败不会阻断启动或游戏。
- 配置导入/导出 schema 增加 `sceneFilter`，非法旧黑白值会告警并回退无滤镜。
- 页面重载、关闭/重新打开设置、退出/重进游戏均由真实浏览器脚本验证了状态一致性。

## 改动文件

- `src/core/scene-filter-settings.mjs`
- `src/core/scene-filter-renderer.mjs`
- `src/core/config-transfer.mjs`
- `src/ui/settings.js`
- `src/main.js`
- `tools/test-scene-filters.mjs`
- `tools/test-config-transfer.cjs`
- `tools/qa-scene-filters-managed.cjs`
- `outputs/m3d-20261031-beta-scene-filters/visual/`（manifest、31 张截图、contact sheet）

未修改 PAF 操作逻辑、SmartFox、黑匣子、rig/动画、`index-public.html`、public shell、版本戳、Caddy/systemd 或其他 worktree。

## 真实视觉证据

manifest：[`visual/manifest.json`](./m3d-20261031-beta-scene-filters/visual/manifest.json)

contact sheet：[`visual/contact-sheet.png`](./m3d-20261031-beta-scene-filters/visual/contact-sheet.png)

截图矩阵包含：

- 普通场景同 origin/camera/seed：390×844、768×1024、1280×720、1920×1080；每个尺寸均有无滤镜、自然增强、清透晨光、暖阳电影、冷雾远山、青翠层次，强度 75%。
- 普通 TPS：1280×720，自然增强。
- PAF TPS/FPV：1280×720，无滤镜和暖阳电影。
- 设置截图：1280×720，已滚动到“场景滤镜”区块，选择器、63% 滑块、说明和恢复按钮均可见。
- 强制 shader 初始化失败截图：恢复原始场景路径，设置规范化为无滤镜。

已实际打开检查 contact sheet 和代表截图。预设差异来自完整 grading（对比、自然饱和度、阴影层次、高光 shoulder、filmic 与适量 tint），不是单纯冷暖染色。HUD/准星/菜单文字保持清晰和原色，截图中没有黑屏、全页 CSS 变色或明显 resize target 错位。

截图中的“土拨鼠仅几何（贴图不可用）”来自本地 Beta 测试加载链/资产回退，画面中的滤镜对天空、草地、岩石和远景仍真实生效；这不是滤镜制造的缺陷。仓库已有本地 `assets/models/*.glb`，本任务未修改模型加载或玩法来掩盖该环境问题。

## 性能与资源对照

同一 1280×720、同一固定相机和场景，在 SwiftShader WebGL2 QA 环境中采样 15 个 RAF 间隔；该环境只有约 2 FPS，不能代表真机性能，但可比较相对开销：

| preset | mean frame ms | p95 ms | FPS | draw calls | triangles | textures | geometries |
|---|---:|---:|---:|---:|---:|---:|---:|
| none / 0% | 755.53 | 816.6 | 1.32 | 7 | 992 | 14 | 194 |
| natural / 75% | 468.87 | 500.0 | 2.13 | 7 | 992 | 15 | 195 |
| clear / 75% | 492.21 | 533.3 | 2.03 | 7 | 992 | 15 | 195 |
| warm / 75% | 466.65 | 483.4 | 2.14 | 7 | 992 | 15 | 195 |
| cool / 75% | 469.98 | 500.0 | 2.13 | 7 | 992 | 15 | 195 |
| verdant / 75% | 464.43 | 500.0 | 2.15 | 7 | 992 | 15 | 195 |

这些绝对 FPS 受共享 SwiftShader/机器负载影响，不能作为硬件性能结论。draw calls/triangles 没有因滤镜改变；启用滤镜仅增加一次全屏 pass 和一个 target，资源在 bypass 后释放。manifest 记录了 target 生命周期、resize 次数、失败次数和资源计数。

## 精确验证结果

- `node --check src/core/scene-filter-settings.mjs`：通过
- `node --check src/core/scene-filter-renderer.mjs`：通过
- `node --check src/core/config-transfer.mjs`：通过
- `node --check src/ui/settings.js`：通过
- `node --check src/main.js`：通过
- `node --check tools/test-scene-filters.mjs`：通过
- `node --check tools/test-config-transfer.cjs`：通过
- `node --check tools/qa-scene-filters-managed.cjs`：通过
- `node tools/test-scene-filters.mjs`：6/6 通过
- `node tools/test-config-transfer.cjs`：4/4 通过
- `node tools/run-node-tests.cjs`：95/95 通过；22 browser/CDP skip；失败 0
- 真实 Beta QA：视觉矩阵 24 张普通场景截图 + 2 张普通 TPS/PAF 外代表截图 + 设置/失败回退证据，manifest 共 31 个 shot 条目；resize/DPR、即时切换、重载持久化、触控滑块、生命周期和 shader fail-soft 均执行。
- local PAF MP3：通过静态服务器实际 HTTP 200 检查；浏览器同时观察到 PAF 音频响应 200。

## 未完成项/已知问题

1. Beta 音频代码仍会先探测远端 `https://marmot.tos-cn-shanghai.volces.com/audio/elevenlabs/sfx/manifest.json`；当前远端返回 404，随后本地 `assets/audio/elevenlabs/sfx/manifest.json` 返回 200 并继续工作。真实浏览器 QA 的 console 记录因此为 3 条远端 manifest 404，未被伪造为 0；没有使用此前的 204 音频 mock，也没有屏蔽这些请求。local PAF MP3 本身为 200。
2. 视觉与性能证据来自 WebGL2 SwiftShader，不是真机 GPU；WebGPU 不是 Beta 本次实际 backend，因此没有宣称 WebGPU 验收。
3. 本地测试场景的模型加载显示“仅几何（贴图不可用）”提示；这是既有资产加载/测试路径问题，滤镜未修改模型或降低场景内容。
4. 主控仍需独立验收；本报告不宣称主控验收通过、上线或部署。
