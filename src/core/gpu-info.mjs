/**
 * 只读 GPU / 渲染后端信息（设置面板"图形/渲染"区块使用）。
 *
 * 纯函数、不持有浏览器全局：渲染器对象由调用方注入，读取失败一律
 * fail-soft 返回 "不可用"，绝不抛异常阻断游戏或设置面板。
 *
 * 典型用法（main.js）：
 *   settingsUI.setGpuInfoProvider(() => readGpuInfo(renderer));
 */

/** 常见的软件渲染标识：命中即判定为"软件渲染（未硬件加速）"。 */
const SOFTWARE_RENDERER_PATTERN = /swiftshader|llvmpipe|softpipe|software|basic render|microsoft basic/i;

/** 判定 GPU 名称是否属于软件渲染。 */
export function isSoftwareRenderer(rendererName) {
  if (!rendererName || typeof rendererName !== 'string') return false;
  return SOFTWARE_RENDERER_PATTERN.test(rendererName);
}

/**
 * 从渲染器读取后端 / GPU 名 / 加速状态。
 * @param renderer three.js 渲染器（经典 WebGLRenderer 或 WebGPURenderer）
 * @returns {{backend:string, gpu:string, acceleration:string}}
 */
export function readGpuInfo(renderer) {
  const unavailable = { backend: '不可用', gpu: '不可用', acceleration: '不可用' };
  try {
    if (!renderer) return unavailable;
    // WebGPURenderer 家族：backend.isWebGPUBackend 区分真实 WebGPU 与 WebGL2 兜底。
    if (renderer.backend) {
      const isWebGPU = !!renderer.backend.isWebGPUBackend;
      let gpu = '';
      try {
        const info = renderer.backend?.adapter?.info;
        gpu = info ? [info.vendor, info.architecture].filter(Boolean).join(' ') : '';
      } catch (_) { gpu = ''; }
      return {
        backend: isWebGPU ? 'WebGPU' : 'WebGL2（WebGPURenderer 兜底）',
        gpu: gpu || '不可用',
        acceleration: isSoftwareRenderer(gpu) ? '软件渲染' : (isWebGPU ? '硬件加速' : '不可用'),
      };
    }
    // 经典 WebGLRenderer：从 WebGL context 读 WEBGL_debug_renderer_info。
    const gl = typeof renderer.getContext === 'function' ? renderer.getContext() : null;
    if (!gl) return { ...unavailable, backend: 'WebGL' };
    const isWebGL2 = (typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext)
      || renderer.capabilities?.isWebGL2 === true;
    let gpu = '';
    try {
      const ext = gl.getExtension?.('WEBGL_debug_renderer_info');
      if (ext) gpu = gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) || '';
    } catch (_) { gpu = ''; }
    if (!gpu) {
      try { gpu = gl.getParameter?.(gl.RENDERER) || ''; } catch (_) { gpu = ''; }
    }
    return {
      backend: isWebGL2 ? 'WebGL2' : 'WebGL',
      gpu: gpu || '不可用',
      acceleration: gpu ? (isSoftwareRenderer(gpu) ? '软件渲染' : '硬件加速') : '不可用',
    };
  } catch (_) {
    return unavailable;
  }
}
