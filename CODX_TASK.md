> 🚨🚨 09:07 二次纠正：当前 ultra 被 prepare_textures 降到 1024/2048（仅295MB）是错的；ultra 必须源分辨率零降采样（48张≥4K含1张8K，源2.6GB，整包~2GB，外置分块，不进git）。见 USER-GUIDANCE 顶部。

> 🚨 用户 08:18 最高优先级：Ultra 档资源包目标约 2GB（完全不减面、4K/8K 源贴图、外置分块走 TOS），详见 USER-GUIDANCE-20261022.md 顶部；覆盖此前 80–150MB 说法。

> ⚠️ 用户 08:08 增补：设置里支持多档画质手动选择（含不减面 Ultra），并显示 GPU/后端/硬件加速是否成功；详见 USER-GUIDANCE-20261022.md

> ⚠️ 用户 08:07 最新指示：GLB 不用压特别小，画质优先，总体积可放宽到 80–120MB，近景贴图保留 2K+；详见 USER-GUIDANCE-20261022.md

# 任务：把 A Verdant Trail 的真实 Megascans 写实场景接进 dev（替换低多边形占位场景），并做渲染→看图→改进的多轮视觉迭代

全程中文。这是核心任务：用户给的 1 个多 GB 素材包本该呈现精美写实的森林小径，但当前 dev 场景是低多边形塑料感。你要新建「真实资产 Web 优化导出管线」，让 dev 场景用上真实网格和 PBR 贴图，再用程序化渲染截图自己看图、反复打磨到美观可跑。

## 工作区（只在此工作树干活）
- 工作树（当前目录）：/home/fame/code/marmot3d/marmot-3d/m3d-verdant-hqfox-visual-20261021
- 分支：codex/verdant-hqfox-visual-20261021（基线 a92d96a，verdant dev tip）
- 已完成、**不要重做**：dev 捕食者已改用带贴图的高质量 fox.glb（提交 575fade，USE_DEV_HQ_FOX）。你只需保证它在新场景里依然正常显示。
- 可读源素材目录（在仓库外，允许只读）：/home/fame/marmot3d-assets/verdant_trail/
  - verdant_trail.blend（233MB，Blender 4.4 工程，已用 /home/fame/tools/blender/blender -b 验证可打开）
  - textures/ 共 2.7GB：103 张 PNG + 24 EXR + 14 JPG + 1 HDR，是 diff/nor_gl/rough/disp/alpha 的 4K/8K PBR 贴图 + 8K 阴天 HDRI（kloofendal_48d_partly_cloudy_puresky_8k.exr）
- 禁止 push/部署/改 stable/beta/其它工作树/系统服务/nginx/crontab。所有产物在本工作树或 /tmp。

## 根因（已确诊，勿再排查）
旧导出器 tools/verdant/export_scene.py **故意**把真实场景删了：它打开 blend 后 remove 全部源网格，用 cone/cube/icosphere 按包围盒摆占位体，export_texcoords=False、材质纯色，manifest 里写 texturePolicy='no source images'。所以现在 assets/verdant/verdant-trail.glb 只有 572KB 占位基本体。源工程真实内容（已用 Blender 盘点，结果在 /tmp/blend-scene.json）：
- 163 网格 / 366 万顶点 / 587 万面 / 49 PBR 材质 / 144 贴图
- 集合：main_scene(ground+foliage+debris+cliffs_boulders)、background(5 个 156k 面巨崖+背景地+大树)、scene_components(grass/shrub/各类树/树根/草丛)、fog、camera_lights
- 可行走主地面：对象名 `ground`（7717 面，dim≈13.9×25.9，材质 ground=rocks_ground_01 的 diff/nor/rough/disp）；背景地 `bacground_ground`
- 材质→贴图绑定见 /tmp/blend-scene.json（每个材质列出了 image 节点），例如 forest_ground_04 用 *_diff_8k/nor_gl_8k/rough_8k/disp_8k，boulder/rock_face/dead_tree_trunk/shrub/island_tree/jacaranda 各自 diff+nor_gl(+rough+alpha)。

## 运行时契约（必须保持，否则碰撞/接地全错）
- src/world/verdant.js 用裸 three/addons GLTFLoader（当前**未接 Draco/Meshopt 解码器**）。读 manifest.json → height(verdant-trail-height.json) → scene glb。遍历 mesh：receiveShadow=true、castShadow=false，并 clone 材质把 roughness=.94/metalness=0（贴图保留）。
- 高度采样 heightAt(x,z) 用双线性，字段 format/gridSize/bounds{minX,maxX,minZ,maxZ}/heights。玩家、狐狸、岩石、洞穴、食物都依赖它，地形与高度图必须严格对齐。
- 坐标映射（沿用旧导出器 xform，务必逐字一致）：源 Blender(x,y,z) → 导出前 X=sx*(y-cy), Y=sz*(cx-x), Z=sy*(z-zmin)，其中 sx=130/(ymax-ymin)*0.88、sz=78/(xmax-xmin)*0.88、sy=min(sx,sz)；再由 glTF 导出器 Z-up→Y-up。即 runtimeX=sourceY、runtimeZ=sourceX、场地约 130×78。height.json 的 bounds/sourceBounds/mapping 字段照旧格式产出。
- 离线、本地 vendor、零新增 npm 构建依赖、禁止 CDN。若要上 Draco，必须用 three 自带 addons 的 DRACOLoader + 本地 draco decoder（three 已 vendor 在项目里，找到本地 decoder 路径），不得引外网。

## 工具链（已确认）
- Blender：/home/fame/tools/blender/blender（4.4.3，自带 Draco exporter addon libextern_draco.so）
- Python3 + Pillow 12.3（可缩放/转码贴图）；node v24；无 gltf-transform/glTF-pipeline（需要就用 Blender+Pillow+裸 GLB，或在 tools/ 放自包含 node 脚本，勿加网络依赖）
- 参考旧导出器（含 ground BVH ray_cast 采样高度、xform、manifest 结构）：tools/verdant/export_scene.py。在它旁边新建导出器，不要覆盖旧的。

## 你要建的新管线（建议 tools/verdant/export_real_scene.py + 一个贴图预处理脚本）
1) 真实网格：选 main_scene/foliage/debris/cliffs_boulders/background/scene_components 等可视集合里 hide_render=false 的网格（排除 camera_lights/fog/粒子辅助体/橡皮鸭等杂物）。按总面数预算（先目标 ~40–70 万三角面，可配）对每个对象 DECIMATE（坍缩），近景小径/hero 物体给高预算，background 巨崖给低预算 LOD；保留 `ground` 到足够分辨率供高度图。把所有对象用旧 xform 同一矩阵变换后导出，保证视觉与 heightAt 对齐。
2) PBR 贴图 Web 化：把实际用到的 diff/nor_gl/rough/alpha 贴图缩放（近景/地面 2K、其余 1K、背景/远景 512–1K），diff/rough 转 JPG(q≈82)，nor_gl/alpha 保留 PNG（法线/透明不能有损），丢弃 disp（顶点位移不做，靠真实几何+法线贴图）。EXR/8K 同理降采样。重映射材质 Image 节点到压缩后的文件，导出为**外置贴图的 .glb+.bin 或自包含 GLB**（先比体积/加载再定），确保 baseColorTexture/normalTexture/roughnessTexture/alphaTest 正确（草和叶子用 alpha 裁剪，注意双面/alphaMode MASK）。
3) 光照/氛围：源场景用 8K 阴天 HDRI 世界光。浏览器里用缩小（如 1K）的 HDRI 做 PMREM 环境光，或导出方向光+环境色；保证地面/岩石受光自然、不死黑、有柔和阴影方向。可在 src/world/verdant.js 增加（仅 dev）环境光/HDRI 加载与色调映射（ACESFilmic）、sRGB 输出、合理 fog（保留远处巨崖的纵深但别糊）。
4) 产出 assets/verdant/ 下新的 verdant-trail.glb / height / manifest（或新文件名并在 dev loader 中切换，stable 不受影响），在 manifest 记录来源 sha256、面数、贴图策略、体积。
5) 先做一个「几何 only（占位材质）」的快速导出自证：网格/坐标/高度对齐、浏览器能加载、面数/帧率可接受；再叠加压缩贴图。每步都真渲染确认，不要盲导出。

## 程序化渲染→看图→改进（核心，至少 3 轮）
- 用 OpenClaw 托管 Chrome CDP：HTTP http://127.0.0.1:18800 （/json/version 200）。新建标签 PUT http://127.0.0.1:18800/json/new?<enc(url)>（个别版本 GET），连 webSocketDebuggerUrl 发 Runtime/Page/Emulation(1280x720)/Page.captureScreenshot。**不要**自起 headless chrome（本机会崩/挂起），不用 SwiftShader，宿主有 Intel Iris Xe 真 GPU。
- 渲染脚本要**进程内嵌静态 http 服务器**（后台 serve 会被回收）。可直接照抄已跑通的自包含范例：/home/fame/code/marmot3d/marmot-3d/m3d-beta-smart-fox-20261021/tools/qa-smart-fox-managed.cjs（内嵌服务器+CDP+采样+截图）。本工作树 tools/qa-hqfox-managed.cjs 也是同模式（注意它轮询 __game ready 曾偶发超时：诊断证明页面约 16s 就绪，把超时放到 ≥45s 并在导航前就 enable Runtime/Network/Log）。
- URL：http://127.0.0.1:<port>/index.html?version=dev&webgl=1。点开始、隐藏 #overlay，通过 window.__game（game/controller/camera/foxes()/terrainHeight/loadLevel/setViewMode/player 等）摆机位：第一人称小径近景（看泥地/草/岩石贴图清晰度）、中景（灌木/枯树/树根）、远景（巨崖纵深+天空/HDRI）、第三人称玩家+狐狸同框、俯瞰全岛。每轮出一组 PNG 并**自己用读图能力看图**。
- 每轮列具体问题并改：贴图是否显示/清晰、法线强度、roughness、色调统一、明暗/死黑、HDRI 方向与阴影、雾浓度、悬空/穿插/接地、alpha 草叶、几何闪烁、面数/帧率/加载体积。迭代到：写实森林小径观感显著提升、贴图清晰自然、无死黑/塑料感、运行流畅（目标 ≥30fps，首屏可接受）、玩家/狐狸/洞穴与地面贴合正确。
- 每轮留前后对比图与 outputs/scene-report.md（问题诊断/改动参数/前后图相对路径/体积帧率）。

## 验收与交付
- Node 契约测试：manifest/height 与新 glb 一致、loader 能解析、贴图存在且被引用、stable 路径不受影响；跑 `node tools/run-node-tests.cjs`（本就 skip/fail 的浏览器测试注明即可），不得引入新的纯 node 回归。
- 分多次 git 提交：管线脚本、几何导出、贴图压缩、运行时光照/loader、每轮视觉打磨，message 写清。
- 最终回复：每个 commit hash 与改动文件、最终 glb/贴图总体积与总面数、测试结果、3+ 轮迭代摘要、关键最终截图**绝对路径**清单（我会直接看这些 PNG）、帧率/加载数据、未解决问题与建议（比如是否要上 Draco/LOD/虚拟纹理）。
- 若 18800 CDP 不可用，先报告阻塞，不要改用会崩的自起 headless。
