/**
 * 渲染器工厂：WebGPU 优先，WebGL2 自动降级。
 *
 * 为什么需要双路径（用户方案）：
 *   dev 版要用高斯泼溅做**全部场景**，而 three.js 的 `GaussianSplat`
 *   只能挂在 `WebGPURenderer` 下（经典 WebGLRenderer 完全不支持）。
 *   但 WebGPU 并非所有浏览器都有（老 Chrome、远程桌面、无独显机器），
 *   所以必须能在 WebGL2 后端下继续跑 —— WebGPURenderer 本身支持
 *   WebGL2 兜底，只是 GS 的 GPU 深度排序会退到 CPU（帧率下降，画面一致）。
 *
 * 关键：绝不能让「跑在 WebGL2 兜底上」被当成「跑在 WebGPU 上」。
 * 返回的 backend 字段必须如实上报，HUD 也要显示它。
 */

import { getRenderProfile } from './performance.js';

let cached = null;

/** 检测 WebGPU 是否真正可用（适配器 + 设备都能建起来） */
export async function probeWebGPU({ retainDevice = false, signal = null } = {}) {
  if (typeof navigator === 'undefined' || !('gpu' in navigator)) {
    return { ok: false, reason: '浏览器未提供 navigator.gpu' };
  }
  try {
    if (signal?.aborted) throw new DOMException('WebGPU 探测已取消', 'AbortError');
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (signal?.aborted) throw new DOMException('WebGPU 探测已取消', 'AbortError');
    if (!adapter) return { ok: false, reason: '没有可用的 GPU 适配器（可能无独显/驱动被禁用）' };
    const device = await adapter.requestDevice();
    if (signal?.aborted) { device?.destroy?.(); throw new DOMException('WebGPU 探测已取消', 'AbortError'); }
    if (!device) return { ok: false, reason: '无法创建 GPU 设备' };
    if (!retainDevice) device.destroy?.();
    return { ok: true, adapter, device: retainDevice ? device : null };
  } catch (e) {
    if (e?.name === 'AbortError') return { ok: false, reason: e.message || 'WebGPU 探测已取消' };
    return { ok: false, reason: 'WebGPU 初始化异常：' + (e && e.message || e) };
  }
}

/**
 * 创建渲染器。
 *
 * @param canvas
 * @param opts.preferWebGPU  是否尝试 WebGPU（GS 场景必须为 true）
 * @param opts.forceWebGL    调试用：强制 WebGL2 路径（URL ?webgl=1）
 * @param opts.onStatus       状态回调，用于 UI 告知实际用了哪个后端
 */
export async function createRenderer(canvas, {
  preferWebGPU = true,
  forceWebGL = false,
  onStatus = null,
  // dev 真机自动化用 headless CDP 截图：需要可读 backbuffer。
  preserveDrawingBuffer = false,
  antialias = false,
  webgpuProbe = null,
  initTimeoutMs = 10000,
} = {}) {
  const status = {
    backend: 'webgl',      // 'webgpu' | 'webgl2-fallback' | 'webgl'
    gpuAvailable: false,
    gpuReason: '',
    degraded: false,
    supportsSplat: false,
  };

  const wantGPU = preferWebGPU && !forceWebGL;
  const withDeadline = (promise, label) => {
    let timer;
    const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} 超时（${initTimeoutMs}ms）`)), initTimeoutMs); });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
  };

  if (wantGPU) {
    const gpu = webgpuProbe?.ok ? webgpuProbe : await withDeadline(probeWebGPU({ retainDevice: true }), 'WebGPU 探测').catch((error) => ({ ok: false, reason: error?.message || String(error) }));
    status.gpuAvailable = gpu.ok;
    status.gpuReason = gpu.reason || '';
    if (gpu.ok) {
      let r = null;
      try {
        const THREE = await import('three/webgpu');
        r = new THREE.WebGPURenderer({
          canvas,
          antialias,     // GS 是软边叠加，MSAA 对它无益；Verdant 由调用方传 true
          alpha: false,
          powerPreference: 'high-performance',
          preserveDrawingBuffer,
          ...(gpu.device ? { device: gpu.device } : {}),
        });
        await withDeadline(r.init(), 'WebGPURenderer 初始化');
        // init 之后才知道真实后端（可能内部又退回了 WebGL2）
        status.backend = (r.backend && r.backend.isWebGPUBackend) ? 'webgpu' : 'webgl2-fallback';
        status.supportsSplat = true;
        if (status.backend !== 'webgpu') {
          status.degraded = true;
          status.gpuReason = 'WebGPURenderer 初始化后退到了 WebGL2 后端（深度排序改用 CPU，帧率会下降）';
        }
        applyCommon(r, THREE, getRenderProfile());
        if (onStatus) onStatus(status);
        cached = status;
        return { renderer: r, THREE, status };
      } catch (e) {
        try { r?.dispose?.(); } catch (_) {}
        try { if (gpu.device) gpu.device.destroy?.(); } catch (_) {}
        status.gpuReason = 'WebGPURenderer 创建失败：' + (e && e.message || e);
        status.degraded = true;
        console.warn('[renderer] WebGPU 路径失败，降级到 WebGL:', e);
      }
    } else {
      status.degraded = true;
    }
  }

  // GaussianSplat 需要 WebGPURenderer 家族，即使底层使用 WebGL2。
  // 不能改用经典 WebGLRenderer，否则 GS 场景会静默缺失。
  if (preferWebGPU) {
    let r = null;
    try {
      const THREE = await import('three/webgpu');
      r = new THREE.WebGPURenderer({
        canvas,
        antialias,
        alpha: false,
        powerPreference: 'high-performance',
        forceWebGL: true,
        preserveDrawingBuffer,
      });
      await withDeadline(r.init(), 'WebGL2 兼容后端初始化');
      status.backend = 'webgl2-fallback';
      status.degraded = true;
      status.supportsSplat = true;
      status.gpuReason = forceWebGL
        ? '按调试参数强制使用 WebGL2 后端，深度排序改用 CPU'
        : status.gpuReason || '使用 WebGL2 后备，深度排序改用 CPU';
      applyCommon(r, THREE, getRenderProfile());
      if (onStatus) onStatus(status);
      cached = status;
      return { renderer: r, THREE, status };
    } catch (e) {
      try { r?.dispose?.(); } catch (_) {}
      status.gpuReason = `${status.gpuReason || 'WebGPURenderer WebGL2 兜底失败'}；${e && e.message || e}`;
      status.degraded = true;
      console.warn('[renderer] WebGPURenderer WebGL2 兜底失败，改用经典 WebGLRenderer:', e);
    }
  }

  const THREE = await import('three');
  const r = new THREE.WebGLRenderer({
    canvas,
    antialias: antialias || true,
    powerPreference: 'high-performance',
    stencil: false,
    preserveDrawingBuffer,
  });
  status.backend = 'webgl';
  status.supportsSplat = false;
  applyCommon(r, THREE, getRenderProfile());
  if (onStatus) onStatus(status);
  cached = status;
  return { renderer: r, THREE, status };
}

/**
 * 两类渲染器共有的设置。
 * THREE 必须显式传入 —— WebGPU 与经典入口是两个不同的模块实例，
 * 常量（SRGBColorSpace 等）不能跨入口混用。
 */
function applyCommon(r, THREE, profile = getRenderProfile()) {
  r.setPixelRatio(profile.pixelRatio);
  r.setSize(window.innerWidth, window.innerHeight, false);
  r.outputColorSpace = THREE.SRGBColorSpace;
  r.toneMapping = THREE.ACESFilmicToneMapping;
  // 曝光过高会把草地照成一片死白；0.92 能保留高光又不过曝
  r.toneMappingExposure = 0.92;
  if ('shadowMap' in r) {
    r.shadowMap.enabled = profile.shadows;
    r.shadowMap.type = THREE.PCFShadowMap;
  }
}

/** 上次创建的渲染器状态（供 HUD 查询） */
export function lastStatus() { return cached; }

/**
 * GS 场景是否可用。
 * 规则：必须拿到 WebGPURenderer 家族的对象，且实际后端是 webgpu
 * 或 webgl2-fallback（两者都能渲染 GS）。
 */
export function splatUsable(result) {
  if (!result) return false;
  if (result.supportsSplat === false) return false;
  return result.status.backend === 'webgpu' || result.status.backend === 'webgl2-fallback';
}
