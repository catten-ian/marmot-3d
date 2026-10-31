// stage2 WebGPU 集成验收：跑任务书第 4 节场景
// 用法: node tools/verify-stage2-webgpu.cjs
// 复用本机已有 headless Chrome CDP 18800（Chrome/147）
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');

const CDP = process.env.CDP_BASE || 'http://127.0.0.1:18800';
const ORIGIN = process.env.SITE_ORIGIN || 'http://127.0.0.1:8247';
const OUT = path.resolve(__dirname, '../outputs/stage2-webgpu');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const getJson = (url) => new Promise((resolve, reject) => {
  http.get(url, (res) => {
    let d = '';
    res.on('data', (c) => { d += c; });
    res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
  }).on('error', reject);
});

async function newTab(url) {
  // Chrome >= 111 需要 PUT 打开新标签
  return new Promise((resolve, reject) => {
    const u = new URL('/json/new?' + encodeURIComponent(url), CDP);
    const req = http.request(u, { method: 'PUT' }, (res) => {
      let d = '';
      res.on('data', (c) => { d += c; });
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
    });
    req.on('error', reject);
    req.end();
  });
}

// 浏览器错误页特征：出现即判失败（防止把错误页当"非空白截图"交差）
const ERROR_PAGE_MARKERS = [
  'ERR_CONNECTION_REFUSED', 'ERR_CONNECTION_RESET', 'ERR_NAME_NOT_RESOLVED',
  'ERR_EMPTY_RESPONSE', 'ERR_INTERNET_DISCONNECTED', 'This site can\'t be reached',
  '无法访问此网站', '拒绝我们的连接请求', '无法访问该网站', 'DNS_PROBE_FINISHED',
];

async function runScenario(name, url, { expectBackend, maxWaitMs = 240000 }) {
  const tab = await newTab('about:blank');
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true });
    ws.addEventListener('error', rej, { once: true });
  });
  let id = 0;
  const pending = new Map();
  const consoleErrors = [];
  const exceptions = [];
  const netFails = [];
  const http4xx = [];

  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const cb = pending.get(m.id);
      pending.delete(m.id);
      if (m.error) cb.reject(new Error(JSON.stringify(m.error)));
      else cb.resolve(m.result);
      return;
    }
    if (m.method === 'Runtime.consoleAPICalled' && (m.params.type === 'error' || m.params.type === 'warning')) {
      consoleErrors.push({
        type: m.params.type,
        text: (m.params.args || []).map((a) => a.value ?? a.description ?? a.type).join(' ').slice(0, 400),
      });
    }
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails || {};
      exceptions.push(String(d.exception?.description || d.text || 'unknown').slice(0, 400));
    }
    if (m.method === 'Network.loadingFailed') {
      netFails.push({ error: m.params.errorText, type: m.params.type });
    }
    if (m.method === 'Network.responseReceived' && m.params.response.status >= 400) {
      http4xx.push({ status: m.params.response.status, url: m.params.response.url.slice(0, 200) });
    }
  });

  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const rid = ++id;
    pending.set(rid, { resolve, reject });
    ws.send(JSON.stringify({ id: rid, method, params }));
    setTimeout(() => { if (pending.has(rid)) { pending.delete(rid); reject(new Error(method + ' timeout')); } }, 30000);
  });
  const evaluate = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description || ''));
    return r.result?.value;
  };

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Network.enable');
  await send('Page.navigate', { url });

  // 活动看门狗式等待：轮询 __game/__boot 就绪，而不是固定 sleep
  const t0 = Date.now();
  let ready = null;
  let errorPage = null;
  while (Date.now() - t0 < maxWaitMs) {
    await wait(2000);
    try {
      ready = await evaluate(`(() => {
        try {
          const g = window.__game;
          const b = window.__boot || {};
          const body = (document.body && document.body.innerText || '').replace(/\\s+/g,' ');
          return {
            hasGame: !!g,
            backend: (g && g.rendererStatus) ? g.rendererStatus().backend : null,
            resBackend: window.__resourceRendererBackend || null,
            gpuOk: b.gpuOk ?? null, gpuReason: b.gpuReason ?? null,
            forceWebGL: b.forceWebGL ?? null,
            gsWorld: b.gsWorld ?? null,
            tier: window.__VERDANT_ACTIVE_TIER__ ?? null,
            isDev: g ? g.isDev : null,
            canvasW: document.querySelector('canvas')?.width || 0,
            canvasH: document.querySelector('canvas')?.height || 0,
            tag: (document.getElementById('backendTag')?.textContent || '').trim().slice(0,80),
            bodyText: body.slice(0, 400),
          };
        } catch (e) { return { err: String(e) }; }
      })()`);
      if (ready && ready.bodyText) {
        const hit = ERROR_PAGE_MARKERS.find((mk) => ready.bodyText.includes(mk));
        if (hit) { errorPage = hit; break; }
      }
      if (ready && ready.hasGame && ready.backend) break;
    } catch (_) { /* 页面还在导航/加载中 */ }
  }

  // 截图
  let shot = null;
  try {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    shot = Buffer.from(r.data, 'base64');
    fs.writeFileSync(path.join(OUT, `${name}.png`), shot);
  } catch (_) { shot = null; }

  // 真正的"非空白"判定：把截图喂回浏览器解码，算像素方差 + 唯一色数
  let pixel = null;
  if (shot) {
    try {
      pixel = await evaluate(`(async () => {
        try {
          const blob = await (await fetch('data:image/png;base64,${shot.toString('base64')}')).blob();
          const bmp = await createImageBitmap(blob);
          const c = new OffscreenCanvas(bmp.width, bmp.height);
          const g = c.getContext('2d');
          g.drawImage(bmp, 0, 0);
          const d = g.getImageData(0, 0, bmp.width, bmp.height).data;
          let n = 0, sum = 0, sum2 = 0;
          const colors = new Set();
          for (let i = 0; i < d.length; i += 4) {
            const lum = 0.2126*d[i] + 0.7152*d[i+1] + 0.0722*d[i+2];
            sum += lum; sum2 += lum*lum; n++;
            if (colors.size < 4096) colors.add((d[i]>>3<<10) | (d[i+1]>>3<<5) | (d[i+2]>>3));
          }
          const mean = sum/n;
          const varr = Math.max(0, sum2/n - mean*mean);
          return { w: bmp.width, h: bmp.height, mean: +mean.toFixed(2), stddev: +Math.sqrt(varr).toFixed(2), uniqueColors: colors.size, samples: n };
        } catch (e) { return { err: String(e) }; }
      })()`);
    } catch (e) { pixel = { err: e.message }; }
  }

  const errs = consoleErrors.filter((c) => c.type === 'error');
  const res = {
    name, url,
    ready: !!ready && !!ready.hasGame, backend: ready?.backend ?? null,
    resBackend: ready?.resBackend ?? null,
    gpuOk: ready?.gpuOk ?? null, gpuReason: ready?.gpuReason ?? null,
    forceWebGL: ready?.forceWebGL ?? null, tier: ready?.tier ?? null,
    isDev: ready?.isDev ?? null,
    canvas: ready ? `${ready.canvasW}x${ready.canvasH}` : null,
    tag: ready?.tag ?? null,
    errorPage,
    bodyText: ready?.bodyText ?? null,
    consoleErrors: errs, consoleWarnings: consoleErrors.filter((c) => c.type === 'warning'),
    exceptions, netFails, http4xx,
    screenshotBytes: shot ? shot.length : 0,
    pixel,
    waitMs: Date.now() - t0,
    expectBackend,
    backendMatch: expectBackend ? (ready?.backend === expectBackend) : null,
  };
  // 判定：错误页 → 失败；未就绪 → 失败；backend 不符 → 失败；
  //       截图必须是真画面（stddev 足够大 = 有内容，不是纯色/黑屏）
  res.pass = !res.errorPage
    && res.ready
    && res.backendMatch === true
    && errs.length === 0
    && exceptions.length === 0
    && !!shot
    && !!pixel && !pixel.err
    && pixel.stddev > 8
    && pixel.uniqueColors > 16;
  ws.close();
  try { http.get(`${CDP}/json/close/${tab.id}`); } catch (_) {}
  return res;
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });

  // 前置：静态服必须活着，否则后面全是假证据
  try {
    const probe = await new Promise((resolve) => {
      http.get(`${ORIGIN}/src/main.js`, (res) => { res.resume(); resolve(res.statusCode); }).on('error', () => resolve(0));
    });
    if (probe !== 200) { console.error(`静态服不可用(${ORIGIN}/src/main.js -> ${probe})，拒绝跑验收`); process.exit(2); }
  } catch (e) { console.error('静态服探测失败:', e.message); process.exit(2); }

  const scenarios = [
    ['dev-low', `${ORIGIN}/?version=dev&verdantTier=low`, 'webgl2-fallback', 300000],
    ['dev-webgl1', `${ORIGIN}/?version=dev&webgl=1`, 'webgl2-fallback', 180000],
    ['stable', `${ORIGIN}/`, 'webgl2', 180000],
  ];
  const out = [];
  for (const [n, u, b, w] of scenarios) {
    process.stdout.write(`>>> ${n} ${u} expect=${b} maxWait=${w / 1000}s\n`);
    try {
      const r = await runScenario(n, u, { expectBackend: b, maxWaitMs: w });
      out.push(r);
      console.log(`    backend=${r.backend} match=${r.backendMatch} | ready=${r.ready} errPage=${r.errorPage || 'no'} | consoleErr=${r.consoleErrors.length} exc=${r.exceptions.length} http4xx=${r.http4xx.length} netFail=${r.netFails.length} | shot=${r.screenshotBytes}B pixel=${r.pixel && !r.pixel.err ? `stddev=${r.pixel.stddev} colors=${r.pixel.uniqueColors}` : 'n/a'} wait=${Math.round(r.waitMs / 1000)}s -> ${r.pass ? 'PASS' : 'FAIL'}`);
      if (r.errorPage) console.log('      !! 浏览器错误页:', r.errorPage, '| body:', (r.bodyText || '').slice(0, 160));
      if (r.consoleErrors.length) console.log('      console:', JSON.stringify(r.consoleErrors.slice(0, 3)));
      if (r.exceptions.length) console.log('      exc:', JSON.stringify(r.exceptions.slice(0, 3)));
      if (r.http4xx.length) console.log('      http4xx:', JSON.stringify(r.http4xx.slice(0, 3)));
      if (r.bodyText) console.log('      body:', r.bodyText.slice(0, 200));
    } catch (e) {
      console.log(`    ERROR ${e.message}`);
      out.push({ name: n, url: u, expectBackend: b, pass: false, error: e.message });
    }
  }
  fs.writeFileSync(path.join(OUT, 'verify-report.json'), JSON.stringify(out, null, 2));
  console.log('\n=== SUMMARY ===');
  for (const r of out) console.log(` ${r.pass ? 'PASS' : 'FAIL'}  ${r.name}  backend=${r.backend ?? 'n/a'} expect=${r.expectBackend} errPage=${r.errorPage || 'no'}`);
  console.log(`report: ${path.join(OUT, 'verify-report.json')}`);
})();
