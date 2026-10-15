/**
 * 远景视觉检查：把玩家放到场地中央，绕 360° 各拍一张图。
 * 用法：node tools/shot-backdrop.cjs
 */
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');

const PORT = 9341;
const OUT = 'D:/gam3/3d/marmot-3d/tools';
const get = (u) => fetch(u, { headers: { Host: '127.0.0.1' } }).then((r) => r.json());

function findChrome() {
  for (const c of [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  ]) if (fs.existsSync(c)) return c;
  return null;
}

(async () => {
  const CHROME = findChrome();
  if (!CHROME) { console.log('未找到 Chrome/Edge'); process.exit(1); }
  const profile = path.join(os.tmpdir(), 'marmot-shot-' + Date.now());
  const chrome = spawn(CHROME, [
    '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
    '--no-first-run', '--disable-gpu', '--use-gl=swiftshader', '--enable-unsafe-swiftshader',
    '--window-size=1280,720', 'about:blank',
  ], { stdio: 'ignore' });
  let t = null;
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 500));
    try { t = (await get(`http://127.0.0.1:${PORT}/json/list`)).find((x) => x.type === 'page'); if (t) break; } catch (e) {}
  }
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  let id = 0; const pend = new Map();
  const logs = [];
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pend.has(m.id)) { const q = pend.get(m.id); pend.delete(m.id); m.error ? q.rej(new Error(JSON.stringify(m.error))) : q.res(m.result); return; }
    if (m.method === 'Runtime.consoleAPICalled' && (m.params.type === 'error' || m.params.type === 'warning')) {
      logs.push(`[${m.params.type}] ` + m.params.args.map((a) => a.value ?? a.description ?? a.type).join(' '));
    }
  });
  const send = (me, pa = {}) => new Promise((res, rej) => {
    const i = ++id; pend.set(i, { res, rej });
    ws.send(JSON.stringify({ id: i, method: me, params: pa }));
    setTimeout(() => { if (pend.has(i)) { pend.delete(i); rej(new Error('timeout ' + me)); } }, 40000);
  });

  await new Promise((r) => ws.addEventListener('open', r, { once: true }));
  await send('Runtime.enable'); await send('Page.enable');
  await send('Page.navigate', { url: 'http://127.0.0.1:8123/index.html' });
  await new Promise((r) => setTimeout(r, 7000));

  // 开始游戏
  await send('Runtime.evaluate', {
    expression: "(function(){const b=document.querySelector('#startBtn')||document.querySelector('.panel button')||[...document.querySelectorAll('button')].find(x=>/开始|进入|start/i.test(x.textContent));if(b)b.click();return b?b.textContent:'no button';})()",
    returnByValue: true,
  });
  await new Promise((r) => setTimeout(r, 3500));

  const has = await send('Runtime.evaluate', { expression: 'typeof window.__game', returnByValue: true });
  console.log('window.__game =', has.result?.value);

  for (const a of [0, 45, 90, 135, 180, 225, 270, 315]) {
    await send('Runtime.evaluate', {
      expression: `(function(){const g=window.__game;if(!g)return 'no';
        g.controller.position.x=0;g.controller.position.z=0;
        g.controller.yaw=${a}*Math.PI/180;g.controller.pitch=-0.02;return 'ok';})()`,
      returnByValue: true,
    });
    await new Promise((r) => setTimeout(r, 800));
    const s = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT, 'view-yaw' + a + '.png'), Buffer.from(s.data, 'base64'));
    console.log('yaw', a, '拍摄完成');
  }

  const st = await send('Runtime.evaluate', {
    expression: `(function(){const g=window.__game;if(!g)return 'no';
      const b=g.backdrop();
      let box=null,tris=0,vis=false;
      if(b){b.updateMatrixWorld(true);
        const THREE=g.THREE;
        if(THREE){const bx=new THREE.Box3().setFromObject(b);const sz=bx.getSize(new THREE.Vector3());box=[+sz.x.toFixed(1),+sz.y.toFixed(1),+sz.z.toFixed(1)];}
        b.traverse(o=>{if(o.isMesh&&o.geometry){vis=true;const i=o.geometry.index;tris+=(i?i.count:o.geometry.attributes.position.count)/3;}});
      }
      return {backdropExists:!!b, visible:vis, tris:Math.round(tris), boxSize:box,
        pos:b?b.position.toArray().map(v=>+v.toFixed(1)):null,
        scale:b?b.scale.x:null, rotY:b?+b.rotation.y.toFixed(2):null,
        camPos:g.camera.position.toArray().map(v=>+v.toFixed(1))};})()`,
    returnByValue: true,
  });
  console.log('远景状态:', JSON.stringify(st.result?.value, null, 1));
  console.log('控制台 error/warning:', logs.length);
  logs.slice(0, 8).forEach((l) => console.log('  ' + l.slice(0, 200)));

  ws.close(); chrome.kill();
  await new Promise((r) => setTimeout(r, 300));
  process.exit(0);
})();
