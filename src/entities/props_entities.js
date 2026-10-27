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
import { USE_REAL_MODELS, IS_BETA } from '../core/version.js';
import { BETA_TUNE } from '../core/beta-tuning.js';
import { MARMOT_CLIPS, marmotClipForState, animationTransition } from './marmot-rig.js';

/** 真实土拨鼠模型（与藏狐同一套分级回退，见 models/loader.js） */
const instantiateMarmot = () => instantiate('./assets/models/marmot.glb', 'marmot');
const instantiateMarmotRig = () => instantiate('./assets/models/marmot-rig.glb', 'marmot');
import { devOn } from '../core/version.js';
import { FORAGE } from '../core/ecology.js';

export class Food {
  /**
   * @param plant dev 版传入植物定义 {name,color,leaf,moisture,linoleic}
   */
  constructor(scene, x, z, index, plant = null, kind = null) {
    this.x = x; this.z = z; this.index = index;
    this.taken = false;
    this.plant = plant;
    this.herbivore = devOn('herbivoreFood') && !!plant;
    this.kind = kind || (this.herbivore ? 'grass' : 'berry');
    this.respawnIn = 0;
    this.group = new THREE.Group();
    this.lift = IS_BETA && this.kind === 'flower' ? 0 : 0.52;
    this.group.position.set(x, terrainHeight(x, z) + this.lift, z);

    if (this.kind === 'flower') this._buildFlower();
    else if (this.herbivore) this._buildHerb();
    else this._buildBerry();

    scene.add(this.group);
    this._t = Math.random() * 6;
    this.scene = scene;
  }

  _buildFlower() {
    const color = this.plant?.color ?? 0xf2c45c;
    const petalMat = new THREE.MeshStandardMaterial({ color, roughness: 0.7, emissive: color, emissiveIntensity: 0.16 });
    const centerMat = new THREE.MeshStandardMaterial({ color: 0xf4d77a, roughness: 0.8, emissive: 0x4a3210, emissiveIntensity: 0.2 });
    const petal = new THREE.SphereGeometry(0.075, 8, 6);
    for (let i = 0; i < 6; i++) {
      const a = i * Math.PI / 3;
      const m = new THREE.Mesh(petal, petalMat);
      m.position.set(Math.cos(a) * 0.12, 0.2, Math.sin(a) * 0.12);
      m.scale.set(1, 0.55, 1);
      this.group.add(m);
    }
    const c = new THREE.Mesh(new THREE.SphereGeometry(0.065, 8, 6), centerMat);
    c.position.y = 0.2; this.group.add(c);
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.018, 0.25, 6), new THREE.MeshStandardMaterial({ color: 0x6c8a45, roughness: 0.9 }));
    stem.position.y = 0.03; this.group.add(stem);
    const halo = new THREE.Mesh(new THREE.CircleGeometry(0.42, 16), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.13, depthWrite: false }));
    halo.rotation.x = -Math.PI / 2; halo.position.y = IS_BETA ? 0.02 : -0.5; this.group.add(halo); this.halo = halo;
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

  update(dt) {
    if (this.taken) {
      if (Number.isFinite(this.respawnIn)) {
        this.respawnIn -= Math.max(0, dt);
        if (this.respawnIn <= 0) this.reset();
      }
      return;
    }
    this._t += dt;
    const bob = Math.sin(this._t * 2.2) * (IS_BETA && this.kind === 'flower' ? 0.012 : (this.herbivore ? 0.035 : 0.06));
    this.group.position.y = terrainHeight(this.x, this.z) + this.lift + bob;
    this.halo.material.opacity = (this.herbivore ? 0.1 : 0.08) + Math.sin(this._t * 2.6) * (this.herbivore ? 0.04 : 0.04);
    this.group.rotation.y += dt * (this.herbivore ? 0.18 : 0.35);
    if (this.linoleicRing) {
      this.linoleicRing.material.opacity = 0.22 + Math.sin(this._t * 2.8) * 0.1;
    }
  }

  take() {
    this.taken = true;
    this.respawnIn = this.kind === 'grass' ? FORAGE.regrowGrass : Infinity;
    this.group.visible = false;
  }

  reset() {
    this.taken = false;
    this.respawnIn = 0;
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
  constructor(scene) {
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
    this.x = 0; this.z = 0;
    this.rescued = false;
    this.saved = false;
    this._t = 0;
    this.emote = null;
    this.emoteTimer = 0;
    // 模型加载级别：'procedural' | 'full' | 'geometry-only'
    this.modelLevel = 'procedural';
    this.mixer = null;
    this.actions = new Map();
    this.activeClip = null;
    this._lastFollowSpeed = 0;
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
    if (!USE_REAL_MODELS) return;
    try {
      let inst = null;
      let rig = false;
      // Beta 专属绑定模型；stable/dev 保持既有静态路径。
      if (IS_BETA) {
        const candidate = await instantiateMarmotRig();
        const clips = candidate?.userData?.animations || [];
        const complete = MARMOT_CLIPS.every((name) => clips.some((clip) => clip.name === name));
        if (candidate && complete) { inst = candidate; rig = true; } else if (candidate) {
          candidate.traverse((o) => { o.geometry?.dispose?.(); });
        }
      }
      if (!inst) inst = await instantiateMarmot();
      if (!inst) { this.modelLevel = 'procedural'; return; }
      const norm = normalizeModel(inst, 0.75, { upAxis: 'native' });
      this.mesh.add(norm.wrap);
      this.realModel = norm.wrap;
      this.modelLevel = rig ? 'rig' : (inst.userData.level || 'full');
      this._rigRoot = inst;
      if (rig) this._setupRig(inst, inst.userData.animations || []);
      this._prepareMarmotMaterials(norm.wrap);
      this.realModel.updateMatrixWorld(true);
      const rb = new THREE.Box3().setFromObject(this.realModel);
      const rs = rb.getSize(new THREE.Vector3());
      if (!(rs.x > 1e-3 && rs.y > 1e-3 && rs.z > 1e-3 && rs.y < 5)) {
        console.warn('[companion] 真实模型尺寸异常，回退:', rs.toArray().map((v) => v.toFixed(3)));
        this._discardRealModel();
        return;
      }
      this._restoreVisibility();
    } catch (e) {
      console.warn('[companion] 绑定/静态土拨鼠不可用，使用程序化建模', e);
      this._discardRealModel();
    }
  }

  _prepareMarmotMaterials(root) {
    root.traverse((o) => {
      if (!o.isMesh) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        if (!m) continue;
        // GLB 只有 ORM 且默认 metallicFactor=1；没有环境贴图时会反射黑色。
        m.metalness = 0.08;
        m.roughness = Math.max(0.72, m.roughness || 0);
        m.needsUpdate = true;
      }
    });
  }

  _setupRig(root, clips) {
    this.mixer = new THREE.AnimationMixer(root);
    this.actions.clear();
    for (const clip of clips) this.actions.set(clip.name, this.mixer.clipAction(clip));
    this._setRigClip('Idle', true);
  }

  _setRigClip(name, immediate = false) {
    if (!this.mixer || !this.actions.has(name)) return false;
    const transition = animationTransition(this.activeClip, name, immediate ? 0.05 : 0.2);
    if (!transition.changed) return true;
    const next = this.actions.get(name);
    const prev = this.activeClip && this.actions.get(this.activeClip);
    if (prev) prev.fadeOut(transition.fade);
    next.reset().setEffectiveWeight(1).fadeIn(transition.fade).play();
    this.activeClip = name;
    return true;
  }

  _discardRealModel() {
    if (this.mixer) { this.mixer.stopAllAction(); this.mixer = null; }
    this.actions.clear(); this.activeClip = null;
    if (this.realModel) {
      this.mesh.remove(this.realModel);
      this.realModel.traverse((o) => {
        if (o.geometry) o.geometry.dispose?.();
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) { m?.dispose?.(); }
      });
    }
    this.realModel = null; this._rigRoot = null; this.modelLevel = 'procedural';
    this._restoreVisibility();
  }

  placeAt(x, z) {
    this.x = x; this.z = z;
    this.rescued = false;
    this.saved = false;
    this._restoreVisibility();
    this.emote = null;
    this.sync();
  }

  /**
   * 按当前模型级别恢复可见性。
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

  sync() {
    this.group.position.set(this.x, terrainHeight(this.x, this.z), this.z);
  }

  showEmote(kind) {
    this.emote = kind;
    this.emoteTimer = 2.2;
  }

  update(dt, playerPos, safe) {
    this._t += dt;
    if (this.emoteTimer > 0) {
      this.emoteTimer -= dt;
      if (this.emoteTimer <= 0) this.emote = null;
    }

    if (this.rescued && !this.saved) {
      const dx = playerPos.x - this.x, dz = playerPos.z - this.z;
      const d = Math.hypot(dx, dz);
      const follow = IS_BETA ? BETA_TUNE : null;
      if (d > (follow ? follow.companionFollowGap : 1.5)) {
        const speed = follow ? follow.companionFollowSpeed : 7.2;
        this.x += (dx / d) * speed * dt;
        this.z += (dz / d) * speed * dt;
        this._lastFollowSpeed = speed;
      }
      this.mesh.rotation.y = Math.atan2(dx, dz);
    } else if (!this.rescued) {
      this._lastFollowSpeed = 0;
      this.mesh.rotation.y = Math.atan2(playerPos.x - this.x, playerPos.z - this.z);
    }

    const speed = this._lastFollowSpeed;
    const clip = marmotClipForState({
      safe: !!safe,
      rest: !!this.saved,
      emote: this.emote,
      jump: this.emote === 'jump',
      mode: this.rescued && !this.saved ? 'follow' : 'idle',
    }, speed);
    this._setRigClip(clip);
    if (this.mixer) this.mixer.update(Math.max(0, dt));

    const y = terrainHeight(this.x, this.z);
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

  dispose(scene = this.scene) {
    if (this.mixer) { this.mixer.stopAllAction(); this.mixer.uncacheRoot(this._rigRoot || this.realModel); this.mixer = null; }
    this.actions.clear();
    if (scene && this.group) scene.remove(this.group);
    for (const root of [this.realModel, this.proceduralMesh]) root?.traverse((o) => {
      o.geometry?.dispose?.();
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) m?.dispose?.();
    });
    this.group = null; this.mesh = null; this.realModel = null; this.proceduralMesh = null; this.scene = null;
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
