/** Decide the next safe path after an automatically selected Verdant tier fails. */
export function nextAutomaticVerdantFallback(tier) {
  if (tier === 'ultra') return { tier: 'high', useSimpleFallback: false };
  if (tier === 'high') return { tier: 'medium', useSimpleFallback: false };
  if (tier === 'medium') return { tier: 'low', useSimpleFallback: false };
  return { tier: null, useSimpleFallback: true };
}
