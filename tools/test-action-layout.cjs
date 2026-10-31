/* CDP regression check for the touch skill wheel. */
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const BASE = process.argv[2] || 'http://127.0.0.1:8600/index.html';
const OUT = path.resolve(__dirname, '..', 'outputs', 'action-layout');
const PORT = 9666;
fs.mkdirSync(OUT, { recursive: true });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const get = (url) => new Promise((resolve, reject) => http.get(url, (r) => { let d = ''; r.on('data', (x) => d += x); r.on('end', () => resolve(d)); }).on('error', reject));
function chromePath() { return process.env.CHROME_PATH || '/usr/bin/google-chrome'; }

(async () => {
  const remotePort = Number(process.env.CDP_PORT) || PORT;
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'marmot-layout-'));
  const chrome = process.env.CDP_PORT ? null : spawn(chromePath(), ['--headless=new', '--no-sandbox', '--disable-gpu', `--remote-debugging-port=${remotePort}`, `--user-data-dir=${profile}`, '--no-first-run', '--enable-unsafe-swiftshader', 'about:blank'], { stdio: 'ignore' });
  let target;
  for (let i = 0; i < 80; i++) { await wait(150); try { target = JSON.parse(await get(`http://127.0.0.1:${remotePort}/json/list`)).find((x) => x.type === 'page'); if (target) break; } catch (_) {} }
  if (!target) throw new Error('Chrome CDP unavailable');
  const ws = new WebSocket(target.webSocketDebuggerUrl); await new Promise((r) => ws.addEventListener('open', r, { once: true }));
  let seq = 0; const pending = new Map(); const errors = [];
  ws.addEventListener('message', (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result); } if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text); });
  const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error(`timeout ${method}`)); } }, 30000); });
  const evaluate = async (expression) => (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result?.value;
  await send('Runtime.enable'); await send('Page.enable'); await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  async function shot(name, width, height, setup = '') {
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: true });
    await send('Page.navigate', { url: BASE }); await wait(1500);
    await evaluate(`(async()=>{ const m=await import('./src/ui/touch-layout.js'); window.__layout = new m.TouchLayout(); document.body.classList.add('touch-playing'); document.getElementById('loader')?.classList.add('gone'); document.getElementById('overlay')?.setAttribute('hidden',''); return true; })()`); await wait(500);
    await evaluate(setup || 'true'); await wait(300);
    const data = await send('Page.captureScreenshot', { format: 'png', fromSurface: true }); fs.writeFileSync(path.join(OUT, `${name}-${width}x${height}.png`), Buffer.from(data.data, 'base64'));
    return evaluate(`(() => { const ids=['attack','jump','sprint','interact','burst','ultimate']; const es=Object.fromEntries(ids.map(id=>[id,document.querySelector('[data-touch-action="'+id+'"]')])); const r=Object.fromEntries(Object.entries(es).map(([id,e])=>{const b=e.getBoundingClientRect();return [id,{x:b.x+b.width/2,y:b.y+b.height/2,w:b.width,h:b.height,right:b.right,bottom:b.bottom}] })); return {rects:r, editing:document.body.classList.contains('touch-layout-editing'), storage:localStorage.getItem('marmot.touch-layout.v1')}; })()`);
  }
  const portrait = await shot('default', 390, 844);
  const landscape = await shot('default', 844, 390);
  const edit = await shot('editing', 390, 844, `window.__layout.setAdjustEnabled(true); document.getElementById('touchLayoutEntry').click(); true`);
  const adjusted = await evaluate(`(() => { window.__layout.layout.buttons.attack.x=.62; window.__layout.layout.buttons.attack.y=.68; window.__layout.layout.scale=1.12; window.__layout.layout.opacity=.72; window.__layout.apply(); window.__layout.save(); return true; })()`);
  const persisted = await evaluate(`(() => { const l=JSON.parse(localStorage.getItem('marmot.touch-layout.v1')); return !!l && l.buttons.attack.x === .62 && l.scale === 1.12; })()`);
  // 同一会话内验证“恢复默认”：先确认已持久化的自定义值存在，再 restoreDefault()，
  // 攻击键应回到默认布局（与 defaultLayout() 用同一视口算得的归一化坐标一致）。
  const restoredDefault = await evaluate(`(() => {
    const L = window.__layout;
    if (!L) return false;
    const before = L.layout.buttons.attack;
    const wasCustomized = Math.abs(before.x - 0.62) < 1e-6;
    L.restoreDefault();
    const fresh = L.defaultLayout().buttons.attack;
    const now = L.layout.buttons.attack;
    const stored = JSON.parse(localStorage.getItem('marmot.touch-layout.v1'));
    const backToDefault = Math.abs(now.x - fresh.x) < 1e-6 && Math.abs(now.y - fresh.y) < 1e-6;
    const storedDefault = Math.abs(stored.buttons.attack.x - fresh.x) < 1e-6;
    return wasCustomized && backToDefault && storedDefault;
  })()`);
  const runtimeErrors = errors.filter((e) => !String(e).includes('THREE.WebGLRenderer: Error creating WebGL context'));
  const report = { portrait, landscape, edit, adjusted, persisted, restored, restoredDefault, errors: runtimeErrors, ignoredEnvironmentErrors: errors.length - runtimeErrors.length, pass: !runtimeErrors.length && portrait.rects.attack.w > portrait.rects.jump.w && portrait.rects.jump.y < portrait.rects.attack.y && portrait.rects.attack.right <= 390 && portrait.rects.attack.bottom <= 844 && landscape.rects.attack.right <= 844 && landscape.rects.attack.bottom <= 390 && edit.editing && adjusted && persisted && restoredDefault };
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2)); chrome?.kill(); if (!report.pass) process.exitCode = 1;
})().catch((e) => { console.error(e); process.exitCode = 1; });
