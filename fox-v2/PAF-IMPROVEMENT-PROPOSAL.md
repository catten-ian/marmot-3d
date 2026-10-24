# 扮演藏狐模式（Play as Fox）改进方案 —— 文献调研与建议书

> 阶段：Stage R（纯研究/方案阶段，不含实现代码）
> 分支：`codex/fox-v2-20261024`（基线 HEAD `f7d2551`）
> 调研对象：`src/play/play-as-fox.js`（496 行）+ `src/play/play-as-fox-debug.js`（302 行）
> 日期：2026-10-24

---

## 1. 摘要

扮演藏狐模式目前的可玩性骨架是成立的：第三人称追尾、潜行/冲刺/扑击三段相位机、8 只猎物的捕猎循环。但代码复核（见 §2）确认了一组系统性问题：猎物察觉是**纯距离半径**、没有视野锥/听觉/遮挡维度；逃跑是 `atan2(dx,dz)` 的**笔直直线**；没有冻结/战栗中间态；扑击朝向在 wind 结束瞬间锁定、**对猎物运动零提前量**；捕获判定只有水平距离、**无垂直窗口**；猎物重生可能直接出现在玩家脸上；玩家狐狸没有体力/冷却，可以理论上无限连扑。这些问题叠加的结果是：猎物行为可预测、扑击更像"碰判定圈"而不是"截杀"，捕猎缺乏博弈感。

文献调研（§3，共取回 23 篇，精读 10 篇）给出的核心启示是收敛的：**真实猎物面对威胁时不是二元的"看见就跑"**——Eilam (2005) 与 Hébert et al. (2019, PNAS) 都表明冻结（freezing）是未被发现阶段的最优防御，快速逼近（looming）才触发逃跑；Furuichi (2002) 与 Firestone & Warren (2010) 表明近距离/高速捕食者面前 zigzag 优于直线，因为 zigzag 破坏捕食者的恒定方位角拦截策略；Červený et al. (2011) 的赤狐野外数据确认 mousing 扑击是**高跳、从上方突袭**的短爆发动作，这直接支持"捕获需要垂直判定"。在 game feel 侧，Pichlmair & Johansen (2022) 的 game feel 综述和 Lin et al. (2022) 的 impact feel 实验支持用 FOV kick、hit-stop 放大扑击瞬间的反馈；Dahl & Kraus (2015) 则证明移动加减速参数本身显著影响手感感知。

本建议书按 A–F 六组提出 20+ 条可独立实施的改进（§4），每条都带机制描述、文献依据、建议参数、代码落点、风险与优先级。最高优先级的六件事是：**猎物多线索察觉（距离+视锥+速度）**、**freeze 中间态**、**近距离 zigzag 逃跑**、**扑击提前量预测**、**捕获垂直窗口**、**重生防贴脸**。这六条都能落在现有 `play-as-fox.js` 的 `Prey` 类和相位机内，不依赖新资产、新依赖或架构重构。

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

**检索通道实测结果**：

| 通道 | 实测状态 | 说明 |
|------|----------|------|
| DeepXiv MCP | ❌ 不可用 | 本机未安装，npm/pip 包名均 404；按提示不安装，走 fallback |
| OpenAlex API | ❌ 实际不可用 | 提示文件声称可用，但本次实测全部返回 `Rate limit exceeded`，0 条有效结果 |
| arXiv API | ✅ 经代理可用 | `curl -x http://127.0.0.1:7890 https://export.arxiv.org/api/query?...`，取回 6 篇 |
| Semantic Scholar API | ⚠️ 部分可用 | 首次查询 429，退避后 `red fox hunting pounce predation` 查询成功取回 10 条候选 |
| Crossref API | ✅ 稳定可用 | 本次主力元数据/摘要来源，取回 DOI、摘要、参考文献 |
| PubMed | ⚠️ 部分可用 | 部分页面触发 JS cookie/PoW challenge；`format=pubmed` 请求部分成功 |
| web_search（MiniMax） | ⚠️ 前期可用后耗尽 | 前几次可用，随后达到 Token Plan 上限，后期未依赖 |

**检索过的关键词方向**（中英文混合）：predator prey escape behavior freezing fleeing；zigzag escape trajectory；constant bearing strategy pursuit；Tibetan fox Vulpes ferrilata plateau pika predation；red fox mousing pounce hunting；vigilance detection distance predator；pursuit evasion differential games；utility AI behavior trees video games；game feel hit stop impact feedback；procedural quadruped animation CPG；context steering game AI；difficulty ramp combo scoring。

**精读 10 篇**（取回了摘要或全文的实质性内容并提炼结论）：Eilam 2005；Hébert et al. 2019；Furuichi 2002；Firestone & Warren 2010；Kawabata et al. 2023；Červený et al. 2011；Harris et al. 2014；Pichlmair & Johansen 2022；Lin et al. 2022；Lima & Dill 1990。

**仅元数据/摘要、未读原文**：Black et al. 2024；Panzacchi et al. 2009；Blanchard et al. 2018；Cooper 2016；Sloan et al. 2011；Świechowski et al. 2021；Sekhavat 2017；Bhatti et al. 2014；Bhatti 2019；Weintraub et al. 2020；Huang & Zhu 2021；Zhao et al. 2024；Dahl & Kraus 2015（引用时已标注）。

**没找到足够文献的方向（如实声明）**：
1. **藏狐 Vulpes ferrilata 的具体潜伏接近距离、wind 真实时长、扑击位移运动学**——只找到藏狐与高原鼠兔的捕食关系（Harris et al. 2014），无行为运动学数据。本建议中所有藏狐具体动作数值均为【工程直觉】或借鉴赤狐数据。
2. **狐狸连续扑击的体力限制数值**——无直接文献。体力参数借鉴本仓库 AI 藏狐线已有数值（`FOX.ACTIONS.pounce.staminaCost: 26`），属工程对齐。
3. **hit-stop 的精确毫秒值**——Lin et al. (2022) 证明其显著影响 impact feel，但没有浏览器捕猎小游戏的普适毫秒推荐。§4-B3 的毫秒值是工程调参起点。
4. **context steering 的游戏文献**——arXiv 上 "context steering" 命中的多为非游戏语境，未找到可直接引用的游戏 steering 论文；相关建议以 steering/utility 概念标注为工程直觉。

### 3.2 精读文献表

> 全部文献均通过 Crossref / arXiv API / Semantic Scholar / PubMed / web_search 实际取回过。引用编号 [R1]–[R23] 供 §4 引用。

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
- **[R10]** Black, K. M. et al. (2024). Red fox home ranges, activity patterns, and resource selection on an Atlantic barrier island. *Journal of Wildlife Management*. DOI: 10.1002/jwmg.22704. URL: https://doi.org/10.1002/jwmg.22704（Semantic Scholar 摘要；未读原文）
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

### 3.3 文献 → 可落地结论映射表

| 可落地结论 | 依据文献 | 落到改进项 |
|---|---|---|
| 察觉应是多因素（距离+视锥+速度+噪声），非单一半径 | [R1][R12][R14] | A1 |
| 未被锁定的远处威胁→冻结；快速逼近→立即逃跑 | [R2][R3] | A2 |
| 近距离/对方高速时 zigzag 优于直线；距离远时直线即可 | [R2][R4] | A3 |
| zigzag 的价值在于破坏恒定方位角拦截 → 必须同时给玩家提前量，否则一边倒 | [R5][R13] | A3 + B1（成对） |
| 猎物回避的是攻击终点，不是捕食者当前位置 | [R7] | A4 |
| 狐科扑击是从上方的高跳突袭 → 捕获需要垂直判定 | [R9] | B2 |
| 听觉是狐科捕猎与猎物反捕的重要线索维度 | [R9] | A1（听觉半径） |
| hit-stop / 相机反馈 / FOV 变化显著放大命中手感 | [R19][R20] | B3 |
| 加减速参数本身改变手感 → 新节奏参数必须进调参台 | [R21][R19] | C 组全部 |
| 8 只猎物用轻量 utility/FSM hybrid 足够，不上 BT/MCTS/RL | [R16][R17][R18][R15] | A 组架构约束 + §6 |
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
- **做什么**：场景提供岩石/植被查询后，flee 目标偏向最近掩体方向。当前场景无遮挡查询，仅留接口。
- **依据**：[R6][R10][R11]
- **落点**：预留 `findRefuge(pos)` 接口。
- **风险**：依赖场景层改造，成本不可控；本阶段不建议实施。
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
- **依据**：【工程直觉，无文献支持】（session pacing 方向未检到直接可用文献，见 §3.1）。
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
- **依据**：[R22][R23]
- **风险**：完整重做成本高、收益边际——明确列为 P2。
- **优先级**：P2

### E. 难度、计分与 session

**E1. 时间驱动难度爬升【P2】**
- **做什么**：前 60s 默认；之后每 45–60s：preyFlee +3–5%、suspicion 上升 +5%、alert→flee 反应 -5%；总上限不超过默认 125–130%。
- **依据**：【工程直觉，无文献支持】
- **风险**：上限护栏必须有，否则后期无解。
- **优先级**：P2

**E2. 计分扩展【P2】**
- **做什么**：只数 + 耗时 之外加 combo（C3）与"平均捕获耗时"。
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

### 8.2 完整引用列表（23 篇）

1. [R1] Lima, S. L. & Dill, L. M. (1990). Behavioral decisions made under the risk of predation: a review and prospectus. *Canadian Journal of Zoology*. DOI: 10.1139/z90-092. https://doi.org/10.1139/z90-092
2. [R2] Eilam, D. (2005). Die hard: A blend of freezing and fleeing as a dynamic defense. *Neuroscience & Biobehavioral Reviews*. DOI: 10.1016/j.neubiorev.2005.03.027. https://doi.org/10.1016/j.neubiorev.2005.03.027
3. [R3] Hébert, M. et al. (2019). Inexperienced preys know when to flee or to freeze in front of a threat. *PNAS* 116(46):22918–22920. DOI: 10.1073/pnas.1915504116. https://doi.org/10.1073/pnas.1915504116
4. [R4] Furuichi, N. (2002). Dynamics between a Predator and a Prey Switching Two Kinds of Escape Motions. *Journal of Theoretical Biology* 217(2):159–166. DOI: 10.1006/jtbi.2002.3027. https://doi.org/10.1006/jtbi.2002.3027
5. [R5] Firestone, C. Z. & Warren, W. H. (2010). Why does the rabbit escape the fox on a zig-zag path? *Journal of Vision* 10(7):1049. DOI: 10.1167/10.7.1049. http://www.journalofvision.org/content/10/7/1049
6. [R6] Cooper, W. E. Jr. (2016). Fleeing to refuge: Escape decisions in the race for life. *Journal of Theoretical Biology* 406:129–136. DOI: 10.1016/j.jtbi.2016.06.023. https://doi.org/10.1016/j.jtbi.2016.06.023
7. [R7] Kawabata, Y. et al. (2023). Multiple preferred escape trajectories are explained by a geometric model incorporating prey's turn and predator attack endpoint. *eLife* 12:e77699. DOI: 10.7554/eLife.77699. https://doi.org/10.7554/eLife.77699
8. [R8] Harris, R. B. et al. (2014). Evidence that the Tibetan fox is an obligate predator of the plateau pika: conservation implications. *Journal of Mammalogy*. DOI: 10.1644/14-MAMM-A-021. https://doi.org/10.1644/14-MAMM-A-021
9. [R9] Červený, J. et al. (2011). Directional preference may enhance hunting accuracy in foraging foxes. *Biology Letters*. DOI: 10.1098/rsbl.2010.1145. https://doi.org/10.1098/rsbl.2010.1145
10. [R10] Black, K. M. et al. (2024). Red fox home ranges, activity patterns, and resource selection on an Atlantic barrier island. *Journal of Wildlife Management*. DOI: 10.1002/jwmg.22704. https://doi.org/10.1002/jwmg.22704（未读原文，仅摘要）
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
