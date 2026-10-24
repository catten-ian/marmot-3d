/** Dev-only Verdant quality budgets. Stable/beta do not import this module. */
export const DEV_QUALITY_TIERS = Object.freeze({
  low: Object.freeze({ id: 'low', pixelRatio: 0.75, anisotropy: 1, normalMaps: false, maxFaces: 200000 }),
  medium: Object.freeze({ id: 'medium', pixelRatio: 1.0, anisotropy: 2, normalMaps: true, maxFaces: 500000 }),
  high: Object.freeze({ id: 'high', pixelRatio: 1.35, anisotropy: 4, normalMaps: true, maxFaces: 900000 }),
  ultra: Object.freeze({ id: 'ultra', pixelRatio: 1.75, anisotropy: 8, normalMaps: true, maxFaces: Infinity }),
});
export function devQualityProfile(tier = 'medium') {
  return DEV_QUALITY_TIERS[tier] || DEV_QUALITY_TIERS.medium;
}
export function devQualityRatios() {
  return ['low', 'medium', 'high', 'ultra'].map((id) => devQualityProfile(id).pixelRatio);
}
