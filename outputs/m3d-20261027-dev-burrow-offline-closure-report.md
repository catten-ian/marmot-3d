# m3d-20261027-dev-burrow-offline-closure 离线验收报告

- 工作树：`/home/fame/code/marmot3d/m3d-dev-burrow-offline-20261027`
- 分支：`feat/dev-burrow-offline-closure-20261027`
- 基线：`b997c1af74cee0ceeef65dcbfa5553bf49bae599`
- 渲染后端：`tools/lib/glb-offline.cjs` 自带的纯 Node CPU 软件光栅器；没有使用 WebGPU、WebGL、浏览器或 CDP。
- push/deploy：未 push、未部署。

## 目标对照

A 已完成。离线 GLB 解析器现在读取 `skins[]`、joint 列表、可选 skeleton、inverseBindMatrices，并通过父链递归计算 joint world matrix。JOINTS_0 支持现有 accessor 读取路径，WEIGHTS_0 做线性混合；零权重关节跳过，全零权重回退原位置；法线使用每个 skin matrix 的逆转置 3x3。实测 `marmot-screaming.glb` 的三个 skin 为：Tongue_bone 3 joints/3 inverse bind，Tail_bone 4/4，body_bone 108/108（以资产实际内容为准）。Tongue 顶点最大位移 `0.2883159283`，样本坐标从 `[0.0501023, 0.6871062, 0.0841484]` 到 `[-0.0207934, 0.4591352, 0.2457933]`；Tail 最大位移 `0.3858779853`，样本从 `[-0.1765165, -0.1778524, -0.2580838]` 到 `[0.1825379, -0.3192075, -0.2587753]`。全零权重测试输出仍为 `[1,2,3]`，法线仍为 `[0,1,0]`，无 NaN。

B 已完成。QA 对每张截图硬断言：宽高必须等于 viewport；coverage 下限 `0.005`；唯一 RGB 颜色至少 `4`；独立的“非背景且非近黑”像素占比至少 `0.001`。这些阈值以当前最小目标（宽屏 sorrel coverage 约 `0.0069`、尖叫土拨鼠实际 4 色）为依据，同时纯背景图的 coverage/颜色数为 `0/1`，会失败。QA 内含对照断言：弱断言（只看 `tris`）会让 `tris=0` 全背景图通过；强断言记录为 `coverage=0, uniqueColors=1 => FAIL`。

C 已完成离线场景装配。主洞和临时洞使用真实 GLB、目标高度归一化、`rotation.y = Math.PI/2` 和 `interiorGroup.position.y = -chamberDepth + 0.1` 的等价变换；离线程序化补齐 BackSide 井壁、地板、洞口封盖、内缘环、四盏暖/冷灯近似和高对比标签区域。洞穴尺寸从真实 `scaledBurrows()` 和 dev `undergroundProfile()` 运行结果取得，没有复制一份桩配置。

D 已完成。复核确认 `this.shaft`、`this.mouth` 只是构造后未被任何源码读取的死属性，已删除这两个外部属性赋值；实际网格仍加入场景。稳定版的 beam/cap/beacon 分支保留。QA 的布局检查通过真实 `scaledBurrows()`：5 个洞，包含 base 与四个 shelter。

## 改动文件

- `tools/lib/glb-offline.cjs`：蒙皮、父链矩阵、可测试导出、精确 RGB 颜色统计。
- `tools/qa-dev-burrow-offline.cjs`：真实 scaledBurrows/profile 接线、洞穴离线装配、四尺寸证据、强像素断言和全背景拒绝对照。
- `tools/test-burrow-offline-skinning.cjs`：新增 node:test。
- `src/world/props.js`：删除未被读取的 `shaft`/`mouth` 属性赋值。
- `outputs/m3d-20261027-dev-burrow-offline-closure/visual/`：截图与 `manifest.json`。
- `outputs/m3d-20261027-dev-burrow-offline-closure/qa-result.json`。

## 验证命令与真实输出

- `node --check tools/lib/glb-offline.cjs`：通过。
- `node --check tools/qa-dev-burrow-offline.cjs`：通过。
- `node --check tools/test-burrow-offline-skinning.cjs`：通过。
- `node --check src/world/props.js`：通过。
- `node --test tools/test-burrow-offline-skinning.cjs`：`tests 2, pass 2, fail 0`。
- `node tools/qa-dev-burrow-offline.cjs`：`OK 95/95`。
- `node tools/run-node-tests.cjs`：`FAILURES: 3, OK 41/44`。三个失败均为基线工作树已有的 Verdant high 资产缺失：`assets/verdant/tiers/high/verdant-trail-high.glb` 不存在，导致 `test-verdant-pack.cjs`、`test-verdant-tos-tiers.cjs`、`test-verdant.cjs` 同一根因失败；本任务未修改或删除该资产，也未放宽这些断言。其余本地测试通过，`test-beta-contract.cjs` 通过。

## 场景 × 尺寸证据

完整逐项记录在 [`manifest.json`](outputs/m3d-20261027-dev-burrow-offline-closure/visual/manifest.json)。每项命令均为 `node tools/qa-dev-burrow-offline.cjs`，文件名包含场景和 viewport；预期/观察字段也写在 manifest 中。覆盖场景：主洞内景、临时洞内景、洞口外观、尖叫土拨鼠（蒙皮路径）、sorrel 灌木；尺寸：390x844、768x1024、1280x720、1440x900，共 20 张 PNG。

代表性观察：主洞 390x844 的软件渲染呈现拱形洞顶、棕色地板和顶部开口区域；主洞全尺寸 coverage `0.9591–0.9838`、颜色数 `16949–26298`。临时洞 coverage `0.9985–1.0000`、颜色数 `4091–22934`。洞口视角颜色数为 `5`，非背景占比 `0.0011–0.0044`，保留了近黑洞口、土壁和标签/灯光对比。sorrel 在宽屏最小 coverage `0.0069`，仍高于 `0.005` 下限。截图均由实际 CPU 光栅路径生成，没有手工拼图。

## 已知问题与临时绕行

- `marmot-screaming.glb` 的 body 节点在当前资产中没有 `skin` 字段，body_bone skin 仍被解析并校验 108 个 joint/inverse bind；实际带 skin 的 mesh 节点是 Tongue 和 Tail。若资产供应方后续给 body 节点补 skin，现有路径会自动处理。
- 当前软件光栅器不模拟完整 PBR、阴影、环境贴图或字体栅格化；标签在离线证据中用高对比几何区域表示。需要引擎级像素一致性时应走浏览器验收流程。
- 全量回归的 Verdant high GLB 缺失属于基线环境资产问题；临时绕行是补齐该基线资产后重跑 `node tools/run-node-tests.cjs`。

## 自评与 OpenClaw 核验建议

Codex 自评：离线验收闭环已具备可重复的蒙皮数值证据、强像素断言、真实洞穴布局来源和四 viewport 证据；未触碰 `index-public.html`、版本戳、stable/beta 通道、线上配置或部署文件。建议 OpenClaw 核验：检查 `manifest.json` 是否覆盖 20 张证据、抽查 Tongue/Tail 最大位移数值、确认 `qa-result.json` 为 `OK 95/95`，并单独标记 Verdant high 缺失为基线资产问题。
