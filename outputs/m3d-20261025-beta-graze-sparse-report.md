# beta「啃环境草」口径重做报告（渐进啃食 / 能量按实际吃到量 / 密度连续化 / 慢速自长）

通道：beta（`IS_BETA`）。stable / dev 路径逐字未动；未改 `index-public.html`、
`tools/public-shell.cjs`、`src/core/version.js`；未 push、未部署、未加依赖、未联网。

## 1. 改动文件清单

| 文件 | 改了什么 |
| --- | --- |
| `src/core/graze-grid.mjs` | 纯逻辑模块。`grassDensity()` 改为**连续密度**（半径内 growth 平均值，删除二值阈值与 `expectedInRadius` 形参）；新增 `grazeWeight()`（核心圈权重 1、外圈线性衰减到 0）、`grazeGrass()`（按 `dt` 渐进扣 growth，返回实际吃到量 `eaten`、满圈产能 `capacity`、变更索引 `touched`）、`regrowGrass()`（慢速自长，返回实际生长量）。`buildGrazeGrid/queryGrazeRadius/createGrassGrowth` 保持不变。 |
| `src/core/beta-tuning.js` | 新增 `grazeCoreRadius=1.2`（米）、`grazeHaloRadius=3.0`（米）、`grazeRate=0.55`（每株草每秒被啃掉的 growth，满权重）、`grassRegrowPerSec=0.012`（每秒自长 growth，约 83s 长满）。`grassSeconds=0.6`、`grazeRegenPerSec=8.0` 数值不变（契约测试钉住），注释改写清物理含义与单位。 |
| `src/world/props.js` | `grazeAt(x,z,dt)` 由「一口清零」改为每帧渐进扣减（委托纯函数 `grazeGrass`，立即刷新 touched 草株矩阵），返回 `{eaten, density=eaten/capacity}`；`_setGrassVisual` 高度映射由 `0.3+0.7g` 改为直接乘 `g`（growth=0 → scaleY=0，被啃光的草**真正消失**）；`hasGrazeable` 阈值由 `growth>0.5` 改为 `growth>0`；`grazeDensity` 接新连续签名；`growGrass` 委托纯函数 `regrowGrass`、默认速度取 `BETA_TUNE.grassRegrowPerSec`；删除不再使用的 `baseDensity` 估算。 |
| `src/main.js` | 仅 beta 啃草分支：删掉残留的「额外草本植物」结算（`plantsForLevel/energyOfPlant/eatLine`、按物种给一坨能量、`BERRY_CHARGE`）。改为按住期间**每帧** `scenery.grazeAt(x,z,dt)`，能量按 `p.energy += BETA_TUNE.grazeRegenPerSec * bite.density * dt` 逐帧结算（`bite.density=实际吃到量/满圈产能`，即按距离加权的连续密度）；一轮（0.6s）收尾只做 `foodCount++`、粒子、音效与不指名物种的飘字 `啃草 +N 储备`，不再另发能量（不重复计算）。新增模块级 `grazeCycleEaten` 累计本轮已回储备，松键/切目标/过关时清零。stable 采食分支、花（4 朵、瞬采、`采花 +N 储备`）路径逐字未动。 |
| `tools/test-graze-grid.mjs` | 更新连续密度签名；新增题目要求的 5 类用例（见第 4 节），共 10 个测试。 |
| `outputs/sim-graze-sparse.mjs` | 新增：按线上实测草口密度（r=3 圆盘 24 株）的量化自测脚本，产物仅在 outputs/，不属于游戏代码。 |

## 2. 逐条对应第 3 节口径

### 3.1 渐进啃食（吃一些少一些，不再一口一片）
`grazeGrass()` 对圈内每株草按 `growth -= rate*dt*weight(d)` 扣减，权重
`d<=1.2m 为 1；1.2~3m 线性衰减到 0`，连续而非二值。返回的 `eaten` 是本轮
真实扣减量（被各株剩余量截断），能量/文案只与它挂钩。
量化（24 株/圆盘，40 次随机平均，详见 `outputs/sim-graze-sparse.mjs`）：
按住 1 秒只吃掉 **6.84 株当量**的 growth、无一株归零、连续密度 1.000→0.715；
核心圈一株草从满到光平均 **1.79s**（=1/0.55）。对照旧版：一次 `grazeAt`
吃 21 株、密度瞬间 0.857→0。

### 3.2 真正变稀疏（吃光的草消失）
`_setGrassVisual`：`scaleY = 基准 × growth`。growth=0 → scaleY=0 真不可见，
出现真实秃斑；(0,1) 连续变矮。模拟：按住 2s 平均 5.3 株完全不可见，
4s 约 12.6 株，6s 约 16/24 株，核心区肉眼可见地越来越空。

### 3.3 密度连续化 → 每秒回量平滑下降
`grassDensity = Σgrowth / 圈内草株数`（无草株=0），取消 `growth>0.5` 二值与
固定期望株数。main.js 保持题目要求的形态
`p.energy += BETA_TUNE.grazeRegenPerSec * density * dt`，其中 density 取
`eaten/capacity`（按距离加权的连续密度，与纯函数 `grassDensity` 同口径且更贴近
「嘴边实际吃到的草」）。实测每秒回量随啃食时间：**8.00 → 8.00 → 7.46 →
3.52 → 2.02 → 1.33 → 0.90**，单调平滑；草全部吃光才为 0，不存在
「还剩 40% 草回量已归零」的断崖。

### 3.4 慢速自长，密度/回量随之回来；刷不出无限能量
保留 0.012/s（啃光约 83s 长满）。自长直接加在 growth 上，连续密度随之回升，
闭环成立。啃 6s 离开后密度恢复曲线：离开时 0.144 → 10s 0.263 → 20s 0.378 →
40s 0.608 → 83s 0.998（明显慢）。不变量：自长 0.012 远小于啃食 0.55（1:46），
原地不移动持续啃 2 分钟达到稳态后每秒仅回 **0.361 储备**（满草 8/s），
低于疾跑消耗（`sprintMoveCost=5/s`），不能原地刷能量。

### 3.5 收益/文案绑定实际吃到的草
能量只来自每帧 `eaten` 折算（见 3.3），收尾不再发第二份能量；飘字固定为
`啃草 +N 储备`（全新草位一轮 0.6s 约 +5），全分支无沙蒿/冷蒿/禾本科等物种名。
`energyOfPlant/eatLine` 仍原样保留于非 beta 与花/浆果路径（契约测试继续钉住）。

## 3. 数值调整理由

- `grazeRate=0.55`（新常量）：满权重时约 1.8s 啃光嘴边一株，按住 ~2s 出现秃斑，
  与「啃一会才稀疏」的直觉一致；配合几何权重，全新草点满草时回量恰好为
  `grazeRegenPerSec=8.0/s`（契约数值不变）。
- 几何权重（核心 1 / 外圈线性到 0）：替代「核心清零、外圈 0.3」的二值跳变，
  保证单帧扣草量与密度都是连续量。
- `grassRegrowPerSec=0.012`：沿用旧默认（约 83s），并显式落到 `BETA_TUNE`，
  满足「长得比较慢」且为啃速的 1/46，保证不可持续刷能量。
- `grassSeconds=0.6`：语义从「啃一棵的时间」变为「一轮啃食动作/飘字节拍」，
  数值不动。

## 4. 测试覆盖（tools/test-graze-grid.mjs，10 个用例）

1. 渐进扣除：单帧 dt=0.1 核心株仅减 0.055、密度仅微降（>0.9），不清零；
   非法 dt 不吃草；持续啃累计并最终到 0（case 1 / 1b）。
2. 密度连续性：10 株吃掉 40% → 密度恰为 0.6；全部剩 0.6 高度 → 密度 0.6
   （旧二值法会判 0）；全光为 0；空圆盘为 0。
3. 连续密度→回量：连续啃 40 帧，density 与 8×density 每秒回量严格单调不增；
   密度 ~0.5 时回量落在 (3.2, 4.8)。
4. 生长回升 & 不可无限刷：啃 3s 后密度明显下降，自长 20s 只回升一部分、
   ~100s 才长满；边啃边长跑到稳态（60s 预热 + 30s 统计）回量 <1.0/s
   （实测约 0.36/s）。
5. 被吃光的草 `growth === 0`，供视觉层判定消失。

## 5. 实际跑过的命令与真实输出

### 5.1 `node tools/run-node-tests.cjs`
```
（前略：54 个 PASS）
22 browser/CDP tests skipped (need Chrome): test-action-layout.cjs, ... , test-viewmodel.cjs
OK 54/54
```
基线为 54/54 通过 + 22 browser/CDP SKIP，与改动后一致，无回归。

### 5.2 `node tools/test-beta-contract.cjs`
```
beta entry shell, version detection, isolated full unlock, and stable progression: all assertions passed
```

### 5.3 `node --test tools/test-graze-grid.mjs`
```
✔ grid queries radius boundaries and filters
✔ growth tracks damage and regrowth with clamping
✔ density is a continuous quantity (no binary 0.5 threshold)
✔ case 1: grazing deducts a continuous amount, never wipes the radius in one bite
✔ case 1b: repeated grazing accumulates and eventually clears blades
✔ weight falls off linearly through the halo and is binary-free
✔ case 3: per-second energy return follows continuous density monotonically
✔ case 4: slow regrow lifts density back but cannot out-pace grazing (no infinite energy)
✔ case 5: fully eaten blades reach exactly growth 0 (visual layer can hide them)
✔ beta forage contracts remain fixed
ℹ tests 10 / ℹ pass 10 / ℹ fail 0
```

### 5.4 `node tools/test-forage-contract.cjs`
```
✔ forage settlement keeps kind-specific baseline contracts
✔ beta environmental graze settlement remains wired
ℹ pass 2 / ℹ fail 0
```

### 5.5 `node --check`（所有改动文件）
```
node --check OK: src/core/graze-grid.mjs
node --check OK: src/core/beta-tuning.js
node --check OK: src/world/props.js
node --check OK: src/main.js
node --check OK: tools/test-graze-grid.mjs
```

### 5.6 量化自测 `node outputs/sim-graze-sparse.mjs`
```
常量: {"rate":0.55,"regrow":0.012,"regen":8,"core":1.2,"halo":3,"grassSeconds":0.6}

场景A：原地持续啃（24 株/圆盘, 40 次随机平均）
初始连续密度 = 1.000, 初始回量 = 8.00/s
啃 1s: 密度=0.715  该秒回量=8.00 储备/s  累计秃株≈0
啃 2s: 密度=0.449  该秒回量=7.46 储备/s  累计秃株≈5.3
啃 3s: 密度=0.327  该秒回量=3.52 储备/s  累计秃株≈9.8
啃 4s: 密度=0.257  该秒回量=2.02 储备/s  累计秃株≈12.6
啃 5s: 密度=0.212  该秒回量=1.33 储备/s  累计秃株≈14.5
啃 6s: 密度=0.181  该秒回量=0.90 储备/s  累计秃株≈16

啃 1 秒：吃掉 growth 6.84 株当量，回储备 8.00
0.6s 一轮飘字数值 ≈ +5 储备（全新草位）
核心圈一株啃光平均耗时 1.79s

场景B：啃 6s 后离开，自长 0.012/s
离开时密度=0.144，10s 密度=0.263，20s 密度=0.378，40s 密度=0.608，83s 密度=0.998

场景C：原地持续啃 2 分钟后的稳态：加权密度=0.0452，回量=0.361 储备/s（满草为 8/s），啃/长速度比=46:1
```

## 6. 已知问题 / 遗留项

- 浏览器真机 CDP 视觉确认（秃斑、飘字、风摆）本环境跑不了（22 个浏览器测试
  正常 SKIP），仅做到 node 逻辑/契约级验证；建议主控在 rev 真机复核第 6 节判定。
- 单点位草株数有随机波动（线上实测 21 株/期望 24.5）。能量按
  eaten/capacity 归一化，满草点位都从 8.0/s 起步，几何波动只影响「能啃多久」，
  不影响瞬间回量上限。
- `Scenery.grazeDensity()`（未加权连续密度）当前仅作查询/调试接口保留，
  能量结算使用与实际吃量严格同源的加权密度。
- 啃草仍计入 `game.foodCount`（沿用旧行为，`test-forage-contract.cjs` 钉住），
  但不再给 overdrive 蓄力（旧版每 0.6s 白给 `BERRY_CHARGE`，与「吃环境草」口径
  不符且可空刷蓄力）；花/浆果的蓄力逻辑未动。

## 7. commit

- 逻辑提交（代码 + 测试 + 量化脚本）：`1524475`
  `feat(beta): 啃环境草口径重做——渐进啃食/连续密度/真实秃斑/慢速自长`
- 本报告由紧随其后的 docs 提交加入仓库。
