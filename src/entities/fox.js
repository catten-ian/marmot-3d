/**
 * 藏狐程序化模型与 AI。
 *
 * 四种类型的区分逻辑（按玩家实际辨识需求设计）：
 *   normal 普通狐：锈橙赤狐色，标准体型
 *   fast   疾行狐：**沙黄浅毛 + 明显更小的体型 + 大耳朵**（沙狐/草原狐的写实特征）
 *   heavy  厚皮狐：灰褐毛色 + 宽厚体型
 *   boss   狐首领：深褐近黑 + 颈鬃，体型最大
 *
 * 关键原则：**同类之间（普通狐 vs 幼狐）主要靠体型区分，毛色接近真实；
 * 只有特殊种类才用毛色做辅助识别**，避免"靠颜色猜敌人"的错觉，
 * 让玩家主要依靠体型、行为（预警条）和威胁箭头判断威胁。
 *
 * AI 状态机移植原版：roam(游荡) → wind(蓄力，地面预警) → dash(突进) → rest(喘息)
 */

import * as THREE from 'three';
import { FOX, ROCKS, BURROW_AI, roamBounds, scalePoint, scaleRadius } from '../core/config.js';
import { instantiate, normalizeModel } from '../models/loader.js';
import { IS_DEV, USE_REAL_FOX_MODEL } from '../core/version.js';
import { clamp } from '../core/utils.js';
import { createProceduralFox } from './procedural-fox.js';
import { createTibetanFox } from './tibetan-fox.js';
import {
  foxRecoverySeconds, stepFoxTurn, stepFoxRecovery, stepFoxLocomotion, foxMaxTurnRate, steerGroundDirection,
  estimatePlayerVelocity, straightWindAimYaw, canSprint, stepStamina, hpSpeedMultiplier,
  shouldRetreat, chooseRestPoint, enterRestSafe, stepRestSafe, exitRestSafe, resolveHitState,
} from '../core/fox-motion.js';
import { stepSandboxDummyRecovery, SANDBOX_DUMMY_REGEN_DELAY } from '../sandbox/state.js';
import { advanceDrillState, sampleWalkableGround, stepGroundY } from './smart-fox-core.mjs';
/** 手搓程序化狐狸：config 开关，或 beta 用 ?procfox=1 临时启用对比；默认仍走现有模型 */
const USE_PROCEDURAL_FOX = FOX.useProcedural
  || (typeof location !== 'undefined' && new URLSearchParams(location.search).get('procfox') === '1');
// 高保真程序化藏狐（img2threejs 工程产物，自包含）：默认用于 normal/pup，
// 可用 ?hififox=off 临时关闭回退旧外观。
const HIFI_FOX_OFF = typeof location !== 'undefined'
  && new URLSearchParams(location.search).get('hififox') === 'off';
const USE_HIFI_FOX = !HIFI_FOX_OFF;

/**
 * 把 img2threejs 藏狐模型归一化到游戏尺度并接地。
 * 原始模型高约 2.3、长约 4.5（鼻尖 +Z、尾 -Z、耳尖 +Y，脚掌约 y=0.1），
 * 与实体 yaw（yaw=0 朝 +Z）同向，故无需额外前向旋转；只需缩放到目标高并把脚掌放到 0。
 */
function buildHiFiTibetanFox() {
  const wrap = new THREE.Group();
  const fox = createTibetanFox();
  let box;
  fox.updateMatrixWorld(true);
  box = new THREE.Box3().setFromObject(fox);
  const h = Math.max(0.001, box.max.y - box.min.y);
  const s = FOX_TARGET_HEIGHT / h;
  wrap.scale.setScalar(s);
  fox.position.y -= box.min.y; // 脚掌接地
  fox.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = false; o.frustumCulled = true; } });
  wrap.add(fox);
  wrap.name = 'hifi-tibetan-fox';
  return wrap;
}
/** 真实藏狐模型的基准缩放：让成体在游戏里约 1.0m 高（与土拨鼠同量级） */
const FOX_MODEL_BASE = 1.05;
const SEGMENTED_FOX_MODEL = IS_DEV
  && new URLSearchParams(location.search).get('foxmodel') !== 'off';
const FOX_MODEL_PATH = SEGMENTED_FOX_MODEL
  ? './assets/models/fox-segmented.glb'
  : './assets/models/fox.glb';
// 两个资产的原始前向都是局部 -X；旋转 +90° Y 后与实体 yaw 的局部 +Z 对齐。
const FOX_MODEL_HEADING = Math.PI / 2;

/**
 * 真实藏狐归一化后的**目标高度**（米，容器内单位）。
 *
 * 必须与程序化模型保持一致，否则切换时会有"忽然变大/变小"的跳变。
 * 程序化狐狸的最高点是耳尖约 **0.92m**（buildFoxMesh 里 head.y=0.72 + 耳高 0.2），
 * 外部还要乘 `cfg.scale × FOX_MODEL_BASE(1.05)`。
 * 所以这里取 0.92 —— 让真实模型与程序化版本在游戏中呈现同样大小。
 *
 * 注：现实藏狐肩高约 0.38m，这里是为了与既有程序化模型对齐而保留的
 * "游戏尺度"，不是写实比例。玩家视高 0.46m，狐狸略高于视线。
 */
const FOX_TARGET_HEIGHT = 0.92;

/** 真实模型加载的实例化函数（统一从这里走，便于加参数） */
const instantiateFox = () => instantiate(FOX_MODEL_PATH, 'fox');

// 四种类型的属性表（血量按关卡微调），与 config.FOX.types 保持一致
const TYPE_CFG = FOX.types;

// 写实毛色（参考赤狐、沙狐、草原狐的真实毛色范围）
// normal/普通狐：锈橙偏棕      fast/疾行狐：沙黄偏灰（沙漠适应）
// heavy/厚皮狐：灰褐          boss/狐首领：深褐近黑（年长个体）
const TYPE_COLOR = {
  normal: 0x9c5f2e,
  pup: 0x9c5f2e, // 幼狐与成狐同色，靠体型区分
  fast: 0xb59a6a,
  heavy: 0x7d6a55,
  boss: 0x4a3524,
};

// 幼狐使用成狐的毛色 —— 玩家应靠"体型小"认出它，而不是靠颜色
const TYPE_FUR = {
  normal: 0xc4763a,
  pup: 0xc4763a, // 同 normal
  fast: 0xd9c294,
  heavy: 0x9c8770,
  boss: 0x6b4c31,
};

export class Fox {
  constructor(scene, x, z, type, level, slot, opts = {}) {
    // Campaign callers remain normal-only; only beta sandbox replay opts into level-configured types.
    const configuredType = type;
    type = 'normal';
    if (opts.allowConfiguredType && Object.prototype.hasOwnProperty.call(FOX.types || {}, configuredType)) type = configuredType;
    this.type = type;
    this.level = level;
    this.slot = slot;
    const cfg = { ...TYPE_CFG[type] };
    // 普通狐血量随关卡递增
    if (type === 'normal') cfg.hp += Math.floor(level / 2);
    this.cfg = cfg;

    this.maxHp = cfg.hp;
    this.hp = cfg.hp;
    // 体力（见 config.FOX.vitals）：体力耗尽 ≠ 被驱退，只是不能再冲刺/扑咬
    this.maxStamina = FOX.vitals.maxStamina;
    this.stamina = this.maxStamina;
    this.staminaLocked = 0;
    this.x = x; this.z = z;
    this.vx = 0; this.vz = 0;
    this.knockbackVX = 0; this.knockbackVZ = 0;
    this.state = 'roam';
    this.timer = 0;
    this.yaw = Math.random() * Math.PI * 2;
    this.stun = 0;
    this.respawn = 0;
    this.phase = slot * 1.6 + 0.5;
    this._runCycle = Math.random() * Math.PI * 2;
    this._runAmount = 0;
    this._segmentAnimation = null;
    this._proceduralFox = null;
    this._disposed = false;
    this.dead = false;
    this.isSandboxDummy = !!opts.sandboxDummy;
    this.dummyDefeatable = opts.dummyDefeatable !== false;
    this.dummyNoHitTimer = 0;
    if (this.isSandboxDummy) this.state = 'dummy';
    this._lastSafe = false;
    this.alertCooldown = 0;
    this.lingerBurrow = null;

    // —— 攻击模式档案 ——
    // 不同类型的藏狐走完全不同的攻击分支（见 update 的状态机），
    // 这是「敌人攻击模式单一」这个问题的解法。
    this.attack = FOX.attackOf(type);
    // 关卡的蓄力基准时长由 update() 每帧从 levelCfg 取（levelCfg.wind），
    // 这里只放默认值，避免在 update 之外被用到时是 undefined
    this.levelCfgWind = 0.7;
    this.windFull = 0.7;
    this.windTotal = 0.7;
    // 虚晃概率：档案基线 × 关卡的 lureBias。
    // 注意存的是**实例字段**，绝不能写回档案对象 ——
    // 档案是全局共享的常量，改它会让所有同类型藏狐一起变多变少。
    this.lureBias = opts.lureBias || 1;
    this.lureChance = (this.attack.lureChance || 0) * this.lureBias;
    this.lured = false;
    this._lureCount = 0;
    this.comboLeft = 0;
    this.comboActive = false;
    this.dashTime = this.attack.dashTime || 0.32;
    this.leap = 0;              // 跃扑腾空高度（0 = 未起跳）
    this.dashDirX = 0;
    this.dashDirZ = 1;
    this.turnVelocity = 0;
    this.dashVX = 0;
    this.dashVZ = 0;

    // 驱退（逃跑）状态
    this.fleeing = false;
    this.fleeTime = 0;
    this.fleeYaw = 0;
    // —— 自主撤退（阶段 2）：何时撤是狐狸自己的判断 ——
    this.retreating = false;      // 主动撤退中（retreat → rest_safe）
    this.restPoint = null;        // 休息点坐标 {x, z}
    this.repelCounted = false;    // 本回合是否已计过驱退（防止重复计数）
    this.hitStreak = 0;           // 短时间连续被打次数（脱战衰减）
    this._sinceHit = Infinity;    // 距上次受击的秒数
    this.onRepelled = null;       // 进入 rest_safe 时由 main.js 注入的驱退计数回调
    // 记住初始生成点，被驱退后从附近重新出现
    this.spawnPoint = [x, z];

    // 模型容器结构（三层，职责必须分开）：
    //   this.mesh          —— 容器，承载朝向/位置/体型缩放，负责 add 到 scene
    //   this.proceduralMesh —— 程序化建模（L2 回退用）
    //   this.realModel     —— 真实摄影测量模型（L0/L1），是 mesh 的**兄弟**节点
    //
    // 历史 bug（本次修复的真凶）：
    //   原来 proceduralMesh 与 mesh 是**同一个对象**，
    //   于是 `proceduralMesh.visible = false` 隐藏 mesh 的同时，
    //   作为 mesh 子节点的真实模型也被一起隐藏 ——
    //   结果「程序化藏好、真实模型也藏了」，整只狐狸隐形，
    //   而日志里一条错误都没有（模型确实加载成功了）。
    //   现在两套模型是**兄弟**：藏程序化不影响真实模型。
    this.mesh = new THREE.Group();
    // 高保真程序化藏狐（img2threejs）：默认作为藏狐外观，旧外观作为回退。
    this.hiFiMesh = null;
    if (USE_HIFI_FOX) {
      this.hiFiMesh = buildHiFiTibetanFox();
      this.mesh.add(this.hiFiMesh);
      this.proceduralMesh = buildFoxMesh(type, 1);
      this.proceduralMesh.visible = false;
      this.mesh.add(this.proceduralMesh);
    } else if (USE_PROCEDURAL_FOX) {
      this._proceduralFox = createProceduralFox({ color: FOX.proceduralColors[type] ?? FOX.proceduralColors.normal });
      this.proceduralMesh = this._proceduralFox.group;
      this.mesh.add(this.proceduralMesh);
    } else {
      this.proceduralMesh = buildFoxMesh(type, 1);
      this.mesh.add(this.proceduralMesh);
    }
    this.realModel = null;
    this.modelLevel = USE_HIFI_FOX ? 'hifi' : 'procedural';
    this.mesh.position.set(x, 0, z);
    scene.add(this.mesh);
    this.scene = scene;
    // 高保真模型已足够完整时不再异步加载 GLB（避免两套模型叠加/闪烁）。
    if (!USE_HIFI_FOX) this._loadRealModel();

    // 蓄力预警：地面上的方向指示条（第一人称下比 2D 线条更易读）
    this.warn = buildWarnIndicator();
    this.warn.visible = false;
    scene.add(this.warn);

    // 生命条 billboard
    this.hpBar = buildHpBar();
    this.hpBar.visible = false;
    scene.add(this.hpBar);

    // 体力条 billboard（血条下方，只在不满时显示）
    this.staminaBar = buildStaminaBar();
    this.staminaBar.visible = false;
    scene.add(this.staminaBar);

    this.baseY = 0;
    this._groundY = null;
    this._drillFSM = { phase: 'approach', phaseTime: 0, cooldown: 0 };
    this._stateAge = 0;
    this.attackCooldown = 0;
    this._bob = Math.random() * 6;
  }

  /**
   * 异步换成真实藏狐模型。
   *
   * 分级回退（详见 models/loader.js）：
   *   L0 完整模型 → L1 仅几何（贴图坏，退纯色）→ L2 程序化建模
   *
   * 关键：**只有当真实模型确实构造成功时才隐藏程序化版本。**
   * 早前版本无条件 `proceduralMesh.visible = false`，
   * 一旦真实模型因姿态算错而不可见，就会出现"整只狐狸隐形"，
   // 而日志里看不到任何错误 —— 最难查的一类问题。
   */
  async _loadRealModel() {
    if (!USE_REAL_FOX_MODEL || USE_PROCEDURAL_FOX) return;
    try {
      const inst = await instantiateFox();
      if (this._disposed) {
        // 换关时模型请求可能仍在途；不要把迟到模型挂回已销毁实例。
        this._disposeRealInstance(inst);
        return;
      }
      if (!inst) {
        // L2：加载器已经 warn 过了，这里只记录状态，程序化版本保持可见
        this.modelLevel = 'procedural';
        return;
      }
      // 两个 GLB 的几何侧视图都显示头在局部 -X、尾在 +X；
      // normalizeModel 保留节点原生姿态，统一的 -X → 游戏 +Z 修正只放在 wrap 层。
      const norm = normalizeModel(inst, FOX_TARGET_HEIGHT, { upAxis: 'native' });
      norm.wrap.rotation.y = FOX_MODEL_HEADING;
      this.mesh.add(norm.wrap);
      this.realModel = norm.wrap;
      this.modelLevel = inst.userData.level || 'full';
      if (SEGMENTED_FOX_MODEL) {
        this._prepareSegmentedFox(inst);
      }

      // 装载后**立刻验证**真实模型确实可见且有尺寸。
      // 不验证就隐藏程序化版本，等于把"显示什么"的决定权交给了一个未验证的对象。
      this.realModel.updateMatrixWorld(true);
      const rb = new THREE.Box3().setFromObject(this.realModel);
      const rs = rb.getSize(new THREE.Vector3());
      const hasRenderableMesh = (() => {
        let found = false;
        this.realModel.traverse((o) => {
          if (!o.isMesh || !o.geometry?.attributes?.position) return;
          const materials = Array.isArray(o.material) ? o.material : [o.material];
          if (materials.some((material) => material && material.visible !== false
            && material.opacity > 0 && material.color)) found = true;
        });
        return found;
      })();
      const looksUsable = rs.x > 1e-3 && rs.y > 1e-3 && rs.z > 1e-3
        && rs.y < 50 && hasRenderableMesh;
      if (!looksUsable) {
        console.warn('[fox] 真实模型不可渲染，保留程序化版本:', {
          size: rs.toArray().map((v) => +v.toFixed(3)), hasRenderableMesh,
        });
        this._discardRealModel(norm.wrap);
        return;
      }

      this._tintRealModel();
      this._restoreVisibility();
    } catch (e) {
      // L2：任何异常都不能让狐狸消失；失败实例必须从场景树移除。
      console.warn('[fox] 真实模型不可用，使用程序化建模', e);
      if (this.realModel) this._discardRealModel(this.realModel);
      this.modelLevel = 'procedural';
      this._restoreVisibility();
    }
  }

  _disposeRealInstance(root) {
    if (!root) return;
    root.traverse((o) => {
      // instantiate() 深拷贝材质但与缓存共享几何体和贴图；不可释放共享资源。
      const materials = Array.isArray(o.material) ? o.material : [o.material];
      for (const material of materials) material?.dispose?.();
    });
  }

  _discardRealModel(root) {
    if (root?.parent) root.parent.remove(root);
    this._disposeRealInstance(root);
    this.realModel = null;
    this.modelLevel = 'procedural';
    this._segmentAnimation = null;
    this._restoreVisibility();
  }

  _tintRealModel() {
    if (!this.realModel || SEGMENTED_FOX_MODEL) return;
    const target = new THREE.Color(furColor(this.type));
    this.realModel.traverse((o) => {
      if (!o.isMesh) return;
      const materials = Array.isArray(o.material) ? o.material : [o.material];
      for (const material of materials) {
        if (!material?.color) continue;
        // 保留真实贴图细节，只用轻微颜色乘层区分特殊类型。
        material.color.lerp(target, this.type === 'normal' || this.type === 'pup' ? 0.08 : 0.2);
        material.needsUpdate = true;
      }
    });
  }

  /**
   * 分块狐狸模型（fox-segmented.glb，dev 版）的额外准备：
   * 把源模型子树旋转到游戏朝向，按 part_N 命名重染毛色，
   * 并为腿部（index>=2）/尾部（index=0）建立动画枢轴。
   */
  _prepareSegmentedFox(source) {
    const inner = this.realModel.children[0];
    const sourceHeading = new THREE.Group();
    // 模型前向修正已统一放在外层 wrap（FOX_MODEL_HEADING），内层不再额外旋转。
    while (inner.children.length) sourceHeading.add(inner.children[0]);
    inner.add(sourceHeading);

    const parts = { legs: [], tails: [] };
    // 第一阶段：只遍历收集 mesh 并做材质处理，**绝不在 traverse 中改动父子结构**。
    // three 的 traverse 按数组索引迭代，边遍历边 add/remove 子节点会让索引错位、
    // 踩到 undefined（对其再调 traverse 而抛 TypeError），真实模型因此被整体丢弃。
    const legMeshes = [];
    sourceHeading.traverse((o) => {
      if (!o.isMesh) return;
      const index = Number(o.name.replace('part_', ''));
      if (!Number.isInteger(index)) return;
      const material = Array.isArray(o.material) ? o.material[0] : o.material;
      if (material) {
        material.color.set(index === 0 ? furColor(this.type) : index === 1 ? furColor(this.type) : accentColor(this.type));
        material.vertexColors = false;
        material.roughness = 0.92;
        material.needsUpdate = true;
      }
      o.castShadow = true;
      if (index === 0) {
        parts.tails.push({ object: o, pivot: new THREE.Vector3(0, 0, 0), phase: 0.6 });
      } else if (index >= 2) {
        o.geometry.computeBoundingBox();
        const box = o.geometry.boundingBox;
        legMeshes.push({ mesh: o, index, center: box.getCenter(new THREE.Vector3()), maxY: box.max.y });
      }
    });

    // 第二阶段：遍历已结束，再统一为腿部建立枢轴并重排父子关系。
    const trotPhases = [0, Math.PI, Math.PI, 0];
    for (let legIndex = 0; legIndex < legMeshes.length; legIndex++) {
      const { mesh: o, center, maxY, index } = legMeshes[legIndex];
      const pivot = new THREE.Vector3(center.x, maxY, center.z);
      const hinge = new THREE.Group();
      hinge.position.copy(pivot);
      hinge.add(o);
      o.position.sub(pivot);
      sourceHeading.add(hinge);
      parts.legs.push({
        object: hinge,
        side: Math.sign(center.z) || 1,
        fore: center.x < -0.05,
        phase: trotPhases[legIndex] ?? ((index % 2) ? Math.PI : 0),
        restX: hinge.rotation.x,
      });
    }

    this._segmentAnimation = { parts, sourceHeading };
  }

  _updateSegmentedFox(dt, movingSpeed) {
    if (this._proceduralFox) {
      const anim = this.state === 'dash' || this.fleeing ? 'dash' : movingSpeed > 0.15 ? 'walk' : 'idle';
      this._proceduralFox.setAnimState({ anim, speed: movingSpeed || 1, phase: this._runCycle });
      this._proceduralFox.update(dt);
      return;
    }
    if (!this._segmentAnimation) return;
    const { parts } = this._segmentAnimation;
    const target = Math.min(1, Math.max(0, movingSpeed / 2.6));
    this._runAmount += (target - this._runAmount) * Math.min(1, dt * 8);
    const speed = Math.max(0, movingSpeed);
    const frequency = 5.5 + Math.min(speed, 8) * 1.45;
    this._runCycle += dt * frequency;
    const stride = 0.62 * this._runAmount;

    for (const leg of parts.legs) {
      const phase = this._runCycle + leg.phase;
      leg.object.rotation.z = Math.sin(phase) * stride;
      leg.object.rotation.x = (leg.side || (leg.object.id % 2 ? 1 : -1))
        * Math.cos(phase) * 0.07 * this._runAmount;
    }
    for (const tail of parts.tails) {
      tail.object.rotation.z = Math.sin(this._runCycle * 0.5 + tail.phase) * 0.14 * this._runAmount;
      tail.object.rotation.y = Math.sin(this._runCycle * 0.35 + tail.phase) * 0.1 * this._runAmount;
    }
  }

  /**
   * 按当前模型级别恢复可见性。
   *
   * 这是模型看不见类问题的核心防护：真实模型与程序化模型是**兄弟节点**，
   * 必须成对切换可见性。任何一处漏改都会出现
   * 「两者同时隐藏 → 隐形」或「两者同时显示 → 重影」。
   */
  _restoreVisibility() {
    if (!this.mesh) return;
    // 模型切换不应重置实体生死/逃离可见状态；只切换两套子模型。
    const useReal = !!this.realModel;
    // 高保真程序化藏狐是默认外观：它与旧程序化模型成对显示；若异步 GLB 成功则隐藏两者。
    if (this.hiFiMesh) this.hiFiMesh.visible = !useReal;
    if (this.proceduralMesh) this.proceduralMesh.visible = !useReal && !this.hiFiMesh;
    if (this.realModel) this.realModel.visible = useReal;
  }

  // 撤退/休息中的狐狸不算存活威胁（撤退即驱退：威胁已解除），dead 更不用说。
  get alive() { return !this.isSandboxDummy && this.hp > 0 && !this.fleeing
    && !this.retreating && this.state !== 'rest_safe' && this.state !== 'dead'; }
  /** 是否已被驱退（撤退中或休息中）：此时不再参与威胁计数与伤害 */
  get repelled() { return this.fleeing || this.retreating || this.state === 'rest_safe'; }

  /**
   * AI 主更新：p 为玩家状态，safe 表示玩家是否在洞穴内
   *
   * 状态机（每种藏狐的 mode 不同，走的分支不同）：
   *   roam ─┬─→ wind ─→ dash ─→ rest ─→ roam
   *         │
   *         ├─→ circle ─→ wind …        'circle' 厚皮狐：先绕行、可能虚晃再蓄力
   *         └─（wind 内跃起）           'leap'   幼狐：蓄力时跳起来，扑击范围更大
   *   dash 连冲（'combo' 首领）：dash → wind(短) → dash → …，共 comboCount 段
   *
   * 关键：任何模式在**冲刺前**都必须让 warn（预警线）亮起，
   * 且预警线长度 = 真实冲刺距离，否则玩家无法应对（详见 buildWarnIndicator）。
   */
  update(dt, p, safe, levelCfg, burrows, terrainAt, currentBurrow = null) {
    if (this.isSandboxDummy) {
      stepSandboxDummyRecovery(this, dt);
      this.knockbackVX = this.knockbackVZ = 0;
      this.stun = 0;
      this.leap = 0;
      this.fleeing = false;
      this.state = this.hp > 0 ? 'dummy' : 'defeated';
      this.mesh.visible = this.hp > 0;
      this.warn.visible = false;
      this.baseY = terrainAt(this.x, this.z);
      this.mesh.position.set(this.x, this.baseY, this.z);
      this.mesh.rotation.set(0, this.yaw, 0);
      this.mesh.scale.setScalar(this.cfg.scale * FOX_MODEL_BASE);
      this.hpBar.position.set(this.x, this.baseY + 1.55 * this.cfg.scale, this.z);
      this._updateHpBar();
      this.hpBar.visible = this.hp > 0 && this.hp < this.maxHp;
      this.staminaBar.visible = false;
      return;
    }

    const allBurrows = Array.isArray(burrows) ? burrows : (burrows ? [burrows] : []);
    this._stateAge += dt;
    this.attackCooldown = Math.max(0, this.attackCooldown - dt);
    const previousX = this.x, previousZ = this.z;
    const y = terrainAt(this.x, this.z);
    this.baseY = y;
    if (Math.abs(this.knockbackVX) + Math.abs(this.knockbackVZ) > 1e-3) {
      this.x += this.knockbackVX * dt;
      this.z += this.knockbackVZ * dt;
      const drag = Math.exp(-5.5 * dt);
      this.knockbackVX *= drag;
      this.knockbackVZ *= drag;
      const bounds = roamBounds();
      this.x = clamp(this.x, -bounds.hw, bounds.hw);
      this.z = clamp(this.z, -bounds.hh, bounds.hh);
    } else {
      this.knockbackVX = 0;
      this.knockbackVZ = 0;
    }

    // ----  legacy 逃跑（阶段 2 起不再由受击触发，保留给旧存档/调试兜底）----
    // 新口径：撤退是狐狸自主行为（retreat → rest_safe），见 _enterRetreat()。
    if (this.fleeing) {
      const previousX = this.x, previousZ = this.z;
      this._updateFlee(dt, terrainAt, levelCfg, p);
      this._updateSegmentedFox(dt, Math.hypot(this.x - previousX, this.z - previousZ) / Math.max(dt, 1e-4));
      return;
    }

    if (this.hp <= 0) {
      // 真死（阶段 2 口径）：不 flee、不 respawn、不再参与更新。
      // 正常路径玩家几乎打不到这一步 —— 血量还剩一截时狐狸就自己撤退回血了。
      this.state = 'dead';
      this.retreating = false;
      this.mesh.visible = false;
      this.warn.visible = false;
      this.hpBar.visible = false;
      this.staminaBar.visible = false;
      return;
    }

    if (this.stun > 0) {
      this.stun -= dt;
      this.mesh.rotation.z = Math.sin(performance.now() * 0.03) * 0.22;
      this._updateSegmentedFox(dt, 0);
      this._applyTransform(dt, terrainAt);
      this.warn.visible = false;
      this._updateHpBar();
      this._updateStaminaBar();
      return;
    }
    this.mesh.rotation.z = 0;

    // —— 体力收支（每帧唯一入口，纯函数在 fox-motion.js）——
    // 体力耗尽只是"不能再冲刺"，不是被驱退；休息态缓慢回血回体力。
    {
      const V = FOX.vitals;
      const dashing = this.state === 'dash';
      const resting = this.state === 'rest' || this.state === 'rest_safe';
      const stepped = stepStamina({ stamina: this.stamina, locked: this.staminaLocked, hp: this.hp }, dt, {
        maxStamina: this.maxStamina,
        drainPerSec: dashing ? V.pounceStaminaPerSec : V.stalkStaminaPerSec,
        regenPerSec: V.restStaminaPerSec,
        resting,
        hpRegenRatio: V.restHpRegenRatio,
        hp: this.hp, maxHp: this.maxHp,
        staminaLockSeconds: V.staminaLockSeconds,
      });
      this.stamina = stepped.stamina;
      this.staminaLocked = stepped.locked;
      this.hp = stepped.hp;
    }

    this.alertCooldown = Math.max(0, this.alertCooldown - dt);
    if (safe && !this._lastSafe) {
      this.lingerBurrow = currentBurrow || allBurrows.reduce((best, b) => !best || Math.hypot(this.x - b.x, this.z - b.z) < Math.hypot(this.x - best.x, this.z - best.z) ? b : best, null);
      this._enterLinger(this.lingerBurrow);
    } else if (!safe && this._lastSafe) {
      this.alertCooldown = BURROW_AI.exitMemory;
    }
    this._lastSafe = safe;

    const dx = p.x - this.x, dz = p.z - this.z;
    const d = Math.hypot(dx, dz);
    const A = this.attack;                 // 攻击档案（config.FOX_ATTACKS）
    // Wind 仅保留近期玩家位移估计；用有界低通避免坐标噪声/瞬时跳位变成预瞄。
    this._attackPlayerMotion = estimatePlayerVelocity(this._attackPlayerMotion, p, dt);
    const playerMotion = this._attackPlayerMotion;
    const speed = levelCfg.speed * this.cfg.speed * (this.sandboxSpeedMul || 1) * hpSpeedMultiplier(this.hp / this.maxHp, FOX.vitals);
    // 关卡的蓄力基准时长（实际蓄力 = 该值 × 档案 windMul）
    this.levelCfgWind = levelCfg.wind;
    // 跃扑的腾空时间也算进冲刺时长，预警线长度才准
    const leapT = A.mode === 'leap' ? 0.22 : 0;
    this.dashTime = A.dashTime + leapT;

    // —— 自主撤退判断：狐狸自己根据血量/体力/被打次数决定何时撤 ——
    // （不由外部受击逻辑强塞；迎击练习狐不撤退，由复位机制接管）
    this._sinceHit = (this._sinceHit ?? Infinity) + dt;
    if (this._sinceHit > FOX.retreat.hitStreakDecay) this.hitStreak = 0;
    if (!this.drillCtx && shouldRetreat({
      hpRatio: this.hp / this.maxHp,
      staminaRatio: this.stamina / this.maxStamina,
      hitStreak: this.hitStreak,
      state: this.state,
    }, FOX.retreat)) {
      this._enterRetreat(p, allBurrows);
    }

    // —— 迎击练习：绕到玩家正前方，直线蓄力冲刺，不绕行/不虚晃 ——
    // dash 状态故意不拦截：交给下方正常 switch 的 dash 分支执行冲刺位移与结束转换。
    if (this.drillCtx && !['dash', 'rest'].includes(this.state)) {
      const pyaw = this.drillCtx.yaw || 0;
      const standDist = 7;
      const tx = this.drillCtx.px + (-Math.sin(pyaw)) * standDist;
      const tz = this.drillCtx.pz + (-Math.cos(pyaw)) * standDist;
      const ddx = tx - this.x, ddz = tz - this.z;
      const dd = Math.hypot(ddx, ddz);
      const facingPlayer = Math.atan2(p.x - this.x, p.z - this.z);
      const wasPhase = this._drillFSM.phase;
      this._drillFSM = advanceDrillState(this._drillFSM, {
        inRange: dd <= 1.15,
        reachable: true,
        windDuration: Math.max(0.55, (levelCfg.wind ?? 0.9) * 0.7),
      }, dt);
      if (this._drillFSM.phase === 'approach') {
        this.state = 'roam'; this.warn.visible = false;
        // 1.15m enter / 1.55m leave band gives stable arrival hysteresis.
        if (dd > 1.55) this._moveGround(ddx, ddz, Math.min(speed * 1.05, 5.2), dt, allBurrows);
        // _moveGround never writes yaw; apply one bounded facing update after position.
        const turn = stepFoxTurn(this.yaw, facingPlayer, this.turnVelocity, dt,
          FOX.handling.windTurnRate, FOX.handling.windTurnAccel);
        this.yaw = turn.yaw; this.turnVelocity = turn.turnVelocity;
      } else if (this._drillFSM.phase === 'wind') {
        this.state = 'wind';
        if (wasPhase !== 'wind') {
          this.windTotal = Math.max(0.55, (levelCfg.wind ?? 0.9) * 0.7);
          this.timer = this.windTotal;
          this.lureChance = 0;
        }
        this.timer = Math.max(0, this.windTotal - this._drillFSM.phaseTime);
        this.warn.visible = true;
        const turn = stepFoxTurn(this.yaw, facingPlayer, this.turnVelocity, dt,
          FOX.handling.windTurnRate, FOX.handling.windTurnAccel);
        this.yaw = turn.yaw; this.turnVelocity = turn.turnVelocity;
      } else if (this._drillFSM.phase === 'pounce') {
        this.state = 'roam';
        this._beginDash();
        this._drillFSM.phase = 'pounce'; this._drillFSM.phaseTime = 0;
      }
      // 练习狐不进入 linger/flee/circle；下方 switch 只允许 wind/dash，其余帧已在此处理。
      this.warn.visible = this.state === 'wind';
      if (this.state === 'wind') this._updateWarn(terrainAt); else this.warn.visible = false;
      this._updateSegmentedFox(dt, this.state === 'dash' ? 1 : 0);
      this._applyTransform(dt, terrainAt);
      this._updateHpBar();
      this._updateStaminaBar();
      return;
    }

    switch (this.state) {
      case 'linger': {
        this.timer -= dt;
        const b = this.lingerBurrow;
        if (b) {
          const a = Math.atan2(this.x - b.x, this.z - b.z) + Math.sin(this.timer * 2.2) * 0.7;
          const radius = b.r + BURROW_AI.lingerRadius;
          const tx = b.x + Math.sin(a) * radius, tz = b.z + Math.cos(a) * radius;
          this._moveGround(tx - this.x, tz - this.z, Math.min(2.2, speed), dt, allBurrows);
        }
        this.warn.visible = false;
        if (this.timer <= 0) {
          this.state = 'abandon';
          const b2 = this.lingerBurrow;
          if (b2) { const a = Math.atan2(this.x - b2.x, this.z - b2.z); this.leaveVX = Math.sin(a); this.leaveVZ = Math.cos(a); this.leaveX = b2.x + this.leaveVX * (b2.r + BURROW_AI.leaveDistance); this.leaveZ = b2.z + this.leaveVZ * (b2.r + BURROW_AI.leaveDistance); }
          this.lingerBurrow = null;
          this.alertCooldown = BURROW_AI.exitMemory;
        }
        break;
      }
      case 'abandon': {
        const dxLeave = (this.leaveX ?? this.x) - this.x, dzLeave = (this.leaveZ ?? this.z) - this.z;
        const distLeave = Math.hypot(dxLeave, dzLeave);
        if (distLeave < 2) { this.state = 'roam'; this.leaveX = this.leaveZ = null; break; }
        this._moveGround(dxLeave, dzLeave, Math.min(speed, 4.2), dt, allBurrows);
        break;
      }
      // ---------- 自主撤退：跑向休息点（不受打断、不能攻击） ----------
      case 'retreat': {
        const rp = this.restPoint;
        this.warn.visible = false;
        if (!rp) { this._exitRestSafe(); break; }
        const rdx = rp.x - this.x, rdz = rp.z - this.z;
        if (Math.hypot(rdx, rdz) < FOX.retreat.arriveRadius) { this._enterRestSafe(); break; }
        this._moveGround(rdx, rdz, FOX.retreat.speed, dt, allBurrows);
        break;
      }

      // ---------- 安全休息：回血回体力；进入这一刻计入一次驱退 ----------
      case 'rest_safe': {
        this.warn.visible = false;
        const r = stepRestSafe({ timer: this.timer, hp: this.hp, maxHp: this.maxHp }, dt);
        this.timer = r.timer;
        if (r.done) this._exitRestSafe();
        break;
      }

      // ---------- 蓄力：预警线亮起，朝玩家缓慢修正 ----------
      case 'wind': {
        this.timer -= dt;
        const a = straightWindAimYaw({ foxX: this.x, foxZ: this.z,
          player: p, motion: playerMotion, mode: A.mode, leadTime: A.windLeadTime });
        // 虚晃（lure）：厚皮狐蓄到一半突然放弃、跳开并重新蓄力，
        // 目的是打乱"看到红线就开始躲"的固定节奏 —— 逼玩家学会**看而不是背节奏**。
        if (A.lureChance && !this.lured && this.timer < this.windTotal * 0.45) {
          if (Math.random() < this.lureChance) {
            this.lured = true;
            this.state = 'circle';
            this.timer = 0.45;
            this.luredDir = Math.random() < 0.5 ? 1 : -1;
            this.warn.visible = false;
            this._lureCount = (this._lureCount || 0) + 1;
            // 最多虚晃两次，否则藏狐自己都绕晕了。
            // 注意只改实例字段，绝不能改 A（档案对象是全局共享的常量）。
            if (this._lureCount > 2) this.lureChance = 0;
            break;
          }
          this.lured = true;
        }
        const turn = stepFoxTurn(this.yaw, a, this.turnVelocity, dt,
          FOX.handling.windTurnRate, FOX.handling.windTurnAccel);
        this.yaw = turn.yaw;
        this.turnVelocity = turn.turnVelocity;
        if (this.timer <= 0) this._beginDash();
        break;
      }

      // ---------- 绕行：侧向移动，从侧面切入 ----------
      case 'circle': {
        this.timer -= dt;
        if (!this.luredDir) this.luredDir = Math.random() < 0.5 ? 1 : -1;
        const dir = this.luredDir;
        // 以玩家为圆心做切向绕圈 + 向内收一点，
        // 这样结束时藏狐会处在玩家侧面而非正后方（绕到正后方对第一人称太难预判）
        const ang = Math.atan2(dx, dz) + Math.PI / 2 * dir;
        const tangent = 0.85;
        const inward = d > FOX.windRange * 0.72 ? 0.25 : -0.1;
        const moveX = Math.sin(ang) * tangent + (dx / (d || 1)) * inward;
        const moveZ = Math.cos(ang) * tangent + (dz / (d || 1)) * inward;
        // 定长切向移动，避免侧向+径向合成后速度随角度忽快忽慢；
        // 导航器会对场地边缘、洞穴和岩石做轻量绕行。
        this._moveGround(moveX, moveZ, speed, dt, allBurrows);
        if (this.timer <= 0) this._enterWind();
        break;
      }

      // ---------- 冲刺 ----------
      case 'dash': {
        this.timer -= dt;
        // turnRate > 0 的模式（首领连冲、幼狐跃扑）会在冲刺中继续修正方向，
        // 所以必须**每帧重算方向**，而不是像原版那样在开始时锁定一次。
        if (A.turnRate > 0 && !this.drillCtx) {
          const a = Math.atan2(dx, dz);
          const turn = stepFoxTurn(this.yaw, a, this.turnVelocity, dt,
            Math.min(foxMaxTurnRate(Math.hypot(this.dashVX || 0, this.dashVZ || 0), { maxTurnSlow: A.turnRate || 0 }), A.turnRate || 0), FOX.handling.turnAccel);
          this.yaw = turn.yaw;
          this.turnVelocity = turn.turnVelocity;
          this.dashDirX = Math.sin(this.yaw);
          this.dashDirZ = Math.cos(this.yaw);
        }
        const v = FOX.dashSpeed * (A.dashSpeedMul || 1) * hpSpeedMultiplier(this.hp / this.maxHp, FOX.vitals);
        this.dashVX = this.dashDirX * v;
        this.dashVZ = this.dashDirZ * v;
        this.x += this.dashVX * dt;
        this.z += this.dashVZ * dt;

        // 跃扑：冲刺中腾空，扑击范围更大但落地后有硬直
        if (A.mode === 'leap') {
          const lt = Math.max(0.0001, this.dashTime);
          const k = 1 - Math.max(0, this.timer) / lt;      // 0→1 进度
          this.leap = Math.sin(k * Math.PI) * A.leapHeight;
        } else if (this.leap) {
          this.leap = 0;
        }

        if (this.timer <= 0) {
          // 首领连冲：没打完段数就短暂蓄力后继续，而不是每次都进 rest。
          // 注意用 comboActive 判断而不是 comboLeft > 1 ——
          // 连冲中的每一段都会重新走 _beginDash()，若在那里重置 comboLeft，
          // 计数就会被永远刷成初始值，首领变成无限连冲（曾确实如此）。
          if (A.mode === 'combo' && this.comboActive && (this.comboLeft || 0) > 1) {
            this.comboLeft -= 1;
            this.state = 'wind';
            // 连冲的间隔蓄力很短（约为首次蓄力的 45%），形成连续压迫
            this.windTotal = this.windFull * 0.45;
            this.timer = this.windTotal;
            // 间隔蓄力不参与虚晃判定，否则连冲会被中途打断
            this.lured = true;
            this.warn.visible = true;
          } else {
            this.comboActive = false;
            this.state = 'rest';
            this._stateAge = 0;
            this.attackCooldown = Math.max(this.attackCooldown, 1.2, foxRecoverySeconds(this.type, A.mode));
            if (this.drillCtx) { this._drillFSM.phase = 'recover'; this._drillFSM.phaseTime = 0; this._drillFSM.cooldown = Math.max(this._drillFSM.cooldown || 0, 1.2); }
            // 跃扑落地有 0.9s 硬直：给玩家一个明确的反击窗口，
            // 否则幼狐会变成"扑完立刻再蓄力"的无解压制。
            this.timer = foxRecoverySeconds(this.type, A.mode);
          }
        }
        break;
      }

      // ---------- 喘息 ----------
      case 'rest': {
        this.timer -= dt;
        // 冲刺后保留惯性并以较低摩擦滑行；恢复时不转向、不攻击，只能沿冲刺方向
        // 慢慢挪动。边界和岩石仍在本帧后续统一约束（避让全部洞穴）。
        const sway = Math.sin(this._bob + performance.now() * 0.002) * 0.16;
        this.x += this.dashVX * dt + Math.cos(this.yaw) * sway * dt;
        this.z += this.dashVZ * dt - Math.sin(this.yaw) * sway * dt;
        const recovery = stepFoxRecovery(this.timer, this.dashVX, this.dashVZ, dt);
        this.timer = recovery.timer;
        this.dashVX = recovery.vx;
        this.dashVZ = recovery.vz;
        this.state = recovery.state;
        break;
      }

      // ---------- 游荡 / 索敌 ----------
      default: {
        if (safe || this.alertCooldown > 0 || d > FOX.roamRange) {
          // 游荡：随机漂移，身体平滑朝向实际移动方向。
          const moveX = Math.cos(performance.now() * 0.00035 + this.phase) * 1.1;
          const moveZ = Math.sin(performance.now() * 0.00045 + this.phase) * 0.8;
          this._moveGround(moveX, moveZ, Math.hypot(moveX, moveZ), dt, allBurrows);
          break;
        }
        if (d < FOX.windRange) {
          // 进入攻击前奏。绕行型藏狐先绕行再蓄力，其余直接蓄力。
          // 每轮攻击重置虚晃额度（单轮最多 2 次），
          // 但**保留关卡的 lureBias 倍率** —— 这里若写 A.lureChance
          // 就会把构造时算好的倍率抹掉，虚晃强度永远等于基线。
          this._lureCount = 0;
          this.lureChance = (A.lureChance || 0) * this.lureBias;
          this.lured = false;
          if (A.mode === 'circle') {
            this.state = 'circle';
            this.timer = A.circleTime;
            this.luredDir = Math.random() < 0.5 ? 1 : -1;
          } else {
            this._enterWind();
          }
        } else {
          // 接近：疾行狐会带一点蛇形位移，避免所有藏狐都走同一条直线冲过来
          const wobble = this.type === 'fast'
            ? Math.sin(performance.now() * 0.001 + this.phase) * 0.65
            : 0;
          const a = Math.atan2(dx, dz) + wobble;
          this._moveGround(Math.sin(a), Math.cos(a), speed, dt, allBurrows);
        }
        break;
      }
    }

    // 边界约束（GS 版按缩放后的活动场取，稳定版与历史值 ±74/±44 一致）。
    const rb = roamBounds();
    const unclampedX = this.x, unclampedZ = this.z;
    this.x = clamp(this.x, -rb.hw, rb.hw);
    this.z = clamp(this.z, -rb.hh, rb.hh);
    if (this.state === 'dash' && (this.x !== unclampedX || this.z !== unclampedZ)) {
      // 冲刺撞到活动场边界就结束，不能持续顶墙/滑墙；预警方向与冲刺轨迹仍一致。
      this._stopDashAtObstacle();
    }

    // 藏狐不穿过岩石或洞穴安全区。逐帧推出可处理冲刺碰撞，
    // 平常移动则提前转向，避免旧逻辑只在最后硬夹坐标造成卡边/瞬移。
    this._resolveObstacleOverlaps(allBurrows);

    const movedX = this.x - previousX, movedZ = this.z - previousZ;
    const movingSpeed = Math.hypot(movedX, movedZ) / Math.max(dt, 1e-4);
    if (movingSpeed > 0.05 && !['wind', 'dash', 'rest'].includes(this.state)) {
      const actualHeading = Math.atan2(movedX, movedZ);
      const turn = stepFoxTurn(this.yaw, actualHeading, this.turnVelocity, dt,
        FOX.handling.windTurnRate, FOX.handling.windTurnAccel);
      this.yaw = turn.yaw;
      this.turnVelocity = turn.turnVelocity;
    }
    this._updateSegmentedFox(dt, movingSpeed);
    this._applyTransform(dt, terrainAt);
    this._updateWarn(terrainAt);
    this._updateHpBar();
    this._updateStaminaBar();
  }

  /**
   * 非攻击移动的轻量局部导航：保持设计速度，同时绕开静态岩石、洞穴和场地边缘。
   * 冲刺仍锁定预警方向；若冲刺确实撞上障碍，由 _resolveObstacleOverlaps 结束冲刺。
   */
  _moveGround(wantX, wantZ, speed, dt, burrows) {
    if (speed <= 0 || dt <= 0) return;
    const steer = this._groundSteer(wantX, wantZ, speed, burrows);
    if (!steer) return;
    const moved = stepFoxLocomotion({ x: this.x, z: this.z, yaw: this.yaw,
      turnVelocity: this.turnVelocity || 0, vx: Math.sin(this.yaw) * (this._locomotionSpeed || 0),
      vz: Math.cos(this.yaw) * (this._locomotionSpeed || 0) },
    { x: this.x + steer.x * 100, z: this.z + steer.z * 100 }, dt, { speed,
      acceleration: FOX.handling.locomotionAccel, turnAcceleration: FOX.handling.locomotionTurnAccel });
    this.x = moved.x; this.z = moved.z; this.yaw = moved.yaw;
    this.turnVelocity = moved.turnVelocity; this._locomotionSpeed = moved.speed;
  }

  _groundSteer(wantX, wantZ, speed, burrows) {
    const bounds = roamBounds();
    const obstacles = ROCKS.map((r) => { const [x, z] = scalePoint(r); return { x, z, r: scaleRadius(r[2]) + .72 * this.cfg.scale }; });
    for (const b of (Array.isArray(burrows) ? burrows : burrows ? [burrows] : [])) obstacles.push({ x: b.x, z: b.z, r: b.r + 2.5 });
    return steerGroundDirection(wantX, wantZ, speed, { x: this.x, z: this.z }, obstacles, bounds, this.slot, this.yaw);
  }

  _stopDashAtObstacle() {
    if (this.state !== 'dash') return;
    this.state = 'rest';
    this.timer = Math.max(this.timer, FOX.recovery.blocked);
    this.attackCooldown = Math.max(this.attackCooldown, 1.2);
    if (this.drillCtx) { this._drillFSM.phase = 'recover'; this._drillFSM.phaseTime = 0; this._drillFSM.cooldown = Math.max(this._drillFSM.cooldown || 0, 1.2); }
    this.dashVX = 0;
    this.dashVZ = 0;
    this.leap = 0;
    this.warn.visible = false;
  }

  _resolveObstacleOverlaps(burrows) {
    const bounds = roamBounds();
    let blockedDash = false;
    const obstacles = ROCKS.map((rock) => {
      const [x, z] = scalePoint(rock);
      return { x, z, r: scaleRadius(rock[2]) + 0.72 * this.cfg.scale };
    });
    for (const burrow of (Array.isArray(burrows) ? burrows : burrows ? [burrows] : [])) obstacles.push({ x: burrow.x, z: burrow.z, r: burrow.r + 2.5 });
    for (const obstacle of obstacles) {
      let dx = this.x - obstacle.x, dz = this.z - obstacle.z;
      let dist = Math.hypot(dx, dz);
      if (dist >= obstacle.r) continue;
      if (dist < 1e-4) {
        dx = Math.sin(this.yaw); dz = Math.cos(this.yaw);
        dist = Math.hypot(dx, dz) || 1;
      }
      this.x = obstacle.x + dx / dist * obstacle.r;
      this.z = obstacle.z + dz / dist * obstacle.r;
      if (this.state === 'rest') {
        const nx = dx / dist, nz = dz / dist;
        const inward = this.dashVX * nx + this.dashVZ * nz;
        if (inward < 0) {
          this.dashVX -= nx * inward;
          this.dashVZ -= nz * inward;
        }
      }
      blockedDash = true;
    }
    this.x = clamp(this.x, -bounds.hw, bounds.hw);
    this.z = clamp(this.z, -bounds.hh, bounds.hh);
    if (this.x <= -bounds.hw + 1e-6 && this.dashVX < 0) this.dashVX = 0;
    if (this.x >= bounds.hw - 1e-6 && this.dashVX > 0) this.dashVX = 0;
    if (this.z <= -bounds.hh + 1e-6 && this.dashVZ < 0) this.dashVZ = 0;
    if (this.z >= bounds.hh - 1e-6 && this.dashVZ > 0) this.dashVZ = 0;
    if (blockedDash) this._stopDashAtObstacle();
  }

  /** 自主撤退入口：选好休息点，转入 retreat。撤退途中不受打断、不能攻击。 */
  _enterRetreat(p, burrows) {
    if (this.retreating || this.state === 'rest_safe' || this.state === 'dead') return;
    this.restPoint = chooseRestPoint({
      foxX: this.x, foxZ: this.z, playerX: p.x, playerZ: p.z,
      burrows, bounds: roamBounds(),
    }, FOX.retreat);
    this.state = 'retreat';
    this.retreating = true;
    this.warn.visible = false;
    this.comboActive = false;
    this.comboLeft = 0;
    this.leap = 0;
  }

  /** 到达休息点 → 安全休息。进入这一刻（且仅这一刻）触发一次驱退计数。 */
  _enterRestSafe() {
    const r = enterRestSafe({ repelCounted: this.repelCounted },
      FOX.retreat.restSeconds[this.type] ?? FOX.retreat.restSeconds.normal);
    this.state = r.state;
    this.timer = r.timer;
    this.repelCounted = r.repelCounted;
    this.warn.visible = false;
    if (r.justCounted) this.onRepelled?.(this);
  }

  /** 休息结束 → 重新参战；repelCounted 复位，下次撤退可再次计数。 */
  _exitRestSafe() {
    const r = exitRestSafe();
    this.state = r.state;
    this.retreating = r.retreating;
    this.restPoint = r.restPoint;
    this.repelCounted = r.repelCounted;
    this.hitStreak = r.hitStreak;
    this.timer = 0;
    if ('fatigue' in this) this.fatigue = 0;   // 智能狐：休息好了一起清疲劳
  }

  _enterLinger(burrow) {
    if (!burrow) return;
    this.state = 'linger';
    this.timer = burrow.type === 'base' ? BURROW_AI.lingerBase : BURROW_AI.lingerShelter;
    this.comboActive = false;
    this.comboLeft = 0;
    this.leap = 0;
    this.warn.visible = false;
  }

  /** 进入蓄力：记录完整蓄力时长并点亮预警线 */
  _enterWind() {
    if (this.attackCooldown > 0 || this._stateAge < 0.25) return false;
    this.state = 'wind';
    this._stateAge = 0;
    this.windFull = this.levelCfgWind * this.attack.windMul * (this.sandboxAlertMul || 1);
    this.windTotal = this.windFull;
    this.timer = this.windFull;
    this.warn.visible = true;
    return true;
  }

  /** 蓄力结束 → 冲刺 */
  _beginDash() {
    // 体力守卫：体力不足不允许发起冲刺 —— 退回喘息（不是被驱退！）。
    if (this.staminaLocked > 0 || !canSprint(this.stamina, FOX.vitals.sprintStaminaPerSec, this.dashTime)) {
      this.state = 'rest';
      this.timer = Math.max(this.timer, 0.6);
      this.warn.visible = false;
      this.comboActive = false;
      this.comboLeft = 0;
      this.leap = 0;
      return;
    }
    const wasCombo = this.comboActive;
    this.state = 'dash';
    this._stateAge = 0;
    this.turnVelocity = 0;
    this.timer = this.dashTime;
    this.dashDirX = Math.sin(this.yaw);
    this.dashDirZ = Math.cos(this.yaw);
    this.warn.visible = false;
    this.lured = true; // 虚晃过后必须真的冲，否则玩家会觉得它一直在骗人
    // 只有**一轮连冲的开始**才设置段数。
    // 连冲中段的 _beginDash 是从 dash→wind→dash 回来的，
    // 若这里无条件重置，首领会变成无限连冲。
    if (this.attack.mode === 'combo' && !wasCombo) {
      this.comboActive = true;
      this.comboLeft = this.attack.comboCount - 1;
    }
  }

  _angleLerp(a, b, t) {
    let d = b - a;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return a + d * Math.min(1, t);
  }

  /**
   * 被驱退后的逃跑行为。
   * 藏狐不会原地消失，而是夹尾奔向离玩家最远的场地边缘，
   * 逃出一定距离后才移除并（普通狐）重新出现。
   */
  _updateFlee(dt, terrainAt, levelCfg, p) {
    this.mesh.visible = true;   // 逃跑中必须可见
    this.warn.visible = false;
    this.hpBar.visible = false;
    this.staminaBar.visible = false;

    // 若玩家追上来，临时改变逃跑方向（避免一路直线跑到底显得假）
    if (p) {
      const dxp = this.x - p.x, dzp = this.z - p.z;
      const dp = Math.hypot(dxp, dzp);
      if (dp < 9 && dp > 0.01) {
        const want = Math.atan2(dxp / dp, dzp / dp);
        // 平滑转向，避免突然折返
        let delta = want - this.fleeYaw;
        while (delta > Math.PI) delta -= Math.PI * 2;
        while (delta < -Math.PI) delta += Math.PI * 2;
        this.fleeYaw += delta * Math.min(1, dt * 4);
      }
    }

    // 朝逃跑方向持续奔跑
    this.x += Math.sin(this.fleeYaw) * FOX.fleeSpeed * dt;
    this.z += Math.cos(this.fleeYaw) * FOX.fleeSpeed * dt;

    // 逃出场地边界即视为离开视野（GS 版按缩放后的活动场判定）
    const eb = roamBounds();
    const escaped = Math.abs(this.x) > eb.hw || Math.abs(this.z) > eb.hh
      || this.fleeTime > FOX.fleeMaxTime;

    this.fleeTime += dt;
    this.mesh.position.set(this.x, terrainAt(this.x, this.z), this.z);
    this.mesh.rotation.y = this.fleeYaw;
    // 逃跑时身体压低、四肢急促摆动
    this._bob += dt * 16;
    this.mesh.position.y += Math.abs(Math.sin(this._bob)) * 0.14;
    this.mesh.rotation.z = Math.sin(this._bob * 0.5) * 0.12;

    if (escaped) {
      this.mesh.visible = false;
      this.fleeing = false;
      this.fleeTime = 0;
      // 逃出后等待增援时间（首领不再回来）
      this.respawn = levelCfg && levelCfg.reinforce ? levelCfg.reinforce : 8;
    }
  }

  /**
   * 进入逃跑状态。由 main 命中判定调用。
   * awayFromX/Z 传入玩家位置，用于确定逃跑方向。
   */
  startFleeing(awayFromX, awayFromZ, levelCfg) {
    if (this.fleeing) return;
    this.fleeing = true;
    this.fleeTime = 0;
    this.hp = 0;
    this.stun = 0;
    this.state = 'flee';
    this.warn.visible = false;
    this.hpBar.visible = false;
    this.staminaBar.visible = false;
    // 沿"远离玩家 + 推向最近边界"的方向跑，避免在原地来回
    const dx = this.x - awayFromX, dz = this.z - awayFromZ;
    const len = Math.hypot(dx, dz) || 1;
    let fx = dx / len, fz = dz / len;
    // 叠加一个偏向边界的分量
    fx += Math.sign(this.x) * 0.6;
    fz += Math.sign(this.z) * 0.6;
    const fl = Math.hypot(fx, fz) || 1;
    this.fleeYaw = Math.atan2(fx / fl, fz / fl);
    this.respawn = (levelCfg && levelCfg.reinforce) || 8;
    this.mesh.scale.setScalar(this.cfg.scale);
  }

  _sampleGroundY(terrainAt) {
    const r = 0.34;
    const samples = [
      terrainAt(this.x, this.z), terrainAt(this.x + r, this.z), terrainAt(this.x - r, this.z),
      terrainAt(this.x, this.z + r), terrainAt(this.x, this.z - r),
    ];
    return sampleWalkableGround(samples, this._groundY);
  }

  _applyTransform(dt, terrainAt) {
    const targetY = this._sampleGroundY(terrainAt);
    if (this._groundY == null) this._groundY = targetY;
    this._groundY = stepGroundY(this._groundY, targetY, dt, 3.2);
    this.baseY = this._groundY;
    // Position is written once, after logical movement and ground solve. Animation
    // only rotates/scales child parts; it never contributes root translation.
    this.mesh.position.set(this.x, this._groundY, this.z);
    this.mesh.rotation.y = this.yaw;
    const speedish = this.state === 'dash' ? 12 : this.state === 'roam' ? 2 : 0;
    this.mesh.rotation.x = this.state === 'rest' ? 0.12 : (this.leap ? -0.34 * Math.min(1, this.leap) : 0);
    this._bob += dt * (2 + speedish);
    // 跃扑腾空：最高点要明显高于玩家跳跃的 dodgeHeight(0.34)，
    // 否则"跳过幼狐的扑击"这个反制手段无效。
    if (this.leap) {
      this.mesh.position.y = this._groundY + this.leap;
      // 腾空时前倾，像真的扑出去
      this.mesh.rotation.x = -0.34 * Math.min(1, this.leap);
    }
    // 蓄力时身体后仰下压。真实模型没有内建骨骼动画，用整体 Y 压缩表达"压低身子"，
    // 这对两套模型都成立。
    // 注意分母用 windFull（本次蓄力的完整时长），连冲的短蓄力也能正确压下去。
    const crouch = this.state === 'wind'
      ? 1 - Math.max(0, Math.min(1, this.timer / Math.max(0.01, this.windFull)))
      : 0;
    // 统一缩放（类型体型 × 基准系数），两套模型共用同一条路径，
    // 这样切换模型时视觉大小一致。
    // normalizeModel 已把真实模型归一到 ~1m 高，故基准系数相同。
    const bs = FOX_MODEL_BASE;
    this.mesh.scale.set(
      this.cfg.scale * bs,
      this.cfg.scale * bs * (1 - crouch * 0.14),
      this.cfg.scale * bs,
    );

    // 血条/体力条跟随实际渲染高度（this.baseY 已由 _applyTransform 平滑赋值），
    // 不用 terrainAt() 再算一次——地表格点与平滑后的落地高度可能不一致，
    // 会让血条在坡地上轻微浮沉。
    this.hpBar.position.set(this.x, this.baseY + 1.55 * this.cfg.scale, this.z);
    this.staminaBar.position.set(this.x, this.baseY + 1.38 * this.cfg.scale, this.z);  }

  _updateWarn(terrainAt = null) {
    if (!this.warn.visible) return;
    this.warn.position.set(this.x, this.baseY + 0.02, this.z);
    this.warn.rotation.y = this.yaw;
    // 长度必须等于**真实冲刺距离**：玩家靠预警线判断"往哪躲、躲多远"，
    // 长度一旦失真，"线到头了但狐还在冲"的失信就无从避免。
    // 注意要乘类型自己的 dashSpeedMul —— 首领单段比普通狐短，
    // 用基础 dashSpeed 算会让首领的预警线明显过长。
    const dist = FOX.dashSpeed * (this.dashTime || 0.32)
      * ((this.attack && this.attack.dashSpeedMul) || 1);
    // 蓄力越久越亮、越不透明；同时随倒计时"充能"变长
    const total = this.windTotal || 0.8;
    const k = 1 - Math.max(0, Math.min(1, this.timer / total));
    this.warn.material.opacity = 0.26 + k * 0.5;
    // 满蓄力（k=1）时**必须精确等于 dist**。
    // 早先用 `0.25 + k * 0.75 * dist`：满值只到 0.75×dist ——
    // 玩家在最关键的那一刻看到的线是短的（实测 8.85m vs 实际 11.47m）。
    // 后来又改成 `0.15 + k * 0.85 * dist`，仍是加法常数，满值 0.15+0.85×dist ≠ dist。
    // 正确：整体乘以 (0.15 + 0.85k)，这样 k=1 时精确等于 dist。
    this.warn.scale.z = dist * (0.15 + 0.85 * k);
  }

  _updateHpBar() {
    // 受伤或已被玩家察觉时显示血条（阶段 4：发现狐狸后才能看到它的状态），避免画面 clutter。
    const damaged = this.hp < this.maxHp;
    if (!damaged && !this.detected) { this.hpBar.visible = false; return; }

    this.hpBar.visible = true;
    // 血条结构：group(不缩放) → bg 底框 + fill 填充条(userData.fill)。
    // 只缩放 fill 并让其左端固定（向左收缩）；底框必须保持原位、原尺寸。
    // 早期代码缩放整个 group 又移动 children[0](即底框)，结果底框被推偏、
    // 与填充条错位，血越少偏得越多。
    const ratio = Math.max(0.001, this.hp / this.maxHp);
    const fill = this.hpBar.userData.fill;
    fill.scale.x = ratio;
    fill.position.x = -(1 - ratio) * 0.48; // 填充条宽 0.96，左锚收缩
    fill.position.z = 0.001;
    this.hpBar.lookAt(this.hpBar.position.x, this.hpBar.position.y + 20, this.hpBar.position.z + 0.01);
  }

  /** 体力条：与血条同款 billboard，不满且已被察觉时显示，避免画面 clutter */
  _updateStaminaBar() {
    const low = this.stamina < this.maxStamina - 0.5;
    if (!low || !this.detected) { this.staminaBar.visible = false; return; }

    this.staminaBar.visible = true;
    const ratio = Math.max(0.001, this.stamina / this.maxStamina);
    const fill = this.staminaBar.userData.fill;
    fill.scale.x = ratio;
    fill.position.x = -(1 - ratio) * 0.48; // 与血条一致：左锚收缩
    fill.position.z = 0.001;
    this.staminaBar.lookAt(this.staminaBar.position.x, this.staminaBar.position.y + 20, this.staminaBar.position.z + 0.01);
  }

  /** 受击：扣血 + 击退 + 硬直 */
  /**
   * 命中。返回 true 表示"这只藏狐被打死"（hp ≤ 0 → 真死，不逃跑不重生）。
   * 驱退不再由受击触发：狐狸血量/体力见底时会自主撤退，见 _enterRetreat()。
   */
  hit(damage, knockback, stun, fromX, fromZ) {
    if (this.hp <= 0) return false;
    if (this.isSandboxDummy) {
      const floor = this.dummyDefeatable ? 0 : 1;
      this.hp = Math.max(floor, this.hp - damage);
      this.dummyNoHitTimer = SANDBOX_DUMMY_REGEN_DELAY;
      this.knockbackVX = this.knockbackVZ = 0;
      this.stun = 0;
      this.leap = 0;
      this.fleeing = false;
      this.stamina = Math.max(0, this.stamina - FOX.vitals.hitStaminaCost);
      this.state = this.hp > 0 ? 'dummy' : 'defeated';
      this.warn.visible = false;
      return this.hp <= 0;
    }
    this.hp = Math.max(0, this.hp - damage);
    this.stamina = Math.max(0, this.stamina - FOX.vitals.hitStaminaCost);
    this.hitStreak = (this.hitStreak ?? 0) + 1;
    this._sinceHit = 0;
    const dx = this.x - fromX, dz = this.z - fromZ;
    const d = Math.hypot(dx, dz) || 1;
    const impulse = knockback * (FOX.types[this.type]?.knockbackMul ?? 1);
    this.knockbackVX = clamp(this.knockbackVX + (dx / d) * impulse, -8, 8);
    this.knockbackVZ = clamp(this.knockbackVZ + (dz / d) * impulse, -8, 8);
    this.stun = stun * (this.type === 'boss' ? 0.45 : 1);
    // 血量归零 → 真死：不 flee、不 respawn。
    const dead = resolveHitState(this.hp);
    if (dead) {
      this.state = dead;
      this.retreating = false;
      this.comboActive = false;
      this.comboLeft = 0;
      this.leap = 0;
      this.warn.visible = false;
      return true;
    }
    // 撤退/安全休息中的狐狸被打不退出撤退、不重置 repelCounted（撤退不受打断）。
    if (this.retreating || this.state === 'rest_safe') return false;
    // 受击必然打断当前攻击节奏。除了回到 roam，还必须清掉连冲账本：
    // 否则 comboActive 仍为 true，首领下一次正常蓄力进 _beginDash 时
    // 会被当成"连冲中段"，段数与 windTotal 全是错的。
    this.state = 'roam';
    this.comboActive = false;
    this.comboLeft = 0;
    this.leap = 0;
    this.warn.visible = false;
    return false;
  }

  /** 被驱退一段时间后重新出现（增援）。必须清干净逃跑态，否则会立刻再次逃走。 */
  respawnAt(x, z) {
    this.x = x; this.z = z;
    this.mesh.visible = true;
    this.hp = this.maxHp;
    this.stamina = this.maxStamina;
    this.staminaLocked = 0;
    this.state = 'roam';
    this.stun = 0;
    this.timer = 0;
    this.fleeing = false;
    this.fleeTime = 0;
    this.retreating = false;
    this.restPoint = null;
    this.repelCounted = false;
    this.hitStreak = 0;
    this._sinceHit = Infinity;
    this._restoreVisibility();
    this.mesh.rotation.z = 0;
    this.mesh.scale.setScalar(this.cfg.scale * FOX_MODEL_BASE);
    this.respawn = 0;
  }

  dispose(scene) {
    if (this._disposed) return;
    this._disposed = true;
    // 程序化网格和 HUD 资源均为实例所有；GLB 几何体/贴图由模型缓存共享。
    const disposeTree = (root, { geometry = true, textures = true } = {}) => {
      if (!root) return;
      root.traverse?.((o) => {
        if (geometry && o.geometry) o.geometry.dispose?.();
        if (o.material) {
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          for (const m of mats) {
            // 名称标签用 CanvasTexture，必须显式释放；GLB 贴图会被实例共享。
            if (textures && m.map) m.map.dispose?.();
            m.dispose?.();
          }
        }
      });
    };

    scene.remove(this.mesh);
    scene.remove(this.warn);
    scene.remove(this.hpBar);
    scene.remove(this.staminaBar);
    disposeTree(this.proceduralMesh);
    disposeTree(this.hiFiMesh);
    disposeTree(this.realModel, { geometry: false, textures: false });
    disposeTree(this.warn);
    disposeTree(this.hpBar);
    disposeTree(this.staminaBar);
  }
}

// 取色兜底：新增类型若忘记配置颜色，回退到 normal 而不是 undefined
// （undefined 会让 three.js 报 "parameter 'color' has value of undefined" 警告）
const furColor = (type) => TYPE_FUR[type] ?? TYPE_FUR.normal;
const accentColor = (type) => TYPE_COLOR[type] ?? TYPE_COLOR.normal;

/** 程序化藏狐：四足 + 身体 + 头 + 耳 + 尾 */
function buildFoxMesh(type, scale) {
  const g = new THREE.Group();
  const fur = new THREE.MeshStandardMaterial({ color: furColor(type), roughness: 0.92 });
  const dark = new THREE.MeshStandardMaterial({ color: accentColor(type), roughness: 0.9 });
  const cream = new THREE.MeshStandardMaterial({ color: 0xf2e6d2, roughness: 0.95 });

  const bodySize = type === 'boss' ? [0.62, 0.52, 1.15]
    : type === 'heavy' ? [0.55, 0.5, 0.95]
    : type === 'fast' ? [0.4, 0.38, 0.95]
    : [0.46, 0.42, 0.9];

  // 身体
  const bodyGeo = new THREE.CapsuleGeometry(bodySize[0] * 0.62, bodySize[2], 4, 12);
  const body = new THREE.Mesh(bodyGeo, fur);
  body.rotation.x = Math.PI / 2;
  body.position.y = 0.52;
  body.castShadow = true;
  g.add(body);

  // 胸腹浅色
  const chest = new THREE.Mesh(new THREE.SphereGeometry(bodySize[0] * 0.5, 12, 10), cream);
  chest.position.set(0, 0.36, bodySize[2] * 0.3);
  chest.scale.set(0.9, 0.75, 0.7);
  g.add(chest);

  // 颈 + 头
  const headGeo = new THREE.SphereGeometry(type === 'boss' ? 0.34 : 0.26, 14, 12);
  const head = new THREE.Mesh(headGeo, fur);
  head.position.set(0, 0.72, bodySize[2] * 0.5 + 0.16);
  head.castShadow = true;
  g.add(head);

  // 吻部
  const snout = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.36, 8), cream);
  snout.rotation.x = Math.PI / 2;
  snout.position.set(0, 0.68, bodySize[2] * 0.5 + 0.42);
  g.add(snout);
  const nose = new THREE.Mesh(new THREE.SphereGeometry(0.055, 8, 8), new THREE.MeshStandardMaterial({ color: 0x2a1a14, roughness: 0.5 }));
  nose.position.set(0, 0.69, bodySize[2] * 0.5 + 0.6);
  g.add(nose);

  // 眼：发光，让突进方向可读
  // 眼：写实处理 —— 狐狸虹膜多为琥珀褐/金褐，这里用暗金褐而非发光红，
  // 保留首领略微明显的反光感，但不再用夸张的红色发光。
  const eyeMat = new THREE.MeshStandardMaterial({
    color: type === 'boss' ? 0x8a5a24 : 0x6b4a1f,
    emissive: type === 'boss' ? 0x2a1608 : 0x140c04,
    emissiveIntensity: type === 'boss' ? 0.5 : 0.18,
    roughness: 0.35,
  });
  for (const s of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.048, 8, 8), eyeMat);
    eye.position.set(s * 0.13, 0.78, bodySize[2] * 0.5 + 0.34);
    g.add(eye);
  }

  // 耳：三角锥，fast 型更大更尖
  const earH = type === 'fast' ? 0.3 : type === 'boss' ? 0.28 : 0.2;
  for (const s of [-1, 1]) {
    const ear = new THREE.Mesh(new THREE.ConeGeometry(0.11, earH, 4), dark);
    ear.position.set(s * 0.17, 0.72 + earH * 0.42, bodySize[2] * 0.5 + 0.05);
    ear.rotation.z = s * 0.28;
    g.add(ear);
  }

  // 腿
  const legGeo = new THREE.CylinderGeometry(0.055, 0.045, 0.42, 6);
  for (const [sx, sz] of [[-1, 1], [1, 1], [-1, -1], [1, -1]]) {
    const leg = new THREE.Mesh(legGeo, dark);
    leg.position.set(sx * bodySize[0] * 0.42, 0.2, sz * bodySize[2] * 0.32);
    leg.castShadow = true;
    g.add(leg);
  }

  // 尾：狐尾蓬松
  const tailGeo = new THREE.CapsuleGeometry(0.16, 0.7, 4, 10);
  const tail = new THREE.Mesh(tailGeo, fur);
  tail.rotation.x = Math.PI / 2.4;
  tail.position.set(0, 0.62, -bodySize[2] * 0.55);
  tail.castShadow = true;
  g.add(tail);
  const tailTip = new THREE.Mesh(new THREE.SphereGeometry(0.15, 8, 8), cream);
  tailTip.position.set(0, 0.78, -bodySize[2] * 0.55 - 0.42);
  g.add(tailTip);

  // 首领颈鬃：视觉压迫感
  if (type === 'boss') {
    const maneGeo = new THREE.TorusGeometry(0.44, 0.19, 8, 16);
    const mane = new THREE.Mesh(maneGeo, dark);
    mane.rotation.x = Math.PI / 2;
    mane.position.set(0, 0.72, bodySize[2] * 0.28);
    g.add(mane);
    // 背部尖刺
    for (let i = 0; i < 4; i++) {
      const spike = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.26, 5), dark);
      spike.position.set(0, 0.9, -0.3 + i * 0.26);
      g.add(spike);
    }
  }

  g.scale.setScalar(scale);
  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; } });
  return g;
}

/**
 * 地面蓄力预警条：沿**冲刺方向**延伸的红色梯形。
 *
 * 方向约定（全项目必须一致）：
 *   藏狐模型的朝向是 `mesh.rotation.y = yaw`，而 three.js 里 yaw=0 朝 **+Z**，
 *   冲刺方向即 `(sin(yaw), cos(yaw))` = **局部 +Z**。
 *   所以预警条必须沿局部 +Z 延伸。
 *
 * 踩过的坑：早期用 `ShapeGeometry`（在 XY 平面，+Y 方向）再 `rotateX(-PI/2)`，
 * 绕 X 轴转 -90° 会把 +Y 映射到 **-Z**，于是预警条指向冲刺的**反方向** ——
 * 玩家看到红色预警线朝自己身后的方向亮起，往那边躲反而被撞。
 * 正确做法是直接在 XZ 平面构建几何，用 `+Z` 作为延伸方向。
 */
function buildWarnIndicator() {
  const LEN = 1.0;    // 单位长度，实际长度由 scale.z 控制
  const W_ROOT = 0.55; // 起点半宽
  const W_TIP = 0.30;  // 末端半宽
  // 沿 +Z 方向的梯形，直接给 XZ 平面顶点（不需要任何旋转）
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([
    -W_ROOT, 0, 0,
    W_ROOT, 0, 0,
    W_TIP, 0, LEN,
    -W_TIP, 0, LEN,
  ], 3));
  geo.setIndex([0, 1, 2, 0, 2, 3]);
  geo.computeVertexNormals();

  const mat = new THREE.MeshBasicMaterial({
    color: 0xff3a2a, transparent: true, opacity: 0.4,
    depthWrite: false, side: THREE.DoubleSide,
  });
  const m = new THREE.Mesh(geo, mat);
  m.renderOrder = 2;
  m.frustumCulled = false; // 预警条是贴地薄片，包围盒极薄，容易被视锥剔除误伤
  return m;
}

/** 敌人血条 billboard */
function buildHpBar() {
  const g = new THREE.Group();
  const bgGeo = new THREE.PlaneGeometry(1, 0.13);
  const bgMat = new THREE.MeshBasicMaterial({ color: 0x222222, transparent: true, opacity: 0.75, depthTest: false });
  const bg = new THREE.Mesh(bgGeo, bgMat);
  bg.renderOrder = 10;
  g.add(bg);

  const fillGeo = new THREE.PlaneGeometry(0.96, 0.09);
  const fillMat = new THREE.MeshBasicMaterial({ color: 0xd8735a, depthTest: false });
  const fill = new THREE.Mesh(fillGeo, fillMat);
  fill.position.z = 0.001;
  fill.renderOrder = 11;
  g.add(fill);
  g.userData.fill = fill;
  return g;
}

/** 体力条 billboard：与血条同结构，暖金色，位于血条下方 */
function buildStaminaBar() {
  const g = new THREE.Group();
  const bgGeo = new THREE.PlaneGeometry(1, 0.13);
  const bgMat = new THREE.MeshBasicMaterial({ color: 0x222222, transparent: true, opacity: 0.75, depthTest: false });
  const bg = new THREE.Mesh(bgGeo, bgMat);
  bg.renderOrder = 10;
  g.add(bg);

  const fillGeo = new THREE.PlaneGeometry(0.96, 0.09);
  const fillMat = new THREE.MeshBasicMaterial({ color: 0xe0b34a, depthTest: false });
  const fill = new THREE.Mesh(fillGeo, fillMat);
  fill.position.z = 0.001;
  fill.renderOrder = 11;
  g.add(fill);
  g.userData.fill = fill;
  return g;
}
