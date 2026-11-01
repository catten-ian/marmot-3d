/** PAF-only perception policy. Preparing quietly is not an airborne impact. */
import { CUE_MODE, cueRadii, hearingNoiseCoef } from './predator-prey.js';

export function pafNoiseState({ phase = 'idle', sprint = false, groundSpeed = 0 } = {}, cfg) {
  const quietPreparation = phase === 'wind' && Math.abs(groundSpeed) < 0.02;
  const threatening = phase === 'wind' || phase === 'lunge';
  // Moving wind and airborne lunge retain the existing highest-threat contract.
  const mode = threatening && !quietPreparation ? CUE_MODE.LUNGE : sprint && !quietPreparation ? CUE_MODE.SPRINT : CUE_MODE.STALK;
  const radii = cueRadii(mode, cfg);
  const hearingRadius = quietPreparation
    ? Math.min(cfg.hearRadiusPrepare, cfg.hearRadiusStalk * 0.5) : radii.hearing;
  const noiseCoef = quietPreparation
    ? Math.min(cfg.noiseCoefPrepare, cfg.noiseCoefStalk * 0.5) : hearingNoiseCoef(mode, cfg);
  return { mode, threatening, quietPreparation, hearingRadius, noiseCoef, visionRadius: radii.vision };
}

/** Supply the existing prey perception integrator with only PAF's quiet preparation overrides. */
export function pafNoiseConfig(state, cfg) {
  return state.quietPreparation ? { ...cfg, hearRadiusStalk: state.hearingRadius, noiseCoefStalk: state.noiseCoef } : cfg;
}
