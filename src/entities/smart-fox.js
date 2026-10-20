import { Fox } from './fox.js';
import { FOX, roamBounds } from '../core/config.js';
import { clamp, terrainHeight } from '../core/utils.js';
import {
  utilityScores,
  updatePerception,
  applyInterruption,
  stepSmartMotion,
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
      maxTurnRate: 2.8, acceleration: 18, pounceCooldown: 0,
    };
  }

  update(dt, p, safe, levelCfg, burrows, terrainAt = terrainHeight) {
    // 被驱退/死亡/眩晕时退回普通狐狸逻辑（逃跑、击退位移等）。
    if (this.fleeing || this.hp <= 0 || this.stun > 0) {
      return super.update(dt, p, safe, levelCfg, burrows, terrainAt);
    }

    const dx = p.x - this.x;
    const dz = p.z - this.z;
    const distance = Math.hypot(dx, dz);
    const facingYaw = p.facingYaw ?? p.bodyYaw ?? p.yaw ?? 0;
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
    this.intent = intent;
    this.topScores = scores.scores;

    // —— 交战战术：把抽象意图映射成具体运动目标点 ——
    // stepSmartMotion 只提供转向/加减速/不可取消扑击原语，永远朝目标点走，
    // 故由本层按意图选点，避免逼近时穿过玩家、喘息时仍贴脸。
    const STAND = { observe: 7.2, approach: 3.4, feint: 4.6, recover: 11, abandon: 15 };
    const toP = Math.atan2(dx, dz);          // 狐→玩家 方位角
    const dn = distance || 1;
    const ux = -dx / dn, uz = -dz / dn;      // 玩家→狐 单位向量（身后方向）
    let aimX = p.x, aimZ = p.z;
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
      this.intent,
    );
    this._smartState = next;
    this.x = next.x;
    this.z = next.z;
    this.yaw = next.yaw;
    this.pounceCommitted = !!next.pounceCommitted;

    // 映射到既有动画状态：扑击=dash（驱动预警/接触），喘息/放弃=rest，其余=roam。
    this.state = this.pounceCommitted
      ? 'dash'
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
    this.warn.visible = this.pounceCommitted;
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
