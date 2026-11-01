/**
 * Renderer-free SmartFox combat laboratory.
 * Uses the same production decision, team, motion, stamina, retreat and combat
 * volume primitives as the browser entities; this file only adapts them to
 * plain numeric state and deterministic fixed-step actors. This is a primitive
 * adapter, not the full main.js world/input/contact loop (see audit report).
 */
import { FOX, PLAYER } from '../core/config.js';
import { resolveStrikeProfile, strikeVolumeHit, foxAttackVerticalHit } from '../systems/combat.js';
import { sanitizeRuntimeValues } from '../core/runtime-config.mjs';
import { resolveParryOutcome } from '../core/combat-wheel.mjs';
import { stepStamina, shouldRetreat, chooseRestPoint, stepRestSafe, stepSmartRetreatNavigation, stepFoxLocomotion, steerGroundDirection } from '../core/fox-motion.js';
import { BETA_TUNE, createSmartFoxRetreat, createSmartFoxSpawnState, createSmartFoxVitals } from '../core/beta-tuning.js';
import {
  utilityScores, updatePerception, assignRoles, stepSmartMotion, advanceSmartMelee,
  smartMeleeContactHit, createSmartMeleeState, createSmartPack, smartPounceDashDurationForDistance,
} from '../entities/smart-fox-core.mjs';

export const SCENARIOS = Object.freeze(['faceoff-tap', 'chase-pounce-tap', 'parry-tap']);
export const MOVES = Object.freeze(['stationary', 'chase', 'orbit', 'kite', 'zigzag']);
const TAU = Math.PI * 2;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const yawTo = (a, b) => Math.atan2(b.x - a.x, b.z - a.z);
const wrap = (a) => { while (a > Math.PI) a -= TAU; while (a < -Math.PI) a += TAU; return a; };

export function createSeededRandom(seed = 1) {
  let s = (Number(seed) >>> 0) || 1;
  return () => { s = (Math.imul(1664525, s) + 1013904223) >>> 0; return s / 0x100000000; };
}

/** Bounded, deterministic CLI/library input. Invalid time cannot hang a worker. */
export function validateLabConfig(config = {}) {
  const finiteRange = (key, fallback, min, max, integer = false) => {
    const value = config[key] ?? fallback;
    if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) {
      throw new RangeError(`${key} must be ${integer ? 'an integer' : 'finite'} in [${min}, ${max}]`);
    }
    return value;
  };
  const dt = finiteRange('dt', 1 / 60, 1 / 240, .1);
  const duration = finiteRange('duration', 20, 1 / 240, 300);
  const foxes = finiteRange('foxes', 1, 1, 64, true);
  const seed = finiteRange('seed', 1, 0, 0xffffffff, true);
  const scenario = config.scenario ?? 'faceoff-tap', movement = config.movement ?? 'stationary';
  if (!SCENARIOS.includes(scenario)) throw new RangeError(`unknown scenario: ${scenario}`);
  if (!MOVES.includes(movement)) throw new RangeError(`unknown movement: ${movement}`);
  const ticks = Math.ceil(duration / dt);
  if (ticks * (foxes + 1) > 2_000_000) throw new RangeError('scenario exceeds 2,000,000 actor-tick budget');
  const clean = sanitizeRuntimeValues(config.tune ?? {});
  return { seed, dt, duration, foxes, marmots: 1, scenario, movement, ticks,
    tune: { ...BETA_TUNE, ...clean.values }, tuneWarnings: clean.warnings, ignoredTuneKeys: clean.ignored };
}

/** Progress means real movement, state transitions, resource changes or attacks;
 * unchanged population alone never implies a stalled fight. No wall clock. */
export function advanceLabProgress(previous, actors, dt) {
  const signature = JSON.stringify(actors.map((a) => [a.x, a.z, a.hp, a.stamina,
    a.state, a.smart?.pounceStage, a.melee?.phase, a.stats?.hits, a.attackStats?.commits]));
  const idleSeconds = previous?.signature === signature ? previous.idleSeconds + dt : 0;
  return { signature, idleSeconds, stalled: idleSeconds >= 5 };
}

export function labActorInvariants(foxes, marmots) {
  const errors = [];
  for (const [kind, actors] of [['fox', foxes], ['marmot', marmots]]) for (const a of actors) {
    const id = `${kind}${a.slot ?? a.id}`;
    for (const key of ['x', 'z', 'hp', 'maxHp', 'stamina', 'maxStamina']) {
      if (!Number.isFinite(a[key])) errors.push(`${id}:nonfinite:${key}`);
    }
    if (a.maxHp <= 0 || a.maxStamina <= 0 || a.hp < 0 || a.hp > a.maxHp || a.stamina < 0 || a.stamina > a.maxStamina) errors.push(`${id}:bounds`);
    if (a.dead && (a.hp !== 0 || a.state !== 'dead')) errors.push(`${id}:dead-state`);
  }
  return errors;
}

function event(ctx, type, data = {}) {
  ctx.events.push({ t: Number(ctx.time.toFixed(6)), type, ...data });
  if (ctx.events.length > ctx.maxEvents) ctx.events.splice(0, ctx.events.length - ctx.maxEvents);
}

function makeFox(slot, x, z, tune) {
  const vitals = createSmartFoxVitals(tune);
  const spawn = createSmartFoxSpawnState({}, vitals);
  return {
    slot, x, z, yaw: Math.atan2(-x, -z), vx: 0, vz: 0,
    ...spawn, state: 'roam', fatigue: 0, suspicion: 0, memory: 0, interruptions: 0,
    lastInterruptionAt: 0, hitStreak: 0, retreating: false, restPoint: null, restTimer: 0,
    perception: { suspicion: 0, lastSeen: 0 }, smart: {
      pounceMinDistance: tune.smartPounceMinDistance, pounceMaxDistance: tune.smartPounceMaxDistance,
      pounceMaxAngle: Math.PI / 9, pounceSpeed: tune.smartPounceStrikeSpeed,
      pounceStrikeSpeed: tune.smartPounceStrikeSpeed, pounceStrikeTime: tune.smartPounceStrikeTime,
      pounceRecoverTime: tune.smartPounceRecoverTime, pounceDashDuration: .42,
      pounceDashSpeedMul: 1.18, acceleration: 18, maxTurnRate: 2.8,
      pounceCooldown: 0, pounceCooldownDuration: tune.smartPounceCooldown,
      pounceCommitted: false, pounceStage: null, pounceStageTime: 0,
      windupRemaining: .22,
    }, melee: createSmartMeleeState(), role: 'striker', roleSince: 0,
    cooldown: 0, contactCd: 0, stance: 'roam', alive: true,
    attackStats: { commits: 0, pounceStrikes: 0, pounceHits: 0, meleeStrikes: 0, meleeHits: 0, retreats: 0, deaths: 0 },
    stateTime: {},
  };
}

function makeMarmot(id, x, z, strategy) {
  return { id, x, z, yaw: 0, target: null, strategy, hp: 12, maxHp: 12, stamina: 100, maxStamina: 100,
    cooldown: 0, parryCooldown: 0, parryWindowT: 0, parryDone: false, openingComplete: false, attackMode: 'tap', facing: 0, alive: true, damage: 1,
    stats: { attempts: 0, hits: 0, blocked: 0, dealt: 0, taken: 0, parries: 0 }, phase: 0 };
}

function nearest(list, actor) { return list.filter((x) => x.alive).sort((a, b) => dist(actor, a) - dist(actor, b))[0] || null; }

function moveMarmot(m, foxes, dt, ctx) {
  const target = foxes.filter((f) => f.alive).sort((a, b) => dist(m, a) - dist(m, b))[0];
  if (!target) return;
  m.target = target.slot;
  const d = dist(m, target);
  const toward = yawTo(m, target);
  let desired = toward;
  const phase = ctx.time * .8 + m.phase;
  if (m.strategy === 'orbit') desired += Math.PI / 2 + Math.sin(phase) * .25;
  if (m.strategy === 'kite') desired += Math.PI;
  if (m.strategy === 'zigzag') desired += Math.sin(phase * 2) * .7;
  const speed = m.strategy === 'stationary' ? 0 : m.strategy === 'kite' ? 4.2 : m.strategy === 'orbit' ? 3.2 : 3.8;
  // The requested parry opening is an explicit normal-movement intercept,
  // then one follow-up tap; only after that opening does the selected travel
  // policy resume. Never stop/freeze an actor or force a fox attack to set it up.
  const opening = !m.openingComplete && (ctx.scenario === 'chase-pounce-tap'
    || (ctx.scenario === 'parry-tap' && m.strategy !== 'stationary'));
  if (opening) desired = toward;
  const actualSpeed = opening ? 3.8 : speed;
  if (m.strategy === 'stationary' && !opening) { m.yaw = toward; return; }
  m.yaw = desired;
  m.x += Math.sin(desired) * actualSpeed * dt;
  m.z += Math.cos(desired) * actualSpeed * dt;
}

function facingHit(attacker, target, profile, targetHeight = 1.1) {
  const forward = Math.cos(attacker.yaw) * (target.z - attacker.z) + Math.sin(attacker.yaw) * (target.x - attacker.x);
  const lateral = -Math.sin(attacker.yaw) * (target.z - attacker.z) + Math.cos(attacker.yaw) * (target.x - attacker.x);
  return strikeVolumeHit({ forward, lateral, playerBottom: 0, targetBottom: 0, targetHeight, range: profile.range, move: profile.move, volume: profile });
}

export function selectMarmotTarget(m, foxes, scenario) {
  const fallback = nearest(foxes, m);
  if (scenario !== 'parry-tap' || m.parryCooldown > 0 || m.parryDone || m.parryWindowT > 0) return fallback;
  // A player may input parry on seeing a windup at any distance. Input alone is
  // never success: the armed 0.3 s window must later meet a real strike contact.
  const attackers = foxes.filter((f) => f.alive && f.smart.pounceCommitted && f.smart.pounceStage === 'windup');
  return attackers.length ? nearest(attackers, m) : fallback;
}

function marmotParry(m, foxes, ctx, dt) {
  if (ctx.scenario !== 'parry-tap') return false;
  m.parryWindowT = Math.max(0, (m.parryWindowT || 0) - dt);
  const inputTarget = selectMarmotTarget(m, foxes, ctx.scenario);
  if (inputTarget?.smart.pounceCommitted && inputTarget.smart.pounceStage === 'windup'
      && !m.parryDone && m.parryCooldown <= 0 && m.parryWindowT <= 0) {
    m.yaw = yawTo(m, inputTarget);
    m.parryWindowT = PLAYER.combatWheel.stand.parryWindow || .3;
    m.stats.attempts++;
    event(ctx, 'parry_attempt', { marmot:m.id, fox:inputTarget.slot, distance:dist(m, inputTarget), window:m.parryWindowT });
  }
  if (m.parryWindowT <= 0) return false;
  const reach = Math.min(PLAYER.radius + (FOX.collisionRadius.smart ?? FOX.collisionRadius.normal), ctx.tune.smartPounceHitRadiusCap);
  const contacts = foxes.filter((f) => {
    if (!f.alive || !f.smart.pounceCommitted || f.smart.pounceStage !== 'strike' || dist(m, f) > reach) return false;
    return foxAttackVerticalHit({ playerBottom:0, playerHeight:PLAYER.collisionHeight, foxBottom:0,
      foxHeight:FOX.collisionHeight.smart ?? FOX.collisionHeight.normal,
      groundAttackHeight:FOX.groundAttackHeight, mode:f.attack?.mode, state:'dash' });
  }).sort((a, b) => dist(m, a) - dist(m, b) || a.slot - b.slot);
  const f = contacts[0];
  if (!f) return true; // Window is armed; do not substitute a normal tap.
  m.yaw = yawTo(m, f);
  const d = dist(m, f);
  const facingDot = d > 1e-6 ? ((f.x - m.x) * Math.sin(m.yaw) + (f.z - m.z) * Math.cos(m.yaw)) / d : 1;
  const outcome = resolveParryOutcome({ parryWindowT:m.parryWindowT, foxState:'dash', dist:d, reach,
    facingDot, parryHalfAngle:PLAYER.combatWheel.stand.parryHalfAngle });
  if (!outcome.success) { event(ctx, 'parry_contact_failed', { marmot:m.id, fox:f.slot, reason:outcome.reason, distance:d, reach }); return true; }
  m.stats.parries++; m.stats.blocked++; m.parryCooldown = .8; m.parryWindowT = 0; m.parryDone = true;
  f.smart = { ...f.smart, pounceCommitted:false, pounceStage:'recover', pounceStageTime:.6, pounceCooldown:1.5 };
  f.state = 'recover'; f.interruptions++;
  event(ctx, 'parry_success', { marmot:m.id, fox:f.slot, distance:d, reach });
  return true;
}

function marmotAttack(m, foxes, ctx, dt) {
  if (!m.alive) return;
  m.cooldown = Math.max(0, m.cooldown - dt); m.parryCooldown = Math.max(0, m.parryCooldown - dt);
  if (marmotParry(m, foxes, ctx, dt)) return;
  // This opening is parry first, then tap; do not injure/repel a candidate
  // attacker with an unsolicited tap before the real parry has succeeded.
  if (ctx.scenario === 'parry-tap' && !m.parryDone) return;
  const f = nearest(foxes, m); if (!f) return;
  const d = dist(m, f); m.yaw = yawTo(m, f);
  const scenario = ctx.scenario;
  if (m.cooldown > 0 || d > 2.7) return;
  const move = scenario === 'chase-pounce-tap' && m.attackMode === 'pounce' ? 'lunge' : 'tap';
  const profile = resolveStrikeProfile({ move, baseRange: move === 'lunge' ? 3.0 : 2.4, baseCooldown: move === 'lunge' ? .9 : .58 });
  m.stats.attempts++; event(ctx, 'marmot_attack_attempt', { marmot: m.id, move, fox: f.slot });
  if (!facingHit(m, f, profile)) { m.cooldown = profile.cooldown; return; }
  m.cooldown = profile.cooldown;
  const damage = profile.damageMul;
  f.hp = Math.max(0, f.hp - damage); f.stamina = Math.max(0, f.stamina - ctx.tune.smartHitStaminaCost);
  f.hitStreak++; f.lastInterruptionAt = ctx.time; f.interruptions++; f.memory = Math.min(3, f.memory + 1);
  m.stats.hits++; m.stats.dealt += damage; event(ctx, 'marmot_hit', { marmot: m.id, fox: f.slot, move, damage });
  if (move === 'lunge') m.attackMode = 'tap';
  if (!m.openingComplete && ((ctx.scenario === 'parry-tap' && m.parryDone) || (ctx.scenario === 'chase-pounce-tap' && move === 'tap'))) { m.openingComplete = true; event(ctx, 'opening_complete', { marmot:m.id, movement:m.strategy }); }
  if (f.hp <= 0 && !f.dead) { f.dead = true; f.alive = false; f.state = 'dead'; f.attackStats.deaths++; event(ctx, 'fox_died', { fox: f.slot }); }
}

function updateFox(f, foxes, marmots, ctx, dt, roles) {
  f.stateTime[f.state] = (f.stateTime[f.state] || 0) + dt;
  if (!f.alive) return;
  f.contactCd = Math.max(0, f.contactCd - dt);
  const target = nearest(marmots, f); if (!target) return;
  const d = dist(f, target); const viewDot = Math.cos(wrap(f.yaw - yawTo(f, target)));
  f.perception = updatePerception(f.perception, { distance: d, viewDot, running: true, viewRange: 28 }, dt);
  const score = utilityScores({ betaOn: true, distance: d, playerFacing: .5, guard: false,
    fatigue: f.fatigue, health: f.hp / f.maxHp, interruptions: f.interruptions, memory: f.memory,
    suspicion: f.perception.suspicion, pounceMemoryPenalty: ctx.tune.smartPounceMemoryPenalty,
    pounceFatiguePenalty: ctx.tune.smartPounceFatiguePenalty });
  const role = roles[f.slot]?.role || 'striker'; f.role = role;
  const canAttack = role === 'striker' || role === 'flanker';
  let intent = canAttack ? score.topIntent : (role === 'interceptor' ? 'approach' : 'recover');
  if (canAttack && d >= f.smart.pounceMinDistance && d <= f.smart.pounceMaxDistance
      && (ctx.scenario === 'chase-pounce-tap' || ctx.scenario === 'parry-tap')) intent = 'pounce';
  if (f.smart.pounceCommitted) intent = 'pounce';
  if (ctx.time - f.lastInterruptionAt > ctx.retreat.hitStreakDecay) f.hitStreak = 0;
  const hardRetreat = shouldRetreat({ hpRatio: f.hp / f.maxHp, staminaRatio: f.stamina / f.maxStamina, hitStreak: f.hitStreak, state: f.state }, ctx.retreat);
  if (hardRetreat) intent = 'recover';
  if ((hardRetreat || (intent === 'recover' && f.hp < f.maxHp * .7)) && !f.retreating && f.state !== 'rest_safe' && f.state !== 'dead') {
    f.restPoint = chooseRestPoint({ foxX: f.x, foxZ: f.z, playerX: target.x, playerZ: target.z, bounds: { hw: 74, hh: 44 } }, { ...ctx.retreat, betaSmartMinPlayerDistance: ctx.tune.smartRestMinPlayerDistance });
    f.retreatProgress = {}; f.retreating = true; f.state = 'retreat'; f.attackStats.retreats++; event(ctx, 'fox_retreat', { fox: f.slot, distance: dist(f, target), targetDistance:dist(f.restPoint, target), requiredMinDistance:ctx.tune.smartRestMinPlayerDistance });
  }
  if (f.retreating) {
    const nav = stepSmartRetreatNavigation(f.retreatProgress, { x:f.x,z:f.z,distance:dist(f,f.restPoint),
      playerDistance:dist(f,target),minPlayerDistance:ctx.tune.smartRestMinPlayerDistance,
      arriveRadius:ctx.retreat.arriveRadius,speed:ctx.retreat.speed },dt);
    f.retreatProgress=nav;
    if (nav.action === 'rest') {
      f.retreating=false; f.state='rest_safe'; f.restTimer=ctx.retreat.restSeconds.smart;
      event(ctx,'fox_rest_safe',{fox:f.slot,distance:dist(f,target),hp:f.hp});
    } else if (nav.action === 'repath' || dist(f.restPoint,target)<ctx.tune.smartRestMinPlayerDistance) {
      f.restPoint=chooseRestPoint({foxX:f.x,foxZ:f.z,playerX:target.x,playerZ:target.z,bounds:{hw:74,hh:44}},
        {...ctx.retreat,betaSmartMinPlayerDistance:ctx.tune.smartRestMinPlayerDistance});
      f.retreatProgress={}; event(ctx,'fox_retreat_repath',{fox:f.slot,distance:dist(f,target)});
    } else {
      const steer=steerGroundDirection(f.restPoint.x-f.x,f.restPoint.z-f.z,ctx.retreat.speed,f,[],{hw:74,hh:44},f.slot,f.yaw);
      const moved=stepFoxLocomotion(f,{x:f.x+steer.x*100,z:f.z+steer.z*100},dt,
        {speed:ctx.retreat.speed,acceleration:FOX.handling.locomotionAccel,turnAcceleration:FOX.handling.locomotionTurnAccel});
      Object.assign(f,{x:moved.x,z:moved.z,yaw:moved.yaw,vx:moved.vx,vz:moved.vz,turnVelocity:moved.turnVelocity});
    }
  } else if (f.state === 'rest_safe') {
    if (dist(f,target)<ctx.tune.smartRestMinPlayerDistance) { f.state='retreat';f.retreating=true;f.retreatProgress={};return; }
    const r = stepRestSafe({ timer: f.restTimer, hp: f.hp, maxHp: f.maxHp }, dt, ctx.retreat); f.restTimer = r.timer; f.hp = r.hp;
    if (r.done && f.hp > 0) { f.state = 'roam'; f.hitStreak = 0; event(ctx, 'fox_rest_done', { fox: f.slot }); }
  } else {
    const motion = stepSmartMotion({ ...f.smart, x: f.x, z: f.z, yaw: f.yaw, vx: f.vx, vz: f.vz, intent,
      pounceDashDuration: intent === 'pounce' && !f.smart.pounceCommitted
        ? smartPounceDashDurationForDistance(d, { pounceSpeed:f.smart.pounceSpeed, acceleration:f.smart.acceleration, dt })
        : f.smart.pounceDashDuration,
    }, { x: target.x, z: target.z }, dt, intent, {
      betaTeam: true, commitAllowed: canAttack && ctx.pack.canCommit(f.slot, ctx.time), stalkSpeed: 2.4, sprintSpeed: 6.5, speedTarget: intent === 'recover' ? 0 : (intent === 'pounce' && !f.smart.pounceCommitted ? 0 : undefined),
      pounceRecoverTime: ctx.tune.smartPounceRecoverTime,
    });
    if (motion.pounceStrikeStarted) { motion.pounceStrikeStarted = false; f.stamina = Math.max(0, f.stamina - ctx.tune.smartPounceStaminaCost); f.attackStats.pounceStrikes++; event(ctx, 'fox_pounce_strike', { fox: f.slot, distance: dist(f, target) }); event(ctx, 'fox_pounce_cost', { fox: f.slot, cost: ctx.tune.smartPounceStaminaCost }); }
    Object.assign(f.smart, motion); f.x = motion.x; f.z = motion.z; f.yaw = motion.yaw; f.vx = motion.vx; f.vz = motion.vz;
    f.state = motion.pounceStage === 'recover' ? 'recover' : (motion.pounceCommitted ? 'pounce' : 'roam');
    if (motion.pounceCommitted && !f._pounceSeen) { ctx.pack.recordCommit(f.slot, ctx.time); f._pounceSeen = true; f.attackStats.commits++; event(ctx, 'fox_pounce_commit', { fox: f.slot, distance: d, dashDuration: f.smart.pounceDashDuration }); }
    if (!motion.pounceCommitted) f._pounceSeen = false;
    const melee = advanceSmartMelee(f.melee, { distance: d, reachable: true, alive: true, pounceCommitted: motion.pounceCommitted, targetYaw: yawTo(f, target) }, dt, ctx.tune);
    if (melee.justStrikeStarted) f.attackStats.meleeStrikes++;
    f.melee = melee;
    if (smartMeleeContactHit({ phase: melee.phase, striking: melee.phase === 'strike', hitConsumed: melee.hitConsumed, distance: d, verticalOverlap: true, contactCd: f.contactCd }, ctx.tune)) {
      target.hp = Math.max(0, target.hp - 1); target.stats.taken += 1; f.attackStats.meleeHits++; f.melee = { ...melee, hitConsumed: true }; f.contactCd = .8; event(ctx, 'fox_melee_hit', { fox: f.slot, marmot: target.id, damage: 1 });
    }
  }
  const drain = f.smart.pounceCommitted ? ctx.tune.smartPounceStaminaPerSec : 0;
  const st = stepStamina({ stamina: f.stamina, hp: f.hp, locked: f.staminaLocked }, dt, { maxStamina: f.maxStamina, maxHp: f.maxHp, drainPerSec: drain, regenPerSec: ctx.tune.smartRestStaminaRegenPerSec, regenPerSecByState: { roam: ctx.tune.smartRoamStaminaRegenPerSec, recover: ctx.tune.smartRecoverStaminaRegenPerSec, intercept: ctx.tune.smartInterceptStaminaRegenPerSec }, regenState: f.state === 'recover' ? 'recover' : f.role === 'interceptor' ? 'intercept' : 'roam', resting: f.state === 'rest_safe', hpRegenRatio: 0, staminaLockSeconds: ctx.tune.smartStaminaLockSeconds });
  Object.assign(f, { stamina: st.stamina, hp: st.hp, staminaLocked: st.locked });
  if (f.hp <= 0 && !f.dead) { f.alive = false; f.dead = true; f.state = 'dead'; f.attackStats.deaths++; event(ctx, 'fox_died', { fox: f.slot }); }
}

export function runScenario(config = {}) {
  const effectiveConfig = validateLabConfig(config);
  const { dt, duration, ticks, tune, scenario, movement, seed } = effectiveConfig;
  const rand = createSeededRandom(seed), retreat = createSmartFoxRetreat(tune);
  const foxCount = effectiveConfig.foxes, marmotCount = 1;
  const foxes = []; const marmots = [];
  for (let i = 0; i < foxCount; i++) { const angle = foxCount === 1 ? 0 : (i / foxCount) * TAU; foxes.push(makeFox(i, Math.sin(angle) * 5.4, Math.cos(angle) * 5.4, tune)); }
  for (let i = 0; i < marmotCount; i++) { const angle = marmotCount === 1 ? Math.PI : (i / marmotCount) * TAU + Math.PI; marmots.push(makeMarmot(i, Math.sin(angle) * (scenario === 'faceoff-tap' ? 0 : 10 + i * 2), Math.cos(angle) * ((scenario === 'faceoff-tap' || scenario === 'parry-tap') ? 0 : 10 + i * 2), movement)); }
  if (scenario === 'chase-pounce-tap') marmots.forEach((m) => { m.attackMode = 'pounce'; });
  marmots[0].phase = rand() * TAU;
  const ctx = { scenario, time: 0, tune, retreat, foxes, marmots, events: [], maxEvents: 5000, rand,
    pack: createSmartPack({ window: tune.smartPackWindow, spacing: tune.smartPackSpacing, slotSpacing: tune.smartPackSlotSpacing, dynamicAttackers: true }) };
  const spawn = foxes.map((f) => ({ slot:f.slot, hp:f.hp, maxHp:f.maxHp, stamina:f.stamina, maxStamina:f.maxStamina, staminaLocked:f.staminaLocked, hitStreak:f.hitStreak, state:f.state, retreating:f.retreating, dead:f.dead }));
  const movementTrace = [];
  let prevRoles = {}, progress = null, status = 'completed', tickInvariants = [];
  let ticksExecuted = 0;
  let peakAttackRoles = 0, peakConcurrentPounces = 0, peakWindowCommits = 0;
  for (let tick = 0; tick < ticks; tick++) {
    ctx.time = tick * dt;
    marmots.forEach((m) => moveMarmot(m, foxes, dt, ctx));
    const roles = assignRoles(foxes, { x: 0, z: 0 }, prevRoles, ctx.time, { betaTeam: true, holdTime: tune.smartTeamHoldTime, switchCooldown: tune.smartTeamSwitchCooldown, restHpRatio: tune.smartTeamRestHpRatio, restStaminaRatio: tune.smartTeamRestStaminaRatio, healthyHpRatio: tune.smartTeamHealthyHpRatio, healthyStaminaRatio: tune.smartTeamHealthyStaminaRatio }); prevRoles = roles;
    peakAttackRoles = Math.max(peakAttackRoles, Object.values(roles).filter((r) => r.role === 'striker' || r.role === 'flanker').length);
    foxes.forEach((f) => updateFox(f, foxes, marmots, ctx, dt, roles));
    peakConcurrentPounces = Math.max(peakConcurrentPounces, foxes.filter((f) => f.alive && f.smart.pounceCommitted).length);
    peakWindowCommits = Math.max(peakWindowCommits, ctx.pack.commits.filter((c) => ctx.time - c.at < tune.smartPackWindow).length);
    marmots.forEach((m) => marmotAttack(m, foxes, ctx, dt));
    ticksExecuted++;
    progress = advanceLabProgress(progress, [...foxes, ...marmots], dt);
    if (progress.stalled && !ctx.events.some((e) => e.type === 'no_progress')) event(ctx, 'no_progress', { idleSeconds:progress.idleSeconds });
    if (tick % Math.max(1, Math.round(.25 / dt)) === 0) movementTrace.push({ t:ctx.time, marmots:marmots.map((m) => ({ id:m.id, x:m.x, z:m.z, strategy:m.strategy, phase:!m.openingComplete && ['parry-tap','chase-pounce-tap'].includes(scenario) ? (scenario === 'parry-tap' ? 'parry-opening' : 'chase-opening') : 'movement' })) });
    tickInvariants = labActorInvariants(foxes, marmots);
    if (tickInvariants.length) { event(ctx, 'invariant_failed', { errors:tickInvariants }); break; }
    if (foxes.every((f) => !f.alive) || marmots.every((m) => !m.alive)) break;
  }
  const invariants = tickInvariants;
  const parry = ctx.events.some((e) => e.type === 'parry_success');
  if (scenario === 'parry-tap' && !parry) { status = 'failed'; ctx.failure = 'setup/scenario failed: no real parry_success event'; }
  const pounceCommitters = new Set(foxes.filter((f) => f.attackStats.commits > 0).map((f) => f.slot));
  const activeAttackers = new Set(foxes.filter((f) => f.attackStats.commits + f.attackStats.pounceStrikes + f.attackStats.meleeStrikes + f.attackStats.meleeHits > 0).map((f) => f.slot));
  const result = { status, failure: ctx.failure || null, scenario, movement, seed, config:effectiveConfig, spawn, movementTrace, dt, duration: Number((ticksExecuted * dt).toFixed(6)), ticks: ticksExecuted, foxes: foxes.map((f) => ({ slot: f.slot, hp: f.hp, maxHp: f.maxHp, stamina: f.stamina, maxStamina: f.maxStamina, state: f.state, role: f.role, dead: f.dead, attacks: { ...f.attackStats }, stateTime: Object.fromEntries(Object.entries(f.stateTime).map(([k, v]) => [k, Number(v.toFixed(6))])) })), marmots: marmots.map((m) => ({ id: m.id, hp: m.hp, maxHp:m.maxHp, stamina:m.stamina, maxStamina:m.maxStamina, strategy:m.strategy, x:m.x, z:m.z, stats: m.stats })), events: ctx.events, invariants, metrics: { pounceCommits: ctx.events.filter((e) => e.type === 'fox_pounce_commit').length, pounceStrikes: ctx.events.filter((e) => e.type === 'fox_pounce_strike').length, meleeHits: ctx.events.filter((e) => e.type === 'fox_melee_hit').length, activeAttackers: activeAttackers.size, attackerSlots: [...activeAttackers], pounceCommitters: pounceCommitters.size, committerSlots: [...pounceCommitters], peakAttackRoles, peakConcurrentPounces, peakWindowCommits, parrySuccesses: ctx.events.filter((e) => e.type === 'parry_success').length, foxRetreats: ctx.events.filter((e) => e.type === 'fox_retreat').length, foxDeaths: ctx.events.filter((e) => e.type === 'fox_died').length, marmotHits: ctx.events.filter((e) => e.type === 'marmot_hit').length, playerDamageTaken: marmots.reduce((sum, m) => sum + m.maxHp - m.hp, 0), playerHitsTaken: marmots.reduce((sum, m) => sum + m.stats.taken, 0), attackPressure: foxes.reduce((sum, f) => sum + f.attackStats.pounceStrikes + f.attackStats.meleeStrikes, 0) } };
  if (invariants.length) { result.status = 'failed'; result.failure = `invariants: ${invariants.join(',')}`; }
  return result;
}

export function runMatrix(options = {}) {
  const seeds = options.seeds || [options.seed ?? 20261031, (options.seed ?? 20261031) + 101, (options.seed ?? 20261031) + 202];
  if (!Array.isArray(seeds) || seeds.length < 1 || seeds.length > 16) throw new RangeError('matrix seeds must contain 1..16 entries');
  const bounded = validateLabConfig({ ...options, seed:seeds[0] });
  if (bounded.ticks * (2 + 3 + 5 + 9) * MOVES.length * SCENARIOS.length * seeds.length > 2_000_000) throw new RangeError('matrix exceeds 2,000,000 actor-tick budget');
  const cases = [];
  for (const foxes of [1, 2, 4, 8]) for (const movement of MOVES) for (const scenario of SCENARIOS) for (const seed of seeds) {
    cases.push(runScenario({ ...options, seed, foxes, marmots: 1, scenario, movement }));
  }
  return cases;
}
