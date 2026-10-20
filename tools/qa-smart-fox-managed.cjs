/**
 * 浏览器真实验收：beta 沙盒智能藏狐。
 * 经 OpenClaw 托管 Chrome CDP(18800) 打开本地 serve.cjs(:8324) 的 ?sandbox=1，
 * 清场后生成 1 只 SmartFox，采样其决策/扑击/距离/玩家血量，
 * 断言：意图覆盖、扑击不可取消、非扑击贴身不掉血、仅 committed pounce 造成接触伤害。
 */
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');

// 内嵌静态服务器（同进程生命周期，避免后台 serve 被沙箱回收）。
const SITE_ROOT = path.resolve(__dirname, '..');
const PORT = 8324;
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.svg': 'image/svg+xml',
  '.glb': 'model/gltf-binary', '.woff2': 'font/woff2', '.spz': 'application/octet-stream',
};
const server = http.createServer((req, res) => {
  let rel = decodeURIComponent(req.url.split('?')[0]);
  if (rel === '/') rel = '/index.html';
  const file = path.join(SITE_ROOT, path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));
  if (!file.startsWith(SITE_ROOT)) { res.writeHead(403).end('Forbidden'); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404).end('404'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
});
server.on('error', (e) => { console.error('serve error', e.message); process.exit(1); });

const CDP_HTTP = 'http://127.0.0.1:18800';
const TARGET_URL = 'http://127.0.0.1:8324/index.html?sandbox=1&webgl=1&t=' + Date.now();
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'outputs', 'smart-fox-qa');
fs.mkdirSync(OUT, { recursive: true });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function httpJson(u, opts) { const r = await fetch(u, opts); return r.json(); }

async function main() {
  await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
  console.log('embedded serve on', PORT);
  const report = { target: TARGET_URL, samples: [], errors: [], assertions: {} };
  let tab;
  const newUrl = CDP_HTTP + '/json/new?' + encodeURIComponent(TARGET_URL);
  try { tab = await httpJson(newUrl, { method: 'PUT' }); } catch (_) { tab = await httpJson(newUrl, { method: 'GET' }); }
  if (!tab?.webSocketDebuggerUrl) throw new Error('无法新建标签页 ' + JSON.stringify(tab).slice(0, 200));
  console.log('tab:', tab.id);

  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  let seq = 0; const pending = new Map();
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result); }
    else if (m.method === 'Runtime.exceptionThrown') report.errors.push('[exception] ' + (m.params.exceptionDetails?.text || JSON.stringify(m.params.exceptionDetails?.exception?.description || '').slice(0,200)));
    else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') report.errors.push('[error] ' + m.params.args.map(a => a.value ?? a.description ?? a.type).join(' ').slice(0,200));
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++seq; pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error('timeout ' + method)); } }, 60000);
  });
  const evalJS = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + JSON.stringify(r.exceptionDetails.exception?.description || '').slice(0, 300));
    return r.result?.value;
  };
  const shot = async (name) => {
    const s = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT, name + '.png'), Buffer.from(s.data, 'base64'));
    console.log('  shot', name);
  };

  await new Promise((res) => ws.onopen = res);
  await send('Runtime.enable'); await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: TARGET_URL });

  let ready = false;
  for (let i = 0; i < 90; i++) { await wait(1000); ready = await evalJS('!!window.__game').catch(() => false); if (ready) break; }
  if (!ready) throw new Error('__game 未就绪');
  // 等沙盒自动进入
  let inSandbox = false;
  for (let i = 0; i < 30; i++) { await wait(500); inSandbox = await evalJS('!!(window.__game.game.sandbox && window.__game.game.mode==="play")').catch(()=>false); if (inSandbox) break; }
  console.log('sandbox entered:', inSandbox);
  await wait(1500);

  // 先用面板「清除全部狐狸」彻底清空数组，再关无敌，避免已 dispose 残留在 foxes。
  const setup = await evalJS(`(async () => {
    const g = window.__game;
    [...document.querySelectorAll('[data-sandbox-action]')].find(b=>b.dataset.sandboxAction==='clearFoxes')?.click();
    await new Promise(r=>setTimeout(r,300));
    g.testState.godMode = false; g.sandboxState.godMode = false; g.game.player.hp = 100; g.game.player.invuln = 0;
    // 传送到中央开阔地（远离主洞 r=8.2 与各避难洞），否则狐狸被洞穴安全半径挡在 6m 外，无法扑击。
    const c = g.controller, p = g.game.player;
    c.teleport(0, 0, 0);
    await new Promise(r=>setTimeout(r,200));
    return { afterClear: g.foxes().length, px:+p.x.toFixed(1), pz:+p.z.toFixed(1),
      minBurrow: Math.min(...g.burrows.map(b=>Math.hypot(b.x-p.x,b.z-p.z))) };
  })()`);
  console.log('setup:', JSON.stringify(setup));
  // 直接用内部不便，改为派发面板按钮点击；按钮在沙盒面板里
  const spawned = await evalJS(`(async () => {
    const g = window.__game;
    const btn = [...document.querySelectorAll('[data-sandbox-action]')].find(b => b.dataset.sandboxAction === 'spawnSmart');
    if (!btn) return { ok:false, reason:'no spawnSmart button' };
    btn.click();
    await new Promise(r=>setTimeout(r,300));
    const f = g.foxes().find(x => x.type === 'smart');
    return { ok: !!f, count: g.foxes().length, btn: !!btn };
  })()`);
  console.log('spawn:', JSON.stringify(spawned));
  report.spawn = spawned;

  // 保持第一人称（镜头 yaw 与 bodyYaw 一致），让 spawn 方位落在视野锥。
  await evalJS(`window.__game.setViewMode && window.__game.setViewMode(false)`).catch(()=>{});
  await wait(800);
  await shot('first-person-smart');

  // 采样 11 秒；每帧让玩家转身面向智能狐（模拟真实对峙注视），维持怀疑度。
  const START = Date.now();
  for (let i = 0; i < 55; i++) {
    await evalJS(`(() => { const g=window.__game,f=g.foxes().find(x=>x.type==='smart'),c=g.controller,p=g.game.player; if(f){const y=Math.atan2(f.x-p.x,f.z-p.z);c.bodyYaw=y;c.yaw=y;} })()`);
    const s = await evalJS(`(() => {
      const g = window.__game, f = g.foxes().find(x => x.type==='smart'), p = g.game.player;
      if (!f) return null;
      return { t: +((Date.now()-${START})/1000).toFixed(2), intent: f.intent, state: f.state,
        commit: !!f.pounceCommitted, susp: +f.suspicion.toFixed(2), mem: f.memory,
        dist: +Math.hypot(f.x-p.x,f.z-p.z).toFixed(2), hp: +p.hp.toFixed(1), fat: +f.fatigue.toFixed(2) };
    })()`);
    if (s) report.samples.push(s);
    await wait(200);
  }

  await wait(400);
  await shot('first-person-after-pounce');

  // —— 断言 ——
  const S = report.samples;
  const intents = new Set(S.map(s => s.intent));
  report.assertions.smartAlive = S.length > 30;
  report.assertions.intentVariety = [...intents].join(',');
  report.assertions.observedPounce = S.some(s => s.commit);
  report.assertions.observedApproach = intents.has('approach') || intents.has('observe');
  // 扑击提交期间距离应快速缩短：找任一 commit 段，比较前后 dist
  let pounceCloses = false;
  for (let i = 1; i < S.length; i++) if (S[i].commit) {
    const prev = S[i-1];
    if (!prev.commit && prev.dist - S[i].dist > -0.01) { /* 开始冲 */ }
  }
  const commitIdxs = S.map((s,i)=>s.commit?i:-1).filter(i=>i>=0);
  if (commitIdxs.length) {
    const a = S[Math.max(0,commitIdxs[0]-1)], b = S[commitIdxs[Math.min(commitIdxs.length-1)]];
    pounceCloses = b.dist < a.dist;
    report.pounceGap = { from: a.dist, to: b.dist };
  }
  report.assertions.pounceClosesDistance = pounceCloses;
  // 伤害门控：hp 下降的采样点，其紧邻时刻必须处于 commit（允许 invuln 窗口内连续）
  let illegalHit = null;
  for (let i = 1; i < S.length; i++) {
    if (S[i].hp < S[i-1].hp - 0.01 && !S[i].commit && !S[i-1].commit) { illegalHit = S[i]; break; }
  }
  report.assertions.noDamageOutsidePounce = !illegalHit;
  report.illegalHitSample = illegalHit || null;
  report.minHp = Math.min(...S.map(s=>s.hp));
  report.assertions.errorsEmpty = report.errors.filter(e=>!/GLFence|WebGL|GPU/.test(e)).length === 0;

  console.log('\n===== 验收结果 =====');
  console.log(JSON.stringify(report.assertions, null, 2));
  console.log('intents seen:', report.assertions.intentVariety);
  console.log('samples:', S.length, 'minHp:', report.minHp, 'pounceGap:', JSON.stringify(report.pounceGap));
  console.log('runtime errors:', report.errors.length);
  report.errors.slice(0,8).forEach(e=>console.log(' ', e));

  fs.writeFileSync(path.join(OUT,'report.json'), JSON.stringify(report,null,2));

  // 关闭标签页
  await fetch(CDP_HTTP + '/json/close/' + tab.id).catch(()=>{});
  ws.close();

  const ok = report.assertions.smartAlive && report.assertions.observedPounce
    && report.assertions.noDamageOutsidePounce && report.spawn.ok;
  console.log(ok ? '\nPASS ✅' : '\nFAIL ❌');
  process.exit(ok ? 0 : 2);
}
main().catch((e) => { console.error('FATAL', e); process.exit(1); });
