# Beta rev56 PAF 坦克操控与土拨鼠翻滚方向发布记录

- 日期：2026-10-30
- 通道：Beta only；Dev/Stable 未发布、未修改。
- PAF feature：`25951cb`（坦克操控）→ `f3e53c3`（转向符号修正）
- 翻滚 feature：`5d1699f`（实现）、`5ac9d4d`（报告）
- merge：`7cf4f23`（PAF）、`29b9602`（翻滚）
- 发布提交：`708472c1b855500096e0978ea239220f3f022593`
- 版本戳：`rev56`

## 内容

### PAF 坦克操控
- W/S 沿狐狸当前朝向前后移动；A/D 与左右方向键、轮盘左右只改变朝向，不产生侧向平移。
- 触屏摇杆纵轴为油门、横轴为转向，保留径向死区与对角归一化。
- 扑击起跳瞬间的方向选择与普通移动分离，仍独立读取按键/轮盘。
- 设置打开与暂停阻断输入；暂停与退出释放已按住的键与触屏状态。

### 转向符号修正（主控打回后）
- 首版 `turn = right - left` 在 PAF 坐标系（狐狸朝 +Z，右手方向 `(-cos, 0, sin)`）下会导致 D 左转、A 右转，与同文件鼠标 `fox.yaw -= movementX` 自相矛盾，且其测试编码了同一错误约定。
- 修正为 `turn = left - right`、`mapPafJoystick` 恢复 `turn: -x`、扑击选向按狐狸自身右手重定符号；测试改为屏幕空间点积断言。

### 土拨鼠翻滚方向
- 键鼠无方向输入时默认向相机右侧翻滚，不再被残余速度或身体朝向抢走。
- 翻滚起始瞬间按住 WASD 或移动轮盘，则按该输入的相机相对合成方向翻滚（AW 左前、SD 右后）。
- 独立翻滚拖拽定向优先保留；方向在动作起始锁存，滚动途中输入变化不改变方向。
- 触屏无输入时保留原有的速度/身体朝向回退；普通移动系统未改动。

## 主控验收

- 改动 JS/MJS `node --check` 全部通过。
- PAF 聚焦测试 44/44；PAF 分支全量 `node tools/run-node-tests.cjs` 91/91。
- 翻滚专测通过；翻滚分支全量 92/92。
- 集成树升版后全量 92/92；`node tools/test-beta-contract.cjs` 通过；`node tools/public-shell.cjs --check` 通过。
- `index-public.html`：6 处 rev56、0 处 rev55；`src/core/version.js` 的 `BUILD_STAMP = 'rev56'`。
- `git diff --check` 通过；`index-public.html` / `index.html` / `src/core/version.js` / `tools/public-shell.cjs` 由 `node tools/public-shell.cjs` 生成。
- 22 个 browser/CDP 脚本按 runner 规则跳过，不计通过；未做实体手机与硬件 GPU 验收。

### 独立坐标复验（主控自写脚本，不采信 worker 自述）
- PAF：狐狸自身右手 `cross(forward, up)`；修正后 D/A/W/S、摇杆左右拖、扑击选向的方向向量与自身右手的点积全部符号正确。
- 翻滚：与生产 `resolveMoveIntent` 的世界向量点积在 D/A/W/S/AW/SD 六种输入下均为 1.000000。

## 推送

- `origin/integ/beta-rev46` = `708472c1b855500096e0978ea239220f3f022593`，与本地 `ls-remote` 一致。
- 推送时使用 `git -c http.proxy= -c https.proxy=` 直连，绕开仓库内已失效的 `127.0.0.1:7890` 代理配置。

## 部署与回滚

- 当前：`/var/www/marmot3d-beta -> /var/www/m3d-releases/beta-rev56-paf-tank-roll-202610302010`
- 回滚：`/var/www/.last-beta-link` 内容为 `/var/www/m3d-releases/beta-rev55-paf-audio-settings-202610301750`
- 使用 rev55 硬链接克隆，12 个文件用 `cp --remove-destination` 覆盖；覆盖前后 rev55 关键文件哈希逐个校验未变，rev54 回滚目录完好。
- 暂存文件与线上文件 SHA-256 全部一致后才用临时 symlink + `mv -T` 原子切链，临时链接已清理。
- 公网 `https://www.catten.cyou/marmot3d-beta/` 返回 200；`index-public.html` 公网与本地逐字节一致（`f7f77a5d…`）；`src/main.js`、`src/core/combat-wheel.mjs`、`src/core/paf-input.js`、`src/play/play-as-fox.js`、`src/core/version.js` 公网哈希与本地一致。
- 发布后未运行 CDP；仅执行 HTTP、版本戳与哈希复验。

## 服务器磁盘处置

- 部署前根分区 100%（仅剩 226MB）。经确认线上仅 `marmot3d`（dev-sandbox-hotfix）、`marmot3d-beta`（rev55）与 `marmot3d-babylon` 被引用，`.last-beta-link` 指向 rev54。
- 仅删除**无人引用且已被 rev54/rev55 取代**的旧 beta 发布目录（rev39–rev53，共 16 个），释放约 1909MB；rev54（回滚点）与 rev55（上一版）完整保留，dev/babylon 目录未动。
- 处置后根分区 95%（剩余 1.2GB）。

## 保留限制

- 22 个 browser/CDP 测试跳过，未做真实浏览器交互与实体手机触控验收；触屏手感与键盘手感仍需用户实测。
- 未做硬件 GPU / WebGPU 与弱网验收。
- PAF 扑击方向的弧形夹取与速度、伤害、体力、AI 平衡未改动。
