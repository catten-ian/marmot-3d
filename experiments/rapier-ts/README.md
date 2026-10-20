# Rapier + TypeScript 旁路切片

这个目录是当前 Marmot3D 主线旁边的隔离验证层。它不会被根目录的 `index.html` 或 `src/main.js` 引用，也不会替换现有控制器、碰撞或部署流程。现有游戏仍然是零构建、静态文件和原生 ES module；本切片只证明后续逐文件迁移所需的最小接口。

## 内容

- `src/physicsWorld.ts`：异步初始化本地 Rapier，固定步长世界，确定性高度场、四面边界和玩家胶囊体。
- `src/playerController.ts`：消费 `{ forward, back, turn }`，处理 yaw、水平速度、重力和接地；通过 `MovementResolver` 与物理实现解耦。
- `src/heightfieldAdapter.ts`：生成小型确定性高度场并提供双线性采样，不读取现有 GS 或 Three.js 资源。
- `src/types.ts`：输入、玩家状态、高度采样器、固定步长事件等迁移接口。
- `test/slice.test.mjs`：Node 原生测试，验证离线初始化、Rapier 版本、固定步长、胶囊体接地和边界碰撞。
- `vendor/@dimforge/rapier3d-compat/`：随切片保存的本地副本，保留 `LICENSE`、`README.md`、`package.json`、`.d.ts`、`.mjs`、`.cjs` 和 wasm 文件。

Rapier 版本固定为 **0.21.0**。如果未来创建独立实验页，浏览器入口应使用 vendor 内的相对 `.mjs` 路径；compat 构建把 wasm 初始化数据内联在本地模块中，因此运行时不访问 CDN。vendor 中的上游 package metadata 和说明文件仍保留原始仓库信息，但它们不会成为运行时网络依赖。

## 检查和测试

在仓库根目录运行：

```sh
node /usr/lib/node_modules/openclaw/node_modules/typescript/lib/tsc.js \
  -p tsconfig.rapier-slice.json --noEmit
node --test experiments/rapier-ts/test/*.test.mjs
```

`tsconfig.rapier-slice.json` 只 include `experiments/rapier-ts/src/**/*.ts` 和本目录的少量声明文件，不开启全仓 `checkJs`，不创建根目录 `node_modules` 或 lockfile。

## 未来迁移顺序

1. 在父级 Chrome 中验证一个独立实验页能从 `experiments/rapier-ts/` 相对路径加载模块，并记录 wasm 初始化、接地和边界结果。
2. 为现有输入层增加只读适配器，把按键或 twin-axis 输入转换成 `PlayerInput`，继续保留现有运行路径。
3. 为现有地形建立只读 `HeightSampler` 适配器，先用采样对照测试校准坐标、尺度和高度范围。
4. 将渲染对象改为消费 `PlayerState` 快照，保持物理步长和渲染帧解耦。
5. 只有当行为对照、性能和回滚开关都通过父级验证后，才逐文件迁移一个玩法子系统；每一步都保留旧控制器旁路和可删除的实验目录。

切换到 Rapier 前至少需要：离线浏览器初始化成功；固定步长结果在多次运行中一致；地形采样、胶囊体接地、斜坡和边界与现有玩法有可接受的对照记录；没有把 Rapier import 接入默认入口；并且有明确的回滚开关。回滚只需删除或忽略 `experiments/rapier-ts/` 及 `tsconfig.rapier-slice.json`，不会触及现有游戏文件。

## 当前边界和风险

这里使用简化高度场和四面墙，不能代表现有 GS 地形、角色尺寸、动画、攻击或碰撞规则。`playerController.ts` 的状态模型也还没有接入现有相机和渲染层。Rapier compat vendor 约 15 MB，未来若纳入部署包需要单独评估缓存和加载成本。Node 测试覆盖 wasm 初始化；真实浏览器仍需父级 Chrome 做一次离线静态加载验证。
