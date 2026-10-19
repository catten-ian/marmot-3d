/**
 * WebGPU 高斯泼溅版 —— 能力检测与渲染器引导。
 *
 * 为什么要单独一版：
 *   three.js 的 `GaussianSplat` **只能用 WebGPURenderer**（WebGL2 兜底可以，
 *   经典 WebGLRenderer 不行）。而主版本跑在 WebGL 上，两者渲染路径、
 *   依赖模块、色彩管理都不一样，混在一起会互相拖累。
 *   所以这里是完全独立的一套：`gs.html` + `src/gs/`。
 *
 * 依赖（已本地化到 vendor/）：
 *   three.webgpu.js  ← WebGPURenderer / GaussianSplat 的基类
 *   three.tsl.js     ← TSL 节点（GaussianSplat 内部大量使用）
 *   addons/objects/GaussianSplat.js
 *   addons/loaders/SPZLoader.js     原生支持 SPZ v1~v3
 *   addons/gpgpu/CountingSort.js    GPU 深度排序
 *   addons/libs/{fflate,zstddec}    SPZ 解压
 */

import { adapterPowerPreference, readGraphicsPreference } from '../core/graphics-preference.js';

/**
 * 检测 WebGPU 可用性。返回 { ok, adapter, reason, info }
 *
 * 调试开关：URL 加 `?webgl=1` 可跳过 WebGPU 检测，强制走 WebGL2 后端。
 * 这样在无 GPU 的环境（CI、headless、无独显的机器）下也能验证
 * 场景组装与视觉是否正确 —— 只是渲染路径不同、深度排序退回 CPU。
 */
export function forceWebGL() {
  return new URLSearchParams(location.search).get('webgl') === '1';
}

export async function detectWebGPU(graphicsPreference = readGraphicsPreference()) {
  const info = [];
  if (typeof navigator === 'undefined' || !('gpu' in navigator)) {
    return {
      ok: false,
      reason: 'navigator.gpu 不存在',
      info: [
        '当前浏览器没有暴露 navigator.gpu。',
        '',
        '需要：Chrome / Edge 113+，或其他实现了 WebGPU 的浏览器。',
        '注意：WebGPU 在部分环境（如部分 Firefox 版本、',
        '开启了某些兼容模式的浏览器）下不可用。',
      ].join('\n'),
    };
  }

  let adapter = null;
  try {
    adapter = await navigator.gpu.requestAdapter({ powerPreference: adapterPowerPreference(graphicsPreference) });
  } catch (e) {
    return {
      ok: false,
      reason: 'requestAdapter 抛错：' + (e && e.message ? e.message : e),
      info: '请求 GPU 适配器时发生异常。可能是驱动被屏蔽，或运行在无 GPU 的沙箱里。',
    };
  }

  if (!adapter) {
    return {
      ok: false,
      reason: 'requestAdapter 返回 null',
      info: [
        '浏览器支持 WebGPU，但没有可用的适配器。',
        '',
        '常见原因：',
        '· 运行在无 GPU 的虚拟机 / 远程桌面中',
        '· 显卡驱动过旧，或被列入软件渲染黑名单',
        '· 浏览器开启了「禁用硬件加速」',
      ].join('\n'),
    };
  }

  // 设备能否真正建立（适配器存在 ≠ 设备可用）
  try {
    const device = await adapter.requestDevice();
    info.push('适配器: ' + (adapter.info?.description || adapter.info?.vendor || '未知'));
    if (adapter.info) {
      if (adapter.info.vendor) info.push('厂商: ' + adapter.info.vendor);
      if (adapter.info.architecture) info.push('架构: ' + adapter.info.architecture);
      if (adapter.info.device) info.push('设备: ' + adapter.info.device);
    }
    info.push('最大纹理尺寸: ' + device.limits.maxTextureDimension2D);
    info.push('最大缓冲: ' + device.limits.maxBufferSize);
    info.push('最大存储缓冲绑定: ' + device.limits.maxStorageBuffersPerShaderStage);
    // 只需要能建立设备即可，后续细节仅作展示
    device.destroy?.();
  } catch (e) {
    return {
      ok: false,
      reason: 'requestDevice 失败：' + (e && e.message ? e.message : e),
      info: '适配器存在但无法创建设备，可能是驱动不完整。',
    };
  }

  return { ok: true, adapter, info: info.join('\n'), graphicsPreference, adapterPowerPreference: adapterPowerPreference(graphicsPreference), adapterInfo: adapter.info || null };
}

/**
 * 创建 WebGPURenderer。
 *
 * 注意：WebGPURenderer 在没有 WebGPU 时会自动退到 WebGL2 后端，
 * 而 GaussianSplat 在 WebGL2 后端下是**能跑**的（只是深度排序退回
 * CPU），但性能与效果都差很多 —— 所以默认 `forceWebGL: false`，
 * 让 WebGPU 不可用时由调用方提前拦截，而不是悄悄降级。
 */
export async function createRenderer(canvas, { forceWebGL = false, graphicsPreference = readGraphicsPreference() } = {}) {
  const { WebGPURenderer } = await import('three/webgpu');
  const renderer = new WebGPURenderer({
    canvas,
    antialias: false,      // GS 本身是软边叠加，MSAA 反而浪费
    alpha: false,
    powerPreference: adapterPowerPreference(graphicsPreference),
    // forceWebGL: 无 WebGPU 时显式退到 WebGL2 后端（GS 仍可渲染，只是慢）
    forceWebGL,
  });
  // WebGPU 后端下必须先 await init()，否则首帧会拿到未初始化的管线
  await renderer.init();
  return renderer;
}

/**
 * 判断当前 renderer 实际用的是哪个后端。
 * 返回 'webgpu' | 'webgl' —— 用于在 HUD 上如实告知用户，
 * 不能让「跑在 WebGL 兜底上」被误认为「跑在 WebGPU 上」。
 */
export function backendOf(renderer) {
  const b = renderer.backend && renderer.backend.isWebGPUBackend;
  return b ? 'webgpu' : 'webgl';
}
