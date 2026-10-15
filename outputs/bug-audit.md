# 《土拨鼠大作战 3D》Bug 排查报告

- 排查日期：2026-10-15
- 范围：`src/` 全部 JS（主游戏 + dev GS 实验版）、`index.html`、`styles.css`、`tools/` 回归脚本
- 方法：全量静态走读 + 无头 Chrome（CDP / SwiftShader）动态冒烟
- 动态结果：
  - 正式版 `index.html`：页面异常 **0**、控制台 error/warning **0**、加载失败 **0**；开始→移动→攻击命中→J 爆发→K 大招→采食→暂停/恢复全链路通过
  - dev 版 `?version=dev&webgl=1`（WebGL2 兜底）：GS 场景加载、高度场、进 play、0 控制台错误（`test-dev-gs.cjs` 修复选择器后 `pass:true`）

> 结论：没有阻断性崩溃 Bug。发现 **3 个玩法逻辑 Bug（P1）**、**4 处死代码/死功能（P2）**、**3 处轻微/测试问题（P3）**。报告末尾附"已排除的疑点"。

---

## ✅ 修复状态（Agent 阶段已全部处置并回归通过）

> 说明：审计（下文）与修复在同一时段进行，期间代码被并行会话实时重构，部分问题在我动手前已被修好。下方"最终处置"以当前磁盘代码为准。

| 编号 | 问题 | 最终处置 |
|---|---|---|
| P1-1 | 接触伤害 `??`/`+` 优先级 | ✅ **本次修复**：`main.js` 改为 `(FOX.damage[type] ?? default) + game.level`，关卡加成恢复生效 |
| P1-2 | 受击击退瞬移/穿岩 | ✅ **并行会话已修，本次验证**：改为 `controller.hitShake(0, ix, iz)` 走 `externalVelocity` 冲量通道（参与速度积分、边界 clamp、岩石推出、撞墙消速），不再直接改坐标 |
| P1-3 | heavy/boss 抗击退被 mass 抵消 | ✅ **并行会话已修，本次验证**：`fox.hit()` 改用类型表 `knockbackMul`（heavy 0.62 / boss 0.38）+ 速度冲量 `knockbackVX/VZ`，不再用 `resist/mass`；重甲单位确实更难击退 |
| P2-1 | 大招白屏死链 | ✅ **本次修复**：HUD 新增 `flashLayer` 之外的 `ultFlashLayer` 与 `flashScreen()`（淡紫白闪 320ms）；`doUltimate` 直接调用；删除无人消费的 `g.flash` 状态（初始化/计时器/combat 三处） |
| P2-2 | 阵风死 clamp + 量纲 | ✅ **并行会话已修，本次验证**：改为 `externalVelocity.x += gust*dir*dt`（真加速度积分）并限幅 ±4.5，删除永不触发的 ±74 硬 clamp；回归实测峰值推力 0.75 m/s |
| P2-3 | GS shadowCatcher 恒透明 | ✅ **本次修复**：删除不可见面、`withShadowCatcher` 参数与返回字段（无外部消费者） |
| P2-4 | `buildHeightFieldFromSplat` 无引用 | ⚠️ **保留**：确为死函数，但该目录**非 git 仓库、删除不可恢复**，且是带完整文档的可复用工具，故保留文件仅标注；确认要用时再清理 |
| P3-1 | pointerlockchange 双重暂停监听 | ✅ **本次修复**：删除文档级重复监听，统一由 `controller.onLockChange` 失锁分支处理（回归确认暂停/恢复正常） |
| P3-2 | Esc 冷却期恢复锁定被静默拒绝 | ✅ **本次修复**：`requestLock()` 现返回 Promise<boolean>；`resume()` 在锁定失败时提示"点击画面继续" |
| P3-3 | test-dev-gs 选择器过期 | ✅ **本次修复**：改用 `getElementById('startBtn')`；并把调试端口改为动态（原固定 9511 被残留 Chrome 占用导致假失败）、等待就绪改为轮询 |
| 🆕 | **dev 分段狐狸模型 traverse 崩溃**（修复中新增发现） | ✅ **本次修复**：见下节 |

### 🆕 修复中新发现：`_prepareSegmentedFox` 遍历中改子树导致真实狐狸模型被丢弃

dev 版新引入的 `fox-segmented.glb`（50MB）配套准备方法里，`sourceHeading.traverse(...)` 的回调中**边遍历边 `hinge.add(o)` / `sourceHeading.add(hinge)` 增删子节点**。three.js 的 `traverse` 按数组索引迭代，中途增删导致索引错位、踩到 `undefined` 再调 `.traverse` 抛 `TypeError: Cannot read properties of undefined (reading 'traverse')`。异常被 `_loadRealModel` 的 catch 吞掉 → dev 版每只狐狸都静默退回程序化建模（日志 4 条 warning）。

**修复**：把回调拆成两阶段——先 traverse 只收集 mesh 与材质处理（不改结构），遍历结束后再统一建立腿部枢轴并重排父子关系。修复后实测：每只狐狸 `modelLevel=geometry-only`、`realModel.visible=true`、程序化版本关闭、`4 腿 + 1 尾` 枢轴齐全，控制台错误/警告清零。

### 回归验证（修复后全绿）

- `tools/smoke.cjs`（正式版）：页面异常 0 / 控制台 0 / 加载失败 0；移动·攻击命中·J·K（含新白闪）·采食·暂停→恢复全链路通过。
- `tools/test-attacks.cjs`：4 种攻击模式、12 关、环境修饰、控制台错误 = 0。
- `tools/test-repel.cjs`：驱退后实际逃跑（20 个不同位置、位移 ~7m），页面异常/控制台 = 0。
- `tools/test-dev-gs.cjs`（dev GS 版）：`pass:true`，`consoleErrors: []`（狐狸模型警告清零）。
- 5 个改动文件 + fox.js 全部 `node --check` 通过。

---

## P1 — 玩法逻辑错误（建议修）

### P1-1 藏狐接触伤害的"随关卡递增"从未生效（运算符优先级）

**位置**：`src/main.js:1067`

```js
const damage = FOX.damage[f.type] ?? FOX.damage.default + game.level;
```

`??` 的优先级**低于** `+`，实际等价于：

```js
const damage = FOX.damage[f.type] ?? (FOX.damage.default + game.level);
```

`FOX.damage`（`src/core/config.js:180`）为 `{ boss:22, heavy:18, pup:8, default:12 }`，四种狐狸全部能在表中取到值（含普通狐走 `default` 键），左操作数永远非 nullish，右侧整支永远不求值。

**后果**：
- 普通狐在任何关卡都是固定 12 点伤害，`+ game.level` 一行**对任何狐型都不生效**；
- 代码读起来像"伤害随关卡递增"，实际完全没有，平衡调整会被静默吞掉。

**修复**（二选一，先明确设计意图）：

```js
// 若确实要随关卡递增（所有类型都吃关卡加成）：
const damage = (FOX.damage[f.type] ?? FOX.damage.default) + game.level;
// 若设计上就不递增：删掉误导性的 + game.level
```

同类排查：全项目仅此处一处（`gs/heightfield.js:47` 的 `?? (y0 + spanY*0.12)` 括号正确，无问题）。

---

### P1-2 玩家受击击退是"瞬移"，绕过速度积分与岩石碰撞

**位置**：`src/main.js:1078-1083`

```js
const dx = p.x - f.x, dz = p.z - f.z;
const dd = Math.hypot(dx, dz) || 1;
controller.position.x += (dx / dd) * 1.5;
controller.position.z += (dz / dd) * 1.5;
```

**问题**：
1. 每受一次击固定平移 **1.5 m**，直接改位置，没有进入 `controller.velocity`，下一帧惯性/插值完全不知道发生过位移；
2. 位移后**没有任何边界 clamp、也没有岩石碰撞检测**。岩石推出逻辑只在 `controls.js` 的 `update()` 里，而这里是在 `controller.update()` 返回之后直接改坐标——玩家可被打进岩石内部或越过 `moveBounds()`，要等下一帧 `update()` 才被弹回，斜坡上还可能短暂穿模；
3. 与狐狸受击的击退（`fox.hit()` 走 `knockback*resist/mass`）机制完全不对称。

**后果**：贴岩石/贴边界挨打时可能看到卡一下再弹回；手感上是"被传送"而非"被撞退"。

**修复方向**：把 1.5 m 改成瞬时速度冲量（写进 `controller.velocity`，由 `update()` 的积分+岩石推出+边界 clamp 统一处理），或在这段位移后立即复用一遍岩石/边界修正。

---

### P1-3 厚皮狐/首领的"抗击退"设计被质量参数恰好抵消

**位置**：`src/entities/fox.js:666-669`，参数在 `src/core/config.js:140-145`

```js
const resist = this.type === 'boss' ? 0.38 : this.type === 'heavy' ? 0.6 : 1;
const kb = knockback * resist / (this.cfg.mass * 1.6);
this.x += (dx / d) * kb;
this.z += (dz / d) * kb;
```

各类型参数：

| 类型 | resist | mass | resist/mass（实际击退系数） |
|---|---|---|---|
| 普通 normal | 1 | 1.0 | **1.0** |
| 幼狐 pup | 1 | 1.15 | 0.87 |
| 疾行 fast | 1 | 0.85 | 1.18 |
| 厚皮 heavy | 0.6 | **0.6** | **1.0** |
| 首领 boss | 0.38 | **0.38** | **1.0** |

**问题**：厚皮狐与首领的 `resist` 与 `mass` 数值被设成完全相等，比值恒为 1。于是"重甲单位更难被击退"这一设计意图**完全没生效**——它们被击退的距离和普通狐一模一样。唯一有差异的反而是疾行狐（更轻→退得更远，这方向是对的）。

**修复方向**：让 `mass` 与 `resist` 解耦，例如 boss/heavy 的 mass 取 1.6/1.3（明显大于 1），或把分母改成固定基准质量、只让 resist 体现装甲减伤。

---

## P2 — 死代码 / 死功能（不影响运行，但应清理或补全）

### P2-1 K 大招"白屏闪光"整条链路是死的

- `src/main.js:923`：`hud.flashScreen && hud.flashScreen();`
  - `HUD` 类（`src/ui/hud.js`）**没有** `flashScreen` 方法（只有 `hurtFlash()`），这里靠 `&&` 短路静默跳过，什么都不会发生；
- `src/systems/combat.js:94`：`g.flash = 0.9;`
  - 全项目搜索 `.flash`，除了在主循环计时器里被递减（`main.js:995`）外，**没有任何渲染/视觉代码消费它**。

**后果**：大招释放时玩家预期的全屏光效从未出现，且无报错，极难察觉。
**修复**：二选一——在 HUD 上实现 `flashScreen()`（可复用现有 `#flashLayer`，改个颜色/时长）并让它消费 `g.flash`；或删除这两行死调用。

### P2-2 阵风边界 clamp 是永不触发的死代码，且量纲与用法不符

**位置**：`src/main.js:1016-1019`

```js
if (env.gust !== 0) {
  const push = env.gust * env.gustDir * dt;
  controller.position.x = clamp(controller.position.x + push, -74, 74);
}
```

两个问题：

1. **clamp 永不触发**：玩家真实活动边界来自 `moveBounds()`（`controls.js:173-175`），经典版是 ±65 / ±39 且在 `controller.update()` 内已经 clamp。这里用 ±74 更宽，且发生在 update 之后，玩家坐标早已在 ±65 内，这个 clamp 永远不起作用；
2. **量纲/用法不一致**：注释（`main.js:460`、`config.js:206`）把 `gust` 定义为"横向加速度 m/s²"（关卡值 6.5~11），但代码把 `gust*dt` **直接加进位置**——加速度没有经过"速度积分"这一步，等价于一个数值等于 `a·dt` 的瞬时位移（稳态每秒只平移约等于加速度数值的距离，且与帧率解耦方式也不物理）。这一项与 `outputs/reality-audit.md` 的 P0 阵风单位问题同源。

**修复**：删除无用的 ±74 clamp（风推不应突破 `moveBounds`，下一帧 update 也会兜住）；若要物理正确，应把阵风作为加速度写进 `controller.velocity.x` 再积分。

### P2-3 GS 阴影承接面恒透明，等于没创建

**位置**：`src/gs/world.js:226-238`

```js
const cm = new THREE.MeshBasicMaterial({
  color: 0x000000, transparent: true, opacity: 0.0, // 恒为 0
  depthWrite: false, blending: THREE.NormalBlending,
});
shadowCatcher = new THREE.Mesh(cg, cm);
```

创建后 `opacity` 再无任何修改（grep 全项目确认）。注释声称用来给玩家/藏狐"脚下阴影感"，但 opacity 恒为 0，这块面**永远不可见**。它仍占用一个 draw call、一个平面几何体。

**修复**：给一个可见的小数值（如 0.12~0.18，配合径向渐变贴图效果更好），或整段删除并从返回值里移除 `shadowCatcher`。

### P2-4 `buildHeightFieldFromSplat` 是无引用的死函数

**位置**：`src/gs/heightfield.js:28`，全项目（含 `tools/`）grep 无任何 import/调用。GS 实际走的是点云低分位高度场的另一条路径。
**修复**：确认无规划用途后删除，避免后人误改一个没人跑的函数。

---

## P3 — 轻微 / 健壮性 / 测试

### P3-1 失锁暂停被注册了两遍（冗余但无害）

- `src/main.js:1307` `controller.onLockChange` 内部：失锁且 play 时调 `pause()`；
- `src/main.js:1384` 文档级 `pointerlockchange`：同样条件又调一次 `pause()`。

两者监听的是同一个浏览器事件。第二次调用被 `pause()` 开头的 `if (game.mode !== 'play') return;`（幂等守卫）挡掉，因此**没有实际错误**，只是冗余、易让维护者误以为有两套暂停逻辑。建议保留文档级一处即可。

### P3-2 Esc 暂停后立即恢复，可能出现"play 态但鼠标没锁住"

`resume()`（`main.js:803-808`）里 `controller.requestLock()` 的 Promise 已吞掉 rejection。浏览器对 Esc 退出指针锁定有短暂冷却（约 1 秒左右），若玩家用 P/Enter/点按钮在冷却期内恢复，锁定请求会被静默拒绝 → `game.mode==='play'` 但视角不跟随鼠标，需再点一下画面（`main.js:1332` 的点击重锁）才正常。属轻微 UX 瑕疵。可在锁定失败时给出"点击画面继续"提示。

### P3-3 回归脚本 `tools/test-dev-gs.cjs` 选择器过期（已修复）

该脚本用文案正则 `/开始|进入草原|start/` 找开始按钮，但实际按钮文案是「从第 N 关继续 · Enter」（`main.js:712`，id=`startBtn`），匹配不到 → 从未点击 → 恒报 `playState.mode = "title"`、`pass:false`。这是**测试假阴性，不是游戏 Bug**（游戏本身正常，`smoke.cjs` 用 id 点击就通过）。

**已修复**：选择器改为优先 `document.getElementById('startBtn')`，文案正则补 "继续"。修复后重跑 `pass:true`。

---

## 已排除的疑点（经核实不是 Bug）

| 疑点 | 核实结论 |
|---|---|
| "狐狸/玩家/风推三套边界不一致，GS 狐狸会走出高度场" | 现行代码狐狸用 `roamBounds()`（`config.js:549`，随 `POINT_SCALE.k` 缩放）、玩家用 `moveBounds()`（`config.js:531`，同缩放），两者各自正确，GS 下同步缩小。唯一残留是风推那处硬编码 ±74，已列入 P2-2。 |
| dev 版切关会因 `Food.dispose` 不存在而 TypeError | 磁盘版 `props_entities.js:219` 确有 `dispose()`，误判排除。 |
| 损坏的 localStorage 存档会导致白屏 | `readProgress()`（`main.js:311`）与 keybinds `_load()`（`keybinds.js:89`）都有 try/catch 降级。 |
| 视觉增强（风摆草）引入 rAF 泄漏 | `Scenery` 为页面级单例（`main.js:194`），无 dispose/重建路径，常驻 rAF 符合生命周期；`scene.js` 天穹、`styles.css` 暗角语法检查通过。 |
| 主循环在标题/暂停态空转或 viewmodel 状态错乱 | `update()` 非 play 态只更新视觉并 return；viewmodel 仅在 play/pause/levelclear 渲染；`dt` 有 0.05 上限防螺旋。 |
| dev GS 版初始化/进 play 报错 | 动态冒烟 0 控制台错误，高度场与玩家 Y 吸附正常。 |

---

## 修复优先级建议

1. **先修 P1-1**（一行括号，零手感风险，但要先定"伤害是否随关卡成长"的设计意图）。
2. **P1-2 / P1-3** 涉及战斗手感与数值平衡，建议一起改、一起用 `tools/test-attacks.cjs`、`tools/test-repel.cjs` 回归。
3. P2 随下次重构清理即可；其中 **P2-1 大招闪光**若想保留演出效果，是性价比很高的一个补全点。
4. P3-1/P3-2 可顺手处理；P3-3 已修复。

> 所有玩法相关改动（P1-2、P1-3、P1-1 的数值取向）都会影响平衡，本报告只做定位与修复建议，未直接改动玩法代码；`tools/test-dev-gs.cjs` 的选择器修正已落地。
