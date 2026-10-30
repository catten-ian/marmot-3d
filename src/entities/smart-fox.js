import { Fox } from './fox.js';
import { FOX, ROCKS, BURROWS, roamBounds, scalePoint, scaleRadius } from '../core/config.js';
import { SANDBOX_DIFFICULTIES } from '../sandbox/state.js';
import { clamp, terrainHeight } from '../core/utils.js';
import { BETA_TUNE } from '../core/beta-tuning.js';
import { IS_BETA } from '../core/version.js';
import { canSprint, stepStamina, shouldRetreat } from '../core/fox-motion.js';
import {
  utilityScores,
  updatePerception,
  applyInterruption,
  stepSmartMotion,
  separationVector,
  isSegmentReachable,
  smartPounceDistance, smartPounceDashDistance, cancelSmartPounce, SMART_POUNCE_TUNE,
  smartPounceStaminaReserve, smartPounceStaminaDrainPerSec,
  updateSmartMemory, habituateDecayRate, stepInterruptionTimes,  debounceIntent, createSmartPack, flankBias, foxSeparation, trackFeint, RECOVER_LOCK, stepSmartContactCooldown,
  flankSlots, assignFlankSlot, assignRoles, forcedRetreat, assembleSmartAim, teamInterceptPoint,
  createSmartPounceApproachState, advanceSmartPounceApproach,
  createSmartMeleeState, advanceSmartMelee, cancelSmartMelee, consumeSmartMeleeHit,
} from './smart-fox-core.mjs';


function rolesIndexFor(self, peers) {
  const ordered = (peers || []).slice().sort((a, b) => (a.slot ?? 0) - (b.slot ?? 0));
  const index = ordered.indexOf(self);
  return index < 0 ? 0 : index;
}

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
    this.pounceStage = null;    // 阶段 4：'dash' | 'windup' | 'strike' | 'recover' | null
    this.pounceStriking = false; // 仅 strike 激活帧 true —— 主循环据此做接触伤害
    this._meleeState = createSmartMeleeState();
    this.meleePhase = null;       // Beta：null | windup | strike | recover
    this.meleeStriking = false;
    this.meleeHitConsumed = false;
    this._smartState = {
      x, z, vx: 0, vz: 0, yaw: this.yaw,
      maxTurnRate: 2.8, acceleration: 18, pounceCooldown: 0, telegraphT: 0, phase: 'observe', phaseTime: 0, cooldown: 0, pounceTime: 0,
      ...(IS_BETA ? { pounceMinDistance: BETA_TUNE.smartPounceMinDistance, pounceMaxDistance: BETA_TUNE.smartPounceMaxDistance } : {}),
    };
    this.smartDifficulty = 'standard';
    this.applySmartDifficulty(opts.difficulty || 'standard');
    this.telemetry = [];
    this._age = 0; this.lastInterruptionAt = 0; this._interruptionTimes = [];
    this._intentHeld = 0; this._intentCandidate = 'observe'; this._approachBand = false;
    this._feintSide = 1; this._feintRepeats = 0;
    this._feintPrevIntent = 'observe';
    this._recoverLock = 0;
    // —— 阶段 3 战术层状态 ——
    this._role = 'flanker';          // striker / flanker / interceptor / rest / retreat
    this._flankSlotIndex = null;     // 本帧占用的包抄槽位（供同伴避让）
    this.flankSlotIndex = null;
    this._lastHitAt = -Infinity;     // 最近一次被玩家打中的时刻（_age 时钟）
    this._evadeUntil = 0;            // >0 表示正处于"被打后侧向甩开"窗口
    this._evadeSide = 1;
    this._cautiousUntil = 0;         // 回血归队后的谨慎期：此时间前不提交扑咬
    this._restSafeSeen = false;
    this._escVel = { x: 0, z: 0 };   // 玩家速度低通估计（逃跑轴）
    this._lastPlayerPos = null;
    this._pounceApproach = createSmartPounceApproachState();
    this.teamRole = this._role;
    this.roleSince = 0;
  }

  get meleeState() {
    return { ...this._meleeState, phase: this.meleePhase, striking: this.meleeStriking, hitConsumed: this.meleeHitConsumed };
  }

  consumeSmartMeleeHit() {
    if (!IS_BETA) return;
    this._meleeState = consumeSmartMeleeHit(this._meleeState);
    this.meleeHitConsumed = this._meleeState.hitConsumed;
  }

  _cancelMelee() {
    if (!IS_BETA) return;
    this._meleeState = cancelSmartMelee(this._meleeState);
    this.meleePhase = null;
    this.meleeStriking = false;
    this.meleeHitConsumed = false;
  }

  applySmartDifficulty(key) {
    this.smartDifficulty = SANDBOX_DIFFICULTIES[key] ? key : 'standard';
    const d = SANDBOX_DIFFICULTIES[this.smartDifficulty].smart;
    Object.assign(this._smartState, { pounceSpeed: d.speed, approachSpeed: d.approach || ({calm:5.2,standard:6.8,intense:8.2}[this.smartDifficulty]), maxTurnRate: d.turn,
      pounceWindup: d.windup, pounceCooldownDuration: d.cooldown, memoryDecay: d.memoryDecay, feintScale: d.feint, coordination: d.coordination });
  }

  update(dt, p, safe, levelCfg, burrows, terrainAt = terrainHeight, currentBurrow = null, packContext = null) {
    // 阶段 3：从 rest_safe 归队 → 进入谨慎期（8s 内不主动扑咬）。
    if (this.state === 'rest_safe') this._restSafeSeen = true;
    else if (this._restSafeSeen) { this._restSafeSeen = false; this._cautiousUntil = this._age + 8; }
    // 被驱退/撤退/休息/死亡/眩晕时退回普通狐狸逻辑（撤退移动、rest_safe、击退位移等）。
    if (this.fleeing || this.hp <= 0 || this.stun > 0
      || this.retreating || this.state === 'rest_safe' || this.state === 'dead') {
      this._cancelMelee();
      return super.update(dt, p, safe, levelCfg, burrows, terrainAt);
    }
    this._recoverLock = Math.max(0, this._recoverLock - Math.max(0, dt));
    // SmartFox bypasses Fox.update(), so keep the one-bite cooldown lifecycle here.
    this.contactCd = stepSmartContactCooldown(this.contactCd, dt);

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

    // —— 阶段 3：被打中 → 硬规则强制撤退（先侧向甩开，再正式撤退回血）——
    if (!this.drillCtx && this._evadeUntil <= 0
      && forcedRetreat({ lastHitAt: this._lastHitAt }, { now: this._age, window: 0.05 })) {
      this._lastHitAt = -Infinity;                    // 消费掉这次受击，避免重复触发
      this._evadeUntil = this._age + 0.45;            // 先横移躲开的窗口
      this._evadeSide = this.slot % 2 ? 1 : -1;
      this.pounceCommitted = false;
      this._smartState.pounceCommitted = false;
      this._smartState.pounceTime = 0;
    }
    // 甩开窗口结束 → 正式转入自主撤退（走阶段 2 的 retreat → rest_safe 回血链路）
    if (this._evadeUntil > 0 && this._age >= this._evadeUntil && !this.drillCtx) {
      this._evadeUntil = 0;
      this._enterRetreat(p, Array.isArray(burrows) ? burrows : (burrows ? [burrows] : []));
      return super.update(dt, p, safe, levelCfg, burrows, terrainAt);
    }

    // —— 体力收支（与普通狐同口径）：扑击消耗体力，喘息/脱离缓慢回血回体力 ——
    {
      const V = FOX.vitals;
      const resting = this.state === 'rest' && !this.pounceCommitted && !this.meleePhase;
      const regenState = this._role === 'rest' || resting ? 'rest'
        : this._role === 'interceptor' ? 'intercept'
        : (this.pounceStage === 'recover' || this.intent === 'recover' || this.intent === 'abandon') ? 'recover' : 'roam';
      const regenAllowed = !this.pounceCommitted && !this.meleePhase;
      const stepped = stepStamina({ stamina: this.stamina, locked: this.staminaLocked, hp: this.hp }, dt, {
        maxStamina: this.maxStamina,
        drainPerSec: smartPounceStaminaDrainPerSec({
          beta: IS_BETA,
          committed: this.pounceCommitted,
          stage: this.pounceStage,
          remaining: this._smartState.pounceStageTime,
          dt,
          pounceRate: V.pounceStaminaPerSec,
          stalkRate: V.stalkStaminaPerSec,
        }),
        regenPerSec: V.restStaminaPerSec,
        regenPerSecByState: IS_BETA ? {
          rest: BETA_TUNE.smartRestStaminaRegenPerSec,
          recover: BETA_TUNE.smartRecoverStaminaRegenPerSec,
          intercept: BETA_TUNE.smartInterceptStaminaRegenPerSec,
          roam: BETA_TUNE.smartRoamStaminaRegenPerSec,
        } : undefined,
        regenState,
        regenAllowed,
        resting,
        hpRegenRatio: resting ? V.restHpRegenRatio : 0,
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
    const obstacles = ROCKS.map((rock) => { const [ox, oz] = scalePoint(rock); return { x: ox, z: oz, r: scaleRadius(rock[2]) + 0.72 * this.cfg.scale }; });
    for (const b of (Array.isArray(burrows) ? burrows : burrows ? [burrows] : BURROWS)) obstacles.push({ x: b.x, z: b.z, r: (b.r || 0) + 2.5 });
    const reachable = isSegmentReachable(this, p, obstacles, 0.82);
    const separation = separationVector(this, (packContext?.smartFoxes || []).filter((f) => f !== this && f.alive !== false), 1.85, 2.2);
    const viewDot = Math.cos(facingYaw - Math.atan2(this.x - p.x, this.z - p.z));
    const guard = !!(p.guard || p.guarding);

    // —— 阶段 3：玩家逃跑轴估计（低通平滑玩家速度，避免抖动）——
    if (this._lastPlayerPos && dt > 0) {
      const ivx = (p.x - this._lastPlayerPos.x) / dt;
      const ivz = (p.z - this._lastPlayerPos.z) / dt;
      const k = Math.min(1, dt * 3);
      this._escVel.x += (ivx - this._escVel.x) * k;
      this._escVel.z += (ivz - this._escVel.z) * k;
    }
    this._lastPlayerPos = { x: p.x, z: p.z };
    const escSpeed = Math.hypot(this._escVel.x, this._escVel.z);
    // 玩家基本不动时，以"远离本狐"为逃跑轴（即仍绕到狐-人连线的侧后）
    const escapeAxis = escSpeed > 0.5 ? Math.atan2(this._escVel.x, this._escVel.z)
      : Math.atan2(this.x - p.x, this.z - p.z);

    // —— 阶段 3：角色分工（复用 packContext.tactics 作帧内共享存储，带粘性）——
    const peers0 = packContext?.smartFoxes || [];
    if (packContext && peers0.length) {
      const store = packContext.tactics || packContext.coordinator || packContext;
      const roles = assignRoles(peers0, p, store.roles || {}, this._age, {
        holdTime: 1.5, switchCooldown: 1.2, betaTeam: IS_BETA,
      });
      store.roles = roles;
      const assigned = roles[this.slot] || { role: 'flanker', since: this._age };
      this._role = assigned.role;
      this.teamRole = this._role;
      this.roleSince = assigned.since;
    }

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
      // 阶段 4：已被玩家察觉 → suspicion 抬高 → 更谨慎（feint/observe 偏多，不硬扑）
      suspicion: clamp(this.suspicion + (this.detected ? 0.6 : 0), 0, 1),
      betaOn: IS_BETA,
      ...(IS_BETA ? { pounceMemoryPenalty: BETA_TUNE.smartPounceMemoryPenalty, pounceFatiguePenalty: BETA_TUNE.smartPounceFatiguePenalty } : {}),
      feintScale: this._smartState.feintScale ?? 1,
    });
    let intent = this._recoverLock > 0 ? 'recover' : (this.pounceCommitted ? 'pounce' : scores.topIntent);
    const nearBand = IS_BETA ? (this._approachBand ? BETA_TUNE.smartPounceApproachRadius + 0.45 : BETA_TUNE.smartPounceApproachRadius) : (this._approachBand ? 3.9 : 3.4);
    if (intent === 'approach' || intent === 'observe') {
      if (distance < nearBand) intent = 'observe'; else if (distance > 7.7) intent = 'approach'; else intent = this._approachBand ? 'approach' : 'observe';
      this._approachBand = intent === 'approach';
    }
    const debounced = debounceIntent(this._intentCandidate, intent, this._intentHeld, dt);
    this._intentCandidate = debounced.intent; this._intentHeld = debounced.held;
    intent = debounced.intent;
    if (IS_BETA && this._role === 'rest') intent = 'recover';
    if (IS_BETA && this._role === 'interceptor') intent = 'feint';
    if (safe) intent = 'recover';
    const tracked = trackFeint({ repeats: this._feintRepeats, side: this._feintSide, prevIntent: this._feintPrevIntent }, intent,
      { side: (this.slot % 2 === 0 ? 1 : -1) });
    this._feintRepeats = tracked.repeats; this._feintSide = tracked.side; this._feintPrevIntent = tracked.prevIntent;
    this.intent = intent;
    this.topScores = scores.scores;

    // —— 交战战术：把抽象意图映射成具体运动目标点 ——
    // stepSmartMotion 只提供转向/加减速/不可取消扑击原语，永远朝目标点走，
    // 故由本层按意图选点，避免逼近时穿过玩家、喘息时仍贴脸。
    const STAND = { observe: IS_BETA ? BETA_TUNE.smartPounceObserveRadius : 7.2, approach: IS_BETA ? BETA_TUNE.smartPounceApproachRadius : 3.4, feint: 4.6, recover: 11, abandon: 15 };
    const toP = Math.atan2(dx, dz);          // 狐→玩家 方位角
    const commitAngle = Math.abs(Math.atan2(Math.sin(toP - this.yaw), Math.cos(toP - this.yaw)));
    if (IS_BETA && !this.pounceCommitted) this._pounceApproach = advanceSmartPounceApproach(this._pounceApproach, {
      distance, angle: commitAngle, maxAngle: this._smartState.pounceMaxAngle ?? (20 * Math.PI / 180),
      committed: false, recover: intent === 'recover' || intent === 'abandon', safe,
    }, dt, BETA_TUNE);
    else if (IS_BETA && this.pounceCommitted) this._pounceApproach = advanceSmartPounceApproach(this._pounceApproach, { committed: true }, dt, BETA_TUNE);
    const pounceWindup = this._smartState.pounceWindup ?? .22;
    const pouncePending = intent === 'pounce' && (this._smartState.windupRemaining ?? pounceWindup) < pounceWindup - 1e-6;
    this._meleeState = IS_BETA ? advanceSmartMelee(this._meleeState, {
      distance, reachable, safe, alive: this.alive && this.hp > 0,
      stunned: this.stun > 0, retreating: this.retreating, fleeing: this.fleeing,
      pounceCommitted: this.pounceCommitted,
      pouncePending: pouncePending || this._recoverLock > 0 || this.pounceStage === 'recover' || (IS_BETA && intent === 'pounce'),
      targetYaw: toP,
    }, dt, BETA_TUNE) : this._meleeState;
    const meleeActive = IS_BETA && this._meleeState.phase !== null;
    if (meleeActive) { intent = 'observe'; this.intent = 'observe'; }
    const dn = distance || 1;
    const ux = -dx / dn, uz = -dz / dn;      // 玩家→狐 单位向量（身后方向）
    const initialTacticalScale = (IS_BETA && intent === 'pounce') ? BETA_TUNE.smartPounceAimOffsetScale : 1;
    let aimX = p.x + separation.x * 2.2 * initialTacticalScale, aimZ = p.z + separation.z * 2.2 * initialTacticalScale;
    if (!this.pounceCommitted) {
      if (IS_BETA && this._role === 'interceptor') {
        const block = teamInterceptPoint(p, this, this._escVel, rolesIndexFor(this, peers0), BETA_TUNE.smartPounceObserveRadius + 0.5);
        aimX = block.x; aimZ = block.z;
      } else if (intent === 'recover' || intent === 'abandon') {
        const R = STAND[intent];
        aimX = p.x + ux * R; aimZ = p.z + uz * R;
      } else if (intent === 'feint') {
        const side = this._feintSide;
        const a = toP + side * 1.05;
        aimX = p.x - Math.sin(a) * STAND.feint;
        aimZ = p.z - Math.cos(a) * STAND.feint;
      } else if (intent === 'approach' && peers0.length > 1) {
        // 阶段 3 包抄：approach 不直冲玩家当前位置，先绕到自己分到的逃跑轴侧后槽位；
        // 到槽位附近后降级为 observe（等时机），而不是贴脸直接扑。
        const attackers = peers0.filter((f) => f !== this && !f.retreating && f.state !== 'rest_safe' && f.hp > 0).length + 1;
        const slots = flankSlots(Math.min(Math.max(attackers, 1), 4), escapeAxis, p, 6.5);
        const idx = assignFlankSlot(this, peers0, slots);
        this.flankSlotIndex = idx;
        this._flankSlotIndex = idx;
        if (idx != null) {
          const s = slots[idx];
          if (Math.hypot(s.x - this.x, s.z - this.z) < 1.3) {
            intent = 'observe';
            this.intent = intent;
            aimX = p.x + ux * STAND.observe; aimZ = p.z + uz * STAND.observe;
          } else { aimX = s.x; aimZ = s.z; }
        } else {
          const R = STAND.approach;                 // 无可用槽位 → 退回直追，不崩
          aimX = p.x + ux * R; aimZ = p.z + uz * R;
        }
      } else {
        const R = (IS_BETA && intent === 'pounce')
          ? (this._pounceApproach.ringRadius ?? ((BETA_TUNE.smartPounceMinDistance + BETA_TUNE.smartPounceMaxDistance) * 0.5))
          : (STAND[intent] ?? STAND.approach);
        if (IS_BETA && intent === 'pounce' && this._pounceApproach.phase === 'reposition') {
          const a = toP + this._pounceApproach.side * Math.PI / 2;
          aimX = p.x + Math.sin(a) * R; aimZ = p.z + Math.cos(a) * R;
        } else { aimX = p.x + ux * R; aimZ = p.z + uz * R; }
      }
    }
    // 阶段 3：被打后的侧向甩开 —— 不直线背对玩家跑，边撤边横移一段。
    if (this._evadeUntil > 0 && this._age < this._evadeUntil && !this.pounceCommitted) {
      intent = 'recover';
      this.intent = intent;
      const away = Math.atan2(-dx, -dz);
      const a = away + this._evadeSide * (Math.PI / 2.4);
      aimX = this.x + Math.sin(a) * 6;
      aimZ = this.z + Math.cos(a) * 6;
    }
    // committed pounce：直扑玩家本体，冲穿后由 recover 拉开。
    const peers = packContext?.smartFoxes || [];
    const sep = foxSeparation(this, peers);
    const bias = flankBias(this, peers, p, this._smartState.coordination);
    const tacticalScale = (IS_BETA && intent === 'pounce') ? BETA_TUNE.smartPounceAimOffsetScale : 1;
    aimX += (sep.x + Math.cos(toP) * bias * 2) * tacticalScale;
    aimZ += (sep.z - Math.sin(toP) * bias * 2) * tacticalScale;
    // Beta 提交态最终锁点只取玩家当前坐标；包抄/分离只影响接近阶段。
    if (IS_BETA && intent === 'pounce') {
      const lockedAim = assembleSmartAim({ player: p, self: this, intent, separation: sep, flank: bias, pounceOffsetScale: BETA_TUNE.smartPounceAimOffsetScale });
      aimX = lockedAim.x; aimZ = lockedAim.z;
    }
    // Lead is sampled before commit and then frozen by stepSmartMotion. Keep it
    // short and bounded so moving targets remain dodgeable.
    const leadDistance = Math.min(BETA_TUNE.smartPounceMaxLeadDistance, Math.hypot(this._escVel.x, this._escVel.z) * BETA_TUNE.smartPounceLeadSeconds);
    const leadScale = Math.hypot(this._escVel.x, this._escVel.z) > 1e-5 ? leadDistance / Math.hypot(this._escVel.x, this._escVel.z) : 0;
    const commitAim = IS_BETA && intent === 'pounce'
      ? { x: p.x + this._escVel.x * leadScale, z: p.z + this._escVel.z * leadScale }
      : { x: p.x, z: p.z };
    const betaPounceAlign = IS_BETA && !this.pounceCommitted && intent === 'pounce' && this._pounceApproach.phase === 'align';
    const approachSpeed = betaPounceAlign ? 0 : (IS_BETA && intent === 'pounce' ? Math.min(this._smartState.approachSpeed, FOX.ACTIONS.stalk.speed) : this._smartState.approachSpeed);
    const ground = !this.pounceCommitted ? this._groundSteer(aimX - this.x, aimZ - this.z, approachSpeed, burrows) : null;
    const navigationAim = ground ? { x: this.x + ground.x * 100, z: this.z + ground.z * 100 } : { x: aimX, z: aimZ };
    const next = meleeActive ? {
      ...this._smartState,
      x: this.x, z: this.z, yaw: this._meleeState.yaw,
      vx: 0, vz: 0, speed: 0,
      pounceCommitted: false, pounceStriking: false,
      pounceCooldown: Math.max(0, (this._smartState.pounceCooldown || 0) - dt),
      ...(this._meleeState.phase === 'strike' ? {
        x: this.x + Math.sin(this._meleeState.yaw) * BETA_TUNE.smartMeleeStrikeSpeed * dt,
        z: this.z + Math.cos(this._meleeState.yaw) * BETA_TUNE.smartMeleeStrikeSpeed * dt,
        vx: Math.sin(this._meleeState.yaw) * BETA_TUNE.smartMeleeStrikeSpeed,
        vz: Math.cos(this._meleeState.yaw) * BETA_TUNE.smartMeleeStrikeSpeed,
        speed: BETA_TUNE.smartMeleeStrikeSpeed,
      } : {}),
    } : stepSmartMotion(
      {
        ...this._smartState,
        x: this.x, z: this.z, yaw: this.yaw,
        pounceStrikeSpeed: IS_BETA ? BETA_TUNE.smartPounceStrikeSpeed : undefined,
        pounceStrikeTime: IS_BETA ? BETA_TUNE.smartPounceStrikeTime : undefined,
        pounceCommitted: this.pounceCommitted,
        pounceCooldown: this._smartState.pounceCooldown || 0,
        ...(IS_BETA && intent === 'pounce' ? { pounceDashDuration: (() => {
          const targetDash = Math.max(1.5, Math.min(4.3, distance - SMART_POUNCE_TUNE.maxStrikeDistance));
          let lo = 0.08, hi = SMART_POUNCE_TUNE.dashDuration;
          for (let i = 0; i < 12; i++) { const mid = (lo + hi) * 0.5;
            if (smartPounceDashDistance(0, (this._smartState.pounceSpeed ?? 10.6) * SMART_POUNCE_TUNE.dashSpeedMul, this._smartState.acceleration ?? 18, mid, dt) < targetDash) lo = mid; else hi = mid; }
          return hi;
        })() } : {}),
        intent: this.intent,
        locomotionIntent: betaPounceAlign ? 'observe' : this.intent,
        speedTarget: betaPounceAlign ? 0 : undefined,
      },
      navigationAim,
      dt,
      this.intent,
      {
        // 提交扑咬的总闸门（rev22 线 reachable 门 + fox-v2 体力/角色/谨慎期门）：
        // - reachable：目标点必须可达（避免隔墙扑击）
        // - 体力：不足时不允许进入冲刺阶段（体力耗尽 ≠ 被驱退，只是扑不出来）
        // - 角色：striker 独占扑咬提交权，其余角色保持施压不扑
        // - 谨慎期：回血归队后 8s 内不主动扑咬
        commitTarget: commitAim,
        commitDistanceTarget: commitAim,
        commitAllowed: reachable
          && this._recoverLock <= 0
          && this.staminaLocked <= 0
          && canSprint(this.stamina, FOX.vitals.pounceStaminaPerSec, SMART_POUNCE_TUNE.dashDuration)
          && this.stamina >= smartPounceStaminaReserve(FOX.vitals.pounceStaminaPerSec, SMART_POUNCE_TUNE)
          && (!packContext || this._role === 'striker')
          && this._age >= this._cautiousUntil
          && this._evadeUntil <= 0
          && (!packContext?.coordinator || packContext.coordinator.canCommit(this.slot, this._age, this._smartState.coordination)),
        // 阶段 4 动作集对齐：慢行=stalk（慢/省体力/难被发现），冲刺=sprint
        stalkSpeed: FOX.ACTIONS.stalk.speed,
        sprintSpeed: FOX.ACTIONS.sprint.speed,
      },    );
    if (!this.pounceCommitted && next.pounceCommitted) {
      packContext?.coordinator?.recordCommit(this.slot, this._age);
      const reset = trackFeint({ repeats: this._feintRepeats, side: this._feintSide, prevIntent: this._feintPrevIntent }, 'pounce', { reset: 'pounce' });
      this._feintRepeats = reset.repeats; this._feintSide = reset.side; this._feintPrevIntent = reset.prevIntent;
    }
    if (next.pounceJustEnded) this._recoverLock = Math.max(this._recoverLock, RECOVER_LOCK);
    // 阶段 4：进入扑咬 strike 的当帧，一次性扣除大量体力（区别于冲刺阶段的持续扣）。
    if (next.pounceStrikeStarted) {
      next.pounceStrikeStarted = false;
      this.stamina = Math.max(0, this.stamina - SMART_POUNCE_TUNE.staminaCost);
    }
    this._smartState = next;
    this.x = next.x;
    this.z = next.z;
    this.yaw = next.yaw;
    this.pounceCommitted = !!next.pounceCommitted;
    this._smartState.cooldown = Math.max(this._smartState.cooldown || 0, next.pounceCooldown || 0);
    this.pounceStage = next.pounceStage ?? null;
    this.pounceStriking = !!next.pounceStriking;
    this.meleePhase = meleeActive ? this._meleeState.phase : null;
    this.meleeStriking = this.meleePhase === 'strike';
    this.meleeHitConsumed = !!this._meleeState.hitConsumed;
    if (this.meleePhase === 'windup') {
      this.timer = this._meleeState.phaseTime;
      this.windFull = BETA_TUNE.smartMeleeWindupTime;
      this.windTotal = BETA_TUNE.smartMeleeWindupTime;
    }

    // 映射到既有动画状态：冲刺阶段/扑击=dash（驱动预警/位移），极短前摇=wind（下蹲），
    // 后摇/喘息/放弃=rest（硬直），其余=roam。
    this.state = meleeActive
      ? ({ windup: 'wind', strike: 'dash', recover: 'rest' }[this.meleePhase])
      : this.pounceCommitted
      ? (this.pounceStage === 'windup' ? 'wind' : 'dash')
      : (this._role === 'interceptor' ? 'intercept'
        : (this.pounceStage === 'recover' || intent === 'recover' || intent === 'abandon') ? 'rest' : 'roam');    this.leap = 0;

    // 疲劳循环：扑击消耗，喘息快速恢复，其余缓慢恢复，保证下一轮还能再扑。
    const fatRate = this.pounceCommitted ? 0.22
      : (intent === 'recover' || intent === 'abandon') ? -0.32 : -0.08;
    this.fatigue = clamp(this.fatigue + fatRate * dt, 0, 1);

    const bounds = roamBounds();
    this.x = clamp(this.x, -bounds.hw, bounds.hw);
    this.z = clamp(this.z, -bounds.hh, bounds.hh);

    this._resolveObstacleOverlaps(burrows);
    if (this.pounceCommitted && (this.x !== next.x || this.z !== next.z || Math.abs(this.x) >= bounds.hw || Math.abs(this.z) >= bounds.hh)) {
      // 撞障取消（589d31b 语义）：当帧取消扑击且本帧之后无伤害（pounceStriking 一并清零），进后摇。
      const cancelled = cancelSmartPounce(this._smartState);
      cancelled.pounceCooldown = this._smartState.pounceCooldownDuration;
      this._smartState = cancelled;
      this.pounceCommitted = false; this.pounceStriking = false; this.pounceStage = 'recover';
      this.intent = 'recover'; this.state = 'rest';
    }
    this._applyTransform(dt, terrainAt);
    this._updateHpBar();
    this._updateStaminaBar();
    // 阶段 4：预警线在"扑咬前的冲刺阶段"显示；保留提交前可读前摇的淡预警。
    this.warn.visible = this.meleePhase === 'windup'
      || (this.pounceCommitted && this.pounceStage === 'dash')
      || (this._smartState.windupRemaining > 0 && intent === 'pounce');
    this._updateWarn(terrainAt);
    this.telemetry.push({ intent, role: this._role, roleSince: this.roleSince, meleePhase: this.meleePhase, distance, guard, fatigue: this.fatigue, health: this.hp / this.maxHp,
      memory: this.memory, suspicion: this.suspicion, scores: { ...this.topScores } });
    if (this.telemetry.length > 192) this.telemetry.shift();
  }

  _updateWarn(terrainAt = terrainHeight) {
    if (!this.warn?.visible) return;
    this.warn.position.set(this.x, terrainAt(this.x, this.z) + .02, this.z);
    this.warn.rotation.y = this.meleePhase === 'windup' ? this._meleeState.yaw : this.pounceCommitted ? this._smartState.pounceYaw : this.yaw;
    if (this.meleePhase === 'windup') {
      this.warn.scale.z = BETA_TUNE.smartMeleeHitRange;
      this.warn.material.opacity = .7;
      return;
    }
    const speed = Math.hypot(this._smartState.vx, this._smartState.vz);
    // 冲刺阶段预警线长度 = 剩余冲刺的真实位移距离（真实速度积分，与 smartPounceDashDistance 一致）
    this.warn.scale.z = this.pounceCommitted
      ? smartPounceDashDistance(speed, this._smartState.pounceDashSpeed ?? this._smartState.pounceSpeed, this._smartState.acceleration, this._smartState.pounceStageTime)
      : smartPounceDistance(speed, this._smartState.pounceSpeed, this._smartState.acceleration, .72);
    this.warn.material.opacity = this.pounceCommitted ? .76 : .3;
  }

  hit(damage, knockback, stun, fromX, fromZ) {
    const result = super.hit(damage, knockback, stun, fromX, fromZ);
    this.interruptions += 1;
    this._age += 0; this.lastInterruptionAt = this._age; this._interruptionTimes.push(this._age);
    this._lastHitAt = this._age;   // 阶段 3：供 forcedRetreat 硬规则消费
    const m = applyInterruption(
      { memory: this.memory, interruptions: this.interruptions, health: this.hp / this.maxHp },
      'damage',
    );
    this.memory = m.memory ?? this.memory;
    this.fatigue = clamp(this.fatigue + 0.18, 0, 1);
    this.pounceCommitted = false;
    this._cancelMelee();
    const reset = trackFeint({ repeats: this._feintRepeats, side: this._feintSide, prevIntent: this._feintPrevIntent }, 'recover', { reset: 'hit' });
    this._feintRepeats = reset.repeats; this._feintSide = reset.side; this._feintPrevIntent = reset.prevIntent;
    this._recoverLock = 0;
    return result;
  }
}
