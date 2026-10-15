/** True when touch is the primary interaction mode, not merely supported. */
export function isTouchPrimary() {
  const media = globalThis.matchMedia;
  if (media?.('(pointer: coarse)')?.matches) return true;

  // Hybrid laptops advertise maxTouchPoints too. Keep their normal mouse/Pointer
  // Lock path and desktop quality unless touch is the primary, non-hover input.
  const touches = Number(globalThis.navigator?.maxTouchPoints) > 0;
  const finePointer = !!media?.('(pointer: fine)')?.matches;
  const hover = !!media?.('(hover: hover)')?.matches;
  return touches && !finePointer && !hover;
}

/** Device-aware render budget shared by the stable and GS-world builds. */
export function getRenderProfile() {
  const coarse = isTouchPrimary();
  const dpr = Math.max(1, Number(globalThis.devicePixelRatio) || 1);
  if (!coarse) {
    return {
      mobile: false,
      lowPower: false,
      maxPixelRatio: 2,
      pixelRatio: Math.min(dpr, 2),
      shadows: true,
      shadowMapSize: 2048,
      antialias: true,
    };
  }

  const memory = Number(globalThis.navigator?.deviceMemory) || 4;
  const cores = Number(globalThis.navigator?.hardwareConcurrency) || 4;
  const lowPower = memory <= 4 || cores <= 4;
  const maxPixelRatio = lowPower ? 1 : 1.35;
  return {
    mobile: true,
    lowPower,
    maxPixelRatio,
    pixelRatio: Math.min(dpr, maxPixelRatio),
    // Shadow maps are one of the largest mobile GPU costs in this scene.
    // Keep a reduced map only on higher-capability touch devices.
    shadows: !lowPower,
    shadowMapSize: lowPower ? 512 : 1024,
    antialias: false,
  };
}
