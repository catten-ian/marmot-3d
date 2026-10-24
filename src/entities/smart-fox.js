import { Fox } from './fox.js';
import { FOX, ROCKS, roamBounds, scalePoint, scaleRadius } from '../core/config.js';
import { SANDBOX_DIFFICULTIES } from '../sandbox/state.js';
import { clamp, terrainHeight } from '../core/utils.js';
import { canSprint, stepStamina, shouldRetreat } from '../core/fox-motion.js';
import {
  utilityScores,
  updatePerception,
  applyInterruption,
  stepSmartMotion,
  smartPounceDistance, updateSmartMemory, habituateDecayRate, stepInterruptionTimes,
  debounceIntent, createSmartPack, flankBias, foxSeparation, trackFeint, RECOVER_LOCK,
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
    this.smartDifficulty = 'standard';
    this.applySmartDifficulty(opts.difficulty || 'standard');
    this.telemetry = [];
    this._age = 0; this.lastInterruptionAt = 0; this._interruptionTimes = [];
    this._intentHeld = 0; this._intentCandidate = 'observe'; this._approachBand = false;
    this._feintSide = 1; this._feintRepeats = 0;
    this._feintPrevIntent = 'observe';
    this._recoverLock = 0;
  }

  applySmartDifficulty(key) {
    this.smartDifficulty = SANDBOX_DIFFICULTIES[key] ? key : 'standard';
    const d = SANDBOX_DIFFICULTIES[this.smartDifficulty].smart;
    Object.assign(this._smartState, { pounceSpeed: d.speed, approachSpeed: d.approach || ({calm:5.2,standard:6.8,intense:8.2}[this.smartDifficulty]), maxTurnRate: d.turn,
      pounceWindup: d.windup, pounceCooldownDuration: d.cooldown, memoryDecay: d.memoryDecay, feintScale: d.feint, coordination: d.coordination });
  }

  update(dt, p, safe, levelCfg, burrows, terrainAt = terrainHeight, currentBurrow = null, packContext = null) {
    // 被驱退/撤退/休息/死亡/眩晕时退回普通狐狸逻辑（撤退移动、rest_safe、击退位移等）。
    if (this.fleeing || this.hp <= 0 || this.stun > 0
      || this.retreating || this.state === 'rest_safe' || this.state === 'dead') {
      return super.update(dt, p, safe, levelCfg, burrows, terrainAt);
    }
    this._recoverLock = Math.max(0, this._recoverLock - Math.max(0, dt));

    // —— 智能狐更早撤退（阶段 2）：效用层本就让低血/疲劳个体偏向 recover/abandon，
    // 达到硬阈值（血量/体力/连被打）时直接转入自主撤退 —— 进 rest_safe 计入驱退，
    // 而不是等 hp≤0 才被动逃跑（它根本不该被打死）。
    if (!this.drillCtx && shouldRetreat({
      hpRatio: this.hp / this.maxHp,
      staminaRatio: this.stamina / this.maxStamina,
      hitStreak: this.hitStreak,
      state: this.state,
    }, FOX.retreat)) {
      this._enterRetreat(p, Array.isArray(burrows) ? burrows : (burrows ? [burrows] : []));
      return super.update(dt, p, safe, levelCfg, burrows, terrainAt);
    }

    // —— 体力收支（与普通狐同口径）：扑击消耗体力，喘息/脱离缓慢回血回体力 ——
    {
      const V = FOX.vitals;
      const resting = this.state === 'rest';
      const stepped = stepStamina({ stamina: this.stamina, locked: this.staminaLocked, hp: this.hp }, dt, {
        maxStamina: this.maxStamina,
        drainPerSec: this.pounceCommitted ? V.pounceStaminaPerSec : V.stalkStaminaPerSec,
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

    const dx = p.x - this.x;
    const dz = p.z - this.z;
    const distance = Math.hypot(dx, dz);
    const facingYaw = p.facingYaw ?? p.bodyYaw ?? p.yaw ?? 0;
    const viewDot = Math.cos(facingYaw - Math.atan2(this.x - p.x, this.z - p.z));
    const guard = !!(p.guard || p.guarding);

    this._age += dt;
    const aged = updateSmartMemory({ memory: this.memory, lastInterruptionAt: this.lastInterruptionAt }, dt, this._age, { memoryDecay: this._smartState.memoryDecay });
    this.memory = aged.memory;
    this._interruptionTimes = stepInterruptionTimes(this._interruptionTimes, this._age);
    this.interruptions = this._interruptionTimes.length;
    const perceived = updatePerception({ suspicion: this.suspicion }, {
      distance, viewDot, guard, running: !!p.running,
      decayRate: habituateDecayRate(.48, this._feintRepeats),
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
      feintScale: this._smartState.feintScale ?? 1,
    });
    let intent = this._recoverLock > 0 ? 'recover' : (this.pounceCommitted ? 'pounce' : scores.topIntent);
    const nearBand = this._approachBand ? 3.9 : 3.4;
    if (intent === 'approach' || intent === 'observe') {
      if (distance < nearBand) intent = 'observe'; else if (distance > 7.7) intent = 'approach'; else intent = this._approachBand ? 'approach' : 'observe';
      this._approachBand = intent === 'approach';
    }
    const debounced = debounceIntent(this._intentCandidate, intent, this._intentHeld, dt);
    this._intentCandidate = debounced.intent; this._intentHeld = debounced.held;
    intent = debounced.intent;
    if (safe) intent = 'recover';
    const tracked = trackFeint({ repeats: this._feintRepeats, side: this._feintSide, prevIntent: this._feintPrevIntent }, intent,
      { side: (this.slot % 2 === 0 ? 1 : -1) });
    this._feintRepeats = tracked.repeats; this._feintSide = tracked.side; this._feintPrevIntent = tracked.prevIntent;
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
        const side = this._feintSide;
        const a = toP + side * 1.05;
        aimX = p.x - Math.sin(a) * STAND.feint;
        aimZ = p.z - Math.cos(a) * STAND.feint;
      } else {
        const R = STAND[intent] ?? STAND.approach;   // observe / approach 保持半径
        aimX = p.x + ux * R; aimZ = p.z + uz * R;
      }
    }
    // committed pounce：直扑玩家本体，冲穿后由 recover 拉开。
    const peers = packContext?.smartFoxes || [];
    const sep = foxSeparation(this, peers);
    const bias = flankBias(this, peers, p, this._smartState.coordination);
    aimX += sep.x + Math.cos(toP) * bias * 2;
    aimZ += sep.z - Math.sin(toP) * bias * 2;
    const ground = !this.pounceCommitted ? this._groundSteer(aimX - this.x, aimZ - this.z, this._smartState.approachSpeed, burrows) : null;
    if (ground) { aimX = this.x + ground.x * 100; aimZ = this.z + ground.z * 100; }
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
      { commitAllowed: this._recoverLock <= 0
        // 体力守卫：体力不足时不提交扑击（体力耗尽 ≠ 被驱退，只是扑不出来）
        && this.staminaLocked <= 0
        && canSprint(this.stamina, FOX.vitals.pounceStaminaPerSec, this._smartState.pounceLockTime)
        && (!packContext?.coordinator || packContext.coordinator.canCommit(this.slot, this._age, this._smartState.coordination)) },
    );
    if (!this.pounceCommitted && next.pounceCommitted) {
      packContext?.coordinator?.recordCommit(this.slot, this._age);
      const reset = trackFeint({ repeats: this._feintRepeats, side: this._feintSide, prevIntent: this._feintPrevIntent }, 'pounce', { reset: 'pounce' });
      this._feintRepeats = reset.repeats; this._feintSide = reset.side; this._feintPrevIntent = reset.prevIntent;
    }
    if (next.pounceJustEnded) this._recoverLock = Math.max(this._recoverLock, RECOVER_LOCK);
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
    if (this.pounceCommitted && (this.x !== next.x || this.z !== next.z || Math.abs(this.x) >= bounds.hw || Math.abs(this.z) >= bounds.hh)) {
      this.pounceCommitted = false; this._smartState.pounceCommitted = false; this._smartState.pounceTime = 0;
      this._smartState.pounceCooldown = this._smartState.pounceCooldownDuration; this._smartState.vx = this._smartState.vz = 0;
      this.intent = 'recover'; this.state = 'rest';
    }
    this._applyTransform(dt, terrainAt);
    this._updateHpBar();
    this._updateStaminaBar();
    this.warn.visible = this.pounceCommitted || (this._smartState.windupRemaining > 0 && intent === 'pounce');
    this._updateWarn(terrainAt);
    this.telemetry.push({ intent, distance, guard, fatigue: this.fatigue, health: this.hp / this.maxHp,
      memory: this.memory, suspicion: this.suspicion, scores: { ...this.topScores } });
    if (this.telemetry.length > 192) this.telemetry.shift();
  }

  _updateWarn(terrainAt = terrainHeight) {
    if (!this.warn?.visible) return;
    this.warn.position.set(this.x, terrainAt(this.x, this.z) + .02, this.z);
    this.warn.rotation.y = this.pounceCommitted ? this._smartState.pounceYaw : this.yaw;
    const speed = Math.hypot(this._smartState.vx, this._smartState.vz);
    this.warn.scale.z = this.pounceCommitted
      ? smartPounceDistance(speed, this._smartState.pounceSpeed, this._smartState.acceleration, this._smartState.pounceTime)
      : smartPounceDistance(speed, this._smartState.pounceSpeed, this._smartState.acceleration, .72);
    this.warn.material.opacity = this.pounceCommitted ? .76 : .3;
  }

  hit(damage, knockback, stun, fromX, fromZ) {
    const result = super.hit(damage, knockback, stun, fromX, fromZ);
    this.interruptions += 1;
    this._age += 0; this.lastInterruptionAt = this._age; this._interruptionTimes.push(this._age);
    const m = applyInterruption(
      { memory: this.memory, interruptions: this.interruptions, health: this.hp / this.maxHp },
      'damage',
    );
    this.memory = m.memory ?? this.memory;
    this.fatigue = clamp(this.fatigue + 0.18, 0, 1);
    this.pounceCommitted = false;
    const reset = trackFeint({ repeats: this._feintRepeats, side: this._feintSide, prevIntent: this._feintPrevIntent }, 'recover', { reset: 'hit' });
    this._feintRepeats = reset.repeats; this._feintSide = reset.side; this._feintPrevIntent = reset.prevIntent;
    this._recoverLock = 0;
    return result;
  }
}
