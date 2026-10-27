/**
 * BETA 专属：扮演藏狐（Play as Fox）。
 *
 * 独立玩法模式：玩家亲自操控一只藏狐，潜行接近 → 蓄力 → 扑击，
 * 捕猎会逃跑的 AI 土拨鼠得分。模式自管相机 / 输入 / 实体 / HUD 覆盖层，
 * 通过一个 context 复用主场景的地形、天空、渲染器；激活期间由 main.js 的
 * frame() 早返回守卫跳过正常土拨鼠玩法循环，不激活时主路径逐字不变。
 *
 * 设计要点：
 *  - 镜头：第三人称追尾（看得见自己扮演的藏狐）。
 *  - 移动：坦克式操控，W/S 前后，鼠标 / ←→ / A D 转向；默认潜行（蹲伏、
 *    土拨鼠更近才察觉），按住 Shift 冲刺（快但更早被发现）。
 *  - 扑击：空格 / 左键，短蓄力后沿锁定朝向跃扑，带抛物线腾空；
 *    扑击激活帧内水平重叠且处于垂直窗口才捕获土拨鼠；扑完有硬直。
 *  - 猎物：AI 土拨鼠游荡，进入察觉半径会警觉（!）随后逃离，扑击时惊逃更快。
 *
 * 所有平衡数值集中在 PAF_DEFAULTS / 运行时 cfg，?pafdebug=1 时由
 * play-as-fox-debug.js 的 lil-gui 后台实时调整（见同目录）。普通玩家永远用默认值。
 */
import * as THREE from 'three';
import { createPafFoxModel } from '../entities/paf-fox-model.js';
import { createPafMoleModel } from '../entities/paf-mole-model.js';
import { createPafFpvViewModel } from '../entities/paf-fpv-viewmodel.js';
import {
  createViewModeState, enterFpvLook, applyLookDelta, dampLookToward,
  tpsCameraPose, fpvCameraPose,
} from '../core/paf-camera.js';
import { terrainHeight } from '../core/utils.js';
import { moveBounds } from '../core/config.js';
import {
  CUE_MODE, deg2rad, yawTo, inViewCone, stepPreyMind, stepZigzag, zigzagActive,
  predictLandingPoint, evadeVector, canCatch, pickRespawnPoint,
  nearestTarget, leadTarget, windLeadTime, retargetWindYaw,
  pushOutCircles,
} from '../core/predator-prey.js';
import {
  isPafKey, pafKeyHeld, PafPounceCharge,
  PafInputRoute,
} from '../core/paf-input.js';

/** 扮演藏狐模式全部可调平衡数值（后台滑块直接改这里的运行时副本）。 */
export const PAF_DEFAULTS = {
  // 玩家移动
  stalkSpeed: 2.5,        // 潜行速度 m/s
  runSpeed: 6.4,          // 冲刺速度 m/s
  reverseSpeed: 0.55,     // 后退相对速度
  turnRate: 2.6,          // 键盘转向 rad/s
  mouseTurn: 0.0024,      // 鼠标每像素转向（默认乘普通控制器灵敏度比例）
  pounceMaxCharge: 1.2,  // 触屏按住攻击的最长蓄力 s；短按仍按 windTime 自动扑出
  // 扑击相位
  windTime: 0.22,         // 蓄力下蹲 s
  lungeTime: 0.42,        // 腾空时长 s
  lungeSpeed: 13.5,       // 腾空速度 m/s
  lungeHeight: 1.05,      // 腾空抛物线高度 m
  recoverTime: 0.5,       // 落地硬直 s
  catchRadius: 1.7,       // 扑击捕获水平半径 m（扑击范围）
  // 碰撞体积（供后台可视化/标定；捕获以 catchRadius 为准）
  foxRadius: 0.5,
  foxHeight: 0.9,
  preyRadius: 0.4,
  // 猎物 AI
  preyCount: 8,
  preyWander: 1.7,        // 游荡速度
  preyFlee: 5.0,          // 惊逃速度
  preyBurst: 8.2,         // 被扑击瞬间惊逃峰值
  respawnTime: 1.6,       // 捕获后重生 s
  // 旧三档察觉半径（A1 起作为视觉/听觉档位锚点；与 config.js FOX.detection 对齐）
  detectStalk: 6.2,       // 潜行视觉半径
  detectSprint: 11.5,     // 冲刺视觉半径
  detectLunge: 17.0,      // 扑击全向听觉半径
  alertTime: 0.32,        // 警觉停留 s 后开始逃
  fleeCommit: 0.55,       // 距离近于 察觉半径*该比例 立即逃（跳过 freeze）
  // A1 多线索察觉（距离衰减 × 视锥 × 速度/姿态 + 全向听觉代理）
  visionHalfAngleDeg: 60, // 视锥半角（全锥 120°）
  visionRadiusLunge: 13.0,// 扑击中视觉半径（扑击主要靠全向听觉被发现）
  hearRadiusStalk: 3.0,   // 潜行脚步听觉半径
  hearRadiusSprint: 9.0,  // 冲刺听觉半径
  visionFalloffInner: 0.65, // 视觉半径该比例内满强度，外圈线性衰减到 0
  hearFalloffInner: 0.5,  // 听觉同上
  visionRate: 1.8,        // suspicion 视觉上升率 /s
  hearRate: 1.6,          // suspicion 听觉上升率 /s
  speedCoefStalk: 0.75,   // 视觉速度系数：潜行 < 冲刺 < 扑击
  speedCoefSprint: 1.0,
  speedCoefLunge: 1.25,
  noiseCoefStalk: 0.45,   // 听觉噪声系数
  noiseCoefSprint: 1.0,
  noiseCoefLunge: 1.5,
  suspicionAlert: 0.5,    // 进 alert 的累积阈值
  suspicionFlee: 1.0,     // 累积到该值直接逃
  suspicionDecay: 0.6,    // 离开感知后衰减 /s
  // A2 freeze / tremble 中间态
  freezeMin: 0.25,        // 冻结时长随机带 s
  freezeMax: 0.45,
  freezeBandMin: 0.6,     // 冻结触发距离带 = 潜行视觉半径的 60%–100%
  freezeBandMax: 1.0,
  // A3 近距离 zigzag 逃跑
  zigzagDistance: 10,     // 距离 < 该值启用（玩家 wind/lunge 时无条件启用）
  zigzagAngleMin: 35,     // 侧向偏角随机带（度）
  zigzagAngleMax: 60,
  zigzagPeriodMin: 0.28,  // 反转周期带 s（另叠加 ±20% 抖动）
  zigzagPeriodMax: 0.45,
  zigzagJitter: 0.2,
  zigzagSpeedFactor: 0.9, // zigzag 期间主速系数（≥0.85 防永远追不上）
  // A4 回避攻击终点（轨迹回避）
  evadeCurrentWeight: 0.4,// 逃离当前位置权重
  evadeLandingWeight: 0.6,// 逃离预测着陆点权重
  landingPredict: 0.7,    // 着陆点 = pos + dir × lungeSpeed × lungeTime × 该系数
  // B1 扑击 lead 提前量 + wind 限时重瞄
  leadLungeFraction: 0.45,// lead 时间 = wind 剩余 + lungeTime × 该系数
  windRetargetDeg: 12,    // wind 重瞄相对起始朝向的最大修正角（防自动瞄准）
  windRetargetFrac: 0.6,  // wind 前 60% 可重瞄，后 40% 锁定
  windRetargetDamp: 10,   // 重瞄缓转速率
  // B2 捕获垂直窗口
  catchFoxCenter: 0.45,   // 狐狸扑击命中中心相对足部高度
  catchVerticalTol: 0.8,  // 垂直容差 ±m
  preyCenterHeight: 0.45, // 猎物中心高 = 地形 + 该值（建议带 0.25–0.65）
  // E3 重生防贴脸
  respawnMinDist: 18,     // 重生点距玩家 ≥ m
  respawnViewDeg: 35,     // 且不在玩家视线中心 ±该角度 内
  respawnAttempts: 20,    // 尝试次数，全失败取最远候选
  // 追尾相机
  camDist: 5.2,
  camHeight: 2.3,
  camPitch: 0.32,
  camLookAhead: 2.2,
  camDamp: 12,
  // 第一人称视角（FPV；默认关闭，V 键 / 触屏视角按钮切换）
  fpvEyeHeight: 0.85,     // 眼位高度（相对狐狸脚底）
  fpvHeadForward: 0.45,   // 眼位沿视线前移（探出头腔）
  fpvPitchMin: -55,       // 俯仰夹紧（度）
  fpvPitchMax: 40,
  fpvMouseLook: 0.0026,   // FPV 鼠标灵敏度 rad/px
  fpvTouchLook: 0.0045,   // FPV 触屏拖拽灵敏度 rad/px
  fpvDefaultPitch: -6,    // 进入 FPV 时的初始俯仰（度）
  fpvPounceLockDamp: 7,   // 扑击时视线锁向扑击方向的阻尼（0=不锁）
  fpvPouncePitch: -10,    // 扑击锁定俯仰（度）
  camMinGround: 0.22,     // 相机离地最小高度
};

const PAF_CFG_KEY = 'm3d_paf_cfg_v1';
export function loadPafCfg() {
  try { const v = JSON.parse(localStorage.getItem(PAF_CFG_KEY) || '{}'); return (v && typeof v === 'object') ? v : {}; } catch { return {}; }
}
export function savePafCfg(patch) {
  try { localStorage.setItem(PAF_CFG_KEY, JSON.stringify({ ...loadPafCfg(), ...patch })); } catch { /* 隐私模式等：忽略 */ }
}
export function clearPafCfg() { try { localStorage.removeItem(PAF_CFG_KEY); } catch { /* ignore */ } }

function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
function damp(cur, target, lambda, dt) { return THREE.MathUtils.lerp(cur, target, 1 - Math.exp(-lambda * dt)); }

/** 猎物（AI 土拨鼠）。 */
class Prey {
  constructor(scene, x, z, colliders = null) {
    this.colliders = colliders;   // 岩石碰撞体 [{x,z,r}]，null 跳过推出
    this.mesh = createPafMoleModel({ color: 0xb3925a });
    this.x = x; this.z = z; this.vx = 0; this.vz = 0;
    this.yaw = Math.random() * Math.PI * 2;
    this.state = 'wander';          // wander | alert | freeze | flee（A2）
    this.timer = Math.random() * 2;
    this.caught = false;
    this.respawn = 0;
    this.bob = Math.random() * 10;
    this.suspicion = 0;             // A1 分级察觉累积值
    this.zz = { active: false, sign: 0, angle: 0, timer: 0 }; // A3 zigzag 相位
    this.trembleT = Math.random() * 10; // A2 冻结战栗视觉相位（不碰碰撞）
    scene.add(this.mesh);
    this._place(terrainHeight(x, z));

    // 警觉标记
    this.mark = document.createElement('div');
    this.mark.textContent = '!';
    this.mark.className = 'paf-alert';
    this.mark.style.cssText = 'position:absolute;transform:translate(-50%,-120%);color:#ffd24a;font-weight:900;font-size:22px;text-shadow:0 1px 3px #000;display:none;pointer-events:none;z-index:40';
  }
  _place(y) { this.mesh.position.set(this.x, y, this.z); this.mesh.rotation.y = this.yaw; }
  hide() {
    this.mesh.visible = false;
    this.mark.remove();
  }
  show(hudLayer) {
    if (this.caught) return;
    this.mesh.visible = true;
    hudLayer.appendChild(this.mark);
  }
  dispose(scene) {
    scene.remove(this.mesh);
    this.mark.remove();
  }
  respawnAt(bounds, fox, cfg) {
    // E3：距玩家 ≥ respawnMinDist、避开视线中心 ±respawnViewDeg；20 次失败取最远候选。
    const f = fox || { x: 0, z: 0, yaw: 0 };
    const pick = pickRespawnPoint(bounds, f, cfg || PAF_DEFAULTS, Math.random);
    this.x = pick.x; this.z = pick.z;
    pushOutCircles(this, (cfg || PAF_DEFAULTS).preyRadius ?? 0.4, this.colliders);
    this.vx = this.vz = 0;
    this.state = 'wander'; this.suspicion = 0; this.timer = Math.random() * 2;
    this.zz = { active: false, sign: 0, angle: 0, timer: 0 };
    this.caught = false;
    this.mesh.visible = true; this.mark.style.display = 'none';
    this._place(terrainHeight(this.x, this.z));
  }
  update(dt, fox, cam, hudLayer, bounds, cfg) {
    if (this.caught) {
      this.respawn -= dt;
      if (this.respawn <= 0) this.respawnAt(bounds, fox, cfg);
      return;
    }
    const toFoxX = fox.x - this.x, toFoxZ = fox.z - this.z;
    const dist = Math.hypot(toFoxX, toFoxZ) || 0.001;
    // A1：多线索察觉（距离衰减 × 视锥 × 速度/姿态 + 全向听觉；LOS 遮挡预留未接）
    const threatening = fox.phase === 'wind' || fox.phase === 'lunge';
    const mode = threatening ? CUE_MODE.LUNGE : fox.sprint ? CUE_MODE.SPRINT : CUE_MODE.STALK;
    const inCone = inViewCone(this.yaw, toFoxX, toFoxZ, deg2rad(cfg.visionHalfAngleDeg));
    const mind = stepPreyMind(
      { state: this.state, suspicion: this.suspicion, timer: this.timer },
      { dist, inCone, mode, threatening }, dt, cfg, Math.random);
    this.state = mind.state; this.suspicion = mind.suspicion; this.timer = mind.timer;

    let speed = 0;
    if (this.state === 'flee') {
      speed = fox.phase === 'lunge' ? cfg.preyBurst : cfg.preyFlee;
      // A4：wind/lunge 时逃离方向 = 逃离当前位置与预测着陆点的加权和
      let fleeYaw;
      if (threatening) {
        const threatYaw = fox.phase === 'lunge' ? fox.lungeYaw : fox.yaw;
        const land = predictLandingPoint(fox.x, fox.z, threatYaw, cfg);
        const ev = evadeVector(this.x, this.z, fox.x, fox.z, land.x, land.z, cfg);
        fleeYaw = ev.ok ? ev.yaw : yawTo(this.x - fox.x, this.z - fox.z);
      } else {
        fleeYaw = yawTo(this.x - fox.x, this.z - fox.z);
      }
      // A3：近距离或玩家 wind/lunge 时叠加周期性侧向偏角，远距保持直线
      this.zz = stepZigzag(this.zz, zigzagActive(dist, threatening, cfg), dt, cfg, Math.random);
      if (this.zz.active) {
        fleeYaw += this.zz.sign * this.zz.angle;
        speed *= cfg.zigzagSpeedFactor;
      }
      this.yaw = fleeYaw;
    } else if (this.state === 'wander') {
      speed = cfg.preyWander * 0.5;
      this.timer -= dt;
      if (this.timer <= 0) { this.yaw += (Math.random() - 0.5) * 2.2; this.timer = 1 + Math.random() * 2.5; }
      this.zz = stepZigzag(this.zz, false, dt, cfg, Math.random);
    } else if (this.state === 'freeze') {
      // A2：冻结——静止、头朝玩家；碰撞体不动（tremble 仅视觉，见下）
      speed = 0;
      this.vx = 0; this.vz = 0; // 真静止：不继承 alert/wander 的阻尼滑行
      this.yaw = yawTo(toFoxX, toFoxZ);
      this.zz = stepZigzag(this.zz, false, dt, cfg, Math.random);
    } else {
      // alert：原地警觉
      this.zz = stepZigzag(this.zz, false, dt, cfg, Math.random);
    }
    this.vx = damp(this.vx, Math.sin(this.yaw) * speed, this.state === 'flee' ? 9 : 4, dt);
    this.vz = damp(this.vz, Math.cos(this.yaw) * speed, this.state === 'flee' ? 9 : 4, dt);
    this.x += this.vx * dt; this.z += this.vz * dt;
    // 撞边界转向场内
    if (Math.abs(this.x) > bounds.hw - 1.5 || Math.abs(this.z) > bounds.hh - 1.5) {
      this.yaw = yawTo(-this.x, -this.z); this.state = 'wander'; this.suspicion = 0;
      this.x = clamp(this.x, -bounds.hw + 1.5, bounds.hw - 1.5);
      this.z = clamp(this.z, -bounds.hh + 1.5, bounds.hh - 1.5);
    }
    pushOutCircles(this, cfg.preyRadius ?? 0.4, this.colliders);
    const y = terrainHeight(this.x, this.z);
    this._place(y);
    this.mesh.rotation.y = this.yaw;
    // 奔跑轻微起伏
    if (speed > 0.5) { this.bob += dt * speed * 2.2; this.mesh.position.y = y + Math.abs(Math.sin(this.bob)) * 0.04; }
    // 模型姿态（纯视觉：wander/alert/flee 可读差异，不改 AI）
    this.mesh.setMoleState?.(this.state);
    this.mesh.updateAnim?.(dt, clamp(speed / cfg.preyFlee, 0, 1));
    // A2：freeze 战栗——只抖网格（位移/偏摆视觉量），逻辑 x/z 与碰撞不变
    if (this.state === 'freeze') {
      this.trembleT += dt * 46;
      const j = Math.sin(this.trembleT) * 0.018;
      this.mesh.position.x = this.x + j;
      this.mesh.rotation.z = j * 1.2;
    } else if (this.mesh.rotation.z) {
      this.mesh.rotation.z = 0;
    }

    // 警觉标记投影到屏幕（alert 与 freeze 期间持续显示）
    if (this.state === 'alert' || this.state === 'freeze') {
      const wp = new THREE.Vector3(this.x, y + 1.5, this.z).project(cam);
      if (wp.z < 1) {
        this.mark.style.display = 'block';
        this.mark.style.left = `${(wp.x * 0.5 + 0.5) * hudLayer.clientWidth}px`;
        this.mark.style.top = `${(-wp.y * 0.5 + 0.5) * hudLayer.clientHeight}px`;
      } else this.mark.style.display = 'none';
    } else this.mark.style.display = 'none';
  }
}

export function createPlayAsFox(ctx) {
  const { scene, camera, renderer, canvas, sky, onExit } = ctx;
  const binds = ctx.binds;
  const touchControls = ctx.touchControls;
  const isTouchMode = () => !!ctx.isTouchMode?.();
  const rockColliders = ctx.scenery?.rockColliders || null;
  const bounds = moveBounds(6);

  // 仅在后台模式下读取已保存的调参；普通玩家永远默认值。
  const debugOn = new URLSearchParams(location.search).get('pafdebug') === '1';
  const cfg = { ...PAF_DEFAULTS, ...(debugOn ? loadPafCfg() : {}) };

  // —— 玩家扮演的藏狐 ——
  const foxVisual = createPafFoxModel({});
  scene.add(foxVisual.group);
  // Camera-local fox forequarters. Rendering in the main pass with depth
  // disabled keeps the existing PAF/main render order unchanged.
  const fpvVisual = createPafFpvViewModel();
  camera.add(fpvVisual.root);
  const cameraWasInScene = camera.parent === scene;
  if (!camera.parent) scene.add(camera);
  const fox = {
    x: 0, z: -6, y: 0, yaw: 0, vy: 0,
    phase: 'idle',                 // idle | wind | lunge | recover
    phaseT: 0, sprint: false,
    lungeYaw: 0, airY: 0, windStartYaw: 0,
    get forward() { return { x: Math.sin(this.yaw), z: Math.cos(this.yaw) }; },
  };

  let prey = [];
  let score = 0;
  let elapsed = 0;
  let running = true;
  const keys = new Set();
  const pounceCharge = new PafPounceCharge();

  // —— 视角：默认第三人称；V 键 / 触屏按钮切第一人称（FPV 视线与身体朝向解耦）——
  const viewMode = createViewModeState('tps');
  const look = { yaw: 0, pitch: 0 };

  function spawnPoint() {
    const a = Math.random() * Math.PI * 2;
    const r = 7 + Math.random() * Math.min(bounds.hw, bounds.hh) * 0.72;
    return { x: Math.cos(a) * r, z: Math.sin(a) * r };
  }
  function addPrey() {
    const { x, z } = spawnPoint();
    const p = new Prey(scene, x, z, rockColliders);
    p.show(overlay);
    prey.push(p);
    return p;
  }

  // —— DOM 覆盖层 ——
  const overlay = document.createElement('div');
  overlay.id = 'playAsFoxHud';
  overlay.style.cssText = 'position:fixed;inset:0;z-index:45;pointer-events:none;font-family:inherit';
  if (!document.getElementById('playAsFoxStyle')) {
    const style = document.createElement('style');
    style.id = 'playAsFoxStyle';
    style.textContent = `
      body.play-as-fox #hudTop,
      body.play-as-fox #viewBtn,
      body.play-as-fox #objective,
      body.play-as-fox #crosshair,
      body.play-as-fox #kbSkillBar,
      body.play-as-fox #threatIndicator,
      body.play-as-fox #minimap,
      body.play-as-fox .minimap { display:none !important; }
      body.play-as-fox #overlay.overlay.on { display:none !important; }
      body.play-as-fox.touch-playing #touchControls { display:block; }
      /* 藏狐模式只保留藏狐语义的控件：土拨鼠专属动作键（啃草/爆发/大招）与
         主游戏暂停键在 PAF 下没有对应行为，必须隐藏，避免双套操作系统混显。 */
      body.play-as-fox [data-touch-action="interact"],
      body.play-as-fox [data-touch-action="burst"],
      body.play-as-fox [data-touch-action="ultimate"],
      body.play-as-fox [data-touch-action="pause"] { display:none !important; }
      /* 主游戏右上角帮助/全屏/设置按钮与「退出扮演」重叠，PAF 期间隐藏。 */
      body.play-as-fox #helpBtn,
      body.play-as-fox #fsBtn,
      body.play-as-fox #setBtn { display:none !important; }
      body.play-as-fox #touchLookZone span { font-size:0; }
      body.play-as-fox #touchLookZone span::after { content:'右侧拖动转向';font-size:10px; }
      body.play-as-fox #touchJoystick > span { font-size:0; }
      body.play-as-fox #touchJoystick > span::after { content:'移动 / 转向';font-size:10px; }
      body.play-as-fox [data-touch-action="attack"] .attack-swipe-ring { display:none; }
      body.play-as-fox [data-touch-action="attack"] .attack-core { background:radial-gradient(circle,#e9bd73,#a75d27); }
    `;
    document.head.appendChild(style);
  }
  document.body.classList.add('play-as-fox');
  overlay.innerHTML = `
    <div id="pafTop" style="position:absolute;top:12px;left:0;right:0;text-align:center;color:#ffe9c2;text-shadow:0 1px 4px #000;font-size:18px;font-weight:800"></div>
    <div id="pafTip" style="position:absolute;bottom:14px;left:0;right:0;text-align:center;color:#dfe8d6;text-shadow:0 1px 3px #000;font-size:13px;line-height:1.6"></div>
    <div id="pafCenter" style="position:absolute;left:50%;top:46%;transform:translate(-50%,-50%);color:#ffd24a;font-size:30px;font-weight:900;text-shadow:0 2px 6px #000;opacity:0;transition:opacity .15s"></div>
    <button id="pafExit" style="position:absolute;top:12px;right:14px;pointer-events:auto;padding:8px 14px;border-radius:10px;border:1px solid #6f7d5f;background:rgba(20,28,20,.72);color:#e7eedf;font-size:13px;cursor:pointer">退出扮演 (Esc)</button>
    <div id="pafViewTag">第三人称</div>
`;
  document.body.appendChild(overlay);
  const elTop = overlay.querySelector('#pafTop');
  const elTip = overlay.querySelector('#pafTip');
  const elCenter = overlay.querySelector('#pafCenter');
  overlay.querySelector('#pafExit').onclick = () => exit();

  // 藏起正常玩法里的玩家 / 敌狐 / 伙伴 / 第一人称爪子
  const hidden = [];
  const hideObj = (o) => { if (o && o.visible) { o.visible = false; hidden.push(o); } };
  hideObj(ctx.playerModel);
  (ctx.getFoxes ? ctx.getFoxes() : (ctx.foxes || [])).forEach((f) => hideObj(f.mesh));
  hideObj(ctx.companion?.group);

  // 生成猎物
  for (let i = 0; i < cfg.preyCount; i++) addPrey();

  function flash(text, color = '#ffd24a') {
    elCenter.textContent = text; elCenter.style.color = color;
    elCenter.style.opacity = '1';
    clearTimeout(flash._t); flash._t = setTimeout(() => { elCenter.style.opacity = '0'; }, 650);
  }

  // 视角切换：进入 FPV 时视线从当前身体朝向出发；退出无任何残留状态。
  const elViewTag = overlay.querySelector('#pafViewTag');
  const viewBtn = null;
  function setViewMode(mode, silent = false) {
    const m = viewMode.set(mode);
    if (m === 'fpv') {
      Object.assign(look, enterFpvLook(fox.yaw, cfg.fpvDefaultPitch));
      foxVisual.setHeadVisible?.(false);   // 眼位在头内：隐藏头部防糊屏，保留躯干（低头可见自身）
      fpvVisual.setVisible(true);
    } else {
      foxVisual.setHeadVisible?.(true);
      fpvVisual.setVisible(false);
    }
    overlay.classList.toggle('paf-fpv', m === 'fpv');
    if (elViewTag) elViewTag.textContent = m === 'fpv' ? '第一人称' : '第三人称';
    viewBtn?.classList.toggle('paf-on', m === 'fpv');
    if (!silent) flash(m === 'fpv' ? '第一人称视角' : '第三人称视角', '#9fd0ff');
    return m;
  }
  function toggleView() { setViewMode(viewMode.toggle()); return viewMode.mode; }

  function startPounce(fromTouch = false) {
    if (fox.phase !== 'idle') return false;
    if (fromTouch && !pounceCharge.press()) return false;
    if (!fromTouch) pounceCharge.reset();
    fox.phase = 'wind'; fox.phaseT = 0;
    fox.windStartYaw = fox.yaw;   // B1 重瞄护栏的基准朝向
    return true;
  }
  function catchPrey(p) {
    p.caught = true; p.respawn = cfg.respawnTime;
    p.mesh.visible = false; p.mark.style.display = 'none';
    score += 1;
    flash('捕获 +1', '#9fe6a0');
  }

  // —— 键鼠：玩家方案优先，藏狐原默认键兜底 ——
  const keyHeld = (actions, fallbacks) => pafKeyHeld(binds, keys, actions, fallbacks);
  const forwardHeld = () => keyHeld('forward', ['KeyW', 'ArrowUp']);
  const backHeld = () => keyHeld('back', ['KeyS', 'ArrowDown']);
  const leftHeld = () => keyHeld(['left', 'turnLeft'], ['KeyA', 'ArrowLeft']);
  const rightHeld = () => keyHeld(['right', 'turnRight'], ['KeyD', 'ArrowRight']);
  const sprintHeld = () => keyHeld('sprint', ['ShiftLeft', 'ShiftRight']);
  const onKeyDown = (e) => {
    if (e.repeat) return;
    keys.add(e.code);
    if (isPafKey(binds, e.code, 'attack', ['Space'])) {
      e.preventDefault();
      startPounce();
    }
    if (e.code.startsWith('Arrow')) e.preventDefault();
    if (e.code === 'KeyV') {
      // 主线 window keydown（bubble）也绑定 V=普通模式视角切换：本模式独占 V，阻断冒泡防串扰
      e.stopImmediatePropagation();
      toggleView();
    }
    if (e.code === 'Escape') exit();
  };
  const onKeyUp = (e) => keys.delete(e.code);
  const mouseSensitivityScale = (ctx.mouseSensitivity || 0.0022) / 0.0022;
  const onMouseMove = (e) => {
    if (document.pointerLockElement !== canvas) return;
    if (viewMode.mode === 'fpv') {
      // FPV：鼠标自由视角（pitch 夹紧），不动身体朝向
      // 鼠标右移 = 向右转（与正常模式 controls.js 的 yaw -= movementX 同号约定）
      applyLookDelta(look, -e.movementX, e.movementY, {
        sensitivity: cfg.fpvMouseLook, pitchMinDeg: cfg.fpvPitchMin, pitchMaxDeg: cfg.fpvPitchMax,
      });
    } else {
      fox.yaw -= e.movementX * cfg.mouseTurn * mouseSensitivityScale;
    }
  };
  const onMouseDown = (e) => {
    if (e.button === 0 && !touchControls?.controller?.touchEnabled) startPounce();
  };
  const onCanvasClick = () => {
    if (!touchControls?.controller?.touchEnabled && document.pointerLockElement !== canvas && ctx.requestLock) ctx.requestLock();
  };
  const onResize = () => { camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix(); };
  window.addEventListener('keydown', onKeyDown, true);   // capture：先于主线 bubble 监听拦 V
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('mousemove', onMouseMove);
  renderer.domElement.addEventListener('mousedown', onMouseDown);
  renderer.domElement.addEventListener('click', onCanvasClick);
  window.addEventListener('resize', onResize);

  // —— 触屏：复用主场景 TouchControls；PAF 仅接管共享事件输出 ——
  const isTouch = isTouchMode();
  const touch = { throttle: 0, turn: 0, sprint: false };
  const pafRoute = new PafInputRoute(touchControls);
  const touchAction = (action, pressed) => {
    if (action === 'attack') {
      if (pressed) startPounce(true);
      else pounceCharge.release();
    } else if (action === 'dodge') {
      touch.sprint = pressed;
    } else if (action === 'jump' && pressed) {
      toggleView();
    }
  };
  const onTouchLook = (delta) => {
    if (viewMode.mode === 'fpv') look.yaw += delta;
    else fox.yaw += delta;
  };
  const pafTouchLabelSnapshot = isTouch ? ['attack', 'dodge', 'jump'].map((action) => {
    const el = document.querySelector(`[data-touch-action="${action}"]`);
    return el ? { el, aria: el.getAttribute('aria-label'), b: el.querySelector('b')?.textContent || '', small: el.querySelector('small')?.textContent || '' } : null;
  }).filter(Boolean) : [];
  if (isTouch) {
    touchControls?.activate?.();
    pafRoute.activate({
      onAction: touchAction,
      onLook: onTouchLook,
      lookSensitivity: cfg.fpvTouchLook,
    });
    document.body.classList.add('paf-touch-route');
    const attack = document.querySelector('[data-touch-action="attack"]');
    const sprint = document.querySelector('[data-touch-action="dodge"]');
    const view = document.querySelector('[data-touch-action="jump"]');
    if (attack) { attack.dataset.pafLabel = 'attack'; attack.setAttribute('aria-label', '扑击：按住蓄力，松手扑出'); attack.querySelector('b')?.replaceChildren('爪'); attack.querySelector('small')?.replaceChildren('扑击'); }
    if (sprint) { sprint.dataset.pafLabel = 'sprint'; sprint.setAttribute('aria-label', '冲刺：按住冲刺'); sprint.querySelector('b')?.replaceChildren('⚡'); sprint.querySelector('small')?.replaceChildren('冲刺'); }
    if (view) { view.dataset.pafLabel = 'view'; view.setAttribute('aria-label', '视角：切换第一人称/第三人称'); view.querySelector('b')?.replaceChildren('◉'); view.querySelector('small')?.replaceChildren('视角'); }
  }

  // 镜头先就位
  fox.y = terrainHeight(fox.x, fox.z);
  foxVisual.group.position.set(fox.x, fox.y, fox.z);

  function respawnAll(count) {
    const n = Math.max(0, Math.min(40, Math.round(count) || 0));
    for (const p of prey) p.dispose(scene);
    prey = [];
    for (let i = 0; i < n; i++) addPrey();
    flash(`猎物 ×${n}`, '#9fd0ff');
  }

  function update(dt) {
    if (!running) return;
    elapsed += dt;
    const keyboardSprint = sprintHeld();
    const axes = pafRoute.controller?.touchAxes || { x: 0, y: 0 };
    touch.turn = -axes.x;
    touch.throttle = axes.y;
    fox.sprint = keyboardSprint || touch.sprint || !!pafRoute.controller?.touchSprint;
    fox.stalk = !fox.sprint;

    // 相位推进
    if (fox.phase === 'wind') {
      fox.phaseT += dt;
      // B1：wind 前 60% 对最近猎物做 lead 预测并允许 ≤windRetargetDeg 的缓慢重瞄，后 40% 锁定
      const live = prey.filter((p) => !p.caught).map((p) => ({ x: p.x, z: p.z, vx: p.vx, vz: p.vz }));
      const near = nearestTarget(fox.x, fox.z, live);
      if (near) {
        const t = near.target;
        const leadT = windLeadTime(Math.max(0, cfg.windTime - fox.phaseT), cfg);
        const aim = leadTarget(t.x, t.z, t.vx, t.vz, leadT);
        const desired = yawTo(aim.x - fox.x, aim.z - fox.z);
        fox.yaw = retargetWindYaw({
          startYaw: fox.windStartYaw, yaw: fox.yaw, desiredYaw: desired,
          progress: Math.min(fox.phaseT, cfg.windTime) / cfg.windTime, dt,
        }, cfg);
      }
      const charge = pounceCharge.step(dt, cfg.windTime, cfg.pounceMaxCharge);
      if ((pounceCharge.active && charge.shouldLunge) || (!pounceCharge.active && fox.phaseT >= cfg.windTime)) {
        pounceCharge.reset();
        fox.phase = 'lunge'; fox.phaseT = 0; fox.lungeYaw = fox.yaw;
      }
    } else if (fox.phase === 'lunge') {
      fox.phaseT += dt;
      const t = fox.phaseT / cfg.lungeTime;
      fox.x += Math.sin(fox.lungeYaw) * cfg.lungeSpeed * dt;
      fox.z += Math.cos(fox.lungeYaw) * cfg.lungeSpeed * dt;
      fox.airY = Math.sin(clamp(t, 0, 1) * Math.PI) * cfg.lungeHeight;
      if (fox.phaseT >= cfg.lungeTime) { fox.phase = 'recover'; fox.phaseT = 0; fox.airY = 0; }
    } else if (fox.phase === 'recover') {
      fox.phaseT += dt;
      if (fox.phaseT >= cfg.recoverTime) fox.phase = 'idle';
    }

    // 常规移动 / 转向（蓄力与扑击中锁向）
    const canSteer = fox.phase === 'idle' || fox.phase === 'recover';
    let turn = touch.turn;
    if (canSteer) {
      if (leftHeld()) turn += 1;
      if (rightHeld()) turn -= 1;
      fox.yaw += turn * cfg.turnRate * dt;
    }
    let throttle = touch.throttle;
    if (fox.phase === 'idle') {
      if (forwardHeld()) throttle += 1;
      if (backHeld()) throttle -= cfg.reverseSpeed;
      throttle = clamp(throttle, -cfg.reverseSpeed, 1);
      const sp = fox.sprint ? cfg.runSpeed : cfg.stalkSpeed;
      fox.x += Math.sin(fox.yaw) * sp * throttle * dt;
      fox.z += Math.cos(fox.yaw) * sp * throttle * dt;
    }
    fox.x = clamp(fox.x, -bounds.hw, bounds.hw);
    fox.z = clamp(fox.z, -bounds.hh, bounds.hh);
    pushOutCircles(fox, cfg.foxRadius ?? 0.5, rockColliders);

    const groundY = terrainHeight(fox.x, fox.z);
    fox.y = groundY + fox.airY;
    foxVisual.group.position.set(fox.x, fox.y, fox.z);
    foxVisual.group.rotation.y = fox.yaw;
    // 姿态：分组混合（模型内部：body 下移/后躯下压/腿折弯/头补偿），替代旧的 scale.y 压扁
    const animName = fox.phase !== 'idle' ? fox.phase
      : throttle !== 0 ? (fox.sprint ? 'dash' : 'stalk') : 'idle';
    const groundSpeed = fox.phase === 'lunge' ? cfg.lungeSpeed
      : Math.abs(throttle) * (fox.sprint ? cfg.runSpeed : cfg.stalkSpeed);
    try {
      foxVisual.setAnimState?.({ anim: animName, speed: groundSpeed });
      foxVisual.update?.(dt);
    } catch (_) {}

    // 猎物
    for (const p of prey) {
      p.update(dt, fox, camera, overlay, bounds, cfg);
      // 扑击激活帧判定捕获（水平接近）
      if (!p.caught && fox.phase === 'lunge') {
        // B2：水平半径 + 垂直窗口同时满足；腾空越过头顶不再"吸"中
        const preyTerrainY = terrainHeight(p.x, p.z);
        if (canCatch(p.x - fox.x, p.z - fox.z, fox.airY, preyTerrainY, cfg, groundY)) catchPrey(p);
      }
    }

    // 天空球跟随
    sky?.update?.({ x: fox.x, y: fox.y, z: fox.z }, dt);

    // —— 相机：默认第三人称追尾（原口径不变）；FPV 视线与身体朝向解耦 ——
    if (viewMode.mode === 'fpv') {
      // 扑击期间视线柔和锁向扑击方向（阻尼回正，不瞬移）
      if (fox.phase === 'wind' || fox.phase === 'lunge') {
        const targetYaw = fox.phase === 'lunge' ? fox.lungeYaw : fox.yaw;
        dampLookToward(look, targetYaw, cfg.fpvPouncePitch, cfg.fpvPounceLockDamp, dt);
      }
      const pose = fpvCameraPose(fox, look, cfg, groundY);
      camera.position.set(pose.pos.x, pose.pos.y, pose.pos.z);
      camera.lookAt(pose.lookAt.x, pose.lookAt.y, pose.lookAt.z);
    } else {
      const pose = tpsCameraPose(fox, cfg);
      camera.position.x = damp(camera.position.x, pose.pos.x, cfg.camDamp, dt);
      camera.position.z = damp(camera.position.z, pose.pos.z, cfg.camDamp, dt);
      camera.position.y = damp(camera.position.y, pose.pos.y, cfg.camDamp, dt);
      camera.lookAt(pose.lookAt.x, pose.lookAt.y, pose.lookAt.z);
    }
    fpvVisual.update(dt, {
      phase: fox.phase, speed: groundSpeed, pitch: look.pitch,
      phaseT: fox.phaseT, sprint: fox.sprint,
    });

    // HUD
    elTop.textContent = `扮演藏狐 · 捕猎 ${score} 只 · ${elapsed.toFixed(0)}s`;
    const phaseLabel = fox.phase === 'wind' ? '蓄力中…' : fox.phase === 'lunge' ? '扑击！' : fox.phase === 'recover' ? '硬直' : fox.sprint ? '冲刺（易被发现）' : '潜行';
    const chargeHint = pounceCharge.active
      ? ` · 蓄力 ${Math.round(Math.min(1, fox.phaseT / Math.max(cfg.windTime, cfg.pounceMaxCharge)) * 100)}%` : '';
    elTip.innerHTML = isTouch
      ? `左下摇杆移动/转向 · <b>冲刺</b>切换潜行 · <b>扑击</b>捕猎（按住蓄力，松手扑出）（${phaseLabel}）${chargeHint}`
      : `W/S 前后 · 鼠标或 A/D 转向 · <b>Shift</b> 冲刺潜行切换 · <b>空格/左键</b> 扑击 · <b>V</b> 切换视角（${phaseLabel}）${chargeHint}`;
  }

  function exit() {
    if (!running) return;
    running = false;
    if (typeof window !== 'undefined' && window.__playAsFox === qa) window.__playAsFox = null;
    window.removeEventListener('keydown', onKeyDown, true);
    window.removeEventListener('keyup', onKeyUp);
    window.removeEventListener('mousemove', onMouseMove);
    renderer.domElement.removeEventListener('mousedown', onMouseDown);
    renderer.domElement.removeEventListener('click', onCanvasClick);
    window.removeEventListener('resize', onResize);
    pounceCharge.reset();
    pafRoute.restore();
    for (const item of pafTouchLabelSnapshot) { item.el.setAttribute('aria-label', item.aria || ''); if (item.el.querySelector('b')) item.el.querySelector('b').textContent = item.b; if (item.el.querySelector('small')) item.el.querySelector('small').textContent = item.small; delete item.el.dataset.pafLabel; }
    document.body.classList.remove('paf-touch-route');
    touch.throttle = 0; touch.turn = 0; touch.sprint = false;
    keys.clear();
    for (const p of prey) p.dispose(scene);
    prey = [];
    scene.remove(foxVisual.group);
    camera.remove(fpvVisual.root);
    if (!cameraWasInScene && camera.parent === scene) scene.remove(camera);
    overlay.remove();
    document.body.classList.remove('play-as-fox');
    hidden.forEach((o) => { o.visible = true; });
    if (document.pointerLockElement === canvas && document.exitPointerLock) document.exitPointerLock();
    onExit?.({ score, elapsed });
  }

  const api = { update, exit, get active() { return running; } };
  // QA / 调试钩子（beta）。teleport 仅供自动化；cfg/add/remove/respawn 供后台。
  function qaTeleport(x, z, yaw) {
    fox.x = x; fox.z = z; fox.airY = 0;
    if (Number.isFinite(yaw)) fox.yaw = yaw;
    fox.y = terrainHeight(fox.x, fox.z);
  }
  const qa = {
    get active() { return running; },
    get score() { return score; },
    get elapsed() { return elapsed; },
    get phase() { return fox.phase; },
    get sprint() { return fox.sprint; },
    get stalk() { return !fox.sprint; },
    get input() { return { touch: { ...touch }, charging: pounceCharge.active, chargeHeld: pounceCharge.held, crouchScale: foxVisual.group.scale.y }; },
    get pos() { return { x: fox.x, y: fox.y, z: fox.z, yaw: fox.yaw, airY: fox.airY }; },
    get prey() { return prey; },
    get bounds() { return { hw: bounds.hw, hh: bounds.hh }; },
    cfg,
    config: cfg,
    defaults: PAF_DEFAULTS,
    teleport: qaTeleport,
    addPrey: () => addPrey(),
    removePrey: () => { const p = prey.pop(); if (p) p.dispose(scene); return prey.length; },
    respawnAll: (n) => respawnAll(Number.isFinite(n) ? n : cfg.preyCount),
    resetTuning: () => { Object.keys(PAF_DEFAULTS).forEach((k) => { cfg[k] = PAF_DEFAULTS[k]; }); },
    get terrainHeightAt() { return (x, z) => terrainHeight(x, z); },
    get viewMode() { return viewMode.mode; },
    get look() { return { yaw: look.yaw, pitch: look.pitch }; },
    get fpvVisual() { return fpvVisual.getDebugState(); },
    toggleView,
    setViewMode: (m) => setViewMode(m),
    // 仅供自动化 QA：直接设置 FPV 视线（仍过俯仰夹紧）
    setLook: (yaw, pitch) => {
      if (Number.isFinite(yaw)) look.yaw = yaw;
      if (Number.isFinite(pitch)) {
        look.pitch = clamp(pitch, cfg.fpvPitchMin * Math.PI / 180, cfg.fpvPitchMax * Math.PI / 180);
      }
    },
  };
  // 自动化仅在显式 ?pafqa=1 时开放固定步长；普通玩家无此入口、无额外模块/几何体。
  if (new URLSearchParams(location.search).get('pafqa') === '1') {
    qa.step = (dt = 1 / 60) => update(Math.max(0, Math.min(0.05, dt)));
  }
  if (typeof window !== 'undefined') window.__playAsFox = qa;
  return api;
}
