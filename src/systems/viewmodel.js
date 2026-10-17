/**
 * 第一人称 viewmodel：显示玩家自己的爪子与腿。
 *
 * 为什么必须用独立场景 + 独立相机渲染（而不是直接挂在主相机下）：
 *   主相机的 near 是 0.05、far 很大，且场景里有地形、岩石。
 *   如果把爪子放进主场景，爪子会与地面/岩石发生深度穿插，
 *   尤其在贴地视角（eyeHeight 0.46m）下几乎必然穿模。
 *   独立场景渲染可以彻底避免深度冲突，这是 FPS 游戏的通行做法。
 *
 * 姿态联动：
 *   · 站立(crouch≈0)：爪子收在胸前偏下，看向自己的前爪
 *   · 俯伏冲刺(crouch≈1)：爪子前伸、压低，模拟四肢着地奔跑
 *   · 跳跃：前爪上抬
 */
import * as THREE from 'three';
import { clamp } from '../core/utils.js';

export class ViewModel {
  constructor() {
    // 独立场景与相机（FOV 较窄，让 viewmodel 看起来更"贴近身体"）
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(52, 1, 0.01, 6);

    // 打光：viewmodel 独立场景要有自己的光照
    this.scene.add(new THREE.AmbientLight(0xbfcfb8, 1.15));
    const key = new THREE.DirectionalLight(0xfff2d8, 1.5);
    key.position.set(0.5, 1.2, 0.8);
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0x9fb8c8, 0.55);
    fill.position.set(-0.8, -0.2, 0.4);
    this.scene.add(fill);

    this.root = new THREE.Group();
    this.scene.add(this.root);

    this.legs = buildLegs();
    this.paws = buildPaws();
    this.belly = buildBelly();
    this.root.add(this.belly, this.legs, this.paws);

    this.t = 0;
    this.lookPitch = 0;
  }

  resize(aspect) {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  /**
   * @param dt       帧间隔
   * @param crouch   姿态 0~1（0=站立，1=俯伏）
   * @param speedRatio 速度比（用于跑动摆动）
   * @param airborne  是否在空中
   * @param attackAnim 攻击动画进度 0~1（1=刚挥出，0=结束），无则传 -1
   * @param pitch    玩家俯仰（弧度，负=向下看），驱动身体相机同步俯视
   * @param moveType 动作类型 ''|tap|stand|lunge|dodge
   */
  update(dt, crouch, speedRatio, airborne, attackAnim = -1, pitch = 0, moveType = '') {
    this.t += dt * (0.2 + Math.max(0, speedRatio) * 1.8);

    /**
     * 身体相机跟随主视角俯仰。
     *
     * 之前相机恒为水平，导致无论怎么低头看到的都是同一组"贴在准星下方"的
     * 手和腿。正确做法是让 viewmodel 相机同步 pitch：低头时视线落到自己
     * 身上，抬头时身体自然沉出视野下缘。
     * 只取主视角 pitch 的主要部分，不含攻击镜头冲击，避免挥爪时画面乱晃。
     */
    const look = clamp(pitch, -1.15, 1.05);
    this.lookPitch += (look - this.lookPitch) * 0.35;
    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.x = this.lookPitch * 0.82;
    this.camera.rotation.y = 0;
    this.camera.rotation.z = 0;

    /**
     * 布局计算：viewmodel 相机的 FOV 只有 52°，在 z=-0.5 处画面的
     * 垂直可视范围仅约 ±0.24m，水平约 ±0.48m。所以爪子/腿必须放在
     * y ∈ [-0.22, -0.06]、z ≈ -0.5 这个区间内，否则会被挤出画面。
     * 腹部要更低更靠后，才能在低头时先看到肚子、再看到脚。
     */
    const baseY = -0.19 - crouch * 0.055; // 俯伏时明显压低，低头可见前肢着地
    const baseZ = -0.5 - crouch * 0.075; // 俯伏时身体前探，避免掌部悬浮在胸前

    // 跑动时整体轻微上下起伏
    const bob = Math.sin(this.t * (8 + speedRatio * 4)) * 0.007 * (speedRatio + crouch);

    this.root.position.set(0, baseY + bob + (airborne ? 0.024 : 0), baseZ);
    this.root.rotation.set(0, 0, 0);

    // 俯伏时整体前倾（像四肢着地）
    const lean = crouch * 0.3;
    this.root.rotation.x = -lean * 0.6;

    // ---- 前肢与前爪 ----
    const p = this.paws;
    const running = crouch * clamp(speedRatio * 1.4, 0, 1);
    const pawSpread = 0.09 - crouch * 0.015;
    const stride = Math.sin(this.t * 8);
    const contact = airborne ? 0 : running;
    p.position.y = -0.01 + (airborne ? 0.032 : 0);
    p.position.z = -0.16 * running + (airborne ? 0.035 : 0);
    p.rotation.x = -0.12 + running * 0.16;
    p.scale.setScalar(0.68);

    // 前臂从画面下缘接入腕部；俯伏时伸长前探，脚掌压向地面。
    for (const side of [-1, 1]) {
      const arm = p.userData.arms[side < 0 ? 'left' : 'right'];
      const paw = p.userData[side < 0 ? 'left' : 'right'];
      const phase = side * stride;
      const reach = contact * phase * 0.105;
      const lift = contact * Math.max(0, -phase) * 0.018;
      paw.position.set(side * pawSpread, -0.014 + lift, -0.045 - reach);
      // 指爪朝前伸；着地时掌背朝上、肉垫朝下，而不是朝向玩家。
      paw.rotation.set(-0.12 + contact * 0.08 + phase * running * 0.1, 0, -side * (0.08 + running * 0.035));
      arm.position.set(side * 0.112, -0.09 - lift, 0.125 - reach * 0.35);
      arm.rotation.set(-0.22 + running * 0.12 + phase * running * 0.16, 0, side * 0.08);
      arm.scale.set(1, 1 + running * 0.08, 1 + running * 0.36);
      if (airborne) {
        paw.position.y += 0.028;
        paw.rotation.x -= 0.16;
      }
    }

    // 攻击动作：按类型做不同爪姿，都能在第一人称看到。
    if (attackAnim >= 0) {
      const k = 1 - attackAnim; // 0=刚挥出 1=收回
      const ease = Math.sin(Math.min(1, k) * Math.PI);
      if (moveType === 'stand') {
        // 迎击：双爪交叉向前短促硬顶（防御反打姿态）。
        p.position.z -= ease * 0.07;
        p.rotation.x -= ease * 0.22;
        const L = p.userData.left, R = p.userData.right;
        if (L && R) { L.position.x = -0.03; R.position.x = 0.03; L.rotation.z = 0.5 * ease; R.rotation.z = -0.5 * ease; }
      } else if (moveType === 'lunge') {
        // 扑咬：身体大幅前探、双爪前伸下压（明显的“扑”）。
        p.position.z -= ease * 0.22;
        p.position.y += ease * 0.05;
        p.rotation.x -= ease * 0.62;
        this.root.rotation.x -= ease * 0.18;
      } else if (moveType === 'dodge') {
        // 翻滚：身体侧倾收肢（动作较短）。
        this.root.rotation.z += ease * 0.5;
        p.position.y -= ease * 0.02;
      } else {
        // 推击：爪子向前挥推。
        p.position.z -= ease * 0.12;
        p.position.y += ease * 0.022;
        p.rotation.x -= ease * 0.4;
      }
    }

    // ---- 腹部 / 躯干：低头时的主要参照 ----
    // 放在身体空间的低位偏后（+z 为身后），玩家向下看时先看到浅色腹面，
    // 而不是只看到两根悬在准星下的手臂。
    const belly = this.belly;
    belly.position.set(0, -0.075 - crouch * 0.02, 0.16 + crouch * 0.03);
    belly.rotation.x = -0.5 + crouch * 0.42;
    belly.scale.set(0.72 - crouch * 0.05, 0.66, 0.78 + crouch * 0.1);

    // ---- 后腿：从身体中后段探出，俯伏时前移（模拟四肢着地）----
    const L = this.legs.userData;
    this.legs.scale.setScalar(0.8);
    const legSwing = Math.sin(this.t * (9 + speedRatio * 6)) * 0.03 * (speedRatio + crouch * 0.6);
    // 低头俯视时腿要更靠前（相机向下看，靠近脚下才看得见）
    const lookDown = clamp(-this.lookPitch / 1.05, 0, 1);
    const legZ = 0.09 - crouch * 0.04 - lookDown * 0.055;
    if (L.left && L.right) {
      L.left.rotation.x = 0.2 + crouch * 0.45 + legSwing;
      L.right.rotation.x = 0.2 + crouch * 0.45 - legSwing;
      L.left.position.set(-0.1, -0.06 + lookDown * 0.012, legZ);
      L.right.position.set(0.1, -0.06 + lookDown * 0.012, legZ);
    }
    // 腾空时腿收起
    if (airborne && L.left) {
      L.left.rotation.x -= 0.3;
      L.right.rotation.x -= 0.3;
    }
  }

  /**
   * 叠加渲染到主画面之上。
   *
   * 关键点：three.js 的 renderer 默认 autoClear=true，每次 render() 都会清空
   * 颜色缓冲。如果直接第二次 render()，主场景会被整个擦掉（画面全黑）。
   * 正确做法是关掉 autoClear，只手动清深度 —— 这样颜色保留、深度重置，
   * viewmodel 就能稳定画在最上层且不会与地形穿插。
   */
  render(renderer) {
    const prevAutoClear = renderer.autoClear;
    renderer.autoClear = false;
    // 只清深度，颜色保留主场景的结果
    renderer.clearDepth();
    renderer.render(this.scene, this.camera);
    renderer.autoClear = prevAutoClear;
  }
}

/** 土拨鼠毛色（与伙伴模型一致的写实土黄褐） */
function makeMarmotMaterials() {
  return {
    fur: new THREE.MeshStandardMaterial({ color: 0xa9834e, roughness: 0.92 }),
    belly: new THREE.MeshStandardMaterial({ color: 0xd8c9a4, roughness: 0.95 }),
    claw: new THREE.MeshStandardMaterial({ color: 0x3a2f26, roughness: 0.6 }),
    pad: new THREE.MeshStandardMaterial({ color: 0x6b5340, roughness: 0.8 }),
  };
}

/**
 * 前爪：掌部 + 四根短趾 + 爪尖。
 * viewmodel 里爪子的辨识度靠"短粗趾 + 深色爪尖"，要贴近真实土拨鼠而非猫科。
 */
function buildPaws() {
  const g = new THREE.Group();
  const M = makeMarmotMaterials();

  const buildArm = () => {
    const arm = new THREE.Group();
    const upper = new THREE.Mesh(new THREE.CapsuleGeometry(0.042, 0.2, 5, 10), M.fur);
    upper.rotation.x = -Math.PI / 2;
    upper.position.z = 0.095;
    arm.add(upper);
    const wrist = new THREE.Mesh(new THREE.SphereGeometry(0.038, 12, 10), M.fur);
    wrist.position.z = -0.012;
    wrist.scale.set(1, 0.9, 1.15);
    arm.add(wrist);
    return arm;
  };

  const mk = () => {
    const paw = new THREE.Group();

    // 掌部背面朝上，手指自然向前伸展。
    const palm = new THREE.Mesh(new THREE.SphereGeometry(0.048, 12, 10), M.fur);
    palm.scale.set(1.1, 0.56, 1.2);
    paw.add(palm);

    // 肉垫位于掌底，着地时朝向地面。
    const pad = new THREE.Mesh(new THREE.SphereGeometry(0.03, 10, 8), M.pad);
    pad.position.set(0, -0.023, -0.008);
    pad.scale.set(1.05, 0.38, 1.2);
    paw.add(pad);

    const fingerGeo = new THREE.CapsuleGeometry(0.016, 0.084, 3, 8);
    const clawGeo = new THREE.ConeGeometry(0.013, 0.05, 6);
    const lens = [-0.036, -0.012, 0.012, 0.036];
    const scale = [0.78, 1.05, 1.05, 0.8];
    for (let i = 0; i < 4; i++) {
      const f = new THREE.Mesh(fingerGeo, M.fur);
      f.position.set(lens[i], -0.002, -0.062 * scale[i]);
      f.rotation.x = -Math.PI / 2 + 0.42;
      f.scale.setScalar(scale[i]);
      paw.add(f);

      const c = new THREE.Mesh(clawGeo, M.claw);
      c.position.set(lens[i], -0.012, -0.115 * scale[i]);
      c.rotation.x = -Math.PI / 2 + 0.14;
      paw.add(c);
    }
    return paw;
  };

  const left = mk();
  const right = mk();
  const leftArm = buildArm();
  const rightArm = buildArm();
  g.add(leftArm, rightArm, left, right);
  g.userData.left = left;
  g.userData.right = right;
  g.userData.arms = { left: leftArm, right: rightArm };
  return g;
}

/**
 * 腹部 / 躯干下缘。
 *
 * 贴地第一人称的关键参照物：视高只有 0.46m，玩家低头时视线就在自己
 * 身体上方，于是"脚下有身体"这件事必须靠这个浅色腹面来交代，
 * 否则画面里永远只有两根悬空的手臂。
 * 形状刻意做得比真实躯干更扁、更宽，避免在窄 FOV 下糊住整个下半屏。
 */
function buildBelly() {
  const g = new THREE.Group();
  const M = makeMarmotMaterials();

  // 胸腹底面：略扁的椭球，浅色，暗示"从上方往下看自己"
  const belly = new THREE.Mesh(new THREE.SphereGeometry(0.1, 16, 12), M.belly);
  belly.scale.set(1.5, 0.55, 1.7);
  g.add(belly);

  // 两侧肋腹：接上身体侧壁，避免腹面看起来像一块漂浮的浅色垫子
  for (const side of [-1, 1]) {
    const flank = new THREE.Mesh(new THREE.SphereGeometry(0.062, 12, 10), M.fur);
    flank.position.set(side * 0.085, 0.016, 0.012);
    flank.scale.set(0.75, 0.85, 1.45);
    g.add(flank);
  }

  // 尾根：低头时能看到自己尾巴根部，强化"这是自己的身体"
  const tailRoot = new THREE.Mesh(new THREE.CapsuleGeometry(0.035, 0.1, 4, 8), M.fur);
  tailRoot.position.set(0, 0.02, 0.15);
  tailRoot.rotation.x = Math.PI / 2;
  g.add(tailRoot);

  g.traverse((o) => { if (o.isMesh) o.castShadow = false; });
  return g;
}

/** 后腿：从身体中后段探出的粗壮腿部，俯伏时前移（模拟四肢着地） */
function buildLegs() {
  const g = new THREE.Group();
  const M = makeMarmotMaterials();

  const mkLeg = () => {
    const leg = new THREE.Group();
    // 大腿
    const thigh = new THREE.Mesh(new THREE.CapsuleGeometry(0.052, 0.1, 4, 10), M.fur);
    thigh.rotation.x = Math.PI / 2;
    thigh.position.z = 0.05;
    leg.add(thigh);

    // 小腿
    const shin = new THREE.Mesh(new THREE.CapsuleGeometry(0.036, 0.09, 4, 8), M.fur);
    shin.position.set(0, -0.02, 0.14);
    shin.rotation.x = Math.PI / 2;
    leg.add(shin);

    // 后脚掌（略朝下，暗示"这是脚"）
    const foot = new THREE.Mesh(new THREE.SphereGeometry(0.04, 10, 8), M.fur);
    foot.position.set(0, -0.045, 0.2);
    foot.scale.set(0.85, 0.7, 1.25);
    leg.add(foot);
    return leg;
  };

  const left = mkLeg();
  const right = mkLeg();
  g.add(left, right);
  g.userData.left = left;
  g.userData.right = right;
  return g;
}