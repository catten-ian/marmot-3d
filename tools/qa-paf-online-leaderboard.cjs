const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'outputs', 'm3d-20261103-beta-paf-online-leaderboard-v2');
const CDP_PORT = Number(process.env.PAF_ONLINE_QA_CDP_PORT || 9531);
const CHROME = process.env.CHROME_PATH || '/usr/bin/google-chrome';
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.glb': 'model/gltf-binary', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.mp3': 'audio/mpeg', '.woff2': 'font/woff2' };
fs.mkdirSync(OUT, { recursive: true });

const report = { startedAt: new Date().toISOString(), checks: {}, scenarios: {}, screenshots: [], network: [], consoleErrors: [], exceptions: [] };
let accounts; let gateway; let chrome; let ws; let send; let profile; let dataDir; let accountPort; let gatewayPort;
const save = () => fs.writeFileSync(path.join(OUT, 'qa-results.json'), JSON.stringify(report, null, 2));
function check(name, value, detail = '') {
  report.checks[name] = { pass: !!value, detail };
  if (!value) throw new Error(`${name}: ${detail}`);
}
async function listen(server, port = 0) {
  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
  return server.address().port;
}
async function close(server) {
  if (!server?.listening) return;
  const closed = new Promise((resolve) => server.close(resolve));
  server.closeAllConnections?.();
  await closed;
}
async function evalJs(expression) {
  const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, timeout: 55000 });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'Runtime.evaluate failed');
  return result.result.value;
}
async function waitFor(expression, timeout = 20000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { if (await evalJs(expression).catch(() => false)) return true; await wait(200); }
  return false;
}
async function screenshot(name) {
  const image = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  fs.writeFileSync(path.join(OUT, `${name}.png`), Buffer.from(image.data, 'base64'));
  report.screenshots.push(`${name}.png`);
}
async function viewport(width, height, mobile) {
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: mobile ? 2 : 1, mobile });
  await send('Emulation.setTouchEmulationEnabled', { enabled: mobile, maxTouchPoints: mobile ? 5 : 1 });
}
async function click(selector) {
  await evalJs(`(() => { const e=document.querySelector(${JSON.stringify(selector)}); if(!e) throw new Error('missing '+${JSON.stringify(selector)}); e.scrollIntoView({block:'center'}); return true; })()`);
  const rect = await evalJs(`(() => { const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return {x:r.left+r.width/2,y:r.top+r.height/2}; })()`);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: rect.x, y: rect.y, button: 'left', buttons: 1, clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: rect.x, y: rect.y, button: 'left', buttons: 0, clickCount: 1 });
}
async function fillName(name) {
  await evalJs(`(() => { const e=document.querySelector('#pafPlayerName'); if(!e) throw new Error('missing name input'); e.value=${JSON.stringify(name)}; e.dispatchEvent(new Event('input',{bubbles:true})); return true; })()`);
  await click('#pafSubmitScore');
}
async function key(type, code, keyValue = code) {
  await send('Input.dispatchKeyEvent', {
    type, key: keyValue, code,
    windowsVirtualKeyCode: code === 'Space' ? 32 : code === 'ShiftLeft' ? 16 : code === 'KeyW' ? 87 : code === 'PageDown' ? 34 : code === 'PageUp' ? 33 : 0,
    nativeVirtualKeyCode: code === 'Space' ? 32 : 0,
    autoRepeat: false,
  });
}
async function navigate(ip, width = 1280, height = 720, mobile = false) {
  await viewport(width, height, mobile);
  await send('Network.setExtraHTTPHeaders', { headers: { 'X-Forwarded-For': ip } });
  await send('Page.navigate', { url: `http://127.0.0.1:${gatewayPort}/index.html?version=beta&webgl=1&play-as-fox=1&pafqa=1${mobile ? '&touch=1' : ''}&onlineqa=${Date.now()}` });
  check(`boot-${width}`, await waitFor('!!window.__enterPlayAsFox', 35000));
  await evalJs('window.__enterPlayAsFox()');
  check(`paf-entry-${width}`, await waitFor('!!window.__playAsFox?.active', 20000));
  await wait(350);
}
async function finishRound(withControlledCatch = false) {
  await click('#pafTimedStart');
  check('timed-running', await waitFor('window.__playAsFox?.timed?.status === "running"', 4000));
  if (withControlledCatch) {
    await evalJs(`(() => { const api=window.__playAsFox; api.respawnAll(1); const p=api.prey[0]; api.teleport(0,0,0); p.x=0;p.z=3.4;p.vx=0;p.vz=0;p.yaw=Math.PI;p.state='freeze';p.suspicion=0;p.timer=99; })()`);
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: ' ', code: 'Space', windowsVirtualKeyCode: 32, nativeVirtualKeyCode: 32 });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: ' ', code: 'Space', windowsVirtualKeyCode: 32, nativeVirtualKeyCode: 32 });
    await evalJs('for(let i=0;i<60;i++){const a=window.__playAsFox,p=a.prey[0];p.x=a.pos.x;p.z=a.pos.z+3.4;p.vx=0;p.vz=0;a.step(1/60);} true');
  }
  await evalJs('for (let i = 0; i < 2400 && window.__playAsFox.timed.status !== "finished"; i++) window.__playAsFox.step(0.05); true');
  check('timed-finished', await evalJs('window.__playAsFox.timed.status === "finished" && window.__playAsFox.timed.elapsedMs === 120000'));
}
async function board() {
  const response = await fetch(`http://127.0.0.1:${accountPort}/paf/leaderboard`);
  return response.json();
}
async function submitBoardScore(ip, score, name = 'Board_Player') {
  const response = await fetch(`http://127.0.0.1:${accountPort}/paf/scores`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip },
    body: JSON.stringify({ name, score, durationMs: 120000, completionMs: 120000 }),
  });
  return response.json();
}
async function layout(selector) {
  return evalJs(`(() => { const e=document.querySelector(${JSON.stringify(selector)}); const r=e.getBoundingClientRect(); const cs=getComputedStyle(e); const buttons=[...e.querySelectorAll('button')].map(b=>{const q=b.getBoundingClientRect();return {text:b.textContent,disabled:b.disabled,left:q.left,right:q.right,top:q.top,bottom:q.bottom};}); return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:innerWidth,height:innerHeight,scrollHeight:e.scrollHeight,clientHeight:e.clientHeight,overflowY:cs.overflowY,buttons}; })()`);
}

(async () => {
  try {
    const browsers = execFileSync('ps', ['-eo', 'pid,args'], { encoding: 'utf8' }).split('\n')
      .filter((line) => line.includes('--remote-debugging-port=') && !line.includes('--remote-debugging-port=18800') && !line.includes('--type=renderer'));
    check('no-other-task-browser', browsers.length === 0, browsers.join('\n'));
    report.cdp = { endpoint: `127.0.0.1:${CDP_PORT}`, independentProfile: true, shared18800Used: false };

    const { createAccountsServer } = await import('../server/accounts/server.mjs');
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'm3d-paf-online-data-'));
    accounts = createAccountsServer({ secret: `qa-${Math.random()}`, dataDir, pafRatePerMin: 100, ratePerMin: 1000 });
    accountPort = await listen(accounts.server);
    gateway = http.createServer((req, res) => {
      if (req.url.startsWith('/marmot3d-beta/api/')) {
        const upstream = http.request({ host: '127.0.0.1', port: accountPort, path: req.url, method: req.method, headers: req.headers }, (reply) => {
          res.writeHead(reply.statusCode, reply.headers); reply.pipe(res);
        });
        upstream.on('error', () => { if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'accounts service offline' })); });
        req.pipe(upstream);
        return;
      }
      const rel = decodeURIComponent(req.url.split('?')[0]);
      const file = path.join(ROOT, path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));
      if (!file.startsWith(ROOT)) { res.writeHead(403); res.end('Forbidden'); return; }
      fs.readFile(file, (error, data) => {
        if (error) { res.writeHead(404); res.end('404'); return; }
        res.writeHead(200, { 'Content-Type': mime[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache' }); res.end(data);
      });
    });
    gatewayPort = await listen(gateway);

    profile = fs.mkdtempSync(path.join(os.tmpdir(), 'm3d-paf-online-chrome-'));
    chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu-blocklist', '--enable-unsafe-swiftshader', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${profile}`, '--no-first-run', '--window-size=1280,720', 'about:blank'], { stdio: 'ignore' });
    let target;
    for (let i = 0; i < 100; i++) { try { target = (await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json()).find((item) => item.type === 'page'); } catch {} if (target) break; await wait(200); }
    if (!target) throw new Error('private Chrome target unavailable');
    ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { ws.addEventListener('open', resolve, { once: true }); ws.addEventListener('error', reject, { once: true }); });
    const pending = new Map(); let sequence = 0;
    ws.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (message.id && pending.has(message.id)) { const item = pending.get(message.id); pending.delete(message.id); message.error ? item.reject(new Error(JSON.stringify(message.error))) : item.resolve(message.result); return; }
      if (message.method === 'Network.requestWillBeSent' && message.params.request.url.includes('/marmot3d-beta/api/paf/')) report.network.push({ method: message.params.request.method, url: message.params.request.url });
      if (message.method === 'Network.responseReceived' && message.params.response.url.includes('/marmot3d-beta/api/paf/')) report.network.push({ status: message.params.response.status, url: message.params.response.url });
      if (message.method === 'Runtime.exceptionThrown') report.exceptions.push(message.params.exceptionDetails?.exception?.description || message.params.exceptionDetails?.text);
      if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') report.consoleErrors.push(message.params.args.map((arg) => arg.value ?? arg.description ?? arg.type).join(' '));
    });
    send = (method, params = {}) => new Promise((resolve, reject) => {
      const id = ++sequence;
      const timer = setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); } }, 60000);
      pending.set(id, {
        resolve: (value) => { clearTimeout(timer); resolve(value); },
        reject: (error) => { clearTimeout(timer); reject(error); },
      });
      ws.send(JSON.stringify({ id, method, params }));
    });
    await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable');

    await navigate('203.0.113.41');
    await key('keyDown', 'Space', ' ');
    await evalJs('for(let i=0;i<6;i++) window.__playAsFox.step(1/60); true');
    const quietNoise = await evalJs('({phase:window.__playAsFox.phase,noise:window.__playAsFox.noise})');
    await key('keyDown', 'KeyW', 'w');
    await evalJs('for(let i=0;i<12;i++) window.__playAsFox.step(1/60); true');
    const windStalkNoise = await evalJs('({phase:window.__playAsFox.phase,noise:window.__playAsFox.noise})');
    await key('keyDown', 'ShiftLeft', 'Shift');
    await evalJs('for(let i=0;i<12;i++) window.__playAsFox.step(1/60); true');
    const windSprintNoise = await evalJs('({phase:window.__playAsFox.phase,noise:window.__playAsFox.noise})');
    await key('keyUp', 'ShiftLeft', 'Shift'); await key('keyUp', 'KeyW', 'w'); await key('keyUp', 'Space', ' ');
    await evalJs('for(let i=0;i<2;i++) window.__playAsFox.step(1/60); true');
    const defaultLungeNoise = await evalJs('({phase:window.__playAsFox.phase,noise:window.__playAsFox.noise})');
    check('real-wind-no-lunge-noise', quietNoise.phase === 'wind' && quietNoise.noise.mode !== 'lunge'
      && windStalkNoise.phase === 'wind' && windStalkNoise.noise.mode === 'stalk'
      && windSprintNoise.phase === 'wind' && windSprintNoise.noise.mode === 'sprint'
      && defaultLungeNoise.phase === 'lunge' && defaultLungeNoise.noise.mode === 'lunge',
      JSON.stringify({ quietNoise, windStalkNoise, windSprintNoise, defaultLungeNoise }));
    const rangeSamples = { default: defaultLungeNoise.noise.hearingRadius };
    await evalJs('for(let i=0;i<50;i++) window.__playAsFox.step(1/60); true');
    await key('keyDown', 'Space', ' ');
    await evalJs('for(let i=0;i<2;i++) window.__playAsFox.step(1/60); true');
    for (let i = 0; i < 12; i++) await key('keyDown', 'PageDown');
    await key('keyUp', 'Space', ' '); await evalJs('for(let i=0;i<2;i++) window.__playAsFox.step(1/60); true');
    rangeSamples.min = await evalJs('({phase:window.__playAsFox.phase,radius:window.__playAsFox.noise.hearingRadius})');
    await evalJs('for(let i=0;i<50;i++) window.__playAsFox.step(1/60); true');
    await key('keyDown', 'Space', ' '); await evalJs('for(let i=0;i<2;i++) window.__playAsFox.step(1/60); true');
    for (let i = 0; i < 24; i++) await key('keyDown', 'PageUp');
    await key('keyUp', 'Space', ' '); await evalJs('for(let i=0;i<2;i++) window.__playAsFox.step(1/60); true');
    rangeSamples.max = await evalJs('({phase:window.__playAsFox.phase,radius:window.__playAsFox.noise.hearingRadius})');
    check('real-lunge-range-hearing-monotonic', rangeSamples.min.phase === 'lunge' && rangeSamples.max.phase === 'lunge'
      && rangeSamples.min.radius < rangeSamples.default && rangeSamples.default < rangeSamples.max.radius, JSON.stringify(rangeSamples));
    report.scenarios.noise = { quietNoise, windStalkNoise, windSprintNoise, defaultLungeNoise, rangeSamples };
    await finishRound(true);
    check('name-required-before-submit', await evalJs('!document.querySelector("#pafPlayerName")?.value && window.__playAsFox.onlineLeaderboard.submission.status === "idle"'));
    check('result-three-actions-visible', await evalJs('["#pafTimedRestart","#pafContinueSandbox","#pafTimedResultExit"].every((s)=>{const e=document.querySelector(s);return e&&!e.hidden})'));
    await fillName('Desktop_One');
    check('first-auto-submit', await waitFor('window.__playAsFox.onlineLeaderboard.submission.status === "success"', 12000));
    const firstScore = await evalJs('window.__playAsFox.score');
    const firstSubmission = await evalJs('window.__playAsFox.onlineLeaderboard.submission');
    check('first-submit-once', report.network.filter((item) => item.method === 'POST' && item.url.includes('/paf/scores')).length === 1);
    check('first-local-and-online', firstSubmission.accepted === true && firstSubmission.total === 1 && firstSubmission.rank === 1, JSON.stringify(firstSubmission));
    const highSubmission = await submitBoardScore('203.0.113.41', 2, 'Desktop_One');
    check('same-ip-higher-accepted', highSubmission.accepted === true && highSubmission.best === 2 && highSubmission.rank === 1, JSON.stringify(highSubmission));
    const highScore = highSubmission.best;
    await screenshot('01-desktop-result-success-1280x720');
    report.scenarios.first = { score: firstScore, submission: firstSubmission };
    await click('#pafTimedRestart');
    check('restart-not-blocked', await waitFor('window.__playAsFox.timed.status === "running" && window.__playAsFox.score === 0', 4000));

    await evalJs('for (let i = 0; i < 2400 && window.__playAsFox.timed.status !== "finished"; i++) window.__playAsFox.step(0.05); true');
    await fillName('Desktop_One');
    check('lower-submit-receipt', await waitFor('window.__playAsFox.onlineLeaderboard.submission.status === "not_better"', 12000));
    const replacedBoard = await board();
    const lowerSubmission = await evalJs('window.__playAsFox.onlineLeaderboard.submission');
    check('same-ip-lower-retained', lowerSubmission.accepted === false && lowerSubmission.best === highScore
      && replacedBoard.total === 1 && replacedBoard.items[0].score === highScore, JSON.stringify({ replacedBoard, lowerSubmission }));
    check('replacement-post-once', report.network.filter((item) => item.method === 'POST' && item.url.includes('/paf/scores')).length === 2);
    await click('#pafTimedResultExit');
    check('success-exit-not-blocked', await waitFor('!window.__playAsFox', 5000));
    await evalJs('window.__enterPlayAsFox()');
    check('desktop-reenter', await waitFor('!!window.__playAsFox?.active', 10000));
    await click('#pafLeaderboardToggle'); await click('#pafOnlineTab');
    check('online-board-visible', await waitFor(`!document.querySelector("#pafLeaderboard").hidden && document.querySelector("#pafLeaderboard")?.textContent.includes("${highScore} 只")`));
    await screenshot('02-desktop-online-board-1280x720');
    const desktopLayout = await layout('#pafLeaderboard');
    check('desktop-panel-in-viewport', desktopLayout.right > desktopLayout.left && desktopLayout.bottom > desktopLayout.top && desktopLayout.left >= 0 && desktopLayout.right <= 1280 && desktopLayout.top >= 0 && desktopLayout.bottom <= 720, JSON.stringify(desktopLayout));
    await click('#pafLeaderboardClose');
    check('desktop-leaderboard-close', await evalJs('document.querySelector("#pafLeaderboard").hidden === true'));
    report.scenarios.replacement = { firstScore, highScore, highSubmission, replacedBoard, lowerSubmission };

    await navigate('2001:db8::41', 390, 844, true);
    await click('#pafTimedStart');
    await close(accounts.server);
    await evalJs('for (let i = 0; i < 2400 && window.__playAsFox.timed.status !== "finished"; i++) window.__playAsFox.step(0.05); true');
    await fillName('Mobile_One');
    check('honest-submit-failure', await waitFor('window.__playAsFox.onlineLeaderboard.submission.status === "error"', 12000));
    check('local-retained-on-failure', await evalJs('(async()=>{const m=await import("/src/core/paf-leaderboard.mjs");const rows=m.createPafLeaderboard().list();return rows.length===2 && rows.at(-1).score===window.__playAsFox.score;})()'));
    check('retry-visible', await evalJs('!document.querySelector("#pafOnlineRetry").hidden && document.querySelector("#pafOnlineSubmitStatus").textContent.includes("本机成绩仍保留")'));
    await screenshot('03-mobile-submit-failure-390x844');
    accountPort = await listen(accounts.server, accountPort);
    await click('#pafOnlineRetry');
    check('online-retry-success', await waitFor('window.__playAsFox.onlineLeaderboard.submission.status === "success"', 12000));
    const twoIpBoard = await board();
    check('different-ip-coexists', twoIpBoard.total === 2 && twoIpBoard.items.map((item) => item.score).sort((a, b) => b - a).join(',') === `${highScore},0`, JSON.stringify(twoIpBoard));
    await screenshot('04-mobile-retry-success-390x844');
    const mobileResult = await layout('#pafTimedResult');
    check('mobile390-result-operable', mobileResult.left >= 0 && mobileResult.right <= 390 && mobileResult.top >= 0 && mobileResult.bottom <= 844 && mobileResult.buttons.every((b) => !b.disabled && b.left >= 0 && b.right <= 390), JSON.stringify(mobileResult));
    await click('#pafTimedResultExit');
    check('failure-exit-not-blocked', await waitFor('!window.__playAsFox', 5000));
    await evalJs('window.__enterPlayAsFox()');
    check('mobile-reenter', await waitFor('!!window.__playAsFox?.active', 10000));
    await click('#pafLeaderboardToggle'); await click('#pafOnlineTab');
    check('mobile-online-load', await waitFor('!document.querySelector("#pafLeaderboard").hidden && document.querySelector("#pafLeaderboard")?.textContent.includes("共 2 条")'));
    const mobileBoard = await layout('#pafLeaderboard');
    check('mobile390-board-in-viewport', mobileBoard.right > mobileBoard.left && mobileBoard.bottom > mobileBoard.top && mobileBoard.left >= 0 && mobileBoard.right <= 390 && mobileBoard.top >= 0 && mobileBoard.bottom <= 844 && ['auto', 'scroll'].includes(mobileBoard.overflowY), JSON.stringify(mobileBoard));
    await screenshot('05-mobile-online-board-390x844');

    await viewport(320, 568, true);
    await evalJs('window.dispatchEvent(new Event("resize")); true'); await wait(300);
    const narrowBoard = await layout('#pafLeaderboard');
    check('mobile320-board-operable', narrowBoard.right > narrowBoard.left && narrowBoard.bottom > narrowBoard.top && narrowBoard.left >= 0 && narrowBoard.right <= 320 && narrowBoard.top >= 0 && narrowBoard.bottom <= 568 && ['auto', 'scroll'].includes(narrowBoard.overflowY), JSON.stringify(narrowBoard));
    await click('#pafLocalTab'); await click('#pafLeaderboardReset');
    check('local-clear-retained', await evalJs('document.querySelector("#pafLeaderboard").textContent.includes("暂无完成的限时记录")'));
    await click('#pafOnlineTab');
    check('mobile320-online-reload', await waitFor('!document.querySelector("#pafLeaderboard").hidden && document.querySelector("#pafLeaderboard")?.textContent.includes("共 2 条")'));
    await submitBoardScore('203.0.113.50', 3, 'Tie_Alpha');
    const tieBeta = await fetch(`http://127.0.0.1:${accountPort}/paf/scores`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '203.0.113.51' }, body: JSON.stringify({ name: 'Tie_Beta', score: 3, durationMs: 120000, completionMs: 70000 }) }).then((response) => response.json());
    check('same-score-shorter-completion-wins', tieBeta.accepted === true, JSON.stringify(tieBeta));
    await click('#pafOnlineRefresh');
    check('same-score-order-visible', await waitFor('document.querySelector("#pafLeaderboard")?.textContent.indexOf("Tie_Beta") < document.querySelector("#pafLeaderboard")?.textContent.indexOf("Tie_Alpha")'));
    await screenshot('06-mobile-online-board-320x568');
    await click('#pafLeaderboardClose');
    check('mobile-leaderboard-close', await evalJs('document.querySelector("#pafLeaderboard").hidden === true'));
    await click('#pafTimedStart');
    await evalJs('for (let i = 0; i < 2400 && window.__playAsFox.timed.status !== "finished"; i++) window.__playAsFox.step(0.05); true');
    check('sandbox-actions-visible', await evalJs('["#pafTimedRestart","#pafContinueSandbox","#pafTimedResultExit"].every((s)=>!!document.querySelector(s))'));
    const postsBeforeSandbox = report.network.filter((item) => item.method === 'POST' && item.url.includes('/paf/scores')).length;
    await click('#pafContinueSandbox');
    check('continue-sandbox-real-state', await waitFor('!window.__playAsFox && window.__game.game.sandbox === true && window.__game.game.mode === "play"', 8000));
    check('sandbox-does-not-submit', report.network.filter((item) => item.method === 'POST' && item.url.includes('/paf/scores')).length === postsBeforeSandbox);
    await evalJs('window.__game.exitSandbox(); true');
    check('exit-not-blocked', await waitFor('!window.__playAsFox && !document.querySelector("#playAsFoxHud")', 5000));

    const persisted = fs.readFileSync(path.join(dataDir, 'paf-scores.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
    check('persistent-current-only', persisted.length === 4 && persisted.map((item) => item.score).sort((a, b) => b - a).join(',') === `3,3,${highScore},0`
      && persisted.every((item) => item.durationMs === 120000));
    check('no-browser-page-exceptions', report.exceptions.length === 0, report.exceptions.join('\n'));
    report.renderer = await evalJs('({userAgent:navigator.userAgent,viewport:{width:innerWidth,height:innerHeight}})').catch(() => null);
    report.finishedAt = new Date().toISOString(); save();
    console.log(JSON.stringify({ pass: true, checks: Object.keys(report.checks).length, scenarios: report.scenarios, consoleErrors: report.consoleErrors.length, exceptions: report.exceptions.length }, null, 2));
  } catch (error) {
    report.finishedAt = new Date().toISOString(); report.error = error.stack || String(error); save();
    console.error(error.stack || error); process.exitCode = 1;
  } finally {
    try { ws?.close(); } catch {}
    try { if (chrome?.pid) process.kill(chrome.pid, 'SIGKILL'); } catch {}
    await close(gateway); await close(accounts?.server);
    if (profile) fs.rmSync(profile, { recursive: true, force: true });
    if (dataDir) fs.rmSync(dataDir, { recursive: true, force: true });
  }
})();
