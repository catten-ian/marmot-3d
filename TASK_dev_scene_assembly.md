# 任务书：修复 DEV Verdant 真实场景组装悬空问题（树/动物/避难洞）+ 大本营选址 + 下载器

工作树：`/home/fame/code/marmot3d/m3d-dev-scene-assembly`（分支 fix/dev-scene-assembly，tip `63fd2b2`，已含防掉底、上坡接地、字节心跳看门狗 `src/world/verdant-watchdog.mjs`、障碍代理 `src/world/verdant-obstacles.mjs`）。纯静态、零新增运行时依赖。**只影响 `?version=dev` Verdant；stable/beta 零影响。不要 push/部署/动 Caddy。**

## 用户复现（先看证据图，目录名含中文）
`/home/fame/.openclaw/workspace/media/inbound/bug*-extract/dev-bug{1..4}-view.png`（原 3840×2160 BMP 同目录 dev-bug1..4.jpg）：
- bug1：**土拨鼠悬空**（脚离地，飘在坡面上）。
- bug2：**土拨鼠卡进地下夹层**（多层悬崖/悬板之间，夹在两层之间）。
- bug3：**临时避难洞浮在空中**（黑色圆盘洞口 + "临时避难洞"标签挂在半空，靠树枝/悬崖）。
- bug4：**枯树悬空**（整棵死树连根飘在天上，用户明确要求"按 Verdant 原始安排组装，原始包含 blender 文件"）。
- 另：**大本营位置太偏**，要移到更中心/便利处。

## 唯一真相源（关键）
- 原始 Blender：`/home/fame/marmot3d-assets/verdant_trail/verdant_trail.blend`（233MB，**只读，禁止修改/另存覆盖**）。同目录有 `inspect_scene.py`（用 `/home/fame/tools/blender/blender -b <blend> -P inspect_scene.py` 导出对象世界变换/包围盒）、`scene-metadata.json`、`textures/`。
- 导出管线：`tools/verdant/export_real_scene.py`（读 blend 选中对象，保留原始几何/材质/世界变换导出 tier GLB）。当前 GLB `assets/verdant/verdant-trail.glb`（61 节点/55 mesh，含 main_dead_tree_trunk、dead_tree_trunk_02(.001/.002)、tree_small_02_*、island_tree_01_*、jacaranda_tree_*、coastal_cliff_*、background_cliff_*）。
- Blender：`/home/fame/tools/blener/blender` 若不对就用 `/home/fame/tools/blender/blender`（4.4.3，已验证可 headless 跑 GLB 导出）。

## 排查与修复（按层）

### 层1：导出是否忠实 blend（对应树悬空 bug4）
- 用 Blender headless + inspect 脚本（可新增只读 `tools/verdant/dump_transforms.py`）导出每类 mesh 的**世界变换（位置/旋转/缩放）与世界包围盒 min/max**，与 GLB 中对应节点对比。
- 判断悬空树是：(a) 导出改变了世界矩阵（apply transform / 父级 / origin 问题），还是 (b) blend 里它本来就在岛上合理位置但运行时地形/相机误判，或 (c) 运行时对这些树做了程序化位移/重新接地。
- 修复原则：**导出必须 1:1 保留对象在 blend 里的世界安排**，不得在导出或加载时"自动接地"移动这些真实资产（除非证明 blend 里本就穿地且有明确规则）。若需要重导出 GLB，输出到本树 assets 并给命令/证据；注意三档 tier 一致性（low 是线上实际使用档）。

### 层2：代码生成实体的接地（土拨鼠/临时避难洞，对应 bug1/2/3）
- 这些是运行时生成、放在地形上的：定位生成代码（grep burrow/避难洞/marmot/动物 spawn/groundHeight/sampleHeight/heightAt）。
- 已知背景：Verdant 高度场历史上约 45% 格子为假 0；多层悬崖会让"取最近/最高点"选错层（造成悬空或夹进夹层）。基线已有 `verdant-fall-safety.mjs` / `verdant-collision.js`，复用其高度场与可行走格统计，**不要另起一套**。
- 修复：
  - 实体/洞放置用**实体半径多点采样**（不是单点），在其所在的连通可行走地表层取接地高度，排除假0柱与悬空薄层；保证脚底 y 贴合可行走面（容差内），不悬空、不夹层。
  - 洞（圆盘）需放在水平可行走且上方有净空的位置；其标签深度问题（穿透岩石）如果在 dev 也存在一并按 beta 同款修法（见下"标签"）。
  - 放置后做一次校验：离最近可行走面高度 < 阈值（如 0.05m）、不在 kill-plane/假0 柱、不在障碍代理内部。

### 层3：大本营选址（位置太偏）
- 用高度场可行走连通域：选一个更居中、到主要资源/洞口/各方向地形都较便利、且平坦有净空的点作为出生/大本营。给选择依据（可行走中心、连通、坡度、净空、到若干兴趣点距离），写死为数据驱动常量或从连通域确定性选出（别随机导致每次不同）。

### 层4：下载器（D1 增量去重 + D2 字节级进度条）
- 复用 63fd2b2 的字节心跳（`verdant-watchdog.mjs` 的字节到达时间思路）。
- **D1**：下载前对本地已存在素材算 md5/大小，与 pack manifest 的校验值比对；一致则跳过（并计入进度），缺失或不一致才下载（断点/损坏重下）。本地包解析在 `src/world/local-pack.js`（grep md5/checksum/manifest）。
- **D2**：加载界面给**字节级总进度条**（已下载字节/总字节，含"跳过"部分立即计满），而不只是文件个数。保持三级回退（本地包→TOS→源站）与看门狗硬上限不破坏。

## 标签穿岩石（若 dev 同类）
- "临时避难洞"文字/精灵被岩石树枝遮挡关系错误（画到了不透明物前面）。若是 THREE sprite/CSS2D：开深度测试/正确 renderOrder/depthTest，让不透明地形能挡住标签；距离过远或被挡时可淡出。beta 侧同款问题在另一任务，dev 这边只处理 Verdant 洞标签。

## 验证（证据进回复）
- Blender dump 与 GLB 节点世界变换/包围盒对照表（至少覆盖所有 dead_tree/tree/cliff），证明树在导出前后世界安排一致、树根贴合其所在地表（或说明 blend 内本就如此）。
- 新增纯 node 测试（`tools/test-verdant-placement*.cjs` 等）：所有代码生成放置点（动物/洞/大本营）离可行走面 < 阈值、多点采样不选假0/薄层、不与障碍代理重叠、大本营在主连通域且到兴趣点距离达标；下载器 md5 命中跳过、字节进度计算正确。现有 `test-verdant*`、`test-local-pack-resolution` 不回归；全部改动 `node --check`。
- CDP 真机（18800 直接连 page 的 Runtime.evaluate 超时：用 browser 级 Target.attachToTarget+flatten，或自起 `google-chrome --remote-debugging-port=<其它端口> --use-gl=swiftshader --enable-unsafe-swiftshader`）：dev `?version=dev&webgl=1&verdantTier=low`，多角度截图证明：树全部接地不悬空、土拨鼠/洞贴地不夹层、大本营在中心、下载进度条按字节走且二次加载跳过已存在素材、0 console error。截图存 `outputs/scene-assembly-qa/`。软渲加载慢请给足时间。
- dev `index.html` m 戳在 63fd2b2 基础上唯一递增（先读现状戳，如 `m20261023scene1`），全文件唯一、不新旧混用。**不要 bump beta public shell。**
- 若重导出 GLB：评估体积/三档影响并在回复明确（low 档线上从 TOS 加载，需主控另行上传 TOS，你只在本树产出文件与清单说明，**不要自行传 TOS/部署**）。
- 本地提交（语义化，可多个），不 push/部署；证据图/Blender dump JSON 可放未跟踪 outputs/ 不入库或小文件入库随你，但 233MB blend 绝对不要拷进仓库。
- 最终回复：每层根因→改法→文件:行→Blender 对照/测试/CDP 证据；特别说明哪些修复纯代码、哪些需要重传 TOS 资产（交主控）；列手机真机复验项；不要声称已上线。
