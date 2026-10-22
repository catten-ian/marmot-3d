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
 *    扑击激活帧内水平 + 垂直重叠即捕获土拨鼠；扑完有硬直。
 *  - 猎物：AI 土拨鼠游荡，进入察觉半径会警觉（!）随后逃离，扑击时惊逃更快。
 */
import * as THREE from 'three';
import { createProceduralFox } from '../entities/procedural-fox.js';
import { buildMarmotMesh } from '../entities/props_entities.js';
import { terrainHeight } from '../core/utils.js';
import { moveBounds } from '../core/config.js';

const PREY_COUNT = 8;
const PREY_CATCH_R = 1.7;          // 扑击捕获水平半径
const STALK_SPEED = 2.5;
const RUN_SPEED = 6.4;
const TURN_RATE = 2.6;             // 键盘转向 rad/s
const MOUSE_TURN = 0.0024;
const WIND_TIME = 0.22;            // 蓄力下蹲
const LUNGE_TIME = 0.42;           // 腾空扑击时长
const LUNGE_SPEED = 13.5;
const LUNGE_HEIGHT = 1.05;
const RECOVER_TIME = 0.5;
const PREY_WANDER = 1.7;
const PREY_FLEE = 5.0;
const PREY_BURST = 8.2;            // 扑击时惊逃峰值
const RESPAWN_TIME = 1.6;

function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
function damp(cur, target, lambda, dt) { return THREE.MathUtils.lerp(cur, target, 1 - Math.exp(-lambda * dt)); }

/** 猎物（AI 土拨鼠）。 */
class Prey {
  constructor(scene, x, z) {
    this.mesh = buildMarmotMesh(0xb3925a);
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
  hide(scene, hudLayer) {
    this.mesh.visible = false;
    this.mark.remove();
  }
  show(scene, hudLayer) {
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
  update(dt, fox, cam, hudLayer, bounds) {
    if (this.caught) {
      this.respawn -= dt;
      if (this.respawn <= 0) this.respawnAt(bounds);
      return false;
    }
    const dx = this.x - fox.x, dz = this.z - fox.z;
    const dist = Math.hypot(dx, dz) || 0.001;
    // 察觉半径：潜行近、冲刺远、扑击最远
    const pouncing = fox.phase === 'lunge';
    const detect = pouncing ? 17 : fox.sprint ? 11.5 : 6.2;
    if (dist < detect) {
      if (this.state === 'wander') { this.state = 'alert'; this.timer = 0.32; }
      else if (this.state === 'alert') { this.timer -= dt; if (this.timer <= 0 || dist < detect * 0.55) this.state = 'flee'; }
      if (pouncing) this.state = 'flee';
    } else if (this.state !== 'wander' && dist > detect + 4) {
      this.state = 'wander'; this.timer = Math.random() * 2;
    }

    let speed = 0;
    if (this.state === 'flee') {
      speed = pouncing ? PREY_BURST : PREY_FLEE;
      this.yaw = Math.atan2(dx, dz);           // 径直逃离狐狸
    } else if (this.state === 'wander') {
      speed = PREY_WANDER * 0.5;
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

    // 警觉标记投影到屏幕
    if (this.state === 'alert') {
      const wp = new THREE.Vector3(this.x, y + 1.5, this.z).project(cam);
      if (wp.z < 1) {
        this.mark.style.display = 'block';
        this.mark.style.left = `${(wp.x * 0.5 + 0.5) * hudLayer.clientWidth}px`;
        this.mark.style.top = `${(-wp.y * 0.5 + 0.5) * hudLayer.clientHeight}px`;
      } else this.mark.style.display = 'none';
    } else this.mark.style.display = 'none';
    return false;
  }
}

export function createPlayAsFox(ctx) {
  const { scene, camera, renderer, canvas, sky, onExit } = ctx;
  const bounds = moveBounds(6);

  // —— 玩家扮演的藏狐 ——
  const foxVisual = createProceduralFox({});
  scene.add(foxVisual.group);
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
  let camPitch = 0.32;
  const camDist = 5.2, camHeight = 2.3;
  const keys = new Set();

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
    `;
    document.head.appendChild(style);
  }
  document.body.classList.add('play-as-fox');
  overlay.innerHTML = `
    <div id="pafTop" style="position:absolute;top:12px;left:0;right:0;text-align:center;color:#ffe9c2;text-shadow:0 1px 4px #000;font-size:18px;font-weight:800"></div>
    <div id="pafTip" style="position:absolute;bottom:14px;left:0;right:0;text-align:center;color:#dfe8d6;text-shadow:0 1px 3px #000;font-size:13px;line-height:1.6"></div>
    <div id="pafCenter" style="position:absolute;left:50%;top:46%;transform:translate(-50%,-50%);color:#ffd24a;font-size:30px;font-weight:900;text-shadow:0 2px 6px #000;opacity:0;transition:opacity .15s"></div>
    <button id="pafExit" style="position:absolute;top:12px;right:14px;pointer-events:auto;padding:8px 14px;border-radius:10px;border:1px solid #6f7d5f;background:rgba(20,28,20,.72);color:#e7eedf;font-size:13px;cursor:pointer">退出扮演 (Esc)</button>`;
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
  for (let i = 0; i < PREY_COUNT; i++) {
    const a = (i / PREY_COUNT) * Math.PI * 2 + Math.random();
    const r = 7 + Math.random() * Math.min(bounds.hw, bounds.hh) * 0.72;
    const p = new Prey(scene, Math.cos(a) * r, Math.sin(a) * r);
    p.show(scene, overlay);
    prey.push(p);
  }

  function flash(text, color = '#ffd24a') {
    elCenter.textContent = text; elCenter.style.color = color;
    elCenter.style.opacity = '1';
    clearTimeout(flash._t); flash._t = setTimeout(() => { elCenter.style.opacity = '0'; }, 650);
  }

  function startPounce() {
    if (fox.phase !== 'idle') return;
    fox.phase = 'wind'; fox.phaseT = 0;
  }
  function catchPrey(p) {
    p.caught = true; p.respawn = RESPAWN_TIME;
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
    if (document.pointerLockElement === canvas) fox.yaw += e.movementX * MOUSE_TURN;
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

  // 镜头先就位
  fox.y = terrainHeight(fox.x, fox.z);
  foxVisual.group.position.set(fox.x, fox.y, fox.z);

  function update(dt) {
    if (!running) return;
    elapsed += dt;
    fox.sprint = keys.has('ShiftLeft') || keys.has('ShiftRight');

    // 相位推进
    if (fox.phase === 'wind') {
      fox.phaseT += dt;
      if (fox.phaseT >= WIND_TIME) { fox.phase = 'lunge'; fox.phaseT = 0; fox.lungeYaw = fox.yaw; }
    } else if (fox.phase === 'lunge') {
      fox.phaseT += dt;
      const t = fox.phaseT / LUNGE_TIME;
      fox.x += Math.sin(fox.lungeYaw) * LUNGE_SPEED * dt;
      fox.z += Math.cos(fox.lungeYaw) * LUNGE_SPEED * dt;
      fox.airY = Math.sin(clamp(t, 0, 1) * Math.PI) * LUNGE_HEIGHT;
      if (fox.phaseT >= LUNGE_TIME) { fox.phase = 'recover'; fox.phaseT = 0; fox.airY = 0; }
    } else if (fox.phase === 'recover') {
      fox.phaseT += dt;
      if (fox.phaseT >= RECOVER_TIME) fox.phase = 'idle';
    }

    // 常规移动 / 转向（蓄力与扑击中锁向）
    const canSteer = fox.phase === 'idle' || fox.phase === 'recover';
    let turn = 0;
    if (canSteer) {
      if (keys.has('KeyA') || keys.has('ArrowLeft')) turn += 1;
      if (keys.has('KeyD') || keys.has('ArrowRight')) turn -= 1;
      fox.yaw += turn * TURN_RATE * dt;
    }
    let throttle = 0;
    if (fox.phase === 'idle') {
      if (keys.has('KeyW') || keys.has('ArrowUp')) throttle += 1;
      if (keys.has('KeyS') || keys.has('ArrowDown')) throttle -= 0.55;
      const sp = fox.sprint ? RUN_SPEED : STALK_SPEED;
      fox.x += Math.sin(fox.yaw) * sp * throttle * dt;
      fox.z += Math.cos(fox.yaw) * sp * throttle * dt;
    }
    fox.x = clamp(fox.x, -bounds.hw, bounds.hw);
    fox.z = clamp(fox.z, -bounds.hh, bounds.hh);

    const groundY = terrainHeight(fox.x, fox.z);
    fox.y = groundY + fox.airY;
    foxVisual.group.position.set(fox.x, fox.y, fox.z);
    foxVisual.group.rotation.y = fox.yaw;
    // 蹲伏（潜行/蓄力）与扑击俯仰
    // 蹲伏（潜行/蓄力）：以足部为原点整体压低头；扑击/蓄力做整组俯仰
    const crouchAmt = (fox.phase === 'wind') ? 0.72 : (!fox.sprint && throttle !== 0 && fox.phase === 'idle') ? 0.9 : 1;
    foxVisual.group.scale.set(1, crouchAmt, 1);
    if (fox.phase === 'lunge') foxVisual.group.rotation.x = -0.3;
    else if (fox.phase === 'wind') foxVisual.group.rotation.x = 0.32;
    else foxVisual.group.rotation.x = damp(foxVisual.group.rotation.x, 0, 10, dt);
    try { foxVisual.update?.(dt); } catch (_) {}

    // 猎物
    for (const p of prey) {
      p.update(dt, fox, camera, overlay, bounds);
      // 扑击激活帧判定捕获（水平 + 垂直接近）
      if (!p.caught && fox.phase === 'lunge') {
        const d = Math.hypot(p.x - fox.x, p.z - fox.z);
        if (d < PREY_CATCH_R) catchPrey(p);
      }
    }

    // 天空球跟随
    sky?.update?.({ x: fox.x, y: fox.y, z: fox.z }, dt);

    // 第三人称追尾相机
    const fwd = fox.forward;
    const tx = fox.x - fwd.x * camDist;
    const tz = fox.z - fwd.z * camDist;
    camera.position.x = damp(camera.position.x, tx, 12, dt);
    camera.position.z = damp(camera.position.z, tz, 12, dt);
    const camY = fox.y + camHeight + camPitch * 1.4;
    camera.position.y = damp(camera.position.y, camY, 12, dt);
    camera.lookAt(fox.x + fwd.x * 2.2, fox.y + 0.9, fox.z + fwd.z * 2.2);

    // HUD
    elTop.textContent = `扮演藏狐 · 捕猎 ${score} 只 · ${elapsed.toFixed(0)}s`;
    const phaseLabel = fox.phase === 'wind' ? '蓄力中…' : fox.phase === 'lunge' ? '扑击！' : fox.phase === 'recover' ? '硬直' : fox.sprint ? '冲刺（易被发现）' : '潜行';
    elTip.innerHTML = `W/S 前后 · 鼠标或 A/D 转向 · <b>Shift</b> 冲刺潜行切换 · <b>空格/左键</b> 扑击（${phaseLabel}）`;
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
  // QA 专用：把扮演的藏狐放到指定点（仅 beta 调试/自动化，非实玩输入路径）。
  function qaTeleport(x, z, yaw) {
    fox.x = x; fox.z = z; fox.airY = 0;
    if (Number.isFinite(yaw)) fox.yaw = yaw;
    fox.y = terrainHeight(fox.x, fox.z);
  }
  // 只读 QA / 调试钩子（beta）：位置、得分、阶段、猎物；teleport 仅供自动化。
  const qa = {
    get active() { return running; },
    get score() { return score; },
    get phase() { return fox.phase; },
    get pos() { return { x: fox.x, y: fox.y, z: fox.z, yaw: fox.yaw }; },
    get prey() { return prey.map((p) => ({ x: p.x, z: p.z, state: p.state, caught: p.caught })); },
    teleport: qaTeleport,
  };
  if (typeof window !== 'undefined') window.__playAsFox = qa;
  return api;
}
