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

## 第二阶段（重启）

日期：2026-10-22。此阶段仅作用于 `?version=dev` 的 Verdant 路径。

### 源贴图普查与 native ultra

源目录 `/home/fame/marmot3d-assets/verdant_trail/textures` 共 142 个文件、2,780,108,427 bytes；普查得到 4096² 贴图 47 张、8192² 贴图 1 张（`rock_07_nor_gl.png`）、2048² 贴图 32 张、1024² 贴图 37 张，其余 25 张为 EXR/HDR 或 PIL 无法直接识别的源格式。Ultra 输出位于 `/home/fame/code/marmot3d/marmot-3d/m3d-verdant-hqfox-visual-20261021/assets/verdant/tiers/ultra`，共 148 个文件（147 个清单 payload + `pack-manifest.json`），目录字节数 2,601,965,527，payload 清单总字节数 2,601,935,175；外置 glTF、`.bin` 和贴图，不内嵌 2.6 GB 到单个 GLB。`verdant-trail-ultra.gltf` 112,702 bytes，外置 `.bin` 126,547,360 bytes。

`python3 tools/verdant/verify_native_pack.py --source /home/fame/marmot3d-assets/verdant_trail/textures --pack assets/verdant/tiers/ultra` 通过：142/142 张源贴图逐图输出尺寸一致、源/输出 SHA-256 与 `texture-cache.json` 一致、64 个 glTF 外置 URI 均存在。抽查结果：`rock_07_nor_gl.png` 为 8192×8192、201,662,162 bytes、SHA-256 `1501b54cdbe1aa18de63ebe2bd95cb3b4507b4aa6df5a1d45c07bcbc07258c6c`；`dirt_floor_diff_4k.png` 为 4096×4096、95,240,165 bytes；`dirt_floor_nor_gl_4k.png` 为 4096×4096、92,617,234 bytes；`dirt_floor_rough_4k.png` 为 4096×4096、38,587,104 bytes。25 个 EXR/HDR 转码保持宽高，但生产转换器输出 RGB 8-bit PNG；这是浏览器兼容的位深转换，报告不宣称对这些源的位深无损。转换明细在 `assets/verdant/tiers/ultra/native-texture-verification.json`。

>100 MB 未纳入 Git：

- `/home/fame/code/marmot3d/marmot-3d/m3d-verdant-hqfox-visual-20261021/assets/verdant/tiers/ultra/textures/rock_07_nor_gl.png` — SHA-256 `1501b54cdbe1aa18de63ebe2bd95cb3b4507b4aa6df5a1d45c07bcbc07258c6c`
- `/home/fame/code/marmot3d/marmot-3d/m3d-verdant-hqfox-visual-20261021/assets/verdant/tiers/ultra/verdant-trail-ultra.bin` — SHA-256 `822a9cf8017afd095209a76a0e83feffeee03c137311c8eb027c690272f4a920`

其余超过 100 MB 的检查以 `find assets/verdant/tiers -size +100M` 为准；当前只有上述两项。

### 四档产物与选择器

四档独立清单与 `pack-manifest.json` 已重建，所有清单条目的 size/SHA-256/contentType 与文件复核一致：low 95,593,640 bytes / 127 payload files / 347,786 三角面；medium 177,007,708 / 127 / 372,831；high 187,549,838 / 127 / 413,432；ultra 2,601,935,175 payload bytes / 147 payload files（含清单目录共 148）/ 4,298,106 三角面。四档共用 `/assets/verdant/verdant-trail-height.json`，双线性 `heightAt`、runtime X=source Y、runtime Z=source X、bounds 与 xform 逐档契约测试一致。

DEV 设置面板支持自动/低/中/高/极致。自动档按 `deviceMemory`、CPU 核数和 WebGPU 推荐；手动档通过 token 持久化，切档载入新包后释放旧 geometry/material/texture，保存玩家 x/z/yaw/pitch 并重新贴合 height。手动高/极致不会被自动降档；异步切档带请求序号，旧请求结果会释放并丢弃。极致文案明确 4,298,106 三角面、源宽高、约 2.60 GB、16 GB+ 内存、独显与 WebGPU 建议。

### GPU/后端诊断

`window.__game.rendererStatus()` 暴露 backend、GPU name/vendor、`hardwareAccelerationKnown` 与硬件加速判断。WebGL 使用 `WEBGL_debug_renderer_info`；WebGPU 使用 adapterInfo，命中 SwiftShader/llvmpipe/softpipe/Microsoft Basic Render Driver 时显示软件渲染红字；WebGL2 兜底显式注明 GS 深度排序退 CPU。本次托管 Chrome 实测为 WebGL2、`ANGLE (Intel, Mesa Intel(R) Iris(R) Xe Graphics (ADL GT2), OpenGL 4.6)`、厂商 `Google Inc. (Intel)`，硬件加速已启用。

### 有效视觉证据与 FPS

托管 Chrome CDP `http://127.0.0.1:18800`、静态端口 8342、未启动 headless。最终 QA 输出：

- `/home/fame/code/marmot3d/marmot-3d/m3d-verdant-hqfox-visual-20261021/outputs/verdant-qa/stage2-high-final3/01-path-ground.png`
- `/home/fame/code/marmot3d/marmot-3d/m3d-verdant-hqfox-visual-20261021/outputs/verdant-qa/stage2-high-final3/02-mid-foliage.png`
- `/home/fame/code/marmot3d/marmot-3d/m3d-verdant-hqfox-visual-20261021/outputs/verdant-qa/stage2-high-final3/03-cliffs-depth.png`
- `/home/fame/code/marmot3d/marmot-3d/m3d-verdant-hqfox-visual-20261021/outputs/verdant-qa/stage2-high-final3/04-third-person.png`
- `/home/fame/code/marmot3d/marmot-3d/m3d-verdant-hqfox-visual-20261021/outputs/verdant-qa/stage2-high-final3/05-overview.png`

五张均通过程序判废（每张 1280×720、>20 KB、mean/std 均超过阈值），MiniMax 人工复核确认 01/02/03/05 纹理与纵深可辨，04 已为真正第三人称且玩家模型可见、无黑帧；04 的捕食者在此固定机位被岩石遮挡，故保留为第三人称/场景证据并在报告中明确这一视觉限制。high 托管 Chrome 稳态采样为 24 FPS（采样窗口 `report.json`），WebGL2 Intel 硬件加速。

### 外置纹理与后续建议

Ultra 使用外置 glTF URI，避免单 GLB 2.6 GB；当前纹理仍为 PNG/JPEG，未新增 KTX2/BasisU 或 Draco。建议后续在 TOS 端按同一 pack-manifest 生成 ZIP 和可逐文件读取的目录对象，浏览器端已预留本地包 → 可配置 TOS → 同源资源三级回退、ZIP 下载和 File System Access 文件夹下载接口。

## 第三阶段（狼 + TOS）

DEV 已接入 `/assets/models/wolf.glb`（44 骨、`idle`/`run`/`attack` 三个完整骨骼 clip，SHA-256 `b43e8bf5ce3f9de23c09149d3a7a0efaf3f9c2475fe2d9be681c674b05f6a563`）。`SkeletonUtils.clone` 为每只狼隔离骨骼，`AnimationMixer` 在 idle/run/attack 间按 AI 状态切换，冲刺接触窗口触发 attack；dispose 会停止 mixer。stable/beta 不读取该开关。

资源回退与下载代码已完成客户端协议，但没有伪造 TOS 地址：未设置 `window.__VERDANT_TOS__` 或设置面板中的对象前缀时，不会向外网发起请求。配置后按本地包 → TOS 对象前缀 → 同源服务器回退；ZIP 按 `pack.zip`/`zipUrls[tier]` 下载；文件夹下载用 File System Access API 按 manifest 逐文件下载、SHA-256 校验、断点复用已有正确文件后写入 `pack-manifest.json`。TOS stage 自洽目录已生成在 `/home/fame/code/marmot3d/marmot-3d/m3d-verdant-hqfox-visual-20261021/release/tos-stage/m3d-dev/20261022/{low,medium,high,ultra}`；目录内包含公共模型、对应档位、height、wolf 和根级 pack-manifest，>100 MB 文件采用硬链接留在工作树，未加入 Git。实际 TOS 上传/key/ZIP 端点仍待提供。
