/** PAF-only perception policy. Preparing quietly is not an airborne impact. */
import { CUE_MODE, cueRadii, hearingNoiseCoef } from './predator-prey.js';

export function pafLungeHearingRadius(lungeRange, cfg) {
  const minRange = Number.isFinite(cfg.pounceRangeMin) ? cfg.pounceRangeMin : 3.6;
  const maxRange = Number.isFinite(cfg.pounceRangeMax) ? cfg.pounceRangeMax : 7.2;
  const defaultRange = Number.isFinite(cfg.pounceRangeDefault) ? cfg.pounceRangeDefault : (minRange + maxRange) / 2;
  const minScale = Number.isFinite(cfg.lungeHearingRadiusMinScale) ? cfg.lungeHearingRadiusMinScale : 0.8;
  const maxScale = Number.isFinite(cfg.lungeHearingRadiusMaxScale) ? cfg.lungeHearingRadiusMaxScale : 1.2;
  const base = Number.isFinite(cfg.detectLunge) ? cfg.detectLunge : 17;
  const range = Math.max(minRange, Math.min(maxRange, Number(lungeRange) || defaultRange));
  if (range <= defaultRange) {
    const t = (range - minRange) / Math.max(1e-9, defaultRange - minRange);
    return base * (minScale + (1 - minScale) * t);
  }
  const t = (range - defaultRange) / Math.max(1e-9, maxRange - defaultRange);
  return base * (1 + (maxScale - 1) * t);
}

export function pafNoiseState({ phase = 'idle', sprint = false, groundSpeed = 0, lungeRange } = {}, cfg) {
  // groundSpeed is the actual displacement measured by play-as-fox.update().
  // A held sprint key without ground movement is still quiet preparation.
  const movingOnGround = Number.isFinite(groundSpeed) && Math.abs(groundSpeed) >= 0.02;
  const quietPreparation = phase === 'wind' && !movingOnGround;
  const threatening = phase === 'wind' || phase === 'lunge';
  // Noise follows the real ground state. Only the airborne lunge is lunge noise.
  const mode = phase === 'lunge'
    ? CUE_MODE.LUNGE
    : quietPreparation
      ? CUE_MODE.STALK
      : sprint ? CUE_MODE.SPRINT : CUE_MODE.STALK;
  // Keep wind's existing visual threat tier without promoting its hearing/noise tier.
  const visionMode = phase === 'wind' && !quietPreparation ? CUE_MODE.LUNGE : mode;
  const radii = cueRadii(mode, { ...cfg, visionMode });
  const hearingRadius = phase === 'lunge'
    ? pafLungeHearingRadius(lungeRange, cfg)
    : quietPreparation
      ? Math.min(cfg.hearRadiusPrepare, cfg.hearRadiusStalk * 0.5)
      : radii.hearing;
  const noiseCoef = quietPreparation
    ? Math.min(cfg.noiseCoefPrepare, cfg.noiseCoefStalk * 0.5)
    : hearingNoiseCoef(mode, cfg);
  return { mode, visionMode, threatening, quietPreparation, hearingRadius, noiseCoef, visionRadius: radii.vision };
}

/** Supply the prey integrator with the exact PAF state-specific perception contract. */
export function pafNoiseConfig(state, cfg) {
  return { ...cfg, visionMode: state.visionMode, hearingRadius: state.hearingRadius, noiseCoef: state.noiseCoef };
}
