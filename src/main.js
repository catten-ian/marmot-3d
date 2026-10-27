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
  setPointScale, scalePoint, scaleCoord, scaleRadius,
  getPointScale, fieldHalf, FIELD_W, FIELD_H, ACCOUNTS,
} from './core/config.js';
import { clamp, terrainHeight, setHeightField, heightFieldActive } from './core/utils.js';
import { FirstPersonController } from './core/controls.js';
import { dampAngle, resolveAttackYaw } from './core/move-facing.mjs';
import {
  rollDirection, resolveAttackRelease, isWeakAerialPounce,
  interruptAttackCharge, resolvePendingAerialParry, advanceAttackCharge,
  AERIAL_POUNCE_DAMAGE_MUL, MAX_ATTACK_CHARGE_MS,
  strikeGateOpen, resolveParryOutcome,
} from './core/combat-wheel.mjs';
import { objectivesComplete } from './core/objectives.js';
import {
  installEnergyAlias, ingestGraze, chewMouth, applyNutrition, syncMetabolism,
  createFlowerRecovery, stepFlowerRecovery,
} from './core/stamina.mjs';
import { Keybinds, ACTIONS, findConflicts } from './core/keybinds.js';
import { bindText, kbd, schemeHints, setHintBinds } from './core/key-hints.mjs';
import { preloadModels } from './models/loader.js';
import { buildBackdrop } from './models/scene.js';
import { createRenderer, splatUsable } from './core/renderer.js';
import { AdaptiveRenderController, getRenderProfile, hasRealTouch } from './core/performance.js';
import { InputModeManager, INPUT_MODE_TOUCH } from './core/input-mode.mjs';
import { TouchControls } from './core/touch-controls.js';

/** 输入模式（设置面板可强制）：auto=设备检测+首次触摸升级，touch=强制触屏，keyboard=强制键鼠。 */
const inputMode = new InputModeManager();
let TOUCH_DEVICE = inputMode.isTouch();

/**
 * 输入模式统一生效入口：全局标记、body class、触控层、渲染 profile 与面板文案。
 * 切换即时生效，无需刷新；各子系统均做幂等/防御处理，初始化早期调用也安全。
 */
function applyInputMode() {
  TOUCH_DEVICE = inputMode.isTouch();
  document.body.classList.toggle('touch-mode', TOUCH_DEVICE);
  if (!TOUCH_DEVICE) document.body.classList.remove('touch-playing');
  document.documentElement.setAttribute('data-input-effective', TOUCH_DEVICE ? 'touch' : 'keyboard');
  try {
    if (touchControls) {
      // 强制触屏 + 无真实触摸能力的桌面调试：允许鼠标驱动摇杆/按钮/look zone。
      touchControls.allowMouse = TOUCH_DEVICE && inputMode.preference === INPUT_MODE_TOUCH && !hasRealTouch();
      if (TOUCH_DEVICE) touchControls.activate();
      else touchControls.deactivate();
    }
  } catch (_) {}
  try {
    // 键鼠模式不强制退出编辑：TouchLayout 会把可编辑范围收窄为常驻 HUD 卡片，
    // 虚拟摇杆与动作层在键鼠模式下保持隐藏。
    touchLayout?.setTouchModeAvailable?.(TOUCH_DEVICE);
  } catch (_) {}
  // 渲染预算跟随有效模式：强制触屏降级、强制键鼠恢复桌面质量。
  try {
    refreshRenderProfile();
  } catch (_) {}
  try { settingsUI?.render?.(); } catch (_) {}
  // 帮助/暂停/结算等面板按 TOUCH_DEVICE 分支渲染；标题面板打开时即时重渲染。
  try { if (game.mode === 'title') title(); } catch (_) {}
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
import { SmartFox } from './entities/smart-fox.js';
import { createSmartPack } from './entities/smart-fox-core.mjs';
import { hpDamageMultiplier } from './core/fox-motion.js';
import { Food, Companion, buildMarmotMesh } from './entities/props_entities.js';
import { devOn, IS_DEV, IS_BETA, USE_REAL_FOX_MODEL, VERSION, VERSION_LABEL } from './core/version.js';
import { BETA_TUNE, betaFlowerCompletesImmediately, resolveLungeLockYaw } from './core/beta-tuning.js';
import { applyRuntimeConfigFromLocation, fetchActiveBetaConfig, applyRuntimeValues } from './core/runtime-config.mjs';
import { betaInteractionSkillState, interactionSemantics } from './core/interaction-semantics.mjs';
import { documentTitleFor } from './core/version-mode.mjs';

// Admin's “应用” button hands Beta tuning through a signed-by-schema query payload.
// Invalid/absent payloads are ignored, preserving the shipped defaults.
if (IS_BETA) {
  try {
    const active = await fetchActiveBetaConfig({ locationLike: location, timeoutMs: 1500 });
    if (active.ok) applyRuntimeValues(active.payload.values, BETA_TUNE);
    else applyRuntimeConfigFromLocation(); // query remains an explicit debug fallback
  } catch (_) { try { applyRuntimeConfigFromLocation(); } catch (_) { /* fail-soft */ } }
}
import { readProgress, writeProgress, isLevelUnlocked } from './core/progress.mjs';
import {
  plantsForLevel, seasonForLevel, energyOfPlant, energyOfFlower, eatLine, HERBIVORE,
  stepForageProgress, isForagingEmergency, chooseFlowerIndices,
} from './core/ecology.js';
import {
  combatStats, strikeVolumeHit, foxAttackVerticalHit, resolveStrikeProfile, burst, ultimate, interact,
  STRIKE_COST, ULT, BOOST,
} from './systems/combat.js';
import { cooldownState, cooldownOverlayData } from './ui/cooldown-overlay.js';
import { ClawSwing, Shockwave, Particles, DamageText, PlayerAura } from './systems/effects.js';
import { ViewModel } from './systems/viewmodel.js';
import { Audio } from './systems/audio.js';
import { ALARM_INTERVALS, alarmSchedule, companionAlarmLevel, stereoPanFromWorld } from './systems/audio-pan.mjs';
import { HUD } from './ui/hud.js';
import { SettingsUI } from './ui/settings.js';
import { adapterPowerPreference, readGraphicsPreference, writeGraphicsPreference } from './core/graphics-preference.js';
import { FeedbackUI, collectGameSnapshot, initFeedbackFlush } from './ui/feedback.js';
import { FEEDBACK } from './core/config.js';
import { AccountsApi, buildScorePayload, escapeHtml } from './core/accounts-api.mjs';
import { clearSession, isUnauthorized, readSession, writeSession, restoreSession } from './core/accounts-session.mjs';
import { AuthModal } from './ui/auth-modal.mjs';
import { LeaderboardUI } from './ui/leaderboard.mjs';
import { TouchLayout } from './ui/touch-layout.js';
import { Minimap, shouldObserveMinimap } from './ui/minimap.js';
import { createSandboxState, SANDBOX_LEVEL, placeSandboxDummy, removeSandboxDummy, setSandboxDummyDefeatable } from './sandbox/state.js';
import { applySandboxDifficulty, spawnSandboxFoxes, clearSandboxFoxes } from './sandbox/commands.js';
import { setupSandboxPanel } from './sandbox/panel.js';
import { SandboxRecorder, downloadTake, renderSummaryText } from './sandbox/recorder.js';
import { drillRespawnPose, resetDrillFox } from './sandbox/drill.js';

const INTERACT_TEXT = interactionSemantics(IS_BETA);

// ============================================================
// 初始化
// ============================================================
const canvas = document.getElementById('scene');
const hud = new HUD({ beta: IS_BETA });
const audio = new Audio();
if (IS_BETA) {
  audio.preload({
    onProgress: ({ done, total, label }) => {
      const pct = 70 + (done / Math.max(1, total)) * 16;
      hud.setLoading(pct, `预载音频素材 ${done}/${total}${label ? ` · ${label}` : ''}`);
    },
  });
  audio.bindUserGesture(window);
}

// The shared shell keeps stable markup. Beta adjusts only the existing interact
// controls at startup, before help/settings/layout surfaces can expose them.
if (IS_BETA) {
  const interactButton = document.querySelector('[data-touch-action="interact"]');
  interactButton?.setAttribute('aria-label', INTERACT_TEXT.touchAria);
  const interactButtonLabel = interactButton?.querySelector('small');
  if (interactButtonLabel) interactButtonLabel.textContent = INTERACT_TEXT.touchLabel;
  const interactSkillLabel = document.querySelector('[data-kb-skill="interact"] .kb-name');
  if (interactSkillLabel) interactSkillLabel.textContent = INTERACT_TEXT.skillLabel;
}

hud.beginLoadingSession('正在启动');
hud.setLoading(8, '正在启动');

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
const graphicsPreferenceState = {
  preference: readGraphicsPreference(),
  setPreference(value) { this.preference = writeGraphicsPreference(value); return this.preference; },
};

let renderer;
let rendererStatus = {
  backend: 'webgl', supportsSplat: false, gpuReason: '',
  graphicsPreference: graphicsPreferenceState.preference,
  adapterPowerPreference: adapterPowerPreference(graphicsPreferenceState.preference),
  adapterInfo: null,
};
const adaptiveQuality = new AdaptiveRenderController();
let renderProfile = adaptiveQuality.apply(getRenderProfile(TOUCH_DEVICE));

if (WANT_GS) {
  const result = await createRenderer(canvas, {
    preferWebGPU: true,
    forceWebGL: BOOT.forceWebGL,
    graphicsPreference: graphicsPreferenceState.preference,
  });
  renderer = result.renderer;
  rendererStatus = {
    backend: result.status.backend,
    supportsSplat: splatUsable(result),
    gpuReason: result.status.gpuReason,
    graphicsPreference: result.status.graphicsPreference,
    adapterPowerPreference: result.status.adapterPowerPreference,
    adapterInfo: result.status.adapterInfo,
  };
} else {
  renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: renderProfile.antialias,
    powerPreference: adapterPowerPreference(graphicsPreferenceState.preference),
    stencil: false,
  });
}

renderProfile = getRenderProfile(TOUCH_DEVICE);
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
    tag.title = `${rendererStatus.gpuReason || '高斯泼溅需要 WebGPURenderer'} · 偏好：${rendererStatus.graphicsPreference || graphicsPreferenceState.preference}`;
  }
}

hud.setLoading(22, '初始化渲染器');

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(
  // far 必须大于天穹球半径(900)，否则天空会被裁掉
  78, window.innerWidth / window.innerHeight, 0.05, 1600,
);

const sky = new Sky(scene, renderer);
hud.setLoading(45, '生成天空与光照');

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
    hud.setLoading(48, '加载场景资源');
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
  hud.setLoading(60, '场景资源就绪');
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
hud.setLoading(70, '布置场景与植被');

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
const forage = { index: -1, progress: 0, emergency: false };
let interactHeld = false;
let grazeProne = 0;
// beta 啃环境草：当前一轮(grassSeconds)内已按实际吃量逐帧结算的储备累计，供收尾飘字
let grazeCycleEaten = 0;
function buildFoods(levelIndex) {
  if (devOn('seasonalFood')) {
    const plants = plantsForLevel(levelIndex, BERRY_POINTS.length);
    const flowers = new Set(chooseFlowerIndices(
      BERRY_POINTS.length, levelIndex, IS_BETA ? { count: BETA_TUNE.flowerCount } : {},
    ));
    return BERRY_POINTS.flatMap((p, i) => {
      if (IS_BETA && !flowers.has(i)) return [];
      const [x, z] = scalePoint(p);
      return [new Food(scene, x, z, i, plants[i], IS_BETA ? 'flower' : (flowers.has(i) ? 'flower' : 'grass'))];
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
const minimap = new Minimap({ beta: IS_BETA });
let debugVolumes = null;
let debugVolumesReady = Promise.resolve();
let foxes = [];
hud.setLoading(86, '生成实体与模型');

// —— 系统 ——
const controller = new FirstPersonController(camera, canvas);
const claw = new ClawSwing(scene);
const shockwave = new Shockwave(scene);
const particles = new Particles(scene);
const damageText = new DamageText(scene);
const aura = new PlayerAura(scene);
const viewModel = new ViewModel();
viewModel.resize(window.innerWidth / window.innerHeight);

// 独立数据显示模式默认完全不加载 lil-gui，也不创建额外几何体。
if (new URLSearchParams(location.search).get('debugvolumes') === '1') {
  debugVolumesReady = import('./systems/debug-volumes.js').then(({ DebugVolumes }) => {
    debugVolumes = new DebugVolumes({ scene, controller, foxes: () => foxes });
  }).catch((error) => { console.warn('[debugvolumes] disabled:', error); });
}

// 藏狐调参台：独立 URL 参数 ?foxtune=1，同样懒加载，普通玩家零开销。
if (new URLSearchParams(location.search).get('foxtune') === '1') {
  import('./systems/fox-tuning.js').then(({ FoxTuning }) => {
    new FoxTuning({ scene, controller, foxes: () => foxes, respawnFoxes: respawnFoxesForTuning });
  }).catch((error) => console.warn('[foxtune] disabled:', error));
}

const playerModel = new THREE.Group();
const playerBody = buildMarmotMesh();
playerModel.add(playerBody);
scene.add(playerModel);
playerModel.visible = false;

const VIEW_MODE_KEY = 'marmot3d.viewMode.v1';
let thirdPerson = false;
try { thirdPerson = localStorage.getItem(VIEW_MODE_KEY) === 'third-person'; } catch (_) { /* storage may be unavailable */ }

// 视角切换键可重绑（keybinds 的 cameraView 动作）。binds 实例在模块后段创建，
// setViewMode 首次执行时 binds 尚不可用，故用可变标签 + 创建后统一刷新。
// 注意：该变量必须在本文件首次调用 setViewMode() 之前初始化，否则触发 TDZ。
let viewKeyLabel = 'V';
// beta 沙盒操作录制器：声明必须在初始化期 setViewMode() 之前，避免 TDZ。
let sandboxRecorder = null;

function setViewMode(enabled, announce = false) {
  thirdPerson = !!enabled;
  sandboxRecorder?.view(thirdPerson, game.totalTime);
  controller.setThirdPerson(thirdPerson);
  playerModel.visible = thirdPerson;
  if (viewBtn) {
    viewBtn.textContent = thirdPerson ? '第三人称' : '第一人称';
    viewBtn.setAttribute('aria-pressed', String(thirdPerson));
    refreshViewKeyHint();
  }
  document.body.classList.toggle('third-person', thirdPerson);
  try { localStorage.setItem(VIEW_MODE_KEY, thirdPerson ? 'third-person' : 'first-person'); } catch (_) { /* storage may be unavailable */ }
  if (announce) hud.say(thirdPerson ? '已切换到第三人称视角' : '已切换到第一人称视角', 1.8);
}

const viewBtn = document.getElementById('viewBtn');
if (viewBtn) viewBtn.onclick = () => setViewMode(!thirdPerson, true);
setViewMode(thirdPerson);

function refreshViewKeyHint() {
  if (!viewBtn) return;
  viewBtn.title = thirdPerson
    ? `切换第一人称视角 (${viewKeyLabel})`
    : `切换第三人称视角 (${viewKeyLabel})`;
}

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
    retrying: '加载失败，正在自动重试',
    empty: '场景为空（程序化模型可见）',
    'empty-geometry': '几何无效（程序化模型可见）',
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
    // Beta keeps the procedural horizon visible without the scan-grid backdrop's holes.
    if (IS_BETA) root.visible = false;
    scene.add(root);
    backdropRoot = root;
    const ud = root.userData || {};
    console.info(`[scene] 远景布景已加入：${ud.count} 份 @ 半径 ${ud.radius}m`);
  }
});

const keys = new Set();
controller.keys = keys;

hud.setLoading(96, '即将就绪');

// —— 版本角标 ——
// dev 版（?version=dev）是"按旱獭真实生态学改写"的实验分支，
// 与正式版并存但互不影响，页面上明确标出以便对照。
{
  const tag = document.getElementById('versionTag');
  if (tag) {
    tag.className = `version-tag ${IS_DEV ? 'dev' : IS_BETA ? 'beta' : 'stable'}`;
    tag.textContent = IS_DEV
      ? 'DEV · 旱獭生态学改写（草食 / 耐饥渴 / 季节食物）'
      : VERSION_LABEL;
    tag.title = IS_DEV
      ? '当前为 dev 实验版：采食对象为当季草本植物，储备消耗更低。正式版请去掉 ?version=dev'
      : IS_BETA
        ? '当前为 Beta 体验版：默认开放全部关卡，完成记录与正式版隔离。'
        : '正式版。追加 ?version=dev 可体验生态学改写';
  }
  document.body.classList.toggle('dev-version', IS_DEV);
  document.body.classList.toggle('beta-version', IS_BETA);
}

// —— 标签页标题：beta/dev 附加通道后缀，stable 保持静态 <title> 不动 ——
{
  const docTitle = documentTitleFor(VERSION);
  if (docTitle) document.title = docTitle;
}

// ============================================================
// 游戏状态
// ============================================================
// Beta uses an independent record and an in-memory all-level unlock default;
// stable retains the original shared key and sequential unlock behavior.
const progressStorage = {
  getItem: (...args) => localStorage.getItem(...args),
  setItem: (...args) => localStorage.setItem(...args),
};
const progress = readProgress(progressStorage, LEVELS.length, IS_BETA);
if (IS_BETA) progress.maxUnlocked = LEVELS.length - 1;
function saveProgress() {
  try {
    writeProgress(progressStorage, progress, IS_BETA);
  } catch (err) {
    console.warn('[progress] 无法保存关卡进度:', err);
  }
}

const TEST_MODE = new URLSearchParams(location.search).get('test') === '1';
const SANDBOX_MODE = new URLSearchParams(location.search).get('sandbox') === '1';
const SANDBOX_DEBUG_MODE = IS_BETA && new URLSearchParams(location.search).get('sandboxdebug') === '1';
const sandboxEnterHooks = [];
const sandboxState = createSandboxState();
 sandboxState.smartPack = createSmartPack();
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
  companionAlarmTimer: 0,
  testMode: TEST_MODE,
  freezeTimer: testState.freezeTimer,
  mode: 'title',
  level: 0,
  completed: 0,
  player: { x: 0, y: 0, z: 0, hp: 100, stamina: 100, fat: 0, mouth: 0, mouthCapacity: BETA_TUNE.mouthCapacity, stress: 0, invuln: 0 },
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
  recentlyHit: 0,
  flowerRecovery: null,
};
installEnergyAlias(game.player);

const colBoost = new THREE.Color(0xffd17a);
const colHit = new THREE.Color(0xffe3a4);
const colRepel = new THREE.Color(0xd8e8c0);
const colUlt = new THREE.Color(0xdeb0ff);
const colBerry = new THREE.Color(0xc46a5e);
// dev 版草本植物的碎屑用叶绿色
const colHerb = new THREE.Color(0xa8c07a);
const colHurt = new THREE.Color(0xeea091);

/** Create a campaign fox at its configured slot; level count and spawn point are unchanged. */
function makeFox(i) {
  const cfg = LEVELS[game.level];
  const [sx, sz] = scalePoint(SPAWN_POINTS[i % SPAWN_POINTS.length]);
  // Campaigns retain their configured counts and spawn points, but every slot is a normal Tibetan fox.
  return wireRepelCallback(new Fox(scene, sx + (Math.random() - 0.5) * 4, sz + (Math.random() - 0.5) * 4,
    'normal', game.level, i, { lureBias: cfg.lureBias || 1 }));
}

function spawnSandboxFox(_type = 'normal', slot = foxes.filter((f) => !f.isSandboxDummy).length, opts = {}) {
  let x, z;
  if (opts.sandboxDummy) {
    controller.forwardFlat(_fwd);
    const distance = 5;
    x = controller.position.x + _fwd.x * distance;
    z = controller.position.z + _fwd.z * distance;
  } else {
    const distance = 8 + (slot % 3) * 2.4;
    const angle = controller.yaw + (slot - 1) * 0.24;
    x = controller.position.x + Math.sin(angle) * distance;
    z = controller.position.z + Math.cos(angle) * distance;
  }
  const type = opts.allowConfiguredType && Object.prototype.hasOwnProperty.call(FOX.types || {}, _type) ? _type : 'normal';
  const fox = wireRepelCallback(new Fox(scene, x, z, type, opts.allowConfiguredType ? game.level : 0, slot,
    { lureBias: 1.15, dummyDefeatable: sandboxState.dummyDefeatable, ...opts }));  if (opts.sandboxDummy) {
    fox.yaw = Math.atan2(controller.position.x - x, controller.position.z - z);
  }
  fox.sandboxSpeedMul = sandboxState.speedMultiplier;
  fox.sandboxAlertMul = sandboxState.alertMultiplier;
  fox.applySmartDifficulty?.(sandboxState.difficulty);
  foxes.push(fox);
  return fox;
}

/** 沙盒：在玩家前方生成一只效用决策智能藏狐（不影响正式关卡）。 */
function spawnSandboxSmartFox(slot = foxes.filter((f) => !f.isSandboxDummy).length) {
  const distance = 9;
  const angle = controller.yaw;
  const x = controller.position.x + Math.sin(angle) * distance;
  const z = controller.position.z + Math.cos(angle) * distance;
  const fox = wireRepelCallback(new SmartFox(scene, x, z, 0, slot, { lureBias: 1.15, ...(IS_BETA ? { hp: 4 } : {}) }));
  fox.yaw = Math.atan2(controller.position.x - x, controller.position.z - z);
  fox.sandboxSpeedMul = sandboxState.speedMultiplier;
  fox.sandboxAlertMul = sandboxState.alertMultiplier;
  fox.applySmartDifficulty?.(sandboxState.difficulty);
  foxes.push(fox);
  sandboxState.lastCommand = '已生成 1 只智能藏狐（观察/逼近/虚晃/扑击/喘息）';
  return fox;
}

function disposeAllFoxes() {
  try {
    foxes.forEach((f) => f.dispose(scene));
  } finally {
    foxes = [];
    sandboxState.dummy = null;
    sandboxState.smartPack = createSmartPack();
  }
}

let sandboxResumeLevel = null;
let sandboxDebugGUI = null;
function destroySandboxDebugGUI() {
  const instance = sandboxDebugGUI;
  sandboxDebugGUI = null;
  try { instance?.destroy?.(); } catch (error) { console.warn('[sandboxdebug] cleanup failed:', error); }
}

function replicateSandboxLevel(levelIndex) {
  if (!IS_BETA || !game.sandbox || !sandboxState.active) return '请先进入自由沙盒再复现关卡';
  const index = Number(levelIndex);
  if (!Number.isInteger(index) || index < 0 || index >= LEVELS.length) return '无效关卡';
  const cfg = LEVELS[index];
  const count = Number(cfg?.count);
  if (!Number.isFinite(count) || count < 0 || !cfg || typeof cfg !== 'object') return '关卡配置无效';
  const types = Array.isArray(cfg.types) && cfg.types.length
    ? cfg.types.filter((type) => type != null && Object.prototype.hasOwnProperty.call(FOX.types || {}, String(type))).map((type) => String(type))
    : ['normal'];
  const rosterTypes = types.length ? types : ['normal'];
  const roster = Array.from({ length: Math.floor(count) }, (_, slot) => rosterTypes[slot % rosterTypes.length]);

  // 只在沙盒内更换演练配置；game.sandbox 保持 true，因此没有计时/失败/正式通关结算。
  clearSandboxFoxes({ state: sandboxState, clearFoxes: disposeAllFoxes });
  game.level = index;
  sandboxState.active = true;
  applySandboxDifficulty(sandboxState, 'standard');
  const difficultyControl = document.getElementById('sandboxDifficulty');
  if (difficultyControl) difficultyControl.value = 'standard';
  roster.forEach((type, slot) => spawnSandboxFox(type, slot, {
    allowConfiguredType: true,
    lureBias: cfg.lureBias || 1,
  }));
  foxes.forEach((fox) => {
    if (!fox.isSandboxDummy) {
      fox.sandboxSpeedMul = 1;
      fox.sandboxAlertMul = 1;
    }
  });
  game.time = Infinity;
  game.foodCount = 0;
  game.levelRepels = 0;
  applyEnvModifiers(cfg);
  sky.applyLevel(cfg);
  scene.fog.near = env.fogBase;
  scene.fog.far = env.fogFarBase;
  env._msgOn = false;

  const typeSummary = [...new Set(rosterTypes)].join('、') || 'normal';
  const environment = [
    `风力 ${Number(cfg.windGust || 0).toFixed(1)}`,
    `雾 ${env.fogBase}/${env.fogFarBase}`,
    cfg.sandstorm ? '沙尘' : '无沙尘',
  ].join(' · ');
  const keyConfig = `配置：速度 ${Number(cfg.speed || 0).toFixed(1)}、蓄力 ${Number(cfg.wind || 0).toFixed(2)}s、增援 ${Number(cfg.reinforce || 0).toFixed(1)}s、目标 ${cfg.goal ?? '—'}、原限时 ${cfg.time ?? '—'}s`;
  const summary = `已复现第 ${index + 1} 关「${cfg.name || '未命名'}」：${roster.length} 只（类型 ${typeSummary}）；${keyConfig}；${environment}。仍处于自由沙盒，不计时、不结算。${cfg.brief ? ` 提示：${cfg.brief}` : ''}`;
  hud.say(summary, 5.5);
  return summary;
}

function createSandboxDebugActions() {
  const actions = {
    getLevels: () => LEVELS,
    spawnOne: () => spawnSandboxFoxes({ state: sandboxState, spawnFox: (type) => spawnSandboxFox(type) }),
    spawnGroup: () => spawnSandboxFoxes({ count: 6, state: sandboxState, spawnFox: (type) => spawnSandboxFox(type) }),
    clearFoxes: () => clearSandboxFoxes({ state: sandboxState, clearFoxes: disposeAllFoxes }),
    placeDummy: () => placeSandboxDummy({
      state: sandboxState,
      createDummy: () => spawnSandboxFox('normal', -1, { sandboxDummy: true, dummyDefeatable: sandboxState.dummyDefeatable }),
      removeDummy: (dummy) => { foxes = foxes.filter((fox) => fox !== dummy); dummy.dispose(scene); },
    }),
    removeDummy: () => removeSandboxDummy({
      state: sandboxState,
      removeDummy: (dummy) => { foxes = foxes.filter((fox) => fox !== dummy); dummy.dispose(scene); },
    }),
    refill: () => { game.player.hp = PLAYER.maxHp; game.player.energy = PLAYER.maxEnergy; },
    charge: () => { game.charge = 100; },
    onState: () => foxes.forEach((fox) => {
      if (!fox.isSandboxDummy) {
        fox.sandboxSpeedMul = sandboxState.speedMultiplier;
        fox.sandboxAlertMul = sandboxState.alertMultiplier;
      }
    }),
    onFlag: (name, value) => {
      if (name === 'godMode') testState.godMode = !!value;
      if (name === 'freezeTimer') { testState.freezeTimer = !!value; game.freezeTimer = !!value; }
      const controlId = name === 'godMode' ? 'testGodMode' : name === 'freezeTimer' ? 'testFreezeTimer' : null;
      const control = controlId && document.getElementById(controlId);
      if (control) control.checked = !!value;
    },
    onReset: () => actions.onState?.(),
    replicateLevel: replicateSandboxLevel,
  };
  if (debugVolumes?.state && typeof debugVolumes._rebuildAttack === 'function') {
    actions.toggleVolumes = () => {
      debugVolumes.state.enabled = !debugVolumes.state.enabled;
      debugVolumes._rebuildAttack();
      debugVolumes.gui?.controllersRecursive?.().forEach((controller) => controller.updateDisplay());
      return debugVolumes.state.enabled;
    };
  }
  return actions;
}

if (IS_BETA && SANDBOX_DEBUG_MODE) {
  sandboxEnterHooks.push(async () => {
    if (!game.sandbox || !sandboxState.active || sandboxDebugGUI) return;
    try {
      const { createSandboxDebugGUI } = await import('./systems/sandbox-debug.js');
      await debugVolumesReady;
      if (!game.sandbox || !sandboxState.active || sandboxDebugGUI) return;
      sandboxDebugGUI = createSandboxDebugGUI({ actions: createSandboxDebugActions(), state: sandboxState });
    } catch (error) {
      console.warn('[sandboxdebug] disabled:', error);
    }
  });
}

/** 调参台"重生当前狐狸"：按原槽位/原位置重建，让 maxHp/maxStamina 等构造时快照立即生效。 */
function respawnFoxesForTuning() {
  const snapshot = foxes.filter((f) => !f.isSandboxDummy).map((f) => ({
    smart: f instanceof SmartFox, x: f.x, z: f.z, yaw: f.yaw, slot: f.slot ?? 0,
  }));
  disposeAllFoxes();
  for (const s of snapshot) {
    const fox = s.smart ? spawnSandboxSmartFox(s.slot) : spawnSandboxFox('normal', s.slot);
    fox.x = s.x; fox.z = s.z; fox.yaw = s.yaw;
  }}

function enterSandbox() {
  hud.hidePanel();
  sandboxResumeLevel = game.level;
  sandboxState.active = true; sandboxState.godMode = false; sandboxState.freezeTimer = true;
  game.sandbox = true; game.mode = 'play'; document.body.classList.add('sandbox-active');
  testModeBtn.hidden = false; testModeBtn.textContent = '沙盒控制';
  testState.godMode = false; testState.freezeTimer = true;
  loadLevel(0, false); disposeAllFoxes();
  for (let i = 0; i < 3; i++) spawnSandboxFox('normal', i);
  game.time = Infinity; game.foodCount = 0; game.levelRepels = 0; game.player.hp = 100; game.player.energy = 100;
  game.player.stress = 0; game.charge = 100;
  applySandboxDifficulty(sandboxState, sandboxState.difficulty);
  if (!controller.touchEnabled) controller.requestLock();
  for (const hook of sandboxEnterHooks) {
    try { Promise.resolve(hook()).catch((error) => console.warn('[sandboxdebug] hook failed:', error)); }
    catch (error) { console.warn('[sandboxdebug] hook failed:', error); }
  }
}
function exitSandbox() {
  sandboxState.active = false; game.sandbox = false;
  if (sandboxResumeLevel != null) game.level = sandboxResumeLevel;
  sandboxResumeLevel = null;
  destroySandboxDebugGUI();
  const godBadge = document.getElementById('sandboxGodBadge');
  if (godBadge) godBadge.style.display = 'none';
  document.body.classList.remove('sandbox-active');
  testModeBtn.hidden = !TEST_MODE; testModeBtn.textContent = '测试';
  setTestPanelOpen(false);
  title();
}

// —— BETA 专属：扮演藏狐（独立模式，懒加载，不影响 stable/dev 主路径）——
let playAsFox = null;
async function enterPlayAsFox() {
  if (playAsFox) return;
  hud.hidePanel();
  game.sandbox = false; game.mode = 'play';
  document.body.classList.remove('sandbox-active', 'touch-playing');
  // 清掉场地上的敌狐，避免与扮演模式的猎物混淆
  disposeAllFoxes();
  const { createPlayAsFox } = await import('./play/play-as-fox.js');
  if (playAsFox) return; // 防重入
  playAsFox = createPlayAsFox({
    scene, camera, renderer, canvas, sky, audio,
    playerModel, companion,
    touchControls, binds, scenery,
    isTouchMode: () => TOUCH_DEVICE,
    mouseSensitivity: controller.sensitivity,
    touchLookSensitivity: controller.touchLookSensitivity,
    getFoxes: () => foxes,
    requestLock: () => { if (!touchControls.controller.touchEnabled) controller.requestLock(); },
    onExit: () => {
      playAsFox = null;
      document.body.classList.remove('play-as-fox');
      controller.update(0.016, new Set(), 1);
      title();
    },
  });
  // BETA 调试后台（lil-gui）：仅 ?pafdebug=1 懒加载，普通玩家/stable/dev 永不加载。
  if (new URLSearchParams(location.search).get('pafdebug') === '1') {
    try {
      const { attachPlayAsFoxDebug } = await import('./play/play-as-fox-debug.js');
      if (playAsFox && window.__playAsFox) {
        attachPlayAsFoxDebug(window.__playAsFox, {
          scene,
          pounce: () => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', bubbles: true })),
          openFeedback: () => feedbackUI.open(),
        });
      }
    } catch (error) { console.warn('[pafdebug] disabled:', error); }
  }
}
function exitPlayAsFox() { playAsFox?.exit(); }
window.__enterPlayAsFox = enterPlayAsFox;

// 每关开始时的累计统计快照：game.boosts/ultimates/hits 为整轮累计，单关榜用差值。
const levelStartStats = { hits: 0, boosts: 0, ultimates: 0 };

function loadLevel(index, announce = true) {
  clearPendingAerialParry();
  cancelAttackCharge();
  game.level = index;
  const cfg = game.sandbox ? SANDBOX_LEVEL : LEVELS[index];

  // 重置玩家
  const p = game.player;
  p.hp = 100; p.stamina = 100; p.fat = 0; p.mouth = 0; p.stress = 0; p.invuln = 2;
  game.flowerRecovery = null;
  game.recentlyHit = 0;
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
  if (IS_BETA) scenery.resetGraze();
  grazeCycleEaten = 0;
  game.foodCount = 0;
  forage.index = -1; forage.progress = 0; forage.emergency = false;
  hud.setForage({ active: false });

  // 重置伙伴（关卡配置里的点位是设计坐标，GS 版需经 scalePoint 缩放到运行时场地）
  const [friendX, friendZ] = scalePoint(cfg.friend);
  companion.placeAt(friendX, friendZ);
  game.friend = companion;

  game.levelRepels = 0;
  game.bossDown = true; // No level contains a special boss after normal-only conversion.
  game.time = game.sandbox ? Infinity : cfg.time;
  game.elapsed = 0;
  // 单关统计快照：game.boosts/ultimates/hits 为整轮累计，上报单关榜时用起止差值。
  levelStartStats.hits = game.hits;
  levelStartStats.boosts = game.boosts;
  levelStartStats.ultimates = game.ultimates;
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
  fogBase: IS_BETA ? 60 : 70,    // 本关雾的 near
  fogFarBase: 420,// 本关雾的 far
  fogSandFar: 30, // 沙尘时的 far（越近越看不清）
};

/** 按关卡配置设置环境修饰的基准值 */
function applyEnvModifiers(cfg) {
  env.gustMax = cfg.windGust || 0;
  env.fogBase = cfg.fogNear || (IS_BETA ? 60 : 70);
  env.fogFarBase = cfg.fogFar || 420;
  env.sandPeriod = cfg.sandstorm ? 11 : 0;
  env.gustPhase = (game.level * 2.399) % 6.283; // 黄金角散布，各关风向/起始相位不同
  env.gustDir = game.level % 2 === 0 ? 1 : -1;
  env.sandT = 0;
  env.sandOn = false;
  env.gust = 0;
}

/** 每帧推进环境修饰，返回当前需要给 HUD 的提示文案 */
function updateEnv(dt, inBurrow = false) {
  // 洞穴判定沿用 burrowVolumeAt/inBurrow 语义：天气时间继续走，
  // 但洞内不接收阵风，也不显示/听到沙尘影响。离洞后按当前天气相位恢复。
  const weatherSuppressed = !!inBurrow;

  // —— 阵风：正弦叠加两个不同周期，产生不规则的阵风节奏 ——
  if (env.gustMax > 0) {
    env.gustPhase += dt * 0.55;
    const s = Math.sin(env.gustPhase) * 0.62 + Math.sin(env.gustPhase * 2.37 + 1.1) * 0.38;
    env.gust = weatherSuppressed ? 0 : env.gustMax * s;
  } else {
    env.gust = 0;
  }

  // —— 沙尘：周期性把能见度压低 ——
  let sandMsg = null;
  if (env.sandPeriod > 0) {
    env.sandT = (env.sandT + dt) % (env.sandPeriod * 2);
    const t = env.sandT;
    // 前 1/4 周期起风、中间 1/2 维持、后 1/4 散去
    const stormOn = t > env.sandPeriod * 0.25 && t < env.sandPeriod * 1.25;
    env.sandOn = !weatherSuppressed && stormOn;
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
  // 洞内以及沙尘结束后都恢复关卡本来的雾；洞穴照明仍由 sky.setUnderground 单独处理。
  if (!env.sandOn) {
    scene.fog.near = env.fogBase;
    scene.fog.far = env.fogFarBase;
  }
  return sandMsg;
}

function updateEnvNotice(envMsg) {
  if (envMsg && !env._msgOn) { hud.say(envMsg, 2.6); env._msgOn = true; }
  else if (!envMsg && env._msgOn) env._msgOn = false;
}

function completeLevel() {
  // 立即切出 play 状态：否则主循环会在面板显示期间反复满足通关条件，
  // 导致 completed 被重复累加。
  game.mode = 'levelclear';
  game.completed++;
  progress.completedLevels.add(game.level);
  progress.maxUnlocked = Math.max(progress.maxUnlocked, Math.min(game.level + 1, LEVELS.length - 1));
  saveProgress();
  if (IS_BETA && !game.sandbox) {
    submitLevelScore(game.level, game.elapsed, {
      hits: Math.max(0, game.hits - levelStartStats.hits),
      boosts: Math.max(0, game.boosts - levelStartStats.boosts),
      ultimates: Math.max(0, game.ultimates - levelStartStats.ultimates),
    });
  }
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
  hidePauseMini();
  if (game.mode === 'won' || game.mode === 'lost') return;
  clearPendingAerialParry();
  cancelAttackCharge();
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
    const locked = !isLevelUnlocked(progress, i);
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
  hidePauseMini();
  destroySandboxDebugGUI();
  if (game.sandbox && sandboxResumeLevel != null) game.level = sandboxResumeLevel;
  sandboxResumeLevel = null;
  sandboxState.active = false;
  clearPendingAerialParry();
  cancelAttackCharge();
  game.mode = 'title';
  game.sandbox = false;
  document.body.classList.remove('sandbox-active');
  const h = schemeHints(binds, { isDev: IS_DEV });
  hud.showPanel(`
    <div class="eyebrow">CAMPAIGN / ${LEVELS.length} 关草原冒险 · 第一 / 第三人称 3D</div>
    <h2>从两只藏狐，到草原守望者。</h2>
    <button class="sandbox-entry" id="sandboxEntryBtn" type="button">自由测试 / 沙盒 <span>不计关卡 · 无限练习</span></button>
    ${IS_BETA ? `<button class="sandbox-entry" id="playAsFoxBtn" type="button" style="border-color:#b98a4a">扮演藏狐（BETA） <span>潜行 · 蓄力 · 扑击捕猎土拨鼠</span></button>` : ''}
    <p>你是草原上的一只土拨鼠。默认第一人称贴近草地，也可以按 <b>${bindText(binds, 'cameraView', 'V')}</b> 切换为第三人称跟随视角，随时按需选择。</p>
    <p>每关完成 <b>采食、救援与陪伴</b>，回洞即可进入下一关。
    ${LEVELS.length} 关逐步引入疾行、绕行、雾、强风与沙尘；后段需要同时判断环境和狐狸的攻击预警。</p>
    <p style="font-size:12px">采食需要按住停留；附近有狐狸、疾行或刚受击时会明显变慢。${IS_BETA ? ' BETA 关卡会少量出现稀有花：采得更快、回复更多，但不会刷新。' : ''}</p>
    <p style="font-size:12.5px"><b>普通藏狐打不死</b> —— 它会自己判断形势，血量见底就撤到远处躲起来把血回满；
    就算被你打得夹尾逃跑，过一阵也会重新出现，只有<b>狐首领</b>被打退后一去不返。
    <b>逼退</b>它才算暂时解除威胁。你要做的是在采食和救援时自卫，随后回洞。</p>
    ${IS_DEV || IS_BETA ? `
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
      ${TOUCH_DEVICE ? '<span><kbd>触屏</kbd> 第一人称摇杆左右转向、前后移动（可同时）· 第三人称摇杆决定移动方向 · 右侧拖动视角 · 屏幕按钮执行动作</span>' : ''}
      <span><kbd>鼠标</kbd> 视角转动</span>
      <span><kbd>V</kbd> 第一 / 第三人称切换</span>
      <span id="titleMoveHint">${h.movement}</span>
      <span><kbd>${h.attack}</kbd> 攻击（可按住）</span>
      <span><kbd>${h.parry}</kbd> 迎击</span>
      <span><kbd>${h.jump}</kbd> 跳跃（可躲扑击）</span>
      <span><kbd>${h.burst}</kbd> 短时应急爆发</span>
      <span><kbd>${h.ultimate}</kbd> 蓄满后的范围大招</span>
      <span><kbd>${h.interact}</kbd> ${INTERACT_TEXT.titleHelp}</span>
      <span><kbd>${h.sprint}</kbd> 疾行（更快但更耗${IS_BETA ? '体力' : '储备'}）</span>
      <span><kbd>${h.pause}</kbd> 暂停　<kbd>${h.retry}</kbd> 重试　<kbd>${h.restart}</kbd> 重开</span>
    </div>
    <p style="font-size:12.5px">洞口有暖光，那就是家 —— 里面不能攻击，${IS_BETA ? '主洞与临时洞都会咀嚼口中草料，主洞更快；空口不回体力' : '但能休息回储备'}。<br>
    屏幕边缘的红箭头表示有藏狐正在你背后靠近；<b>绿箭头是伙伴的呼救</b>，它会周期性叫两声。</p>
    <p style="font-size:12.5px"><b>奔跑时你会自动俯下身子冲刺，停下则撑起身来</b> ——
    起身比趴下慢一点，就像土拨鼠真的要用四肢撑起身体。</p>
    <p style="font-size:12px;color:#9db392">不适手？点右上角 <b>⚙</b> 可切换<b>兼容 / 优化 / 自定义</b>键位方案。</p>
    ${IS_BETA ? (() => {
      const s = accountStore();
      const right = s
        ? (s.user.guest
          ? `<span class="account-name">游客：${escapeHtml(s.user.name)} · 成绩可上榜</span><button class="ghost" id="accountUpgradeBtn" type="button">升级账号（保留成绩）</button><button class="ghost" id="accountLogoutBtn" type="button">换个身份</button>`
          : `<span class="account-name">玩家：${escapeHtml(s.user.name)}</span><button class="ghost" id="accountLogoutBtn" type="button">退出</button>`)
        : '<span class="account-name">正在进入游客模式…</span>';
      return `<div class="accounts-title-row">${right}<button class="ghost" id="leaderboardBtn" type="button">排行榜</button></div>`;
    })() : ''}
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
  const pafBtn = document.getElementById('playAsFoxBtn');
  if (pafBtn) pafBtn.onclick = enterPlayAsFox;
  document.getElementById('levelSelectBtn').onclick = showLevelSelect;
  document.getElementById('howBtn').onclick = showTeacherNote;
  if (IS_BETA) {
    document.getElementById('leaderboardBtn')?.addEventListener('click', () => leaderboardUI?.open());
    document.getElementById('accountUpgradeBtn')?.addEventListener('click', () => authModal?.open('upgrade'));
    document.getElementById('accountLogoutBtn')?.addEventListener('click', () => {
      clearSession(undefined, ACCOUNTS.storageKey);
      setAccountSession(null);
      title();
      // 退出/换身份后立即签发新游客，保证下一局仍可上榜。
      void accountsApi.guest().then((res) => {
        const s = writeSession(res?.token, res?.user, undefined, ACCOUNTS.storageKey);
        if (s) { setAccountSession(s); title(); }
      }).catch((e) => console.debug('[accounts] 重新签发游客略过', e?.status || e?.code || e));
    });
  }
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
  hidePauseMini();
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
  hidePauseMini();
  loadLevel(game.level, false);
  game.mode = 'play';
  hud.hidePanel();
  if (!controller.touchEnabled) controller.requestLock();
}

// —— 收起暂停面板后的小悬浮恢复控件 ——
// 只在"玩家主动收起 PAUSED 大窗但游戏仍处于 pause 态"时存在；
// resume / 重试 / 回标题 / 结算等任何离开 pause 的路径都必须移除它。
let pauseMiniEl = null;
function showPauseMini() {
  hidePauseMini();
  const el = document.createElement('button');
  el.id = 'pauseMini';
  el.type = 'button';
  el.textContent = `已暂停 · 点击继续 (${bindText(binds, 'pause')} / Enter)`;
  el.setAttribute('aria-label', '已暂停，点击继续游戏');
  // 用 inline 样式而非 styles.css 新类：public shell 的 CSS 带 ?v= 缓存戳，
  // 本批修复不升戳，inline 样式可确保线上立即生效。
  el.style.cssText = 'position:fixed;top:calc(10px + env(safe-area-inset-top, 0px));left:50%;'
    + 'transform:translateX(-50%);z-index:60;padding:8px 18px;border-radius:999px;'
    + 'border:1px solid rgba(255,255,255,.35);background:rgba(20,30,38,.82);color:#eaf4ff;'
    + 'font-size:14px;letter-spacing:.04em;cursor:pointer;backdrop-filter:blur(4px);'
    + 'box-shadow:0 4px 14px rgba(0,0,0,.35);';
  el.onclick = () => resume();
  document.body.appendChild(el);
  pauseMiniEl = el;
}
function hidePauseMini() {
  if (pauseMiniEl) { pauseMiniEl.remove(); pauseMiniEl = null; }
}

function pause() {
  const silent = !!arguments[0]?.silent;
  if (game.mode !== 'play') return;
  clearPendingAerialParry();
  cancelAttackCharge();
  attackFullFlashT = 0;
  hideAttackHint();
  game.mode = 'pause';
  if (IS_BETA) audio.updateBgmState({ mode: 'pause' });
  hidePauseMini();
  keys.clear();
  touchControls?.releaseAll();
  controller.exitLock();
  if (silent) {
    // 布局编辑只需要暂停模拟，不需要显示会遮住 HUD 卡片的全屏暂停面板。
    hud.hidePanel();
    return;
  }
  const h = schemeHints(binds, { isDev: IS_DEV });
  hud.showPanel(`
    <div class="eyebrow">PAUSED</div>
    <h2>喘口气。</h2>
    <p><span id="pauseMoveHint">${TOUCH_DEVICE ? (IS_BETA ? INTERACT_TEXT.touchHelp : '第一人称左摇杆左右转向、前后移动（可同时）；第三人称按摇杆方向移动 · 右侧拖动视角 · 触屏按钮可攻击、疾行、跳跃、交互与释放技能。') : h.movement}</span>${TOUCH_DEVICE ? '' : ` · ${bindText(binds, 'attack', '左键')} 攻击 · ${bindText(binds, 'parry', '中键')} 迎击 · ${bindText(binds, 'burst')} 爆发 · ${bindText(binds, 'ultimate')} 大招 · ${bindText(binds, 'interact')} ${INTERACT_TEXT.pauseHelp}。`}<br>暂停不会消耗时间。</p>
    <div class="row">
      <button class="primary" id="resumeBtn">继续 · ${bindText(binds, 'pause')} / Enter</button>
      <button class="ghost" id="pRetryBtn">重试本关 · ${bindText(binds, 'retry')}</button>
      <button class="ghost" id="pTitleBtn">返回标题</button>
      <button class="ghost" id="pFeedbackBtn">问题反馈 / 反馈建议</button>
      <button class="ghost" id="pCollapseBtn">收起面板（保持暂停）</button>
    </div>
  `);
  document.getElementById('resumeBtn').onclick = resume;
  // 只收起面板：游戏保持 pause 态（模拟冻结），由小悬浮控件/暂停键/Enter 恢复。
  document.getElementById('pCollapseBtn').onclick = () => {
    if (game.mode !== 'pause') return;
    hud.hidePanel();
    showPauseMini();
  };
  document.getElementById('pRetryBtn').onclick = retryLevel;
  document.getElementById('pTitleBtn').onclick = () => { hud.hidePanel(); title(); };
  document.getElementById('pFeedbackBtn').onclick = () => feedbackUI.open();
}

function resume() {
  game.mode = 'play';
  if (IS_BETA) audio.handleVisibility(false);
  hidePauseMini();
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
// 当前玩家攻击动作类型（供第一/第三人称动作表现使用）：'' | tap | stand | lunge | dodge
let playerAttackAnim = '';
let playerAttackT = 0;
let playerAttackDur = 1;
// 迎击窗口剩余时间（秒）：期间正面接住狐狸 dash 可抵消伤害并反打。
let parryWindowT = 0;
// 空中迎击只请求快速落地；真正的迎击在首次落地时消费。
let pendingAerialParry = false;
function clearPendingAerialParry() { pendingAerialParry = false; }
function tryResolvePendingAerialParry() {
  const state = resolvePendingAerialParry(pendingAerialParry, controller.grounded);
  pendingAerialParry = state.pending;
  if (state.execute && game.mode === 'play') strike('stand', { fromParryGesture: true });
}

function interruptForageForAction() {
  if (!IS_BETA) return;
  forage.index = -1; forage.progress = 0; forage.emergency = false; grazeCycleEaten = 0;
  hud.setForage({ active: false });
}

/** 攻击：扇形范围判定，原版是圆形范围，第一人称下改为朝向前方扇形更合理 */
function strike(move = 'tap', { fromParryGesture = false, aerialPounceDamageMul = null } = {}) {
  const p = game.player;
  // 站立/静止观察不阻塞出招：站立也必须能短按推击，连续短按按冷却节奏稳定触发。
  if (!strikeGateOpen(game)) return false;
  interruptForageForAction(); // 实际出招才打断；按住蓄力不会调用 strike。
  const wheel = PLAYER.combatWheel[move] || PLAYER.combatWheel.tap;
  const s = combatStats(game);
  const running = isSprintingNow();

  // 迎击（按住攻击键左滑）站立/奔跑都可用；奔跑中迎击自动停步、强制起身。
  // 扑击(lunge)由地面按住达到蓄力阈值（650ms）后松手、或蓄满1500ms自动触发，
  // 不再要求奔跑；触发时保留前冲惯性，不停步。空中短按结算为弱化扑击。
  if (move === 'stand' && running) {
    controller.velocity.set(0, controller.velocity.y, 0);
    controller.externalVelocity.multiplyScalar(0.2);
    controller.crouch = Math.min(controller.crouch, 0.08);
  }

  const atkMul = devOn('famineTolerance') ? HERBIVORE.attackCostMul : 1;
  const rawCost = move === 'tap' ? (game.overdrive > 0 ? STRIKE_COST.overdrive : game.boost > 0 ? STRIKE_COST.boost : STRIKE_COST.base) : wheel.cost;
  const cost = rawCost * atkMul;
  if (p.energy < cost) return false;
  p.energy -= cost;
  const profile = resolveStrikeProfile({ move, baseRange: s.range, baseCooldown: s.cooldown, wheel, running });
  game.attackCD = profile.cooldown;
  if (move === 'stand') controller.movementLocked = true;

  // 推击在站/跑姿态下的范围与伤害分档。
  let damagePostureMul = 1, knockbackPostureMul = 1, stunPostureMul = 1;
  if (move === 'tap') {
    const pose = running ? wheel.run : wheel.stand;
    damagePostureMul = pose.damageMul; knockbackPostureMul = pose.knockbackMul; stunPostureMul = pose.stunMul;
  }

  // 记录动作类型与时长，供双视角动作表现。
  playerAttackAnim = move;
  playerAttackDur = Math.max(0.28, wheel.recovery || 0.2) + 0.18;
  playerAttackT = playerAttackDur;

  // 迎击无敌帧窗口只由“按住左滑”的即时迎击开启；推击/扑击都不附带迎击窗口。
  if (move === 'stand' && fromParryGesture) parryWindowT = Math.max(parryWindowT, wheel.parryWindow || 0.3);

  // 攻击朝向：第三人称沿角色身体/移动朝向，第一人称沿视线（保持原有正确行为）。
  let attackYaw = (() => {
    const attackYaw = resolveAttackYaw({
      thirdPerson: controller.thirdPerson, cameraYaw: controller.yaw, bodyYaw: controller.bodyYaw,
    });
    return attackYaw;
  })();
  if (IS_BETA && move === 'lunge') {
    const locked = resolveLungeLockYaw(controller.position.x, controller.position.z, attackYaw, foxes, {});
    if (locked !== null) {
      attackYaw = locked;
      controller.bodyYaw = locked;
      if (!controller.thirdPerson) controller.yaw = locked;
    }
  }
  _fwd.set(-Math.sin(attackYaw), 0, -Math.cos(attackYaw));
  const right = new THREE.Vector3(-_fwd.z, 0, _fwd.x);
  sandboxRecorder?.strike(move, {
    x: Number(controller.position.x.toFixed(2)), z: Number(controller.position.z.toFixed(2)),
    yaw: Number(attackYaw.toFixed(3)), running: !!running,
    boost: game.boost > 0, overdrive: game.overdrive > 0, energy: Number(p.energy.toFixed(1)),
  }, game.totalTime);
  if (move === 'dodge') {
    const dir = rollDirection({ velX: controller.velocity.x, velZ: controller.velocity.z, bodyYaw: controller.bodyYaw });
    controller.roll(dir, 7.2);
    p.invuln = Math.max(p.invuln, wheel.invuln || 0.42);
    return true;
  }
  if (move === 'lunge') controller.externalVelocity.addScaledVector(_fwd, 7.2);
  if (move === 'stand') game.attackMoveLock = wheel.lock || 0.4;
  const originY = terrainHeight(controller.position.x, controller.position.z);
  const color = move === 'stand' ? 0xd6a1ff : move === 'lunge' ? 0xffa36f : game.overdrive > 0 ? 0xe4b1ff : game.boost > 0 ? 0xffd17a : 0xfff1a9;
  const baseRange = profile.range;
  claw.fire(controller.position.x, originY + 0.32, controller.position.z, attackYaw, baseRange, color);
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
    if (!strikeVolumeHit({ forward, lateral, playerBottom, targetBottom: foxBottom, targetHeight: foxHeight, range: baseRange, move })) continue;
    const aerialMul = move === 'lunge' && !controller.grounded ? (aerialPounceDamageMul ?? 1) : 1;
    const dmg = s.damage * (wheel.damageMul || 1) * damagePostureMul * aerialMul;
    const kb = (wheel.knockback || s.knockback) * knockbackPostureMul;
    const stun = (wheel.stun || s.stun) * stunPostureMul;
    hitFox(f, dmg, { ...s, range: baseRange, stun, knockback: kb });
    hits++;
  }
  if (hits && game.overdrive <= 0) game.charge = clamp(game.charge + (move === 'stand' ? 9 : move === 'lunge' ? 8 : 6), 0, 100);
  return true;
}
// 迎击练习：狐狸被击退后立即在玩家正前方重新出现，不逃跑、不计驱退/回能。
function scheduleDrillReset(f) {
  if (!f) return;
  // 坐标/朝向必须在 setTimeout 之前捕获（旧实现回调里引用了不存在的变量 p，350ms 后必崩）。
  const pose = drillRespawnPose({
    px: controller.position.x, pz: controller.position.z, yaw: controller.bodyYaw,
  });
  setTimeout(() => {
    if (!sandboxState.parryDrill) return;
    f.respawnAt(pose.x, pose.z);
    // 复位血量、状态与击退残留动量，否则复位瞬间会滑行偏移。
    resetDrillFox(f);
    f.drillCtx = { px: controller.position.x, pz: controller.position.z, yaw: controller.bodyYaw };
  }, 350);
}

function hitFox(f, damage, s) {
  if (f.hp <= 0) return;
  const fy = terrainHeight(f.x, f.z);
  const hpBefore = f.hp;
  f.hit(damage, s.knockback, s.stun, controller.position.x, controller.position.z);
  const recFoxHit = (outcome) => sandboxRecorder?.foxHit({
    fox: sandboxRecorder.idFor(f), foxType: f.type, damage: Number(damage.toFixed(2)),
    hpBefore: Number(hpBefore.toFixed(2)), hpAfter: Number(f.hp.toFixed(2)),
    fx: Number(f.x.toFixed(2)), fz: Number(f.z.toFixed(2)), move: s.move || null, outcome,
  }, game.totalTime);

  damageText.spawn(f.x, fy + 1.1, f.z,
    Number.isInteger(damage) ? `-${damage}` : `-${damage.toFixed(1)}`, '#ffedb7');
  particles.burst(f.x, fy + 0.5, f.z, colHit, 9, 1);

  // 旧口径（d088054 之前，按用户要求恢复）：普通狐打不死 —— hp 归零不是真死，
  // 而是夹尾逃跑离场（可见过程），过段时间在出生点附近增援回来；首领被打退则一去不返
  // （fox.update 里的 defeatFate 决定不重生）。自主撤退 rest_safe 的驱退计数仍走 onRepelled。
  if (f.hp <= 0 && !f.isSandboxDummy) {
    // 迎击练习：不计数、不逃跑，立刻复位到玩家正前方重来。
    if (sandboxState.parryDrill) {
      recFoxHit('drill-reset');
      audio.hit();
      controller.hitShake(0.2);
      scheduleDrillReset(f);
      return;
    }
    const levelCfg = LEVELS[game.level];
    game.levelRepels = (game.levelRepels || 0) + 1;
    game.totalRepels = (game.totalRepels || 0) + 1;
    f.startFleeing(controller.position.x, controller.position.z, levelCfg);
    recFoxHit(f.type === 'boss' ? 'gone' : 'repelled');
    if (game.overdrive <= 0) game.charge = clamp(game.charge + 18, 0, 100);
    game.player.energy = clamp(game.player.energy + 8, 0, 100);
    damageText.spawn(f.x, fy + 1.6, f.z, f.type === 'boss' ? '首领逃走了，一去不返' : '威胁已解除', '#ceebbc');
    particles.burst(f.x, fy + 0.5, f.z, colRepel, 18, 1.4);
    audio.repel();
    controller.hitShake(0.3);
    recordTestLog(f.type === 'boss' ? 'fox-boss-gone' : 'fox-repelled',
      { foxType: f.type, levelRepels: game.levelRepels, totalRepels: game.totalRepels });
  } else {
    recFoxHit('hit');
    audio.hit();
    controller.hitShake(0.18);
  }
}

/**
 * 驱退计数回调（方式 A）：狐狸进入 rest_safe 时由 Fox 调用。
 * "去休息 = 被驱退"：威胁已解除，在这里统一计数与反馈。
 */
function wireRepelCallback(f) {
  f.onRepelled = (fox) => {
    game.levelRepels = (game.levelRepels || 0) + 1;
    game.totalRepels = (game.totalRepels || 0) + 1;
    if (game.overdrive <= 0) game.charge = clamp(game.charge + 18, 0, 100);
    game.player.energy = clamp(game.player.energy + 8, 0, 100);
    const fy = terrainHeight(fox.x, fox.z);
    damageText.spawn(fox.x, fy + 1.6, fox.z, '威胁已解除', '#ceebbc');
    particles.burst(fox.x, fy + 0.5, fox.z, colRepel, 18, 1.4);
    audio.repel();
    recordTestLog('fox-repelled', { foxType: fox.type, levelRepels: game.levelRepels, totalRepels: game.totalRepels });
  };
  return f;
}

function doBurst() {
  const ok = burst(game, (t, d) => hud.say(t, d));
  if (ok) {
    sandboxRecorder?.burst(game.totalTime);
    audio.burst();
    const y = terrainHeight(controller.position.x, controller.position.z);
    particles.burst(controller.position.x, y + 0.4, controller.position.z, colBoost, 26, 1.4);
    damageText.spawn(controller.position.x, y + 1.4, controller.position.z, '伤害 +2 · 加速', '#ffde7e');
    hud.say(`${bindText(binds, 'burst')} 应急爆发：攻击 +2、范围增加、攻速更快！持续 4 秒。`, 3.3);
  }
}

function doUltimate() {
  if (game.inBurrow) { hud.say(`洞穴内不能攻击，出洞后再使用 ${bindText(binds, 'ultimate')}。`, 1.7); return; }
  const ok = ultimate(game, (t, d) => hud.say(t, d));
  if (!ok) return;

  sandboxRecorder?.ultimate(game.totalTime);
  audio.ultimate();
  const x = controller.position.x, z = controller.position.z;
  shockwave.fire(x, z, ULT.radius);
  particles.burst(x, terrainHeight(x, z) + 0.5, z, colUlt, 55, 2);
  damageText.spawn(x, terrainHeight(x, z) + 1.5, z, '协同大招', '#f1c3ff');
  hud.say(`${bindText(binds, 'ultimate')} 协同爆发！范围冲击 + 5 秒强化，结束后会疲劳。`, 4.5);
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
  interruptForageForAction();
  sandboxRecorder?.jump({ air: Number(controller.airHeight.toFixed(2)) }, game.totalTime);
  audio.jump();
  const y = controller.position.y;
  particles.burst(controller.position.x, y + 0.05, controller.position.z,
    new THREE.Color(0xbfae8e), 6, 0.7);
}

// 屏幕平面向量（右+、上+）按相机朝向换算为世界水平单位向量。
function screenToWorldDir(rightAmt, upAmt) {
  const yaw = controller.yaw;
  const fx = -Math.sin(yaw), fz = -Math.cos(yaw);   // 相机前方
  const rx = Math.cos(yaw), rz = -Math.sin(yaw);     // 相机右方
  let wx = rx * rightAmt + fx * upAmt;
  let wz = rz * rightAmt + fz * upAmt;
  const l = Math.hypot(wx, wz) || 1;
  return { x: wx / l, z: wz / l };
}

// 翻滚方向：优先拖动定向，其次摇杆推动方向，最后身体朝向。
function rollDirFromGesture(gesture) {
  // 1) 独立翻滚键被拖动：按拖动方向（屏幕右+、上拖为负 dy）。
  if (gesture && gesture.moved && (Math.abs(gesture.dx) > 0 || Math.abs(gesture.dy) > 0)) {
    return screenToWorldDir(gesture.dx, -gesture.dy);
  }
  // 2) 移动摇杆正在推动：按轮盘方向（即便角色刚起步、速度还没起来也成立）。
  const ax = controller.touchAxes || { x: 0, y: 0 };
  if (Math.hypot(ax.x, ax.y) > 0.18) {
    return screenToWorldDir(ax.x, ax.y);
  }
  // 3) 回退：实际移动速度方向；静止则身体朝向（yaw=0 朝 -Z）。
  return rollDirection({
    velX: controller.velocity.x, velZ: controller.velocity.z, bodyYaw: controller.bodyYaw,
  });
}

// 翻滚：朝当前移动方向（否则身体朝向）滚动，整段无敌。
function doRoll(gesture = null) {
  const p = game.player;
  const wheel = PLAYER.combatWheel.dodge;
  if (game.attackCD > 0 || game.inBurrow || (controller.rollT || 0) > 0.02) return false;
  const atkMul = devOn('famineTolerance') ? HERBIVORE.attackCostMul : 1;
  if (p.energy < wheel.cost * atkMul) { hud.say(`${IS_BETA ? '体力' : '储备'}不足，无法翻滚`, 1.2); return false; }
  p.energy -= wheel.cost * atkMul;
  const dir = rollDirFromGesture(gesture);
  // 默认 distance=2.2 / invuln=0.42 时精确保持旧 7.2；调试面板改值会同步改变冲量。
  const rollSpeed = 7.2 * (wheel.distance / 2.2) * (0.42 / Math.max(0.05, wheel.invuln));
  controller.roll(dir, rollSpeed);
  p.invuln = Math.max(p.invuln, wheel.invuln);
  game.attackCD = wheel.recovery || 0.12;
  audio.swing();
  const y = terrainHeight(controller.position.x, controller.position.z);
  particles.burst(controller.position.x, y + 0.12, controller.position.z, new THREE.Color(0xcbb79a), 10, 0.9);
  damageText.spawn(controller.position.x, y + 1.0, controller.position.z, '翻滚', '#d8e6c8');
  playerAttackAnim = 'dodge';
  playerAttackDur = wheel.invuln;
  playerAttackT = wheel.invuln;
  sandboxRecorder?.dodge({ dir: { x: Number(dir.x.toFixed(2)), z: Number(dir.z.toFixed(2)) } }, game.totalTime);
  return true;
}

function doInteract() {
  // Beta reserves this input for held grazing/foraging. Proximity rescue below
  // remains intact, but pressing the key must never emit companion feedback.
  if (IS_BETA) return;
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
  if (IS_BETA) scenery.growGrass(dt);
  const p = game.player;
  game.elapsed += dt;
  game.totalTime += dt;
  if (!game.sandbox && (!TEST_MODE || !testState.freezeTimer)) game.time = Math.max(0, game.time - dt);

  const stats = combatStats(game);
  stats_cache = stats;

  // 环境修饰（雾 / 阵风 / 沙尘）每帧推进。先用当前位置按同一 burrowVolumeAt 语义
  // 预判洞内状态，避免进入洞穴的这一帧仍吃到横风。
  const weatherInBurrow = game.inBurrow || !!burrowVolumeAt(
    controller.position.x, controller.position.y, controller.position.z, burrowDefs,
  );
  updateEnvNotice(updateEnv(dt, weatherInBurrow));

  // 计时器
  const prevOverdrive = game.overdrive;
  for (const k of ['boost', 'boostCD', 'attackCD', 'social', 'socialCD',
    'overdrive', 'overCD', 'fatigue']) {
    game[k] = Math.max(0, game[k] - dt);
  }
  p.invuln = Math.max(0, p.invuln - dt);
  game.recentlyHit = Math.max(0, game.recentlyHit - dt);
  game.attackMoveLock = Math.max(0, game.attackMoveLock - dt);
  controller.movementLocked = game.attackMoveLock > 0;
  // 蓄力 0→100% 实时推进；满 1500ms 自动以扑击结算。
  if (attackCharge.held && !attackCharge.fired) {
    const charge = advanceAttackCharge(attackCharge.t * 1000, dt * 1000);
    attackCharge.t = charge.holdMs / 1000;
    setAttackHint(attackCharge.t);
    if (charge.autoRelease) releaseAttack({ auto: true });
  } else if (attackFullFlashT > 0) {
    attackFullFlashT = Math.max(0, attackFullFlashT - dt);
    if (attackFullFlashT === 0) hideAttackHint();
  }
  if (controller.rollT > 0) controller.rollT = Math.max(0, controller.rollT - dt);
  if (parryWindowT > 0) parryWindowT = Math.max(0, parryWindowT - dt);
  if (playerAttackT > 0) {
    playerAttackT = Math.max(0, playerAttackT - dt);
    if (playerAttackT === 0) { playerAttackAnim = ''; playerAttackDur = 1; }
  }
  if (prevOverdrive > 0 && game.overdrive === 0) {
    game.fatigue = 5;
    hud.say('大招结束：5 秒疲劳，先拉开距离或回洞休息。', 3);
  }

  // 移动（含疾行）
  let speedMul = stats.speedMul;
  if (IS_BETA) speedMul *= BETA_TUNE.moveSpeedMul;
  if (IS_BETA) speedMul *= 1 + (BETA_TUNE.grazeMoveSpeedMul - 1) * grazeProne;
  // 疾行：按方案查表，并额外接受任意一侧 Shift（双手都能用）
  const sprinting = controller.touchSprint || binds.isAction('ShiftLeft', 'sprint')
    || binds.isAction('ShiftRight', 'sprint')
    || keys.has('ShiftLeft') || keys.has('ShiftRight');
  if (sprinting && p.energy > 5) speedMul *= 1.42;
  // 阵风走 controller.externalVelocity.x；洞内先清掉上一帧残留的横向风速，
  // 避免只把本帧 gust 设为 0 却让风继续把玩家拖行。
  if (weatherInBurrow) controller.externalVelocity.x = 0;
  controller.forcedProne = IS_BETA ? grazeProne : 0;
  controller.grazeEyeExtra = IS_BETA ? BETA_TUNE.grazeEyeDropExtra * grazeProne : 0;
  controller.grazeThirdDrop = IS_BETA ? BETA_TUNE.thirdPersonGrazeDrop * grazeProne : 0;
  controller.update(
    dt,
    keys,
    game.attackMoveLock > 0 ? 0 : speedMul,
    binds.moveMap,
    weatherInBurrow ? 0 : env.gust * env.gustDir,
    binds.turnMap,
  );

  tryResolvePendingAerialParry();

  const moving = controller.movingThisFrame;

  p.x = controller.position.x;
  p.z = controller.position.z;
  p.speed = Math.hypot(controller.velocity?.x || 0, controller.velocity?.z || 0);

  // 洞穴判定
  game.currentBurrow = burrowVolumeAt(p.x, controller.position.y, p.z, burrowDefs);
  game.inBurrow = !!game.currentBurrow;
  game.inBaseBurrow = game.currentBurrow?.type === 'base';
  // 移动可能在本帧跨过洞口；立刻切换天气可见性/听感，避免沙尘雾留在洞内，
  // 同时保留普通关卡雾和洞内照明的独立语义。
  if (game.inBurrow !== weatherInBurrow) updateEnvNotice(updateEnv(0, game.inBurrow));
  // 进洞平滑压暗全局光：避免一闪而过，露出 burrow 自带暖光与黑井。
  game._undergroundK = THREE.MathUtils.lerp(game._undergroundK || 0, game.inBurrow ? 1 : 0, Math.min(1, dt * 5));
  sky.setUnderground(game._undergroundK);
  game.observing = shouldObserveMinimap({
    beta: IS_BETA,
    moving,
    inBurrow: game.inBurrow,
    crouch: controller.crouch,
    postureSpeed: controller.postureSpeed,
  });

  // 移动消耗储备
  // dev 版「耐饥渴」：同一动作消耗更低（旱獭能长时间不进食活动）
  const costMul = devOn('famineTolerance') ? HERBIVORE.moveCostMul : 1;
  if (moving) {
    const sprintCost = IS_BETA ? BETA_TUNE.sprintMoveCost : 3.4;
    const moveCost = game.overdrive > 0 ? 4 : game.boost > 0 ? 4.8 : sprinting ? sprintCost : (IS_BETA ? BETA_TUNE.runMoveCost : 1.6);
    p.energy -= dt * moveCost * costMul;
    p.energy = Math.max(0, p.energy);
  }
  // beta 仅咀嚼口腔草料；stable/dev 保留原静止回储备路径。
  const regenMul = devOn('famineTolerance') ? HERBIVORE.regenMul : 1;
  const burrowRegenMul = devOn('famineTolerance') ? HERBIVORE.burrowRegenMul : 1;
  if (IS_BETA) {
    syncMetabolism(p, chewMouth(p, dt, {
      running: moving && sprinting, grazing: forage.index === -2 && interactHeld,
      burrowType: game.currentBurrow?.type || null,
    }));
    if (game.flowerRecovery) {
      const recovery = stepFlowerRecovery(game.flowerRecovery, dt);
      p.hp = clamp(p.hp + recovery.hp, 0, PLAYER.maxHp);
      syncMetabolism(p, applyNutrition(p, recovery.nutrition));
      game.flowerRecovery = recovery.recovery;
    }
  } else if (!moving) {
    p.energy = clamp(
      p.energy + (game.inBurrow ? (game.currentBurrow.regenMul || 0) * 14 * burrowRegenMul : 2.5 * regenMul) * dt, 0, 100,
    );
  }

  // —— AI 与威胁 ——
  // 为智能藏狐补充玩家感知信号（game.player 本身只存坐标/数值）。
  p.facingYaw = controller.bodyYaw;
  p.running = isSprintingNow();
  p.guard = parryWindowT > 0;
  if (sandboxRecorder) {
    sandboxRecorder.samplePose(dt, game.totalTime, {
      x: controller.position.x, z: controller.position.z, yaw: controller.bodyYaw,
      speed: p.speed || Math.hypot(controller.velocity.x, controller.velocity.z),
      running: p.running, guard: p.guard, inBurrow: game.inBurrow,
      hp: Number(p.hp.toFixed(1)), energy: Number(p.energy.toFixed(1)),
    });
    sandboxRecorder.sampleFoxStates(game.totalTime, foxes);
  }
  let threats = 0;
  let anyWinding = false;
  const smartFoxes = foxes.filter((candidate) => candidate.type === 'smart');
  // 阶段 3：本帧智能狐群体的共享战术存储（角色分派粘性表 roles 等）
  const smartTactics = { roles: null };
  for (const f of foxes) {
    const prevState = f.state;
    if (sandboxState.parryDrill) {
      f.drillCtx = { px: p.x, pz: p.z, yaw: controller.bodyYaw };
    } else if (f.drillCtx) {
      delete f.drillCtx;
    }
    f.update(dt, p, game.inBurrow, cfg, burrowDefs, terrainHeight, game.currentBurrow,
      f.type === 'smart' ? { smartFoxes, coordinator: sandboxState.active ? sandboxState.smartPack : null, tactics: smartTactics } : null);
    if (f.alive && Math.hypot(f.x - p.x, f.z - p.z) < 22 && !game.inBurrow) threats++;
    if (f.alive && f.state === 'wind') {
      anyWinding = true;
      if (!game.inBurrow && prevState !== 'wind') audio.foxWind();
    }
    if (f.alive && !game.inBurrow && prevState === 'wind' && f.state === 'dash') audio.foxDash();

    // 接触伤害
    // 智能藏狐在 approach/feint 阶段也会高速贴身，但只有不可取消的扑击(pounce)
    // 才应造成伤害，故对 type==='smart' 额外要求 pounceCommitted。
    // 阶段 4：智能狐只有"扑咬 strike 激活帧"才结算接触伤害（冲刺逼近/前摇/后摇不造成伤害）。
    const smartCanHit = f.type !== 'smart' || (f.pounceCommitted && f.pounceStriking);
    if (f.alive && !game.inBurrow && p.invuln <= 0 && (f.contactCd ?? 0) <= 0 && smartCanHit) {
      const d = Math.hypot(f.x - p.x, f.z - p.z);
      const reachBase = PLAYER.radius + (FOX.collisionRadius[f.type] ?? FOX.collisionRadius.normal);
      const reach = f.type === 'smart' && IS_BETA
        ? Math.min(reachBase, BETA_TUNE.smartPounceHitRadius)
        : reachBase;
      // 水平接触仍受原半径限制；高度则比较双方碰撞区间，
      // 避免地面玩家被从头顶跃过的狐狸击中。
      const foxBottom = terrainHeight(f.x, f.z) + f.leap;
      const foxHitHeight = FOX.collisionHeight[f.type] ?? FOX.collisionHeight.normal;
      const playerBottom = terrainHeight(p.x, p.z) + controller.airHeight;
      const playerHitHeight = PLAYER.collisionHeight;
      const verticalOverlap = foxAttackVerticalHit({
        playerBottom, playerHeight: playerHitHeight, foxBottom, foxHeight: foxHitHeight,
        groundAttackHeight: FOX.groundAttackHeight, dodgeHeight: PLAYER.jump.dodgeHeight, mode: f.attack?.mode, state: f.state,
      });
      if (d < reach && verticalOverlap) {
        // 迎击判定（振刀式）：迎击窗口未过期 + 狐狸正在 dash 攻击窗口内 +
        // 接触距离内 + 狐狸从玩家攻击朝向正面（约 ±80°）冲来 → 抵消本次接触并反打。
        // 狐狸空闲/巡逻/蓄力(wind)/喘息(rest)、玩家输入过早或过晚，都不算迎击。
        const parryCfg = PLAYER.combatWheel.stand;
        const toFoxX = (f.x - p.x) / (d || 1), toFoxZ = (f.z - p.z) / (d || 1);
        const parryYaw = resolveAttackYaw({
          thirdPerson: controller.thirdPerson, cameraYaw: controller.yaw, bodyYaw: controller.bodyYaw,
        });
        const facingDot = toFoxX * (-Math.sin(parryYaw)) + toFoxZ * (-Math.cos(parryYaw));
        const parryOK = resolveParryOutcome({
          parryWindowT, foxState: f.state, dist: d, reach, facingDot,
          parryHalfAngle: parryCfg.parryHalfAngle,
        }).success;
        if (parryOK) {
          parryWindowT = 0;
          p.invuln = Math.max(p.invuln, 0.35);
          // 把冲来的狐狸当场定住、反方向击退并眩晕（不消耗击杀计数/回能奖励）。
          // hit() 的击退方向 = 狐狸位置 - from，故 from 传玩家位置，才能把狐狸朝远离玩家顶开。
          f.hit(0, (parryCfg.knockback || 2.8) + 1.2, parryCfg.stun || 1.2, p.x, p.z);
          const fy0 = terrainHeight(p.x, p.z);
          damageText.spawn(p.x, fy0 + 1.5, p.z, '迎击！', '#e7c4ff');
          if (game.sandbox) hud.say('迎击成功：正面顶住了狐狸的冲刺！', 1.6);
          particles.burst(p.x + toFoxX * 1.2, fy0 + 0.6, p.z + toFoxZ * 1.2, 0xd6a1ff, 18, 1.3);
          audio.parry ? audio.parry() : audio.hit();
          controller.hitShake(0.35, toFoxX * 2.2, toFoxZ * 2.2);
          if (game.overdrive <= 0) game.charge = clamp(game.charge + 10, 0, 100);
          game.parryCount = (game.parryCount || 0) + 1;
          if (sandboxState.parryDrill) scheduleDrillReset(f);
          continue;
        }
        // 注意括号：`??` 优先级低于 `+`，必须先按类型取基础伤害再叠加关卡加成，
        // 否则 `+ game.level` 只会并进 default 分支、而该分支永远不会被用到。
        const damage = Math.round(((FOX.damage[f.type] ?? FOX.damage.default) + game.level)
          * hpDamageMultiplier(f.hp / f.maxHp, FOX.vitals) * 10) / 10;
        const hpBefore = p.hp;
        interruptHeldAttackCharge();
        clearPendingAerialParry();
        p.hp = testState.godMode ? Math.max(1, p.hp) : Math.max(0, p.hp - damage);
        recordTestLog('player-hit', { foxType: f.type, damage, hpBefore, hpAfter: p.hp,
          preventedByGodMode: testState.godMode });
        sandboxRecorder?.playerHit({
          fox: sandboxRecorder.idFor(f), foxType: f.type, damage: Number(damage),
          hpBefore: Number(hpBefore.toFixed(1)), hpAfter: Number(p.hp.toFixed(1)),
          preventedByGodMode: !!testState.godMode,
        }, game.totalTime);
        // 同一只狐一次扑击只咬一口；全局无敌仅保留极短一帧，避免多狐同时扑时伤害被整段吞掉。
        f.contactCd = FOX.bite.contactCooldown;
        p.invuln = Math.max(p.invuln, FOX.bite.playerInvuln);
        game.recentlyHit = 1.2;
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

  // —— 阶段 4：玩家察觉机制（可发现性）——
  // 狐狸当前动作决定被察觉半径：慢行难发现、冲刺易发现、扑咬最易发现
  // （半径与 play-as-fox 的 detectStalk/detectSprint/detectLunge 对齐，见 FOX.detection）。
  // 一旦察觉即锁定（f.detected）：HUD 提示一次 + 该狐的血条/体力条开始显示；
  // 智能狐侧会把 detected 计入 suspicion，被发现的狐狸打得更谨慎。
  {
    const DET = FOX.detection;
    const camYaw = controller.yaw ?? controller.bodyYaw ?? 0;
    const cosHalf = Math.cos((DET.viewConeDeg / 2) * Math.PI / 180);
    for (const f of foxes) {
      if (!f.alive || f.detected || game.inBurrow) continue;
      const dx = f.x - p.x, dz = f.z - p.z;
      const d = Math.hypot(dx, dz);
      if (d > DET.viewRange) continue;
      // 相机前向 = (-sin(yaw), -cos(yaw))（与 resolveAttackYaw 同约定）
      const inv = 1 / (d || 1);
      const viewDot = (-Math.sin(camYaw)) * dx * inv + (-Math.cos(camYaw)) * dz * inv;
      if (viewDot < cosHalf) continue;
      const radius = (f.pounceCommitted || f.state === 'wind') ? DET.pounce
        : (f.state === 'dash' || f.intent === 'approach' || f.intent === 'feint') ? DET.sprint
        : DET.stalk;
      if (d < radius) {
        f.detected = true;
        hud.say('你发现了一只藏狐！', 2.2);
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

  // —— 持续采食 ——
  let grazeTarget = 0;
  if (!IS_BETA) {
    const holdToEat = IS_BETA;
    let nearest = -1, nearestDist = Infinity;
    berries.forEach((b, i) => {
      if (b.taken) return;
      const d = Math.hypot(b.x - p.x, b.z - p.z);
      if (d < BERRY_RADIUS + 0.35 && d < nearestDist) { nearest = i; nearestDist = d; }
    });
    if (nearest < 0) {
      forage.index = -1; forage.progress = 0; forage.emergency = false;
      hud.setForage({ active: false });
    } else {
      const b = berries[nearest];
      if (forage.index !== nearest) forage.progress = 0;
      forage.index = nearest;
      if (holdToEat && !interactHeld) {
        forage.progress = 0;
        forage.emergency = false;
        hud.setForage({ active: false });
      } else {
        forage.emergency = isForagingEmergency({
          inBurrow: game.inBurrow, sprinting, recentlyHit: game.recentlyHit > 0,
          foxes: foxes.map((f) => ({ x: f.x - p.x, z: f.z - p.z, alive: f.alive, type: f.type, pounceCommitted: f.pounceCommitted, state: f.state })),
        });
        if (betaFlowerCompletesImmediately(b.kind)) forage.progress = 1;
        else forage.progress = stepForageProgress(forage.progress, dt, {
          inRange: true, emergency: forage.emergency, kind: b.kind,
          // beta 缩短吃草耗时；非 beta 不传 seconds，逐字沿用 FORAGE.grassSeconds=1.4。
          seconds: IS_BETA && b.kind === 'grass' ? BETA_TUNE.grassSeconds : null,
        });
        hud.setForage({ active: true, kind: b.kind, progress: forage.progress, emergency: forage.emergency });
        if (holdToEat && interactHeld && b.kind === 'grass') grazeTarget = 1;
      }
      if (!(holdToEat && !interactHeld) && forage.progress >= 1) {
        b.take(); scenery.setBerryTaken(nearest); game.foodCount++;
        const gain = b.kind === 'flower' ? energyOfFlower() : b.kind === 'grass' ? energyOfPlant(b.plant) : BERRY_ENERGY;
        p.energy = clamp(p.energy + gain, 0, 100);
        if (game.overdrive <= 0) game.charge = clamp(game.charge + (b.kind === 'flower' ? BERRY_CHARGE * 1.5 : BERRY_CHARGE), 0, 100);
        const by = terrainHeight(b.x, b.z);
        const c = b.kind === 'flower' ? 0xf2c45c : b.herbivore ? colHerb : colBerry;
        particles.burst(b.x, by + 0.6, b.z, c, 12, 1);
        damageText.spawn(b.x, by + 1.1, b.z, b.kind === 'flower' ? `采花 +${gain} 储备` : b.herbivore ? eatLine(b.plant) : `+${gain} 储备`, b.kind === 'flower' ? '#ffe49b' : b.herbivore ? '#dff0c4' : '#ffd9e2');
        audio.berry();
        forage.index = -1; forage.progress = 0; forage.emergency = false;
        hud.setForage({ active: false });
      }
    }
  } else {
    const holdToEat = IS_BETA;
    let nearest = -1, nearestDist = Infinity;
    berries.forEach((b, i) => {
      if (b.taken) return;
      const d = Math.hypot(b.x - p.x, b.z - p.z);
      if (d < BERRY_RADIUS + 0.35 && d < nearestDist) { nearest = i; nearestDist = d; }
    });
    // 17:15 correction: burrows recover exclusively by chewing; no foraging inside either kind.
    const nearestFood = !game.inBurrow && nearest >= 0 ? berries[nearest] : null;
    const grassInRange = IS_BETA && !game.inBurrow && !nearestFood
      && scenery.hasGrazeable(p.x, p.z, BETA_TUNE.grazeHaloRadius, controller.bodyYaw);
    if (!nearestFood && !grassInRange) {
      forage.index = -1; forage.progress = 0; forage.emergency = false; grazeCycleEaten = 0;
      hud.setForage({ active: false });
    } else if (grassInRange) {
      if (forage.index !== -2) { forage.progress = 0; grazeCycleEaten = 0; }
      forage.index = -2;
      if (holdToEat && !interactHeld) {
        forage.progress = 0; forage.emergency = false; grazeCycleEaten = 0;
        hud.setForage({ active: false });
      } else {
        forage.emergency = isForagingEmergency({
          inBurrow: game.inBurrow, sprinting, recentlyHit: game.recentlyHit > 0,
          foxes: foxes.map((f) => ({ x: f.x - p.x, z: f.z - p.z, alive: f.alive, type: f.type, pounceCommitted: f.pounceCommitted, state: f.state })),
        });
        forage.progress = stepForageProgress(forage.progress, dt, { inRange: true, emergency: forage.emergency, kind: 'grass', seconds: BETA_TUNE.grassSeconds });
        // 渐进啃环境草：grazeAt 按 dt 连续扣减圈内草的 growth；
        // bite.density = 本帧实际吃到量 / 满圈产能（按距离加权的连续密度）。
        // 草料只按前方锥内真实吃量折算（少量立即转化，其余入口腔）；
        // 一轮动作收尾时不再另发能量，避免重复计算。
        const bite = scenery.grazeAt(p.x, p.z, dt, controller.bodyYaw);
        if (bite.eaten > 0) {
          const intake = BETA_TUNE.grazeRegenPerSec * bite.density * dt;
          syncMetabolism(p, ingestGraze(p, intake));
          grazeCycleEaten += intake;
        }
        hud.setForage({ active: true, kind: 'grass', progress: forage.progress, emergency: forage.emergency });
        if (interactHeld) grazeTarget = 1;
      }
      if (interactHeld && forage.progress >= 1) {
        // 一轮啃食动作收尾：能量已在按住期间逐帧结算，这里只做计数与不指名物种的飘字反馈。
        game.foodCount++;
        const gain = Math.round(grazeCycleEaten);
        const by = terrainHeight(p.x, p.z);
        particles.burst(p.x, by + 0.6, p.z, colHerb, 12, 1);
        if (gain > 0) damageText.spawn(p.x, by + 1.1, p.z, `啃草 +${gain} 草料 · 站立咀嚼`, '#dff0c4');
        audio.berry();
        forage.index = -1; forage.progress = 0; forage.emergency = false; grazeCycleEaten = 0;
        hud.setForage({ active: false });
      }
    } else {
      const b = nearestFood;
      if (forage.index !== nearest) forage.progress = 0;
      forage.index = nearest;
      if (holdToEat && !interactHeld) {
        forage.progress = 0; forage.emergency = false;
        hud.setForage({ active: false });
      } else {
        forage.emergency = isForagingEmergency({
          inBurrow: game.inBurrow, sprinting, recentlyHit: game.recentlyHit > 0,
          foxes: foxes.map((f) => ({ x: f.x - p.x, z: f.z - p.z, alive: f.alive, type: f.type, pounceCommitted: f.pounceCommitted, state: f.state })),
        });
        if (betaFlowerCompletesImmediately(b.kind)) forage.progress = 1;
        else forage.progress = stepForageProgress(forage.progress, dt, { inRange: true, emergency: forage.emergency, kind: b.kind });
        hud.setForage({ active: true, kind: b.kind, progress: forage.progress, emergency: forage.emergency });
      }
      if (!(holdToEat && !interactHeld) && forage.progress >= 1) {
        b.take(); scenery.setBerryTaken(b.index); game.foodCount++;
        const gain = b.kind === 'flower' ? energyOfFlower() : b.kind === 'grass' ? energyOfPlant(b.plant) : BERRY_ENERGY;
        if (b.kind === 'flower') game.flowerRecovery = createFlowerRecovery();
        if (game.overdrive <= 0) game.charge = clamp(game.charge + (b.kind === 'flower' ? BERRY_CHARGE * 1.5 : BERRY_CHARGE), 0, 100);
        const by = terrainHeight(b.x, b.z);
        const c = b.kind === 'flower' ? 0xf2c45c : b.herbivore ? colHerb : colBerry;
        particles.burst(b.x, by + 0.6, b.z, c, 12, 1);
        damageText.spawn(b.x, by + 1.1, b.z, b.kind === 'flower' ? `采花 · ${BETA_TUNE.flowerRecoverySeconds}s 渐缓回复` : b.herbivore ? eatLine(b.plant) : `+${gain} 储备`, b.kind === 'flower' ? '#ffe49b' : b.herbivore ? '#dff0c4' : '#ffd9e2');
        audio.berry();
        forage.index = -1; forage.progress = 0; forage.emergency = false;
        hud.setForage({ active: false });
      }
    }
  }
  grazeProne += (grazeTarget - grazeProne) * (1 - Math.exp(-12 * dt));

  // —— 伙伴跟随与到家 ——
  if (IS_BETA && !game.friend.rescued && !game.friend.saved
    && Math.hypot(companion.x - p.x, companion.z - p.z) < RESCUE_DIST) {
    game.friend.rescued = true;
    companion.rescued = true;
    companion.showEmote('check');
    audio.rescue();
    hud.say('伙伴跟上了！带它回左侧洞穴。');
  }
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
  const alarm = companionAlarmLevel({
    rescued: game.friend.rescued, saved: game.friend.saved, inBurrow: game.inBurrow,
    companion: { x: companion.x, z: companion.z, playerX: controller.position.x, playerZ: controller.position.z },
    foxes: foxes.map((f) => ({ x: f.x, z: f.z, alive: f.alive, type: f.type, pounceCommitted: f.pounceCommitted, state: f.state })),
  });
  const alarmTick = alarmSchedule(alarm.level, game.companionAlarmTimer, dt, ALARM_INTERVALS);
  game.companionAlarmTimer = alarmTick.timer;
  if (alarmTick.play && alarm.fox) audio.companionAlarm(alarm.level,
    stereoPanFromWorld(controller.yaw, alarm.fox.x, alarm.fox.z, controller.position.x, controller.position.z));

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
  game.gatherAvailable = IS_BETA && !game.inBurrow && berries.some((b) => !b.taken && b.kind === 'flower'
    && Math.hypot(b.x - p.x, b.z - p.z) < BERRY_RADIUS + 0.35);
  const touchInteract = document.querySelector('[data-touch-action="interact"]');
  if (IS_BETA && touchInteract) {
    touchInteract.classList.toggle('is-gather', game.gatherAvailable);
    const label = touchInteract.querySelector('small');
    if (label) label.textContent = game.gatherAvailable ? '采集' : INTERACT_TEXT.touchLabel;
    touchInteract.setAttribute('aria-label', game.gatherAvailable ? '采集花朵' : INTERACT_TEXT.touchAria);
  }
  if (IS_BETA) {
    if (game.gatherAvailable) prompt = kbd(bindText(binds, 'interact')) + ' 采集';
    else if (forage.index === -2) prompt = kbd(bindText(binds, 'interact')) + ` ${INTERACT_TEXT.grassPrompt}`;
    else if (forage.index >= 0) prompt = kbd(bindText(binds, 'interact')) + ` ${INTERACT_TEXT.flowerPrompt}`;

  } else if (game.friend.saved && game.inBaseBurrow && game.socialCD <= 0) {
    prompt = kbd(bindText(binds, 'interact')) + ' 陪伴缓压';
  } else if (!game.friend.rescued && !game.friend.saved
    && !IS_BETA
    && Math.hypot(companion.x - p.x, companion.z - p.z) < RESCUE_DIST) {
    prompt = kbd(bindText(binds, 'interact')) + ' 救援伙伴';
  }
  hud.setInteractPrompt(prompt);

  // —— 视觉更新 ——
  playerBody.rotation.x = -controller.crouch * 0.28;
  playerBody.position.y = controller.crouch * -0.12 + (controller.grounded ? 0 : 0.08);
  playerBody.scale.set(1, 1 - controller.crouch * 0.12, 1 + controller.crouch * 0.18);
  // 第三人称攻击/翻滚动作（前肢 + 身体姿态）。
  const arms = playerBody.userData.frontArms;
  const atkK = playerAttackT > 0 ? Math.sin(Math.min(1, 1 - playerAttackT / 0.46) * Math.PI) : 0;
  if (arms) {
    const L = arms.left, R = arms.right;
    L.rotation.x = 0; R.rotation.x = 0; L.rotation.z = 0; R.rotation.z = 0;
    if (playerAttackAnim === 'lunge') {
      // 扑击：前肢大前伸（绕本地 X 向前抬）+ 身体下压
      L.rotation.x = -1.2 * atkK; R.rotation.x = -1.2 * atkK;
      playerBody.rotation.x -= 0.35 * atkK;
    } else if (playerAttackAnim === 'stand') {
      // 迎击：双前肢前顶、略外展
      L.rotation.x = -0.8 * atkK; R.rotation.x = -0.8 * atkK;
      L.rotation.z = -0.3 * atkK; R.rotation.z = 0.3 * atkK;
    } else if (playerAttackAnim === 'dodge') {
      playerBody.rotation.z = 0.7 * atkK; // 翻滚侧倾
    } else if (playerAttackAnim === 'tap') {
      L.rotation.x = -0.9 * atkK; R.rotation.x = -0.5 * atkK;
    }
  }
  if (playerAttackAnim !== 'dodge') playerBody.rotation.z = 0;
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
  updateKbSkillBar();
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
  debugVolumes?.update?.({ game, controller, foxes, stats, playerAttackAnim, attackYaw: resolveAttackYaw({ thirdPerson: controller.thirdPerson, cameraYaw: controller.yaw, bodyYaw: controller.bodyYaw }), terrainHeight });

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
    fat: p.fat, fatGoal: cfg.fatGoal, beta: IS_BETA,
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
// 让 key-hints / HUD 等拿不到 binds 实例的模块也能读到当前方案，
// 方案切换后技能状态里的键名自动刷新。
setHintBinds(binds);

let mouseDown = false;
let touchControls = null;
// Config fallback for the new weaker airborne tap-pounce tuning.
PLAYER.combatWheel.aerialPounce ||= {};
PLAYER.combatWheel.aerialPounce.damageMul ??= AERIAL_POUNCE_DAMAGE_MUL;
const releasedTouchAttackPointers = new Set();
// 攻击键按住状态；中断只会由真实狐狸命中触发，后续释放不补招。
const attackCharge = { held: false, t: 0, pointerId: null, via: null, fired: null, interrupted: false };
let attackFullFlashT = 0;
// 首次点击用于捕获鼠标指针时，把这次攻击记下来，等锁定成功后补上
let pendingClickAttack = false;
let pendingClickTimer = 0;
// 固定屏幕下方中央的蓄力进度条。
const attackHint = document.createElement('div');
attackHint.className = 'attack-charge-hint';
attackHint.innerHTML = '<div class="attack-charge-track"><i class="attack-charge-fill"></i></div><b class="attack-charge-label">蓄力</b>';
attackHint.setAttribute('aria-hidden', 'true');
document.body.appendChild(attackHint);
function setAttackHint(hold = 0) {
  const progress = Math.max(0, Math.min(1, hold / (MAX_ATTACK_CHARGE_MS / 1000)));
  attackHint.style.setProperty('--charge-progress', `${progress * 100}%`);
  attackHint.dataset.full = progress >= 1 ? 'true' : 'false';
  attackHint.classList.toggle('full', progress >= 1);
  attackHint.querySelector('.attack-charge-label').textContent = progress >= 1 ? '满蓄力 · 自动扑击' : '蓄力';
  attackHint.classList.toggle('visible', attackCharge.held && !attackCharge.fired);
}
function hideAttackHint() {
  attackHint.classList.remove('visible', 'full');
  attackHint.dataset.full = 'false';
  attackHint.querySelector('.attack-charge-label').textContent = '蓄力';
  attackHint.style.setProperty('--charge-progress', '0%');
}
function cancelAttackCharge() {
  if (attackCharge.via === 'touch' && attackCharge.pointerId !== null) {
    releasedTouchAttackPointers.add(attackCharge.pointerId);
  }
  attackCharge.held = false;
  attackCharge.t = 0;
  attackCharge.pointerId = null;
  attackCharge.via = null;
  attackCharge.fired = null;
  attackCharge.interrupted = false;
  attackFullFlashT = 0;
  hideAttackHint();
}
function interruptHeldAttackCharge() {
  if (!attackCharge.held) return;
  if (attackCharge.via === 'touch' && attackCharge.pointerId !== null) {
    releasedTouchAttackPointers.add(attackCharge.pointerId);
  }
  Object.assign(attackCharge, interruptAttackCharge(attackCharge));
  attackFullFlashT = 0;
  hideAttackHint();
}
function beginAttack(via, pointerId = null) {
  if (game.mode !== 'play') return;
  // 触屏在按住拖动时会重复回调 pressed=true，不能因此把蓄力计时清零。
  if (attackCharge.held) return;
  attackFullFlashT = 0;
  attackCharge.held = true;
  attackCharge.t = 0;
  attackCharge.pointerId = pointerId;
  attackCharge.via = via;
  attackCharge.fired = null;
  attackCharge.interrupted = false;
  hideAttackHint();
  setAttackHint(0);
}
function releaseAttack({ auto = false } = {}) {
  if (!attackCharge.held) return;
  const holdMs = attackCharge.t * 1000;
  const fired = attackCharge.fired;
  const interrupted = attackCharge.interrupted;
  const move = resolveAttackRelease({ holdMs, grounded: controller.grounded, fired, interrupted });
  attackCharge.held = false;
  attackCharge.t = 0;
  attackCharge.pointerId = null;
  attackCharge.via = null;
  attackCharge.fired = null;
  attackCharge.interrupted = false;
  hideAttackHint();
  if (game.mode === 'play' && move) {
    const weakAerial = move === 'lunge' && isWeakAerialPounce({ holdMs, grounded: controller.grounded });
    // 只有实际执行招式时 strike() 扣能量；蓄力过程从不预扣。
    strike(move, weakAerial ? { aerialPounceDamageMul: PLAYER.combatWheel.aerialPounce?.damageMul ?? AERIAL_POUNCE_DAMAGE_MUL } : {});
  }
  if (auto && move === 'lunge') {
    attackFullFlashT = 0.18;
    attackHint.style.setProperty('--charge-progress', '100%');
    attackHint.dataset.full = 'true';
    attackHint.querySelector('.attack-charge-label').textContent = '满蓄力 · 自动扑击';
    attackHint.classList.add('full', 'visible');
  }
}

/** 攻击键“按住左滑”迎击：地面即刻执行；空中请求快落地后消费一次。 */
function triggerParryGesture(ctx = null) {
  if (game.mode !== 'play') return false;
  // 触屏左滑与 PC 中键 / B 都走这里；PC 直接触发时不需要先按住攻击键。
  const directPc = ctx?.source === 'pc';
  if (!directPc) {
    if (!ctx || !attackCharge.held || attackCharge.fired) return false;
    if (attackCharge.pointerId !== ctx.pointerId) return false;
    attackCharge.fired = 'parry';
    attackCharge.t = 0;
    hideAttackHint();
  }
  // 注意：这里只是迎击出手，不等于招架成立；成功反馈只在真正抵住狐狸 dash 时给出。
  if (!controller.grounded) {
    pendingAerialParry = true;
    controller.requestFastLanding();
  } else {
    strike('stand', { fromParryGesture: true });
  }
  return true;
}

/** 攻击键“按住右滑”翻滚：跨阈值立即触发一次，松手不补招。 */
function triggerRollGesture(ctx) {
  if (game.mode !== 'play') return;
  if (!ctx || !attackCharge.held || attackCharge.fired) return;
  if (attackCharge.pointerId !== ctx.pointerId) return;
  attackCharge.fired = 'roll';
  attackCharge.t = 0;
  hideAttackHint();
  doRoll({ moved: true, dx: ctx.dx, dy: ctx.dy });
}

// 是否处于奔跑姿态：疾跑按键 / 触屏疾跑 / 身体俯伏超过阈值。
function isSprintingNow() {
  return controller.touchSprint
    || keys.has('ShiftLeft') || keys.has('ShiftRight')
    || binds.isAction('ShiftLeft', 'sprint') || binds.isAction('ShiftRight', 'sprint')
    || controller.crouch > 0.5;
}


touchControls = new TouchControls({
  canvas,
  controller,
  enabled: TOUCH_DEVICE,
  // 只有自动模式允许首次真实触摸运行时升级；强制键鼠收到 touchstart 也不得切换。
  allowAutoActivate: () => inputMode.canRuntimeUpgrade(),
  allowMouse: TOUCH_DEVICE && inputMode.preference === INPUT_MODE_TOUCH && !hasRealTouch(),
  root: document.getElementById('touchControls'),
  lookZone: document.getElementById('touchLookZone'),
  joystick: document.getElementById('touchJoystick'),
  stick: document.getElementById('touchStick'),
  isActive: () => game.mode === 'play' || !!playAsFox,
  onParryGesture: (ctx) => triggerParryGesture(ctx),
  onRollGesture: (ctx) => triggerRollGesture(ctx),
  onAction: (action, pressed, pointerId, gesture) => {
    if (action === 'attack') {
      if (pressed) {
        if (!releasedTouchAttackPointers.has(pointerId)) beginAttack('touch', pointerId);
      } else {
        if (attackCharge.pointerId === pointerId) releaseAttack();
        // The physical touchend always closes the lifecycle, even when leaving the
        // button already resolved the move and latched this id against restarting.
        releasedTouchAttackPointers.delete(pointerId);
      }
    } else if (!pressed && action === 'dodge') doRoll(gesture);
    else if (pressed && action === 'jump') doJump();
    else if (action === 'interact') {
      if (pressed) {
        interactHeld = true;
        doInteract();
      } else interactHeld = false;
    } else if (pressed && action === 'burst') doBurst();
    else if (pressed && action === 'ultimate') doUltimate();
    else if (pressed && action === 'pause') {
      // 触屏暂停入口做成切换：暂停面板被收起（保持暂停）时也能从这里恢复。
      if (game.mode === 'pause') resume(); else pause();
    }
  },
});

// 攻击手势使用 pointer capture / Touch Events 的原始触摸目标持续接收 move；
// 滑出按钮边界只是手势的一部分，不提前 release，否则 22px 阈值会被按钮边缘截断。
// 老内核兜底：媒体查询/UA 未识别时，收到真实手指触摸立即启用触控层（capture 最早、不拦截）。
// 是否允许升级由输入模式决定：仅自动模式生效，强制键鼠/强制触屏下为幂等 no-op。
for (const evName of ['pointerdown', 'touchstart']) {
  window.addEventListener(evName, (ev) => {
    if (TOUCH_DEVICE) return;
    const realTouch = ev.pointerType === 'touch' || ev.pointerType === 'pen' || evName === 'touchstart';
    if (realTouch) inputMode.notifyRealTouch();
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
  // 独立扮演模式自行读取同一 Keybinds；不得同时触发土拨鼠动作。
  if (playAsFox) return;
  if (e.repeat) {
    // 长按只记录"按住"状态（攻击/移动需要），不重复触发单次动作
    if (game.mode === 'play' && isBound(e.code)) {
      keys.add(e.code);
      if (binds.isAction(e.code, 'interact')) interactHeld = true;
    }
    return;
  }

  // F11 全屏：需先于常规判断并阻止默认行为，才能同步按钮状态与 resize
  if (binds.isAction(e.code, 'fullscreen')) {
    e.preventDefault();
    toggleFullscreen();
    return;
  }
  if (binds.isAction(e.code, 'cameraView') && game.mode === 'play') {
    e.preventDefault();
    setViewMode(!thirdPerson, true);
    return;
  }

  // Esc 退出布局编辑：必须先于 isBound 判定（兼容方案暂停键是 P，Esc 不在绑定内）。
  if (e.code === 'Escape' && touchLayout?.editing) { touchLayout.setEditing(false); return; }

  if (!isBound(e.code)) return;
  // 空格/方向键会滚动页面，必须拦
  if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();

  // —— 系统类动作（任何状态下都可用）——
  if (binds.isAction(e.code, 'restart')) { resetAll(); startPlay(); return; }
  if (binds.isAction(e.code, 'retry')) { retryLevel(); return; }
  if (binds.isAction(e.code, 'pause')) {
    if (touchLayout.editing) { touchLayout.setEditing(false); return; }
    // 设置/帮助打开时，暂停键优先关闭它们（关闭逻辑决定是否恢复游戏），不带着面板 resume。
    if (settingsUI && !settingsUI.el.sheet.hidden) { settingsUI.close(); return; }
    if (!helpSheet.hidden) { closeHelp(); return; }
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
  if (binds.isAction(e.code, 'parry')) triggerParryGesture({ source: 'pc', kind: 'parry' });
  if (binds.isAction(e.code, 'attack')) beginAttack('key');
  if (binds.isAction(e.code, 'dodge')) doRoll();
  if (binds.isAction(e.code, 'burst')) doBurst();
  if (binds.isAction(e.code, 'ultimate')) doUltimate();
  if (binds.isAction(e.code, 'interact')) {
    interactHeld = true;
    if (!e.repeat) doInteract();
  }
  if (binds.isAction(e.code, 'jump')) doJump();
});

window.addEventListener('keyup', (e) => {
  if (playAsFox) return;
  keys.delete(e.code);
  if (binds.isAction(e.code, 'interact')) interactHeld = false;
  if (binds.isAction(e.code, 'attack')) {
    if (attackCharge.via === 'key') releaseAttack();
  }
});

canvas.addEventListener('mousedown', (e) => {
  if (playAsFox || controller.touchEnabled) return;
  audio.ensure();

  // 中键 = 迎击；阻止浏览器自动滚动，并与触屏左滑复用同一迎击函数。
  if (e.button === 1) {
    e.preventDefault();
    triggerParryGesture({ source: 'pc', kind: 'parry' });
    return;
  }

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
      beginAttack('mouse');
      clearTimeout(pendingClickTimer);
      pendingClickTimer = setTimeout(() => { pendingClickAttack = false; if (attackCharge.via === 'mouse') releaseAttack({ auto: true }); }, MAX_ATTACK_CHARGE_MS);
    }
    return;
  }
  mouseDown = true;
  if (game.mode === 'play') beginAttack('mouse');
});

// 指针捕获成功时，补上被吞掉的那次攻击
controller.onLockChange = (locked) => {
  document.body.classList.toggle('unlocked', !locked);
  document.body.classList.toggle('no-lock', !locked);
  if (locked && pendingClickAttack) {
    clearTimeout(pendingClickTimer);
    pendingClickAttack = false;
    mouseDown = true;
    // 攻击蓄力已在 mousedown 时开始，这里无需重复。
  }
  // 未锁定时暂停，避免玩家离开后被偷袭
  if (!locked && !controller.touchEnabled && game.mode === 'play') pause();
};
// 右键已用于跳跃，必须屏蔽浏览器右键菜单，否则每次跳跃都会弹菜单
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

window.addEventListener('mouseup', (e) => {
  if (e.button !== 0) return;
  mouseDown = false;
  if (attackCharge.via === 'mouse') releaseAttack();
  clearTimeout(pendingClickTimer);
  pendingClickAttack = false;
});
window.addEventListener('blur', () => {
  keys.clear(); mouseDown = false;
  if (attackCharge.held) releaseAttack();
  if (game.mode === 'play') pause();
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    touchControls?.releaseAll();
    if (IS_BETA) audio.handleVisibility(true);
    if (game.mode === 'play') pause();
  } else {
    if (IS_BETA) audio.handleVisibility(false);
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

// 帮助面板
const helpBtn = document.getElementById('helpBtn');
const helpSheet = document.getElementById('helpSheet');
let helpPausedBySheet = false;
function openHelp() {
  helpSheet.hidden = false;
  if (game.mode === 'play') { pause(); helpPausedBySheet = true; } else { helpPausedBySheet = false; }
}
function closeHelp() {
  helpSheet.hidden = true;
  if (helpPausedBySheet) { helpPausedBySheet = false; if (game.mode === 'pause') resume(); }
}
helpBtn.onclick = () => { helpSheet.hidden ? openHelp() : closeHelp(); };
document.getElementById('helpClose').onclick = closeHelp;

// 设置面板（键位方案）
const touchLayout = new TouchLayout({ beta: IS_BETA });
initFeedbackFlush({ endpoint: FEEDBACK.endpoint, intervalMs: FEEDBACK.queueFlushIntervalMs });
const feedbackUI = new FeedbackUI({
  endpoint: FEEDBACK.endpoint,
  getSnapshot: () => collectGameSnapshot({
    game, version: VERSION_LABEL, thirdPerson, sandbox: SANDBOX_MODE,
    touch: TOUCH_DEVICE, inputMode: inputMode.describe(), performanceProfile: renderProfile,
  }),
});
// 进入触屏布局调整时自动暂停，退出时恢复；调整前已暂停则保持暂停。
touchLayout.setPauseHooks({
  pause: ({ silent = false } = {}) => pause({ silent }),
  resume: () => { if (game.mode === 'pause') resume(); },
  isPaused: () => game.mode !== 'play',
});
// 疾跑触发范围（摇杆内圈）：布局数据是唯一持久化来源，触控层实时消费；滑块变化经回调即时生效。
touchControls.setSprintThreshold(touchLayout.layout.joystick.sprintThreshold);
touchLayout.onSprintThreshold = (v) => touchControls.setSprintThreshold(v);
// 摇杆整体大小：布局层 transform 缩放与触控层坐标换算保持同一倍率。
touchControls.setJoystickScale(touchLayout.layout.joystick.scale);
touchLayout.onJoystickScale = (v) => touchControls.setJoystickScale(v);

// 设置面板"图形/渲染"只读信息：惰性读取当前渲染器（beta 为经典 WebGLRenderer，
// dev GS 为 WebGPURenderer 家族；读取失败由 readGpuInfo fail-soft 为"不可用"）。
const settingsUI = new SettingsUI(binds, touchLayout, feedbackUI, inputMode, graphicsPreferenceState, audio, () => renderer);
touchLayout.onEditingStart = () => settingsUI.transferPauseToLayoutEditor();
// 游戏中打开设置自动暂停；关闭时仅在由设置发起暂停时恢复（已暂停/标题态保持）。
settingsUI.setPauseHooks({
  pause: () => pause(),
  resume: () => { if (game.mode === 'pause') resume(); },
  isPaused: () => game.mode !== 'play',
  isPlaying: () => game.mode === 'play',
});
// 设置面板切换输入模式 → 即时生效；启动时也同步一次（html 属性 / 鼠标兜底 / 布局入口可用性）。
inputMode.onChange(() => applyInputMode());
applyInputMode();

// 开发测试面板通过 ?test=1 显式启用，不进入普通用户界面。
const testModeBtn = document.getElementById('testModeBtn');
const testPanel = document.getElementById('testPanel');
function setTestPanelOpen(open) {
  const visible = !!open;
  testPanel.hidden = !visible;
  testModeBtn.setAttribute('aria-expanded', String(visible));
}
{
  testModeBtn.hidden = false;
  testModeBtn.hidden = !TEST_MODE && !SANDBOX_MODE;
  document.getElementById('testGodMode').checked = testState.godMode;
  document.getElementById('testFreezeTimer').checked = testState.freezeTimer;
  recordTestLog('session-start', { userAgent: navigator.userAgent, initialSnapshot: testSnapshot() });
  const stopTestPanelEvent = (event) => event.stopPropagation();
  testModeBtn.addEventListener('pointerdown', stopTestPanelEvent);
  testModeBtn.addEventListener('click', (event) => {
    event.stopPropagation();
    setTestPanelOpen(testPanel.hidden);
  });
  testPanel.addEventListener('pointerdown', stopTestPanelEvent);
  testPanel.addEventListener('click', stopTestPanelEvent);
  const closeTestPanelOutside = (event) => {
    if (testPanel.hidden) return;
    if (testPanel.contains(event.target) || testModeBtn.contains(event.target)) return;
    setTestPanelOpen(false);
  };
  document.addEventListener('pointerdown', closeTestPanelOutside);
  document.addEventListener('click', closeTestPanelOutside);
  document.getElementById('testPanelClose').onclick = () => {
    setTestPanelOpen(false);
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

sandboxRecorder = IS_BETA
  ? new SandboxRecorder({ now: () => game.totalTime })
  : null;
const sandboxPanelUI = setupSandboxPanel({
  root: testPanel,
  state: sandboxState,
  recorder: sandboxRecorder,
  onAction: (action) => {
    if (action === 'recordStart') {
      sandboxRecorder?.start(game.totalTime, { level: game.level + 1, sandbox: true, foxCount: foxes.length });
      sandboxState.lastRecordingSummary = '';
      hud.say('开始录制操作：攻击、受击、移动与狐狸状态会写入 JSON', 2.5);
    } else if (action === 'recordStop') {
      const take = sandboxRecorder?.stop(game.totalTime, { reason: 'panel-stop' });
      sandboxState.lastRecordingSummary = take ? renderSummaryText(take.summary) : '';
      hud.say('录制已停止，可在面板查看摘要或导出 JSON', 2.5);
    } else if (action === 'recordExport') {
      if (sandboxRecorder?.lastTake && downloadTake(sandboxRecorder.lastTake)) hud.say('操作录制 JSON 已导出', 2);
    } else if (action === 'refill') { game.player.hp = 100; game.player.energy = 100; }
    else if (action === 'clearStress') { game.player.stress = 0; game.stressWarned = false; }
    else if (action === 'charge') game.charge = 100;
    else if (action === 'resetFood') {
      berries.forEach((b) => b.reset());
      scenery.resetBerries?.();
      hud.say('食物已重置，被吃掉的浆果/植物重新出现', 2);
    }
    else if (action === 'spawnOne') spawnSandboxFoxes({ state: sandboxState, spawnFox: (type) => spawnSandboxFox(type) });
    else if (action === 'spawnSmart') spawnSandboxSmartFox();
    else if (action === 'spawnGroup') spawnSandboxFoxes({ count: 6, state: sandboxState, spawnFox: (type) => spawnSandboxFox(type) });
    else if (action === 'clearFoxes') clearSandboxFoxes({ state: sandboxState, clearFoxes: disposeAllFoxes });
    else if (action === 'placeDummy') placeSandboxDummy({
      state: sandboxState,
      createDummy: () => spawnSandboxFox('normal', -1, { sandboxDummy: true, dummyDefeatable: sandboxState.dummyDefeatable }),
      removeDummy: (dummy) => { foxes = foxes.filter((f) => f !== dummy); dummy.dispose(scene); },
    });
    else if (action === 'removeDummy') removeSandboxDummy({
      state: sandboxState,
      removeDummy: (dummy) => { foxes = foxes.filter((f) => f !== dummy); dummy.dispose(scene); },
    });
  },
  onChange: (name, value) => {
    if (name === 'godMode') testState.godMode = value;
    if (name === 'freezeTimer') testState.freezeTimer = value;
    if (name === 'parryDrill') {
      sandboxState.parryDrill = value;
      if (value) {
        // 只留 1 只练习狐，清掉其他；它会在 fox.update 里被 drillCtx 引导。
        clearSandboxFoxes({ state: sandboxState, clearFoxes: disposeAllFoxes });
        const f = spawnSandboxFox('normal');
        if (f) { f.drillCtx = { px: controller.position.x, pz: controller.position.z, yaw: controller.bodyYaw }; }
        hud.say('迎击练习：等狐狸正面冲刺时，按住攻击键向左滑出迎击顶回去', 3.2);
      } else {
        foxes.forEach((f) => delete f.drillCtx);
      }
    }
    if (name === 'dummyDefeatable') {
      sandboxState.dummyDefeatable = value;
      setSandboxDummyDefeatable(sandboxState.dummy, value);
    }
    if (name === 'difficulty') { applySandboxDifficulty(sandboxState, value); foxes.forEach((f) => { if (!f.isSandboxDummy) { f.sandboxSpeedMul = sandboxState.speedMultiplier; f.sandboxAlertMul = sandboxState.alertMultiplier; f.applySmartDifficulty?.(sandboxState.difficulty); } }); }
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

// 键鼠模式技能状态条：当前键位 + 就绪/冷却/充能/能量不足。触屏模式整块隐藏。
const kbSkillEls = {};
function cacheKbSkillEls() {
  const bar = document.getElementById('kbSkillBar');
  if (!bar) return null;
  for (const id of ['burst', 'ultimate', 'interact']) {
    const slot = bar.querySelector(`[data-kb-skill="${id}"]`);
    kbSkillEls[id] = {
      slot,
      key: slot?.querySelector('.kb-key'),
      name: slot?.querySelector('.kb-name'),
      state: slot?.querySelector('.kb-state'),
    };
  }
  return bar;
}
const kbSkillBar = cacheKbSkillEls();

function updateKbSkillBar() {
  if (!kbSkillBar) return;
  const show = !TOUCH_DEVICE && (game.mode === 'play' || game.mode === 'pause');
  kbSkillBar.hidden = !show;
  if (!show) return;

  const keyLabel = (id) => bindText(binds, id, '');
  const setState = (id, key, label, state, sub) => {
    const ref = kbSkillEls[id];
    if (!ref?.slot) return;
    if (ref.key) ref.key.textContent = key;
    if (ref.name) ref.name.textContent = label;
    if (ref.state) ref.state.textContent = sub || label;
    ref.slot.classList.toggle('is-cd', state === 'cd');
    ref.slot.classList.toggle('is-charging', state === 'charging');
    ref.slot.classList.toggle('is-no-energy', state === 'no-energy');
    ref.slot.classList.toggle('is-ready', state === 'ready');
    ref.slot.classList.toggle('is-active', state === 'active');
    ref.slot.classList.toggle('is-gather', id === 'interact' && state === 'gather');
  };

  // 应急爆发
  const bKey = keyLabel('burst');
  if (game.boost > 0) setState('burst', bKey, '应急爆发', 'active', `生效 ${Math.ceil(game.boost)}s`);
  else if (game.boostCD > 0) setState('burst', bKey, '应急爆发', 'cd', `冷却 ${Math.ceil(game.boostCD)}s`);
  else if (game.player.energy < BOOST.minEnergy) setState('burst', bKey, '应急爆发', 'no-energy', `需${IS_BETA ? '体力' : '储备'} ${BOOST.minEnergy}`);
  else setState('burst', bKey, '应急爆发', 'ready', '就绪');

  // 协同大招（蓄力/冷却/就绪/能量不足）
  const uKey = keyLabel('ultimate');
  if (game.overdrive > 0) setState('ultimate', uKey, '协同大招', 'active', `生效 ${Math.ceil(game.overdrive)}s`);
  else if (game.overCD > 0) setState('ultimate', uKey, '协同大招', 'cd', `冷却 ${Math.ceil(game.overCD)}s`);
  else {
    const uState = cooldownState({ energy: game.player.energy, cost: ULT.cost, charge: game.charge, charging: true });
    const sub = game.charge >= 100
      ? (game.player.energy < ULT.cost ? `需${IS_BETA ? '体力' : '储备'} ${ULT.cost}` : '就绪 · 范围冲击')
      : `蓄力 ${Math.round(game.charge)}/100`;
    setState('ultimate', uKey, '协同大招', game.charge >= 100 ? uState : 'charging', sub);
  }

  // 共享 interact 动作的状态文案按通道区分；beta 不读取伙伴救援状态。
  const iKey = keyLabel('interact');
  if (IS_BETA) {
    if (game.gatherAvailable) setState('interact', iKey, '采集', 'gather', '可采集');
    else {
      const status = betaInteractionSkillState({
        available: forage.index !== -1,
        held: interactHeld,
        kind: forage.index === -2 ? 'grass' : 'flower',
      });
      setState('interact', iKey, status.label, status.state, status.sub);
    }
  } else if (!game.friend.saved && !game.friend.rescued) setState('interact', iKey, '救援/陪伴', 'ready', '待救援');
  else if (!game.friend.saved) setState('interact', iKey, '救援/陪伴', 'ready', '跟随中');
  else if (game.social > 0) setState('interact', iKey, '救援/陪伴', 'active', `缓压 ${Math.ceil(game.social)}s`);
  else if (game.socialCD > 0) setState('interact', iKey, '救援/陪伴', 'cd', `冷却 ${Math.ceil(game.socialCD)}s`);
  else if (game.inBaseBurrow) setState('interact', iKey, '救援/陪伴', 'ready', '可陪伴');
  else setState('interact', iKey, '救援/陪伴', 'ready', '回大本营');
}

// 键位方案切换后刷新状态条上的键名。
binds.onChange(() => updateKbSkillBar());

// 键位变化时同步帮助面板上的按键提示，避免文档与实际绑定不一致
function syncHelpKeys() {
  // 视角切换按钮的 title/快捷键提示跟随 cameraView 绑定实时刷新
  viewKeyLabel = bindText(binds, 'cameraView', 'V');
  refreshViewKeyHint();
  const rows = binds.describe();
  const row = (id) => rows.find((x) => x.id === id);
  const parts = (id, includeAlt = true) => {
    const r = row(id);
    if (!r) return [];
    const out = r.keys.slice();
    if (includeAlt && r.alt) out.push(r.alt);
    return out;
  };
  const get = (id, emptyFallback = '') => {
    const r = row(id);
    if (!r) return '';
    const value = parts(id).join(' / ');
    return value || emptyFallback;
  };
  const kbd = (text) => text ? `<kbd>${text}</kbd>` : '';
  const keys = (id, emptyFallback = '') => kbd(get(id, emptyFallback));
  const turnKeys = (side, fallback = '') => kbd(Keybinds.pretty(binds.turnMap?.[side]) || fallback);
  const join = (values) => values.filter(Boolean).join(' / ');
  const schemeLabel = {
    compatible: '兼容（compatible）',
    optimized: '优化（optimized）',
    custom: '自定义（custom）',
  }[binds.scheme] || binds.scheme;
  const turning = !!binds.turningEnabled;
  const driving = binds.controlProfile === 'driving';
  const movement = driving
    ? `<span>${keys('forward')} / ${keys('back')} 前后移动 · ${turnKeys('left', get('left', 'A'))} / ${turnKeys('right', get('right', 'D'))} 转向（方向键上下前后、左右转向）</span>`
    : turning
      ? `<span>${keys('forward')} / ${keys('back')} 前后移动 · ${keys('left')} / ${keys('right')} 横移 · ${keys('turnLeft')} / ${keys('turnRight')} 转向（方向键为移动备选）</span>`
      : `<span>${keys('forward')} / ${keys('back')} / ${keys('left')} / ${keys('right')} 移动（方向键为备选）</span>`;
  const attackKeys = join(['鼠标左键', get('attack')]);
  const jumpKeys = join([get('jump'), '鼠标右键']);
  const parryKeys = join([get('parry'), '中键']);
  const pauseKeys = get('pause');
  const escLine = pauseKeys === 'Esc'
    ? 'Esc 释放鼠标指针并暂停/继续'
    : 'Esc 释放鼠标指针，失去指针锁定时会暂停；暂停时可继续';
  const html = `
    <h3>操作说明</h3>
    <div class="keys">
      <span class="touch-help"><kbd>触屏</kbd> 第一人称摇杆左右转向、前后移动（可同时）· 第三人称摇杆决定移动方向 · 右侧拖动视角 · 屏幕按钮执行动作</span>
      <span><kbd>方案</kbd> ${schemeLabel}</span>
      <span><kbd>鼠标</kbd> 视角</span>
      ${movement}
      <span><kbd>${attackKeys}</kbd> 攻击：短按/松手推击 · 地面按住0.65秒后松手扑击（蓄满自动扑出，空中短按为较弱扑击）· 按住向左滑迎击 · 按住向右滑翻滚</span>
      <span><kbd>${parryKeys}</kbd> 迎击：地面立即出手，空中快落地后出手</span>
      <span><kbd>${jumpKeys}</kbd> 跳跃</span>
      <span>${keys('dodge')} 翻滚 / 闪避（触屏右侧翻滚键）</span>
      <span>${keys('burst')} 应急爆发　${keys('ultimate')} 协同大招</span>
      <span>${keys('interact')} ${INTERACT_TEXT.help}　${keys('sprint')} 疾行（更快但更耗${IS_BETA ? '体力' : '储备'}）</span>
      <span>${keys('cameraView', 'V')} 第一/第三人称视角切换</span>
      <span>${keys('pause')} 暂停　${keys('retry')} 重试本关　${keys('restart')} 从第一关重开　${keys('fullscreen')} 全屏</span>
      <span><kbd>${escLine}</kbd> · <kbd>Enter</kbd> 标题/暂停/通关确认</span>
    </div>
    <p class="note">洞穴内不能攻击。完成<b>采食 + 伙伴到家</b>后回洞，自动进入下一关。采食需按住停留，受惊会变慢；花稀有但高效。<br>
    <b>逼退不等于杀死</b>：藏狐察觉形势不利会主动撤到安全处休息回血，休息够了再回来。你要做的不是把它打死，是把它<b>逼退</b>。<br>
    <b>奔跑时会自动俯身冲刺，停下则起身</b> —— 起身比趴下稍慢，就像真的在用四肢撑起身体。<br>
    被困伙伴会周期性<b>呼救</b>，屏幕边缘的<b>绿色箭头</b>指向它；红色箭头则是正在逼近的藏狐。<br>
    <b>跳跃可以跳过扑击</b>：腾空够高时不会被藏狐碰到。</p>
    <button class="primary" id="helpClose2">知道了</button>`;
  helpSheet.innerHTML = html;
  const moveHint = schemeHints(binds, { isDev: IS_DEV }).movement;
  const titleMoveHint = document.getElementById('titleMoveHint');
  const pauseMoveHint = document.getElementById('pauseMoveHint');
  if (titleMoveHint) titleMoveHint.textContent = moveHint;
  if (pauseMoveHint && !TOUCH_DEVICE) pauseMoveHint.textContent = moveHint;
  const c2 = document.getElementById('helpClose2');
  if (c2) c2.onclick = closeHelp;
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

// 触屏手势拦截（contextmenu/dblclick/gesture*）由 TouchControls 在激活时安装、
// 停用时移除，保证强制键鼠模式下恢复浏览器默认行为。

// 静态设备预算作为上限，运行时控制器只叠加可逆质量档位。
// resize / 输入模式切换均从静态 profile 重算，再应用当前档位，避免覆盖动态状态。
function refreshRenderProfile({ resize = false } = {}) {
  const previous = renderProfile;
  renderProfile = adaptiveQuality.apply(getRenderProfile(TOUCH_DEVICE));
  if (!previous || previous.pixelRatio !== renderProfile.pixelRatio) renderer.setPixelRatio(renderProfile.pixelRatio);
  if (resize) renderer.setSize(window.innerWidth, window.innerHeight);
  if ('shadowMap' in renderer) renderer.shadowMap.enabled = renderProfile.shadows;
  sky?.applyRenderProfile?.(renderProfile);
  return renderProfile;
}

// 窗口尺寸 / 全屏切换共用
function resizeRenderer() {
  const w = window.innerWidth, h = window.innerHeight;
  camera.aspect = w / h;
  // 保持基准 FOV：控制器会按姿态在其基础上收窄
  camera.updateProjectionMatrix();
  refreshRenderProfile({ resize: true });
  // viewmodel 相机也要同步宽高比，否则爪子会被拉伸变形
  viewModel.resize(w / h);
}

window.addEventListener('resize', resizeRenderer);
window.addEventListener('orientationchange', () => requestAnimationFrame(resizeRenderer));
window.visualViewport?.addEventListener('resize', resizeRenderer);

canvas.addEventListener('webglcontextlost', (event) => {
  event.preventDefault();
  console.warn('[renderer] WebGL context lost; browser/GPU reset may have interrupted rendering.', event);
  touchControls?.releaseAll();
  if (game.mode === 'play') pause();
  hud.say('图形渲染已重置，请稍候…', 4.5);
});
canvas.addEventListener('webglcontextrestored', () => {
  console.info('[renderer] WebGL context restored; refreshing renderer size/profile.');
  resizeRenderer();
  hud.say('画面已恢复。', 2.2);
});

// ============================================================
// 主循环
// ============================================================
let last = performance.now();
let playerBodyYaw = controller.yaw;
let fpsAcc = 0, fpsCount = 0, fpsTimer = 0;
const adaptiveTransitions = [];

function frame(now) {
  const frameMs = Math.max(0, now - last);
  const dt = Math.min(frameMs / 1000, 0.05);
  last = now;
  const qualityChange = adaptiveQuality.sample(frameMs, now);
  if (qualityChange) {
    refreshRenderProfile();
    adaptiveTransitions.push({ at: Math.round(now), ...qualityChange, profile: { ...renderProfile.adaptive } });
    if (adaptiveTransitions.length > 16) adaptiveTransitions.shift();
    console.info('[performance] 自适应画质档位切换', adaptiveTransitions[adaptiveTransitions.length - 1]);
  }

  const touchPlaying = TOUCH_DEVICE && (game.mode === 'play' || !!playAsFox);
  if (document.body.classList.contains('touch-playing') !== touchPlaying) {
    document.body.classList.toggle('touch-playing', touchPlaying);
    // 触控实玩类切换会改变 HUD 卡片的 CSS 默认位置，未拖动过的卡跟随新设计位置。
    touchLayout.refreshCardDefaults();
  }
  // 暂停态：供设置/帮助/布局编辑器在暂停层之上显示并保持游戏暂停。
  document.body.classList.toggle('paused', game.mode === 'pause');

  // —— BETA 扮演藏狐模式：由独立模式接管相机/输入/实体/天空 ——
  if (playAsFox) {
    if (IS_BETA) audio.updateBgmState({ mode: 'play', hp: game.player.hp, stress: 0, threats: 0, combat: false });
    playAsFox.update(dt);
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
    return;
  }

  update(dt);
  if (IS_BETA) {
    const inRangeFoxes = foxes.filter((fox) => fox.alive && !game.inBurrow
      && Math.hypot(fox.x - game.player.x, fox.z - game.player.z) < 22);
    audio.updateBgmState({
      mode: game.mode,
      hp: game.player.hp,
      stress: game.player.stress,
      threats: inRangeFoxes.length,
      winding: inRangeFoxes.some((fox) => fox.state === 'wind'),
      combat: game.overdrive > 0 || inRangeFoxes.some((fox) => fox.state === 'dash'),
      overdrive: game.overdrive,
      inBurrow: game.inBurrow,
    });
  }
  // 键鼠技能状态条在 play/pause 都要刷新（函数内部按模式与输入方式决定显隐）。
  updateKbSkillBar();
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
      playerAttackT > 0 ? playerAttackT / Math.max(0.01, playerAttackDur) : -1,
      controller.pitch,
      playerAttackAnim,
    );
    viewModel.render(renderer);
  }

  // 性能提示
  fpsAcc += 1 / Math.max(dt, 0.0001);
  fpsCount++;
  fpsTimer += dt;
  if (fpsTimer > 2) {
    const fps = Math.round(fpsAcc / fpsCount);
    hud.setPerfHint(`${fps} FPS · 画质 T${renderProfile.qualityTier} · ${renderer.info.render.triangles.toLocaleString()} 三角面`);
    fpsAcc = 0; fpsCount = 0; fpsTimer = 0;
  }

  requestAnimationFrame(frame);
}

// ============================================================
// BETA 账号 / 排行榜（仅 IS_BETA；失败静默，不影响游戏主循环）
// ============================================================
const accountsApi = IS_BETA ? new AccountsApi(ACCOUNTS) : null;
let authModal = null;
let leaderboardUI = null;
let accountSession = IS_BETA ? readSession(undefined, ACCOUNTS.storageKey) : null;
function accountStore() { return accountSession; }
function setAccountSession(next) { accountSession = next; }
function safeScorePayload(input) {
  try { return buildScorePayload(input, LEVELS.length); }
  catch (error) { console.debug('[accounts] 成绩数据无效，已跳过上报', error?.message || error); return null; }
}
function handleUnauthorizedAccount(error) {
  if (!isUnauthorized(error)) return;
  clearSession(undefined, ACCOUNTS.storageKey);
  setAccountSession(null);
  if (game.mode === 'title') title();
}
function submitLevelScore(level, time, stats) {
  const session = accountStore();
  if (!session || !accountsApi) return; // 尚无身份时静默跳过
  const payload = safeScorePayload({ kind: 'level', level, time, ...stats, version: VERSION_LABEL });
  if (!payload) return;
  void accountsApi.submitScore(payload, session.token).catch((error) => {
    handleUnauthorizedAccount(error);
    console.debug('[accounts] 单关成绩上报失败', error?.status || error?.code || error);
  });
}
if (IS_BETA) {
  authModal = new AuthModal({
    api: accountsApi,
    storageKey: ACCOUNTS.storageKey,
    getToken: () => accountStore()?.token || '',
    onAuthenticated: (session) => {
      setAccountSession(session);
      if (game.mode === 'title') title();
      leaderboardUI?.refresh();
    },
  });
  leaderboardUI = new LeaderboardUI({
    api: accountsApi,
    levels: LEVELS,
    getSession: () => accountStore(),
    onAuthRequest: () => authModal?.open('login'),
  });
  // 打开即游客：无本地会话时静默签发一个游客身份，成绩可直接上榜。
  if (!accountSession) {
    void accountsApi.guest().then((res) => {
      const session = writeSession(res?.token, res?.user, undefined, ACCOUNTS.storageKey);
      if (session) { setAccountSession(session); if (game.mode === 'title') title(); }
    }).catch((error) => console.debug('[accounts] 游客身份签发略过', error?.status || error?.code || error));
  } else {
    // 校验本地会话是否仍有效；401 则清除并转游客。
    void restoreSession(accountsApi, undefined, ACCOUNTS.storageKey).then(({ session, invalid }) => {
      if (invalid) { setAccountSession(null); title(); void accountsApi.guest().then((res) => { const s = writeSession(res?.token, res?.user, undefined, ACCOUNTS.storageKey); if (s) { setAccountSession(s); title(); } }).catch(() => {}); }
      else if (session) { setAccountSession(session); if (game.mode === 'title') title(); }
    }).catch(() => {});
  }
}

// ============================================================
// 启动
// ============================================================
hud.setLoading(100, '完成');
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
  audio: IS_BETA ? audio : null,
  testMode: TEST_MODE, sandboxMode: SANDBOX_MODE, sandboxState, enterSandbox, exitSandbox,
  testState, testLogs, recordTestLog, testSnapshot, exportTestLogs,
  foxes: () => foxes, berries: () => berries, companion,
  combatStats: () => combatStats(game),
  burrow: BURROW,
  burrowObj: burrow, burrows: burrowDefs, scenery, sky, claw, shockwave, particles, damageText, aura, minimap,
  viewModel, playerModel, playerBody, setViewMode, get thirdPerson() { return thirdPerson; },
  binds, findConflicts, ACTIONS, FoxClass: Fox,
  isDev: IS_DEV, isBeta: IS_BETA, progress, ecology: { energyOfPlant, eatLine, seasonForLevel, plantsForLevel, HERBIVORE },
  touchControls, renderProfile: () => ({ ...renderProfile }),
  adaptivePerformance: () => ({ ...adaptiveQuality.snapshot(), profile: { ...renderProfile } }),
  adaptiveTransitions,
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
