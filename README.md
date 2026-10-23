# 土拨鼠大作战 3D

这是一个基于 Three.js 原生 ES module 的浏览器 3D 闯关游戏。玩家从第一人称低机位操控土拨鼠，在草原场景中采食、驱退藏狐、救援伙伴并回到洞穴。当前主线代码位于 `src/`，默认入口是根目录 `index.html`。

项目采用零构建、零运行时安装的静态架构：Three.js 和游戏资源放在仓库内，页面通过本地模块路径加载。它适合直接部署到静态文件服务，也适合在没有外网的环境中运行；ES module 仍要求通过 HTTP 访问，不能直接用 `file://` 双击 HTML。

如果这个项目对你有帮助，欢迎在 [爱发电](https://afdian.com/a/catten) 支持作者继续开发。

## 当前版本与运行

默认 URL 是稳定主线：

```text
/index.html
```

`?version=dev` 打开源码中保留的生态学实验版。它会切换到草本食物、较高的耐饥渴容错、季节食物和 GS 场景等 dev 特性；不带该参数时使用稳定版的浆果与程序化主线。当前源码只识别稳定版和 `dev`，没有 beta 运行模式；`DEPLOY.md` 中的旧版 URL 是部署历史记录，不代表当前入口新增了 `version=old` 路由。

其他调试参数由 `src/core/version.js` 和入口代码处理：

- `?models=off`：关闭真实模型，回退到程序化模型。
- `?foxmodel=off`：关闭真实藏狐模型，回退到程序化藏狐。
- `?gs=1` / `?gs=0`：强制打开或关闭 GS 全场景覆盖开关。
- `?version=dev&webgl=1`：dev 场景中强制走 WebGL 排障路径。
- `?test=1`：显示开发测试面板并冻结测试计时；仅用于调试。

本地运行不需要安装 npm 依赖：

```bash
node tools/serve.cjs 8200
```

然后打开 <http://127.0.0.1:8200/>。也可以使用 `python3 -m http.server 8200`。生产稳定版部署地址记录在 `DEPLOY.md`：<https://www.catten.cyou/marmot3d/>。

## 主线玩法

主线共有 12 个关卡，关卡表定义在 `src/core/config.js`，每关会组合采食目标、驱退数量、伙伴位置、时间限制以及雾、阵风、沙尘等环境条件。通关条件是采食达标、驱退规定数量的藏狐、让伙伴安全回到洞穴，然后回洞进入下一关。

洞穴是安全区，玩家可以在其中恢复储备并降低压力；藏狐被攻击到耗尽体力后会逃跑，玩法语义是驱离而不是击杀。奔跑会连续压低姿态，停止后缓慢起身；跳跃是用于躲避接触攻击的短促小跳。第一人称和第三人称视角由 `V` 切换，渲染、地形、模型和狐狸行为分别由 `src/core/`、`src/world/`、`src/models/` 与 `src/entities/`、`src/systems/` 中的模块实现。

桌面端默认兼容方案如下，右上角设置面板还提供优化和自定义方案：

| 输入 | 作用 |
| --- | --- |
| 鼠标 | 视角；进入游戏后使用 Pointer Lock |
| `WASD` / 方向键 | 移动 |
| 左键 / 空格 | 攻击（兼容方案） |
| 右键 / `F` | 跳跃（兼容方案） |
| `J` / `K` / `E` | 应急爆发 / 协同大招 / 救援或陪伴 |
| `Shift` | 疾行 |
| `P` / `T` / `R` | 暂停 / 重试本关 / 从第一关重开 |
| `F11` | 全屏 |

优化方案把攻击交给鼠标左键，把技能集中到 `Q-E-R`，把交互放到 `F`；实际生效键位以设置面板和 `src/core/keybinds.js` 为准。

触屏端使用左侧移动轮盘、右侧独立 look 区和动作按钮。轮盘遵循 twin-axis 语义：横轴 `x` 只负责转向，纵轴 `y` 只负责前后油门；纯水平输入原地转向，斜推时横轴不会增加速度，倒车时左右转向反向。轮盘不会写入相机 yaw，右侧 look 区仍独立控制视角。对应逻辑在 `src/core/move-facing.mjs`，控制器接入在 `src/core/controls.js`。

## 静态资源与离线边界

根 `index.html` 通过 import map 指向 `vendor/three*.js`，再动态加载 `src/main.js`。默认运行时没有 CDN、包管理器安装或网络 API 依赖；真实模型和场景资源使用仓库内的 `assets/` 文件，加载失败时部分对象会回退到程序化模型。

`tools/serve.cjs` 只是零依赖静态服务器，不包含构建步骤。浏览器渲染、Pointer Lock、触屏 Pointer Events、WebGPU 能力和模型显示仍取决于运行环境；本仓库的 Node 测试不能替代真实浏览器验证。

## 测试与检查

触控轮盘的纯逻辑回归：

```bash
node tools/test-touch-drive.cjs
node tools/test-tps-drive.cjs
```

旁路 Rapier + TypeScript 切片的检查：

```bash
node /usr/lib/node_modules/openclaw/node_modules/typescript/lib/tsc.js \
  -p tsconfig.rapier-slice.json --noEmit
node --test experiments/rapier-ts/test/*.test.mjs
```

仓库还保留多份历史回归脚本（`tools/test-*.cjs`）。其中不少脚本会启动 Chrome、静态服务器或读取浏览器调试端口；运行前应先确认环境允许浏览器测试。当前没有统一的 npm test runner，也没有 `package.json`。

## 隔离的 Rapier / TypeScript 切片

`experiments/rapier-ts/` 是一个旁路验证层，用于验证未来逐步迁移所需的最小物理接口。它包含固定步长世界、确定性高度场、四面边界、胶囊体角色控制器和 TypeScript 类型接口；本地 vendored 的 `@dimforge/rapier3d-compat` 固定为 `0.21.0`，测试直接从相对路径加载本地模块。

这部分不会被根 `index.html`、`src/main.js`、默认控制器、默认静态路由或部署入口引用，也不会替换当前的 Three.js 控制器和碰撞实现。它使用自己的简化高度场和边界，不能代表现有 GS 地形、角色动画、攻击规则或生产碰撞；目前只完成 TypeScript 编译检查和 Node 离线测试，没有进行浏览器加载验证。后续若要迁移，应先做高度采样、接地、斜坡、边界和行为对照，再逐个接入主线并保留回滚路径。

目录说明：

- `experiments/rapier-ts/src/`：Rapier 世界、玩家控制器、高度场适配器和类型。
- `experiments/rapier-ts/test/`：原生 Node 测试。
- `experiments/rapier-ts/vendor/`：本地 Rapier compat 包及其 wasm 资源。
- `tsconfig.rapier-slice.json`：只包含该切片 TypeScript 源码和声明文件的配置。

## 支持开发

欢迎在 [爱发电](https://afdian.com/a/catten) 支持《土拨鼠大作战 3D》的持续开发。

## 目录速览

- `index.html`：稳定 / dev 共用的网页入口和触屏 DOM。
- `src/main.js`：主循环、关卡状态、HUD 和玩法编排。
- `src/core/`：配置、版本开关、输入、控制器和工具。
- `src/world/`、`src/models/`、`src/entities/`、`src/systems/`：地形、模型、实体与玩法系统。
- `src/gs/`：dev / GS 场景路径。
- `tools/`：静态服务器、诊断脚本和回归测试。
- `DEPLOY.md`：部署地址和历史版本路径记录。
