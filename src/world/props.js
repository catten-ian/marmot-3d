/**
 * 洞穴（安全区）与地表物件：草丛、岩石、浆果灌木。
 * 洞穴是唯一的安全区：不可攻击、回储备、缓压，视觉上必须一眼可辨。
 */
import * as THREE from 'three';
import {
  ROCKS, BERRY_POINTS, FIELD_W, FIELD_H, BURROW,
  scalePoint, scaleCoord, scaleRadius, getPointScale,
} from '../core/config.js';
import { heightFieldActive } from '../core/utils.js';
import { terrainHeight, terrainNormal, makeRng } from '../core/utils.js';
import { devOn } from '../core/version.js';
import { undergroundProfile } from './underground.js';

/** 洞穴入口：土丘 + 洞口 + 内部暖光 + 地面光圈 */
export class Burrow {
  constructor(scene, pos) {
    this.group = new THREE.Group();
    this.pos = pos;
    // 半径取传入值（GS 版 main 已按 scaleRadius 缩放），不能写死 8.2，
    // 否则安全区视觉圈与实际碰撞/回储备范围对不上。
    this.r = pos.r ?? 8.2;
    this.type = pos.type || 'base';
    this.label = pos.label || (this.type === 'base' ? '大本营' : '临时避难洞');
    const isBase = this.type === 'base';
    const underground = undergroundProfile(pos);

    const y = terrainHeight(pos.x, pos.z);
    this.group.position.set(pos.x, y, pos.z);

    // 少量挖出土：只在井口外一圈形成低土环（用 Torus，不再用覆盖洞口的半球土丘）。
    const spoilGeo = new THREE.TorusGeometry(underground.slopeRadius * 0.96, isBase ? 0.34 : 0.2, 8, 32);
    spoilGeo.rotateX(Math.PI / 2);
    const spoilMat = new THREE.MeshStandardMaterial({ color: isBase ? 0x8a6238 : 0x6b7d79, roughness: 1 });
    const spoil = new THREE.Mesh(spoilGeo, spoilMat);
    spoil.position.y = 0.06;
    spoil.scale.y = 0.42;
    spoil.castShadow = true;
    spoil.receiveShadow = true;
    this.group.add(spoil);

    // 竖井井壁：开口（小，上）→ 腔室（略宽，下），向下扩开。
    // 从洞内/井口看需要看到内壁，故用 BackSide（看圆柱内表面）。
    // 加极弱暖色 emissive：进洞后全局光被压暗，井壁仍能读出泥土色与圆筒形，
    // 不至于死黑一片。
    const wallColor = isBase ? 0x2a1c10 : 0x16201f;
    const shaftGeo = new THREE.CylinderGeometry(
      underground.chamberRadius, underground.openingRadius,
      underground.chamberDepth, 24, 1, true,
    );
    const shaftMat = new THREE.MeshStandardMaterial({
      color: wallColor,
      emissive: isBase ? 0x4a2e10 : 0x0b1515,
      emissiveIntensity: isBase ? 1.35 : 0.5,
      roughness: 1,
      side: THREE.BackSide,
    });
    const shaft = new THREE.Mesh(shaftGeo, shaftMat);
    shaft.position.y = -underground.chamberDepth * 0.5;
    shaft.castShadow = false;
    shaft.receiveShadow = true;
    this.group.add(shaft);

    // 腔室地板（同样带暖色自发光底）。
    const floorGeo = new THREE.CircleGeometry(underground.chamberRadius, 28);
    const floorMat = new THREE.MeshStandardMaterial({
      color: isBase ? 0x3a2817 : 0x1a2423,
      emissive: isBase ? 0x3a2008 : 0x060c0c,
      emissiveIntensity: isBase ? 1.1 : 0.35,
      roughness: 1,
    });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -underground.chamberDepth + 0.02;
    floor.receiveShadow = true;
    this.group.add(floor);
    this.shaft = shaft;

    // 洞口内缘：一圈贴地的深色实环，圈出“开口”边界（不再悬空椭圆环）。
    const rimGeo = new THREE.RingGeometry(underground.openingRadius * 0.92, underground.slopeRadius * 0.98, 32);
    const rimMat = new THREE.MeshStandardMaterial({ color: isBase ? 0x1c1208 : 0x0e1515, roughness: 1, side: THREE.DoubleSide });
    const rim = new THREE.Mesh(rimGeo, rimMat);
    rim.rotation.x = -Math.PI / 2;
    rim.position.y = 0.03;
    rim.receiveShadow = true;
    this.group.add(rim);

    // 洞口黑封盖：地形网格无法在开口处真实挖洞（尤其 GS 高度场），
    // 在地表下方 6cm 盖一张近黑双面圆盘。地表侧看是深不见底的洞口，
    // 腔室内抬头时它遮住上方的绿色地形，只留黑暗的竖井。
    const mouthGeo = new THREE.CircleGeometry(underground.openingRadius * 0.97, 32);
    const mouthMat = new THREE.MeshStandardMaterial({
      // 极弱冷色自发光：从洞内抬头读成洞口漏下的微暗天光，不是死黑虚空；
      // 亮度很低，从地表看仍是深不见底的洞口。
      color: 0x050302, emissive: 0x182333, emissiveIntensity: 0.8,
      roughness: 1, side: THREE.DoubleSide,
    });
    const mouth = new THREE.Mesh(mouthGeo, mouthMat);
    mouth.rotation.x = -Math.PI / 2;
    mouth.position.y = -0.06;
    this.group.add(mouth);
    this.mouth = mouth;

    // 开口天光：洞口向下打的聚光灯，放宽光锥，照亮井壁上半部与地板。
    const shaftLight = new THREE.SpotLight(0xdfeaff, isBase ? 3.0 : 0.7, underground.chamberDepth + 4, 0.95, 0.9, 1.4);
    shaftLight.position.set(0, 0.3, 0);
    const shaftTarget = new THREE.Object3D();
    shaftTarget.position.set(0, -underground.chamberDepth * 0.55, 0);
    this.group.add(shaftTarget);
    shaftLight.target = shaftTarget;
    this.group.add(shaftLight);
    // 腔室中上部一盏弱暖填充：向上打亮整圈井壁，避免正前方井壁死黑、
    // 读不出“被圆筒腔室包围”。
    const wallFill = new THREE.PointLight(0xffb36b, isBase ? 3.2 : 0.4, underground.chamberRadius * 3.4, 2);
    wallFill.position.set(0, -underground.chamberDepth * 0.45, 0);
    this.group.add(wallFill);
    // 洞口附近一点冷色填充，模拟井口漏下来的漫反射。
    const skylight = new THREE.PointLight(0xbfd6ff, isBase ? 0.6 : 0.1, underground.slopeRadius * 3.2, 2);
    skylight.position.set(0, -0.4, 0);
    this.group.add(skylight);

    // 大本营：腔室底部暖光，从开口微微透出；临时洞仅极弱冷光。
    const glow = new THREE.PointLight(pos.lightColor ?? 0xffc978, pos.lightIntensity ?? (isBase ? 7.0 : 0.28), isBase ? 11 : 4, 2);
    glow.position.set(0, -underground.chamberDepth + 1.1, 0);
    this.group.add(glow);
    this.glow = glow;

// 安全区标识（仅大本营）：立式光柱 + 顶端悬浮环。
    // 早期版本用贴地平面圆环，在土拨鼠的贴地视角下会被透视压成一条
    // 横贯视野的亮线，反而看不见"这是一个圆形的家"。改用竖直光柱后，
    // 无论玩家站在圈内还是圈外，都能立刻辨认出安全区。
    if (isBase) {
      const beamGeo = new THREE.CylinderGeometry(this.r * 0.92, this.r * 0.98, 3.4, 40, 1, true);
      const beamMat = new THREE.MeshBasicMaterial({
        color: 0x7fe0a0, transparent: true, opacity: 0.085,
        side: THREE.DoubleSide, depthWrite: false,
      });
      const beam = new THREE.Mesh(beamGeo, beamMat);
      beam.position.y = 1.7;
      this.group.add(beam);
      this.beam = beam;

      // 顶部悬浮环：给远处一个可识别的"地标"
      const capGeo = new THREE.TorusGeometry(this.r * 0.94, 0.13, 8, 40);
      capGeo.rotateX(Math.PI / 2);
      const capMat = new THREE.MeshBasicMaterial({
        color: 0x9ff0b8, transparent: true, opacity: 0.45, depthWrite: false,
      });
      const cap = new THREE.Mesh(capGeo, capMat);
      cap.position.y = 3.4;
      this.group.add(cap);
      this.cap = cap;

      // 圈内地面微亮（保持极淡，仅在脚下近距离可见）
      const discGeo = new THREE.CircleGeometry(this.r * 0.94, 40);
      const discMat = new THREE.MeshBasicMaterial({
        color: 0x9fe8b8, transparent: true, opacity: 0.05, depthWrite: false,
      });
      const disc = new THREE.Mesh(discGeo, discMat);
      disc.rotation.x = -Math.PI / 2;
      disc.position.y = 0.07;
      this.group.add(disc);
    }

    scene.add(this.group);
    this._t = 0;
    this.isBase = isBase;
    this.underground = underground;
  }

  update(dt) {
    this._t += dt;
    if (!this.isBase) return; // 临时避难洞静态、无发光动画
    // 光柱与顶环呼吸，保持"活着"的地标感
    const p = 0.32 + Math.sin(this._t * 1.6) * 0.12;
    this.cap.material.opacity = p;
    this.beam.material.opacity = 0.07 + Math.sin(this._t * 1.6) * 0.025;
    // 顶环缓慢旋转 + 上下浮动
    this.cap.rotation.y += dt * 0.35;
    this.cap.position.y = 3.4 + Math.sin(this._t * 0.9) * 0.12;
    this.glow.intensity = 4.6 + Math.sin(this._t * 2.1) * 1.1;
  }
}

/**
 * 草地植被：InstancedMesh 草丛 + 岩石。
 * 土拨鼠视角贴地，草丛高度刻意压到 0.3m 以下，既有草原感又不挡视野。
 */
export class Scenery {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    scene.add(this.group);
    this._buildGrass();
    this._buildRocks();
    this._buildBushes();
    // 风的时间推进：用 rAF 绝对时间而非 dt 累加，暂停/切页也不会失步。
    // Scenery 全局单例（main.js 只 new 一次），常驻 rAF 不会累积泄漏；
    // 标题界面与暂停时风继续吹，环境保持"活着"。
    this._windTick = (now) => {
      if (this.windTime) this.windTime.value = now / 1000;
      this._windRaf = requestAnimationFrame(this._windTick);
    };
    this._windRaf = requestAnimationFrame(this._windTick);
  }

  _buildGrass() {
    const rng = makeRng(4471);
    // 单片草叶：细长四边形（顶窄底宽），比三角片更像草
    const blade = new THREE.BufferGeometry();
    blade.setAttribute('position', new THREE.Float32BufferAttribute([
      -0.035, 0, 0, 0.035, 0, 0, 0.008, 0.34, 0.02,
      -0.035, 0, 0, 0.008, 0.34, 0.02, -0.022, 0.26, 0.015,
    ], 3));
    blade.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({
      color: 0xffffff, roughness: 1, side: THREE.DoubleSide,
    });

    // —— 风摆：26000 株草逐顶点弯曲 ——
    // CPU 逐实例更新矩阵太慢（26000 × 每帧），改用 onBeforeCompile
    // 在顶点着色器里按**实例世界位置**生成相位差：每株草的摆动节奏
    // 都不同，避免整片草同步摇晃的"假草地"感。
    // 只弯叶尖（position.y≈0 的叶根不动），符合草叶受风姿态。
    // uWindTime 是共享 uniform，由 Scenery 的 rAF 自更新
    // （Scenery 在 main.js 是单例，只创建一次，不会泄漏）。
    const windTime = { value: 0 };
    this.windTime = windTime;
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uWindTime = windTime;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uWindTime;')
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          #ifdef USE_INSTANCING
            vec3 windOrigin = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
          #else
            vec3 windOrigin = vec3(0.0);
          #endif
          float windPhase = windOrigin.x * 0.31 + windOrigin.z * 0.24;
          float windAmp = sin(uWindTime * 1.5 + windPhase) * 0.6
                        + sin(uWindTime * 2.7 + windPhase * 1.63) * 0.4;
          float windBend = clamp(position.y / 0.34, 0.0, 1.0);
          transformed.x += windAmp * windBend * 0.14;
          transformed.z += windAmp * windBend * 0.09;`
        );
    };

    const COUNT = 26000;
    const mesh = new THREE.InstancedMesh(blade, mat, COUNT);
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);

    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const n = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    const scaleV = new THREE.Vector3();
    const posV = new THREE.Vector3();
    const color = new THREE.Color();
    const greens = [0x7d9b5e, 0x8fae6b, 0x6f8f55, 0x9cbb74, 0x88a45f];

    let i = 0;
    let guard = 0;
    while (i < COUNT && guard < COUNT * 6) {
      guard++;
      // 覆盖到竞技场之外，让远处过渡带也有草
      const x = (rng() - 0.5) * 200;
      const spanZ = 150 * getPointScale();
      const z = (rng() - 0.5) * spanZ;
      // 洞穴附近不长草，保持干净。洞穴位置/半径随运行时缩放，
      // 不能硬编码 (x+52) —— GS 版洞穴在 BURROW.x*K，会对不上。
      const burrowX = scaleCoord(BURROW.x, 'x');
      const burrowZ = scaleCoord(BURROW.z, 'z');
      if (Math.hypot(x - burrowX, z - burrowZ) < scaleRadius(11)) continue;
      // 竞技场边界外逐渐稀疏，避免"整齐的草皮边缘"
      const K = getPointScale();
      const edge = Math.max(Math.abs(x) - FIELD_W / 2 * K, Math.abs(z) - FIELD_H / 2 * K, 0);
      if (edge > 0 && rng() > Math.max(0, 1 - edge / 50)) continue;
      const y = terrainHeight(x, z);
      terrainNormal(x, z, n);
      q.setFromUnitVectors(up, n);
      const yaw = new THREE.Quaternion().setFromAxisAngle(up, rng() * Math.PI * 2);
      q.multiply(yaw);
      // 高度刻意压低：土拨鼠视角必须能看清前方的藏狐预警条
      const s = 0.55 + rng() * 0.5;
      scaleV.set(s, s * (0.55 + rng() * 0.4), s);
      posV.set(x, y, z);
      m.compose(posV, q, scaleV);
      mesh.setMatrixAt(i, m);
      color.setHex(greens[(rng() * greens.length) | 0]);
      color.offsetHSL(0, 0, (rng() - 0.5) * 0.08);
      mesh.setColorAt(i, color);
      i++;
    }
    mesh.count = i;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    this.grass = mesh;
    this.group.add(mesh);
  }

  _buildRocks() {
    const rng = makeRng(881);
    this.rockColliders = [];
    const geo = new THREE.IcosahedronGeometry(1, 1);
    // 偏暖的土褐色，与草原协调；不用冷灰
    const mat = new THREE.MeshStandardMaterial({ color: 0x9c9078, roughness: 0.96 });
    const matDark = new THREE.MeshStandardMaterial({ color: 0x8a7f68, roughness: 0.98 });

    for (const rp of ROCKS) {
      // GS 全场景下点位范围会缩小，岩石必须跟着缩，否则会落在可行走区之外
      const [x, z] = scalePoint(rp);
      const r = scaleRadius(rp[2]);
      const mesh = new THREE.Mesh(geo, rng() > 0.5 ? mat : matDark);
      // 压扁嵌入地面，避免"漂浮巨石"的观感
      mesh.position.set(x, terrainHeight(x, z) + r * 0.22, z);
      mesh.scale.set(r, r * (0.5 + rng() * 0.28), r * (0.75 + rng() * 0.3));
      mesh.rotation.set(rng() * 0.4, rng() * Math.PI, rng() * 0.3);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.group.add(mesh);
      this.rockColliders.push({ x, z, r: r * 0.92 });
    }

    // 远处零散装饰石，不参与碰撞
    const far = new THREE.InstancedMesh(geo, matDark, 40);
    const m = new THREE.Matrix4();
    for (let i = 0; i < 40; i++) {
      const a = rng() * Math.PI * 2;
      const rad = 78 + rng() * 45;
      const x = Math.cos(a) * rad, z = Math.sin(a) * rad * 0.8;
      const s = 1.2 + rng() * 3.4;
      m.compose(
        new THREE.Vector3(x, terrainHeight(x, z) + s * 0.15, z),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(rng(), rng() * 6, rng())),
        new THREE.Vector3(s, s * 0.45, s),
      );
      far.setMatrixAt(i, m);
    }
    far.castShadow = false;
    this.group.add(far);
  }

  /**
   * 灌木丛：浆果的视觉载体，采食后会消失。
   * dev 版（草本食性）下这些灌木会整体隐藏 —— 主角吃的是草本植物，
   * 不该出现灌木丛来误导玩家。
   */
  _buildBushes() {
    const bushGeo = new THREE.IcosahedronGeometry(1, 1);
    const bushMat = new THREE.MeshStandardMaterial({ color: 0x4f7038, roughness: 1 });
    this.bushes = [];
    this.bushGroup = new THREE.Group();
    this.bushGroup.visible = !devOn('herbivoreFood');
    this.group.add(this.bushGroup);
    for (const bp of BERRY_POINTS) {
      const [x, z] = scalePoint(bp);
      const g = new THREE.Group();
      const y = terrainHeight(x, z);
      const n = 3 + ((x * 7 + z * 3) % 2 | 0);
      for (let i = 0; i < n; i++) {
        const s = 0.38 + Math.random() * 0.3;
        const b = new THREE.Mesh(bushGeo, bushMat);
        b.position.set((Math.random() - 0.5) * 0.9, s * 0.72, (Math.random() - 0.5) * 0.9);
        b.scale.set(s, s * 0.82, s);
        b.castShadow = true;
        g.add(b);
      }
      g.position.set(x, y, z);
      this.bushGroup.add(g);
      this.bushes.push({ x, z, group: g });
    }
  }

  /** 采食后隐藏对应的灌木 */
  setBerryTaken(index) {
    const b = this.bushes[index];
    if (b) b.group.scale.setScalar(0.001);
  }

  resetBerries() {
    this.bushes.forEach((b) => b.group.scale.setScalar(1));
  }
}
