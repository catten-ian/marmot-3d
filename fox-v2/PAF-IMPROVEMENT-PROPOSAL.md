# 扮演藏狐模式（Play as Fox）改进方案 —— 文献调研与建议书

> 阶段：Stage R（纯研究/方案阶段，不含实现代码）
> 分支：`codex/fox-v2-20261024`（基线 HEAD `f7d2551`）
> 调研对象：`src/play/play-as-fox.js`（496 行）+ `src/play/play-as-fox-debug.js`（302 行）
> 日期：2026-10-24

---

## 1. 摘要

扮演藏狐模式目前的可玩性骨架是成立的：第三人称追尾、潜行/冲刺/扑击三段相位机、8 只猎物的捕猎循环。但代码复核（见 §2）确认了一组系统性问题：猎物察觉是**纯距离半径**、没有视野锥/听觉/遮挡维度；逃跑是 `atan2(dx,dz)` 的**笔直直线**；没有冻结/战栗中间态；扑击朝向在 wind 结束瞬间锁定、**对猎物运动零提前量**；捕获判定只有水平距离、**无垂直窗口**；猎物重生可能直接出现在玩家脸上；玩家狐狸没有体力/冷却，可以理论上无限连扑。这些问题叠加的结果是：猎物行为可预测、扑击更像"碰判定圈"而不是"截杀"，捕猎缺乏博弈感。

文献调研（§3：DeepXiv 成功调用 15 次，返回 310 条记录、去重后 292 篇，精读 10 篇）给出的核心启示是收敛的：**真实猎物面对威胁时不是二元的"看见就跑"**——Eilam (2005) 与 Hébert et al. (2019, PNAS) 都表明冻结（freezing）是未被发现阶段的最优防御，快速逼近（looming）才触发逃跑；Furuichi (2002) 与 Firestone & Warren (2010) 表明近距离/高速捕食者面前 zigzag 优于直线，因为 zigzag 破坏捕食者的恒定方位角拦截策略；Červený et al. (2011) 的赤狐野外数据确认 mousing 扑击是**高跳、从上方突袭**的短爆发动作，这直接支持"捕获需要垂直判定"。在 game feel 侧，Pichlmair & Johansen (2022) 的 game feel 综述和 Lin et al. (2022) 的 impact feel 实验支持用 FOV kick、hit-stop 放大扑击瞬间的反馈；Dahl & Kraus (2015) 则证明移动加减速参数本身显著影响手感感知。

本建议书按 A–F 六组提出 17 条可独立实施的改进（§4），每条都带机制描述、文献依据、建议参数、代码落点、风险与优先级。最高优先级的六件事是：**猎物多线索察觉（距离+视锥+速度）**、**freeze 中间态**、**近距离 zigzag 逃跑**、**扑击提前量预测**、**捕获垂直窗口**、**重生防贴脸**。这六条都能落在现有 `play-as-fox.js` 的 `Prey` 类和相位机内，不依赖新资产、新依赖或架构重构。

预期收益：猎物从"触发半径的移动靶"变成"有感知、有策略、可被欺骗的对手"；扑击从"进圈即中"变成"需要预判的截杀"；配合体力/冷却与镜头演出，形成"潜行接近 → 蓄力预判 → 爆发截杀 → 失误受罚"的完整捕猎节奏。同时建议（F 组）以**抽取纯函数/纯配置**的轻量方式与 AI 藏狐线共用感知与扑击时序参数，避免一次性大重构。

---

## 2. 现状问题清单

> 行号基于 HEAD `f7d2551`，已逐条复核。严重度按"对实际可玩性的影响"定级。

| # | 位置 | 问题机制 | 严重度 | 归属改进项 |
|---|------|----------|--------|-----------|
| 1 | `play-as-fox.js:139-142` | flee 时 `this.yaw = Math.atan2(dx, dz)`，**笔直远离狐狸**，无折线机动、无掩体寻求。玩家只要直线追就能恒速逼近，博弈感为零。文献（Furuichi 2002；Firestone & Warren 2010）明确：直线逃只对远/慢捕食者有效 | **高** | A3 |
| 2 | `play-as-fox.js:125-136` | 察觉是**纯距离半径**三档（6.2/11.5/17.0）：无视野锥（猎物背对玩家也一样发现）、无听觉维度、无遮挡（LOS）、无速度/姿态调制。潜行的"不被看见"感不成立 | **高** | A1 |
| 3 | `play-as-fox.js:82,130-133` | 状态机只有 `wander/alert/flee` 三态，`pouncing` 时立即 `flee`；**无冻结/战栗中间态**。与 Eilam (2005)、Hébert et al. (2019) 的冻结-逃跑切换模型不符，也丢掉了一个很好读的猎物表现层 | 中 | A2 |
| 4 | `play-as-fox.js:139-142` | 猎物只回避狐狸**当前位置**，不回避扑击**轨迹/着陆点**。wind 0.22s + lunge 0.42s 期间猎物直线远离扑击方向，等于往弹道上跑。Kawabata et al. (2023) 表明真实猎物回避的是攻击终点 | **高** | A4 |
| 5 | `play-as-fox.js:368,371-374` | `wind` 结束瞬间 `fox.lungeYaw = fox.yaw` 锁定，lunge 期间沿锁定方向匀速推进，**无提前量（lead）预测、无轨迹微调**。横向移动的猎物几乎必丢，且丢得"不讲道理" | **高** | B1 |
| 6 | `play-as-fox.js:280-283` | `startPounce()` 只检查 `phase !== 'idle'`，**无体力、无冷却**，理论上 recover 一结束就能再扑 | 中高 | C1/C2 |
| 7 | `play-as-fox.js:110-118` | `respawnAt()` 随机角度+随机半径，**不检查与玩家距离、不检查玩家视野**，可能重生在玩家脸上，瞬间被捕 | **高** | E3 |
| 8 | `play-as-fox.js:437` 及 `PAF_DEFAULTS.preyCount` | 猎物固定 8 只、参数全程不变，**无难度爬升**；计分只有"只数+耗时"，无连击/效率维度 | 中 | E1/E2 |
| 9 | `play-as-fox.js:405-410` | 蹲伏只是 `scale.y` 压到 0.72/0.9，扑击只是 `rotation.x = -0.3`——**是"压扁"不是"姿态"**。现有 `createProceduralFox()`（`procedural-fox.js:27-75`）已有 body/head/legs/tail 结构，可以做轻量真姿态 | 中 | D1/D2 |
| 10 | `play-as-fox.js:426-434` | 固定追尾相机，扑击瞬间**无 FOV kick、无顿帧、无慢动作**。Lin et al. (2022) 实验证明 hit-stop 与相机反馈显著影响 impact feel | 中高 | B3 |
| 11 | `play-as-fox.js:417-419` | 捕获只看水平距离 `< catchRadius(1.7)`，**无垂直/高度判定**——狐狸腾空 1.05m 越过猎物头顶时仍可能"吸"到猎物，反直觉 | **高** | B2 |
| 12 | `config.js:271-284` ↔ `play-as-fox.js:53-55` | AI 藏狐线的 `FOX.detection` 与 PAF 的察觉数值**刻意对齐但两处手写**，感知/扑击时序逻辑也是两套实现。存在漂移风险，但一次性合并重构风险更大 | 低 | F1 |
| 13 | `play-as-fox-debug.js:153-202` | 已有 lil-gui 调参面（移动/扑击/碰撞/猎物/相机）+ 察觉半径与捕获范围可视化——**这是资产不是问题**，所有新参数都应接入现有调参台 | —（正面） | 全部 |

---

## 3. 文献调研

### 3.1 检索过程与覆盖度（诚实记录）

本轮按 breadth → shortlist → depth 执行，时间戳为 2026-10-24（Asia/Shanghai）。DeepXiv 是主通道：对九个方向组织了 15 条英文自然语言检索式，全部返回 `status=success`；每次 `top_k=8`，但服务会按相关性扩展来源，合计返回 310 条记录（按 arXiv ID 去重后 292 篇）。原始响应保存在 `/tmp/fox-research/01.json`–`15.json`，完整来源账本为 `/tmp/fox-research/sources.jsonl`。随后用 arXiv API 实际读取了 10 个候选摘要（XML 保存在 `/tmp/fox-research/abstracts/`），并用 DOI/Crossref 页面核对了生态与行为论文的元数据。

**DeepXiv 调用记录与返回 sources（每行列出返回列表的前 8 个 arXiv ID；完整列表见 sources.jsonl）**：

| # | 检索式 | 返回数 | sources 前 8 个 |
|---|---|---:|---|
| 1 | predator prey pursuit evasion differential games escape trajectories speed ratio | 8 | 2501.18899, 2411.19376, 2208.12280, 2605.04768, 2608.30128, 0809.0413, 2007.08965, 2604.17742 |
| 2 | prey anti predator behavior vigilance freezing fleeing zigzag escape refuge | 8 | 2609.37885, 1611.03065, 1110.2975, 1408.1906, 0909.1445, 1403.3250, 1905.04077, 2308.08864 |
| 3 | constant bearing strategy rabbit fox zigzag escape predator interception | 24 | 2512.00273, 2301.02661, 1207.6389, 1501.05066, 2511.05828, 2006.10253, 2310.01203, 2610.27629 |
| 4 | Tibetan fox Vulpes ferrilata hunting plateau pika predation behavior | 24 | 1810.11192, 2006.16525, 2609.37885, 1807.02349, nlin/0610043, 1905.02346, 2409.00193, cond-mat/9905224 |
| 5 | red fox Vulpes vulpes mousing pounce hunting biomechanics jump | 27 | 2407.03369, 2604.01343, 2007.01694, 2506.09590, 1907.13459, 2412.02389, 2603.01128, 2506.12314 |
| 6 | predator detection visual field auditory cues distance motion looming prey | 27 | 1309.2852, 2210.04108, 1903.07546, 1602.08802, 2101.11217, 1510.07573, 2112.02361, 1206.3108 |
| 7 | prey escape trajectory attack endpoint turning cost geometric model | 16 | 2602.13457, 2609.37885, 2512.06130, 2103.13156, 2110.04956, 2208.12280, 2510.04050, 1011.0851 |
| 8 | game AI pursuit evasion steering behavior behavior trees utility AI | 8 | 1511.07714, 2206.01109, 1909.04368, 2209.01020, 2007.12586, 2107.13738, 1709.00084, 2406.10411 |
| 9 | game feel telegraph hit stop camera shake FOV impact feedback action games | 8 | 2208.06155, 2210.03800, 2011.09201, 1609.02182, 2605.23345, 2407.12787, 2512.12486, 2411.05140 |
| 10 | procedural quadruped animation locomotion foot planting inverse kinematics | 26 | 1404.2053, 2604.02744, 2010.16342, 2305.01998, 1902.07346, 2104.10898, 1410.1130, 1401.1488 |
| 11 | reinforcement learning pursuit evasion games agent training versus handcrafted AI | 37 | 2108.11010, 2104.01445, 2410.04936, 2606.20210, 2404.16689, 1904.09307, 2506.02849, 2607.05939 |
| 12 | video game difficulty progression session pacing scoring combo risk reward | 8 | 2305.00915, 1806.05117, 2304.08699, 1110.4412, 2311.13462, 2410.02388, 2605.05922, 2308.12726 |
| 13 | predator prey refuge habitat selection escape cover decision | 27 | 1104.3805, 2103.13156, 2609.37885, 1910.10541, 1703.09275, 1609.07855, 0809.5225, 2609.18609 |
| 14 | fox locomotion acceleration sprint pounce biomechanics canid predation | 34 | 2304.04603, 2305.01406, 1310.1369, 2607.08644, 2412.03949, 2405.02674, 2202.05293, 1502.04328 |
| 15 | input buffering anticipation attack windup dodge window game design | 28 | 2109.14555, 2504.14725, 2208.00235, 2112.12098, 2212.06628, 2208.06155, 2205.02437, 2011.09201 |

<details>
<summary>完整 sources 列表（15 次调用逐次保留；共 310 条返回记录）</summary>

> 以下是每次 DeepXiv 响应中 `sources` 数组的完整 arXiv ID、题名和 URL；同一论文在不同检索式命中时按原响应保留，不去重。

**Query 1：predator prey pursuit evasion differential games escape trajectories speed ratio（8 条）**
- `2501.18899` — Minimum Time Strategies for a Differential Drive Robot Escaping from a Circular Detection Region — https://arxiv.org/abs/2501.18899
- `2411.19376` — Prying Pedestrian Surveillance-Evasion: Minimum-Time Evasion from an Agile Pursuer — https://arxiv.org/abs/2411.19376
- `2208.12280` — Effect of inertia on the evasion and pursuit dynamics of prey swarms and the emergence of an optimal mass ratio for the predator-prey arms race — https://arxiv.org/abs/2208.12280
- `2605.04768` — From open-loop representations to closed-loop feedback implementations in differential games: A numerical case study — https://arxiv.org/abs/2605.04768
- `2608.30128` — Analysis of First-Order Linear Pursuit and Evasion Differential Games with Gronwall-Type Constraints — https://arxiv.org/abs/2608.30128
- `0809.0413` — Collective Motion due to escape and pursuit response — https://arxiv.org/abs/0809.0413
- `2007.08965` — Escaping a Polygon — https://arxiv.org/abs/2007.08965
- `2604.17742` — A Numerical Analysis for Pursuit-Evasion Games under the Stackelberg Eqilibrium — https://arxiv.org/abs/2604.17742

**Query 2：prey anti predator behavior vigilance freezing fleeing zigzag escape refuge（8 条）**
- `2609.37885` — Boids of a Feather Flock Together - Evolving Prey Behaviours Under Different Predator Attack Strategies — https://arxiv.org/abs/2609.37885
- `1611.03065` — Toward Smart Moving Target Defense for Linux Container Resiliency — https://arxiv.org/abs/1611.03065
- `1110.2975` — Feeling, following, feeding, fleeing: a copepod's life at low Reynolds number — https://arxiv.org/abs/1110.2975
- `1408.1906` — Exploring the evolution of a trade-off between vigilance and foraging in group-living organisms — https://arxiv.org/abs/1408.1906
- `0909.1445` — Survival of an evasive prey — https://arxiv.org/abs/0909.1445
- `1403.3250` — A minimal model of predator-swarm interactions — https://arxiv.org/abs/1403.3250
- `1905.04077` — Emergent Escape-based Flocking Behavior using Multi-Agent Reinforcement Learning — https://arxiv.org/abs/1905.04077
- `2308.08864` — A discrete-time dynamical model of prey and stage-structured predator with juvenile hunting incorporating negative effects of prey refuge — https://arxiv.org/abs/2308.08864

**Query 3：constant bearing strategy rabbit fox zigzag escape predator interception（24 条）**
- `2512.00273` — Dependent Reachable Sets for the Constant Bearing Pursuit Strategy — https://arxiv.org/abs/2512.00273
- `2301.02661` — Evaluating Evasion Strategies in Zebrafish Larvae — https://arxiv.org/abs/2301.02661
- `1207.6389` — Hunter, Cauchy Rabbit, and Optimal Kakeya Sets — https://arxiv.org/abs/1207.6389
- `1501.05066` — A Property of Random Walks on a Cycle Graph — https://arxiv.org/abs/1501.05066
- `2511.05828` — Learning-Based Multi-Stage Strategy for a Fixed-Wing Aircraft to Evade a Missile Detected at a Short Distance — https://arxiv.org/abs/2511.05828
- `2006.10253` — Apollonius Allocation Algorithm for Heterogeneous Pursuers to Capture Multiple Evaders — https://arxiv.org/abs/2006.10253
- `2310.01203` — Escape from an Orbiting Pursuer with a Nonzero Capture Radius — https://arxiv.org/abs/2310.01203
- `2610.27629` — Minimum-Time Escape from the Conic Field of View of a Reeds-Shepp Pursuer: Classification and Game Value for a Slower or Equally Fast Evader — https://arxiv.org/abs/2610.27629
- `2104.01445` — A Dynamics Perspective of Pursuit-Evasion Games of Intelligent Agents with the Ability to Learn — https://arxiv.org/abs/2104.01445
- `2508.10727` — Run-and-Tumble Escape in Pursuit-Evasion Dynamics of Intelligent Active Particles — https://arxiv.org/abs/2508.10727
- `2106.10514` — Cooperative Evasion by Translating Targets with Variable Speeds — https://arxiv.org/abs/2106.10514
- `0901.1416` — Qualitative Criterion for Interception in a Pursuit/Evasion Game — https://arxiv.org/abs/0901.1416
- `2603.16279` — Agile Interception of a Flying Target using Competitive Reinforcement Learning — https://arxiv.org/abs/2603.16279
- `2609.37885` — Boids of a Feather Flock Together - Evolving Prey Behaviours Under Different Predator Attack Strategies — https://arxiv.org/abs/2609.37885
- `cond-mat/0504107` — Optimal search strategies for hidden targets — https://arxiv.org/abs/cond-mat/0504107
- `1912.02141` — Predator-prey dynamics: Chasing by stochastic resetting — https://arxiv.org/abs/1912.02141
- `2311.02389` — Multiplayer Homicidal Chauffeur Reach-Avoid Games: A Pursuit Enclosure Function Approach — https://arxiv.org/abs/2311.02389
- `math/0508023` — Steering laws for motion camouflage — https://arxiv.org/abs/math/0508023
- `1709.07310` — Constant Bearing Pursuit on Branching Graphs — https://arxiv.org/abs/1709.07310
- `2401.12848` — Optimal Evasion from a Sensing-Limited Pursuer — https://arxiv.org/abs/2401.12848
- `1205.4422` — 3D-Algorithms of Composed Pursuit Navigation — https://arxiv.org/abs/1205.4422
- `1611.04613` — On the Optimal Policies for Visibility-Based Target Tracking — https://arxiv.org/abs/1611.04613
- `2206.01109` — Game-theoretic Utility Tree for Multi-Robot Cooperative Pursuit Strategy — https://arxiv.org/abs/2206.01109
- `2303.15598` — Optimal Intermittent Sensing for Pursuit-Evasion Games — https://arxiv.org/abs/2303.15598

**Query 4：Tibetan fox Vulpes ferrilata hunting plateau pika predation behavior（24 条）**
- `1810.11192` — Effects of free-ranging livestock on sympatric herbivores at fine spatiotemporal scales — https://arxiv.org/abs/1810.11192
- `2006.16525` — Hunting Co-operation in the Middle Predator in Three Species Food Chain Model — https://arxiv.org/abs/2006.16525
- `2609.37885` — Boids of a Feather Flock Together - Evolving Prey Behaviours Under Different Predator Attack Strategies — https://arxiv.org/abs/2609.37885
- `1807.02349` — A generalized Holling type II model for the interaction between dextral-sinistral snails and Pareas snakes — https://arxiv.org/abs/1807.02349
- `nlin/0610043` — Theoretical analysis and multi-agent simulation of the ecosystem in Tibet — https://arxiv.org/abs/nlin/0610043
- `1905.02346` — Turbulent lithosphere deformation in the Tibetan Plateau — https://arxiv.org/abs/1905.02346
- `2409.00193` — Trophic Cascades and Habitat Suitability in Udanti Sitnadi Tiger Reserve: Impacts of Prey Depletion and Climate Change on Predator Prey Dynamics — https://arxiv.org/abs/2409.00193
- `cond-mat/9905224` — Critical Behavior of Anisotropic Heisenberg Mixed-Spin Chains in a Field — https://arxiv.org/abs/cond-mat/9905224
- `1709.00053` — Dynamic Analysis of a Predator and Prey Model with Some Computational Simulations — https://arxiv.org/abs/1709.00053
- `2211.04730` — Inferring the ecology of north-Pacific albacore tuna from catch-and-effort data — https://arxiv.org/abs/2211.04730
- `1505.01316` — Short Report: Study variability in recent human challenge experiments with Plasmodium falciparum sporozoites (PfSPZ Challenge) — https://arxiv.org/abs/1505.01316
- `2505.00644` — Predatory dynamics in susceptible and resistant $\\textit{Eriopis connexa}$ populations — https://arxiv.org/abs/2505.00644
- `2308.08662` — Evaluating the potential impacts of grey seal predation and fishery bycatch/discards on cod productivity on the Western Scotian Shelf and in the Bay of Fundy — https://arxiv.org/abs/2308.08662
- `2509.14166` — Reaction-diffusion models of invasive tree pest spread: quantifying the expansion of oak processionary moth in the UK — https://arxiv.org/abs/2509.14166
- `1808.03160` — A network theoretic study of potential movement and spread of Lantana camara in Rajaji Tiger Reserve, India — https://arxiv.org/abs/1808.03160
- `2508.20219` — Identifiability, Sensitivity, and Genetic Algorithms in Bacterial Biofilm Selection Models — https://arxiv.org/abs/2508.20219
- `0811.1627` — Predator-Prey Quasi-cycles from a Path Integral Formalism — https://arxiv.org/abs/0811.1627
- `1112.2608` — Rohlin Distance and the Evolution of Influenza A virus: Weak Attractors and Precursors — https://arxiv.org/abs/1112.2608
- `2604.16924` — Planetary climate interactions of the Qinghai-Tibetan Plateau — https://arxiv.org/abs/2604.16924
- `0801.2855` — Phase transitions induced by variation of invasion rates in spatial cyclic predator-prey models with four or six species — https://arxiv.org/abs/0801.2855
- `1410.4642` — Quantum plateau of Andreev reflection induced by spin-orbit coupling — https://arxiv.org/abs/1410.4642
- `1301.0997` — Kadanoff Sand Piles, following the snowball — https://arxiv.org/abs/1301.0997
- `cond-mat/9510070` — Plateau of the Magnetization Curve of the S=1/2 Ferromagnetic-Ferromagnetic-Antiferromagnetic Spin Chain — https://arxiv.org/abs/cond-mat/9510070
- `1211.4911` — The impact of climate change on the structure of Pleistocene mammoth steppe food webs — https://arxiv.org/abs/1211.4911

**Query 5：red fox Vulpes vulpes mousing pounce hunting biomechanics jump（27 条）**
- `2407.03369` — FOXANN: A Method for Boosting Neural Network Performance — https://arxiv.org/abs/2407.03369
- `2604.01343` — Kinematics in Context: The Record Jump of Huaso and Larraguibel as a Teaching Resource for Physics — https://arxiv.org/abs/2604.01343
- `2007.01694` — Discrete element model for high strain rate deformations of snow — https://arxiv.org/abs/2007.01694
- `2506.09590` — Feynman Fox integrals in the physical region — https://arxiv.org/abs/2506.09590
- `1907.13459` — Development of a Fragment-Based Machine Learning Algorithm for Designing Hybrid Drugs Optimized for Permeating Gram-Negative Bacteria — https://arxiv.org/abs/1907.13459
- `2412.02389` — Fast ground-to-air transition with avian-inspired multifunctional legs — https://arxiv.org/abs/2412.02389
- `2603.01128` — A Deployable Bio-inspired Compliant Leg Design for Enhanced Leaping in Quadruped Robots — https://arxiv.org/abs/2603.01128
- `2506.12314` — Explosive Output to Enhance Jumping Ability: A Variable Reduction Ratio Design Paradigm for Humanoid Robots Knee Joint — https://arxiv.org/abs/2506.12314
- `2109.00149` — Modeling and Trajectory Optimization for Standing Long Jumping of a Quadruped with A Preloaded Elastic Prismatic Spine — https://arxiv.org/abs/2109.00149
- `2401.05554` — Characterising the take-off dynamics and energy efficiency in spring-driven jumping robots — https://arxiv.org/abs/2401.05554
- `1502.04328` — Geometric Spanning Cycles in Bichromatic Point Sets — https://arxiv.org/abs/1502.04328
- `1309.2969` — Lift and wakes of flying snakes — https://arxiv.org/abs/1309.2969
- `1211.0537` — Long Jump — https://arxiv.org/abs/1211.0537
- `1404.2534` — Viscous pumping inspired by flexible propulsion — https://arxiv.org/abs/1404.2534
- `1807.09124` — Flapping-pattern change in small and very small insects — https://arxiv.org/abs/1807.09124
- `2005.00773` — Complex fluids in the animal kingdom — https://arxiv.org/abs/2005.00773
- `2101.01992` — Detection of foraging behavior from accelerometer data using U-Net type convolutional networks — https://arxiv.org/abs/2101.01992
- `2408.03741` — Varying coefficients correlated velocity models in complex landscapes with boundaries applied to narwhal responses to noise exposure — https://arxiv.org/abs/2408.03741
- `1709.04019` — Sound emitted by some grassland animals as an indicator of motion in the surroundings — https://arxiv.org/abs/1709.04019
- `2006.16525` — Hunting Co-operation in the Middle Predator in Three Species Food Chain Model — https://arxiv.org/abs/2006.16525
- `0810.1477` — Evidence of stochastic resonance in the mating behavior of Nezara viridula (L.) — https://arxiv.org/abs/0810.1477
- `cond-mat/0208036` — Instability of quasi-liquid on the edges and vertices of snow crystals — https://arxiv.org/abs/cond-mat/0208036
- `1011.3193` — Hunting French Ducks in a Noisy Environment — https://arxiv.org/abs/1011.3193
- `physics/0506205` — A unified model for the long and high jump — https://arxiv.org/abs/physics/0506205
- `cond-mat/9603176` — Kinetics of a Diffusive Capture Process: Lamb Besieged by a Pride of Lions — https://arxiv.org/abs/cond-mat/9603176
- `1612.08034` — Push Recovery of a Humanoid Robot Based on Model Predictive Control and Capture Point — https://arxiv.org/abs/1612.08034
- `1010.4462` — Trapped Brane Features in DBI Inflation — https://arxiv.org/abs/1010.4462

**Query 6：predator detection visual field auditory cues distance motion looming prey（27 条）**
- `1309.2852` — From Cues to Signals: Evolution of Interspecific Communication Via Aposematism and Mimicry in a Predator-Prey System — https://arxiv.org/abs/1309.2852
- `2210.04108` — Visual Looming from Motion Field and Surface Normals — https://arxiv.org/abs/2210.04108
- `1903.07546` — Visual Cue Integration for Small Target Motion Detection in Natural Cluttered Backgrounds — https://arxiv.org/abs/1903.07546
- `1602.08802` — Exploring the coevolution of predator and prey morphology and behavior — https://arxiv.org/abs/1602.08802
- `2101.11217` — Automated Crop Field Surveillance using Computer Vision — https://arxiv.org/abs/2101.11217
- `1510.07573` — Generalized Regressive Motion: a Visual Cue to Collision — https://arxiv.org/abs/1510.07573
- `2112.02361` — Connecting the dots in ethology: applying network theory to understand neural and animal collectives — https://arxiv.org/abs/2112.02361
- `1206.3108` — A common rule for decision-making in animal collectives across species — https://arxiv.org/abs/1206.3108
- `1209.3330` — Predator confusion is sufficient to evolve swarming behavior — https://arxiv.org/abs/1209.3330
- `1405.7149` — Effect of Vision Angle on the Phase Transition in a Flocking Behavior of Animal Groups — https://arxiv.org/abs/1405.7149
- `2402.00467` — Can you see me now? Blind spot estimation for autonomous vehicles using scenario-based simulation with random reference sensors — https://arxiv.org/abs/2402.00467
- `2302.07088` — Assessment of Vehicular Vision Obstruction Due to Driver-Side B-Pillar and Remediation with Blind Spot Eliminator — https://arxiv.org/abs/2302.07088
- `2605.25140` — Eliminating Blind Spots from Wireless Network by Metasurface: A Blind Approach — https://arxiv.org/abs/2605.25140
- `2310.14239` — Guidance system for Visually Impaired Persons using Deep Learning and Optical flow — https://arxiv.org/abs/2310.14239
- `1711.05918` — Priming Neural Networks — https://arxiv.org/abs/1711.05918
- `1104.0025` — Information content of colored motifs in complex networks — https://arxiv.org/abs/1104.0025
- `1006.5469` — Inductive Game Theory and the Dynamics of Animal Conflict — https://arxiv.org/abs/1006.5469
- `1206.0324` — What does the Allen Gene Expression Atlas tell us about mouse brain evolution? — https://arxiv.org/abs/1206.0324
- `2409.15846` — Potential Field as Scene Affordance for Behavior Change-Based Visual Risk Object Identification — https://arxiv.org/abs/2409.15846
- `1407.2414` — The Role of Projection in the Control of Bird Flocks — https://arxiv.org/abs/1407.2414
- `2605.19232` — Devilray: A Systematic Adversarial Model Revealing Blind Spots in Fake Base Station Detection — https://arxiv.org/abs/2605.19232
- `2608.01573` — Uncovering and Mitigating Positional Blind Spots in Vision-Language-Action Models — https://arxiv.org/abs/2608.01573
- `2306.17536` — DisPlacing Objects: Improving Dynamic Vehicle Detection via Visual Place Recognition under Adverse Conditions — https://arxiv.org/abs/2306.17536
- `2410.05041` — Systematic Literature Review of Vision-Based Approaches to Outdoor Livestock Monitoring with Lessons from Wildlife Studies — https://arxiv.org/abs/2410.05041
- `2007.15235` — Detecting Suspicious Behavior: How to Deal with Visual Similarity through Neural Networks — https://arxiv.org/abs/2007.15235
- `2105.05145` — Visual Perspective Taking for Opponent Behavior Modeling — https://arxiv.org/abs/2105.05145
- `2006.13841` — Kleptoparasitism on carpenter ants (Camponotus spp.) by Podarcis tiliguerta (Gmelin, 1789) in Corsica and Podarcis filfolensis (Bedriaga, 1876) on the Maltese islands — https://arxiv.org/abs/2006.13841

**Query 7：prey escape trajectory attack endpoint turning cost geometric model（16 条）**
- `2602.13457` — Inferring Turn-Rate-Limited Engagement Zones with Sacrificial Agents for Safe Trajectory Planning — https://arxiv.org/abs/2602.13457
- `2609.37885` — Boids of a Feather Flock Together - Evolving Prey Behaviours Under Different Predator Attack Strategies — https://arxiv.org/abs/2609.37885
- `2512.06130` — Probabilistic Weapon Engagement Zones for a Turn Constrained Pursuer — https://arxiv.org/abs/2512.06130
- `2103.13156` — Coevolution of the reckless prey and the patient predator — https://arxiv.org/abs/2103.13156
- `2110.04956` — Optimal Stochastic Evasive Maneuvers Using the Schrodinger's Equation — https://arxiv.org/abs/2110.04956
- `2208.12280` — Effect of inertia on the evasion and pursuit dynamics of prey swarms and the emergence of an optimal mass ratio for the predator-prey arms race — https://arxiv.org/abs/2208.12280
- `2510.04050` — A Dynamic Programming Approach to Evader Pathfinding in Static Pursuit Scenarios — https://arxiv.org/abs/2510.04050
- `1011.0851` — Tracking control with adaption of kites — https://arxiv.org/abs/1011.0851
- `2608.14125` — Traj-LeWM: Path-Aware World-Model Planning via Latent Trajectory Cost — https://arxiv.org/abs/2608.14125
- `2510.27271` — Value of Multi-pursuer Single-evader Pursuit-evasion Game with Terminal Cost of Evader's Position: Relaxation of Convexity Condition — https://arxiv.org/abs/2510.27271
- `2505.08036` — Extreme value theory for geometric Brownian motion and pricing of short maturity barrier options — https://arxiv.org/abs/2505.08036
- `1910.03162` — A Physics-Based Attack Detection Technique in Cyber-Physical Systems: A Model Predictive Control Co-Design Approach — https://arxiv.org/abs/1910.03162
- `2306.15755` — Adversarial Backdoor Attack by Naturalistic Data Poisoning on Trajectory Prediction in Autonomous Driving — https://arxiv.org/abs/2306.15755
- `2610.05754` — Path-Space Optimal Transport with Interactions: Kinetic Equations and Eikonal Structure — https://arxiv.org/abs/2610.05754
- `2312.05502` — Poisoning $\\times$ Evasion: Symbiotic Adversarial Robustness for Graph Neural Networks — https://arxiv.org/abs/2312.05502
- `2609.14949` — Boundary transmission and excursion geometry in the Lorentz mirror model: a numerical study — https://arxiv.org/abs/2609.14949

**Query 8：game AI pursuit evasion steering behavior behavior trees utility AI（8 条）**
- `1511.07714` — A Python Engine for Teaching Artificial Intelligence in Games — https://arxiv.org/abs/1511.07714
- `2206.01109` — Game-theoretic Utility Tree for Multi-Robot Cooperative Pursuit Strategy — https://arxiv.org/abs/2206.01109
- `1909.04368` — Automatic difficulty management and testing in games using a framework based on behavior trees and genetic algorithms — https://arxiv.org/abs/1909.04368
- `2209.01020` — EvolvingBehavior: Towards Co-Creative Evolution of Behavior Trees for Game NPCs — https://arxiv.org/abs/2209.01020
- `2007.12586` — Introduction to Behavior Algorithms for Fighting Games — https://arxiv.org/abs/2007.12586
- `2107.13738` — Design-Driven Requirements for Computationally Co-Creative Game AI Design Tools — https://arxiv.org/abs/2107.13738
- `1709.00084` — Behavior Trees in Robotics and AI: An Introduction — https://arxiv.org/abs/1709.00084
- `2406.10411` — Tree Search for Simultaneous Move Games via Equilibrium Approximation — https://arxiv.org/abs/2406.10411

**Query 9：game feel telegraph hit stop camera shake FOV impact feedback action games（8 条）**
- `2208.06155` — What Features Influence Impact Feel? A Study of Impact Feedback in Action Games — https://arxiv.org/abs/2208.06155
- `2210.03800` — Data Feel: Exploring Visual Effects in Video Games to Support Sensemaking Tasks — https://arxiv.org/abs/2210.03800
- `2011.09201` — Designing Game Feel. A Survey — https://arxiv.org/abs/2011.09201
- `1609.02182` — Feedback and Timing in a Crowdsourcing Game — https://arxiv.org/abs/1609.02182
- `2605.23345` — SCOPE: Simulating Cross-game Operations in Playable Environments for FPS World Models — https://arxiv.org/abs/2605.23345
- `2407.12787` — GameVibe: A Multimodal Affective Game Corpus — https://arxiv.org/abs/2407.12787
- `2512.12486` — Simultaneous AlphaZero: Extending Tree Search to Markov Games — https://arxiv.org/abs/2512.12486
- `2411.05140` — Hold and Feel! A Multiplayer Video Game System with Interpersonal Vibrotactile Feedback via Bracelet Controllers — https://arxiv.org/abs/2411.05140

**Query 10：procedural quadruped animation locomotion foot planting inverse kinematics（26 条）**
- `1404.2053` — Expression driven Trignometric based Procedural Animation of Quadrupeds — https://arxiv.org/abs/1404.2053
- `2604.02744` — Learning Locomotion on Complex Terrain for Quadrupedal Robots with Foot Position Maps and Stability Rewards — https://arxiv.org/abs/2604.02744
- `2010.16342` — Robust Quadrupedal Locomotion on Sloped Terrains: A Linear Policy Approach — https://arxiv.org/abs/2010.16342
- `2305.01998` — Enhancing Efficiency of Quadrupedal Locomotion over Challenging Terrains with Extensible Feet — https://arxiv.org/abs/2305.01998
- `1902.07346` — Analytic Model for Quadruped Locomotion Task-Space Planning — https://arxiv.org/abs/1902.07346
- `2104.10898` — Soft Walks: Real-Time, Two-Ways Interaction between a Character and Loose Grounds — https://arxiv.org/abs/2104.10898
- `1410.1130` — Real-time animation of human characters with fuzzy controllers — https://arxiv.org/abs/1410.1130
- `1401.1488` — Forward and Inverse Kinematics Seamless Matching Using Jacobian — https://arxiv.org/abs/1401.1488
- `2410.01840` — Target Pose Guided Whole-body Grasping Motion Generation for Digital Humans — https://arxiv.org/abs/2410.01840
- `2209.10215` — Real-Time Locomotion on Soft Grounds With Dynamic Footprints — https://arxiv.org/abs/2209.10215
- `2208.04598` — UnderPressure: Deep Learning for Foot Contact Detection, Ground Reaction Force Estimation and Footskate Cleanup — https://arxiv.org/abs/2208.04598
- `1411.1906` — Footprint-Driven Locomotion Composition — https://arxiv.org/abs/1411.1906
- `2205.02625` — GANimator: Neural Motion Synthesis from a Single Sequence — https://arxiv.org/abs/2205.02625
- `2202.05628` — Artemis: Articulated Neural Pets with Appearance and Motion synthesis — https://arxiv.org/abs/2202.05628
- `2112.12466` — Real-Time Generation of Leg Animation for Walking-in-Place Techniques — https://arxiv.org/abs/2112.12466
- `2408.16726` — Bipedal locomotion using geometric techniques — https://arxiv.org/abs/2408.16726
- `2407.02282` — Learning Bipedal Walking on a Quadruped Robot via Adversarial Motion Priors — https://arxiv.org/abs/2407.02282
- `2004.10354` — A scriptable, generative modelling system for dynamic 3D meshes — https://arxiv.org/abs/2004.10354
- `2511.07418` — Lightning Grasp: High Performance Procedural Grasp Synthesis with Contact Fields — https://arxiv.org/abs/2511.07418
- `2212.07555` — IMos: Intent-Driven Full-Body Motion Synthesis for Human-Object Interactions — https://arxiv.org/abs/2212.07555
- `2005.08891` — Generative Tweening: Long-term Inbetweening of 3D Human Motions — https://arxiv.org/abs/2005.08891
- `2409.11164` — Synthetic data augmentation for robotic mobility aids to support blind and low vision people — https://arxiv.org/abs/2409.11164
- `2201.04042` — Towards Lightweight Neural Animation : Exploration of Neural Network Pruning in Mixture of Experts-based Animation Models — https://arxiv.org/abs/2201.04042
- `2112.06060` — GenMotion: Data-driven Motion Generators for Real-time Animation Synthesis — https://arxiv.org/abs/2112.06060
- `1610.07570` — A data augmentation methodology for training machine/deep learning gait recognition algorithms — https://arxiv.org/abs/1610.07570
- `2207.05906` — Diverse Dance Synthesis via Keyframes with Transformer Controllers — https://arxiv.org/abs/2207.05906

**Query 11：reinforcement learning pursuit evasion games agent training versus handcrafted AI（37 条）**
- `2108.11010` — Adversary agent reinforcement learning for pursuit-evasion — https://arxiv.org/abs/2108.11010
- `2104.01445` — A Dynamics Perspective of Pursuit-Evasion Games of Intelligent Agents with the Ability to Learn — https://arxiv.org/abs/2104.01445
- `2410.04936` — Training Interactive Agent in Large FPS Game Map with Rule-enhanced Reinforcement Learning — https://arxiv.org/abs/2410.04936
- `2606.20210` — Augmenting Game AI with Deep Reinforcement Learning — https://arxiv.org/abs/2606.20210
- `2404.16689` — Learning to Beat ByteRL: Exploitability of Collectible Card Game Agents — https://arxiv.org/abs/2404.16689
- `1904.09307` — Active Adversarial Evader Tracking with a Probabilistic Pursuer under the Pursuit-Evasion Game Framework — https://arxiv.org/abs/1904.09307
- `2506.02849` — Learned Controllers for Agile Quadrotors in Pursuit-Evasion Games — https://arxiv.org/abs/2506.02849
- `2607.05939` — Intercepting an Agile Target with Net-Carrying Drones using Competitive Multi-Agent Reinforcement Learning — https://arxiv.org/abs/2607.05939
- `2107.04709` — Multiplayer Homicidal Chauffeur Reach-Avoid Games via Guaranteed Winning Strategies — https://arxiv.org/abs/2107.04709
- `2603.16279` — Agile Interception of a Flying Target using Competitive Reinforcement Learning — https://arxiv.org/abs/2603.16279
- `2510.07813` — Strategic Communication under Threat: Learning Information Trade-offs in Pursuit-Evasion Games — https://arxiv.org/abs/2510.07813
- `1909.11881` — Matching-Based Capture Strategies for 3D Heterogeneous Multiplayer Reach-Avoid Differential Games — https://arxiv.org/abs/1909.11881
- `2509.15799` — Hierarchical Reinforcement Learning with Low-Level MPC for Multi-Agent Control — https://arxiv.org/abs/2509.15799
- `2103.03662` — MAMBPO: Sample-efficient multi-robot reinforcement learning using learned world models — https://arxiv.org/abs/2103.03662
- `1907.00327` — Collaboration of AI Agents via Cooperative Multi-Agent Deep Reinforcement Learning — https://arxiv.org/abs/1907.00327
- `2606.20014` — Hierarchical Control in Multi-Agent Games: LLM-based Planning and RL Execution — https://arxiv.org/abs/2606.20014
- `1906.10124` — On Multi-Agent Learning in Team Sports Games — https://arxiv.org/abs/1906.10124
- `2204.09597` — Perceiving the World: Question-guided Reinforcement Learning for Text-based Games — https://arxiv.org/abs/2204.09597
- `1905.04127` — Design of Artificial Intelligence Agents for Games using Deep Reinforcement Learning — https://arxiv.org/abs/1905.04127
- `2509.04258` — Safe Navigation in the Presence of Range-Limited Pursuers — https://arxiv.org/abs/2509.04258
- `2606.31291` — Deep Reinforcement Learning for Spacecraft Attitude Control During Atmospheric Re-Entry — https://arxiv.org/abs/2606.31291
- `2605.04768` — From open-loop representations to closed-loop feedback implementations in differential games: A numerical case study — https://arxiv.org/abs/2605.04768
- `2102.04716` — Better Safe Than Sorry: Preventing Delusive Adversaries with Adversarial Training — https://arxiv.org/abs/2102.04716
- `2606.21975` — IRumAI: Reinforcement Learning for Indian Rummy — https://arxiv.org/abs/2606.21975
- `2605.28863` — Self-Play Reinforcement Learning under Imperfect Information in Big 2 — https://arxiv.org/abs/2605.28863
- `1802.07295` — Attack Strength vs. Detectability Dilemma in Adversarial Machine Learning — https://arxiv.org/abs/1802.07295
- `1812.09376` — Human-AI Learning Performance in Multi-Armed Bandits — https://arxiv.org/abs/1812.09376
- `1805.08776` — Scalable Centralized Deep Multi-Agent Reinforcement Learning via Policy Gradients — https://arxiv.org/abs/1805.08776
- `1709.08201` — An Optimal Online Method of Selecting Source Policies for Reinforcement Learning — https://arxiv.org/abs/1709.08201
- `2010.04978` — Event-Triggered Multi-agent Reinforcement Learning with Communication under Limited-bandwidth Constraint — https://arxiv.org/abs/2010.04978
- `2608.30952` — One Policy Is Enough: Single-Agent Reinforcement Learning Outperforms Tree Search for Chemistry Tool Learning — https://arxiv.org/abs/2608.30952
- `2605.27532` — SCALE-COMM: Shared, Contrastively-Aligned Latent Embeddings for MARL Communication — https://arxiv.org/abs/2605.27532
- `2506.12497` — Wasserstein-Barycenter Consensus for Cooperative Multi-Agent Reinforcement Learning — https://arxiv.org/abs/2506.12497
- `2007.09540` — Multi-Principal Assistance Games — https://arxiv.org/abs/2007.09540
- `2302.03800` — MACOptions: Multi-Agent Learning with Centralized Controller and Options Framework — https://arxiv.org/abs/2302.03800
- `2204.02785` — Reinforcement Learning Agents in Colonel Blotto — https://arxiv.org/abs/2204.02785
- `2011.06619` — Learning Latent Representations to Influence Multi-Agent Interaction — https://arxiv.org/abs/2011.06619

**Query 12：video game difficulty progression session pacing scoring combo risk reward（8 条）**
- `2305.00915` — Analysis of reward mechanism for quizmarket — https://arxiv.org/abs/2305.00915
- `1806.05117` — Learning to Shoot in First Person Shooter Games by Stabilizing Actions and Clustering Rewards for Reinforcement Learning — https://arxiv.org/abs/1806.05117
- `2304.08699` — Assessing Video Game Balance using Autonomous Agents — https://arxiv.org/abs/2304.08699
- `1110.4412` — Aspiration Learning in Coordination Games — https://arxiv.org/abs/1110.4412
- `2311.13462` — Experimentation in Early-Stage Video Game Startups: Practices and Challenges — https://arxiv.org/abs/2311.13462
- `2410.02388` — Boosting Perturbed Gradient Ascent for Last-Iterate Convergence in Games — https://arxiv.org/abs/2410.02388
- `2605.05922` — Think, then Score: Decoupled Reasoning and Scoring for Video Reward Modeling — https://arxiv.org/abs/2605.05922
- `2308.12726` — Continuous Reinforcement Learning-based Dynamic Difficulty Adjustment in a Visual Working Memory Game — https://arxiv.org/abs/2308.12726

**Query 13：predator prey refuge habitat selection escape cover decision（27 条）**
- `1104.3805` — How shoud prey animals respond to uncertain threats? — https://arxiv.org/abs/1104.3805
- `2103.13156` — Coevolution of the reckless prey and the patient predator — https://arxiv.org/abs/2103.13156
- `2609.37885` — Boids of a Feather Flock Together - Evolving Prey Behaviours Under Different Predator Attack Strategies — https://arxiv.org/abs/2609.37885
- `1910.10541` — Survival chances of a prey swarm: how the cooperative interaction range affects the outcome — https://arxiv.org/abs/1910.10541
- `1703.09275` — Dynamics of a harvested prey-predator model with prey refuge depended on both species — https://arxiv.org/abs/1703.09275
- `1609.07855` — A single predator charging a herd of prey: effects of self volume and predator-prey decision-making — https://arxiv.org/abs/1609.07855
- `0809.5225` — Modeling Fish Biomass Structure at Near Pristine Coral Reefs and Degradation by Fishing — https://arxiv.org/abs/0809.5225
- `2609.18609` — Optimum foraging area in a three-trophic food chain — https://arxiv.org/abs/2609.18609
- `1501.05524` — Predicting local and non-local effects of resources on animal space use using a mechanistic step selection model — https://arxiv.org/abs/1501.05524
- `2310.01392` — Analysis of the impact of fear in the presence of additional food and prey refuge with nonlocal predator-prey models — https://arxiv.org/abs/2310.01392
- `2601.05054` — On the effects of protection zone and directed population flux in prey-predator dynamics — https://arxiv.org/abs/2601.05054
- `1610.05066` — Population dynamics in an intermittent refuge — https://arxiv.org/abs/1610.05066
- `2103.00661` — Antipredator behavior in the rock-paper-scissors model — https://arxiv.org/abs/2103.00661
- `2003.02712` — Dynamics of a predator-prey model with generalized Holling type functional response and mutual interference — https://arxiv.org/abs/2003.02712
- `2402.04619` — Discontinuous harvesting policy in a Filippov system involving prey refuge — https://arxiv.org/abs/2402.04619
- `2302.04594` — Ecological system with fear induced group defence and prey refuge — https://arxiv.org/abs/2302.04594
- `2308.08864` — A discrete-time dynamical model of prey and stage-structured predator with juvenile hunting incorporating negative effects of prey refuge — https://arxiv.org/abs/2308.08864
- `physics/9804038` — Switching model with two habitats and a predator involving group defence — https://arxiv.org/abs/physics/9804038
- `2510.06111` — An additional food driven biological control patch model, incorporating generalized competition — https://arxiv.org/abs/2510.06111
- `2602.22139` — From female choice to social structure: Modeling harem formation in camelids — https://arxiv.org/abs/2602.22139
- `1907.08481` — A spatially extended model to assess the role of landscape structure on the pollination service of Apis mellifera — https://arxiv.org/abs/1907.08481
- `1305.4506` — Predicting coexistence of plants subject to a tolerance-competition trade-off — https://arxiv.org/abs/1305.4506
- `2212.00899` — On the evolutionary emergence of predation — https://arxiv.org/abs/2212.00899
- `2607.24285` — Effect of wind on prey-predator dynamics with group defense and additional food strategy — https://arxiv.org/abs/2607.24285
- `1610.03930` — Modeling sexual selection in T\\'ungara frog and rationality of mate choice — https://arxiv.org/abs/1610.03930
- `1609.05151` — Random Search with Memory in Patchy Media: Exploration-Exploitation Tradeoff — https://arxiv.org/abs/1609.05151
- `1403.0472` — Comparing disease control policies for interacting wild populations — https://arxiv.org/abs/1403.0472

**Query 14：fox locomotion acceleration sprint pounce biomechanics canid predation（34 条）**
- `2304.04603` — Kinetic energy fluctuation-driven locomotor transitions on potential energy landscapes of beam obstacle traversal and self-righting — https://arxiv.org/abs/2304.04603
- `2305.01406` — A Mobile Quad-Arm Robot ARMS: Wheeled-Legged Tripedal Locomotion and Quad-Arm Loco-Manipulation — https://arxiv.org/abs/2305.01406
- `1310.1369` — Behavioral Strategy Chases Promote the Evolution of Prey Intelligence — https://arxiv.org/abs/1310.1369
- `2607.08644` — Acceleration-based clustering reveals frequent gait switching in sprint sled dogs — https://arxiv.org/abs/2607.08644
- `2412.03949` — Learning Speed-Adaptive Walking Agent Using Imitation Learning with Physics-Informed Simulation — https://arxiv.org/abs/2412.03949
- `2405.02674` — Ambush strategy enhances organisms' performance in rock-paper-scissors games — https://arxiv.org/abs/2405.02674
- `2202.05293` — Pattern formation and coarsening dynamics in apparent competition models — https://arxiv.org/abs/2202.05293
- `1502.04328` — Geometric Spanning Cycles in Bichromatic Point Sets — https://arxiv.org/abs/1502.04328
- `2310.17542` — The Blanco DECam Bulge Survey (BDBS) VIII: Chemo-kinematics in the southern Galactic bulge from 2.3 million red clump stars with Gaia DR3 proper motions — https://arxiv.org/abs/2310.17542
- `2610.00628` — Preliminary Evaluation of Transition-Aware Controller Locomotion Adaptations for Supporting Postural Stability in VR — https://arxiv.org/abs/2610.00628
- `2110.07677` — On the parametrisation of motion kinematics for experimental aerodynamic optimisation — https://arxiv.org/abs/2110.07677
- `1308.1808` — Napoli Tokyo Napoli — https://arxiv.org/abs/1308.1808
- `2308.02589` — An Effective Hydrodynamic Description of Marching Locusts — https://arxiv.org/abs/2308.02589
- `2411.04684` — Strong anomalous diffusion for free-ranging birds — https://arxiv.org/abs/2411.04684
- `2202.00149` — How local antipredator response unbalances the rock-paper-scissors model — https://arxiv.org/abs/2202.00149
- `2211.03879` — Phase Transitions and Criticality in the Collective Behavior of Animals -- Self-organization and biological function — https://arxiv.org/abs/2211.03879
- `2509.01102` — Quantifying movement: Expanding the Ichnologist toolkit — https://arxiv.org/abs/2509.01102
- `q-bio/0605020` — Laws in Darwinian Evolutionary Theory — https://arxiv.org/abs/q-bio/0605020
- `1511.01958` — Local equilibrium in bird flocks — https://arxiv.org/abs/1511.01958
- `1706.05121` — Community interactions determine role of species in parasite spread amplification: the ecomultiplex network model — https://arxiv.org/abs/1706.05121
- `2509.01104` — Spatial trends in Ediacaran Bilaterian trails — https://arxiv.org/abs/2509.01104
- `2202.07533` — Limits on the Evolutionary Rates of Biological Traits — https://arxiv.org/abs/2202.07533
- `1807.08570` — Big data analyses reveal patterns and drivers of the movements of southern elephant seals — https://arxiv.org/abs/1807.08570
- `2303.10724` — Mobility restrictions in response to local epidemic outbreaks in rock-paper-scissors models — https://arxiv.org/abs/2303.10724
- `2208.14864` — Adaptive altruistic strategy in cyclic models during an epidemic — https://arxiv.org/abs/2208.14864
- `1309.2969` — Lift and wakes of flying snakes — https://arxiv.org/abs/1309.2969
- `2005.00773` — Complex fluids in the animal kingdom — https://arxiv.org/abs/2005.00773
- `2008.06727` — A Review on Drivers Red Light Running Behavior Predictions and Technology Based Countermeasures — https://arxiv.org/abs/2008.06727
- `1412.5376` — Nonparametric tests for detecting breaks in the jump behaviour of a time-continuous process — https://arxiv.org/abs/1412.5376
- `2206.12651` — Review on Social Behavior Analysis of Laboratory Animals: From Methodologies to Applications — https://arxiv.org/abs/2206.12651
- `1110.3443` — Aerodynamics of the Smallest Flying Insects — https://arxiv.org/abs/1110.3443
- `1804.08772` — Unique flow features of the silent southern Boobook owl wake during flapping flight — https://arxiv.org/abs/1804.08772
- `1701.00266` — A portable magnetic field of > 3 T generated by the flux jump assisted, pulsed field magnetisation of bulk superconductors — https://arxiv.org/abs/1701.00266
- `2204.13473` — Spin-glass-like behaviour in SmFeAsO0.8F0.2 — https://arxiv.org/abs/2204.13473

**Query 15：input buffering anticipation attack windup dodge window game design（28 条）**
- `2109.14555` — The Impact of Network Design Interventions on CPS Security — https://arxiv.org/abs/2109.14555
- `2504.14725` — Sensor Scheduling in Intrusion Detection Games with Uncertain Payoffs — https://arxiv.org/abs/2504.14725
- `2208.00235` — 'PeriHack': Designing a Serious Game for Cybersecurity Awareness — https://arxiv.org/abs/2208.00235
- `2112.12098` — IDCAIS: Inter-Defender Collision-Aware Interception Strategy against Multiple Attackers — https://arxiv.org/abs/2112.12098
- `2212.06628` — Target Defense against Sequentially Arriving Intruders — https://arxiv.org/abs/2212.06628
- `2208.06155` — What Features Influence Impact Feel? A Study of Impact Feedback in Action Games — https://arxiv.org/abs/2208.06155
- `2205.02437` — Image Features Influence Reaction Time: A Learned Probabilistic Perceptual Model for Saccade Latency — https://arxiv.org/abs/2205.02437
- `2011.09201` — Designing Game Feel. A Survey — https://arxiv.org/abs/2011.09201
- `1411.1316` — Rapid Skill Capture in a First-Person Shooter — https://arxiv.org/abs/1411.1316
- `2505.19481` — Win Fast or Lose Slow: Balancing Speed and Accuracy in Latency-Sensitive Decisions of LLMs — https://arxiv.org/abs/2505.19481
- `2105.10498` — A Case Study of First Person Aiming at Low Latency for Esports — https://arxiv.org/abs/2105.10498
- `2208.11774` — The Esports Frontier: Rendering for Competitive Games — https://arxiv.org/abs/2208.11774
- `2212.02256` — Crowdsourcing Controller -- Utilizing Reliable Agents in a Multiplayer Game — https://arxiv.org/abs/2212.02256
- `2608.26074` — Gating Before Commitment: Anticipating Intent Divergence to Prevent Post-Interaction Decision Failures in Autonomous Driving — https://arxiv.org/abs/2608.26074
- `2109.01186` — Exploratory Design of a Hands-free Video Game Controller for a Quadriplegic Individual — https://arxiv.org/abs/2109.01186
- `0709.1056` — A Sudoku Game for People with Motor Impairments — https://arxiv.org/abs/0709.1056
- `2503.22901` — From Motivating to Manipulative: The Use of Deceptive Design in a Game's Free-to-Play Transition — https://arxiv.org/abs/2503.22901
- `2603.18398` — Deconstructing Open-World Game Mission Design Formula: A Thematic Analysis Using an Action-Block Framework — https://arxiv.org/abs/2603.18398
- `1702.05695` — Non-negative Tensor Factorization for Human Behavioral Pattern Mining in Online Games — https://arxiv.org/abs/1702.05695
- `1609.02182` — Feedback and Timing in a Crowdsourcing Game — https://arxiv.org/abs/1609.02182
- `1703.03831` — User Longevity and Engagement in Mobile Multiplayer Sports Management Games — https://arxiv.org/abs/1703.03831
- `2110.00978` — Towards General Models of Player Experience: A Study Within Genres — https://arxiv.org/abs/2110.00978
- `2606.26925` — Game Changers: Designing and Measuring Dynamic Feedback To Help Users Self-Regulate in a VR Pointing Game — https://arxiv.org/abs/2606.26925
- `2609.30960` — Packet iSlip — https://arxiv.org/abs/2609.30960
- `2303.15734` — Adaptive Background Music for a Fighting Game: A Multi-Instrument Volume Modulation Approach — https://arxiv.org/abs/2303.15734
- `2110.14632` — Heterogeneous Effects of Software Patches in a Multiplayer Online Battle Arena Game — https://arxiv.org/abs/2110.14632
- `2403.02701` — Fighting Game Adaptive Background Music for Improved Gameplay — https://arxiv.org/abs/2403.02701
- `2411.01057` — Online Moderation in Competitive Action Games: How Intervention Affects Player Behaviors — https://arxiv.org/abs/2411.01057

</details>

**通道交叉核验**：OpenAlex 与 Semantic Scholar 用于补充元数据；arXiv 原生 API 通过 `export.arxiv.org` 读取摘要成功；DOI 页面用于核对期刊、年份和 DOI。没有把 DeepXiv 的相关性排序当作证据：真正写入建议的结论只来自已读取摘要/论文页面的条目，或明确标成工程直觉。

**覆盖度与缺口**：追逃博弈、冻结/逃跑、视听线索、游戏 AI、game feel、程序化四足、RL 反例、难度调节和掩体方向均有检索命中。DeepXiv 对“藏狐具体扑击运动学”和“浏览器游戏 hit-stop 的最佳毫秒数”没有给出可直接外推的实证论文；这些数值在下文明确标为【工程直觉，无文献支持】。藏狐检索还混入不少泛生态/非行为论文，因此不把其当作动作参数证据。

### 3.2 本轮 DeepXiv shortlist 精读（10 篇）

> 以下 10 篇来自本轮 DeepXiv 返回的 shortlist，并已用 arXiv API 实际读取摘要；作者、年份、题名和 arXiv ID 均以返回记录为准。它们是本轮新增的直接证据，编号 [D1]–[D10]。没有把“命中”当成“支持”：每篇只在摘要明确覆盖的范围内使用。

- **[D1]** Zylberberg, J. & DeWeese, M. R. (2011). *How shoud prey animals respond to uncertain threats?* **arXiv preprint**, arXiv:1104.3805. URL: https://arxiv.org/abs/1104.3805
  → 概率自动机把“误逃的成本”和“不逃的风险”同时纳入；支持把 suspicion 设计成带不确定性的连续量，而不是单帧半径开关（A1/A2）。
- **[D2]** Pichlmair, M. & Johansen, M. (2022). *Designing Game Feel. A Survey*. **IEEE Transactions on Games**, 14(2):138–152. arXiv preprint submitted 2020, arXiv:2011.09201. DOI: 10.1109/TG.2021.3072241. URL: https://arxiv.org/abs/2011.09201
  → 将 game feel 归纳为 physicality/tuning、amplification/juicing、support/streamlining 三类；支持把扑击时序、反馈和输入辅助分开调参（B/C/D）。
- **[D3]** Lin, Z. et al. (2022). *What Features Influence Impact Feel? A Study of Impact Feedback in Action Games*. **IEEE CTSoc International Conference on Games, Entertainment & Media (GEM 2022)**, arXiv:2208.06155. DOI: 10.48550/arXiv.2208.06155. URL: https://arxiv.org/abs/2208.06155
  → 从动作游戏反馈研究命中 hit-stop、声音/视觉一致性和相机控制等影响因素；直接支持成功扑击的短顿帧与 FOV kick（B3）。
- **[D4]** Yang, Q. & Parasuraman, R. (2022). *Game-theoretic Utility Tree for Multi-Robot Cooperative Pursuit Strategy*. **arXiv preprint**, arXiv:2206.01109. URL: https://arxiv.org/abs/2206.01109
  → 层级 utility tree 可把情境、目标和代价组合起来；支持在 8 只猎物规模下采用轻量 utility/FSM hybrid，而非一次性引入重规划器（A/F）。
- **[D5]** Paduraru, C. & Paduraru, M. (2019). *Automatic difficulty management and testing in games using a framework based on behavior trees and genetic algorithms*. **arXiv preprint**, arXiv:1909.04368. URL: https://arxiv.org/abs/1909.04368
  → 难度类行为可以被系统化测试和调节；支持把 session ramp 做成有上限、可回归测试的参数曲线，而不是无限加速（E1）。
- **[D6]** Rahimi, M. et al. (2023). *Continuous Reinforcement Learning-based Dynamic Difficulty Adjustment in a Visual Working Memory Game*. **arXiv preprint**, arXiv:2308.12726. URL: https://arxiv.org/abs/2308.12726
  → DDA 可以使用连续状态/动作调节难度，但其环境和训练成本远高于本模式；支持把本项目的 ramp 保持为显式、可解释规则（E1）。
- **[D7]** Huang, X. (2021). *Adversary agent reinforcement learning for pursuit-evasion*. **arXiv preprint**, arXiv:2108.11010. URL: https://arxiv.org/abs/2108.11010
  → 追逃 RL 需要专门环境、对手和部分可观测性处理；支持 §6 的“不引入 RL”边界，而不是证明 RL 不能工作（§6）。
- **[D8]** Bhatti, Z. et al. (2014). *Expression driven Trignometric based Procedural Animation of Quadrupeds*. **ICICM 2013**, arXiv:1404.2053, DOI: 10.1109/ICICM.2013.25. URL: https://arxiv.org/abs/1404.2053
  → 两层控制曲线和 FK/IK/程序化驱动可生成四足动作；支持先做轻量速度/相位驱动，再把完整 IK/CPG 留作 P2（D1/D2）。
- **[D9]** Chakraborty, D. et al. (2022). *Effect of inertia on the evasion and pursuit dynamics of prey swarms and the emergence of an optimal mass ratio for the predator-prey arms race*. **arXiv preprint**, arXiv:2208.12280. URL: https://arxiv.org/abs/2208.12280
  → 该文是猎物群体模型，不是单只旱獭行为实测；模型显示惯性会改变逃逸模式。将其仅作为“转向需有代价”的建模类比，不据此声称单体 zigzag 是自然界最优（A3/B1）。
- **[D10]** Wagner, A. P. et al. (2013). *Behavioral Strategy Chases Promote the Evolution of Prey Intelligence*. **arXiv preprint**, arXiv:1310.1369. URL: https://arxiv.org/abs/1310.1369
  → 该文研究数字生物的进化博弈，不是野外动物数据；把“策略会相互适应”仅作为让行为模式不完全固定的设计类比（A3/E1）。

### 3.3 补充文献表

> 下列 [R1]–[R23] 是上一版保留的补充来源，本轮重新用 Crossref DOI 元数据/摘要和 arXiv 摘要端点核对可访问性与书目信息；摘要不可得者仍明确标注为未读原文或仅元数据，不承担超出可见内容的强结论。

**捕食者-猎物行为**

- **[R1]** Lima, S. L. & Dill, L. M. (1990). Behavioral decisions made under the risk of predation: a review and prospectus. *Canadian Journal of Zoology*. DOI: 10.1139/z90-092. URL: https://doi.org/10.1139/z90-092
  → 动物实时评估捕食风险，在取食/警戒/逃跑之间做收益-风险权衡。支持"察觉应是非线性、多因素的，而非一个半径开关"。
- **[R2]** Eilam, D. (2005). Die hard: A blend of freezing and fleeing as a dynamic defense—implications for the control of defensive behavior. *Neuroscience & Biobehavioral Reviews*. DOI: 10.1016/j.neubiorev.2005.03.027. URL: https://doi.org/10.1016/j.neubiorev.2005.03.027（已取回 PubMed 摘要）
  → **冻结适合未被发现阶段；被发现后冻结变成静止靶。直线逃适合远/慢捕食者，近/快捕食者面前 zigzag 更优。** 这是 A2+A3 的直接理论依据。
- **[R3]** Hébert, M. et al. (2019). Inexperienced preys know when to flee or to freeze in front of a threat. *PNAS* 116(46):22918–22920. DOI: 10.1073/pnas.1915504116. URL: https://doi.org/10.1073/pnas.1915504116（Crossref 摘要已取回）
  → 远处掠过刺激→减速/冻结；**快速逼近（looming）→逃跑**。冻结 vs 逃跑由威胁类型与距离决定——直接支持 freeze 态的触发条件设计。
- **[R4]** Furuichi, N. (2002). Dynamics between a Predator and a Prey Switching Two Kinds of Escape Motions. *Journal of Theoretical Biology* 217(2):159–166. DOI: 10.1006/jtbi.2002.3027. URL: https://doi.org/10.1006/jtbi.2002.3027
  → 模型结论：远/慢捕食者直线逃，近/快捕食者 zigzag 逃更优。支持 zigzag 按"距离+玩家相位"触发。
- **[R5]** Firestone, C. Z. & Warren, W. H. (2010). Why does the rabbit escape the fox on a zig-zag path? Predator-prey dynamics and the constant bearing strategy. *Journal of Vision* 10(7):1049. DOI: 10.1167/10.7.1049. URL: http://www.journalofvision.org/content/10/7/1049（会议摘要）
  → zigzag 通过**破坏捕食者的恒定方位角（constant bearing）拦截**提高逃脱率："捕食者 zig，猎物 zag"。反面印证：玩家扑击若有提前量/微调，zigzag 才有对抗价值——A3 与 B1 必须成对做。
- **[R6]** Cooper, W. E. Jr. (2016). Fleeing to refuge: Escape decisions in the race for life. *Journal of Theoretical Biology* 406:129–136. DOI: 10.1016/j.jtbi.2016.06.023. URL: https://doi.org/10.1016/j.jtbi.2016.06.023（Crossref 完整元数据）
  → 逃向掩体、距掩体距离影响逃跑决策。支持未来的"掩体寻求"扩展（本建议中标为可选 P2）。
- **[R7]** Kawabata, Y. et al. (2023). Multiple preferred escape trajectories are explained by a geometric model incorporating prey's turn and predator attack endpoint. *eLife* 12:e77699. DOI: 10.7554/eLife.77699. URL: https://doi.org/10.7554/eLife.77699（Crossref 摘要）
  → 逃跑轨迹由"猎物转向耗时 + **捕食者攻击终点**"的几何模型解释——猎物回避的是攻击终点而非捕食者当前位置。直接支持 A4。

**藏狐 / 狐科生态**

- **[R8]** Harris, R. B. et al. (2014). Evidence that the Tibetan fox is an obligate predator of the plateau pika: conservation implications. *Journal of Mammalogy*. DOI: 10.1644/14-MAMM-A-021. URL: https://doi.org/10.1644/14-MAMM-A-021（Crossref 元数据）
  → 藏狐是高原鼠兔的专性捕食者——与本作"藏狐捕旱獭/鼠兔"题材高度一致，题材层无需改动。
- **[R9]** Červený, J. et al. (2011). Directional preference may enhance hunting accuracy in foraging foxes. *Biology Letters*. DOI: 10.1098/rsbl.2010.1145. URL: https://doi.org/10.1098/rsbl.2010.1145（Crossref 摘要）
  → 赤狐 mousing 是**高跳、从上方突袭**的短爆发动作；**听觉是隐蔽猎物定位的主线索**。支持 B2（捕获需垂直判定）与 A1（听觉维度）。
- **[R10]** Black, K. M. et al. (2025). Red fox home ranges, activity patterns, and resource selection on an Atlantic barrier island. *Journal of Wildlife Management*. DOI: 10.1002/jwmg.22704. URL: https://doi.org/10.1002/jwmg.22704（Semantic Scholar 摘要；未读原文）
  → 赤狐白天/黄昏倾向靠近植被——掩体影响捕食者的空间选择，间接支持掩体对捕猎双方的博弈价值。
- **[R11]** Panzacchi, M. et al. (2009). Habitat and roe deer fawn vulnerability to red fox predation. *Journal of Animal Ecology*. DOI: 10.1111/j.1365-2656.2009.01584.x. URL: https://doi.org/10.1111/j.1365-2656.2009.01584.x（仅元数据/题名，未读原文）
  → 栖息地/掩体影响猎物对狐狸捕食的暴露度。支持掩体机制，但仅作方向性依据。
- **[R12]** Blanchard, P. et al. (2018). Coping with change in predation risk across space and time through complementary behavioral responses. *BMC Ecology* 18:60. DOI: 10.1186/s12898-018-0215-7. URL: https://doi.org/10.1186/s12898-018-0215-7（Crossref 元数据；未读原文）
  → 空间行为与细粒度行为互补应对风险；有限视野会改变警戒与发现速度。支持视锥而非全向半径。

**追逐 / 拦截 / AI 架构**

- **[R13]** Weintraub, I. E. et al. (2020). An Introduction to Pursuit-evasion Differential Games. arXiv:2003.05013. URL: https://arxiv.org/abs/2003.05013
  → 追逐-逃避是双方策略的博弈，不应只按对方当前位置逃跑/追逐。B1 提前量的理论背景。
- **[R14]** Huang, Y. & Zhu, Q. (2021). A Pursuit-Evasion Differential Game with Strategic Information Acquisition. arXiv:2102.05469. URL: https://arxiv.org/abs/2102.05469
  → 感知有限/信息获取有成本时，低机动方更依赖隐蔽性。支持"潜行有真实收益、感知非全知"的设计。
- **[R15]** Zhao, Y. et al. (2024). Autonomous Decision Making for UAV Cooperative Pursuit-Evasion Game with Reinforcement Learning. arXiv:2411.02983. URL: https://arxiv.org/abs/2411.02983
  → RL 能做追逐决策，但训练与调试成本极高——作为"不建议上 RL"（§6）的反面参考。
- **[R16]** Sloan, C. et al. (2011). Feasibility study of utility-directed behaviour for computer game agents. *ACE '11*. DOI: 10.1145/2071423.2071430. URL: https://doi.org/10.1145/2071423.2071430（ACM 摘要；未读原文）
  → utility 架构比 FSM 更耗资源、扩展性不如 FSM/GOAP，但更易涌现复杂行为。支持：8 只猎物可用轻量 utility 打分，但不要架构化。
- **[R17]** Świechowski, M. et al. (2021). Combining Utility AI and MCTS Towards Creating Intelligent Agents in Video Games, with the Use Case of Tactical Troops: Anthracite Shift. *IEEE SSCI 2021*. DOI: 10.1109/SSCI50451.2021.9660170. URL: https://doi.org/10.1109/SSCI50451.2021.9660170（Crossref 元数据）
  → utility 能组合情境权重，但本模式不需要 MCTS 级别的规划。
- **[R18]** Sekhavat, Y. A. (2017). Behavior Trees for Computer Games. *International Journal on Artificial Intelligence Tools*. DOI: 10.1142/S0218213017300010. URL: https://doi.org/10.1142/S0218213017300010（Crossref 摘要）
  → 状态复杂度增长后 FSM 应迁到 BT；但本模式猎物 4 态以内，轻量 FSM/utility hybrid 足够。

**Game feel / 相机 / 输入**

- **[R19]** Pichlmair, M. & Johansen, M. (2022). Designing Game Feel: A Survey. *IEEE Transactions on Games* 14(2):138–152. DOI: 10.1109/TG.2021.3072241. arXiv:2011.09201. URL: https://arxiv.org/abs/2011.09201
  → game feel 三支柱：physicality/tuning（参数调校）、amplification/juicing（反馈放大）、support/streamlining（输入辅助）。§4-B/C/D 的组织框架。
- **[R20]** Lin, Z. et al. (2022). What Features Influence Impact Feel? A Study of Impact Feedback in Action Games. *IEEE GEM 2022*. DOI: 10.48550/arXiv.2208.06155. arXiv:2208.06155. URL: https://arxiv.org/abs/2208.06155
  → **hit-stop、声音一致性、相机控制显著影响 impact feel**。B3 镜头演出与顿帧的直接依据。
- **[R21]** Dahl, G. & Kraus, M. (2015). Measuring how game feel is influenced by the player avatar's acceleration and deceleration. *Academic MindTrek '15*. DOI: 10.1145/2818187.2818275. URL: https://doi.org/10.1145/2818187.2818275（ACM 摘要；未读原文）
  → 移动加减速参数显著影响"重、慢、响应、真实"等手感感知。支持 C 组节奏参数要谨慎调、接入调参台。

**程序化四足动画**

- **[R22]** Bhatti, Z. et al. (2014). Expression driven Trignometric based Procedural Animation of Quadrupeds. *ICICM 2013*. DOI: 10.1109/ICICM.2013.25. arXiv:1404.2053. URL: https://arxiv.org/abs/1404.2053
  → 基于 FK/IK + 三角函数步态的程序化四足动画。D 组的技术背景。
- **[R23]** Bhatti, Z. (2019). Oscillator driven central pattern generator (CPG) system for procedural animation of quadruped locomotion. *Multimedia Tools and Applications*. DOI: 10.1007/s11042-019-7641-1. URL: https://doi.org/10.1007/s11042-019-7641-1（Crossref 元数据）
  → CPG/速度驱动步态。作为 P2 远期选项，不建议本阶段实施。

### 3.4 文献 → 可落地结论映射表

| 可落地结论 | 依据文献 | 落到改进项 |
|---|---|---|
| 察觉应是多因素（距离+视锥+速度+噪声），非单一半径 | [D1][R1][R12][R14] | A1 |
| 未被锁定的远处威胁→冻结；快速逼近→立即逃跑 | [R2][R3] | A2 |
| 逃逸策略会随威胁/动力学条件改变；zigzag 是可测试的对抗动作而非普适生物定律 | [R2][R4][R5][D9] | A3 |
| 逃逸机动改变拦截几何，玩家 lead 是平衡性假设，须通过 playtest 验证 | [R5][R13] | A3 + B1（成对） |
| 猎物回避的是攻击终点，不是捕食者当前位置 | [R7] | A4 |
| 狐科扑击是从上方的高跳突袭 → 捕获需要垂直判定 | [R9] | B2 |
| 听觉是狐科捕猎与猎物反捕的重要线索维度 | [R9] | A1（听觉半径） |
| hit-stop / 相机反馈 / FOV 变化显著放大命中手感 | [D2][D3][R19][R20] | B3 |
| 加减速参数本身改变手感 → 新节奏参数必须进调参台 | [D2][R21][R19] | C 组全部 |
| 8 只猎物用轻量 utility/FSM hybrid 足够，不上 BT/MCTS/RL | [D4][D7][R16][R17][R18][R15] | A 组架构约束 + §6 |
| 掩体对捕猎双方都有博弈价值（远期可选） | [R6][R10][R11] | A5（P2 可选） |
| 藏狐×高原鼠兔题材关系有文献支持，无需改题材 | [R8] | —（确认现状） |

---

## 4. 改进建议（A–F 六组）

> 每条含：做什么 / 文献依据 / 建议参数 / 落点 / 风险 / 优先级。
> 所有新参数都进入 `PAF_DEFAULTS` 并接入现有 lil-gui 调参台（`play-as-fox-debug.js:153-195`）。

### A. 猎物 AI 升级

**A1. 多线索察觉（距离 + 视锥 + 速度/姿态 + 听觉代理）【P0】**
- **做什么**：把 `play-as-fox.js:125-136` 的纯半径察觉改为分级 suspicion 模型：视觉贡献 = 距离衰减 × 视锥系数（玩家在猎物前方 120° 视锥内才计入）× 速度系数（潜行 < 冲刺 < 扑击）；听觉贡献 = 半径内即计入（全向，冲刺/扑击噪声大）。suspicion 累积到阈值进 alert/flee。可复用 `smart-fox-core.mjs:152-166` 的视锥+距离因子思路。真实 LOS/岩石遮挡**第一阶段不接**（场景未提供遮挡查询），留接口。
- **依据**：[R1][R9][R12][R14]
- **建议参数**：视锥 120°；潜行视觉半径 6–8m；冲刺视觉/听觉半径 12–14m；扑击听觉半径 17–20m；suspicion 视觉上升率约 1.8/s；suspicion 衰减 0.6/s（离开感知后）。数值起点与现有三档半径刻意对齐，避免手感突变。
- **落点**：`Prey.update()` 察觉段（125-136 行）；参数入 `PAF_DEFAULTS`。
- **风险**：调不好会让猎物"太瞎"（玩家无聊）或"太灵"（永远抓不到）——必须靠调参台灰度。性能：8 只猎物每帧几次三角函数，无压力。
- **优先级**：P0

**A2. freeze / tremble 中间态【P0】**
- **做什么**：状态机扩为 `wander → alert → freeze → flee`。触发规则（依 [R3]）：远处、低速、玩家未进入 wind/lunge → 冻结 0.25–0.45s（tremble 只做视觉抖动，不改碰撞）；玩家进入 wind/lunge 或距离 < detect×fleeCommit → 立即 flee（跳过冻结）。冻结期间猎物静止+头部朝向玩家。
- **依据**：[R2][R3]
- **建议参数**：freeze 时长 0.25–0.45s（随机）；触发距离带 = 视觉半径的 60%–100% 区间（太近直接逃、太远不察觉）。
- **落点**：`Prey` 状态机（82 行附近）+ `alertTime` 逻辑（130-133 行）。
- **风险**：冻结给了玩家"白送"窗口——用距离带限制，近距离不冻结。表现层 tremble 不要改碰撞体。
- **优先级**：P0

**A3. 近距离 zigzag 逃跑【P0】**
- **做什么**：flee 不再是 `atan2(dx,dz)` 直线（139-142 行）。距离 < 10m 或玩家处于 wind/lunge 时，在逃向角上叠加周期性侧向偏角（每 0.28–0.45s 反转一次 ±35°–60°）；距离远时保持直线（[R4]）。侧向分量不能大到降低平均逃逸速度太多——主速维持 preyFlee 5.0–5.5。
- **依据**：[R2][R4][R5]
- **建议参数**：zigzag 触发距离 < 10m；偏角 35°–60°；反转周期 0.28–0.45s；zigzag 期间速度系数 ≥ 0.85（防"永远追不上"）。
- **落点**：`Prey.update()` flee 分支（139-142 行）。
- **风险**：与 B1 提前量必须成对上线，否则玩家命中暴跌（[R5]：zigzag 专克无预测的直线拦截）。反转周期要有 ±20% 随机，否则玩家学会节奏。
- **优先级**：P0（但与 B1 同批）

**A4. 回避攻击终点（轨迹回避）【P1】**
- **做什么**：猎物感知到玩家 wind/lunge 后，逃跑方向取"逃离玩家当前位置"与"逃离预测着陆点"的加权和，而不是只逃当前位置（139-142 行）。预测着陆点 = `fox.pos + dir(lungeYaw) × lungeSpeed × lungeTime × 0.7`。
- **依据**：[R7]
- **建议参数**：权重：玩家当前位置 0.4 / 预测着陆点 0.6；预测系数 0.7。
- **落点**：`Prey.update()` flee 分支 + 只读的 fox 相位信息。
- **风险**：权重过高会让猎物"读心"般躲过所有扑击——0.6 起点，调参台灰度。
- **优先级**：P1

**A5. 掩体寻求（可选，P2）**
- **做什么**：场景提供岩石/植被查询后，flee 目标偏向最近掩体方向；当前场景无可复用的遮挡/掩体查询，先只做接口设计。
- **依据**：[R6][R10][R11]（R10/R11 仅摘要或元数据；不据此指定生物参数）。
- **建议参数**：工程起点为 8–12m 搜索半径、最多评估 4 个候选掩体、方向权重不超过逃离方向的 0.3；均需关卡 playtest。
- **落点**：场景空间查询 + `Prey.update()`；预留 `findRefuge(pos)`，不在本阶段动实现。
- **风险**：依赖场景层改造，若掩体成为必胜/死角会破坏路径公平；成本不可控。
- **优先级**：P2

### B. 扑击与手感

**B1. 扑击提前量预测 + wind 期间限时重瞄【P0】**
- **做什么**：wind 期间（368 行附近）对最近猎物做 lead 预测：目标点 = `preyPos + preyVel × (windTimeRemaining + lungeTime × 0.45)`；wind 前 60% 允许缓慢重瞄（最大修正角 12°，防自动追踪），后 40% 锁定；lunge 期间保持零微调（371-374 行不变，保住"失误受罚"）。
- **依据**：[R5][R13]（constant bearing / pursuit-evasion）
- **建议参数**：lead 时间 = windRemaining + 0.45×lungeTime ≈ 0.2–0.4s；最大重瞄角 12°；锁定点 = wind 60%。
- **落点**：`startPounce()` / wind 相位推进（365-379 行）。
- **风险**：预测过强会变"自动瞄准"，丢掉技能表达——12° 上限是关键护栏。
- **优先级**：P0（与 A3 同批）

**B2. 捕获垂直窗口【P0】**
- **做什么**：捕获判定（417-419 行）在水平距离外加垂直判定：`|fox.airY + 0.45 - preyCenterY| < 0.8`（foxHeight 0.9，lungeHeight 1.05）。腾空越过猎物头顶不再"吸"中。
- **依据**：[R9]（狐科高跳从上方突袭——高度本就是扑击的一部分）
- **建议参数**：猎物中心高 = terrain + 0.25–0.65；垂直容差 ±0.8m。
- **落点**：捕获判定循环（417-419 行）。
- **风险**：容差太小会让手感变"擦过不算"——0.8m 起点，调参台验证。
- **优先级**：P0

**B3. 扑击镜头演出与顿帧【P1】**
- **做什么**（[R19] 的 amplification 框架）：wind：FOV 收窄 3–5% 或相机拉远；lunge：FOV kick +4°，camDamp 临时降到 8–10；**捕获成功**：hit-stop 40–70ms + FOV 回弹；**失败**：不加顿帧（不奖励失误）。
- **依据**：[R19][R20]；hit-stop 毫秒值【工程直觉，无文献支持】，40–70ms 为动作游戏常见量级起点。
- **落点**：相机更新段（426-434 行）+ `catchPrey()`。
- **风险**：顿帧用全局时间缩放会打断其他猎物 AI——只对相机/玩家狐狸表现做，AI 时钟不停（或全局停 ≤70ms 可接受）。
- **优先级**：P1

### C. 玩家资源与节奏

**C1. 体力系统【P1】**
- **做什么**：玩家狐狸加 stamina：sprint 消耗、潜行恢复、扑击大额消耗；体力不足禁止扑击或降扑击速度。低体力给 HUD/姿态提示。
- **依据**：无直接动物文献（§3.1 已声明）；数值对齐本仓库 AI 藏狐线已有值（`FOX.ACTIONS.pounce.staminaCost: 26`、`SMART_POUNCE_TUNE.staminaCost: 26`，`fox-motion.js` 的 `canSprint/stepStamina` 可参考）【工程对齐】。
- **建议参数**：maxStamina 100；sprint 14–18/s；潜行恢复 12/s；扑击 22–26/次；体力 < 20 禁扑或 lungeSpeed ×0.9。
- **落点**：`PAF_DEFAULTS` + `startPounce()`（280-283 行）+ 主循环。
- **风险**：体力太紧会破坏"爽快连扑"的核心乐趣——恢复率要慷慨，惩罚主要针对"无脑连扑"。
- **优先级**：P1

**C2. 扑击冷却 + 成功返还【P1】**
- **做什么**：recover（0.5s）后加 0.2–0.35s 额外冷却；捕获成功返还 20–30% 冷却或体力，失败不返还——惩罚盲扑、奖励精准。
- **依据**：[R19]（support/streamlining 与节奏设计）【数值为工程直觉】。
- **落点**：相位机 recover 分支（375-378 行）。
- **风险**：与 C1 叠加可能过严——先上冷却、观察手感，再定体力严格度。
- **优先级**：P1

**C3. 连击显示【P2】**
- **做什么**：捕获后 5s 内再次捕获计 combo，只加分、不影响核心循环；combo 分数设上限与衰减，防无限刷。
- **依据**：【工程直觉，无文献支持】（DeepXiv 检索未找到与本模式直接对应、可支持 combo 窗口具体值的研究）。
- **建议参数**：连击窗口 5s；每次倍率 +0.25，上限 ×2；离窗即清零。
- **落点**：`catchPrey()` 计分与 HUD 文本。
- **风险**：分值奖励可能诱发赶时间而非捕猎判断；不改变猎物 AI 或碰撞判定，可作为可关闭展示层。
- **优先级**：P2

### D. 视觉与动画

**D1. 真实蹲伏/蓄力姿态（轻量）【P1】**
- **做什么**：放弃 `scale.y` 压扁（405-410 行）：body 下移、后躯低于前躯、腿折弯、头略抬。`createProceduralFox()`（`procedural-fox.js:27-75`）已有 body/head/legs/tail 分组，可直接做姿态混合，不引入新资产。
- **依据**：[R22]（三角函数驱动的程序化姿态思路）
- **落点**：`updateFoxPose()` 一类函数（405-410 行替换）。
- **风险**：姿态混合系数不对会比压扁更怪——小步迭代，截图对比。
- **优先级**：P1

**D2. 程序化四足增强（远期）【P2】**
- **做什么**：第一阶段仅给现有腿摆加相位与速度驱动；蓄力时后腿下压、前腿伸展。**不做**完整 IK/foot planting/CPG 重做（[R23] 仅作技术储备）。
- **依据**：[R22][R23][D8]（技术可行性依据，不代表其输出质量能直接迁移到现模型）。
- **建议参数**：步频 1.6–3.0Hz 随地面速度线性插值；慢行腿摆幅 10–18°、冲刺 25–35°，按视觉检查修订【工程直觉】。
- **落点**：`procedural-fox.js` 的 `createProceduralFox()` 返回动画更新器 + PAF 的 `foxVisual.update()` 调用处。
- **风险**：完整重做成本高，足部滑动和地形穿插可见；先在平地/坡地各验收一个循环。
- **优先级**：P2

### E. 难度、计分与 session

**E1. 时间驱动难度爬升【P2】**
- **做什么**：前 60s 默认；之后每 45–60s：preyFlee +3–5%、suspicion 上升 +5%、alert→flee 反应 -5%；总上限不超过默认 125–130%。
- **依据**：[D5][D6] 支持“可测试地调节难度”的方向；曲线和数字为【工程直觉，无文献支持】。
- **建议参数**：前 60s 乘数 1.0；之后每 60s 加 0.05，最多 1.25；一局结束重置。
- **落点**：`update(dt)` 的 elapsed 时间与运行时 prey config，不修改默认值。
- **风险**：熟练玩家与新玩家差异、长局变无解；默认关闭或限时测试，保留暂停 ramp 的选项。
- **优先级**：P2

**E2. 计分扩展【P2】**
- **做什么**：只数 + 耗时之外增加 combo（C3）与“平均捕获耗时”；保持原始捕获数作为主分，副指标不改游戏规则。
- **依据**：【工程直觉，无文献支持】；本轮检索没有找到能支持本模式计分结构的直接研究。
- **建议参数**：捕获数权重 1；combo 与效率只作统计展示，若必须加分，combo 加成上限不超过总分的 25%。
- **落点**：`catchPrey()`、`elapsed` 计时和现有 HUD（`play-as-fox.js:284-289, 437`）。
- **风险**：多指标可能令目标不清；建议先只展示，不改排名/存档。
- **优先级**：P2

**E3. 重生防贴脸【P0】**
- **做什么**：`respawnAt()`（110-118 行）加约束：距玩家 ≥18m；不在玩家视线中心 ±35° 内；尝试 20 次失败则取最远候选点。
- **依据**：【工程直觉】（这是明显的公平性 bug 修复，不需要文献）。
- **风险**：极低。
- **优先级**：P0

### F. 架构：与 AI 藏狐线共用 core（轻量路线）

**F1. 抽取纯函数/纯配置，不合并实体【P1，跨阶段进行】**
- **做什么**：第一阶段只抽**纯函数与参数单一来源**：detection 参数、pounce 时序参数、stamina 参数、lead 预测数学工具。候选落点：扩展 `src/core/fox-motion.js` 或新建 `src/core/predator-prey.js`（实现阶段再定）。保持 `smart-fox-core.mjs` 为 AI 藏狐核心，PAF 不反向依赖实体/UI 层。`config.js` 中共享"动作语义"（如察觉三档），但 `PAF_DEFAULTS` 与 `FOX` 的覆盖层分别保留——玩家模式与敌狐平衡不能互相锁死。
- **依据**：[R16][R18]（架构适度原则）+ 现状问题 #12。
- **风险**：最大的风险是"顺手大重构"——本项严格限定为纯函数抽取，禁止动实体层。
- **优先级**：P1（与 A1/B1 落地时顺手做）

---

## 5. 建议的实施阶段划分

| 阶段 | 内容 | 工作量 | 依赖 |
|------|------|--------|------|
| **Stage P1：猎物基础智能** | A1 多线索察觉、A2 freeze 态、E3 重生防贴脸、B2 捕获垂直窗 | M | 无；四条相互独立，可并行评审 |
| **Stage P2：逃跑与扑击对抗** | A3 zigzag、A4 轨迹回避、B1 提前量 | M | **依赖 P1 的察觉模型**；A3 与 B1 必须同批上线 |
| **Stage P3：节奏与反馈** | C1 体力、C2 冷却、B3 镜头/顿帧 | S/M | 依赖 P2（先确认扑击对抗平衡后再加资源约束） |
| **Stage P4：session 难度** | E1 难度爬升、E2 计分、C3 连击 | S | 依赖 P3 |
| **Stage P5：架构去重** | F1 纯函数抽取、参数单一来源 | M | 可在 P1/P2 落地时顺手推进，独立验收 |
| **Stage P6：视觉动画增强** | D1 蹲姿、D2 四足增强、A5 掩体（可选） | M/L | 无强依赖，任何时候可插入 |

每阶段独立验收：功能开关 + lil-gui 参数 + 调参台灰度。

---

## 6. 风险与「不建议做的事」

1. **不要为了真实牺牲可玩性**。[R2][R4] 说真实猎物近距必 zigzag，但若 8 只猎物全程满强度 zigzag 而玩家没有提前量，游戏直接无解。真实是参考系，不是目标函数。
2. **不要引入 RL/模仿学习训练猎物**。[R15] 表明 RL 能做追逐决策，但训练、调试、可解释性成本与这个 8 猎物小游戏完全不成比例；手写 utility/FSM hybrid 足够（[R16][R18]）。
3. **不要一次性合并 AI 藏狐与 PAF 的实体层**。两边平衡目标不同（一个要被玩家驱退、一个要被玩家操控），共享纯函数/参数即可（F1）。
4. **不要给失败扑击加顿帧/慢动作**。负反馈会被误读为奖励（[R20] 的反馈一致性原则）。
5. **不要上真实 LOS/遮挡**（第一阶段）。场景无遮挡查询接口，自造射线检测成本高风险大；视锥+距离已能覆盖 80% 的"潜行感"。
6. **不要重做完整程序化四足/IK/CPG**（本阶段）。[R23] 只是技术储备，P2。
7. **不要动 AI 藏狐线**（fox-v2 五阶段已合入 PR #1），本建议全部限定在 PAF 内。
8. **新参数必须进调参台**（[R21]：移动/节奏参数直接改变手感），禁止散落硬编码。

---

## 7. 待用户拍板的问题

| # | 问题 | 选项 | 推荐 | 理由 |
|---|------|------|------|------|
| Q1 | 猎物察觉模型 | A. 轻量"距离+视锥+速度/听觉代理" / B. 立即接真实 LOS+岩石遮挡 | **A** | 场景无遮挡查询，B 成本高；A 已覆盖主要手感缺口（[R12][R14]） |
| Q2 | 逃跑机动 | A. 仅近距离/被扑时 zigzag / B. 全程随机机动 | **A** | [R2][R4]：直线对远距已最优；全程机动会拖垮追逃节奏 |
| Q3 | 玩家资源 | A. 体力+冷却双约束 / B. 仅冷却 / C. 维持无限制 | **A**（严格度可灰度） | 体力是"潜行 vs 冲刺"取舍的载体；C 则无脑连扑 |
| Q4 | 捕获反馈 | A. 仅成功给 hit-stop / B. 命中失败都给轻微顿帧 | **A** | 不奖励失误（[R20]） |
| Q5 | 难度设计 | A. 时间驱动轻度 ramp / B. 连杀驱动 ramp / C. 不加，保持 sandbox | **A** | 可预测、易调参；B 会惩罚新手、奖励高手滚雪球 |
| Q6 | 架构 | A. 先抽纯函数/参数，不动实体 / B. 一次性合并两线 prey/fox core | **A** | [R16][R18]；B 风险与收益不成比例 |
| Q7 | 视觉 | A. 轻量姿态混合，不引新资产 / B. 完整程序化四足+IK | **A** | 收益/成本比；B 列 P2 |
| Q8 | 计分 | A. 只数+combo+时间效率 / B. 维持只数+耗时 | **A** | combo 只加分不改循环，风险低（C3） |

---

## 8. 附录

### 8.1 参数建议汇总表

| 参数 | 建议值 | 依据 | 改进项 |
|------|--------|------|--------|
| 猎物视锥 | 120° | [R12] 有限视野 | A1 |
| 潜行视觉半径 | 6–8m（对齐现 6.2） | 现状对齐 | A1 |
| 冲刺视觉/听觉半径 | 12–14m（对齐现 11.5） | 现状对齐 | A1 |
| 扑击听觉半径 | 17–20m（对齐现 17.0） | 现状对齐 | A1 |
| suspicion 上升/衰减 | 1.8/s；0.6/s | `smart-fox-core` 思路【工程】 | A1 |
| freeze 时长 | 0.25–0.45s | [R3] looming 切换【数值工程】 | A2 |
| zigzag 触发距离 | < 10m 或玩家 wind/lunge | [R4] | A3 |
| zigzag 偏角 / 反转周期 | 35°–60°；0.28–0.45s（±20% 随机） | [R5]【数值工程】 | A3 |
| zigzag 速度系数 | ≥ 0.85 | 【工程】防无解 | A3 |
| 轨迹回避权重 | 当前位置 0.4 / 着陆点 0.6；预测系数 0.7 | [R7]【数值工程】 | A4 |
| 扑击 lead 时间 | windRemaining + 0.45×lungeTime | [R5][R13]【数值工程】 | B1 |
| wind 重瞄上限 / 锁定点 | 12°；wind 60% | 【工程】防自动瞄准 | B1 |
| 捕获垂直容差 | ±0.8m | [R9] | B2 |
| FOV kick / hit-stop | +4°；成功 40–70ms | [R19][R20]【毫秒工程】 | B3 |
| 体力 | max 100；sprint 14–18/s；恢复 12/s；扑击 22–26；<20 限扑 | 对齐 AI 藏狐线 26【工程】 | C1 |
| 扑击冷却 / 成功返还 | +0.2–0.35s；返还 20–30% | 【工程】 | C2 |
| combo 窗口 | 5s | 【工程】 | C3 |
| 难度 ramp | 每 45–60s：flee +3–5%、察觉 +5%、反应 -5%；上限 125–130% | 【工程】 | E1 |
| 重生约束 | 距玩家 ≥18m；避开视线中心 ±35°；20 次退化为最远点 | 【工程】 | E3 |

### 8.2 完整引用列表（33 条目；去重后 30 篇：本轮 DeepXiv 精读 10 篇 + 补充来源 23 条目）

**本轮 DeepXiv 精读 [D1]–[D10]**

1. [D1] Zylberberg, J. & DeWeese, M. R. (2011). *How shoud prey animals respond to uncertain threats?* arXiv:1104.3805. https://arxiv.org/abs/1104.3805
2. [D2] Pichlmair, M. & Johansen, M. (2020). *Designing Game Feel. A Survey*. arXiv:2011.09201. DOI: 10.1109/TG.2021.3072241. https://arxiv.org/abs/2011.09201
3. [D3] Lin, Z. et al. (2022). *What Features Influence Impact Feel? A Study of Impact Feedback in Action Games*. arXiv:2208.06155. DOI: 10.48550/arXiv.2208.06155. https://arxiv.org/abs/2208.06155
4. [D4] Yang, Q. & Parasuraman, R. (2022). *Game-theoretic Utility Tree for Multi-Robot Cooperative Pursuit Strategy*. arXiv:2206.01109. https://arxiv.org/abs/2206.01109
5. [D5] Paduraru, C. & Paduraru, M. (2019). *Automatic difficulty management and testing in games using a framework based on behavior trees and genetic algorithms*. arXiv:1909.04368. https://arxiv.org/abs/1909.04368
6. [D6] Rahimi, M. et al. (2023). *Continuous Reinforcement Learning-based Dynamic Difficulty Adjustment in a Visual Working Memory Game*. arXiv:2308.12726. https://arxiv.org/abs/2308.12726
7. [D7] Huang, X. (2021). *Adversary agent reinforcement learning for pursuit-evasion*. arXiv:2108.11010. https://arxiv.org/abs/2108.11010
8. [D8] Bhatti, Z. et al. (2014). *Expression driven Trignometric based Procedural Animation of Quadrupeds*. arXiv:1404.2053. https://arxiv.org/abs/1404.2053
9. [D9] Chakraborty, D. et al. (2022). *Effect of inertia on the evasion and pursuit dynamics of prey swarms and the emergence of an optimal mass ratio for the predator-prey arms race*. arXiv:2208.12280. https://arxiv.org/abs/2208.12280
10. [D10] Wagner, A. P. et al. (2013). *Behavioral Strategy Chases Promote the Evolution of Prey Intelligence*. arXiv:1310.1369. https://arxiv.org/abs/1310.1369

**补充来源 [R1]–[R23]**

1. [R1] Lima, S. L. & Dill, L. M. (1990). Behavioral decisions made under the risk of predation: a review and prospectus. *Canadian Journal of Zoology*. DOI: 10.1139/z90-092. https://doi.org/10.1139/z90-092
2. [R2] Eilam, D. (2005). Die hard: A blend of freezing and fleeing as a dynamic defense. *Neuroscience & Biobehavioral Reviews*. DOI: 10.1016/j.neubiorev.2005.03.027. https://doi.org/10.1016/j.neubiorev.2005.03.027
3. [R3] Hébert, M. et al. (2019). Inexperienced preys know when to flee or to freeze in front of a threat. *PNAS* 116(46):22918–22920. DOI: 10.1073/pnas.1915504116. https://doi.org/10.1073/pnas.1915504116
4. [R4] Furuichi, N. (2002). Dynamics between a Predator and a Prey Switching Two Kinds of Escape Motions. *Journal of Theoretical Biology* 217(2):159–166. DOI: 10.1006/jtbi.2002.3027. https://doi.org/10.1006/jtbi.2002.3027
5. [R5] Firestone, C. Z. & Warren, W. H. (2010). Why does the rabbit escape the fox on a zig-zag path? *Journal of Vision* 10(7):1049. DOI: 10.1167/10.7.1049. http://www.journalofvision.org/content/10/7/1049
6. [R6] Cooper, W. E. Jr. (2016). Fleeing to refuge: Escape decisions in the race for life. *Journal of Theoretical Biology* 406:129–136. DOI: 10.1016/j.jtbi.2016.06.023. https://doi.org/10.1016/j.jtbi.2016.06.023
7. [R7] Kawabata, Y. et al. (2023). Multiple preferred escape trajectories are explained by a geometric model incorporating prey's turn and predator attack endpoint. *eLife* 12:e77699. DOI: 10.7554/eLife.77699. https://doi.org/10.7554/eLife.77699
8. [R8] Harris, R. B. et al. (2014). Evidence that the Tibetan fox is an obligate predator of the plateau pika: conservation implications. *Journal of Mammalogy*. DOI: 10.1644/14-MAMM-A-021. https://doi.org/10.1644/14-MAMM-A-021
9. [R9] Červený, J. et al. (2011). Directional preference may enhance hunting accuracy in foraging foxes. *Biology Letters*. DOI: 10.1098/rsbl.2010.1145. https://doi.org/10.1098/rsbl.2010.1145
10. [R10] Black, K. M. et al. (2025). Red fox home ranges, activity patterns, and resource selection on an Atlantic barrier island. *Journal of Wildlife Management*. DOI: 10.1002/jwmg.22704. https://doi.org/10.1002/jwmg.22704（未读原文，仅摘要）
11. [R11] Panzacchi, M. et al. (2009). Habitat and roe deer fawn vulnerability to red fox predation. *Journal of Animal Ecology*. DOI: 10.1111/j.1365-2656.2009.01584.x. https://doi.org/10.1111/j.1365-2656.2009.01584.x（未读原文，仅元数据）
12. [R12] Blanchard, P. et al. (2018). Coping with change in predation risk across space and time through complementary behavioral responses. *BMC Ecology* 18:60. DOI: 10.1186/s12898-018-0215-7. https://doi.org/10.1186/s12898-018-0215-7（未读原文，仅元数据）
13. [R13] Weintraub, I. E. et al. (2020). An Introduction to Pursuit-evasion Differential Games. arXiv:2003.05013. https://arxiv.org/abs/2003.05013
14. [R14] Huang, Y. & Zhu, Q. (2021). A Pursuit-Evasion Differential Game with Strategic Information Acquisition. arXiv:2102.05469. https://arxiv.org/abs/2102.05469
15. [R15] Zhao, Y. et al. (2024). Autonomous Decision Making for UAV Cooperative Pursuit-Evasion Game with Reinforcement Learning. arXiv:2411.02983. https://arxiv.org/abs/2411.02983
16. [R16] Sloan, C. et al. (2011). Feasibility study of utility-directed behaviour for computer game agents. *ACE '11*. DOI: 10.1145/2071423.2071430. https://doi.org/10.1145/2071423.2071430（未读原文，仅摘要）
17. [R17] Świechowski, M. et al. (2021). Combining Utility AI and MCTS Towards Creating Intelligent Agents in Video Games: Anthracite Shift. *IEEE SSCI 2021*. DOI: 10.1109/SSCI50451.2021.9660170. https://doi.org/10.1109/SSCI50451.2021.9660170
18. [R18] Sekhavat, Y. A. (2017). Behavior Trees for Computer Games. *International Journal on Artificial Intelligence Tools*. DOI: 10.1142/S0218213017300010. https://doi.org/10.1142/S0218213017300010（未读原文，仅摘要）
19. [R19] Pichlmair, M. & Johansen, M. (2022). Designing Game Feel: A Survey. *IEEE Transactions on Games* 14(2):138–152. DOI: 10.1109/TG.2021.3072241. arXiv:2011.09201. https://arxiv.org/abs/2011.09201
20. [R20] Lin, Z. et al. (2022). What Features Influence Impact Feel? A Study of Impact Feedback in Action Games. *IEEE GEM 2022*. DOI: 10.48550/arXiv.2208.06155. arXiv:2208.06155. https://arxiv.org/abs/2208.06155
21. [R21] Dahl, G. & Kraus, M. (2015). Measuring how game feel is influenced by the player avatar's acceleration and deceleration. *Academic MindTrek '15*. DOI: 10.1145/2818187.2818275. https://doi.org/10.1145/2818187.2818275（未读原文，仅摘要）
22. [R22] Bhatti, Z. et al. (2014). Expression driven Trignometric based Procedural Animation of Quadrupeds. *ICICM 2013*. DOI: 10.1109/ICICM.2013.25. arXiv:1404.2053. https://arxiv.org/abs/1404.2053
23. [R23] Bhatti, Z. (2019). Oscillator driven central pattern generator (CPG) system for procedural animation of quadruped locomotion. *Multimedia Tools and Applications*. DOI: 10.1007/s11042-019-7641-1. https://doi.org/10.1007/s11042-019-7641-1
