/**
 * 采食目标。
 *
 * 正式版：浆果（沿用 v1.0 的果实造型）。
 * dev 版：草本植物（按真实旱獭食性改造）—— 沙草、禾本科叶茎、豆科花等。
 *
 * 两种形态都保留"发光的可采食提示"，因为第一人称贴地视角下
 * 必须能快速找到采食目标；但 dev 版的配色来自植物本身，
 * 而不是人工的红色光晕。
 */
import * as THREE from 'three';
import { terrainHeight } from '../core/utils.js';
import { instantiate, normalizeModel } from '../models/loader.js';
import { USE_REAL_MODELS } from '../core/version.js';

/** 真实土拨鼠模型（与藏狐同一套分级回退，见 models/loader.js） */
const instantiateMarmot = (dev = false) => instantiate(`./assets/models/${dev ? 'marmot-screaming.glb' : 'marmot.glb'}`, dev ? 'marmotScream' : 'marmot');
const tintMarmot = (root) => root?.traverse?.((o) => { if (!o.isMesh || /eye|tongue|teeth|mouth/i.test(o.name || '')) return; const mats = Array.isArray(o.material) ? o.material : [o.material]; mats.forEach((m) => { if (!m) return; const c = m.color; if (c && c.r < 0.08 && c.g < 0.08 && c.b < 0.08) c.set(0xa9834e); }); });
import { devOn } from '../core/version.js';

export class Food {
  /**
   * @param plant dev 版传入植物定义 {name,color,leaf,moisture,linoleic}
   */
  constructor(scene, x, z, index, plant = null) {
    this.x = x; this.z = z; this.index = index;
    this.taken = false;
    this.plant = plant;
    this.herbivore = devOn('herbivoreFood') && !!plant;
    this.group = new THREE.Group();
    this.group.position.set(x, terrainHeight(x, z) + 0.52, z);

    if (this.herbivore) { this._buildHerb(); if (devOn('sorrelFood')) this._loadSorrel(); }
    else this._buildBerry();

    scene.add(this.group);
    this._t = Math.random() * 6;
    this.scene = scene;
  }

  /** 浆果造型（正式版） */
  _buildBerry() {
    this.fruits = [];
    const fruitGeo = new THREE.SphereGeometry(0.1, 10, 8);
    const leafGeo = new THREE.ConeGeometry(0.1, 0.26, 5);
    // 真实深红，低自发光，靠高光表现质感
    const berryMat = new THREE.MeshStandardMaterial({
      color: 0x9e1b2c, roughness: 0.38, metalness: 0.05,
      emissive: 0x2a0a10, emissiveIntensity: 0.25,
    });
    const leafMat = new THREE.MeshStandardMaterial({ color: 0x4a6b32, roughness: 0.95 });

    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      const f = new THREE.Mesh(fruitGeo, berryMat);
      f.position.set(Math.cos(a) * 0.16, (i - 1) * 0.07, Math.sin(a) * 0.16);
      f.castShadow = true;
      this.group.add(f);
      this.fruits.push(f);
      const leaf = new THREE.Mesh(leafGeo, leafMat);
      leaf.position.set(Math.cos(a) * 0.16, 0.24, Math.sin(a) * 0.16);
      this.group.add(leaf);
    }

    const halo = new THREE.Mesh(
      new THREE.CircleGeometry(0.5, 16),
      new THREE.MeshBasicMaterial({ color: 0xc46a5e, transparent: true, opacity: 0.09, depthWrite: false }),
    );
    halo.rotation.x = -Math.PI / 2;
    halo.position.y = -0.5;
    this.group.add(halo);
    this.halo = halo;
  }

  /**
   * 草本植物造型（dev 版）。
   * 按真实食性分三类外形，玩家能一眼区分：
   *   禾本科/沙草 → 丛生细长叶片（成一束）
   *   豆科        → 圆润叶片 + 小花（苜蓿/三叶草的标志）
   *   含亚油酸     → 顶端结出穗状种子（亚麻/向日葵）
   */
  _buildHerb() {
    const p = this.plant;
    this.fruits = [];
    // 叶片是单面片，必须用 DoubleSide，否则背面在某些角度会渲染成深色方块。
    // DoubleSide 会让受光面翻倍，所以 emissive 压低避免整体发亮。
    const stemMat = new THREE.MeshStandardMaterial({
      color: p.leaf ?? 0x6d7f43, roughness: 0.95,
      emissive: 0x0f1408, emissiveIntensity: 0.18,
      side: THREE.DoubleSide,
    });
    const headMat = new THREE.MeshStandardMaterial({
      color: p.color ?? 0x8fa05a, roughness: 0.88,
      emissive: 0x141a0c, emissiveIntensity: 0.25,
      side: THREE.DoubleSide,
    });

    const isLegume = /alfalfa|clover|vetch|sainfoin|bean|豌豆|三叶|苜蓿|巢豆/.test(p.key);
    const isLinoleic = !!p.linoleic;

    if (isLegume) {
      // 豆科：圆润三叶 + 小花
      const leafGeo = new THREE.SphereGeometry(0.075, 8, 6);
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2;
        const l = new THREE.Mesh(leafGeo, stemMat);
        l.position.set(Math.cos(a) * 0.13, 0.02 + i * 0.02, Math.sin(a) * 0.13);
        l.scale.set(1, 0.42, 1.25);
        l.castShadow = true;
        this.group.add(l);
        this.fruits.push(l);
      }
      // 花序
      const flowerGeo = new THREE.SphereGeometry(0.055, 8, 6);
      for (let i = 0; i < 4; i++) {
        const fl = new THREE.Mesh(flowerGeo, headMat);
        fl.position.set((Math.random() - 0.5) * 0.14, 0.22 + i * 0.05, (Math.random() - 0.5) * 0.14);
        this.group.add(fl);
      }
    } else if (isLinoleic) {
      // 富含亚油酸：细长茎 + 穗状种子
      const stalkGeo = new THREE.CylinderGeometry(0.008, 0.012, 0.34, 5);
      for (let i = 0; i < 3; i++) {
        const s = new THREE.Mesh(stalkGeo, stemMat);
        s.position.set((Math.random() - 0.5) * 0.13, 0.15, (Math.random() - 0.5) * 0.13);
        s.rotation.z = (Math.random() - 0.5) * 0.4;
        s.castShadow = true;
        this.group.add(s);
      }
      const seedGeo = new THREE.SphereGeometry(0.032, 7, 6);
      for (let i = 0; i < 7; i++) {
        const sd = new THREE.Mesh(seedGeo, headMat);
        sd.position.set(
          (Math.random() - 0.5) * 0.16,
          0.3 + Math.random() * 0.09,
          (Math.random() - 0.5) * 0.16,
        );
        sd.scale.y = 1.5;
        this.group.add(sd);
        this.fruits.push(sd);
      }
    } else {
      // 沙草 / 禾本科：丛生细长叶
      const bladeGeo = new THREE.PlaneGeometry(0.04, 0.34, 1, 3);
      // 让叶片带一点弯曲，避免像纸片
      const pos = bladeGeo.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const y = pos.getY(i);
        pos.setX(i, pos.getX(i) + y * y * 0.22);
      }
      bladeGeo.computeVertexNormals();

      for (let i = 0; i < 9; i++) {
        const b = new THREE.Mesh(bladeGeo, i % 3 === 0 ? headMat : stemMat);
        const a = (i / 9) * Math.PI * 2;
        b.position.set(Math.cos(a) * 0.11, 0.14, Math.sin(a) * 0.11);
        b.rotation.y = a + Math.random() * 0.5;
        b.rotation.x = (Math.random() - 0.5) * 0.38;
        b.castShadow = true;
        this.group.add(b);
        this.fruits.push(b);
      }
    }

    // 采食提示光晕：用植物本身的颜色，不用红色
    const halo = new THREE.Mesh(
      new THREE.CircleGeometry(0.46, 16),
      new THREE.MeshBasicMaterial({
        color: p.color ?? 0x9aab62, transparent: true, opacity: 0.11, depthWrite: false,
      }),
    );
    halo.rotation.x = -Math.PI / 2;
    halo.position.y = -0.5;
    this.group.add(halo);
    this.halo = halo;

    // 富含亚油酸的额外标识：一圈淡金环（不是稀有度暗示，而是"脂肪含量高"）
    if (isLinoleic) {
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.34, 0.42, 20),
        new THREE.MeshBasicMaterial({
          color: 0xe8cf7a, transparent: true, opacity: 0.3,
          depthWrite: false, side: THREE.DoubleSide,
        }),
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = -0.47;
      this.group.add(ring);
      this.linoleicRing = ring;
    }
  }

  async _loadSorrel() {
    try {
      const inst = await instantiate('./assets/models/shrub-sorrel.glb', 'sorrel');
      if (!inst || !this.group) return;
      const norm = normalizeModel(inst, 0.4, { upAxis: 'z' });
      norm.wrap.position.y = -0.52;
      norm.wrap.rotation.y = this.index * 0.73;
      for (const child of this.group.children) child.visible = false;
      this.group.add(norm.wrap);
      this.realModel = norm.wrap;
      if (this.halo) this.halo.material.opacity = 0.035;
    } catch (e) { console.warn('[food] sorrel fallback:', e); }
  }

  update(dt) {
    if (this.taken || !this.group) return;
    this._t += dt;
    const bob = Math.sin(this._t * 2.2) * (this.herbivore ? 0.035 : 0.06);
    this.group.position.y = terrainHeight(this.x, this.z) + 0.52 + bob;
    if (this.halo) this.halo.material.opacity = (this.herbivore ? 0.1 : 0.08) + Math.sin(this._t * 2.6) * (this.herbivore ? 0.04 : 0.04);
    this.group.rotation.y += dt * (this.herbivore ? 0.18 : 0.35);
    if (this.linoleicRing) {
      this.linoleicRing.material.opacity = 0.22 + Math.sin(this._t * 2.8) * 0.1;
    }
  }

  take() {
    this.taken = true;
    this.group.visible = false;
  }

  reset() {
    this.taken = false;
    this.group.visible = true;
  }

  /**
   * 从场景移除并释放自建几何/材质。
   * dev 版每关按当季植物重建采食点，旧实例必须 dispose ——
   * 否则每过一关都会向场景泄漏一整组 Group（几何体与材质也无法回收）。
   */
  dispose(scene = this.scene) {
    if (!scene || !this.group) return;
    scene.remove(this.group);
    this.group.traverse((o) => {
      // 只释放本类自建的基础几何；材质按引用计数难以精确区分，
      // 这里每实例都 new 了自己的材质，直接释放是安全的。
      if (o.geometry) o.geometry.dispose?.();
      if (o.material) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) m.dispose?.();
      }
    });
    this.group = null;
    this.scene = null;
  }
}

/**
 * 伙伴土拨鼠：需要被救援并带回洞穴。
 * 被救后跟随玩家，带回洞穴才算完成救援目标。
 */
export class Companion {
  constructor(scene, { resolvePlacement = null } = {}) {
    // 与藏狐同样的三层结构：容器 / 程序化 / 真实模型是**兄弟**。
    // 早期版本把 mesh 直接当程序化模型，再把真实模型 add 成它的子节点，
    // 然后 `mesh.visible = false` —— 结果连真实模型一起隐藏，伙伴凭空消失。
    this.group = new THREE.Group();
    this.mesh = new THREE.Group();               // 容器
    this.proceduralMesh = buildMarmotMesh(0xa8c88a);  // L2 回退
    this.mesh.add(this.proceduralMesh);
    this.realModel = null;
    this.group.add(this.mesh);
    scene.add(this.group);
    this.scene = scene;
    this.resolvePlacement = typeof resolvePlacement === 'function' ? resolvePlacement : null;
    this.x = 0; this.z = 0;
    this.rescued = false;
    this.saved = false;
    this._t = 0;
    this.emote = null;
    this.emoteTimer = 0;
    // 模型加载级别：'procedural' | 'full' | 'geometry-only'
    this.modelLevel = 'procedural';
    this._loadRealModel();
  }

  /**
   * 换成真实的土拨鼠摄影测量模型。
   *
   * 与藏狐同一套分级回退（详见 models/loader.js）：
   *   L0 完整 → L1 仅几何（贴图坏，退纯色）→ L2 程序化建模
   * 关键同样是**验证真实模型可用后才隐藏程序化版本**。
   */
  async _loadRealModel() {
    // USE_REAL_MODELS 是布尔（version.js 里由 ?models=off 解析），
    // 早期写成 `=== 'off'` 恒为 false，导致该开关对伙伴完全失效。
    if (!USE_REAL_MODELS) return;
    try {
      const inst = await instantiateMarmot(devOn('screamingMarmot'));
      if (!inst) { this.modelLevel = 'procedural'; return; }

      // 归一化姿态：脚底贴地、面朝 +Z。
      // **upAxis: 'z'** —— marmot.glb 的原始包围盒是 X=0.535 Y=0.897 Z=0.720，
      // Y 就是最大轴，说明土拨鼠**本来就是正立的**，不能像藏狐那样绕 Z 转 90°。
      // 目标高度 0.75 与程序化版本（head.y=0.62 + 头高）对齐，避免切换时跳变。
      const norm = normalizeModel(inst, 0.75, { upAxis: 'z' });
      if (devOn('screamingMarmot')) tintMarmot(norm.wrap);
      this.mesh.add(norm.wrap);
      this.realModel = norm.wrap;
      this.modelLevel = inst.userData.level || 'full';

      // 验证可见性与尺寸，避免"显示了一个算错的模型"
      this.realModel.updateMatrixWorld(true);
      const rb = new THREE.Box3().setFromObject(this.realModel);
      const rs = rb.getSize(new THREE.Vector3());
      const ok = rs.x > 1e-3 && rs.y > 1e-3 && rs.z > 1e-3 && rs.y < 5;
      if (!ok) {
        console.warn('[companion] 真实模型尺寸异常，保留程序化版本:', rs.toArray().map((v) => v.toFixed(3)));
        this.mesh.remove(norm.wrap);
        this.realModel = null;
        this.modelLevel = 'procedural';
        return;
      }

      // 只有验证通过才切换（两者是兄弟节点，互不影响）
      this._restoreVisibility();
    } catch (e) {
      console.warn('[companion] 真实模型不可用，使用程序化建模', e);
      this.modelLevel = 'procedural';
      if (this.proceduralMesh) this.proceduralMesh.visible = true;
    }
  }

  placeAt(x, z, y = null) {
    this.x = x; this.z = z;
    this.rescued = false;
    this.saved = false;
    this._restoreVisibility();
    this.emote = null;
    this.sync(y);
  }

  /**
   * 按当前模型级别恢复可见性.
   *
   * 不能简单地 `mesh.visible = true` —— 那会把"是否该显示真实模型"
   * 和"是否该显示程序化版本"两件事混在一个开关上，
   * 结果是两者要么同时显示（重叠）或同时消失。
   */
  _restoreVisibility() {
    if (!this.group) return;
    this.group.visible = true;
    const useReal = !!this.realModel;
    if (this.proceduralMesh) this.proceduralMesh.visible = !useReal;
    if (this.realModel) this.realModel.visible = useReal;
  }

  sync(y = null) {
    const ground = this.resolvePlacement?.(this.x, this.z);
    const groundY = Number.isFinite(y) ? y : Number.isFinite(ground?.y) ? ground.y : terrainHeight(this.x, this.z);
    if (ground) { this.x = ground.x; this.z = ground.z; }
    this.group.position.set(this.x, groundY, this.z);
  }

  showEmote(kind) {
    this.emote = kind;
    this.emoteTimer = 2.2;
  }

  update(dt, playerPos, safe) {
    const prevX = this.x, prevZ = this.z;
    this._t += dt;
    if (this.emoteTimer > 0) {
      this.emoteTimer -= dt;
      if (this.emoteTimer <= 0) this.emote = null;
    }

    if (this.rescued && !this.saved) {
      const dx = playerPos.x - this.x, dz = playerPos.z - this.z;
      const d = Math.hypot(dx, dz);
      if (d > 1.5) {
        this.x += (dx / d) * 7.2 * dt;
        this.z += (dz / d) * 7.2 * dt;
      }
      this.mesh.rotation.y = Math.atan2(dx, dz);
    } else if (!this.rescued) {
      this.mesh.rotation.y = Math.atan2(playerPos.x - this.x, playerPos.z - this.z);
    }

    let ground = this.resolvePlacement?.(this.x, this.z);
    if (this.resolvePlacement && !ground) { this.x = prevX; this.z = prevZ; ground = this.resolvePlacement(this.x, this.z); }
    else if (ground) { this.x = ground.x; this.z = ground.z; }
    const y = Number.isFinite(ground?.y) ? ground.y : terrainHeight(this.x, this.z);
    const bob = this.rescued && !this.saved
      ? Math.abs(Math.sin(this._t * 7)) * 0.09
      : Math.sin(this._t * 2) * 0.03;
    this.group.position.set(this.x, y + bob, this.z);

    if (this.emote) this._drawEmote();
    else if (this.hintMesh) { this.hintMesh.visible = false; }
  }

  _drawEmote() {
    if (!this.hintMesh) {
      const g = new THREE.Group();
      const mat = new THREE.SpriteMaterial({ color: 0xffe9a8, transparent: true, opacity: 0.95, depthTest: false });
      const s = new THREE.Sprite(mat);
      s.scale.set(0.5, 0.5, 0.5);
      s.renderOrder = 20;
      g.add(s);
      this.mesh.add(g);
      this.hintMesh = g;
      this.hintSprite = s;
    }
    this.hintMesh.visible = true;
    this.hintMesh.position.y = 1.15 + Math.sin(this._t * 4) * 0.08;
    const c = this.emote === 'exclaim' ? 0xff6a5a : 0x8fe8b0;
    this.hintSprite.material.color.setHex(c);
    this.hintSprite.scale.setScalar(0.42 + Math.sin(this._t * 9) * 0.06);
  }

  reset() {
    this.rescued = false;
    this.saved = false;
    this._restoreVisibility();
  }
}

/**
 * 通用土拨鼠模型（伙伴用）。玩家自己是第一人称，看不到自己，
 * 所以模型只需服务伙伴 —— 但保持可爱、有辨识度。
 */
export function buildMarmotMesh(furColor = 0xa9834e) {
  const g = new THREE.Group();
  const fur = new THREE.MeshStandardMaterial({ color: furColor, roughness: 0.95 });
  const belly = new THREE.MeshStandardMaterial({ color: 0xe8dcc0, roughness: 0.95 });

  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 0.36, 4, 12), fur);
  body.rotation.x = Math.PI / 2.1;
  body.position.y = 0.36;
  body.castShadow = true;
  g.add(body);

  const bellyMesh = new THREE.Mesh(new THREE.SphereGeometry(0.24, 10, 8), belly);
  bellyMesh.position.set(0, 0.22, 0.14);
  bellyMesh.scale.set(0.85, 0.7, 1);
  g.add(bellyMesh);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.24, 14, 12), fur);
  head.position.set(0, 0.62, 0.24);
  head.castShadow = true;
  g.add(head);

  const snout = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.2, 8), belly);
  snout.rotation.x = Math.PI / 2;
  snout.position.set(0, 0.56, 0.44);
  g.add(snout);

  const nose = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 8),
    new THREE.MeshStandardMaterial({ color: 0x3a2a22, roughness: 0.5 }));
  nose.position.set(0, 0.58, 0.53);
  g.add(nose);

  for (const s of [-1, 1]) {
    const ear = new THREE.Mesh(new THREE.SphereGeometry(0.075, 8, 8), fur);
    ear.position.set(s * 0.18, 0.74, 0.2);
    g.add(ear);
  }

  for (const s of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 8),
      new THREE.MeshStandardMaterial({ color: 0x241812, roughness: 0.25 }));
    eye.position.set(s * 0.11, 0.66, 0.42);
    g.add(eye);
  }

  const legGeo = new THREE.CylinderGeometry(0.06, 0.05, 0.2, 6);
  const frontArms = {};
  for (const [sx, sz] of [[-1, 1], [1, 1], [-1, -1], [1, -1]]) {
    const leg = new THREE.Mesh(legGeo, fur);
    leg.position.set(sx * 0.16, 0.1, sz * 0.16);
    g.add(leg);
    if (sz > 0) frontArms[sx < 0 ? 'left' : 'right'] = leg;
  }
  g.userData.frontArms = frontArms;

  const tail = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 8), fur);
  tail.position.set(0, 0.2, -0.32);
  g.add(tail);

  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return g;
}
