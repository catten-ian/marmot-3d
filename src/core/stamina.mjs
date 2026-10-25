/** Beta stamina, finite mouth buffer and irreversible fat storage. No DOM/Three dependencies. */
import { BETA_TUNE } from './beta-tuning.js';

export const clampResource = (value, max = 100) => Math.max(0, Math.min(max, Number.isFinite(value) ? value : 0));

/** Preserve legacy p.energy reads/writes while stamina is the canonical beta state. */
export function installEnergyAlias(player) {
  if (!player || Object.getOwnPropertyDescriptor(player, 'energy')?.get) return player;
  const legacy = player.energy;
  if (player.stamina == null) player.stamina = legacy ?? 100;
  Object.defineProperty(player, 'energy', {
    enumerable: true, configurable: true,
    get() { return this.stamina; },
    set(value) { this.stamina = value; },
  });
  return player;
}

/** Above 60%, a linearly increasing fraction becomes fat; at full stamina all becomes fat. */
export function fatConversionFraction(stamina, maxStamina = 100, threshold = BETA_TUNE.staminaFatThreshold) {
  if (!(maxStamina > 0) || !(threshold >= 0 && threshold < 1)) return 0;
  return clampResource((clampResource(stamina, maxStamina) / maxStamina - threshold) / (1 - threshold), 1);
}

/** Apply food/chewed grass/flower nutrition. Overflow at full stamina also becomes fat, never reverse. */
export function applyNutrition(state, amount, { maxStamina = 100, maxFat = 100 } = {}) {
  const stamina = clampResource(state.stamina, maxStamina);
  const fat = clampResource(state.fat, maxFat);
  const intake = Math.max(0, Number.isFinite(amount) ? amount : 0);
  const fraction = fatConversionFraction(stamina, maxStamina);
  let fatGain = intake * fraction;
  const wantedStamina = intake - fatGain;
  const staminaGain = Math.min(wantedStamina, maxStamina - stamina);
  // Conservation: stamina clipped by its cap cannot vanish or turn back from fat later.
  fatGain += wantedStamina - staminaGain;
  const acceptedFat = Math.min(fatGain, maxFat - fat);
  return {
    ...state, stamina: stamina + staminaGain, fat: fat + acceptedFat,
    staminaGain, fatGain: acceptedFat,
    overflow: Math.max(0, fatGain - acceptedFat),
  };
}

/** Grazing: only immediateShare bypasses the mouth. Excess mouth grass is deterministically spilled. */
export function ingestGraze(state, amount, {
  mouthCapacity = BETA_TUNE.mouthCapacity,
  immediateShare = BETA_TUNE.grazeImmediateShare,
} = {}) {
  const intake = Math.max(0, Number.isFinite(amount) ? amount : 0);
  const share = clampResource(immediateShare, 1);
  const mouth = clampResource(state.mouth, mouthCapacity);
  const direct = applyNutrition({ ...state, mouth }, intake * share);
  const wantedMouth = intake * (1 - share);
  const mouthGain = Math.min(wantedMouth, mouthCapacity - mouth);
  return {
    ...direct, mouth: mouth + mouthGain, mouthGain,
    spilled: wantedMouth - mouthGain,
  };
}

/**
 * Chewing is the only burrow recovery path. Both burrow kinds chew, main > temporary;
 * an empty mouth cannot generate stamina/fat. Outside, standing requires !running && !grazing.
 */
export function chewMouth(state, dt, {
  running = false, grazing = false, burrowType = null,
  mouthCapacity = BETA_TUNE.mouthCapacity,
  chewPerSec = BETA_TUNE.chewPerSec,
  mainRate = BETA_TUNE.mainBurrowChewPerSec,
  temporaryRate = BETA_TUNE.temporaryBurrowChewPerSec,
} = {}) {
  const mouth = clampResource(state.mouth, mouthCapacity);
  const inBurrow = burrowType === 'base' || burrowType === 'shelter';
  const standing = !running && !grazing;
  const rate = burrowType === 'base' ? mainRate : burrowType === 'shelter' ? temporaryRate : standing ? chewPerSec : 0;
  const chewed = Math.min(mouth, Math.max(0, rate) * Math.max(0, Number.isFinite(dt) ? dt : 0));
  if (!inBurrow && !standing) return { ...state, mouth, chewed: 0, staminaGain: 0, fatGain: 0 };
  const converted = applyNutrition({ ...state, mouth: mouth - chewed }, chewed);
  return { ...converted, chewed };
}

export function syncMetabolism(player, next) {
  player.stamina = next.stamina;
  player.fat = next.fat;
  player.mouth = next.mouth;
  return next;
}

/** Flower recovery: fixed total, linearly falling rate, exactly exhausted over duration. */
export function createFlowerRecovery({
  hpTotal = BETA_TUNE.flowerHpTotal,
  staminaTotal = BETA_TUNE.flowerStaminaTotal,
  duration = BETA_TUNE.flowerRecoverySeconds,
} = {}) {
  return { hpRemaining: hpTotal, staminaRemaining: staminaTotal, timeRemaining: duration, duration };
}

export function stepFlowerRecovery(recovery, dt) {
  if (!recovery || !(recovery.timeRemaining > 0)) return { hp: 0, nutrition: 0, recovery: null };
  const elapsed = Math.min(recovery.timeRemaining, Math.max(0, Number.isFinite(dt) ? dt : 0));
  const before = recovery.timeRemaining;
  const after = before - elapsed;
  // Integral of a linear rate falling to zero at duration; independent of running/movement.
  const fraction = before > 0 ? 1 - (after * after) / (before * before) : 1;
  const hp = recovery.hpRemaining * fraction;
  const nutrition = recovery.staminaRemaining * fraction;
  const next = {
    ...recovery, hpRemaining: Math.max(0, recovery.hpRemaining - hp),
    staminaRemaining: Math.max(0, recovery.staminaRemaining - nutrition), timeRemaining: after,
  };
  return { hp, nutrition, recovery: after > 1e-9 ? next : null };
}
