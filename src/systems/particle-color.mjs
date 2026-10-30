/** Accept a Three.js Color or its supported numeric hex input and guarantee finite RGB. */
export function normalizeParticleColor(input, ColorCtor) {
  let color = input?.isColor ? input : new ColorCtor(Number.isFinite(input) ? input : 0xffffff);
  if (![color.r, color.g, color.b].every(Number.isFinite)) color = new ColorCtor(0xffffff);
  return color;
}
