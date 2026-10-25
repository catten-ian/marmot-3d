# 返工书：dev Verdant 场景"自报 pass 但真机仍悬空"——必须做客观几何接地审计（不接受节点匹配代替视觉贴地）

工作树：`/home/fame/code/marmot3d/m3d-dev-scene-assembly`（已提交 9f65f10；四档重导 GLB 在工作区未入库）。
你上一轮报告 `pass:true`、`15/15 节点平移匹配 blend`，但**主控真机复核你的截图，物体仍然悬空**。节点世界矩阵匹配 ≠ 物体相对地表接地。本轮必须用几何数据说话。

## 主控亲眼所见（看这些截图，已拷到可读位置）
- `/home/fame/.openclaw/workspace/tmp-scene-qa/01-path-ground.png`、`02-mid-foliage.png`、`03-cliffs-depth.png`（三张基本同机位）：
  1. **画面顶部中央一棵枯枝树（枯树杈）整棵浮在天空**，与地面明显脱离。
  2. **右侧海面上方悬着一块巨大的草色扁平石板**（薄板，下方空）。
  3. 远景有多座悬浮岩/台地（部分可能是有意的背景浮岛，需区分）。
  4. 左侧一棵枯树压在一个悬空黑影/斜板上。
- `04-third-person.png`、`05-overview.png`：**相机直接穿进土拨鼠模型体内**（从腹部/腿下向上看），第三/俯视机位没有停在模型外。

## 先回答一个关键问题：悬空到底在源 blend 里，还是运行时错位？
地形、树、岩都在同一个 GLB 且保留了 blend 世界矩阵，那么"相对 GLB 地表"的接地关系理论上也被保留。树看起来浮空只有两种可能，必须用数据判定是哪一种：
- (A) **源 blend 本来就让它浮空**（作者有意的背景/浮岛，或是源资产缺陷）；
- (B) **运行时渲染/碰撞地表与 GLB 视觉地形错位**（heightJson/视觉 GLB 坐标/缩放/datum 不一致，或相机/玩家出生 y 错位）。

### 必做客观审计（产出数值表，不许只给"匹配"结论）
1. 用 Blender headless（`/home/fame/tools/blender/blender -b <233MB blend 只读>`，新增只读脚本如 `tools/verdant/audit_grounding.py`）遍历**每个 mesh 节点**：
   - 计算其**世界 AABB**（应用全部父级变换）：min/max（x,y,z）、底面中心、footprint 四角。
   - 对地形/地面 mesh 做一次底面投影采样（可用 BVH/射线或对地面三角面在该 footprint 内取最近表面 y；无 bpy 依赖也可在 node 侧用 gltf-transform/自写解析，但必须真实几何）。
   - 输出每节点：`name, bboxMinY, groundYBelow, gap=bboxMinY-groundYBelow, footprint 半径, 分类候选`。
2. 用同一套算法对**导出的 low GLB** 再算一遍，与 blend 对照（gap 误差应≈0，证明导出没引入新悬空）。
3. 据此输出分类：
   - **grounded 必须接地**：所有可玩区域附近的树（dead_tree/tree_small/island_tree/jacaranda 等）、岩石、洞、道具——gap 必须在小阈值内（如 |gap|≤0.15m）。
   - **backdrop 有意悬浮**：仅那些明确属于远景天空盒的 `background_cliff_*` / 远海浮岛，且要在表里给出"距可玩区域水平距离/在雾景之后"的证据，**默认不许把物体归为 backdrop 来凑数**。
   - 任何 grounded 类 gap 超限：明确它属于 (A) 源资产问题 还是 (B) 运行时错位，并给修复。
4. 若是 (A) 源资产里枯树本就浮空/根没到地面：在**导出后处理**里对"接地类"物体做**确定性接地贴合**（只平移 y，必要时小量下沉让根部入土，不旋转、不改 x/z、不动 backdrop），并把"每物体贴合前后 deltaY"写进审计 JSON；这与上一轮"1:1 保留 blend"不矛盾——修正源缺陷，且只动 y、全部留痕可审。
5. 若是 (B) 运行时地表错位：对齐 Verdant 视觉 GLB 与 heightJson/碰撞场的坐标、缩放、y datum（这是更可能影响玩家/动物接地与相机出生的根因），用 `experiments` 之外的本树代码修，给出对齐前后的玩家出生 y、相机距离、若干地表采样点的"视觉y vs 碰撞y"对照。

## 相机穿模（04/05）
- 修第三/俯视 QA 与实际出生相机：保证相机在玩家胶囊体外（结合相机碰撞/最近距离），俯视 overview 用真正的高空鸟瞰机位，绝不落进模型。若是 QA 脚本机位问题就改脚本；若是真实第三相机在出生点穿模则修相机碰撞。给修复后**模型完整可见**的第三人称与俯视截图。

## 验收（本轮以客观数据 + 主控会再次亲眼看截图为准）
- `tools/verdant/audit_grounding.py`（只读 blend/GLB）产出 `outputs/scene-assembly-qa/grounding-audit.json`：全部节点 gap 表、grounded/backdrop 分类与依据、每个被贴合物体的 deltaY。
- 结论必须明确：每个上轮截图里悬空物（顶部枯树、右侧大石板、左侧悬空黑影）分别是 grounded 已贴地 还是 backdrop（给距离证据）。
- 重导受影响档（low 必须；med/high 同法；ultra 说明），GLB **只在工作区/TOS，不 commit**；代码/脚本/manifest 可提交。
- node 测试新增"接地类 gap≤阈值、footprint 不落假0/海面、backdrop 判定需距离证据"，现有 38 测试不回归；`node --check`。
- CDP 真机重拍与上轮**同样五个机位**，且必须能看出：顶部枯树接地、右侧无近景悬浮板（或明确为有距离证据的远景浮岛）、相机在模型外完整看到土拨鼠。0 console error。截图放 `outputs/scene-assembly-qa/round2/`，并在 cdp-report 里附 grounding 摘要（不能再只报 pass）。
- 不 push/部署/传 TOS（产物与"需主控上传 TOS 清单"交代给我）；不 bump beta public shell。
- 最终回复：先承认上轮自报通过与真机不符；给出 (A)/(B) 判定、完整 gap 表要点、每个悬空物处置、相机修复、测试与真机证据、需传 TOS 的文件。
