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
 *    扑击激活帧内水平重叠即捕获土拨鼠；扑完有硬直。
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
  detectStalk: 6.2,       // 潜行时被察觉半径
  detectSprint: 11.5,     // 冲刺时被察觉半径
  detectLunge: 17.0,      // 扑击瞬间被察觉半径
  alertTime: 0.32,        // 警觉停留 s 后开始逃
  fleeCommit: 0.55,       // 距离近于 察觉半径*该比例 立即逃
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
  constructor(scene, x, z) {
    this.mesh = createPafMoleModel({ color: 0xb3925a });
    this.x = x; this.z = z; this.vx = 0; this.vz = 0;
    this.yaw = Math.random() * Math.PI * 2;
    this.state = 'wander';          // wander | alert | flee
    this.timer = Math.random() * 2;
    this.caught = false;
    this.respawn = 0;
    this.bob = Math.random() * 10;
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
  respawnAt(bounds) {
    const a = Math.random() * Math.PI * 2;
    const r = 8 + Math.random() * Math.min(bounds.hw, bounds.hh) * 0.7;
    this.x = clamp(Math.cos(a) * r, -bounds.hw + 2, bounds.hw - 2);
    this.z = clamp(Math.sin(a) * r, -bounds.hh + 2, bounds.hh - 2);
    this.vx = this.vz = 0; this.state = 'wander'; this.caught = false;
    this.mesh.visible = true; this.mark.style.display = 'none';
    this._place(terrainHeight(this.x, this.z));
  }
  update(dt, fox, cam, hudLayer, bounds, cfg) {
    if (this.caught) {
      this.respawn -= dt;
      if (this.respawn <= 0) this.respawnAt(bounds);
      return;
    }
    const dx = this.x - fox.x, dz = this.z - fox.z;
    const dist = Math.hypot(dx, dz) || 0.001;
    // 察觉半径：潜行近、冲刺远、扑击最远
    const pouncing = fox.phase === 'lunge';
    const detect = pouncing ? cfg.detectLunge : fox.sprint ? cfg.detectSprint : cfg.detectStalk;
    if (dist < detect) {
      if (this.state === 'wander') { this.state = 'alert'; this.timer = cfg.alertTime; }
      else if (this.state === 'alert') { this.timer -= dt; if (this.timer <= 0 || dist < detect * cfg.fleeCommit) this.state = 'flee'; }
      if (pouncing) this.state = 'flee';
    } else if (this.state !== 'wander' && dist > detect + 4) {
      this.state = 'wander'; this.timer = Math.random() * 2;
    }

    let speed = 0;
    if (this.state === 'flee') {
      speed = pouncing ? cfg.preyBurst : cfg.preyFlee;
      this.yaw = Math.atan2(dx, dz);           // 径直逃离狐狸
    } else if (this.state === 'wander') {
      speed = cfg.preyWander * 0.5;
      this.timer -= dt;
      if (this.timer <= 0) { this.yaw += (Math.random() - 0.5) * 2.2; this.timer = 1 + Math.random() * 2.5; }
    }
    this.vx = damp(this.vx, Math.sin(this.yaw) * speed, this.state === 'flee' ? 9 : 4, dt);
    this.vz = damp(this.vz, Math.cos(this.yaw) * speed, this.state === 'flee' ? 9 : 4, dt);
    this.x += this.vx * dt; this.z += this.vz * dt;
    // 撞边界转向场内
    if (Math.abs(this.x) > bounds.hw - 1.5 || Math.abs(this.z) > bounds.hh - 1.5) {
      this.yaw = Math.atan2(-this.x, -this.z); this.state = 'wander';
      this.x = clamp(this.x, -bounds.hw + 1.5, bounds.hw - 1.5);
      this.z = clamp(this.z, -bounds.hh + 1.5, bounds.hh - 1.5);
    }
    const y = terrainHeight(this.x, this.z);
    this._place(y);
    this.mesh.rotation.y = this.yaw;
    // 奔跑轻微起伏
    if (speed > 0.5) { this.bob += dt * speed * 2.2; this.mesh.position.y = y + Math.abs(Math.sin(this.bob)) * 0.04; }
    // 模型姿态（纯视觉：wander/alert/flee 可读差异，不改 AI）
    this.mesh.setMoleState?.(this.state);
    this.mesh.updateAnim?.(dt, clamp(speed / cfg.preyFlee, 0, 1));

    // 警觉标记投影到屏幕
    if (this.state === 'alert') {
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
    lungeYaw: 0, airY: 0,
    get forward() { return { x: Math.sin(this.yaw), z: Math.cos(this.yaw) }; },
  };

  let prey = [];
  let score = 0;
  let elapsed = 0;
  let running = true;
  const keys = new Set();

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
      #pafView { width:68px;height:68px;background:radial-gradient(circle at 35% 30%,#6f86a8,#3d4c66);font-size:14px }
      #pafView.paf-on { outline:3px solid #9fd0ff }
      #pafViewTag { position:absolute;top:12px;left:14px;padding:4px 10px;border-radius:8px;
        background:rgba(20,28,20,.62);color:#cfe0bd;border:1px solid #55654a;font-size:12px;
        font-weight:700;letter-spacing:.05em }
      #playAsFoxHud.paf-fpv #pafViewTag { color:#9fd0ff;border-color:#5b7391 }
      #pafLook { position:absolute;right:0;top:0;bottom:0;width:52%;pointer-events:none;touch-action:none }
      #playAsFoxHud.paf-fpv.paf-touch #pafLook { pointer-events:auto }
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
    <div id="pafTouch">
      <div id="pafLook"></div>
      <div id="pafStick"><div id="pafKnob"></div></div>
      <div id="pafBtns">
        <button id="pafView" type="button">视角</button>
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

  // 视角切换：进入 FPV 时视线从当前身体朝向出发；退出无任何残留状态。
  const elViewTag = overlay.querySelector('#pafViewTag');
  const viewBtn = overlay.querySelector('#pafView');
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

  function startPounce() {
    if (fox.phase !== 'idle') return;
    fox.phase = 'wind'; fox.phaseT = 0;
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
    if (e.code === 'KeyV') {
      // 主线 window keydown（bubble）也绑定 V=普通模式视角切换：本模式独占 V，阻断冒泡防串扰
      e.stopImmediatePropagation();
      toggleView();
    }
    if (e.code === 'Escape') exit();
  };
  const onKeyUp = (e) => keys.delete(e.code);
  const onMouseMove = (e) => {
    if (document.pointerLockElement !== canvas) return;
    if (viewMode.mode === 'fpv') {
      // FPV：鼠标自由视角（pitch 夹紧），不动身体朝向
      applyLookDelta(look, e.movementX, e.movementY, {
        sensitivity: cfg.fpvMouseLook, pitchMinDeg: cfg.fpvPitchMin, pitchMaxDeg: cfg.fpvPitchMax,
      });
    } else {
      fox.yaw += e.movementX * cfg.mouseTurn;
    }
  };
  const onMouseDown = (e) => { if (e.button === 0) startPounce(); };
  const onCanvasClick = () => { if (document.pointerLockElement !== canvas && ctx.requestLock) ctx.requestLock(); };
  const onResize = () => { camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix(); };
  window.addEventListener('keydown', onKeyDown, true);   // capture：先于主线 bubble 监听拦 V
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
  // 触屏 FPV 自由视角：右半屏拖拽（#pafLook 仅 FPV+触屏时接管指针）
  const lookArea = overlay.querySelector('#pafLook');
  let lookId = null, lookLast = null;
  const onLookDown = (e) => {
    if (viewMode.mode !== 'fpv') return;
    e.preventDefault(); lookId = e.pointerId; lookLast = { x: e.clientX, y: e.clientY };
    lookArea.setPointerCapture?.(e.pointerId);
  };
  const onLookMove = (e) => {
    if (lookId !== e.pointerId || !lookLast) return;
    e.preventDefault();
    applyLookDelta(look, e.clientX - lookLast.x, e.clientY - lookLast.y, {
      sensitivity: cfg.fpvTouchLook, pitchMinDeg: cfg.fpvPitchMin, pitchMaxDeg: cfg.fpvPitchMax,
    });
    lookLast = { x: e.clientX, y: e.clientY };
  };
  const onLookUp = (e) => { if (e.pointerId === lookId) { lookId = null; lookLast = null; } };
  lookArea?.addEventListener('pointerdown', onLookDown);
  lookArea?.addEventListener('pointermove', onLookMove);
  lookArea?.addEventListener('pointerup', onLookUp);
  lookArea?.addEventListener('pointercancel', onLookUp);
  viewBtn?.addEventListener('click', (e) => { e.preventDefault(); toggleView(); });

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
        const d = Math.hypot(p.x - fox.x, p.z - fox.z);
        if (d < cfg.catchRadius) catchPrey(p);
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
    elTip.innerHTML = isTouch
      ? `左下摇杆移动/转向 · <b>冲刺</b>切换潜行 · <b>扑击</b>捕猎（${phaseLabel}）`
      : `W/S 前后 · 鼠标或 A/D 转向 · <b>Shift</b> 冲刺潜行切换 · <b>空格/左键</b> 扑击 · <b>V</b> 切换视角（${phaseLabel}）`;
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
    stick?.removeEventListener('pointerdown', onStickDown);
    stick?.removeEventListener('pointermove', onStickMove);
    stick?.removeEventListener('pointerup', onStickUp);
    stick?.removeEventListener('pointercancel', onStickUp);
    lookArea?.removeEventListener('pointerdown', onLookDown);
    lookArea?.removeEventListener('pointermove', onLookMove);
    lookArea?.removeEventListener('pointerup', onLookUp);
    lookArea?.removeEventListener('pointercancel', onLookUp);
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
  if (typeof window !== 'undefined') window.__playAsFox = qa;
  return api;
}
