/**
 * GS 版（WebGPU）冒烟测试。
 *
 * 重点验证：
 *   1. WebGPU 能力检测结果（headless SwiftShader 下大概率不可用 —— 那也要如实报告）
 *   2. WebGPURenderer 能否初始化（WebGL2 兜底是否生效）
 *   3. SPZLoader 能否解析用户的 SPZ v3（这一步与 WebGPU 无关，可独立验证）
 *   4. GaussianSplatMesh 能否构建并算出几何属性
 *   5. 地形 / 散布物 / 控制器能否就绪
 *
 * 用法：node tools/test-gs.cjs
 */
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');

const PORT = 9381;
const URL = 'http://127.0.0.1:8123/gs.html';

function findChrome() {
  for (const c of [
    process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  ].filter(Boolean)) if (fs.existsSync(c)) return c;
  return null;
}
const get = (u) => fetch(u, { headers: { Host: '127.0.0.1' } }).then((r) => r.json());

(async () => {
  const CHROME = findChrome();
  if (!CHROME) { console.log('未找到 Chrome/Edge'); process.exit(1); }
  const profile = path.join(os.tmpdir(), 'marmot-gs-' + Date.now());
  const chrome = spawn(CHROME, [
    '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
    '--no-first-run',
    // 尝试开 WebGPU：需要 SwiftShader/Dawn 的软件后端
    '--enable-unsafe-swiftshader',
    '--enable-features=Vulkan',
    '--use-angle=swiftshader',
    '--disable-gpu-sandbox',
    '--window-size=1280,720', 'about:blank',
  ], { stdio: 'ignore' });

  let t = null;
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 500));
    try { t = (await get(`http://127.0.0.1:${PORT}/json/list`)).find((x) => x.type === 'page'); if (t) break; } catch (e) {}
  }
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  let id = 0; const pend = new Map();
  const logs = []; const errors = [];
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pend.has(m.id)) { const q = pend.get(m.id); pend.delete(m.id); m.error ? q.rej(new Error(JSON.stringify(m.error))) : q.res(m.result); return; }
    if (m.method === 'Runtime.consoleAPICalled') {
      const s = `[${m.params.type}] ` + m.params.args.map((a) => a.value ?? a.description ?? a.type).join(' ');
      if (m.params.type === 'error' || m.params.type === 'warning') logs.push(s);
      else console.log('  ' + s.slice(0, 160));
    }
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails;
      errors.push((d.exception?.description || d.text || '').slice(0, 400));
    }
  });
  const send = (me, pa = {}) => new Promise((res, rej) => {
    const i = ++id; pend.set(i, { res, rej });
    ws.send(JSON.stringify({ id: i, method: me, params: pa }));
    setTimeout(() => { if (pend.has(i)) { pend.delete(i); rej(new Error('timeout ' + me)); } }, 180000);
  });
  const evalJS = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails.exception || r.exceptionDetails.text).slice(0, 500));
    return r.result?.value;
  };

  await new Promise((r) => ws.addEventListener('open', r, { once: true }));
  await send('Runtime.enable'); await send('Page.enable');
  await send('Page.navigate', { url: URL });
  await new Promise((r) => setTimeout(r, 4000));

  console.log('======== 1. WebGPU 能力检测 ========');
  const cap = await evalJS(`(async () => {
    const has = 'gpu' in navigator;
    if (!has) return { hasGPU: false };
    try {
      const a = await navigator.gpu.requestAdapter();
      if (!a) return { hasGPU: true, adapter: null };
      let dev = false;
      try { const d = await a.requestDevice(); dev = !!d; } catch (e) { dev = 'err: ' + e.message; }
      return { hasGPU: true, adapter: {
        vendor: a.info?.vendor, arch: a.info?.architecture,
        device: a.info?.device, desc: a.info?.description }, device: dev };
    } catch (e) { return { hasGPU: true, adapter: 'err: ' + e.message }; }
  })()`);
  console.log('  navigator.gpu 存在: ' + cap.hasGPU);
  if (cap.adapter === null) console.log('  适配器: null（headless 下预期如此）');
  else if (typeof cap.adapter === 'string') console.log('  适配器错误: ' + cap.adapter);
  else console.log('  适配器: ' + JSON.stringify(cap.adapter) + '\n  设备: ' + JSON.stringify(cap.device));

  console.log('\n======== 2. 页面状态 ========');
  // 页面会走能力检测 → 若不支持会显示 gate
  await new Promise((r) => setTimeout(r, 6000));
  const page = await evalJS(`(function(){
    return {
      bootHidden: document.getElementById('boot').classList.contains('hidden'),
      gateHidden: document.getElementById('gate').classList.contains('hidden'),
      menuHidden: document.getElementById('menu').classList.contains('hidden'),
      gateTitle: document.getElementById('gateTitle').textContent,
      bootStep: document.getElementById('bootStep').textContent,
      hasDebug: typeof window.__gs === 'object',
    };
  })()`);
  console.log('  ' + JSON.stringify(page, null, 1).replace(/\n/g, '\n  '));

  console.log('\n======== 3. SPZ 解析（与 WebGPU 无关，可独立验证）========');
  const spz = await evalJS(`(async () => {
    try {
      const { SPZLoader } = await import('/vendor/addons/loaders/SPZLoader.js');
      const t0 = performance.now();
      const geo = await new SPZLoader().loadAsync('/assets/splats/scene.spz');
      const ms = performance.now() - t0;
      const attrs = Object.keys(geo.attributes);
      const pos = geo.attributes.position;
      return {
        ok: true, ms: Math.round(ms),
        count: pos ? pos.count : 0,
        attrs,
        first3: pos ? [pos.getX(0), pos.getY(0), pos.getZ(0)].map(v => +v.toFixed(2)) : null,
        index: geo.index ? geo.index.count : null,
      };
    } catch (e) { return { ok: false, err: String(e && e.message || e) }; }
  })()`);
  if (spz.ok) {
    console.log('  解析成功: ' + spz.count.toLocaleString() + ' 个泼溅 (' + spz.ms + 'ms)');
    console.log('  属性: ' + spz.attrs.join(', '));
    console.log('  索引: ' + spz.index + '   首点: ' + JSON.stringify(spz.first3));
  } else {
    console.log('  解析失败: ' + spz.err);
  }

  console.log('\n======== 4. GaussianSplat 构建 ========');
  const splat = await evalJS(`(async () => {
    try {
      const { SPZLoader } = await import('/vendor/addons/loaders/SPZLoader.js');
      const { GaussianSplat } = await import('/vendor/addons/objects/GaussianSplat.js');
      const geo = await new SPZLoader().loadAsync('/assets/splats/scene.spz');
      const t0 = performance.now();
      const mesh = new GaussianSplat(geo);
      const buildMs = performance.now() - t0;
      return { ok: true, buildMs: Math.round(buildMs),
        isMesh: !!mesh.isMesh, type: mesh.type,
        hasGeo: !!mesh.geometry };
    } catch (e) { return { ok: false, err: String(e && e.stack || e) }; }
  })()`);
  console.log('  ' + (splat.ok
    ? `构建成功 (${splat.buildMs}ms)  isMesh=${splat.isMesh}  type=${splat.type}`
    : '构建失败: ' + splat.err));

  console.log('\n======== 5. WebGPURenderer 初始化 ========');
  const rend = await evalJS(`(async () => {
    try {
      const { WebGPURenderer } = await import('/vendor/three.webgpu.js');
      const c = document.createElement('canvas');
      c.width = 320; c.height = 240;
      const r = new WebGPURenderer({ canvas: c, antialias: false });
      await r.init();
      const backend = r.backend && r.backend.isWebGPUBackend ? 'webgpu' : 'webgl';
      return { ok: true, backend };
    } catch (e) { return { ok: false, err: String(e && e.message || e) }; }
  })()`);
  console.log('  ' + (rend.ok ? '初始化成功，后端 = ' + rend.backend : '初始化失败: ' + rend.err));

  console.log('\n======== 6. 地形 / 散布 / 控制器 ========');
  const world = await evalJS(`(async () => {
    const t0 = performance.now();
    const { buildGround } = await import('/src/gs/terrain.js');
    const { scatterGround } = await import('/src/gs/scatter.js');
    const g = await buildGround({ scale: 9 });
    const tGround = performance.now() - t0;
    const e = g.extent;
    // 采样若干点的高度，验证 heightAt 不返回 NaN
    const probes = [];
    for (let i = 0; i < 40; i++) {
      const x = e.x0 + (e.sx * (i % 8)) / 7;
      const z = e.z0 + (e.sz * Math.floor(i / 8)) / 4;
      probes.push(g.heightAt(x, z));
    }
    const bad = probes.filter(v => !Number.isFinite(v)).length;
    const t1 = performance.now();
    const s = scatterGround({ heightAt: g.heightAt, extent: e, grassCount: 11000, rockCount: 110 });
    const tScatter = performance.now() - t1;
    // 测一次高度采样耗时（每帧要调）
    const t2 = performance.now();
    for (let i = 0; i < 10000; i++) {
      g.heightAt(e.x0 + (i % 100) * 0.5, e.z0 + (i % 73) * 0.7);
    }
    const perSampleUs = (performance.now() - t2) * 1000 / 10000;
    return {
      ok: true, tGround: Math.round(tGround), tScatter: Math.round(tScatter),
      size: [e.size.x, e.size.y, e.size.z].map(v => +v.toFixed(1)),
      badSamples: bad,
      hMin: +Math.min(...probes).toFixed(2),
      hMax: +Math.max(...probes).toFixed(2),
      rocks: s.rocks.length,
      grassTotal: s.group.children[0]?.count,
      perSampleUs: +perSampleUs.toFixed(2),
    };
  })()`);
  console.log('  地形: ' + JSON.stringify(world.size) + '  (' + world.tGround + 'ms)');
  console.log('  高度采样: ' + world.perSampleUs + ' µs/次   无效采样: ' + world.badSamples);
  console.log('  高度范围: ' + world.hMin + ' ~ ' + world.hMax);
  console.log('  散布: 草' + world.grassTotal + ' 株  岩石' + world.rocks + ' 个  (' + world.tScatter + 'ms)');

  console.log('\n控制台 error/warning: ' + logs.length);
  logs.slice(0, 10).forEach((l) => console.log('  ' + l.slice(0, 220)));
  console.log('页面异常: ' + errors.length);
  errors.slice(0, 5).forEach((l) => console.log('  ' + l.slice(0, 300)));

  ws.close(); chrome.kill();
  await new Promise((r) => setTimeout(r, 300));
  process.exit(0);
})();
