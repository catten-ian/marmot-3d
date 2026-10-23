import { Fox } from './fox.js';
import { FOX, ROCKS, BURROWS, roamBounds, scalePoint, scaleRadius } from '../core/config.js';
import { clamp, terrainHeight } from '../core/utils.js';
import {
  utilityScores,
  updatePerception,
  applyInterruption,
  stepSmartMotion,
  separationVector,
  isSegmentReachable,
} from './smart-fox-core.mjs';

/**
 * 沙盒专用智能藏狐：纯效用决策 + 120° 感知锥 + 怀疑度/记忆 + 加减速与最大转向率，
 * 扑击(pounce)一旦发动不可取消，随后进入 recover。仅在自由测试沙盒中由面板生成，
 * 正式关卡与普通 Fox 完全不引用本类。
 *
 * 与 dev 原型的差异：rev13 接触伤害不看 state，只看距离+高度重叠，
 * 因此主循环对智能狐额外门控，仅 pounceCommitted 时才造成接触伤害。
 */
export class SmartFox extends Fox {
  constructor(scene, x, z, level, slot, opts = {}) {
    super(scene, x, z, 'normal', level, slot, opts);
    this.type = 'smart';
    this.cfg = { ...this.cfg, label: '智能狐', scale: (this.cfg.scale || 1) * 1.04 };
    this.maxHp = this.hp = opts.hp ?? this.maxHp;
    this.intent = 'observe';
    this.topScores = {};
    this.suspicion = 0;
    this.memory = 0;
    this.interruptions = 0;
    this.fatigue = 0;
    this.pounceCommitted = false;
    this._smartState = {
      x, z, vx: 0, vz: 0, yaw: this.yaw,
      maxTurnRate: 2.8, acceleration: 18, pounceCooldown: 0, telegraphT: 0,
    };
  }

  update(dt, p, safe, levelCfg, burrows, terrainAt = terrainHeight, _currentBurrow = null, allFoxes = []) {
    // 被驱退/死亡/眩晕时退回普通狐狸逻辑（逃跑、击退位移等）。
    if (this.fleeing || this.hp <= 0 || this.stun > 0) {
      return super.update(dt, p, safe, levelCfg, burrows, terrainAt);
    }

    const dx = p.x - this.x;
    const dz = p.z - this.z;
    const distance = Math.hypot(dx, dz);
    const facingYaw = p.facingYaw ?? p.bodyYaw ?? p.yaw ?? 0;
    const obstacles = ROCKS.map((rock) => { const [ox, oz] = scalePoint(rock); return { x: ox, z: oz, r: scaleRadius(rock[2]) + 0.72 * this.cfg.scale }; });
    for (const b of (Array.isArray(burrows) ? burrows : burrows ? [burrows] : BURROWS)) obstacles.push({ x: b.x, z: b.z, r: (b.r || 0) + 2.5 });
    const reachable = isSegmentReachable(this, p, obstacles, 0.82);
    const separation = separationVector(this, (allFoxes || []).filter((f) => f !== this && f.alive !== false), 1.85, 2.2);
    const viewDot = Math.cos(facingYaw - Math.atan2(this.x - p.x, this.z - p.z));
    const guard = !!(p.guard || p.guarding);

    const perceived = updatePerception({ suspicion: this.suspicion }, {
      distance, viewDot, guard, running: !!p.running,
    }, dt);
    this.suspicion = perceived.suspicion;

    const scores = utilityScores({
      distance,
      playerFacing: Math.max(0, viewDot),
      guard,
      fatigue: this.fatigue,
      health: this.hp / this.maxHp,
      interruptions: this.interruptions,
      memory: this.memory,
      suspicion: this.suspicion,
    });
    let intent = this.pounceCommitted ? 'pounce' : scores.topIntent;
    if (safe) intent = 'recover';
    // Telegraph is finite and path-gated: an obstructed target becomes approach/reposition.
    if (!this.pounceCommitted && this._smartState.telegraphT > 0) {
      this._smartState.telegraphT = Math.max(0, this._smartState.telegraphT - dt);
      if (!reachable || this._smartState.telegraphT <= 0 && !reachable) {
        this._smartState.telegraphT = 0; intent = 'approach';
      } else if (this._smartState.telegraphT <= 0) {
        intent = 'pounce';
      } else {
        intent = 'observe';
      }
    } else if (!this.pounceCommitted && intent === 'pounce') {
      if (reachable) { this._smartState.telegraphT = 0.55; intent = 'observe'; }
      else intent = 'approach';
    }
    this.intent = intent;
    this.topScores = scores.scores;

    // —— 交战战术：把抽象意图映射成具体运动目标点 ——
    // stepSmartMotion 只提供转向/加减速/不可取消扑击原语，永远朝目标点走，
    // 故由本层按意图选点，避免逼近时穿过玩家、喘息时仍贴脸。
    const STAND = { observe: 7.2, approach: 3.4, feint: 4.6, recover: 11, abandon: 15 };
    const toP = Math.atan2(dx, dz);          // 狐→玩家 方位角
    const dn = distance || 1;
    const ux = -dx / dn, uz = -dz / dn;      // 玩家→狐 单位向量（身后方向）
    let aimX = p.x + separation.x * 2.2, aimZ = p.z + separation.z * 2.2;
    if (!this.pounceCommitted) {
      if (intent === 'recover' || intent === 'abandon') {
        const R = STAND[intent];
        aimX = p.x + ux * R; aimZ = p.z + uz * R;
      } else if (intent === 'feint') {
        const side = (this.interruptions % 2 === 0 ? 1 : -1);
        const a = toP + side * 1.05;
        aimX = p.x - Math.sin(a) * STAND.feint;
        aimZ = p.z - Math.cos(a) * STAND.feint;
      } else {
        const R = STAND[intent] ?? STAND.approach;   // observe / approach 保持半径
        aimX = p.x + ux * R; aimZ = p.z + uz * R;
      }
    }
    // committed pounce：直扑玩家本体，冲穿后由 recover 拉开。
    const next = stepSmartMotion(
      {
        ...this._smartState,
        x: this.x, z: this.z, yaw: this.yaw,
        pounceCommitted: this.pounceCommitted,
        pounceCooldown: this._smartState.pounceCooldown || 0,
        intent: this.intent,
      },
      { x: aimX, z: aimZ },
      dt,
      intent,
    );
    this._smartState = next;
    this.x = next.x;
    this.z = next.z;
    this.yaw = next.yaw;
    this.pounceCommitted = !!next.pounceCommitted;

    // 映射到既有动画状态：扑击=dash（驱动预警/接触），喘息/放弃=rest，其余=roam。
    this.state = this.pounceCommitted
      ? 'dash'
      : this._smartState.telegraphT > 0 ? 'wind'
      : (intent === 'recover' || intent === 'abandon') ? 'rest' : 'roam';
    this.leap = 0;

    // 疲劳循环：扑击消耗，喘息快速恢复，其余缓慢恢复，保证下一轮还能再扑。
    const fatRate = this.pounceCommitted ? 0.22
      : (intent === 'recover' || intent === 'abandon') ? -0.32 : -0.08;
    this.fatigue = clamp(this.fatigue + fatRate * dt, 0, 1);

    const bounds = roamBounds();
    this.x = clamp(this.x, -bounds.hw, bounds.hw);
    this.z = clamp(this.z, -bounds.hh, bounds.hh);

    this._resolveObstacleOverlaps(burrows);
    this._applyTransform(dt, terrainAt);
    this._updateHpBar();
    this.warn.visible = this.pounceCommitted || this._smartState.telegraphT > 0;
    this._updateWarn?.(terrainAt);
  }

  hit(damage, knockback, stun, fromX, fromZ) {
    const result = super.hit(damage, knockback, stun, fromX, fromZ);
    this.interruptions += 1;
    const m = applyInterruption(
      { memory: this.memory, interruptions: this.interruptions, health: this.hp / this.maxHp },
      'damage',
    );
    this.memory = m.memory ?? this.memory;
    this.fatigue = clamp(this.fatigue + 0.18, 0, 1);
    this.pounceCommitted = false;
    return result;
  }
}
