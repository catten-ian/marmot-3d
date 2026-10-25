/**
 * 3D 预览：真实狐狸模型（失败回退程序化狐狸）+ 攻击范围可视化。
 * 所有可视化尺寸都读自面板预览态 values（改动即时反映）。
 */
import * as THREE from 'three';
import { createProceduralFox } from '../entities/procedural-fox.js';

const TYPE_COLOR = { normal: 0xc4763a, pup: 0xc4763a, fast: 0xd9c294, heavy: 0x9c8770, boss: 0x6b4c31 };

function lineMat(color, opacity) {
  return new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthTest: false });
}
function wireMat(color, opacity) {
  return new THREE.MeshBasicMaterial({ color, wireframe: true, transparent: true, opacity, depthTest: false });
}
function solidMat(color, opacity) {
  return new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthTest: false, side: THREE.DoubleSide });
}
/** 扇形（地面投影，前方向 -Z / yaw=0 朝 -Z；本预览狐狸面向 +Z 时用 yaw 旋转）。 */
function fanMesh(radius, halfAngle, color, opacity, segments = 32) {
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  for (let i = 0; i <= segments; i++) {
    const a = -halfAngle + (2 * halfAngle * i) / segments;
    shape.lineTo(Math.sin(a) * radius, Math.cos(a) * radius);
  }
  shape.lineTo(0, 0);
  const geo = new THREE.ShapeGeometry(shape);
  geo.rotateX(Math.PI / 2); // 放到 XZ 平面，开口朝 +Z
  return new THREE.Mesh(geo, solidMat(color, opacity));
}
function ringMesh(radius, color, opacity, segments = 64) {
  const pts = [];
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    pts.push(new THREE.Vector3(Math.sin(a) * radius, 0, Math.cos(a) * radius));
  }
  return new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), lineMat(color, opacity));
}

export class AdminPreview {
  constructor({ canvas, values, onStatus }) {
    this.values = values; // 预览态 values（引用，外部直接改）
    this.onStatus = onStatus || (() => {});
    this.pose = 'idle';
    this.foxType = 'normal';
    this.foxYaw = 0;
    this.show = { pounceSector: true, dashTrack: true, collision: true, windRange: true, lungeLock: true, strikeFan: true, marmot: true, flora: true, target: true };
    this.timeline = { playing: true, time: 0 };
    this._time = 0;

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x2e332c);
    this.scene.fog = new THREE.Fog(0x2e332c, 30, 90);
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.05, 200);
    this._orbit = { theta: 0.7, phi: 1.05, dist: 9, cx: 0, cy: 0.6, cz: 0 };

    this.scene.add(new THREE.AmbientLight(0xffffff, 0.5));
    const key = new THREE.DirectionalLight(0xfff2dd, 2.0); key.position.set(4, 6, 3);
    const fill = new THREE.DirectionalLight(0xbfd4ff, 0.9); fill.position.set(-5, 3, -4);
    this.scene.add(key, fill);

    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(30, 48).rotateX(-Math.PI / 2),
      new THREE.MeshLambertMaterial({ color: 0x55644a }),
    );
    ground.position.y = -0.01;
    this.scene.add(ground);
    this.scene.add(new THREE.GridHelper(60, 60, 0x7a8471, 0x46503f));

    this.foxRoot = new THREE.Group(); // 世界位置/朝向
    this.foxModelSlot = new THREE.Group(); // 姿态动画层
    this.foxRoot.add(this.foxModelSlot);
    this.scene.add(this.foxRoot);

    this.volGroup = new THREE.Group();
    this.volGroup.renderOrder = 999;
    this.scene.add(this.volGroup);

    this._buildFox();
    this._buildSceneObjects();
    this._bindOrbit(canvas);
    this.rebuildVolumes();
    this._resize();
    window.addEventListener('resize', () => this._resize());
    this.renderer.setAnimationLoop((t) => this._frame(t));
  }

  // ---------- 狐狸模型 ----------
  _buildFox() {
    this.modelKind = 'procedural';
    this.proc = createProceduralFox({ color: TYPE_COLOR[this.foxType] || TYPE_COLOR.normal });
    this._setModel(this.proc.group);
    this.onStatus('模型来源：Beta 程序化模型（默认）；未加载真实 fox.glb，无回退。');
    this.refreshTuning();
  }

  _buildSceneObjects() {
    this.objects = new THREE.Group(); this.scene.add(this.objects);
    const marmot = new THREE.Group();
    const body = new THREE.Mesh(new THREE.SphereGeometry(.42, 16, 10), solidMat(0x8b654e, .95)); body.scale.y = 1.2; body.position.y = .5;
    const head = new THREE.Mesh(new THREE.SphereGeometry(.3, 14, 10), solidMat(0xa77b5b, .95)); head.position.set(0, 1.02, .05);
    marmot.add(body, head); marmot.position.set(0, 0, 4); this.marmot = marmot; this.objects.add(marmot);
    const flora = new THREE.Group();
    for (let i = 0; i < 8; i++) { const stem = new THREE.Mesh(new THREE.ConeGeometry(.08, .55, 6), solidMat(i % 2 ? 0x6b9b4f : 0xe9b2bf, .9)); stem.position.set((i - 3.5) * .55, .27, 2.2 + (i % 2) * .45); flora.add(stem); }
    this.flora = flora; this.objects.add(flora);
    const target = new THREE.Mesh(new THREE.CylinderGeometry(.38, .38, 1.1, 16), wireMat(0xffd36a, .9)); target.position.set(0, .55, 2.8); this.target = target; this.objects.add(target);
  }
  setObjectVisible(name, visible) { if (this[name]) this[name].visible = visible; }
  setTimelineTime(time) { this.timeline.time = Math.max(0, Math.min(1, Number(time) || 0)); this.timeline.playing = false; }
  replayTimeline() { this.timeline.time = 0; this.timeline.playing = true; }
  toggleTimeline() { this.timeline.playing = !this.timeline.playing; }

  _setModel(obj) {
    this.foxModelSlot.clear();
    this.foxModelSlot.add(obj);
  }

  /** 切换狐狸类型：改体型缩放与（程序化模型的）毛色。 */
  setFoxType(type) {
    this.foxType = type;
    this.refreshTuning();
  }

  refreshTuning() {
    const type = this.foxType;
    const scale = this.values[`foxType.${type}.scale`];
    if (Number.isFinite(scale)) this.foxModelSlot.scale.setScalar(scale);
    const hex = this.values[`fox.proceduralColor.${type}`] ?? TYPE_COLOR[type] ?? TYPE_COLOR.normal;
    if (this.proc) this.proc.setColor(hex);
    else {
      const tint = new THREE.Color(hex);
      this.foxModelSlot.traverse((o) => {
        if (!o.isMesh) return;
        const apply = (m) => {
          if (!m?.color) return;
          if (m.userData.adminBaseColor == null) m.userData.adminBaseColor = m.color.getHex();
          const base = new THREE.Color(m.userData.adminBaseColor);
          m.color.copy(base).multiply(tint);
        };
        if (Array.isArray(o.material)) o.material.forEach(apply); else apply(o.material);
      });
    }
    this.rebuildVolumes();
  }

  setPose(pose) { this.pose = pose; }
  setYaw(yaw) { this.foxYaw = yaw; this.foxRoot.rotation.y = yaw; }
  setPosition(x, z) { this.foxRoot.position.set(x, 0, z); }

  // ---------- 攻击范围可视化 ----------
  _clearVolumes() {
    for (const root of [...this.volGroup.children]) {
      root.traverse((o) => {
        o.geometry?.dispose();
        if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose());
        else o.material?.dispose();
      });
      this.volGroup.remove(root);
    }
  }

  rebuildVolumes() {
    this._clearVolumes();
    const v = this.values;
    const type = this.foxType;
    const g = new THREE.Group();
    g.position.copy(this.foxRoot.position);
    g.rotation.y = this.foxRoot.rotation.y;
    this.volGroup.add(g);

    // 1) 智能扑击扇形：min/max 距离 + maxAngle（SMART_POUNCE）
    if (this.show.pounceSector) {
      const minD = v['smart.pounce.minDistance'], maxD = v['smart.pounce.maxDistance'];
      const ang = v['smart.pounce.maxAngle'];
      const outer = fanMesh(maxD, ang, 0xff6654, 0.20);
      outer.position.y = 0.02;
      const inner = fanMesh(minD, ang, 0x2e332c, 0.85);
      inner.position.y = 0.025;
      g.add(outer, inner);
      // 扑击位移线：speed × lockTime
      const pounceDist = v['smart.pounce.speed'] * v['smart.pounce.lockTime'];
      const pts = [new THREE.Vector3(0, 0.05, 0), new THREE.Vector3(0, 0.05, pounceDist)];
      g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), lineMat(0xff6654, 0.9)));
    }

    // 2) 冲刺轨迹：dashSpeed × dashTime × dashSpeedMul（FOX_ATTACKS）
    if (this.show.dashTrack) {
      const atk = {
        dashTime: v[`foxAtk.${type}.dashTime`] ?? 0.32,
        dashSpeedMul: v[`foxAtk.${type}.dashSpeedMul`] ?? 1,
        mode: v[`foxAtk.${type}.mode`] || 'straight',
        leapHeight: v[`foxAtk.${type}.leapHeight`] || 0,
      };
      const dist = v['fox.dashSpeed'] * atk.dashTime * atk.dashSpeedMul;
      const isLeap = atk.mode === 'leap';
      const pts = [new THREE.Vector3(0, 0.05, 0), new THREE.Vector3(0, 0.05 + (isLeap ? atk.leapHeight : 0), dist)];
      g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), lineMat(isLeap ? 0xffc36a : 0xff8a54, 0.95)));
      // 终点攻击盒
      const r = v[`foxCol.${type}.radius`] ?? v['foxCol.normal.radius'];
      const h = isLeap ? (v[`foxCol.${type}.height`] ?? 0.4) : v['fox.groundAttackHeight'];
      const end = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 20), wireMat(0xff6654, 0.8));
      end.position.set(0, (isLeap ? atk.leapHeight : 0) + h / 2 + 0.02, dist);
      g.add(end);
    }

    // 3) 碰撞体积（当前位置）
    if (this.show.collision) {
      const r = v[`foxCol.${type}.radius`] ?? v['foxCol.normal.radius'];
      const h = v[`foxCol.${type}.height`] ?? v['foxCol.normal.height'];
      const cyl = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 20), wireMat(0xff6654, 0.55));
      cyl.position.y = h / 2 + 0.01;
      g.add(cyl);
      // 接触距离环
      const contact = v[`foxContact.${type}`] ?? v['foxContact.default'];
      const ring = ringMesh(contact, 0xffb0a0, 0.5);
      ring.position.y = 0.03;
      g.add(ring);
    }

    // 4) 蓄力触发距离环（windRange）
    if (this.show.windRange) {
      const ring = ringMesh(v['fox.windRange'], 0xffe08a, 0.55);
      ring.position.y = 0.03;
      g.add(ring);
    }

    // 5) 玩家扑击锁敌扇形（BETA_TUNE.lungeLock*）—— 以狐狸为原点展示相对概念
    if (this.show.lungeLock) {
      const fan = fanMesh(v['beta.lungeLockRange'], v['beta.lungeLockHalfAngle'], 0x9fd7ff, 0.16);
      fan.position.y = 0.015;
      g.add(fan);
    }

    // 6) 玩家扑击攻击体积扇形（STRIKE_VOLUMES.lunge + wheel.lunge）
    if (this.show.strikeFan) {
      const half = v['strike.halfAngle'];
      const range = Math.max(0.1, v['wheel.lunge.range'] + 2.4) * v['wheel.lunge.rangeMul'];
      const fan = fanMesh(range, half, 0xffa36f, 0.22);
      fan.position.y = 0.01;
      g.add(fan);
      const lower = v['strike.lunge.lower'], upper = v['strike.lunge.upper'];
      const pts = [new THREE.Vector3(0, lower, range), new THREE.Vector3(0, upper, range)];
      g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), lineMat(0xffa36f, 0.8)));
    }
  }

  // ---------- 交互 ----------
  _bindOrbit(canvas) {
    const o = this._orbit;
    let drag = null;
    canvas.addEventListener('pointerdown', (e) => {
      drag = { x: e.clientX, y: e.clientY, theta: o.theta, phi: o.phi, cx: o.cx, cz: o.cz, button: e.button };
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (drag.button === 2) { // 右键平移
        const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrix, 0);
        const fwd = new THREE.Vector3(); this.camera.getWorldDirection(fwd); fwd.y = 0; fwd.normalize();
        o.cx = drag.cx - right.x * dx * 0.01 + fwd.x * dy * 0.01;
        o.cz = drag.cz - right.z * dx * 0.01 + fwd.z * dy * 0.01;
      } else {
        o.theta = drag.theta - dx * 0.006;
        o.phi = Math.max(0.15, Math.min(Math.PI - 0.15, drag.phi - dy * 0.006));
      }
    });
    canvas.addEventListener('pointerup', () => { drag = null; });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      o.dist = Math.max(2, Math.min(60, o.dist * (1 + Math.sign(e.deltaY) * 0.1)));
    }, { passive: false });
  }

  _resize() {
    const c = this.renderer.domElement;
    const w = c.clientWidth || c.parentElement.clientWidth || 640;
    const h = c.clientHeight || c.parentElement.clientHeight || 480;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  _frame(t) {
    const dt = Math.min(0.05, this._lastT ? (t - this._lastT) / 1000 : 1 / 60);
    this._lastT = t;
    this._time += dt;
    if (this.timeline.playing) this.timeline.time = (this.timeline.time + dt / 2.2) % 1;

    // 姿态动画（程序驱动 GLB；程序化模型同时驱动四肢）
    const slot = this.foxModelSlot;
    if (this.proc) {
      const animMap = { idle: 'idle', walk: 'walk', dash: 'dash', pounce: 'dash' };
      const gaitScale = this.pose === 'dash'
        ? Math.max(0.25, (this.values['fox.dashSpeed'] || 14.5) / 14.5)
        : this.pose === 'walk' ? Math.max(0.25, (this.values['player.speed'] || 4.8) / 4.8) : 1;
      this.proc.setAnimState({ anim: animMap[this.pose] || 'idle', speed: gaitScale });
      this.proc.update(dt);
    }
    const walkRate = 6 * Math.max(0.25, (this.values['player.speed'] || 4.8) / 4.8);
    const dashRate = 12 * Math.max(0.25, (this.values['fox.dashSpeed'] || 14.5) / 14.5);
    const bob = {
      idle: 0,
      walk: Math.abs(Math.sin(this._time * walkRate)) * 0.03,
      dash: Math.abs(Math.sin(this._time * dashRate)) * 0.06,
      pounce: 0.12 + Math.sin(this._time * 2) * 0.05,
    }[this.pose] || 0;
    const lean = { idle: 0, walk: -0.04, dash: -0.16, pounce: -0.38 }[this.pose] || 0;
    slot.position.y = bob;
    const phaseLean = this.timeline.time < .18 ? 0 : this.timeline.time < .45 ? -.16 : this.timeline.time < .7 ? -.38 : 0;
    slot.rotation.x = this.pose === 'pounce' ? phaseLean : lean;

    const o = this._orbit;
    this.camera.position.set(
      o.cx + o.dist * Math.sin(o.phi) * Math.sin(o.theta),
      o.cy + o.dist * Math.cos(o.phi),
      o.cz + o.dist * Math.sin(o.phi) * Math.cos(o.theta),
    );
    this.camera.lookAt(o.cx, o.cy, o.cz);
    this.renderer.render(this.scene, this.camera);
  }
}
