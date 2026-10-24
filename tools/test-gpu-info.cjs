/** readGpuInfo：后端/GPU/加速判定与 fail-soft（node:test，mock renderer）。 */
const test = require('node:test');
const assert = require('node:assert/strict');

(async () => {
  const { readGpuInfo, isSoftwareRenderer } = await import('../src/core/gpu-info.mjs');

  const fakeGl = (rendererName, { throwOnExt = false } = {}) => ({
    RENDERER: 0x1F01,
    getExtension(name) {
      if (throwOnExt) throw new Error('ext blocked');
      return name === 'WEBGL_debug_renderer_info' ? { UNMASKED_RENDERER_WEBGL: 0x9246 } : null;
    },
    getParameter(p) { return p === 0x9246 ? rendererName : ''; },
  });

  test('经典 WebGLRenderer：读到独显名 → 硬件加速', () => {
    const r = { getContext: () => fakeGl('ANGLE (NVIDIA GeForce RTX 3060)'), capabilities: { isWebGL2: true } };
    const info = readGpuInfo(r);
    assert.equal(info.backend, 'WebGL2');
    assert.equal(info.gpu, 'ANGLE (NVIDIA GeForce RTX 3060)');
    assert.equal(info.acceleration, '硬件加速');
  });

  test('软件渲染识别：SwiftShader / llvmpipe / Basic Render', () => {
    assert.ok(isSoftwareRenderer('SwiftShader'));
    assert.ok(isSoftwareRenderer('llvmpipe (LLVM 15, 256 bits)'));
    assert.ok(isSoftwareRenderer('Microsoft Basic Render Driver'));
    assert.ok(!isSoftwareRenderer('Apple M2'));
    const r = { getContext: () => fakeGl('Google SwiftShader'), capabilities: { isWebGL2: true } };
    assert.equal(readGpuInfo(r).acceleration, '软件渲染');
  });

  test('fail-soft：无 renderer / 扩展抛异常 / 无 context 均不抛错', () => {
    assert.deepEqual(readGpuInfo(null), { backend: '不可用', gpu: '不可用', acceleration: '不可用' });
    const broken = { getContext: () => fakeGl('', { throwOnExt: true }), capabilities: {} };
    const info = readGpuInfo(broken);
    assert.equal(info.gpu, '不可用');
    assert.equal(info.acceleration, '不可用');
    const noCtx = { getContext: () => null };
    assert.equal(readGpuInfo(noCtx).gpu, '不可用');
    const weird = { get getContext() { throw new Error('boom'); } };
    assert.deepEqual(readGpuInfo(weird), { backend: '不可用', gpu: '不可用', acceleration: '不可用' });
  });

  test('WebGPURenderer 家族：按 backend.isWebGPUBackend 区分', () => {
    const gpuR = { backend: { isWebGPUBackend: true, adapter: { info: { vendor: 'apple', architecture: 'metal-3' } } } };
    assert.equal(readGpuInfo(gpuR).backend, 'WebGPU');
    assert.equal(readGpuInfo(gpuR).gpu, 'apple metal-3');
    const fallbackR = { backend: { isWebGPUBackend: false } };
    assert.equal(readGpuInfo(fallbackR).backend, 'WebGL2（WebGPURenderer 兜底）');
  });
})();
