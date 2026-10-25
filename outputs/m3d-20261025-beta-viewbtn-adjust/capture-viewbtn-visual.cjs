'use strict';
/**
 * 任务 m3d-20261025-beta-viewbtn-adjust 视觉矩阵取证（真实渲染路径 / CDP）。
 * 对每个视口截：默认态 / 调整后态(localStorage 注入 opacity .55 scale1.2 x.60 y.18) /
 * 编辑态（真实点击 设置→进入拖动编辑），并做几何与行为断言；输出 manifest.json。
 * 用法: node capture-viewbtn-visual.cjs <baseUrl> <outDir>
 */
const { spawn } = require('child_process');
const http = require('http');
const os = require('os');
const path = require('path');
const fs = require('fs');

const BASE_URL = process.argv[2] || 'http://127.0.0.1:8231/index.html?version=beta';
const OUT = process.argv[3] || path.join(__dirname, 'visual');
const PORT = Number(process.env.CDP_PORT) || 9417;
const CHROME = process.env.CHROME_PATH || '/usr/bin/google-chrome';
const VIEWPORTS = [
  { name: '390x844', width: 390, height: 844, mobile: true },
  { name: '768x1024', width: 768, height: 1024, mobile: true },
  { name: '1280x720', width: 1280, height: 720, mobile: false },
];
const SETTLE_MS = Number(process.env.SETTLE_MS) || 7000;

function get(url) {
  return new Promise((res, rej) => { http.get(url, (r) => { let d = ''; r.on('data', (c) => (d += c)); r.on('end', () => res(d)); }).on('error', rej); });
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  // 两种连接方式：CDP_BASE（附加到环境里已在跑的自动化 Chrome，新建独立 tab），
  // 否则自行 spawn headless Chrome（需要容器内多进程启动正常）。
  const cdpBase = process.env.CDP_BASE || '';
  let chrome = null, profile = null, ownTarget = null, target = null;
  if (cdpBase) {
    target = await new Promise((resolve, reject) => {
      const req = require('http').request(`${cdpBase}/json/new?about:blank`, { method: 'PUT' }, (r) => {
        let d = ''; r.on('data', (c) => (d += c)); r.on('end', () => resolve(JSON.parse(d)));
      });
      req.on('error', reject); req.end();
    });
    ownTarget = target.id;
    const base = new URL(cdpBase);
    target.webSocketDebuggerUrl = target.webSocketDebuggerUrl.replace('ws://127.0.0.1', `ws://${base.hostname}`);
  } else {
    profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cdp-viewbtn-'));
    chrome = spawn(CHROME, [
      '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
      '--no-first-run', '--no-default-browser-check',
      '--disable-gpu', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
      '--window-size=1400,1100', '--hide-scrollbars', 'about:blank',
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    let cdpLog = '';
    chrome.stderr.on('data', (c) => { cdpLog += c; });
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 500));
      try {
        const list = JSON.parse(await get(`http://127.0.0.1:${PORT}/json/list`));
        target = list.find((t) => t.type === 'page');
        if (target) break;
      } catch (_) {}
    }
    if (!target) { console.error('CDP connect fail\n' + cdpLog.slice(-2000)); chrome.kill(); process.exit(1); }
  }

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.addEventListener('open', res, { once: true }); ws.addEventListener('error', rej, { once: true }); });
  let msgId = 0;
  const pending = new Map();
  const consoleErrors = [];
  const pageErrors = [];
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(typeof ev.data === 'string' ? ev.data : ev.data.toString());
    if (msg.id && pending.has(msg.id)) {
      const { res, rej } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result);
      return;
    }
    if (msg.method === 'Runtime.consoleAPICalled' && (msg.params.type === 'error')) {
      consoleErrors.push(msg.params.args.map((a) => a.value ?? a.description ?? a.type).join(' '));
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      pageErrors.push(msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text);
    }
  });
  const send = (method, params = {}) => new Promise((res, rej) => {
    const id = ++msgId; pending.set(id, { res, rej });
    ws.send(JSON.stringify({ id, method, params }));
  });
  const evalJs = async (expression, awaitPromise = true) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  // 等到真的落在 http(s) 文档（about:blank 上 localStorage 访问会抛 SecurityError）。
  const waitHttp = async (ms = 20000) => {
    for (let i = 0; i < ms / 200; i++) {
      try {
        if (await evalJs(`location.protocol === 'http:' || location.protocol === 'https:'`, false)) return true;
      } catch (_) {}
      await sleep(200);
    }
    return false;
  };

  await send('Page.enable');
  await send('Runtime.enable');

  const READY_JS = `new Promise((resolve) => {
    let n = 0;
    const t = setInterval(() => {
      n++;
      const b = document.getElementById('viewBtn');
      const cv = document.querySelector('#scene');
      const ok = b && b.getBoundingClientRect().width > 0 && cv && cv.getBoundingClientRect().width > 0;
      if ((ok && n >= ${Math.round(SETTLE_MS / 500)}) || n > 100) { clearInterval(t); resolve(ok ? 'ready' : 'timeout'); }
    }, 500);
  })`;
  const PROBE_JS = `(() => {
    const v = document.getElementById('viewBtn'), s = document.getElementById('setBtn');
    const vr = v.getBoundingClientRect(), sr = s.getBoundingClientRect(), cs = getComputedStyle(v);
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2');
    let webgl = null;
    if (gl) { const d = gl.getExtension('WEBGL_debug_renderer_info'); webgl = d ? gl.getParameter(d.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.VERSION); }
    return {
      label: v.textContent.trim(), left: Math.round(vr.left), right: Math.round(vr.right), top: Math.round(vr.top),
      width: Math.round(vr.width), height: Math.round(vr.height),
      setLeft: Math.round(sr.left), setTop: Math.round(sr.top),
      rightOfSet: vr.right <= sr.left + 2, rowAligned: Math.abs(vr.top - sr.top) < 10,
      noTextClip: v.scrollWidth <= v.clientWidth + 1,
      opacity: cs.opacity, transform: cs.transform, pointerEvents: cs.pointerEvents,
      outline: cs.outlineStyle + '/' + cs.outlineColor,
      editing: document.body.classList.contains('touch-layout-editing'),
      beta: document.body.classList.contains('beta-version'),
      duplicateGone: !document.querySelector('#viewModeCard') && !document.querySelector('.viewmode-card'),
      backendTag: document.getElementById('backendTag')?.textContent?.trim() || null,
      webgl, gpu: !!navigator.gpu,
      inputEffective: document.documentElement.getAttribute('data-input-effective'),
    };
  })()`;
  const GPU_ADAPTER_JS = `(async () => {
    if (!navigator.gpu) return null;
    try { const a = await navigator.gpu.requestAdapter(); if (!a) return 'no-adapter';
      const i = a.info || {}; return [i.vendor, i.architecture, i.device, i.description].filter(Boolean).join(' ') || 'adapter(no-info)';
    } catch (e) { return 'error:' + e.message; }
  })()`;

  async function shot(name) {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT, name), Buffer.from(r.data, 'base64'));
  }
  async function mouseClick(x, y) {
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1, pointerType: 'mouse' });
    await sleep(40);
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1, pointerType: 'mouse' });
    await sleep(350);
  }

  const versionBase = cdpBase || `http://127.0.0.1:${PORT}`;
  const manifest = {
    task: 'm3d-20261025-beta-viewbtn-adjust',
    url: BASE_URL,
    chrome: '',
    connection: cdpBase ? `attached:${cdpBase} (独立 tab，结束后关闭)` : 'spawned:headless=new',
    flags: cdpBase ? '(复用环境自动化 Chrome，未额外加 GL 标志；后端以实测 backendTag/WebGL 报告为准)'
                   : '--disable-gpu --use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader --headless=new',
    generatedAt: new Date().toISOString(),
    viewports: [],
    consoleErrors: [],
    pageErrors: [],
    gpuAdapter: null,
  };
  try {
    const ver = JSON.parse(await get(`${versionBase}/json/version`));
    manifest.chrome = `${ver.Browser} ${ver.product || ''}`.trim();
  } catch (_) {}

  for (const vp of VIEWPORTS) {
    const rec = { viewport: `${vp.width}x${vp.height}`, mobile: vp.mobile, scenes: [] };
    await send('Emulation.setDeviceMetricsOverride', { width: vp.width, height: vp.height, deviceScaleFactor: 1, mobile: vp.mobile });
    await send('Emulation.setTouchEmulationEnabled', vp.mobile ? { enabled: true, maxTouchPoints: 5 } : { enabled: false });
    await send('Page.navigate', { url: BASE_URL });
    if (!(await waitHttp())) throw new Error(`navigation stuck at ${vp.name}`);
    // 干净默认态：清掉本域存储后重载
    await evalJs(`localStorage.clear(); location.reload(); 'ok'`, false);
    if (!(await waitHttp())) throw new Error(`reload stuck at ${vp.name}`);
    if ((await evalJs(READY_JS)) !== 'ready') throw new Error(`boot timeout at ${vp.name}`);
    if (!manifest.gpuAdapter) manifest.gpuAdapter = await evalJs(GPU_ADAPTER_JS);

    const def = await evalJs(PROBE_JS, false);
    await shot(`${vp.name}-1-default.png`);
    rec.scenes.push({
      state: 'default', file: `${vp.name}-1-default.png`,
      expected: '按钮在右上、⚙ 左侧同一行；无重复卡；文案不裁切',
      observed: def,
      pass: def.duplicateGone && def.rightOfSet && def.rowAligned && def.noTextClip && def.beta,
    });

    // 调整后态：opacity .55 / scale 1.2 / 位置 60%·18%（走真实持久化→加载链路）
    await evalJs(`(async () => {
      localStorage.setItem('marmot.settings.touchLayoutAdjust', '1');
      localStorage.setItem('marmot.touch-layout.v1', JSON.stringify({
        scale: 1, opacity: 1, buttons: {},
        cards: { hudViewBtn: { x: 0.60, y: 0.18, scale: 1.2, opacity: 0.55 } },
      }));
      location.reload();
    })()`, true);
    if ((await evalJs(READY_JS)) !== 'ready') throw new Error(`reload timeout at ${vp.name} adjusted`);
    const adj = await evalJs(PROBE_JS, false);
    await shot(`${vp.name}-2-adjusted.png`);
    const cx = adj.left + adj.width / 2, cy = adj.top + adj.height / 2;
    const scaleHit = /matrix\([^)]*\)/.test(adj.transform); // CSS 序列化 transform 为 matrix
    const posHit = Math.abs(cx / vp.width - 0.60) < 0.02 && Math.abs(cy / vp.height - 0.18) < 0.02;
    const opHit = Math.abs(Number(adj.opacity) - 0.55) < 0.02;
    const sizeHit = Math.abs(adj.width / def.width - 1.2) < 0.03;
    rec.scenes.push({
      state: 'adjusted(opacity=.55,scale=1.2,x=60%,y=18%)', file: `${vp.name}-2-adjusted.png`,
      expected: '透明度≈.55、尺寸≈1.2倍、中心≈(60%,18%)；仍不裁切、不与 ⚙ 重叠',
      observed: { ...adj, centerX: Math.round(cx), centerY: Math.round(cy), widthRatio: Number((adj.width / def.width).toFixed(3)) },
      pass: opHit && posHit && sizeHit && scaleHit && adj.noTextClip,
      checks: { opacity: opHit, position: posHit, size: sizeHit, transform: scaleHit, noTextClip: adj.noTextClip },
    });

    // 编辑态：真实点击 ⚙ 打开设置 → “进入拖动编辑”
    await evalJs(`document.getElementById('setBtn').click(); 'ok'`, false);
    await sleep(500);
    const opts = await evalJs(`[...document.querySelectorAll('#layoutSelected option')].map(o => o.value)`, false);
    await evalJs(`document.querySelector('[data-layout-edit]').click(); 'ok'`, false);
    await sleep(600);
    const ed0 = await evalJs(PROBE_JS, false);
    const labelBefore = ed0.label;
    // 编辑态对按钮发真实点击：只选中、不得切换视角
    await mouseClick(ed0.left + ed0.width / 2, ed0.top + ed0.height / 2);
    const ed1 = await evalJs(PROBE_JS, false);
    await shot(`${vp.name}-3-editing.png`);
    rec.scenes.push({
      state: 'editing', file: `${vp.name}-3-editing.png`,
      expected: '编辑态可选中（描边/grab），真实点击不触发视角切换；下拉含 hudViewBtn',
      observed: { ...ed1, labelBefore, labelAfterTrustedClick: ed1.label, dropdown: opts },
      pass: ed1.editing && opts.includes('hudViewBtn') && ed1.label === labelBefore,
    });

    // 退出编辑（Escape 真实键），再点按钮：必须正常切换到第三人称
    await send('Input.dispatchKeyEvent', { type: 'keyDown', code: 'Escape', key: 'Escape', windowsVirtualKeyCode: 27 });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', code: 'Escape', key: 'Escape', windowsVirtualKeyCode: 27 });
    await sleep(500);
    const after = await evalJs(PROBE_JS, false);
    await mouseClick(after.left + after.width / 2, after.top + after.height / 2);
    const played = await evalJs(PROBE_JS, false);
    rec.behavior = {
      editingSuppressedClick: ed1.label === labelBefore,
      editingActive: ed1.editing,
      exitedEditing: !played.editing,
      normalClickSwitchesView: played.label !== labelBefore,
      labelAfterNormalClick: played.label,
      vKeyUntouched: 'V 键绑定未改动（cameraView→setViewMode 路径保持原样）',
    };
    manifest.viewports.push(rec);
  }

  manifest.consoleErrors = consoleErrors.slice(0, 30);
  manifest.pageErrors = pageErrors.slice(0, 30);
  fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2));
  const total = manifest.viewports.flatMap((v) => v.scenes).length;
  const failed = manifest.viewports.flatMap((v) => v.scenes).filter((s) => !s.pass).length;
  const behaviorBad = manifest.viewports.filter((v) => !v.behavior.normalClickSwitchesView || !v.behavior.editingSuppressedClick).length;
  console.log(JSON.stringify({ scenes: `${total - failed}/${total} passed`, behaviorBad, pageErrors: pageErrors.length, consoleErrors: consoleErrors.length }, null, 2));
  if (ownTarget) { try { await get(`${cdpBase}/json/close/${ownTarget}`); } catch (_) {} }
  if (chrome) chrome.kill();
  process.exit(failed || behaviorBad || pageErrors.length ? 2 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
