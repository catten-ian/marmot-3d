/**
 * 战斗视觉效果：近战挥爪、大招冲击波、粒子、伤害数字、状态光环。
 * 第一人称下没有"角色出招"的视觉锚点，因此前方的爪击/冲击特效
 * 必须清晰表达攻击范围，否则玩家无法判断是否打中。
 */
import * as THREE from 'three';
import { clamp, terrainHeight } from '../core/utils.js';

/** 爪击：一道扇形挥砍面，从相机前方扫出 */
export class ClawSwing {
  constructor(scene) {
    this.group = new THREE.Group();
    const shape = new THREE.Shape();
    // 扇形：0.55rad 半角
    const half = 0.55;
    shape.moveTo(0, 0);
    const R = 1;
    for (let i = 0; i <= 14; i++) {
      const a = -half + (i / 14) * half * 2;
      shape.lineTo(Math.sin(a) * R, Math.cos(a) * R);
    }
    shape.closePath();
    const geo = new THREE.ShapeGeometry(shape);
    geo.rotateX(-Math.PI / 2);

    this.mat = new THREE.MeshBasicMaterial({
      color: 0xfff1a9, transparent: true, opacity: 0,
      depthWrite: false, side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.renderOrder = 5;
    this.group.add(this.mesh);

    // 边缘弧线，让攻击范围更易读
    const edgeMat = new THREE.MeshBasicMaterial({
      color: 0xfff8d0, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide,
    });
    const edgeGeo = new THREE.RingGeometry(0.92, 1, 20, 1, -half, half * 2);
    edgeGeo.rotateX(-Math.PI / 2);
    this.edge = new THREE.Mesh(edgeGeo, edgeMat);
    this.group.add(this.edge);

    scene.add(this.group);
    this.scene = scene;
    this.t = 0;
    this.active = false;
    this.power = 1;
  }

  fire(x, y, z, yaw, radius, color = 0xfff1a9) {
    this.group.position.set(x, y, z);
    this.group.rotation.y = yaw;
    this.mat.color.setHex(color);
    this.edge.material.color.setHex(color);
    this.t = 0;
    this.active = true;
    this.power = 1;
    // 视觉扇形不必与实际判定半径等大：贴地大扇面在第一人称下会被透视
    // 压成一条横贯视野的亮带。限制在 1.6m 内，只表达"我出爪了"的方向与范围感。
    this.radius = Math.min(radius, 1.6);
  }

  update(dt) {
    if (!this.active) return;
    this.t += dt;
    const dur = 0.24;
    const k = this.t / dur;
    if (k >= 1) {
      this.active = false;
      this.mat.opacity = 0;
      this.edge.material.opacity = 0;
      this.group.visible = false;
      return;
    }
    this.group.visible = true;
    // 快速扩张 + 淡出
    const scale = (0.55 + k * 0.75) * this.radius;
    this.group.scale.set(scale, 1, scale);
    this.mat.opacity = (1 - k) * 0.5;
    this.edge.material.opacity = (1 - k) * 0.8;
  }
}

/** 大招：扩散冲击波环 + 垂直光柱 */
export class Shockwave {
  constructor(scene) {
    this.scene = scene;
    this.items = [];

    const ringGeo = new THREE.RingGeometry(0.86, 1, 64);
    ringGeo.rotateX(-Math.PI / 2);
    const beamGeo = new THREE.CylinderGeometry(0.5, 0.85, 7, 20, 1, true);
    const beamMat = new THREE.MeshBasicMaterial({
      color: 0xe4b1ff, transparent: true, opacity: 0.3,
      side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xffd9a0, transparent: true, opacity: 0.7,
      side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this._geo = ringGeo;
    this._beamGeo = beamGeo;
    this._beamMatProto = beamMat;
    this._ringMatProto = ringMat;
  }

  fire(x, z, maxRadius = 11) {
    const beam = new THREE.Mesh(this._beamGeo, this._beamMatProto.clone());
    beam.position.set(x, terrainHeight(x, z) + 3.5, z);
    this.scene.add(beam);

    const rings = [];
    for (let i = 0; i < 3; i++) {
      const r = new THREE.Mesh(this._geo, this._ringMatProto.clone());
      r.position.set(x, terrainHeight(x, z) + 0.12 + i * 0.06, z);
      this.scene.add(r);
      rings.push(r);
    }
    this.items.push({ t: 0, dur: 0.85, maxRadius, beam, rings, x, z });
  }

  update(dt) {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      it.t += dt;
      const k = it.t / it.dur;
      if (k >= 1) {
        this.scene.remove(it.beam);
        it.beam.material.dispose();
        it.rings.forEach((r) => { this.scene.remove(r); r.material.dispose(); });
        this.items.splice(i, 1);
        continue;
      }
      it.beam.material.opacity = (1 - k) * 0.32;
      it.beam.scale.set(1 - k * 0.55, 1, 1 - k * 0.55);
      it.rings.forEach((r, ri) => {
        const kk = clamp(k - ri * 0.11, 0, 1);
        const s = kk * it.maxRadius;
        r.scale.set(s, 1, s);
        r.material.opacity = (1 - kk) * 0.72;
      });
    }
  }
}

/** 通用粒子池：命中、采集、爆发的碎屑 */
export class Particles {
  constructor(scene, max = 420) {
    this.scene = scene;
    this.max = max;
    this.items = [];

    const geo = new THREE.IcosahedronGeometry(0.07, 0);
    const mat = new THREE.MeshBasicMaterial({ vertexColors: false, toneMapped: false });
    this.mesh = new THREE.InstancedMesh(geo, mat, max);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    const colors = new Float32Array(max * 3);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(colors, 3);
    this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    scene.add(this.mesh);

    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._v = new THREE.Vector3();
    this._c = new THREE.Color();
    this._tmpScale = new THREE.Vector3();
    this._hidden = new THREE.Matrix4().makeScale(0, 0, 0);
    // 记录上一帧的实例数，用于把"用过的实例"逐个缩为 0
    this._lastCount = 0;
  }

  burst(x, y, z, color, count = 10, power = 1) {
    for (let i = 0; i < count && this.items.length < this.max; i++) {
      const a = Math.random() * Math.PI * 2;
      const up = 0.35 + Math.random() * 0.9;
      const sp = (1.4 + Math.random() * 2.6) * power;
      this.items.push({
        x, y, z,
        vx: Math.cos(a) * sp, vy: up * sp, vz: Math.sin(a) * sp,
        life: 0.4 + Math.random() * 0.5,
        maxLife: 0.4 + Math.random() * 0.5,
        // 基础几何半径 0.07，这里是相对倍数；控制在 0.45~1.0，
        // 太大会在视野里变成醒目的色块（贴地视角下尤其明显）
        size: 0.45 + Math.random() * 0.55,
        r: color.r, g: color.g, b: color.b,
      });
    }
  }

  update(dt) {
    const items = this.items;
    for (let i = items.length - 1; i >= 0; i--) {
      const p = items[i];
      p.life -= dt;
      if (p.life <= 0) { items.splice(i, 1); continue; }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      p.vy -= 9 * dt; // 重力
      // 落地弹一下
      const gy = terrainHeight(p.x, p.z);
      if (p.y < gy + 0.05) { p.y = gy + 0.05; p.vy = Math.abs(p.vy) * 0.32; p.vx *= 0.7; p.vz *= 0.7; }
    }

    const n = items.length;
    for (let i = 0; i < n; i++) {
      const p = items[i];
      const k = p.life / p.maxLife;
      this._v.set(p.x, p.y, p.z);
      this._q.identity();
      this._m.compose(this._v, this._q, this._tmpScale.set(p.size * k, p.size * k, p.size * k));
      this.mesh.setMatrixAt(i, this._m);
      this._c.setRGB(p.r * (0.5 + k * 0.5), p.g * (0.5 + k * 0.5), p.b * (0.5 + k * 0.5));
      this.mesh.setColorAt(i, this._c);
    }
    // 剩余实例隐藏 —— 必须每次都执行，且 count 只能收缩不能累积，
    // 否则消失的粒子会停留在最后一帧的矩阵上，变成空中悬浮的色块。
    for (let i = n; i < this._lastCount; i++) this.mesh.setMatrixAt(i, this._hidden);
    this.mesh.count = n;
    this._lastCount = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}

/**
 * 伤害数字：世界空间 billboard 文本。
 * 用 Canvas 生成纹理贴图，避免引入字体文件。
 */
export class DamageText {
  constructor(scene) {
    this.scene = scene;
    this.items = [];
    this._cache = new Map();
  }

  _texture(text, color) {
    const key = text + '|' + color;
    if (this._cache.has(key)) return this._cache.get(key);
    const c = document.createElement('canvas');
    const dpr = 2;
    c.width = 128 * dpr; c.height = 64 * dpr;
    const g = c.getContext('2d');
    g.scale(dpr, dpr);
    g.font = 'bold 34px "Microsoft YaHei", sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineWidth = 5;
    g.strokeStyle = 'rgba(0,0,0,0.85)';
    g.strokeText(text, 64, 32);
    g.fillStyle = color;
    g.fillText(text, 64, 32);
    const tex = new THREE.CanvasTexture(c);
    tex.needsUpdate = true;
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
    const entry = { tex, mat };
    this._cache.set(key, entry);
    return entry;
  }

  spawn(x, y, z, text, color = '#ffe8b0') {
    const { tex, mat } = this._texture(text, color);
    const sprite = new THREE.Sprite(mat.clone());
    sprite.position.set(x, y, z);
    sprite.scale.set(1.1, 0.55, 1);
    sprite.renderOrder = 30;
    this.scene.add(sprite);
    this.items.push({ sprite, t: 0, dur: 1.05, y0: y });
  }

  update(dt) {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      it.t += dt;
      const k = it.t / it.dur;
      if (k >= 1) {
        this.scene.remove(it.sprite);
        it.sprite.material.dispose();
        this.items.splice(i, 1);
        continue;
      }
      it.sprite.position.y = it.y0 + k * 1.1;
      it.sprite.material.opacity = k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3;
      const pop = k < 0.15 ? 0.6 + (k / 0.15) * 0.4 : 1;
      it.sprite.scale.set(1.1 * pop, 0.55 * pop, 1);
    }
  }
}

/**
 * 玩家状态光环：贴地自转环，表示爆发/大招/过载/疲劳。
 * 第一人称看不到自己，光环是唯一的"自身状态"提示。
 */
/**
 * 玩家状态提示。
 *
 * 早期版本在玩家脚下画一个贴地光环环。第一人称贴地视角下，
 * 这个环会被透视压缩成一条横贯视野的亮带，严重干扰视野，
 * 而且玩家看不到自己的"脚下"，本来也无需地面标识。
 *
 * 改为：不渲染任何地面几何，只暴露状态数据给 HUD，
 * 由屏幕边缘的状态描边（CSS）来表达，玩家获得的是无遮挡的视野。
 */
export class PlayerAura {
  constructor(scene) {
    this.scene = scene;
    this.t = 0;
    this.state = { boost: false, overdrive: false, overloaded: false, social: false, fatigue: false };
  }

  update(dt, x, z, state) {
    this.t += dt;
    this.state = state;
  }
}