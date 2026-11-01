/**
 * Renderer-free SmartFox combat laboratory.
 * Uses the same production decision, team, motion, stamina, retreat and combat
 * volume primitives as the browser entities; this file only adapts them to
 * plain numeric state and deterministic fixed-step actors.
 */
import { FOX } from '../core/config.js';
import { combatStats, resolveStrikeProfile, strikeVolumeHit } from '../systems/combat.js';
import { stepStamina, shouldRetreat, chooseRestPoint, stepRestSafe, enterRestSafe } from '../core/fox-motion.js';
import { BETA_TUNE, createSmartFoxRetreat, createSmartFoxSpawnState, createSmartFoxVitals } from '../core/beta-tuning.js';
import {
  utilityScores, updatePerception, assignRoles, stepSmartMotion, advanceSmartMelee,
  smartMeleeContactHit, createSmartMeleeState, createSmartPack,
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

function makeMarmot(id, x, z, target, strategy) {
  return { id, x, z, yaw: 0, target, strategy, hp: 12, maxHp: 12, stamina: 100, maxStamina: 100,
    cooldown: 0, parryCooldown: 0, attackMode: 'tap', facing: 0, alive: true, damage: 1,
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
  if (m.strategy === 'zigzag') desired += (Math.sin(phase * 2) >= 0 ? 1 : -1) * .7;
  const speed = m.strategy === 'stationary' ? 0 : m.strategy === 'kite' ? 4.2 : m.strategy === 'orbit' ? 3.2 : 3.8;
  if (m.strategy === 'stationary') { m.yaw = toward; return; }
  m.yaw = desired;
  m.x += Math.sin(desired) * speed * dt;
  m.z += Math.cos(desired) * speed * dt;
}

function facingHit(attacker, target, profile, targetHeight = 1.1) {
  const forward = Math.cos(attacker.yaw) * (target.z - attacker.z) + Math.sin(attacker.yaw) * (target.x - attacker.x);
  const lateral = -Math.sin(attacker.yaw) * (target.z - attacker.z) + Math.cos(attacker.yaw) * (target.x - attacker.x);
  return strikeVolumeHit({ forward, lateral, playerBottom: 0, targetBottom: 0, targetHeight, range: profile.range, move: profile.move, volume: profile });
}

function marmotAttack(m, foxes, ctx, dt) {
  if (!m.alive) return;
  m.cooldown = Math.max(0, m.cooldown - dt); m.parryCooldown = Math.max(0, m.parryCooldown - dt);
  const f = nearest(foxes, m); if (!f) return;
  const d = dist(m, f); m.yaw = yawTo(m, f);
  const scenario = ctx.scenario;
  const wantsParry = scenario === 'parry-tap' && f.smart.pounceCommitted && f.smart.pounceStage === 'windup';
  if (wantsParry && m.parryCooldown <= 0 && d <= 3.2) {
    m.stats.attempts++;
    const delta = Math.abs(wrap(m.yaw - yawTo(m, f)));
    if (delta <= 78 * Math.PI / 180 && f.smart.pounceStage === 'windup') {
      m.stats.parries++; m.stats.blocked++; m.parryCooldown = .8; f.smart = { ...f.smart, pounceCommitted: false, pounceStage: 'recover', pounceStageTime: .6, pounceCooldown: 1.5 };
      f.state = 'recover'; f.interruptions++; event(ctx, 'parry_success', { marmot: m.id, fox: f.slot });
      return;
    }
  }
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
  if (shouldRetreat({ hpRatio: f.hp / f.maxHp, staminaRatio: f.stamina / f.maxStamina, hitStreak: f.hitStreak, state: f.state }, ctx.retreat)) intent = 'recover';
  if (intent === 'recover' && !f.retreating && f.state !== 'rest_safe' && f.state !== 'dead' && f.hp < f.maxHp * .7) {
    f.restPoint = chooseRestPoint({ foxX: f.x, foxZ: f.z, playerX: target.x, playerZ: target.z, bounds: { hw: 74, hh: 44 } }, ctx.retreat);
    f.retreating = true; f.state = 'retreat'; f.attackStats.retreats++; event(ctx, 'fox_retreat', { fox: f.slot, distance: dist(f, target) });
  }
  if (f.retreating) {
    const rd = dist(f, f.restPoint); if (rd < ctx.retreat.arriveRadius) { f.retreating = false; f.state = 'rest_safe'; f.restTimer = ctx.retreat.restSeconds.smart; event(ctx, 'fox_rest_safe', { fox: f.slot, distance: dist(f, target) }); }
    else { f.yaw = yawTo(f, f.restPoint); f.x += Math.sin(f.yaw) * ctx.retreat.speed * dt; f.z += Math.cos(f.yaw) * ctx.retreat.speed * dt; }
  } else if (f.state === 'rest_safe') {
    const r = stepRestSafe({ timer: f.restTimer, hp: f.hp, maxHp: f.maxHp }, dt, ctx.retreat); f.restTimer = r.timer; f.hp = r.hp;
    if (r.done && f.hp > 0) { f.state = 'roam'; f.hitStreak = 0; event(ctx, 'fox_rest_done', { fox: f.slot }); }
  } else {
    const motion = stepSmartMotion({ ...f.smart, x: f.x, z: f.z, yaw: f.yaw, vx: f.vx, vz: f.vz, intent }, { x: target.x, z: target.z }, dt, intent, {
      betaTeam: true, commitAllowed: canAttack && ctx.pack.canCommit(f.slot, ctx.time), stalkSpeed: 2.4, sprintSpeed: 6.5, speedTarget: intent === 'recover' ? 0 : (intent === 'pounce' && !f.smart.pounceCommitted ? 0 : undefined),
      pounceRecoverTime: ctx.tune.smartPounceRecoverTime,
    });
    if (motion.pounceStrikeStarted) { motion.pounceStrikeStarted = false; f.stamina = Math.max(0, f.stamina - ctx.tune.smartPounceStaminaCost); f.attackStats.pounceStrikes++; event(ctx, 'fox_pounce_strike', { fox: f.slot }); event(ctx, 'fox_pounce_cost', { fox: f.slot, cost: ctx.tune.smartPounceStaminaCost }); }
    Object.assign(f.smart, motion); f.x = motion.x; f.z = motion.z; f.yaw = motion.yaw; f.vx = motion.vx; f.vz = motion.vz;
    f.state = motion.pounceStage === 'recover' ? 'recover' : (motion.pounceCommitted ? 'pounce' : 'roam');
    if (motion.pounceCommitted && !f._pounceSeen) { ctx.pack.recordCommit(f.slot, ctx.time); f._pounceSeen = true; f.attackStats.commits++; event(ctx, 'fox_pounce_commit', { fox: f.slot }); }
    if (!motion.pounceCommitted) f._pounceSeen = false;
    const melee = advanceSmartMelee(f.melee, { distance: d, reachable: true, alive: true, pounceCommitted: motion.pounceCommitted, targetYaw: yawTo(f, target) }, dt, ctx.tune);
    if (melee.justStrikeStarted) f.attackStats.meleeStrikes++;
    f.melee = melee;
    if (smartMeleeContactHit({ phase: melee.phase, striking: melee.phase === 'strike', hitConsumed: melee.hitConsumed, distance: d, verticalOverlap: true, contactCd: f.contactCd }, ctx.tune)) {
      target.hp = Math.max(0, target.hp - 1); target.stats.taken += 1; f.attackStats.meleeHits++; f.melee = { ...melee, hitConsumed: true }; f.contactCd = .8; event(ctx, 'fox_melee_hit', { fox: f.slot, marmot: target.id, damage: 1 });
    }
  }
  const drain = f.smart.pounceCommitted ? ctx.tune.smartPounceStaminaPerSec : 0;
  const st = stepStamina({ stamina: f.stamina, hp: f.hp, locked: f.staminaLocked }, dt, { maxStamina: f.maxStamina, maxHp: f.maxHp, drainPerSec: drain, regenPerSec: ctx.tune.smartRestStaminaRegenPerSec, regenPerSecByState: { roam: ctx.tune.smartRoamStaminaRegenPerSec, recover: ctx.tune.smartRecoverStaminaRegenPerSec, intercept: ctx.tune.smartInterceptStaminaRegenPerSec }, regenState: f.state === 'recover' ? 'recover' : f.role === 'interceptor' ? 'intercept' : 'roam', resting: f.state === 'rest_safe', hpRegenRatio: f.state === 'rest_safe' ? ctx.retreat.regenPerSec : 0, staminaLockSeconds: ctx.tune.smartStaminaLockSeconds });
  Object.assign(f, { stamina: st.stamina, hp: st.hp, staminaLocked: st.locked });
  if (f.hp <= 0 && !f.dead) { f.alive = false; f.dead = true; f.state = 'dead'; f.attackStats.deaths++; event(ctx, 'fox_died', { fox: f.slot }); }
}

export function runScenario(config = {}) {
  const dt = Number(config.dt ?? 1 / 60); const duration = Number(config.duration ?? 20); const ticks = Math.ceil(duration / dt); const rand = createSeededRandom(config.seed ?? 1);
  const tune = { ...BETA_TUNE, ...(config.tune || {}) }; const retreat = createSmartFoxRetreat(tune); const scenario = config.scenario || 'faceoff-tap';
  const foxCount = Math.max(1, Math.floor(config.foxes ?? 1)); const marmotCount = 1; const movement = config.movement || 'stationary';
  const foxes = []; const marmots = [];
  for (let i = 0; i < foxCount; i++) { const angle = foxCount === 1 ? 0 : (i / foxCount) * TAU; foxes.push(makeFox(i, Math.sin(angle) * 5.4, Math.cos(angle) * 5.4, tune)); }
  for (let i = 0; i < marmotCount; i++) { const angle = marmotCount === 1 ? Math.PI : (i / marmotCount) * TAU + Math.PI; marmots.push(makeMarmot(i, Math.sin(angle) * (scenario === 'faceoff-tap' ? 0 : 10 + i * 2), Math.cos(angle) * ((scenario === 'faceoff-tap' || scenario === 'parry-tap') ? 0 : 10 + i * 2), movement)); }
  if (scenario === 'chase-pounce-tap') marmots.forEach((m) => { m.attackMode = 'pounce'; });
  marmots[0].phase = rand() * TAU;
  const ctx = { scenario, time: 0, tune, retreat, foxes, marmots, events: [], maxEvents: 5000, rand,
    pack: createSmartPack({ window: tune.smartPackWindow, spacing: tune.smartPackSpacing, slotSpacing: tune.smartPackSlotSpacing, dynamicAttackers: true }) };
  let prevRoles = {}, noProgress = 0, lastDist = Infinity, status = 'completed';
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
    const progress = foxes.reduce((s, f) => s + (f.alive ? 1 : 0), 0) + marmots.reduce((s, m) => s + (m.alive ? 1 : 0), 0);
    if (progress === lastDist) noProgress++; else noProgress = 0; lastDist = progress;
    if (noProgress > Math.ceil(5 / dt) && !ctx.events.some((e) => e.type === 'no_progress')) event(ctx, 'no_progress');
    if (foxes.every((f) => !f.alive) || marmots.every((m) => !m.alive)) break;
  }
  const invariants = []; for (const f of foxes) { if (f.maxHp <= 0 || f.hp < 0 || f.hp > f.maxHp || f.stamina < 0 || f.stamina > f.maxStamina) invariants.push(`fox${f.slot}:bounds`); if (f.dead && f.hp !== 0) invariants.push(`fox${f.slot}:dead-hp`); }
  const parry = ctx.events.some((e) => e.type === 'parry_success');
  if (scenario === 'parry-tap' && !parry) { status = 'failed'; ctx.failure = 'setup/scenario failed: no real parry_success event'; }
  const pounceCommitters = new Set(foxes.filter((f) => f.attackStats.commits > 0).map((f) => f.slot));
  const activeAttackers = new Set(foxes.filter((f) => f.attackStats.commits + f.attackStats.pounceStrikes + f.attackStats.meleeStrikes + f.attackStats.meleeHits > 0).map((f) => f.slot));
  const result = { status, failure: ctx.failure || null, scenario, movement, seed: config.seed ?? 1, dt, duration: Number((ctx.time + dt).toFixed(6)), ticks: Math.min(ticks, Math.floor(ctx.time / dt) + 1), foxes: foxes.map((f) => ({ slot: f.slot, hp: f.hp, maxHp: f.maxHp, stamina: f.stamina, maxStamina: f.maxStamina, state: f.state, role: f.role, dead: f.dead, attacks: { ...f.attackStats }, stateTime: Object.fromEntries(Object.entries(f.stateTime).map(([k, v]) => [k, Number(v.toFixed(6))])) })), marmots: marmots.map((m) => ({ id: m.id, hp: m.hp, stats: m.stats })), events: ctx.events, invariants, metrics: { pounceCommits: ctx.events.filter((e) => e.type === 'fox_pounce_commit').length, pounceStrikes: ctx.events.filter((e) => e.type === 'fox_pounce_strike').length, meleeHits: ctx.events.filter((e) => e.type === 'fox_melee_hit').length, activeAttackers: activeAttackers.size, attackerSlots: [...activeAttackers], pounceCommitters: pounceCommitters.size, committerSlots: [...pounceCommitters], peakAttackRoles, peakConcurrentPounces, peakWindowCommits, parrySuccesses: ctx.events.filter((e) => e.type === 'parry_success').length, foxRetreats: ctx.events.filter((e) => e.type === 'fox_retreat').length, foxDeaths: ctx.events.filter((e) => e.type === 'fox_died').length, marmotHits: ctx.events.filter((e) => e.type === 'marmot_hit').length, playerDamageTaken: marmots.reduce((sum, m) => sum + m.maxHp - m.hp, 0), playerHitsTaken: marmots.reduce((sum, m) => sum + m.stats.taken, 0), attackPressure: foxes.reduce((sum, f) => sum + f.attackStats.pounceStrikes + f.attackStats.meleeStrikes, 0) } };
  if (invariants.length) { result.status = 'failed'; result.failure = `invariants: ${invariants.join(',')}`; }
  return result;
}

export function runMatrix(options = {}) {
  const seeds = options.seeds || [options.seed ?? 20261031, (options.seed ?? 20261031) + 101, (options.seed ?? 20261031) + 202];
  const cases = [];
  for (const foxes of [1, 2, 4, 8]) for (const movement of MOVES) for (const scenario of SCENARIOS) for (const seed of seeds) {
    cases.push(runScenario({ ...options, seed, foxes, marmots: 1, scenario, movement }));
  }
  return cases;
}
