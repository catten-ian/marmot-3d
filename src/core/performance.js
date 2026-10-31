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
  if (isMobileUA) return true;
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
  // Preserve the requested display density and the complete animated scene.
  // Device emulation must not manufacture FPS by changing DPR or shadows.
  return { mobile: coarse, lowPower: false, maxPixelRatio: dpr, pixelRatio: dpr, shadows: true, shadowMapSize: 2048, antialias: true };
}

/** Dev Verdant 档位保护：移动端禁止 high/ultra；低内存或无 WebGPU 时收敛到可行档。
 * 纯函数，便于 Node 测试；stable/beta 不调用。
 */
export function clampVerdantTierForDevice(preference, {
  mobile = false,
  backend = 'webgl2',
  deviceMemory = 4,
  hardwareConcurrency = 4,
} = {}) {
  const requested = ['auto', 'low', 'medium', 'high', 'ultra'].includes(preference) ? preference : 'auto';
  const mem = Number(deviceMemory) || 4;
  const cores = Number(hardwareConcurrency) || 4;
  if (mobile) {
    if (requested === 'high' || requested === 'ultra') return 'low';
    if (requested === 'medium' && (mem <= 4 || cores <= 4 || backend !== 'webgpu')) return 'low';
  }
  if (backend !== 'webgpu' && requested === 'ultra') return mobile ? 'low' : 'high';
  if (mem <= 2 || cores <= 2) return 'low';
  return requested;
}
