# m3d-20261027-dev-loader-restore —— dev 加载器三项修复恢复

> 用户原话：「@小喵 你现在这个dev版本有问题啊，你是不是之前基于旧版本合并部署的？加载界面的速度显示，下载超时顺延，右下角白块修复，这些修复都没了」
> 后续补充：「有bug就修复」

## 1. 结论：问题属实，根因是上游合并覆盖，不是部署丢文件

| 现象 | 根因 | 证据 |
|---|---|---|
| 加载页无速度/字节显示 | `a1de0d1` 用旧版 `src/world/verdant.js` 覆盖 `3f0ea63`，`downloadVerdantPack` 变成零调用者死代码，`4b47444`/`0484e20` 的 8 秒无字节切源、`signal` 贯通、HTTP 缓存复用一并失效 | 全仓 grep `downloadVerdantPack` 零调用者 |
| 「加载停滞 8%」被误杀 | `main.js` 中 `if (stats?.doneBytes > 0) attempt.receivedBytes = true;` 在等一个永不到达的 `stats`；大 GLB 下载期间无中间 `onProgress`，25s 看门狗误杀 | `src/main.js:354,377` |
| 右下角白块 | `8c5f678` 位于未合入分支 `fix/dev-loading-whiteblock-20261026`；检查服务器 5 个 release 全部缺 `.loader.cinematic .loader-track { position: relative; }`，证明该修复**从未上线** | 5 个 release 逐一 grep |

## 2. 改动文件

| 文件 | 内容 |
|---|---|
| `src/world/verdant-progress.mjs`（新增 261 行） | 字节进度统计、速度 EMA、多源「首字节 8s 无响应即换源」、缓存命中判定。纯逻辑，不依赖 DOM/three，可在 Node 下直接单测 |
| `src/world/verdant.js`（重写接线） | 统一走 `getAssetCandidates` 候选链（本地包 → TOS → 同源）；逐块回报 `doneBytes/totalBytes/remainingBytes/speed`；`onProgress` 携带 `stats` 使 `attempt.receivedBytes` 得以置位；`signal` 贯通到 `fetch`；JSON 清单条件验证（ETag→304）；glTF(ultra) 只下载被引用的 64 个文件（1.29GB）而非 pack-manifest 全部 146 个（2.40GB），blob 路径失败回退原生加载 |
| `styles.css`（+1 行） | 合入 `8c5f678` 的 `.loader.cinematic .loader-track { position: relative; }`，使 `.loader-shine` 回到轨道内并被轨道 `overflow:hidden` 裁掉 |
| `src/main.js` / `index.html`（+3 / -4 行） | 场景加载器与样式换版本戳 `m20261027loader1`，绕过 Cloudflare 对 `.js`/`.css` 的 4 小时浏览器缓存 |
| `tools/public-shell.cjs`（+5/-1） | 修正生成器漏转 JS 字符串里的相对资源路径（详见 §3） |
| `index-public.html` | 按修正后的生成器重新生成 |
| `tools/test-verdant-loader-progress.cjs`（新增 170 行） | 字节统计/换源/超时/缓存判定单测 |
| `tools/qa-dev-loader-ui.cjs`（新增 266 行） | 加载器 UI 脚本渲染验收 + 像素断言（详见 §4） |

## 3. 顺带修掉的基线遗留 bug：`test-beta-contract.cjs` 长期失败

**不是本次改动引入** —— 在未改动的集成树中 `node tools/public-shell.cjs --check` 同样失败。

根因：生成器只转换 `href="./assets/"` / `src="./assets/"` **属性形式**，漏了 `index.html` 中 JS 字符串里的 `'./assets/video/...'`（dev 加载视频的 poster 与 source）。残留相对路径触发守卫 `Unconverted relative beta resource path remains`，抛错。

修法：对引号包裹的 `./assets/` 与 `./vendor/` 也做绝对路径转换，覆盖属性与 JS 字符串两种形式。重新生成后 0 处相对路径残留。

**通道边界已核对**：beta 是独立通道（`/var/www/marmot3d-beta` → `beta-rev39-stun-diminish-202610270715`，rev39，07:15 刚发），走 beta 分支自己的 `index-public.html`；dev 树里那份是无人服务的陈旧拷贝，故本次改动不影响线上 beta。

## 4. 验收（脚本渲染，不用 CDP）

工具：`tools/qa-dev-loader-ui.cjs`。用**真实** `index.html` 的 loader DOM + **真实** `styles.css` + **真实** `src/ui/hud.js`，在 headless Chrome CLI（`--headless=old --screenshot` / `--dump-dom`）里渲染。

### 4.1 速度/字节/剩余确实显示

DOM dump 断言 `#loaderBytes` 文本：

```
256 MiB / 1.00 GiB（剩 768 MiB） · 12.0 MiB/s · TOS
```

字节、总量、剩余、速度、来源五项齐全，不再只有百分比。

### 4.2 右下角白块：A/B 像素断言

同一 DOM/CSS，只移除 `.loader.cinematic .loader-track` 的 `position: relative` 重渲染，做像素级对照：

| 尺寸 | broken 独有的近白像素 | 包围盒高度 |
|---|---|---|
| 1440×900 | **475** | **114px** |
| 390×844 | 0 | — |

**机制解释**：`position:relative` 缺失时，`.loader-shine`（`position:absolute; top:0; right:0; height:100%`）的包含块退化为 `.loader.cinematic .loader-hud`（`position:absolute`），`height:100%` 于是变成 HUD 全高 → 一根 **114px 高的竖直白色渐变条**贴在右下角。补上 `position:relative` 后包含块回到轨道本身，且轨道自带 `overflow:hidden`，渐变条被裁掉。

桌面尺寸差异 bbox 右端落在 `1113` = HUD 右边缘(1100) + shine 的 `translateX(50%)` 半宽(13)，与上述机制精确吻合。

手机端无差异：HUD 贴到屏幕右缘，渐变条被视口裁掉。

断言带下限（近白像素 <100 或包围盒高 <40px 直接失败），不会退化成「只检查退出码」的弱断言。

### 4.3 两个会让断言假通过的坑（已修，记录在案）

1. **CSS 路径写错**：harness 放在仓库根时 `./fixed.css` 解析到不存在路径 → 样式表 404 → 两张图都是无样式页、像素完全相同，断言形同虚设。首轮 A/B 就是这样，**像素完全相同反而暴露了它**。
2. **入场动画导致渲染不确定**：`.loader-hud` 带 `animation: loaderFade .8s ease both`，截图落在动画起点会拿到 `opacity:0` 的全黑帧（实测整图最亮仅 30）。harness 内关闭该动画使渲染确定化。

### 4.4 仓库回归

`node tools/run-node-tests.cjs` → **OK 43/43**（修复前为 `FAILURES: 1, OK 42/43`，唯一 FAIL 即上述基线遗留的 `test-beta-contract.cjs`）。未删除测试、未放宽断言。

## 5. 部署与线上验证

- 新 release：`/var/www/m3d-releases/dev-loader-restore-202610270740`
- 由旧 release 硬链接克隆（不占额外磁盘），暂存区 rsync `-azR` 上传，服务器端 `cp --remove-destination` 断链覆盖 → **旧 release 回滚点未被污染**
- 服务器端复核：版本戳 `m20261027loader1`、白块修复 `position: relative` 已就位、新模块 9266 字节、`SOURCE_STALL_MS = 8000` 存在、新旧 release 符号计数一致（0，无资源误删）、关键资产齐全
- 原子切链：`ln -sfn` + `mv -T` → `/var/www/marmot3d` 指向新 release
- `.last-dev-link` 指向**上一个** release `dev-verdant-tos-202610270147`（对齐 beta 的 `.last-beta-link` 语义；首轮写反，已纠正）
- 磁盘：91%（21G/24G），暂存区已清理

线上验证（curl）：

| 检查 | 结果 |
|---|---|
| `/?version=dev` | HTTP 200，戳 `v=m20261027loader1` |
| `styles.css?v=m20261027loader1` | HTTP 200，含 `position: relative` |
| `src/main.js?v=m20261027loader1` | HTTP 200，含 `verdant.js?v=m20261027loader1` |
| `src/world/verdant-progress.mjs` | HTTP 200，9266 字节 |
| CF 缓存头 | `main.js` = `REVALIDATED`（must-revalidate 拿到新内容）；新模块 = `no-cache, DYNAMIC`（永远新鲜） |
| 线上文件 vs 本地集成树 | index.html / styles.css / verdant.js / verdant-progress.mjs / main.js **md5 全部一致** |

**线上文件与本地集成树逐字节一致**，故 §4 的本地渲染结论可直接迁移到线上。

## 6. 未完成项与已知问题

1. **线上真机浏览器截图未能取得**：本机 Chrome 单进程模式下代理解析失效（`Cannot use V8 Proxy resolver in single process mode`），直连线上 HTTPS 得到的是 100% 纯白页（1 种颜色 RGB 255,255,255，129.6 万像素全白）—— 是 Chrome 空白/错误页，**不是应用渲染结果**，未作为验收证据采用。已用「线上文件 md5 == 本地文件 md5 + 本地脚本渲染通过」间接闭环。
2. **服务器 dev release 仍保留约 2.8G Verdant 资产**作为 TOS 失效兜底；确认 TOS 稳定后可再清理。
3. `m3d-20261026-dev-burrow-sorrel-marmot` 的离线渲染验收（GLB 蒙皮：Tongue skin0 / Tail skin1 / 主 skin2）**仍未闭环**，与本任务无关，未处理。
4. 未处理 stable/beta 通道、Caddy/systemd、`src/core/version.js` 版本戳；PAF Stage 1、触屏 Stage 2、FPV 合并冲突及后续阶段未处理。

## 7. 提交与分支

| 项 | 值 |
|---|---|
| feature 分支 | `feat/dev-loader-restore-20261027`（已推送） |
| 集成分支 | `dev-verdant-tier-snapshot-20261026`（已推送） |
| 集成树 JOB | `/home/fame/code/marmot3d/_int_dev_verdant` |
| feature 提交 | `6c6d693`（三项修复）、`6038770`（public-shell 修正）、`358f17f`（QA 脚本） |
| 合并提交 | `9f3cd35` |
| base SHA | `04b2329` |
| 部署状态 | 已部署 dev；线上 dev → `dev-loader-restore-202610270740` |

## 8. 自评与独立核验

**结论：verified**

- 三项用户点名的修复均已恢复，并经脚本渲染 + 像素 A/B 证明有效，非「测试退出码 0」式验收
- 顺带修掉一个基线遗留失败，回归从 42/43 提升到 43/43
- 部署采用硬链接克隆 + 断链覆盖 + 原子切链，旧 release 回滚点完好
- 遗留：线上真机浏览器截图未取得（环境限制，已如实记录并用 md5 等价间接闭环）
