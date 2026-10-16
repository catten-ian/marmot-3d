/**
 * 主入口：装配所有系统，驱动主循环与游戏状态机。
 *
 * 游戏状态：title → play ⇄ pause → (won | lost) → play ...
 * 核心玩法循环（移植自 2D 原版）：
 *   采食恢复储备 → 自卫应对藏狐 → 拉负荷过载惩罚 →
 *   救伙伴带回洞穴 → 完成三目标回洞 → 下一关
 */
import * as THREE from 'three';
import {
  LEVELS, BERRY_POINTS, SPAWN_POINTS, BURROW, PLAYER, FOX,
  BERRY_RADIUS, BERRY_ENERGY, BERRY_CHARGE, RESCUE_DIST,
  typesForLevel, setPointScale, scalePoint, scaleCoord, scaleRadius,
  getPointScale, fieldHalf, FIELD_W, FIELD_H,
} from './core/config.js';
import { clamp, terrainHeight, setHeightField, heightFieldActive } from './core/utils.js';
import { FirstPersonController } from './core/controls.js';
import { dampAngle } from './core/move-facing.mjs';
import { selectAttackMove, selectAttackMoveFromInput } from './core/combat-wheel.mjs';
import { objectivesComplete } from './core/objectives.js';
import { Keybinds, ACTIONS, findConflicts } from './core/keybinds.js';
import { preloadModels } from './models/loader.js';
import { buildBackdrop } from './models/scene.js';
import { createRenderer, splatUsable } from './core/renderer.js';
import { getRenderProfile, isTouchPrimary } from './core/performance.js';
import { TouchControls } from './core/touch-controls.js';

let TOUCH_DEVICE = isTouchPrimary();
/** 微信/QQ X5 等内置浏览器可能谎报指针能力；首次真实触摸时升级为触屏模式。 */
function enableTouchRuntime() {
  if (TOUCH_DEVICE) return;
  TOUCH_DEVICE = true;
  try { touchControls?.activate?.(); } catch (_) {}
  document.body.classList.add('touch-mode');
}

/** 真实模型加载结果（供调试接口查看） */
let modelLoadState = null;
/** 远景布景根节点 */
let backdropRoot = null;
import { Sky } from './world/scene.js';
import { Scenery } from './world/props.js';
import { createBurrows } from './world/burrows.js';
import { burrowVolumeAt } from './world/underground.js';
import { Fox } from './entities/fox.js';
import { Food, Companion, buildMarmotMesh } from './entities/props_entities.js';
import { devOn, IS_DEV, USE_REAL_FOX_MODEL, VERSION_LABEL } from './core/version.js';
import {
  plantsForLevel, seasonForLevel, energyOfPlant, eatLine, HERBIVORE,
} from './core/ecology.js';
import {
  combatStats, strikeVolumeHit, foxAttackVerticalHit, burst, ultimate, interact,
  STRIKE_COST, ULT,
} from './systems/combat.js';
import { ClawSwing, Shockwave, Particles, DamageText, PlayerAura } from './systems/effects.js';
import { ViewModel } from './systems/viewmodel.js';
import { Audio } from './systems/audio.js';
import { HUD } from './ui/hud.js';
import { SettingsUI } from './ui/settings.js';
import { TouchLayout } from './ui/touch-layout.js';
import { Minimap } from './ui/minimap.js';
import { cooldownOverlayData } from './ui/cooldown-overlay.js';
import { createSandboxState, SANDBOX_LEVEL } from './sandbox/state.js';
import { applySandboxDifficulty, spawnSandboxFoxes, clearSandboxFoxes } from './sandbox/commands.js';
import { setupSandboxPanel } from './sandbox/panel.js';

// ============================================================
// 初始化
// ============================================================
const canvas = document.getElementById('scene');
const hud = new HUD();
const audio = new Audio();

hud.setLoading(8);

/**
 * 渲染器与 three 实例。
 *
 * dev 版（GS 全场景）需要 WebGPURenderer —— 它必须 `await renderer.init()`，
 * 是异步的；而本模块是同步的顶层 ES 模块。
 * 解法：index.html 的引导层先探测 WebGPU 能力并把结果挂在 window.__boot，
 * 这里同步读取。需要 GS 时用 WebGPURenderer 并**立即调用 init()**
 * （three 的 init 在未 await 时会内部同步走一部分，first frame 才补齐管线，
 *   实际使用时只要保证渲染循环在 init 完成后再启动即可 —— 见下方 boot()）。
 *
 * 稳定版完全走原来的 WebGLRenderer 路径，不受任何影响。
 */
const BOOT = (typeof window !== 'undefined' && window.__boot) || {
  gsWorld: false, gpuOk: false, gpuReason: '', forceWebGL: false,
};
const WANT_GS = BOOT.gsWorld === true;

let renderer;
let rendererStatus = { backend: 'webgl', supportsSplat: false, gpuReason: '' };
let renderProfile = getRenderProfile();

if (WANT_GS) {
  const result = await createRenderer(canvas, {
    preferWebGPU: true,
    forceWebGL: BOOT.forceWebGL,
  });
  renderer = result.renderer;
  rendererStatus = {
    backend: result.status.backend,
    supportsSplat: splatUsable(result),
    gpuReason: result.status.gpuReason,
  };
} else {
  renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: renderProfile.antialias,
    powerPreference: 'high-performance',
    stencil: false,
  });
}

renderProfile = getRenderProfile();
renderer.setPixelRatio(renderProfile.pixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
if ('shadowMap' in renderer) {
  renderer.shadowMap.enabled = renderProfile.shadows;
  renderer.shadowMap.type = THREE.PCFShadowMap;
}
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
// 曝光过高会把贴地的草地照成一片死白，0.92 是既能保留高光又不溢出的值
renderer.toneMappingExposure = 0.92;

// 如实显示后端徽标：不能让「跑在 WebGL2 兜底上」被误认为「跑在 WebGPU 上」
{
  const tag = document.getElementById('backendTag');
  if (tag && WANT_GS) {
    const label = rendererStatus.backend === 'webgpu' ? 'WebGPU'
      : 'WebGL2 兜底（非 WebGPU）';
    tag.textContent = label;
    tag.classList.remove('hidden');
    tag.style.color = rendererStatus.backend === 'webgpu' ? '#9fe6a0' : '#ffb35a';
    tag.title = rendererStatus.gpuReason || '高斯泼溅需要 WebGPURenderer';
  }
}

hud.setLoading(22);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(
  // far 必须大于天穹球半径(900)，否则天空会被裁掉
  78, window.innerWidth / window.innerHeight, 0.05, 1600,
);

const sky = new Sky(scene, renderer);
hud.setLoading(45);

// —— GS 全场景（dev 版）——
// 把摄影测量高斯泼溅当作**全部场景**（含可行走地面）：
//   · 地面高度改用点云建出的高度场（通过 setHeightField 注入，
//     全场 6 个模块会自动跟随，不需要逐处改）
//   · 程序化地形网格整体隐藏（否则会和 GS 地面重叠打架）
//   · 天穹/远山/摄影网格远景全部隐藏（GS 已经提供了真实远景）
//
// 尺度适配（实测 + 用户方案）：SPZ 里只有 3% 是连续开阔地，
// 最大可行走正方形边长 32 源单位；放大 3.4 倍后正好铺满 108×65m，
// 与原竞技场 130×78 的内区相当，玩法数值不用改。
let gsWorld = null;
let gsStats = null;
if (WANT_GS && rendererStatus.supportsSplat) {
  try {
    hud.setLoading(48);
    const { buildGsWorld, GS_AREA } = await import('./gs/world.js');
    // 注意：这里 import 的 world.js 用的 `three`，而渲染器走的是
    // `three/webgpu` 入口。两者共享同一个 three.module.js 核心
    // （three.webgpu.js 里 re-export 了 core），Object3D/Group 等
    // 基类实例可以互通；GaussianSplat 必须在 WebGPU 渲染器下用，
    // 而它正是为此而导入 `three/webgpu` 的。
    gsWorld = await buildGsWorld({ area: GS_AREA });
    if (gsWorld) {
      scene.add(gsWorld.group);
      setHeightField(gsWorld.heightAt);
      gsStats = gsWorld.stats;

      // 点位缩放：把 130×78 的活动范围映射到 GS 的可行走区（108×65m）。
      // 系数 = 可行走宽 / 原竞技场宽，这样所有点位（洞穴、藏狐刷点、
      // 采食点、岩石）都会落在 GS 有点云数据的区域内。
      const K = gsStats.walkW / FIELD_W;
      setPointScale(K, 0, 0);
      console.info(`[gs] 点位缩放系数 ${K.toFixed(3)}（可行走 ${gsStats.walkW}×${gsStats.walkH}m）`);

      hud.say(
        `GS 全场景：${(gsStats.splatCount / 10000).toFixed(1)} 万泼溅 · ` +
        `可行走 ${gsStats.walkW}×${gsStats.walkH}m`,
        5.0,
      );
    } else {
      hud.say('GS 场景加载失败，已退回程序化地形', 4.5);
    }
  } catch (e) {
    console.warn('[gs] GS 全场景初始化失败，退回程序化地形:', e);
    gsWorld = null;
    hud.say('GS 场景不可用：' + (e && e.message || e), 4.5);
  }
  hud.setLoading(60);
}

/**
 * 洞穴位置与半径（随点位缩放）。
 *
 * 必须在 new Burrow() **之前**算好 —— Burrow 构造时会把位置写进几何体，
 * 之后再改就只影响逻辑判定、不影响外观（两者会错位）。
 *
 * 稳定版缩放系数为 1，这里等价于原始常量。
 */
const PT_K = getPointScale();
const burrowSet = createBurrows(scene);
const burrowDefs = burrowSet.defs;
const baseBurrow = burrowSet.base;
const BURROW_R = baseBurrow.r;
const BURROW_X = baseBurrow.x;
const BURROW_Z = baseBurrow.z;
const burrow = burrowSet.baseObject;
const scenery = new Scenery(scene);
hud.setLoading(70);

// GS 全场景下，程序化布景必须让位：
//  · 程序化地形（会和 GS 地面重叠）
//  · 远山剪影（GS 本身就是远景）
//  · 天穹（GS 有真实天空）
//  · 摄影网格远景（GS 铺满了整个视野）
if (gsWorld) {
  // terrain / hills / dome 都由 Sky 构建（见 world/scene.js），挂在 sky 上而非 scenery
  if (sky.terrain) sky.terrain.visible = false;
  if (sky.hills) sky.hills.visible = false;
  if (sky.dome) sky.dome.visible = false;
}

// —— 采食目标 ——
// 正式版：浆果（v1.0 造型，一次建好）
// dev 版：草本植物（随关卡季节变化，需在每关开始时按当季物种重建）
let berries = [];
function buildFoods(levelIndex) {
  if (devOn('seasonalFood')) {
    const plants = plantsForLevel(levelIndex, BERRY_POINTS.length);
    return BERRY_POINTS.map((p, i) => {
      const [x, z] = scalePoint(p);
      return new Food(scene, x, z, i, plants[i]);
    });
  }
  if (!berries.length || berries[0].herbivore) {
    berries = BERRY_POINTS.map((p, i) => {
      const [x, z] = scalePoint(p);
      return new Food(scene, x, z, i, null);
    });
  }
  return berries;
}
berries = buildFoods(0);
const companion = new Companion(scene);
const minimap = new Minimap();
let foxes = [];
hud.setLoading(86);

// —— 系统 ——
const controller = new FirstPersonController(camera, canvas);
const claw = new ClawSwing(scene);
const shockwave = new Shockwave(scene);
const particles = new Particles(scene);
const damageText = new DamageText(scene);
const aura = new PlayerAura(scene);
const viewModel = new ViewModel();
viewModel.resize(window.innerWidth / window.innerHeight);

const playerModel = new THREE.Group();
const playerBody = buildMarmotMesh();
playerModel.add(playerBody);
scene.add(playerModel);
playerModel.visible = false;

const VIEW_MODE_KEY = 'marmot3d.viewMode.v1';
let thirdPerson = false;
try { thirdPerson = localStorage.getItem(VIEW_MODE_KEY) === 'third-person'; } catch (_) { /* storage may be unavailable */ }

function setViewMode(enabled, announce = false) {
  thirdPerson = !!enabled;
  controller.setThirdPerson(thirdPerson);
  playerModel.visible = thirdPerson;
  if (viewBtn) {
    viewBtn.textContent = thirdPerson ? '第三人称' : '第一人称';
    viewBtn.setAttribute('aria-pressed', String(thirdPerson));
    viewBtn.title = thirdPerson ? '切换第一人称视角 (V)' : '切换第三人称视角 (V)';
  }
  document.body.classList.toggle('third-person', thirdPerson);
  try { localStorage.setItem(VIEW_MODE_KEY, thirdPerson ? 'third-person' : 'first-person'); } catch (_) { /* storage may be unavailable */ }
  if (announce) hud.say(thirdPerson ? '已切换到第三人称视角' : '已切换到第一人称视角', 1.8);
}

const viewBtn = document.getElementById('viewBtn');
if (viewBtn) viewBtn.onclick = () => setViewMode(!thirdPerson, true);
setViewMode(thirdPerson);

// —— 真实模型预加载（含分级回退）——
// 异步进行，不阻塞游戏启动。返回每一档的加载级别：
//   'full' 完整（几何+贴图） / 'geometry-only' 仅几何（贴图解码失败）
//   'procedural' 回退到程序化建模 / 'timeout' / 'failed'
const FOX_PRELOAD_FILE = IS_DEV && USE_REAL_FOX_MODEL ? 'fox-segmented.glb' : 'fox.glb';
preloadModels('./assets/models/', { foxFile: FOX_PRELOAD_FILE }).then((st) => {
  modelLoadState = st;
  console.info('[models] 真实模型就绪情况:', st);
  // 明确告知玩家当前处于哪一档 —— "模型没加载出来"时最需要的就是这个信息，
  // 否则只能看到一只没有毛色的狐狸，却不知道为什么。
  const labels = {
    full: '完整',
    'geometry-only': '仅几何（贴图不可用）',
    'loading-slow': '加载较慢（程序化模型可见）',
    procedural: '程序化兜底',
    timeout: '加载超时',
    failed: '加载失败',
    pending: '未加载',
  };
  const parts = [];
  if (st.marmot && st.marmot !== 'full') parts.push(`土拨鼠 ${labels[st.marmot] || st.marmot}`);
  if (st.fox && st.fox !== 'full') parts.push(`藏狐 ${labels[st.fox] || st.fox}`);
  if (parts.length) {
    hud.say(`模型：${parts.join(' · ')}`, 5.5);
  }
});

// —— 场景远景 ——
// 用户提供的摄影测量地形块沿椭圆环（rx 246m / rz 218m）复制 14 份，
// 围成地平线上的一圈树林草甸（详见 models/scene.js 的 buildBackdrop）。
// 可行走地形仍是程序化生成的，保证玩法参数（130×78 竞技场、
// 藏狐速度、跳跃距离等）完全不变。
// 环形布局是固定在世界坐标的，**不跟随玩家位移** —— 一旦跟随，
// 玩家转身就会看到"贴着的那份消失了、背后的露出来"，反而更假。
buildBackdrop().then((root) => {
  if (root) {
    scene.add(root);
    backdropRoot = root;
    const ud = root.userData || {};
    console.info(`[scene] 远景布景已加入：${ud.count} 份 @ 半径 ${ud.radius}m`);
  }
});

const keys = new Set();
controller.keys = keys;

hud.setLoading(96);

// —— 版本角标 ——
// dev 版（?version=dev）是"按旱獭真实生态学改写"的实验分支，
// 与正式版并存但互不影响，页面上明确标出以便对照。
{
  const tag = document.getElementById('versionTag');
  if (tag) {
    tag.className = `version-tag ${IS_DEV ? 'dev' : 'stable'}`;
    tag.textContent = IS_DEV
      ? 'DEV · 旱獭生态学改写（草食 / 耐饥渴 / 季节食物）'
      : VERSION_LABEL;
    tag.title = IS_DEV
      ? '当前为 dev 实验版：采食对象为当季草本植物，储备消耗更低。正式版请去掉 ?version=dev'
      : '正式版。追加 ?version=dev 可体验生态学改写';
  }
  document.body.classList.toggle('dev-version', IS_DEV);
}

// ============================================================
// 游戏状态
// ============================================================
const PROGRESS_KEY = 'marmot3d.progress.v1';
function readProgress() {
  try {
    const saved = JSON.parse(localStorage.getItem(PROGRESS_KEY) || '{}');
    const maxUnlocked = Number.isInteger(saved.maxUnlocked) ? saved.maxUnlocked : 0;
    const completedLevels = Array.isArray(saved.completedLevels)
      ? saved.completedLevels.filter((n) => Number.isInteger(n) && n >= 0 && n < LEVELS.length)
      : [];
    return {
      maxUnlocked: clamp(maxUnlocked, 0, LEVELS.length - 1),
      completedLevels: new Set(completedLevels),
    };
  } catch (_) {
    return { maxUnlocked: 0, completedLevels: new Set() };
  }
}
const progress = readProgress();
function saveProgress() {
  try {
    localStorage.setItem(PROGRESS_KEY, JSON.stringify({
      maxUnlocked: progress.maxUnlocked,
      completedLevels: [...progress.completedLevels],
    }));
  } catch (err) {
    console.warn('[progress] 无法保存关卡进度:', err);
  }
}

const TEST_MODE = new URLSearchParams(location.search).get('test') === '1';
const SANDBOX_MODE = new URLSearchParams(location.search).get('sandbox') === '1';
const sandboxState = createSandboxState();
if (SANDBOX_MODE) sandboxState.active = true;
const TEST_LOG_LIMIT = 2000;
const testState = { godMode: TEST_MODE, freezeTimer: TEST_MODE };
const testLogs = [];
function recordTestLog(type, details = {}) {
  if (!TEST_MODE) return;
  testLogs.push({
    at: new Date().toISOString(),
    elapsed: Number(game.totalTime.toFixed(2)),
    level: game.level + 1,
    mode: game.mode,
    type,
    details,
  });
  if (testLogs.length > TEST_LOG_LIMIT) testLogs.splice(0, testLogs.length - TEST_LOG_LIMIT);
  const meta = document.getElementById('testLogMeta');
  if (meta) meta.textContent = `日志 ${testLogs.length} 条`;
}
function testSnapshot() {
  return {
    timestamp: new Date().toISOString(),
    url: location.href,
    version: VERSION_LABEL,
    game: {
      mode: game.mode, level: game.level + 1, time: Number(game.time.toFixed(2)),
      elapsed: Number(game.elapsed.toFixed(2)), totalTime: Number(game.totalTime.toFixed(2)),
      hp: game.player.hp, energy: Number(game.player.energy.toFixed(1)),
      stress: Number(game.player.stress.toFixed(1)), foodCount: game.foodCount,
      levelRepels: game.levelRepels, hits: game.hits, inBurrow: game.inBurrow,
    },
    test: { ...testState },
    player: { x: Number(controller.position.x.toFixed(2)), y: Number(controller.position.y.toFixed(2)),
      z: Number(controller.position.z.toFixed(2)), yaw: Number(controller.yaw.toFixed(3)) },
    foxes: foxes.map((fox) => ({ type: fox.type, state: fox.state, hp: Number(fox.hp.toFixed(1)),
      x: Number(fox.x.toFixed(2)), z: Number(fox.z.toFixed(2)) })),
  };
}
function exportTestLogs() {
  if (!TEST_MODE) return false;
  const payload = {
    format: 'marmot-3d-test-log', version: 1, exportedAt: new Date().toISOString(),
    appVersion: VERSION_LABEL, initialUrl: location.href,
    settings: { ...testState }, entries: testLogs.slice(), finalSnapshot: testSnapshot(),
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const href = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = href;
  a.download = `marmot-test-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
  return true;
}

const game = {
  testMode: TEST_MODE,
  freezeTimer: testState.freezeTimer,
  mode: 'title',
  level: 0,
  completed: 0,
  player: { x: 0, y: 0, z: 0, hp: 100, energy: 100, stress: 0, invuln: 0 },
  friend: { x: 0, z: 0, rescued: false, saved: false },
  foodCount: 0,
  levelRepels: 0,
  totalRepels: 0,
  bossDown: true,
  time: 115,
  elapsed: 0,
  totalTime: 0,
  boost: 0,
  boostCD: 0,
  attackCD: 0,
  social: 0,
  socialCD: 0,
  cortisol: 0,
  drive: 0,
  charge: 0,
  overdrive: 0,
  overCD: 0,
  fatigue: 0,
  boosts: 0,
  ultimates: 0,
  hits: 0,
  inBurrow: false,
  inBaseBurrow: false,
  currentBurrow: null,
  observing: false,
  stressWarned: false,
  season: null, // dev 版：当季食物信息（正式版恒为 null）
  sandbox: false,
  attackMoveLock: 0,
};

const colBoost = new THREE.Color(0xffd17a);
const colHit = new THREE.Color(0xffe3a4);
const colRepel = new THREE.Color(0xd8e8c0);
const colUlt = new THREE.Color(0xdeb0ff);
const colBerry = new THREE.Color(0xc46a5e);
// dev 版草本植物的碎屑用叶绿色
const colHerb = new THREE.Color(0xa8c07a);
const colHurt = new THREE.Color(0xeea091);

/**
 * 按关卡的类型池生成一只藏狐。
 *
 * 原来的逻辑是 `level>=2 && i%3===2 ? 'heavy' : ...` 这种硬编码，
 * 结果每关的敌人构成几乎一样，玩法自然单一。
 * 现在由 LEVELS[i].types 显式指定每关的敌人构成，
 * 新增关卡时只要改配置表即可，不用动代码。
 */
function makeFox(i) {
  const cfg = game.sandbox ? SANDBOX_LEVEL : LEVELS[game.level];
  const boss = cfg.boss && i === cfg.count - 1;
  const pool = typesForLevel(game.level);
  const [sx, sz] = scalePoint(SPAWN_POINTS[i % SPAWN_POINTS.length]);

  let type;
  if (boss) {
    type = 'boss';
  } else {
    // 从池中取，但避免同一关全是同一种：用索引错位打散，
    // 再留 30% 概率随机，保证池里每种都有出场机会。
    const picked = pool[i % pool.length];
    type = Math.random() < 0.3 ? pool[(Math.random() * pool.length) | 0] : picked;
  }
  return new Fox(scene, sx + (Math.random() - 0.5) * 4, sz + (Math.random() - 0.5) * 4,
    type, game.level, i, { lureBias: cfg.lureBias || 1 });
}

function spawnSandboxFox(type = sandboxState.selectedType, slot = foxes.length) {
  const distance = 8 + (slot % 3) * 2.4;
  const angle = controller.yaw + (slot - 1) * 0.24;
  const fox = new Fox(scene, controller.position.x + Math.sin(angle) * distance,
    controller.position.z + Math.cos(angle) * distance, type, 0, slot, { lureBias: 1.15 });
  fox.sandboxSpeedMul = sandboxState.speedMultiplier;
  fox.sandboxAlertMul = sandboxState.alertMultiplier;
  foxes.push(fox);
  return fox;
}

function disposeAllFoxes() { foxes.forEach((f) => f.dispose(scene)); foxes = []; }

function enterSandbox() {
  hud.hidePanel(); sandboxState.active = true; sandboxState.godMode = true; sandboxState.freezeTimer = true;
  game.sandbox = true; game.mode = 'play'; document.body.classList.add('sandbox-active');
  testModeBtn.hidden = false; testModeBtn.textContent = '沙盒控制';
  testState.godMode = true; testState.freezeTimer = true;
  loadLevel(0, false); disposeAllFoxes();
  for (let i = 0; i < 3; i++) spawnSandboxFox(i === 2 ? 'fast' : 'normal', i);
  game.time = Infinity; game.foodCount = 0; game.levelRepels = 0; game.player.hp = 100; game.player.energy = 100;
  game.player.stress = 0; game.charge = 100;
  applySandboxDifficulty(sandboxState, sandboxState.difficulty);
  if (!controller.touchEnabled) controller.requestLock();
}

function exitSandbox() {
  sandboxState.active = false; game.sandbox = false; document.body.classList.remove('sandbox-active');
  testModeBtn.hidden = !TEST_MODE; testModeBtn.textContent = '测试'; testPanel.hidden = true; title();
}

function loadLevel(index, announce = true) {
  game.level = index;
  const cfg = game.sandbox ? SANDBOX_LEVEL : LEVELS[index];

  // 重置玩家
  const p = game.player;
  p.hp = 100; p.energy = 100; p.stress = 0; p.invuln = 2;
  controller.teleport(BURROW_X + 4 * getPointScale(), BURROW_Z + 2 * getPointScale(), Math.PI * 0.05);
  // 出生朝向：看向场地中央
  controller.yaw = Math.atan2(-(0 - controller.position.x), -(0 - controller.position.z));
  controller.pitch = -0.06;

  // 重建藏狐
  foxes.forEach((f) => f.dispose(scene));
  foxes = Array.from({ length: cfg.count }, (_, i) => makeFox(i));

  // 重置采食目标
  // dev 版按当季物种重建（季节食物每关不同）：必须先 dispose 旧实例，
  // 否则旧 Food 的 Group 永远留在场景里，每关泄漏一整组（且 reset 还会让
  // 本该消失的旧植物重新可见）。正式版浆果只复用，reset 即可。
  if (devOn('seasonalFood')) {
    berries.forEach((b) => b.dispose(scene));
    berries = buildFoods(index);
    game.season = seasonForLevel(index);
  } else {
    berries.forEach((b) => b.reset());
    game.season = null;
  }
  scenery.resetBerries();
  game.foodCount = 0;

  // 重置伙伴（关卡配置里的点位是设计坐标，GS 版需经 scalePoint 缩放到运行时场地）
  const [friendX, friendZ] = scalePoint(cfg.friend);
  companion.placeAt(friendX, friendZ);
  game.friend = companion;

  game.levelRepels = 0;
  game.bossDown = !cfg.boss;
  game.time = game.sandbox ? Infinity : cfg.time;
  game.elapsed = 0;
  for (const k of ['boost', 'boostCD', 'attackCD', 'social', 'socialCD',
    'overdrive', 'overCD', 'fatigue', 'cortisol', 'drive']) {
    game[k] = 0;
  }
  game.charge = game.level >= 3 ? 65 : 35;
  game.stressWarned = false;
  recordTestLog('level-start', { name: cfg.name, configuredTime: cfg.time, test: { ...testState } });

  // —— 环境修饰：雾 / 阵风 / 沙尘 ——
  // 这是「关卡玩法单一」的主要解法：后期关卡不只加数量，
  // 而是改变玩家必须应对的物理条件。
  // 注意顺序：必须**先** applyEnvModifiers 设置 fog 基准值，
  // 再让 sky.applyLevel 重刷一次，这样关卡开局第一帧的雾就是对的
  // （否则会看到雾从默认值 70/420 渐变过来的一帧闪动）。
  env.gust = 0;            // 当前横风加速度（m/s²）
  env.gustPhase = 0;       // 风的相位，避免每关都从同一阵开始
  env.gustDir = 1;
  env.sandT = 0;           // 沙尘计时：0 = 平静
  env.sandOn = false;
  env._msgOn = false;
  applyEnvModifiers(cfg);

  sky.applyLevel(cfg);
  // applyLevel 只改雾色，这里补上关卡的能见度（near/far）
  scene.fog.near = env.fogBase;
  scene.fog.far = env.fogFarBase;

  if (announce) {
    game.mode = 'play';
    const tip = cfg.brief || cfg.subtitle || '';
    hud.say(`第 ${index + 1} 关 · ${cfg.name} — ${tip}`, 4.6);
    hud.banner(`第 ${index + 1} 关 · ${cfg.name}`, 2.2);
  }
}

/**
 * 环境修饰状态。
 * 单独放一个对象而不是散落成 game.* 的原因：
 * 这三者（雾、风、沙尘）是**每帧连续变化**的环境量，
 * 与"关卡进度"这类离散状态混在一起会让 update() 难以阅读。
 */
const env = {
  gust: 0,        // 当前横风加速度
  gustMax: 0,     // 本关阵风峰值
  gustPhase: 0,
  gustDir: 1,     // 风向（+1 / -1，横风沿 X 轴）
  sandT: 0,       // 沙尘周期计时
  sandOn: false,  // 沙尘是否正在弥漫
  fogBase: 70,    // 本关雾的 near
  fogFarBase: 420,// 本关雾的 far
  fogSandFar: 30, // 沙尘时的 far（越近越看不清）
};

/** 按关卡配置设置环境修饰的基准值 */
function applyEnvModifiers(cfg) {
  env.gustMax = cfg.windGust || 0;
  env.fogBase = cfg.fogNear || 70;
  env.fogFarBase = cfg.fogFar || 420;
  env.sandPeriod = cfg.sandstorm ? 11 : 0;
  env.gustPhase = (game.level * 2.399) % 6.283; // 黄金角散布，各关风向/起始相位不同
  env.gustDir = game.level % 2 === 0 ? 1 : -1;
  env.sandT = 0;
  env.sandOn = false;
  env.gust = 0;
}

/** 每帧推进环境修饰，返回当前需要给 HUD 的提示文案 */
function updateEnv(dt) {
  // —— 阵风：正弦叠加两个不同周期，产生不规则的阵风节奏 ——
  if (env.gustMax > 0) {
    env.gustPhase += dt * 0.55;
    const s = Math.sin(env.gustPhase) * 0.62 + Math.sin(env.gustPhase * 2.37 + 1.1) * 0.38;
    env.gust = env.gustMax * s;
  } else {
    env.gust = 0;
  }

  // —— 沙尘：周期性把能见度压低 ——
  let sandMsg = null;
  if (env.sandPeriod > 0) {
    env.sandT = (env.sandT + dt) % (env.sandPeriod * 2);
    const t = env.sandT;
    // 前 1/4 周期起风、中间 1/2 维持、后 1/4 散去
    env.sandOn = t > env.sandPeriod * 0.25 && t < env.sandPeriod * 1.25;
    if (env.sandOn) {
      const k = 1 - Math.abs(t - env.sandPeriod * 0.75) / (env.sandPeriod * 0.5);
      // 沙尘不能把能见度压到接近 0 —— 那样连**地面预警线**都看不见，
      // 玩家不是"难度高"而是"无从应对"（沙尘考验的应是判断，不是盲抓）。
      // 因此最多吞掉 70% 的能见度，并给 near 留 6m 下限，
      // 保证贴着地面的预警线与藏狐轮廓始终可读。
      const near = env.fogBase * (1 - k * 0.6);
      const far = env.fogFarBase * (1 - k * 0.7);
      scene.fog.near = Math.max(6, near);
      scene.fog.far = Math.max(28, far);
      sandMsg = '沙尘弥漫 · 贴近预警线';
    }
  }
  if (!env.sandOn && env.sandPeriod > 0) {
    scene.fog.near = env.fogBase;
    scene.fog.far = env.fogFarBase;
  }
  return sandMsg;
}

function completeLevel() {
  // 立即切出 play 状态：否则主循环会在面板显示期间反复满足通关条件，
  // 导致 completed 被重复累加。
  game.mode = 'levelclear';
  game.completed++;
  progress.completedLevels.add(game.level);
  progress.maxUnlocked = Math.max(progress.maxUnlocked, Math.min(game.level + 1, LEVELS.length - 1));
  saveProgress();
  if (game.level === LEVELS.length - 1) { finish(true); return; }
  audio.levelUp();
  controller.exitLock();
  hud.showPanel(levelClearHTML());
  document.getElementById('nextBtn').onclick = () => {
    hud.hidePanel();
    loadLevel(game.level + 1, true);
    if (!controller.touchEnabled) controller.requestLock();
  };
  document.getElementById('clearSelectBtn').onclick = showLevelSelect;
}

function levelClearHTML() {
  const cfg = game.sandbox ? SANDBOX_LEVEL : LEVELS[game.level];
  return `
    <div class="eyebrow">LEVEL ${game.level + 1} CLEAR</div>
    <h2>${cfg.name} · 完成</h2>
    <p>采食达标、伙伴安全到家并回洞休息。<b>${cfg.brief}</b></p>
    <div class="level-list">
      ${LEVELS.map((l, i) =>
    `<span class="level-chip ${progress.completedLevels.has(i) ? 'done' : i === game.level + 1 ? 'cur' : ''}">${i + 1} ${l.name}</span>`).join('')}
    </div>
    <div class="stats-grid">
      <div class="stat"><div class="v">${game.boosts}</div><div class="l">应急爆发</div></div>
      <div class="stat"><div class="v">${game.ultimates}</div><div class="l">协同大招</div></div>
      <div class="stat"><div class="v">${Math.round(game.player.stress)}</div><div class="l">当前负荷</div></div>
    </div>
    <p style="font-size:12.5px">下一关：<b>第 ${game.level + 2} 关 · ${LEVELS[game.level + 1].name}</b> — ${LEVELS[game.level + 1].brief}</p>
    <div class="row">
      <button class="primary" id="nextBtn">进入下一关 · Enter</button>
      <button class="ghost" id="clearSelectBtn">选择其他关卡</button>
    </div>
  `;
}

function finish(won, reason = '被藏狐逮住了。') {
  // 结算只应触发一次
  if (game.mode === 'won' || game.mode === 'lost') return;
  recordTestLog(won ? 'level-won' : 'level-lost', { reason, hp: game.player.hp, time: game.time });
  game.mode = won ? 'won' : 'lost';
  controller.exitLock();
  audio[won ? 'win' : 'lose']();
  hud.showPanel(`
    <div class="eyebrow">${won ? `ALL CLEAR / ${LEVELS.length} 关通关` : 'TRY AGAIN / 再试一次'}</div>
    <h2>${won ? '草地上的稳态高手！' : `第 ${game.level + 1} 关，还差一点。`}</h2>
    <p>${won ? '伙伴与食物都安全，已经回到洞穴。' : reason}</p>
    <div class="stats-grid">
      <div class="stat"><div class="v">${game.completed}</div><div class="l">通过关卡</div></div>
      <div class="stat"><div class="v">${game.boosts}</div><div class="l">应急爆发</div></div>
      <div class="stat"><div class="v">${game.ultimates}</div><div class="l">协同大招</div></div>
      <div class="stat"><div class="v">${game.hits}</div><div class="l">受到攻击</div></div>
      <div class="stat"><div class="v">${Math.round(game.totalTime)}s</div><div class="l">闯关用时</div></div>
    </div>
    <div class="row">
      <button class="primary" id="againBtn">${won ? '重新挑战 · R' : '重试本关 · T'}</button>
      <button class="ghost" id="fromStartBtn">从第一关开始</button>
    </div>
  `);
  document.getElementById('againBtn').onclick = () => {
    hud.hidePanel();
    if (won) { resetAll(); startPlay(); } else { retryLevel(); }
  };
  document.getElementById('fromStartBtn').onclick = () => {
    hud.hidePanel(); resetAll(); startPlay();
  };
  const lostSelectBtn = document.createElement('button');
  lostSelectBtn.className = 'ghost';
  lostSelectBtn.textContent = '选择其他已解锁关卡';
  lostSelectBtn.onclick = showLevelSelect;
  document.querySelector('#panel .row')?.appendChild(lostSelectBtn);
}

function showLevelSelect() {
  game.mode = 'title';
  const unlocked = progress.maxUnlocked;
  hud.showPanel(`
    <div class="eyebrow">LEVEL SELECT / ${LEVELS.length} 个关卡</div>
    <h2>选择一段草原旅程</h2>
    <p>已解锁至第 ${unlocked + 1} 关。完成当前关卡即可解锁下一关，已完成关卡可随时重玩。</p>
    <div class="level-select-grid">
      ${LEVELS.map((level, i) => {
    const locked = i > unlocked;
    const done = progress.completedLevels.has(i);
    return `<button class="level-option ${locked ? 'locked' : ''} ${done ? 'done' : ''}"
        data-level="${i}" ${locked ? 'disabled aria-disabled="true"' : ''}>
        <span class="level-option-top"><b>${String(i + 1).padStart(2, '0')}</b><span>${locked ? '未解锁' : done ? '已完成' : '可挑战'}</span></span>
        <strong>${level.name}</strong><small>${level.brief}</small>
      </button>`;
  }).join('')}
    </div>
    <div class="level-select-footer"><button class="ghost" id="selectBackBtn">返回标题</button></div>
  `);
  hud.el.panel.classList.add('level-select-panel');
  document.querySelectorAll('.level-option:not([disabled])').forEach((button) => {
    button.onclick = () => {
      game.level = Number(button.dataset.level);
      game.completed = 0;
      game.totalRepels = 0;
      game.totalTime = 0;
      game.boosts = 0;
      game.ultimates = 0;
      game.hits = 0;
      startPlay();
    };
  });
  document.getElementById('selectBackBtn').onclick = title;
}

function title() {
  game.mode = 'title';
  game.sandbox = false;
  document.body.classList.remove('sandbox-active');
  hud.showPanel(`
    <div class="eyebrow">CAMPAIGN / ${LEVELS.length} 关草原冒险 · 第一 / 第三人称 3D</div>
    <h2>从两只藏狐，到草原守望者。</h2>
    <button class="sandbox-entry" id="sandboxEntryBtn" type="button">自由测试 / 沙盒 <span>不计关卡 · 无限练习</span></button>
    <p>你是草原上的一只土拨鼠。默认第一人称贴近草地，也可以按 <b>V</b> 切换为第三人称跟随视角，随时按需选择。</p>
    <p>每关完成 <b>采食、救援与陪伴</b>，回洞即可进入下一关。
    ${LEVELS.length} 关逐步引入疾行、绕行、雾、强风与沙尘；后段需要同时判断环境和狐狸的攻击预警。</p>
    <p style="font-size:12.5px"><b>你不会真的杀死藏狐。</b>把它们打到体力耗尽后，它们会
    <b>夹着尾巴转身逃跑</b>，逃出草地才会消失 —— 一段时间后可能有同类再次出现。
    你要做的是在采食和救援时自卫，随后回洞。</p>
    ${IS_DEV ? `
    <div class="dev-intro">
      <div class="dev-badge">DEV 版 · 旱獭生态学改写</div>
      <p>旱獭是典型的<b>草食动物</b>，耐饥渴，主食为沙草料、禾本科叶茎与豆科花，
      且<b>食物随季节变化</b>。本版据此调整了三件事：</p>
      <ul>
        <li><b>采食对象</b>改为当季草本植物 —— 早春吃冷蒿新叶、晚春初夏以草为主、
        夏末偏向草本；冬眠前可在近人环境补充栽培种子与谷物，不代表野生草原植被。</li>
        <li><b>耐饥渴</b>：同样的奔跑与挥爪消耗更低，静止恢复更快；
        储备见底时的惩罚几乎可以忽略 —— 你能撑过长时间不进食。</li>
        <li><b>多汁与亚油酸</b>：含水量高的饲料额外回储备；
        泛淡金环的植物富含亚油酸，是储备效率最高的一类。</li>
      </ul>
      <p style="font-size:11.5px;color:#9db392">这些仍是玩法设计，不是营养学定量结论。
      去掉 URL 的 <code>?version=dev</code> 即回到正式版。</p>
    </div>` : ''}
    <div class="keys" id="titleKeys">
      ${TOUCH_DEVICE ? '<span><kbd>触屏</kbd> 左侧摇杆移动 · 右侧拖动转视角 · 屏幕按钮执行动作</span>' : ''}
      <span><kbd>鼠标</kbd> 视角转动</span>
      <span><kbd>V</kbd> 第一 / 第三人称切换</span>
      <span><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> 移动</span>
      <span><kbd>左键</kbd> 攻击（可按住）</span>
      <span><kbd>右键</kbd> / <kbd>F</kbd> 跳跃（可躲扑击）</span>
      <span><kbd>J</kbd> 短时应急爆发</span>
      <span><kbd>K</kbd> 蓄满后的范围大招</span>
      <span><kbd>E</kbd> 救援 / 陪伴缓压</span>
      <span><kbd>Shift</kbd> 疾行（更快但更耗储备）</span>
      <span><kbd>P</kbd> 暂停　<kbd>T</kbd> 重试　<kbd>R</kbd> 重开</span>
    </div>
    <p style="font-size:12.5px">洞口有暖光，那就是家 —— 里面不能攻击，但能休息回储备。<br>
    屏幕边缘的红箭头表示有藏狐正在你背后靠近；<b>绿箭头是伙伴的呼救</b>，它会周期性叫两声。</p>
    <p style="font-size:12.5px"><b>奔跑时你会自动俯下身子冲刺，停下则撑起身来</b> ——
    起身比趴下慢一点，就像土拨鼠真的要用四肢撑起身体。</p>
    <p style="font-size:12px;color:#9db392">不适手？点右上角 <b>⚙</b> 可切换<b>兼容 / 优化 / 自定义</b>键位方案。</p>
    <div class="row title-actions">
      <button class="primary" id="startBtn">从第 ${game.level + 1} 关继续 · Enter</button>
      <button class="ghost" id="levelSelectBtn">选择关卡 · 已解锁 ${progress.maxUnlocked + 1}/${LEVELS.length}</button>
    </div>
    <div style="margin-top:10px">
      <button class="ghost" id="howBtn">教师说明：数值是玩法抽象</button>
    </div>
  `);
  document.getElementById('startBtn').onclick = startPlay;
  document.getElementById('sandboxEntryBtn').onclick = enterSandbox;
  document.getElementById('levelSelectBtn').onclick = showLevelSelect;
  document.getElementById('howBtn').onclick = showTeacherNote;
}

function showTeacherNote() {
  hud.showPanel(`
    <div class="eyebrow">TEACHER NOTE</div>
    <h2>战斗数值是游戏抽象，不是生理定量结论</h2>
    <p>应急爆发对应短时资源动员，持续应激轴对应较慢的分级调节与自动负反馈；
    陪伴帮助降低应激负荷，不直接修复伤口。为了让作用可见，游戏用伤害、范围、攻速和消耗表现这些过程。</p>
    <p>这些数值、效果分档、蓄力及"协同大招"都是<b>玩法设计</b>：不代表激素一定提高真实动物攻击力，不代表应激越高越好。
    应激负荷与持续动员是不同的抽象指标，<b>都不能直接当作激素浓度</b>。大招结束后的疲劳是玩法代价。</p>
    <p>关卡间的生命补充表示时间跳跃后的休整，不是"催产素回血"。主角是土拨鼠；课堂相关数据来自草原犬鼠与草原田鼠，应保留研究物种边界。</p>
    ${IS_DEV ? `
    <h3 style="margin-top:22px;color:#ffcf6b;font-size:17px">DEV 版补充：旱獭生态学依据</h3>
    <p>主角是<b>旱獭</b>，典型草食动物，耐饥渴。因此 dev 版做了三处改写：</p>
    <ul style="font-size:13px;color:#d5e1c8;line-height:1.85;padding-left:18px">
      <li><b>食性</b>：主食为沙草料、禾本科植物的叶茎、豆科植物的花；
      采食对象据此改为当季草本植物，不再是浆果。游戏里"挥爪驱赶"而非捕食，
      也符合草食动物的防御行为 —— 旱獭确实主要以警告与驱离应对威胁。</li>
      <li><b>耐饥渴</b>：同一动作的储备消耗更低、恢复更快，储备见底的惩罚被放宽。
      这是把"耐饥渴"做成可玩的手感，而非写在说明里。</li>
      <li><b>季节性与食性偏好</b>：关卡依次轮换早春（冷蒿）、晚春、初夏（草类主食）、
      夏末（草本）；冬眠前的栽培种子/谷物仅表示近人环境中的可选补充食物，不是野生草原植物。
      冬眠前与早春是进食最强烈的时期；植物还区分<b>多汁</b>（高含水量）
      与<b>富亚油酸</b>（高脂）两类，后者回储备更多。</li>
    </ul>
    <p style="font-size:12.5px;color:#9db392">需要注意的是：这些改写让玩法与旱獭的
    <b>生态学事实</b>保持一致，但<b>储备数值、能量换算系数仍是玩法设计</b>，
    不代表实测营养摄入量或能量代谢率。资料中"有时也会吃些动物""饲养条件下更杂食"
    说明食性有弹性，但游戏不据此设计捕食行为。</p>
    <p style="font-size:12.5px;color:#9db392">正式版（不带 <code>?version=dev</code>）保持原有设定不变。</p>
    ` : ''}
    <button class="primary" id="backBtn">返回</button>
  `);
  document.getElementById('backBtn').onclick = title;
}

function startPlay() {
  audio.ensure();
  hud.hidePanel();
  game.mode = 'play';
  loadLevel(game.level, true);
  if (!controller.touchEnabled) controller.requestLock();
}

function resetAll() {
  game.completed = 0;
  game.totalRepels = 0;
  game.totalTime = 0;
  game.boosts = 0;
  game.ultimates = 0;
  game.hits = 0;
  loadLevel(0, false);
}

function retryLevel() {
  loadLevel(game.level, false);
  game.mode = 'play';
  hud.hidePanel();
  if (!controller.touchEnabled) controller.requestLock();
}

function pause() {
  if (game.mode !== 'play') return;
  game.mode = 'pause';
  keys.clear();
  touchControls?.releaseAll();
  controller.exitLock();
  hud.showPanel(`
    <div class="eyebrow">PAUSED</div>
    <h2>喘口气。</h2>
    <p>${TOUCH_DEVICE ? '左侧摇杆移动 · 右侧拖动视角 · 触屏按钮可攻击、疾行、跳跃、交互与释放技能。' : `${IS_DEV && binds.scheme === 'optimized' ? 'W/S 前后 · A/D 转向 · 方向键横移' : 'WASD 移动'} · 左键/空格 攻击 · J 爆发 · K 大招 · E 救援。`}<br>暂停不会消耗时间。</p>
    <div class="row">
      <button class="primary" id="resumeBtn">继续 · P / Enter</button>
      <button class="ghost" id="pRetryBtn">重试本关 · T</button>
      <button class="ghost" id="pTitleBtn">返回标题</button>
    </div>
  `);
  document.getElementById('resumeBtn').onclick = resume;
  document.getElementById('pRetryBtn').onclick = retryLevel;
  document.getElementById('pTitleBtn').onclick = () => { hud.hidePanel(); title(); };
}

function resume() {
  game.mode = 'play';
  hud.hidePanel();
  keys.clear();
  // Esc 退出锁定后浏览器有短暂冷却，可能拒绝立即重锁；
  // 失败时提示点击画面（canvas 的 click 监听会再次请求锁定）。
  if (!controller.touchEnabled) {
    controller.requestLock().then((locked) => {
      if (!locked && game.mode === 'play') {
        hud.say('鼠标未锁定 —— 点击一下画面即可继续。', 2.6);
      }
    });
  }
}

// ============================================================
// 战斗动作
// ============================================================
const _fwd = new THREE.Vector3();
// 缓存本次战斗数值，供 viewmodel 的攻击动画计算进度使用
let stats_cache = { cd: 0 };

/** 攻击：扇形范围判定，原版是圆形范围，第一人称下改为朝向前方扇形更合理 */
function strike(move = 'tap') {
  const p = game.player;
  if (game.attackCD > 0 || game.inBurrow || game.observing) return false;
  const wheel = PLAYER.combatWheel[move] || PLAYER.combatWheel.tap;
  const s = combatStats(game);
  const atkMul = devOn('famineTolerance') ? HERBIVORE.attackCostMul : 1;
  const rawCost = move === 'tap' ? (game.overdrive > 0 ? STRIKE_COST.overdrive : game.boost > 0 ? STRIKE_COST.boost : STRIKE_COST.base) : wheel.cost;
  const cost = rawCost * atkMul;
  if (p.energy < cost) return false;
  p.energy -= cost;
  game.attackCD = Math.max(s.cooldown, wheel.cooldown || 0.18) + (wheel.recovery || 0);
  if (move === 'stand') controller.movementLocked = true;
  controller.forwardFlat(_fwd);
  const right = new THREE.Vector3(-_fwd.z, 0, _fwd.x);
  if (move === 'dodge') {
    controller.externalVelocity.addScaledVector(right, 6.2);
    p.invuln = Math.max(p.invuln, wheel.invuln || 0.35);
    controller.dashForward(0.4);
    return true;
  }
  if (move === 'lunge') controller.externalVelocity.addScaledVector(_fwd, 7.2);
  if (move === 'stand') game.attackMoveLock = wheel.lock || 0.4;
  const originY = terrainHeight(controller.position.x, controller.position.z);
  const color = move === 'stand' ? 0xd6a1ff : move === 'lunge' ? 0xffa36f : game.overdrive > 0 ? 0xe4b1ff : game.boost > 0 ? 0xffd17a : 0xfff1a9;
  claw.fire(controller.position.x, originY + 0.32, controller.position.z, controller.yaw, s.range, color);
  controller.attackKick(move === 'lunge' ? 1.6 : 1);
  audio.swing();
  let hits = 0;
  for (const f of foxes) {
    if (f.hp <= 0) continue;
    const dx = f.x - controller.position.x, dz = f.z - controller.position.z;
    const forward = dx * _fwd.x + dz * _fwd.z;
    const lateral = dx * (-_fwd.z) + dz * _fwd.x;
    const playerBottom = terrainHeight(controller.position.x, controller.position.z) + controller.airHeight;
    const foxBottom = terrainHeight(f.x, f.z) + f.leap;
    const foxHeight = FOX.collisionHeight[f.type] ?? FOX.collisionHeight.normal;
    if (!strikeVolumeHit({ forward, lateral, playerBottom, targetBottom: foxBottom, targetHeight: foxHeight, range: s.range + (move === 'lunge' ? 0.8 : 0) })) continue;
    hitFox(f, s.damage * (wheel.damageMul || 1), { ...s, stun: wheel.stun || s.stun, knockback: wheel.knockback || s.knockback });
    hits++;
  }
  if (hits && game.overdrive <= 0) game.charge = clamp(game.charge + (move === 'stand' ? 9 : move === 'lunge' ? 8 : 6), 0, 100);
  return true;
}
function hitFox(f, damage, s) {
  if (f.hp <= 0) return;
  const fy = terrainHeight(f.x, f.z);
  f.hit(damage, s.knockback, s.stun, controller.position.x, controller.position.z);
  const cfg = LEVELS[game.level];

  damageText.spawn(f.x, fy + 1.1, f.z,
    Number.isInteger(damage) ? `-${damage}` : `-${damage.toFixed(1)}`, '#ffedb7');
  particles.burst(f.x, fy + 0.5, f.z, colHit, 9, 1);

  // 体力耗尽 = 被驱退。它不会死，而是转身逃跑。
  if (f.hp <= 0) {
    game.levelRepels = (game.levelRepels || 0) + 1;
    game.totalRepels = (game.totalRepels || 0) + 1;
    f.startFleeing(controller.position.x, controller.position.z, cfg);
    if (game.overdrive <= 0) game.charge = clamp(game.charge + 18, 0, 100);
    game.player.energy = clamp(game.player.energy + 8, 0, 100);
    damageText.spawn(f.x, fy + 1.6, f.z, '威胁已解除', '#ceebbc');
    particles.burst(f.x, fy + 0.5, f.z, colRepel, 18, 1.4);
    audio.repel();
    recordTestLog('fox-repelled', { foxType: f.type, levelRepels: game.levelRepels, totalRepels: game.totalRepels });
    controller.hitShake(0.3);
    if (f.type === 'boss') {
      game.bossDown = true;
      hud.say('狐首领掉头逃走了！完成剩余目标就回洞。', 4);
    }
  } else {
    audio.hit();
    controller.hitShake(0.18);
  }
}

function doBurst() {
  const ok = burst(game, (t, d) => hud.say(t, d));
  if (ok) {
    audio.burst();
    const y = terrainHeight(controller.position.x, controller.position.z);
    particles.burst(controller.position.x, y + 0.4, controller.position.z, colBoost, 26, 1.4);
    damageText.spawn(controller.position.x, y + 1.4, controller.position.z, '伤害 +2 · 加速', '#ffde7e');
    hud.say('J 应急爆发：攻击 +2、范围增加、攻速更快！持续 4 秒。', 3.3);
  }
}

function doUltimate() {
  if (game.inBurrow) { hud.say('洞穴内不能攻击，出洞后再使用 K。', 1.7); return; }
  const ok = ultimate(game, (t, d) => hud.say(t, d));
  if (!ok) return;

  audio.ultimate();
  const x = controller.position.x, z = controller.position.z;
  shockwave.fire(x, z, ULT.radius);
  particles.burst(x, terrainHeight(x, z) + 0.5, z, colUlt, 55, 2);
  damageText.spawn(x, terrainHeight(x, z) + 1.5, z, '协同大招', '#f1c3ff');
  hud.say('K 协同爆发！范围冲击 + 5 秒强化，结束后会疲劳。', 4.5);
  controller.dashForward(1.6);
  controller.hitShake(0.7);

  const s = combatStats(game);
  for (const f of foxes) {
    if (f.hp <= 0) continue;
    const d = Math.hypot(f.x - x, f.z - z);
    if (d > ULT.radius) continue;
    hitFox(f, ULT.hitDamage, { ...s, knockback: 6, stun: 2.4 });
  }
  hud.flashScreen();
}

/**
 * 跳跃。主要用途是躲开扑击中的藏狐接触判定，
 * 而不是跨越地形（土拨鼠跳不远）。
 */
function doJump() {
  if (!controller.jump()) return;
  audio.jump();
  const y = controller.position.y;
  particles.burst(controller.position.x, y + 0.05, controller.position.z,
    new THREE.Color(0xbfae8e), 6, 0.7);
}

function doInteract() {
  const f = game.friend;
  const d = Math.hypot(f.x - controller.position.x, f.z - controller.position.z);
  const inBurrow = game.inBurrow;

  if (!f.rescued && !f.saved && d < RESCUE_DIST) {
    f.rescued = true;
    companion.rescued = true;
    companion.showEmote('check');
    audio.rescue();
    hud.say('伙伴跟上了！带它回左侧洞穴。');
    return;
  }
  if (f.saved && game.inBaseBurrow && game.socialCD <= 0) {
    game.social = 9;
    game.socialCD = 13;
    companion.showEmote('check');
    audio.rescue();
    hud.say('陪伴缓压：应激负荷下降，不直接回血。');
    return;
  }
  interact(game, (t, d) => hud.say(t, d));
}

// ============================================================
// 主更新
// ============================================================
const _tmpV = new THREE.Vector3();

function update(dt) {
  if (game.mode !== 'play') {
    // 非游戏状态仍更新视觉表现，保持画面"活着"
    burrowSet.objects.forEach((b) => b.update(dt));
    shockwave.update(dt);
    particles.update(dt);
    damageText.update(dt);
    berries.forEach((b) => b.update(dt));
    return;
  }

  const cfg = LEVELS[game.level];
  const p = game.player;
  game.elapsed += dt;
  game.totalTime += dt;
  if (!game.sandbox && (!TEST_MODE || !testState.freezeTimer)) game.time = Math.max(0, game.time - dt);

  const stats = combatStats(game);
  stats_cache = stats;

  // 环境修饰（雾 / 阵风 / 沙尘）每帧推进
  const envMsg = updateEnv(dt);
  if (envMsg && !env._msgOn) { env._msgOn = true; hud.say(envMsg, 2.6); }
  else if (!envMsg && env._msgOn) env._msgOn = false;

  // 计时器
  const prevOverdrive = game.overdrive;
  for (const k of ['boost', 'boostCD', 'attackCD', 'social', 'socialCD',
    'overdrive', 'overCD', 'fatigue']) {
    game[k] = Math.max(0, game[k] - dt);
  }
  p.invuln = Math.max(0, p.invuln - dt);
  game.attackMoveLock = Math.max(0, game.attackMoveLock - dt);
  controller.movementLocked = game.attackMoveLock > 0;
  if (prevOverdrive > 0 && game.overdrive === 0) {
    game.fatigue = 5;
    hud.say('大招结束：5 秒疲劳，先拉开距离或回洞休息。', 3);
  }

  // 移动（含疾行）
  let speedMul = stats.speedMul;
  // 疾行：按方案查表，并额外接受任意一侧 Shift（双手都能用）
  const sprinting = controller.touchSprint || binds.isAction('ShiftLeft', 'sprint')
    || binds.isAction('ShiftRight', 'sprint')
    || keys.has('ShiftLeft') || keys.has('ShiftRight');
  if (sprinting && p.energy > 5) speedMul *= 1.42;
  controller.update(
    dt,
    keys,
    game.attackMoveLock > 0 ? 0 : speedMul,
    binds.moveMap,
    env.gust * env.gustDir,
    binds.turnMap,
  );

  const moving = controller.movingThisFrame;

  p.x = controller.position.x;
  p.z = controller.position.z;

  // 洞穴判定
  game.currentBurrow = burrowVolumeAt(p.x, controller.position.y, p.z, burrowDefs);
  game.inBurrow = !!game.currentBurrow;
  game.inBaseBurrow = game.currentBurrow?.type === 'base';
  game.observing = controller.crouch < 0.08 && controller.postureSpeed < 0.04 && !moving && !game.inBurrow;

  // 移动消耗储备
  // dev 版「耐饥渴」：同一动作消耗更低（旱獭能长时间不进食活动）
  const costMul = devOn('famineTolerance') ? HERBIVORE.moveCostMul : 1;
  if (moving) {
    const moveCost = game.overdrive > 0 ? 4 : game.boost > 0 ? 4.8 : sprinting ? 3.4 : 1.6;
    p.energy -= dt * moveCost * costMul;
    p.energy = Math.max(0, p.energy);
  }
  // 静止回储备（洞穴内回得快）；dev 版恢复更快，符合耐饥渴设定
  const regenMul = devOn('famineTolerance') ? HERBIVORE.regenMul : 1;
  const burrowRegenMul = devOn('famineTolerance') ? HERBIVORE.burrowRegenMul : 1;
  if (!moving) {
    p.energy = clamp(
      p.energy + (game.inBurrow ? (game.currentBurrow.regenMul || 0) * 14 * burrowRegenMul : 2.5 * regenMul) * dt, 0, 100,
    );
  }

  // —— AI 与威胁 ——
  let threats = 0;
  let anyWinding = false;
  for (const f of foxes) {
    const prevState = f.state;
    f.update(dt, p, game.inBurrow, cfg, burrowDefs, terrainHeight, game.currentBurrow);
    if (f.alive && Math.hypot(f.x - p.x, f.z - p.z) < 22 && !game.inBurrow) threats++;
    if (f.alive && f.state === 'wind') {
      anyWinding = true;
      if (prevState !== 'wind') audio.foxWind();
    }
    if (f.alive && prevState === 'wind' && f.state === 'dash') audio.foxDash();

    // 接触伤害
    if (f.alive && !game.inBurrow && p.invuln <= 0) {
      const d = Math.hypot(f.x - p.x, f.z - p.z);
      const reach = FOX.contact[f.type] ?? FOX.contact.default;
      // 水平接触仍受原半径限制；高度则比较双方碰撞区间，
      // 避免地面玩家被从头顶跃过的狐狸击中。
      const foxBottom = terrainHeight(f.x, f.z) + f.leap;
      const foxHitHeight = FOX.collisionHeight[f.type] ?? FOX.collisionHeight.normal;
      const playerBottom = terrainHeight(p.x, p.z) + controller.airHeight;
      const playerHitHeight = PLAYER.collisionHeight;
      const verticalOverlap = foxAttackVerticalHit({
        playerBottom, playerHeight: playerHitHeight, foxBottom, foxHeight: foxHitHeight,
        groundAttackHeight: FOX.groundAttackHeight, mode: f.attack?.mode, state: f.state,
      });
      if (d < reach && verticalOverlap) {
        // 注意括号：`??` 优先级低于 `+`，必须先按类型取基础伤害再叠加关卡加成，
        // 否则 `+ game.level` 只会并进 default 分支、而该分支永远不会被用到。
        const damage = (FOX.damage[f.type] ?? FOX.damage.default) + game.level;
        const hpBefore = p.hp;
        p.hp = testState.godMode ? Math.max(1, p.hp) : Math.max(0, p.hp - damage);
        recordTestLog('player-hit', { foxType: f.type, damage, hpBefore, hpAfter: p.hp,
          preventedByGodMode: testState.godMode });
        p.invuln = 1.3;
        p.stress = clamp(p.stress + 8, 0, 100);
        game.hits++;
        const hy = terrainHeight(p.x, p.z);
        damageText.spawn(p.x, hy + 1.5, p.z, `-${damage} 生命`, '#ffb2a2');
        particles.burst(p.x, hy + 0.5, p.z, colHurt, 16, 1.2);
        hud.hurtFlash();
        audio.hurt();
        // 受击以水平冲量推开；后续控制器帧统一处理地形边界与岩石碰撞。
        const dx = p.x - f.x, dz = p.z - f.z;
        const dd = Math.hypot(dx, dz) || 1;
        controller.hitShake(1.05, (dx / dd) * 4.8, (dz / dd) * 4.8);
      }
    }
  }

  // —— 应激轴：持续动员与负荷 ——
  game.drive = clamp(game.drive + ((threats ? 34 : 0) - game.cortisol * 0.14 - game.drive * 0.2) * dt, 0, 100);
  game.cortisol = clamp(game.cortisol + (game.drive * 0.14 - game.cortisol * 0.09) * dt, 0, 100);
  p.stress = clamp(p.stress + ((threats ? 3.1 + Math.min(threats, 4) * 0.55 : game.inBurrow ? -5 : -1.5)
    - (game.social > 0 ? 8 : 0)) * dt, 0, 100);

  // 过载预警
  if (p.stress >= 75 && !game.stressWarned) {
    game.stressWarned = true;
    hud.say('应激负荷过载！伤害下降、移动变慢 —— 拉开距离或回洞缓压。', 3.6);
  }
  if (p.stress < 60) game.stressWarned = false;

  // 大招蓄力：威胁越高涨越快
  if (game.overdrive <= 0 && !game.inBurrow) {
    game.charge = clamp(game.charge + (2 + Math.min(threats, 4)) * dt, 0, 100);
  }

  // 攻击在释放时结算：按住期间仅采集方向输入。

  // —— 采食 ——
  // 正式版吃浆果（+20）；dev 版吃当季草本植物，含多汁/富亚油酸加成
  for (let i = 0; i < berries.length; i++) {
    const b = berries[i];
    if (b.taken) continue;
    if (Math.hypot(b.x - p.x, b.z - p.z) < BERRY_RADIUS + 0.35) {
      b.take();
      scenery.setBerryTaken(i);
      game.foodCount++;
      const gain = b.herbivore ? energyOfPlant(b.plant) : BERRY_ENERGY;
      p.energy = clamp(p.energy + gain, 0, 100);
      if (game.overdrive <= 0) game.charge = clamp(game.charge + BERRY_CHARGE, 0, 100);
      const by = terrainHeight(b.x, b.z);
      // 草本植物的碎屑用叶色，浆果用红色
      const c = b.herbivore ? colHerb : colBerry;
      particles.burst(b.x, by + 0.6, b.z, c, 12, 1);
      if (b.herbivore) {
        damageText.spawn(b.x, by + 1.1, b.z, eatLine(b.plant), '#dff0c4');
      } else {
        damageText.spawn(b.x, by + 1.1, b.z, `+${BERRY_ENERGY} 储备`, '#ffd9e2');
      }
      audio.berry();
    }
  }

  // —— 伙伴跟随与到家 ——
  companion.update(dt, controller.position, game.inBurrow);
  if (game.friend.rescued && !game.friend.saved) {
    const d = Math.hypot(companion.x - BURROW_X, companion.z - BURROW_Z);
    if (game.inBaseBurrow && d < BURROW_R + 2.5) {
      game.friend.saved = true;
      companion.saved = true;
      companion.x = BURROW_X - 2.6 * getPointScale();
      companion.z = BURROW_Z + 3 * getPointScale();
      companion.sync();
      audio.rescue();
      hud.say('伙伴到家！采食完成后回洞。', 3.3);
    }
  }

  // 被困伙伴：距离越远呼救越频繁，配合屏幕边缘箭头引导玩家
  if (!game.friend.rescued) {
    const d = Math.hypot(companion.x - p.x, companion.z - p.z);
    companion.showEmote(d < 14 ? 'exclaim' : null);
    // 距离衰减决定呼救间隔：近 3 秒一次，远 1.2 秒一次
    if (!game.inBurrow) {
      game.helpCry = (game.helpCry || 0) + dt;
      const interval = 3 - Math.min(1.8, (d / 60) * 1.8);
      if (game.helpCry >= interval) {
        game.helpCry = 0;
        audio.helpCry(Math.min(1, d / 55));
      }
    }
  } else {
    game.helpCry = 0;
  }

  // —— 交互提示 ——
  let prompt = '';
  if (game.friend.saved && game.inBaseBurrow && game.socialCD <= 0) {
    prompt = '<kbd>E</kbd> 陪伴缓压';
  } else if (!game.friend.rescued && !game.friend.saved
    && Math.hypot(companion.x - p.x, companion.z - p.z) < RESCUE_DIST) {
    prompt = '<kbd>E</kbd> 救援伙伴';
  }
  hud.setInteractPrompt(prompt);

  // —— 视觉更新 ——
  playerBody.rotation.x = -controller.crouch * 0.28;
  playerBody.position.y = controller.crouch * -0.12 + (controller.grounded ? 0 : 0.08);
  playerBody.scale.set(1, 1 - controller.crouch * 0.12, 1 + controller.crouch * 0.18);
  burrowSet.objects.forEach((b) => b.update(dt));
  berries.forEach((b) => b.update(dt));
  claw.update(dt);
  shockwave.update(dt);
  particles.update(dt);
  damageText.update(dt);
  aura.update(dt, p.x, p.z, {
    boost: game.boost > 0, overdrive: game.overdrive > 0,
    overloaded: stats.overloaded, social: game.social > 0, fatigue: game.fatigue > 0,
  });
  updateCooldownButtons();
  if (game.sandbox && sandboxPanelUI) sandboxPanelUI.update({ game, controller, foxes, fps: 1 / Math.max(dt, 0.0001) });

  controller.forwardFlat(_fwd);
  hud.updateThreats(foxes, p, camera, _fwd, companion);
  minimap.update({
    visible: game.observing,
    player: { x: p.x, z: p.z, yaw: controller.yaw },
    base: baseBurrow,
    shelters: burrowDefs.filter((b) => b.type === 'shelter'),
    berries, companion, foxes,
  });

  // 低血量警告音
  if (p.hp < 30) {
    game._lowHpTick = (game._lowHpTick || 0) + dt;
    if (game._lowHpTick > 0.9) { game._lowHpTick = 0; audio.lowHealth(); }
  }

  // —— 失败判定 ——
  if (!game.sandbox && p.hp <= 0) { finish(false); return; }
  if (!game.sandbox && game.time <= 0) { finish(false, '天黑前没有完成本关任务。'); return; }

  // —— 通关判定：三目标 + 回洞 ——
  // 正式通关：采食达标 + 伙伴到家 + 回到【大本营】（临时避难洞不结算）。
  // 驱退狐狸不再是任务配额；boss 也不是强制目标。
  if (!game.sandbox && objectivesComplete({ foodCount: game.foodCount, foodGoal: cfg.goal,
    friendSaved: game.friend.saved, inBurrow: game.inBaseBurrow })) {
    completeLevel();
    return;
  }

  hud.update(game, stats, cfg, dt);
}

// ============================================================
// 输入绑定（由 keybinds 方案驱动）
// ============================================================
const binds = new Keybinds();

let mouseDown = false;
let attackKeyDown = false;
const touchAttackPointers = new Set();
const attackGestures = new Map();
let touchControls = null;
// 首次点击用于捕获鼠标指针时，把这次攻击记下来，等锁定成功后补上
let pendingClickAttack = false;
let pendingClickTimer = 0;
const attackWheel = document.createElement('div');
attackWheel.className = 'attack-wheel';
attackWheel.innerHTML = '<i data-move="lunge">扑咬</i><i data-move="stand">迎咬</i><i data-move="dodge">翻滚</i><i data-move="tap">推击</i>';
document.body.appendChild(attackWheel);
function showAttackWheel(gesture = {}) {
  attackWheel.classList.add('visible');
  const move = selectAttackMove(gesture);
  attackWheel.querySelectorAll('[data-move]').forEach((el) => el.classList.toggle('active', el.dataset.move === move));
}
function hideAttackWheel() { attackWheel.classList.remove('visible'); }


touchControls = new TouchControls({
  canvas,
  controller,
  root: document.getElementById('touchControls'),
  lookZone: document.getElementById('touchLookZone'),
  joystick: document.getElementById('touchJoystick'),
  stick: document.getElementById('touchStick'),
  isActive: () => game.mode === 'play',
  onAction: (action, pressed, pointerId, gesture = {}) => {
    if (action === 'attack') {
      if (pressed) {
        touchAttackPointers.add(pointerId);
        attackGestures.set(pointerId, gesture);
        showAttackWheel(gesture);
      } else {
        touchAttackPointers.delete(pointerId);
        attackGestures.delete(pointerId);
        hideAttackWheel();
        strike(selectAttackMove(gesture));
      }
    } else if (pressed && action === 'jump') doJump();
    else if (pressed && action === 'interact') doInteract();
    else if (pressed && action === 'burst') doBurst();
    else if (pressed && action === 'ultimate') doUltimate();
    else if (pressed && action === 'pause') pause();
  },
});

// 老内核兜底：媒体查询/UA 未识别时，收到真实手指触摸立即启用触控层（capture 最早、不拦截）。
for (const evName of ['pointerdown', 'touchstart']) {
  window.addEventListener(evName, (ev) => {
    if (TOUCH_DEVICE) return;
    const realTouch = ev.pointerType === 'touch' || ev.pointerType === 'pen' || evName === 'touchstart';
    if (realTouch) enableTouchRuntime();
  }, { passive: true, capture: true });
}

// 不再硬编码键位表：每次按键都查当前方案
const isBound = (code) => {
  // Enter 不参与键位方案，但用于标题/暂停/通关界面的确认，必须放行
  if (code === 'Enter') return true;
  for (const a of ACTIONS) if (binds.isAction(code, a.id)) return true;
  // 方向键始终可用作移动备选
  return code.startsWith('Arrow');
};

window.addEventListener('keydown', (e) => {
  if (e.repeat) {
    // 长按只记录"按住"状态（攻击/移动需要），不重复触发单次动作
    if (game.mode === 'play' && isBound(e.code)) keys.add(e.code);
    return;
  }

  // F11 全屏：需先于常规判断并阻止默认行为，才能同步按钮状态与 resize
  if (binds.isAction(e.code, 'fullscreen')) {
    e.preventDefault();
    toggleFullscreen();
    return;
  }
  if (e.code === 'KeyV' && game.mode === 'play') {
    e.preventDefault();
    setViewMode(!thirdPerson, true);
    return;
  }

  if (!isBound(e.code)) return;
  // 空格/方向键会滚动页面，必须拦
  if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();

  // —— 系统类动作（任何状态下都可用）——
  if (binds.isAction(e.code, 'restart')) { resetAll(); startPlay(); return; }
  if (binds.isAction(e.code, 'retry')) { retryLevel(); return; }
  if (binds.isAction(e.code, 'pause')) {
    if (game.mode === 'play') pause();
    else if (game.mode === 'pause') resume();
    return;
  }
  if (e.code === 'Enter') {
    if (game.mode === 'title') { startPlay(); return; }
    if (game.mode === 'pause') { resume(); return; }
    if (game.mode === 'won') { resetAll(); startPlay(); return; }
    const nb = document.getElementById('nextBtn');
    if (nb) { nb.click(); return; }
    if (game.mode === 'lost') { retryLevel(); return; }
  }

  if (game.mode !== 'play') return;

  // —— 战斗类动作 ——
  keys.add(e.code);
  if (binds.isAction(e.code, 'attack')) { attackKeyDown = true; showAttackWheel({ dx: 0, dy: 0, moved: false }); }
  if (binds.isAction(e.code, 'burst')) doBurst();
  if (binds.isAction(e.code, 'ultimate')) doUltimate();
  if (binds.isAction(e.code, 'interact')) doInteract();
  if (binds.isAction(e.code, 'jump')) doJump();
});

window.addEventListener('keyup', (e) => {
  keys.delete(e.code);
  if (binds.isAction(e.code, 'attack')) {
    attackKeyDown = false; hideAttackWheel();
    if (game.mode === 'play') strike(selectAttackMoveFromInput(Number(keys.has('KeyD')) - Number(keys.has('KeyA')), Number(keys.has('KeyW')) - Number(keys.has('KeyS'))));
  }
});

canvas.addEventListener('mousedown', (e) => {
  if (controller.touchEnabled) return;
  audio.ensure();

  // 右键 = 跳跃（需在 pointer lock 下才生效，未锁定时先捕获指针）
  if (e.button === 2) {
    if (controller.locked && game.mode === 'play') doJump();
    return;
  }
  if (e.button !== 0) return;

  // 未锁定鼠标时，本次点击用于捕获指针，但仍要打出攻击。
  // 早期版本在这里直接 return，导致玩家必须点两次才能打中第一下 ——
  // 现在先记下"锁定后要补一次攻击"，让操作更跟手。
  if (!controller.locked) {
    if (game.mode === 'play') {
      controller.requestLock();
      pendingClickAttack = true;
      mouseDown = true;
      showAttackWheel({ dx: 0, dy: 0, moved: false });
      // 若用户拒绝锁定或请求失败，pendingClickAttack 会一直挂着，
      // 导致下次成功锁定时打出一记莫名其妙的"幽灵攻击"。超时清理。
      clearTimeout(pendingClickTimer);
      pendingClickTimer = setTimeout(() => { pendingClickAttack = false; }, 1200);
    }
    return;
  }
  mouseDown = true;
  if (game.mode === 'play') showAttackWheel({ dx: 0, dy: 0, moved: false });
});

// 指针捕获成功时，补上被吞掉的那次攻击
controller.onLockChange = (locked) => {
  document.body.classList.toggle('unlocked', !locked);
  document.body.classList.toggle('no-lock', !locked);
  if (locked && pendingClickAttack) {
    clearTimeout(pendingClickTimer);
    pendingClickAttack = false;
    mouseDown = true;
    if (game.mode === 'play') { mouseDown = true; showAttackWheel({ dx: 0, dy: 0, moved: false }); }
  }
  // 未锁定时暂停，避免玩家离开后被偷袭
  if (!locked && !controller.touchEnabled && game.mode === 'play') pause();
};
// 右键已用于跳跃，必须屏蔽浏览器右键菜单，否则每次跳跃都会弹菜单
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

window.addEventListener('mouseup', (e) => {
  if (e.button !== 0) return;
  mouseDown = false; hideAttackWheel();
  if (game.mode === 'play') {
    const move = selectAttackMoveFromInput(Number(keys.has('KeyD')) - Number(keys.has('KeyA')), Number(keys.has('KeyW')) - Number(keys.has('KeyS')));
    strike(move);
  }
});
window.addEventListener('blur', () => {
  keys.clear(); mouseDown = false;
  if (game.mode === 'play') pause();
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    touchControls?.releaseAll();
    if (game.mode === 'play') pause();
  } else {
    last = performance.now();
    resizeRenderer();
  }
});

// 点击画面重新锁定鼠标
canvas.addEventListener('click', () => {
  if (!controller.touchEnabled && game.mode === 'play' && !controller.locked) controller.requestLock();
});

// HUD 详细状态：默认收起战斗明细与状态芯片，按需呼出。
const hudDetailsBtn = document.getElementById('hudDetailsBtn');
if (hudDetailsBtn) {
  hudDetailsBtn.onclick = () => {
    const open = document.body.classList.toggle('hud-details-open');
    hudDetailsBtn.setAttribute('aria-expanded', String(open));
    hudDetailsBtn.textContent = open ? '收起' : '详情';
    hudDetailsBtn.title = open ? '收起详细状态' : '展开详细状态';
  };
}

// 目标摘要点击展开/收起，不抢占中央瞄准与移动区域。
document.getElementById('objective')?.addEventListener('click', (event) => {
  const toggle = event.target.closest('.obj-toggle');
  if (!toggle) return;
  const objective = toggle.closest('.objective');
  if (!objective) return;
  const expanded = objective.classList.toggle('expanded');
  toggle.setAttribute('aria-expanded', String(expanded));
  toggle.setAttribute('aria-label', expanded ? '收起本关目标' : '展开本关目标');
  const icon = toggle.querySelector('i');
  if (icon) icon.textContent = expanded ? '−' : '+';
  objective.querySelector('.obj-details')?.setAttribute('aria-hidden', String(!expanded));
});

// 帮助面板
const helpBtn = document.getElementById('helpBtn');
const helpSheet = document.getElementById('helpSheet');
helpBtn.onclick = () => { helpSheet.hidden = !helpSheet.hidden; };
document.getElementById('helpClose').onclick = () => { helpSheet.hidden = true; };

// 设置面板（键位方案）
const touchLayout = new TouchLayout();
const settingsUI = new SettingsUI(binds, touchLayout);

// 开发测试面板通过 ?test=1 显式启用，不进入普通用户界面。
const testModeBtn = document.getElementById('testModeBtn');
const testPanel = document.getElementById('testPanel');
{
  testModeBtn.hidden = false;
  testModeBtn.hidden = !TEST_MODE && !SANDBOX_MODE;
  document.getElementById('testGodMode').checked = testState.godMode;
  document.getElementById('testFreezeTimer').checked = testState.freezeTimer;
  recordTestLog('session-start', { userAgent: navigator.userAgent, initialSnapshot: testSnapshot() });
  testModeBtn.onclick = () => {
    testPanel.hidden = !testPanel.hidden;
    testModeBtn.setAttribute('aria-expanded', String(!testPanel.hidden));
  };
  document.getElementById('testPanelClose').onclick = () => {
    testPanel.hidden = true;
    testModeBtn.setAttribute('aria-expanded', 'false');
  };
  document.getElementById('testGodMode').onchange = (event) => {
    testState.godMode = event.target.checked;
    recordTestLog('setting', { name: 'godMode', value: testState.godMode });
  };
  document.getElementById('testFreezeTimer').onchange = (event) => {
    testState.freezeTimer = event.target.checked;
    game.freezeTimer = testState.freezeTimer;
    recordTestLog('setting', { name: 'freezeTimer', value: testState.freezeTimer });
  };
  testPanel.addEventListener('click', (event) => {
    const action = event.target.closest('[data-test-action]')?.dataset.testAction;
    if (!action) return;
    if (action === 'heal25' || action === 'heal100') {
      const before = game.player.hp;
      game.player.hp = action === 'heal100' ? 100 : clamp(game.player.hp + 25, 0, 100);
      game.player.invuln = Math.max(game.player.invuln, 1.3);
      recordTestLog('player-heal', { action, hpBefore: before, hpAfter: game.player.hp });
    } else if (action === 'resetTimer') {
      game.time = LEVELS[game.level].time;
      recordTestLog('timer-reset', { time: game.time });
    } else if (action === 'snapshot') {
      recordTestLog('manual-snapshot', testSnapshot());
    } else if (action === 'note') {
      const input = document.getElementById('testNote');
      const note = input.value.trim();
      if (note) { recordTestLog('note', { note }); input.value = ''; }
    } else if (action === 'clear') {
      testLogs.length = 0;
    } else if (action === 'export') {
      recordTestLog('log-exported', { entries: testLogs.length });
      exportTestLogs();
    }
    const meta = document.getElementById('testLogMeta');
    if (meta) meta.textContent = `日志 ${testLogs.length} 条`;
  });
  testPanel.querySelector('#testGodMode').addEventListener('change', (event) => {
    if (game.sandbox) sandboxState.godMode = event.target.checked;
    testState.godMode = event.target.checked;
  });
  testPanel.querySelector('#testFreezeTimer').addEventListener('change', (event) => {
    if (game.sandbox) sandboxState.freezeTimer = event.target.checked;
    testState.freezeTimer = event.target.checked;
  });
  window.addEventListener('error', (event) => recordTestLog('browser-error', {
    message: event.message, source: event.filename, line: event.lineno, column: event.colno,
  }));
  window.addEventListener('unhandledrejection', (event) => recordTestLog('unhandled-rejection', {
    reason: String(event.reason?.stack || event.reason),
  }));
}

const sandboxPanelUI = setupSandboxPanel({
  root: testPanel,
  state: sandboxState,
  onAction: (action) => {
    if (action === 'refill') { game.player.hp = 100; game.player.energy = 100; }
    else if (action === 'clearStress') { game.player.stress = 0; game.stressWarned = false; }
    else if (action === 'charge') game.charge = 100;
    else if (action === 'spawnOne') spawnSandboxFoxes({ state: sandboxState, spawnFox: (type) => spawnSandboxFox(type) });
    else if (action === 'spawnGroup') spawnSandboxFoxes({ count: 6, state: sandboxState, spawnFox: (type) => spawnSandboxFox(type) });
    else if (action === 'clearFoxes') clearSandboxFoxes({ state: sandboxState, clearFoxes: disposeAllFoxes });
  },
  onChange: (name, value) => {
    if (name === 'godMode') testState.godMode = value;
    if (name === 'freezeTimer') testState.freezeTimer = value;
    if (name === 'difficulty') { applySandboxDifficulty(sandboxState, value); foxes.forEach((f) => { f.sandboxSpeedMul = sandboxState.speedMultiplier; f.sandboxAlertMul = sandboxState.alertMultiplier; }); }
  },
});

function updateCooldownButtons() {
  for (const id of ['burst', 'ultimate']) {
    const el = document.querySelector(`[data-touch-action="${id}"]`);
    const overlay = el?.querySelector('.cooldown-overlay'); if (!el || !overlay) continue;
    const isUlt = id === 'ultimate';
    const data = cooldownOverlayData({ remaining: isUlt ? game.overCD : game.boostCD, duration: isUlt ? ULT.cooldown : 12,
      energy: game.player.energy, cost: isUlt ? ULT.cost : 20, charge: game.charge, charging: isUlt });
    el.classList.toggle('no-energy', data.state === 'no-energy'); overlay.classList.toggle('on', data.state === 'cd' || data.state === 'charging');
    overlay.style.setProperty('--cd-angle', `${data.angle}deg`); overlay.querySelector('em').textContent = data.state === 'cd' ? Math.ceil(isUlt ? game.overCD : game.boostCD) : '';
  }
}

// 键位变化时同步帮助面板上的按键提示，避免文档与实际绑定不一致
function syncHelpKeys() {
  const rows = binds.describe();
  const get = (id) => {
    const r = rows.find((x) => x.id === id);
    if (!r) return '';
    if (r.empty) return '鼠标左键';
    const parts = r.keys.slice();
    if (r.alt) parts.push(r.alt);
    return parts.join(' / ');
  };
  const turning = IS_DEV && binds.scheme === 'optimized';
  const movement = turning
    ? `<span><kbd>${get('forward')}</kbd><kbd>${get('back')}</kbd> 前后 · <kbd>${get('left')}</kbd><kbd>${get('right')}</kbd> 横移 · <kbd>${get('turnLeft')}</kbd><kbd>${get('turnRight')}</kbd> 转向</span>`
    : `<span><kbd>${get('forward')}</kbd><kbd>${get('back')}</kbd><kbd>${get('left')}</kbd><kbd>${get('right')}</kbd> 移动</span>`;
  const html = `
    <h3>操作说明</h3>
    <div class="keys">
      <span><kbd>鼠标</kbd> 视角</span>
      ${movement}
      <span><kbd>${get('attack')}</kbd> 攻击（可按住）</span>
      <span><kbd>${get('jump')}</kbd> 或 <kbd>鼠标右键</kbd> 跳跃</span>
      <span><kbd>${get('burst')}</kbd> 应急爆发</span>
      <span><kbd>${get('ultimate')}</kbd> 协同大招</span>
      <span><kbd>${get('interact')}</kbd> 救援 / 陪伴</span>
      <span><kbd>${get('sprint')}</kbd> 疾行（更快但更耗储备）</span>
      <span><kbd>${get('pause')}</kbd> 暂停　<kbd>${get('retry')}</kbd> 重试</span>
      <span><kbd>${get('restart')}</kbd> 从第一关重开</span>
    </div>
    <p class="note">洞穴内不能攻击。完成<b>采食 + 伙伴到家</b>后回洞，自动进入下一关。<br>
    <b>驱退不等于杀死</b>：藏狐体力耗尽后会转身逃向草地边缘，逃掉才消失，过一阵还可能再来。<br>
    <b>奔跑时会自动俯身冲刺，停下则起身</b> —— 起身比趴下稍慢，就像真的在用四肢撑起身体。<br>
    被困伙伴会周期性<b>呼救</b>，屏幕边缘的<b>绿色箭头</b>指向它；红色箭头则是正在逼近的藏狐。<br>
    <b>跳跃可以跳过扑击</b>：腾空够高时不会被藏狐碰到。</p>
    <button class="primary" id="helpClose2">知道了</button>`;
  helpSheet.innerHTML = html;
  const c2 = document.getElementById('helpClose2');
  if (c2) c2.onclick = () => { helpSheet.hidden = true; };
}
syncHelpKeys();
binds.onChange(syncHelpKeys);

// 注：Esc 退出指针锁定时的自动暂停，统一由上面的
// controller.onLockChange（失锁分支）处理，这里不再重复监听
// pointerlockchange —— 两处监听同一事件会在同一帧各调一次 pause()，
// 虽有幂等守卫兜底，但属于冗余逻辑。

// ============================================================
// 全屏模式
// ============================================================
const fsBtn = document.getElementById('fsBtn');

function toggleFullscreen() {
  const d = document;
  if (!d.fullscreenElement && !d.webkitFullscreenElement) {
    const el = d.documentElement;
    const req = el.requestFullscreen || el.webkitRequestFullscreen;
    if (req) {
      Promise.resolve(req.call(el)).catch(() => {
        hud.say('浏览器拒绝了全屏请求，可按 F11 切换。', 2.6);
      });
    } else {
      hud.say('当前浏览器不支持全屏，可按 F11。', 2.6);
    }
  } else {
    const exit = d.exitFullscreen || d.webkitExitFullscreen;
    if (exit) exit.call(d);
  }
}

function syncFullscreenUI() {
  const on = !!(document.fullscreenElement || document.webkitFullscreenElement);
  document.body.classList.toggle('fullscreen', on);
  if (fsBtn) {
    fsBtn.textContent = on ? '⤡' : '⤢';
    fsBtn.title = on ? '退出全屏 (F11)' : '全屏 (F11)';
    fsBtn.classList.toggle('active', on);
  }
  // 全屏时依据真实尺寸更新渲染分辨率
  resizeRenderer();
}
if (fsBtn) fsBtn.onclick = toggleFullscreen;
document.addEventListener('fullscreenchange', syncFullscreenUI);
document.addEventListener('webkitfullscreenchange', syncFullscreenUI);

if (TOUCH_DEVICE) {
  const blockGesture = (event) => event.preventDefault();
  document.addEventListener('contextmenu', blockGesture);
  document.addEventListener('dblclick', blockGesture, { passive: false });
  document.addEventListener('gesturestart', blockGesture, { passive: false });
  document.addEventListener('gesturechange', blockGesture, { passive: false });
}

// 窗口尺寸 / 全屏切换共用
function resizeRenderer() {
  const w = window.innerWidth, h = window.innerHeight;
  camera.aspect = w / h;
  // 保持基准 FOV：控制器会按姿态在其基础上收窄
  camera.updateProjectionMatrix();
  renderProfile = getRenderProfile();
  renderer.setPixelRatio(renderProfile.pixelRatio);
  renderer.setSize(w, h);
  if ('shadowMap' in renderer) renderer.shadowMap.enabled = renderProfile.shadows;
  // viewmodel 相机也要同步宽高比，否则爪子会被拉伸变形
  viewModel.resize(w / h);
}

window.addEventListener('resize', resizeRenderer);
window.addEventListener('orientationchange', () => requestAnimationFrame(resizeRenderer));
window.visualViewport?.addEventListener('resize', resizeRenderer);

canvas.addEventListener('webglcontextlost', (event) => {
  event.preventDefault();
  touchControls?.releaseAll();
  if (game.mode === 'play') pause();
  hud.say('图形设备暂时重置，请稍候…', 3.5);
});
canvas.addEventListener('webglcontextrestored', () => {
  resizeRenderer();
  hud.say('画面已恢复。', 2.2);
});

// ============================================================
// 主循环
// ============================================================
let last = performance.now();
let playerBodyYaw = controller.yaw;
let fpsAcc = 0, fpsCount = 0, fpsTimer = 0;

function frame(now) {
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;

  const touchPlaying = TOUCH_DEVICE && game.mode === 'play';
  if (document.body.classList.contains('touch-playing') !== touchPlaying) {
    document.body.classList.toggle('touch-playing', touchPlaying);
  }
  update(dt);
  playerModel.position.set(controller.position.x, controller.position.y, controller.position.z);
  playerBodyYaw = dampAngle(playerBodyYaw, controller.moveFacingYaw, dt, PLAYER.bodyTurnRate);
  playerModel.rotation.y = playerBodyYaw + Math.PI;
  // dt 传入 sky：天穹云随时间漂移（标题界面作为动态背景也在动）
  sky.update(controller.position, dt);

  // 主场景
  renderer.render(scene, camera);

  // viewmodel（自己的爪子/腿）在独立场景渲染。
  // renderer.clearDepth() 清除深度缓冲，确保爪子永远画在最上层，
  // 不会被地形或岩石穿插 —— 这是 FPS viewmodel 的标准做法。
  if (!thirdPerson && (game.mode === 'play' || game.mode === 'pause' || game.mode === 'levelclear')) {
    const airborne = controller.grounded === false;
    viewModel.update(
      dt,
      controller.crouch,
      controller.postureSpeed || 0,
      airborne,
      game.attackCD > 0 && stats_cache.cd > 0
        ? 1 - game.attackCD / stats_cache.cd
        : -1,
      controller.pitch,
    );
    viewModel.render(renderer);
  }

  // 性能提示
  fpsAcc += 1 / Math.max(dt, 0.0001);
  fpsCount++;
  fpsTimer += dt;
  if (fpsTimer > 2) {
    const fps = Math.round(fpsAcc / fpsCount);
    hud.setPerfHint(`${fps} FPS · ${renderer.info.render.triangles.toLocaleString()} 三角面`);
    fpsAcc = 0; fpsCount = 0; fpsTimer = 0;
  }

  requestAnimationFrame(frame);
}

// ============================================================
// 启动
// ============================================================
hud.setLoading(100);
loadLevel(0, false);
// 标题状态下相机也需要正确落位，否则会渲染在场景原点（地下）
controller.update(0.016, new Set(), 1);
sky.update(controller.position);
title();
hud.hideLoader();
if (SANDBOX_MODE) requestAnimationFrame(() => requestAnimationFrame(enterSandbox));
requestAnimationFrame(frame);

// 调试开关：URL 参数 ?debug=hide-<name> 可隐藏特定对象，便于排查渲染问题
const DEBUG_HIDE = (() => {
  const m = /debug=hide-([a-z]+)/.exec(location.search);
  return m ? m[1] : null;
})();

window.__game = {
  game, controller, scene, renderer, camera, keys, LEVELS,
  testMode: TEST_MODE, sandboxMode: SANDBOX_MODE, sandboxState, enterSandbox, exitSandbox,
  testState, testLogs, recordTestLog, testSnapshot, exportTestLogs,
  foxes: () => foxes, berries: () => berries, companion,
  combatStats: () => combatStats(game),
  burrow: BURROW,
  burrowObj: burrow, burrows: burrowDefs, scenery, sky, claw, shockwave, particles, damageText, aura, minimap,
  viewModel, playerModel, playerBody, setViewMode, get thirdPerson() { return thirdPerson; },
  binds, findConflicts, ACTIONS, FoxClass: Fox,
  isDev: IS_DEV, ecology: { energyOfPlant, eatLine, seasonForLevel, plantsForLevel, HERBIVORE },
  touchControls, renderProfile: () => getRenderProfile(),
  DEBUG_HIDE,
  // 摄影测量远景（异步加载完成后可用）
  backdrop: () => backdropRoot,
  // 环境修饰（雾 / 阵风 / 沙尘），便于测试与调参
  env, updateEnv,
  heightFieldActive, terrainHeight,
  // 供自动化测试走真实换关路径（重建藏狐/采食点/季节与环境修饰）
  loadLevel: (i) => loadLevel(i, false),
  gsWorld: () => gsWorld, gsStats: () => gsStats,
  foxesList: () => foxes,
  THREE,
};
