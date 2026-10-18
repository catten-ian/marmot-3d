/** True when touch is the primary interaction mode, not merely supported. */
export function isTouchPrimary() {
  const media = globalThis.matchMedia;
  if (media?.('(pointer: coarse)')?.matches) return true;

  // Hybrid laptops advertise maxTouchPoints too. Keep their normal mouse/Pointer
  // Lock path and desktop quality unless touch is the primary, non-hover input.
  const touches = Number(globalThis.navigator?.maxTouchPoints) > 0;
  const finePointer = !!media?.('(pointer: fine)')?.matches;
  const hover = !!media?.('(hover: hover)')?.matches;
  if (touches && !finePointer && !hover) return true;

  // 兜底：部分安卓 WebView / 微信 / QQ(X5/TBS) 内置浏览器会谎报 pointer:fine，
  // 导致媒体查询判定为非触屏。只要设备支持触摸且 UA 表明是手机/平板，就按触屏处理。
  const ua = String(globalThis.navigator?.userAgentData?.mobile
    ? 'Mobile' : (globalThis.navigator?.userAgent || ''));
  const isMobileUA = /Android|iPhone|iPod|iPad|HarmonyOS|Mobile|MicroMessenger|MQQBrowser|TBS\/|X5\//i.test(ua)
    || (navigator.userAgentData && navigator.userAgentData.mobile === true);
  if (touches && isMobileUA) return true;
  return false;
}

/** 运行时一旦收到真实手指触摸（含谎报媒体能力的内置浏览器），可据此动态激活触控层。 */
export function hasRealTouch() {
  return Number(globalThis.navigator?.maxTouchPoints) > 0
    || 'ontouchstart' in globalThis;
}

/** Device-aware render budget shared by the stable and GS-world builds.
 * touchOverride：设置里强制输入模式时传入有效模式（true=触屏预算），
 * 省略时保持原有 isTouchPrimary() 静态检测。 */
export function getRenderProfile(touchOverride) {
  const coarse = typeof touchOverride === 'boolean' ? touchOverride : isTouchPrimary();
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
