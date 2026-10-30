# Beta rev55 PAF 音频与设置修复发布记录

- 日期：2026-10-30
- 通道：Beta only；Dev/Stable 未发布、未修改。
- feature：`c66a6d611f5d499c82957ce55fb13ac2fbce3dcf`
- merge：`740f0a0`
- 发布提交：`8b440e0fcdb064e0d4724d536a918b9fd921f1d6`
- 版本戳：`rev55`

## 内容

- PAF TOS/local 网络、超时与解码失败回退，失败缓存清理和恢复重试。
- 程序回退音乐按真实 PAF 文件解码样本 RMS 标定；不宣称 RMS 等于 LUFS。
- PAF 设置按钮恢复，设置暂停/恢复路由到 PAF 自身并清理输入，不影响普通模式暂停语义。

## 主控验收

- 改动 JS/MJS `node --check` 通过。
- PAF focused：5/5；TOS preload：7/7。
- 集成后 `node tools/run-node-tests.cjs`：**91/91**；22 个 browser/CDP 脚本按 runner 规则跳过，不计通过。
- `node tools/test-beta-contract.cjs` 通过。
- `node tools/public-shell.cjs --check` 通过。
- `index-public.html`：6 处 rev55、0 处 rev54。
- `git diff --check` 通过。
- 用户于 2026-10-30 17:44 明确授权 push/deploy，并豁免剩余 PAF 测试与 Beta CDP 发布门槛；未把桌面设置 CDP 失败记录说成通过。

## 推送

- `origin/fix/beta-paf-audio-20261030` = `c66a6d611f5d499c82957ce55fb13ac2fbce3dcf`
- `origin/integ/beta-rev46` = `8b440e0fcdb064e0d4724d536a918b9fd921f1d6`（发布提交推送时）
- 本地与 `ls-remote` SHA 一致。

## 部署与回滚

- 当前：`/var/www/marmot3d-beta -> /var/www/m3d-releases/beta-rev55-paf-audio-settings-202610301750`
- 回滚：`/var/www/.last-beta-link` 内容为 `/var/www/m3d-releases/beta-rev54-smartfox-paf-202610301315`
- 使用 rev54 硬链接克隆，仅覆盖 6 个运行文件；所有覆盖使用 `cp --remove-destination`，写入前/后 rev54 关键文件哈希不变。
- 暂存文件与本地 SHA-256 全部一致后，使用临时 symlink + `mv -T` 原子切链。
- 公网 `https://www.catten.cyou/marmot3d-beta/` 与线上 `index-public.html` 逐字节一致。
- 本地、服务器、公网的 `index-public.html`、`src/core/version.js`、`src/core/settings-pause.mjs`、`src/main.js`、`src/systems/audio.js`、`src/play/play-as-fox.js` SHA-256 全部一致。
- 按用户要求，发布后未运行 CDP；仅执行 HTTP、版本戳和哈希复验。

## 保留限制

- 桌面设置 CDP 交互仍未完成；既有证据中 open/close 为 `hidden=true, paused=false`，不作为通过证据。
- 未做实体手机、更多浏览器矩阵、主观听感或 LUFS 等值测试。
- 这些剩余测试已由用户明确豁免，不影响本次按授权发布的事实记录。
