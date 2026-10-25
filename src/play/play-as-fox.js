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
import { createProceduralFox } from '../entities/procedural-fox.js';
import { buildMarmotMesh } from '../entities/props_entities.js';
import { terrainHeight } from '../core/utils.js';
import { moveBounds } from '../core/config.js';
import {
  CUE_MODE, deg2rad, yawTo, inViewCone, stepPreyMind, stepZigzag, zigzagActive,
  predictLandingPoint, evadeVector, canCatch, pickRespawnPoint,
  nearestTarget, leadTarget, windLeadTime, retargetWindYaw,
} from '../core/predator-prey.js';

/** 扮演藏狐模式全部可调平衡数值（后台滑块直接改这里的运行时副本）。 */
export const PAF_DEFAULTS = {
  // 玩家移动
  stalkSpeed: 2.5,        // 潜行速度 m/s
  runSpeed: 6.4,          // 冲刺速度 m/s
  reverseSpeed: 0.55,     // 后退相对速度
  turnRate: 2.6,          // 键盘转向 rad/s
  mouseTurn: 0.0024,      // 鼠标每像素转向
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
  constructor(scene, x, z) {
    this.mesh = buildMarmotMesh(0xb3925a);
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
    const y = terrainHeight(this.x, this.z);
    this._place(y);
    this.mesh.rotation.y = this.yaw;
    // 奔跑轻微起伏
    if (speed > 0.5) { this.bob += dt * speed * 2.2; this.mesh.position.y = y + Math.abs(Math.sin(this.bob)) * 0.04; }
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
  const bounds = moveBounds(6);

  // 仅在后台模式下读取已保存的调参；普通玩家永远默认值。
  const debugOn = new URLSearchParams(location.search).get('pafdebug') === '1';
  const cfg = { ...PAF_DEFAULTS, ...(debugOn ? loadPafCfg() : {}) };

  // —— 玩家扮演的藏狐 ——
  const foxVisual = createProceduralFox({});
  scene.add(foxVisual.group);
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

  function spawnPoint() {
    const a = Math.random() * Math.PI * 2;
    const r = 7 + Math.random() * Math.min(bounds.hw, bounds.hh) * 0.72;
    return { x: Math.cos(a) * r, z: Math.sin(a) * r };
  }
  function addPrey() {
    const { x, z } = spawnPoint();
    const p = new Prey(scene, x, z);
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
      body.play-as-fox #touchControls,
      body.play-as-fox #threatIndicator,
      body.play-as-fox #minimap,
      body.play-as-fox .minimap { display:none !important; }
      body.play-as-fox #overlay.overlay.on { display:none !important; }
      #playAsFoxHud #pafTouch { position:absolute;inset:0;pointer-events:none;display:none }
      #playAsFoxHud.paf-touch #pafTouch { display:block }
      #pafStick { position:absolute;left:34px;bottom:46px;width:132px;height:132px;border-radius:50%;
        background:rgba(30,40,28,.32);border:2px solid rgba(220,235,205,.35);pointer-events:auto;touch-action:none }
      #pafKnob { position:absolute;left:50%;top:50%;width:58px;height:58px;margin:-29px 0 0 -29px;border-radius:50%;
        background:rgba(225,238,205,.55);border:2px solid rgba(255,255,255,.5);pointer-events:none }
      #pafBtns { position:absolute;right:26px;bottom:46px;display:flex;flex-direction:column;gap:16px;align-items:center;pointer-events:none }
      #pafBtns button { pointer-events:auto;touch-action:none;border:none;cursor:pointer;color:#f4f3e6;
        font-weight:800;font-size:16px;border-radius:50%;box-shadow:0 3px 10px rgba(0,0,0,.35) }
      #pafPounce { width:92px;height:92px;background:radial-gradient(circle at 35% 30%,#d98a4a,#9c5320) }
      #pafSprint { width:68px;height:68px;background:radial-gradient(circle at 35% 30%,#7c8f63,#48552f);font-size:14px }
      #pafSprint.paf-on { outline:3px solid #ffe08a }
    `;
    document.head.appendChild(style);
  }
  document.body.classList.add('play-as-fox');
  overlay.innerHTML = `
    <div id="pafTop" style="position:absolute;top:12px;left:0;right:0;text-align:center;color:#ffe9c2;text-shadow:0 1px 4px #000;font-size:18px;font-weight:800"></div>
    <div id="pafTip" style="position:absolute;bottom:14px;left:0;right:0;text-align:center;color:#dfe8d6;text-shadow:0 1px 3px #000;font-size:13px;line-height:1.6"></div>
    <div id="pafCenter" style="position:absolute;left:50%;top:46%;transform:translate(-50%,-50%);color:#ffd24a;font-size:30px;font-weight:900;text-shadow:0 2px 6px #000;opacity:0;transition:opacity .15s"></div>
    <button id="pafExit" style="position:absolute;top:12px;right:14px;pointer-events:auto;padding:8px 14px;border-radius:10px;border:1px solid #6f7d5f;background:rgba(20,28,20,.72);color:#e7eedf;font-size:13px;cursor:pointer">退出扮演 (Esc)</button>
    <div id="pafTouch">
      <div id="pafStick"><div id="pafKnob"></div></div>
      <div id="pafBtns">
        <button id="pafSprint" type="button">冲刺</button>
        <button id="pafPounce" type="button">扑击</button>
      </div>
    </div>`;
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

  function startPounce() {
    if (fox.phase !== 'idle') return;
    fox.phase = 'wind'; fox.phaseT = 0;
    fox.windStartYaw = fox.yaw;   // B1 重瞄护栏的基准朝向
  }
  function catchPrey(p) {
    p.caught = true; p.respawn = cfg.respawnTime;
    p.mesh.visible = false; p.mark.style.display = 'none';
    score += 1;
    flash('捕获 +1', '#9fe6a0');
  }

  // —— 输入 ——
  const onKeyDown = (e) => {
    if (e.repeat) return;
    keys.add(e.code);
    if (e.code === 'Space') { e.preventDefault(); startPounce(); }
    if (e.code === 'Escape') exit();
  };
  const onKeyUp = (e) => keys.delete(e.code);
  const onMouseMove = (e) => {
    if (document.pointerLockElement === canvas) fox.yaw += e.movementX * cfg.mouseTurn;
  };
  const onMouseDown = (e) => { if (e.button === 0) startPounce(); };
  const onCanvasClick = () => { if (document.pointerLockElement !== canvas && ctx.requestLock) ctx.requestLock(); };
  const onResize = () => { camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix(); };
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('mousemove', onMouseMove);
  renderer.domElement.addEventListener('mousedown', onMouseDown);
  renderer.domElement.addEventListener('click', onCanvasClick);
  window.addEventListener('resize', onResize);

  // —— 触屏：左下摇杆（上下=前后，左右=转向），右下扑击/冲刺 ——
  const isTouch = (navigator.maxTouchPoints || 0) > 0 || 'ontouchstart' in window;
  const touch = { throttle: 0, turn: 0, sprint: false };
  const stick = overlay.querySelector('#pafStick');
  const knob = overlay.querySelector('#pafKnob');
  const sprintBtn = overlay.querySelector('#pafSprint');
  const pounceBtn = overlay.querySelector('#pafPounce');
  if (isTouch) overlay.classList.add('paf-touch');
  let stickId = null;
  const setKnob = (dx = 0, dy = 0) => { knob.style.transform = `translate(${dx}px,${dy}px)`; };
  const stickVec = (clientX, clientY) => {
    const r = stick.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    let dx = clientX - cx, dy = clientY - cy;
    const max = r.width * 0.36, len = Math.hypot(dx, dy);
    if (len > max) { dx = dx / len * max; dy = dy / len * max; }
    setKnob(dx, dy);
    const nx = dx / max, ny = dy / max;      // 屏幕上为负 y
    const dead = 0.18;
    touch.turn = Math.abs(nx) > dead ? -nx : 0;     // 向右拖→顺时针右转
    touch.throttle = Math.abs(ny) > dead ? -ny : 0; // 向上拖→前进
  };
  const onStickDown = (e) => { e.preventDefault(); stickId = e.pointerId; stick.setPointerCapture?.(e.pointerId); stickVec(e.clientX, e.clientY); };
  const onStickMove = (e) => { if (stickId !== e.pointerId) return; e.preventDefault(); stickVec(e.clientX, e.clientY); };
  const onStickUp = (e) => { if (stickId !== null && e.pointerId !== stickId) return; stickId = null; touch.throttle = 0; touch.turn = 0; setKnob(0, 0); };
  const setSprint = (on) => { touch.sprint = on; sprintBtn?.classList.toggle('paf-on', on); };
  stick?.addEventListener('pointerdown', onStickDown);
  stick?.addEventListener('pointermove', onStickMove);
  stick?.addEventListener('pointerup', onStickUp);
  stick?.addEventListener('pointercancel', onStickUp);
  pounceBtn?.addEventListener('pointerdown', (e) => { e.preventDefault(); startPounce(); });
  sprintBtn?.addEventListener('pointerdown', (e) => { e.preventDefault(); setSprint(true); });
  sprintBtn?.addEventListener('pointerup', () => setSprint(false));
  sprintBtn?.addEventListener('pointercancel', () => setSprint(false));
  sprintBtn?.addEventListener('pointerleave', () => setSprint(false));

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
    fox.sprint = touch.sprint || keys.has('ShiftLeft') || keys.has('ShiftRight');

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
      if (fox.phaseT >= cfg.windTime) { fox.phase = 'lunge'; fox.phaseT = 0; fox.lungeYaw = fox.yaw; }
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
      if (keys.has('KeyA') || keys.has('ArrowLeft')) turn += 1;
      if (keys.has('KeyD') || keys.has('ArrowRight')) turn -= 1;
      fox.yaw += turn * cfg.turnRate * dt;
    }
    let throttle = touch.throttle;
    if (fox.phase === 'idle') {
      if (keys.has('KeyW') || keys.has('ArrowUp')) throttle += 1;
      if (keys.has('KeyS') || keys.has('ArrowDown')) throttle -= cfg.reverseSpeed;
      throttle = clamp(throttle, -cfg.reverseSpeed, 1);
      const sp = fox.sprint ? cfg.runSpeed : cfg.stalkSpeed;
      fox.x += Math.sin(fox.yaw) * sp * throttle * dt;
      fox.z += Math.cos(fox.yaw) * sp * throttle * dt;
    }
    fox.x = clamp(fox.x, -bounds.hw, bounds.hw);
    fox.z = clamp(fox.z, -bounds.hh, bounds.hh);

    const groundY = terrainHeight(fox.x, fox.z);
    fox.y = groundY + fox.airY;
    foxVisual.group.position.set(fox.x, fox.y, fox.z);
    foxVisual.group.rotation.y = fox.yaw;
    // 蹲伏（潜行/蓄力）：以足部为原点整体压低头；扑击/蓄力做整组俯仰
    const crouchAmt = (fox.phase === 'wind') ? 0.72 : (!fox.sprint && throttle !== 0 && fox.phase === 'idle') ? 0.9 : 1;
    foxVisual.group.scale.set(1, crouchAmt, 1);
    if (fox.phase === 'lunge') foxVisual.group.rotation.x = -0.3;
    else if (fox.phase === 'wind') foxVisual.group.rotation.x = 0.32;
    else foxVisual.group.rotation.x = damp(foxVisual.group.rotation.x, 0, 10, dt);
    try { foxVisual.update?.(dt); } catch (_) {}

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

    // 第三人称追尾相机
    const fwd = fox.forward;
    const tx = fox.x - fwd.x * cfg.camDist;
    const tz = fox.z - fwd.z * cfg.camDist;
    camera.position.x = damp(camera.position.x, tx, cfg.camDamp, dt);
    camera.position.z = damp(camera.position.z, tz, cfg.camDamp, dt);
    const camY = fox.y + cfg.camHeight + cfg.camPitch * 1.4;
    camera.position.y = damp(camera.position.y, camY, cfg.camDamp, dt);
    camera.lookAt(fox.x + fwd.x * cfg.camLookAhead, fox.y + 0.9, fox.z + fwd.z * cfg.camLookAhead);

    // HUD
    elTop.textContent = `扮演藏狐 · 捕猎 ${score} 只 · ${elapsed.toFixed(0)}s`;
    const phaseLabel = fox.phase === 'wind' ? '蓄力中…' : fox.phase === 'lunge' ? '扑击！' : fox.phase === 'recover' ? '硬直' : fox.sprint ? '冲刺（易被发现）' : '潜行';
    elTip.innerHTML = isTouch
      ? `左下摇杆移动/转向 · <b>冲刺</b>切换潜行 · <b>扑击</b>捕猎（${phaseLabel}）`
      : `W/S 前后 · 鼠标或 A/D 转向 · <b>Shift</b> 冲刺潜行切换 · <b>空格/左键</b> 扑击（${phaseLabel}）`;
  }

  function exit() {
    if (!running) return;
    running = false;
    if (typeof window !== 'undefined' && window.__playAsFox === qa) window.__playAsFox = null;
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
    window.removeEventListener('mousemove', onMouseMove);
    renderer.domElement.removeEventListener('mousedown', onMouseDown);
    renderer.domElement.removeEventListener('click', onCanvasClick);
    window.removeEventListener('resize', onResize);
    stick?.removeEventListener('pointerdown', onStickDown);
    stick?.removeEventListener('pointermove', onStickMove);
    stick?.removeEventListener('pointerup', onStickUp);
    stick?.removeEventListener('pointercancel', onStickUp);
    for (const p of prey) p.dispose(scene);
    prey = [];
    scene.remove(foxVisual.group);
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
  };
  // 自动化仅在显式 ?pafqa=1 时开放固定步长；普通玩家无此入口、无额外模块/几何体。
  if (new URLSearchParams(location.search).get('pafqa') === '1') {
    qa.step = (dt = 1 / 60) => update(Math.max(0, Math.min(0.05, dt)));
  }
  if (typeof window !== 'undefined') window.__playAsFox = qa;
  return api;
}
