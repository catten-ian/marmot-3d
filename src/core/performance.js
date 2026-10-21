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

/** Runtime quality controller with a sliding frame-time window and hysteresis.
 * One isolated long frame is never enough to change quality: degradation needs
 * a sustained slow window and recovery needs a longer sustained fast window.
 */
export class AdaptiveRenderController {
  constructor({
    windowMs = 3000,
    degradeAfterMs = 4000,
    recoverAfterMs = 8000,
    changeCooldownMs = 6000,
    maxTier = 3,
  } = {}) {
    this.windowMs = windowMs;
    this.degradeAfterMs = degradeAfterMs;
    this.recoverAfterMs = recoverAfterMs;
    this.changeCooldownMs = changeCooldownMs;
    this.maxTier = maxTier;
    // Fixed typed-array ring: the per-frame path does not build arrays/objects or
    // sort. Window statistics are refreshed twice a second, off the hot path.
    this.capacity = 2048;
    this.times = new Float64Array(this.capacity);
    this.frames = new Float32Array(this.capacity);
    this.scratch = new Array(this.capacity);
    this.reset();
  }

  reset() {
    this.writeIndex = 0;
    this.sampleCount = 0;
    this.lastStatsAt = -Infinity;
    this.tier = 0;
    this.slowMs = 0;
    this.fastMs = 0;
    this.lastChangeAt = -Infinity;
    this.windowReady = false;
    this.slow = false;
    this.fast = false;
    this.lastStats = { averageMs: null, p95Ms: null, sampleCount: 0 };
  }

  /** Feed an uncapped rAF interval in milliseconds. Returns a transition or null. */
  sample(frameMs, nowMs) {
    if (!Number.isFinite(frameMs) || frameMs <= 0 || !Number.isFinite(nowMs)) return null;
    // Ignore suspended-tab / debugger pauses; they are not sustained render pressure.
    if (frameMs > 250) return null;

    const slot = this.writeIndex;
    this.times[slot] = nowMs;
    this.frames[slot] = frameMs;
    this.writeIndex = (slot + 1) % this.capacity;
    this.sampleCount = Math.min(this.sampleCount + 1, this.capacity);

    if (nowMs - this.lastStatsAt >= 500) {
      this.lastStatsAt = nowMs;
      const cutoff = nowMs - this.windowMs;
      const first = (this.writeIndex - this.sampleCount + this.capacity) % this.capacity;
      let count = 0;
      let total = 0;
      let oldestAt = Infinity;
      for (let i = 0; i < this.sampleCount; i++) {
        const index = (first + i) % this.capacity;
        const at = this.times[index];
        if (at < cutoff || at > nowMs) continue;
        const value = this.frames[index];
        this.scratch[count++] = value;
        total += value;
        if (at < oldestAt) oldestAt = at;
      }
      this.windowReady = count >= 20 && nowMs - oldestAt >= this.windowMs * 0.8;
      if (this.windowReady) {
        this.scratch.length = count;
        this.scratch.sort((a, b) => a - b);
        const averageMs = total / count;
        const p95Ms = this.scratch[Math.min(count - 1, Math.floor(count * 0.95))];
        this.lastStats.averageMs = averageMs;
        this.lastStats.p95Ms = p95Ms;
        this.lastStats.sampleCount = count;
        this.slow = averageMs >= 20.5 || p95Ms >= 24;
        this.fast = averageMs <= 17.5 && p95Ms <= 20.5;
        this.scratch.length = this.capacity;
      }
    }

    if (!this.windowReady) return null;
    const elapsed = Math.max(0, Math.min(frameMs, 100));
    this.slowMs = this.slow ? this.slowMs + elapsed : 0;
    this.fastMs = this.fast ? this.fastMs + elapsed : 0;
    if (nowMs - this.lastChangeAt < this.changeCooldownMs) return null;

    const from = this.tier;
    let reason;
    if (this.slow && this.slowMs >= this.degradeAfterMs && this.tier < this.maxTier) {
      this.tier++;
      reason = 'sustained-slow';
    } else if (this.fast && this.fastMs >= this.recoverAfterMs && this.tier > 0) {
      this.tier--;
      reason = 'sustained-recovery';
    } else {
      return null;
    }

    this.lastChangeAt = nowMs;
    this.slowMs = 0;
    this.fastMs = 0;
    return { from, to: this.tier, reason, ...this.lastStats };
  }

  /** Apply a dynamic budget without mutating getRenderProfile's static budget. */
  apply(baseProfile) {
    const profile = { ...baseProfile, qualityTier: this.tier };
    if (this.tier >= 1) profile.pixelRatio = Math.max(0.75, +(baseProfile.pixelRatio * 0.85).toFixed(2));
    if (this.tier >= 2) profile.shadowMapSize = Math.max(512, Math.floor(baseProfile.shadowMapSize / 2));
    if (this.tier >= 3) profile.shadows = false;
    profile.adaptive = {
      tier: this.tier,
      label: ['native', 'resolution-85%', 'lower-shadow-map', 'shadows-off'][this.tier] || `tier-${this.tier}`,
      basePixelRatio: baseProfile.pixelRatio,
      baseShadowMapSize: baseProfile.shadowMapSize,
      averageFrameMs: this.lastStats.averageMs == null ? null : +this.lastStats.averageMs.toFixed(2),
      p95FrameMs: this.lastStats.p95Ms == null ? null : +this.lastStats.p95Ms.toFixed(2),
    };
    return profile;
  }

  snapshot() {
    return {
      tier: this.tier,
      label: ['native', 'resolution-85%', 'lower-shadow-map', 'shadows-off'][this.tier] || `tier-${this.tier}`,
      slowMs: Math.round(this.slowMs),
      fastMs: Math.round(this.fastMs),
      ...this.lastStats,
    };
  }
}
