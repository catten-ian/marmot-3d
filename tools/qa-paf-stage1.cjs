/**
 * Stage 1 浏览器真实验收（CDP）：扮演藏狐 A1/A2/A3/A4/B1/B2/E3。
 *
 * 默认复用 OpenClaw 托管 Chrome（http://127.0.0.1:18800，独立标签页）+ 内嵌零依赖静态服务器，
 * 进入 ?play-as-fox=1 路径（经 window.__enterPlayAsFox），通过 window.__playAsFox
 * QA 钩子做确定性场景：freeze 序列 / zigzag 相位 / lead 截杀试验 / 垂直窗 /
 * 重生约束 / 窄屏 / 刷新 / localStorage 故障 fail-soft / 断网 / ?pafdebug=1 调参台。
 *
 * 用法：node tools/qa-paf-stage1.cjs
 * 产物：outputs/m3d-20261025-beta-paf-improve/{*.png,qa-results.json}
 */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'outputs', 'm3d-20261025-beta-paf-improve');
const PORT = 8331;
const CDP_PORT = Number(process.env.CDP_PORT || 9231);
const EXTERNAL = process.env.PAF_QA_CDP === 'off' ? null : (process.env.PAF_QA_CDP || 'http://127.0.0.1:18800');
const CHROME = process.env.CHROME_PATH || '/usr/bin/google-chrome';
fs.mkdirSync(OUT, { recursive: true });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon', '.svg': 'image/svg+xml', '.glb': 'model/gltf-binary',
  '.woff2': 'font/woff2', '.spz': 'application/octet-stream', '.webp': 'image/webp',
};
const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0]);
  const file = path.join(ROOT, path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));
  if (!file.startsWith(ROOT)) { res.writeHead(403).end('Forbidden'); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404).end('404'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
});

const results = {
  startedAt: new Date().toISOString(), target: null, renderer: {}, scenarios: {}, errors: [], screenshots: [],
};
let report = results;

async function main() {
  await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
  let chrome = null;
  let ws;
  let tabTargetId = null;
  let sessionId = null;
  let useExternal = false;
  let serverClosed = false;
  const cleanup = async () => {
    try {
      if (useExternal && tabTargetId) await fetch(`${EXTERNAL}/json/close/${tabTargetId}`, { signal: AbortSignal.timeout(2000) });
    } catch (_) {}
    try { ws?.close(); } catch (_) {}
    try { chrome?.kill('SIGKILL'); } catch (_) {}
    if (!serverClosed) { server.close(); server.closeAllConnections?.(); serverClosed = true; }
  };
  // 硬上限：超时仍落盘已有证据，绝不无限等待。
  const hardTimeout = setTimeout(() => {
    report.errors.push('[harness timeout] overall 480s limit');
    report.finishedAt = new Date().toISOString();
    fs.writeFileSync(path.join(OUT, 'qa-results.json'), JSON.stringify(report, null, 2));
    console.error('FATAL overall 480s timeout; partial evidence written');
    cleanup().finally(() => process.exit(2));
  }, 480000);
  const savePartial = () => {
    try {
      if (!report.finishedAt) report.finishedAt = new Date().toISOString();
      fs.writeFileSync(path.join(OUT, 'qa-results.json'), JSON.stringify(report, null, 2));
    } catch (_) {}
  };
  process.once('exit', savePartial);
  try {
    let ver = null;
    if (EXTERNAL) {
      try {
        const r = await fetch(`${EXTERNAL}/json/version`, { signal: AbortSignal.timeout(3000) });
        if (r.ok) ver = await r.json();
      } catch (_) {}
    }
    useExternal = !!ver;
    if (useExternal) {
      console.log(`CDP managed Chrome: ${ver.Browser} @ ${EXTERNAL}`);
      ws = new WebSocket(ver.webSocketDebuggerUrl);
    } else {
      // 仅托管端点不可用时自起；不强制 SwiftShader。
      console.log('CDP managed Chrome unavailable; launching local Chrome with ANGLE/OpenGL');
      const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'paf-qa-'));
      chrome = spawn(CHROME, [
        '--headless=new', '--no-sandbox', '--disable-gpu-blocklist',
        '--use-gl=angle', '--use-angle=gl',
        '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
        `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${profile}`,
        '--no-first-run', '--window-size=1280,720', 'about:blank',
      ], { stdio: 'ignore' });
      let target;
      for (let i = 0; i < 40; i++) {
        await wait(250);
        try { target = (await getJson(`http://127.0.0.1:${CDP_PORT}/json/list`)).find((t) => t.type === 'page'); } catch (_) {}
        if (target) break;
      }
      if (!target) throw new Error('chrome cdp unavailable');
      ws = new WebSocket(target.webSocketDebuggerUrl);
    }
    await new Promise((res, rej) => {
      ws.addEventListener('open', res, { once: true });
      ws.addEventListener('error', rej, { once: true });
      setTimeout(() => rej(new Error('CDP websocket open timeout')), 5000);
    });

    let seq = 0;
    const pending = new Map();
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && pending.has(m.id)) {
        const p = pending.get(m.id); pending.delete(m.id);
        m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result);
      } else if (m.method === 'Runtime.exceptionThrown') {
        report.errors.push('[exception] ' + (m.params.exceptionDetails?.text || '') + ' ' + String(m.params.exceptionDetails?.exception?.description || '').slice(0, 300));
      } else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
        report.errors.push('[console.error] ' + m.params.args.map((a) => a.value ?? a.description ?? a.type).join(' ').slice(0, 300));
      }
    });
    const send = (method, params = {}) => new Promise((resolve, reject) => {
      const id = ++seq; pending.set(id, { resolve, reject });
      const msg = { id, method, params };
      if (sessionId) msg.sessionId = sessionId;
      ws.send(JSON.stringify(msg));
      setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error('timeout ' + method)); } }, 60000);
    });
    if (useExternal) {
      const t = await send('Target.createTarget', { url: 'about:blank', newWindow: true, background: false });
      tabTargetId = t.targetId;
      await send('Target.activateTarget', { targetId: tabTargetId });
      const a = await send('Target.attachToTarget', { targetId: tabTargetId, flatten: true });
      sessionId = a.sessionId;
    }
    report.cdp = { managed: useExternal, endpoint: useExternal ? EXTERNAL : `local:${CDP_PORT}`, browser: ver?.Browser || 'local fallback' };
    const evalJS = async (expression) => {
      const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, timeout: 55000 });
      if (r.exceptionDetails) throw new Error((r.exceptionDetails.text || '') + ' ' + JSON.stringify(r.exceptionDetails.exception?.description || '').slice(0, 500));
      return r.result?.value;
    };
    const shot = async (name) => {
      await evalJS(`(() => {if(window.__game?.renderer)window.__game.renderer.render(window.__game.scene,window.__game.camera);})()`).catch(() => {});
      const s = await send('Page.captureScreenshot', { format: 'png' });
      const fp = path.join(OUT, name + '.png');
      fs.writeFileSync(fp, Buffer.from(s.data, 'base64'));
      report.screenshots.push(name + '.png');
    };

    await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable');
    await send('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => {});
    await send('Page.setWebLifecycleState', { state: 'active' }).catch(() => {});

    const navigate = async (qs) => {
      const url = `http://127.0.0.1:${PORT}/index.html?${qs || ''}&t=${Date.now()}`;
      report.target = report.target || url;
      if (tabTargetId) await send('Target.activateTarget', { targetId: tabTargetId });
      await send('Page.bringToFront').catch(() => {});
      await send('Page.navigate', { url });
      for (let i = 0; i < 160; i++) {
        await wait(250);
        const ready = await evalJS(`!!(window.__game && window.__enterPlayAsFox)`).catch(() => false);
        if (ready) return;
      }
      throw new Error('page boot timeout');
    };
    const enterPaf = async () => {
      if (tabTargetId) await send('Target.activateTarget', { targetId: tabTargetId });
      await send('Page.bringToFront').catch(() => {});
      await send('Page.setWebLifecycleState', { state: 'active' }).catch(() => {});
      await evalJS(`window.__enterPlayAsFox()`);
      for (let i = 0; i < 80; i++) {
        await wait(100);
        const on = await evalJS(`!!(window.__playAsFox && window.__playAsFox.active)`).catch(() => false);
        if (on) return;
      }
      throw new Error('enter paf timeout');
    };

    // —— 启动并进入模式 ——
    await navigate('webgl=1&play-as-fox=1&pafqa=1');
    await enterPaf();
    await wait(1500);

    // 渲染后端识别（诚实区分 WebGPU / WebGL2 / 软件渲染）
    report.renderer = await evalJS(`(async () => {
      const r = window.__game.renderer;
      let info = { backend: '未知', gpu: '未知', acceleration: '未知' };
      try { ({ readGpuInfo } = await import('/src/core/gpu-info.mjs')); info = readGpuInfo(r); } catch (e) { info.backend = '读取失败: ' + e.message; }
      let rawGl = '';
      try {
        const gl = r.getContext ? r.getContext() : null;
        const ext = gl && gl.getExtension('WEBGL_debug_renderer_info');
        rawGl = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : '';
      } catch (e) {}
      const webgpu = !!navigator.gpu;
      return { ...info, rawGl, webgpuAvailable: webgpu };
    })()`);

    // —— A2 freeze 序列 ——
    console.log('SCENARIO freeze');
    report.scenarios.freeze = await evalJS(`(() => {
      const api=window.__playAsFox; api.respawnAll(1);
      const p=api.prey[0]; api.teleport(0,0,0);
      p.x=0;p.z=5.6;p.vx=0;p.vz=0;p.yaw=Math.PI;p.state='wander';p.suspicion=0;p.timer=99;
      const seen=[],runs=[],sus=[]; let cur=0,maxFreezeMove=0,facingErrorDeg=null;
      let startXZ=null;
      for(let f=0;f<240;f++) {
        api.step(1/60);
        if(seen[seen.length-1]!==p.state) {
          seen.push(p.state);
          if(p.state==='freeze') {cur=f;startXZ={x:p.x,z:p.z};}
          if(cur && p.state!=='freeze') {runs.push((f-cur)*1000/60);cur=0;}
        }
        if(p.state==='freeze') {
          maxFreezeMove=Math.max(maxFreezeMove,Math.hypot(p.x-startXZ.x,p.z-startXZ.z));
          facingErrorDeg=Math.abs(Math.atan2(Math.sin(p.yaw-Math.PI),Math.cos(p.yaw-Math.PI)))*180/Math.PI;
        }
        sus.push(Number(p.suspicion.toFixed(3)));
      }
      if(cur)runs.push((240-cur)*1000/60);
      return {seenStates:seen,freezeDurationsMs:runs,suspicionRose:Math.max(...sus)>0.4,maxSuspicion:Math.max(...sus),maxFreezeMoveM:Number(maxFreezeMove.toFixed(4)),facingErrorDeg:facingErrorDeg===null?null:Number(facingErrorDeg.toFixed(2)),driver:'qa.step(1/60)'};
    })()`);
    // 再进一次自然 freeze，在冻结窗内截图（非人工摆拍冻结态）。
    await evalJS(`(() => { const api=window.__playAsFox; api.respawnAll(1); const p=api.prey[0]; api.teleport(0,0,0); p.x=0;p.z=5.6;p.vx=0;p.vz=0;p.yaw=Math.PI;p.state='wander';p.suspicion=0;p.timer=99; })()`);
    await evalJS(`(() => {const api=window.__playAsFox,p=api.prey[0];for(let i=0;i<180 && p.state!=='freeze';i++)api.step(1/60);})()`);
    report.scenarios.freezeScreenshotState = await evalJS(`window.__playAsFox.prey[0]?.state`);
    await shot('01-paf-freeze-desktop');

    // —— A3 zigzag ——
    console.log('SCENARIO zigzag');
    report.scenarios.zigzag = await evalJS(`(() => {
      const api=window.__playAsFox;api.respawnAll(1);const p=api.prey[0];api.teleport(0,0,0);
      p.x=0;p.z=6;p.vx=0;p.vz=0;p.yaw=0;p.state='flee';p.suspicion=1;p.timer=0;
      let flips=0,lastSign=0;const speeds=[],samples=[];
      for(let f=0;f<120;f++) {
        api.step(1/60);
        const d=Math.hypot(p.x,p.z)||1e-6,rx=p.x/d,rz=p.z/d;
        const cross=p.vx*rz-p.vz*rx,dot=p.vx*rx+p.vz*rz,latAng=Math.atan2(cross,dot);
        const sign=Math.abs(latAng)>0.25?Math.sign(cross):0;
        if(sign!==0&&lastSign!==0&&sign!==lastSign)flips++;
        if(sign!==0)lastSign=sign;
        speeds.push(Math.hypot(p.vx,p.vz));
        samples.push({x:Number(p.x.toFixed(2)),z:Number(p.z.toFixed(2)),s:Number(Math.hypot(p.vx,p.vz).toFixed(2))});
      }
      speeds.sort((a,b)=>a-b);
      return {flips,medianSpeed:Number(speeds[speeds.length>>1].toFixed(2)),tailSamples:samples.slice(-6),driver:'qa.step(1/60)'};
    })()`);
    await shot('02-zigzag-field');

    // —— A4 实际 Prey.update
    // wind 中记录预测着陆点、实际逃向与加权期望逃向
    console.log('SCENARIO landing evasion');
    report.scenarios.landingEvasion = await evalJS(`(async () => {
      const api=window.__playAsFox,pp=await import('/src/core/predator-prey.js');api.respawnAll(1);
      for(let i=0;i<90&&api.phase!=='idle';i++)api.step(1/60);
      const p=api.prey[0];api.teleport(0,0,15*Math.PI/180);
      p.x=0;p.z=7;p.vx=0;p.vz=0;p.yaw=Math.PI;p.state='flee';p.suspicion=1;p.timer=0;
      const saved={...api.cfg};api.cfg.zigzagAngleMin=0;api.cfg.zigzagAngleMax=0;api.cfg.zigzagSpeedFactor=1;
      window.dispatchEvent(new KeyboardEvent('keydown',{code:'Space'}));
      let sample=null;
      for(let i=0;i<14;i++) {
        api.step(1/60);
        if(api.phase==='wind'&&i>=7) {
          const land=pp.predictLandingPoint(api.pos.x,api.pos.z,api.pos.yaw,api.cfg);
          const expected=pp.evadeVector(p.x,p.z,api.pos.x,api.pos.z,land.x,land.z,api.cfg);
          const actual=pp.yawTo(p.vx,p.vz),err=Math.atan2(Math.sin(actual-expected.yaw),Math.cos(actual-expected.yaw));
          const radialOnly=pp.yawTo(p.x-api.pos.x,p.z-api.pos.z);
          sample={expectedYaw:expected.yaw,actualYaw:actual,errorDeg:Math.abs(err)*180/Math.PI,differsFromRadialDeg:Math.abs(Math.atan2(Math.sin(expected.yaw-radialOnly),Math.cos(expected.yaw-radialOnly)))*180/Math.PI,land,prey:{x:p.x,z:p.z},driver:'qa.step(1/60)'};
          break;
        }
      }
      window.dispatchEvent(new KeyboardEvent('keyup',{code:'Space'}));Object.assign(api.cfg,saved);
      return sample||{error:'no moving wind sample'};
    })()`);

    // —— B1 lead 截射试验
    // 16 次扑击横向逃跑的猎物
    console.log('SCENARIO lead pounce');
    report.scenarios.leadPounce = await evalJS(`(() => {
      const api=window.__playAsFox,N=16;let catches=0,lateralTrials=0;const retargets=[];
      for(let i=0;i<N;i++) {
        api.respawnAll(1);for(let q=0;q<90&&api.phase!=='idle';q++)api.step(1/60);
        const p=api.prey[0];api.teleport(0,0,0);p.x=0;p.z=7;p.vx=0;p.vz=0;p.yaw=0;p.state='flee';p.suspicion=1;p.timer=0;
        for(let k=0;k<30;k++)api.step(1/60);
        const radial=Math.atan2(p.x,p.z),fx=p.x-Math.sin(radial)*2.6,fz=p.z-Math.cos(radial)*2.6;
        api.teleport(fx,fz,radial);
        const vel=Math.atan2(p.vx,p.vz);
        if(Math.abs(Math.atan2(Math.sin(vel-radial),Math.cos(vel-radial)))>5*Math.PI/180)lateralTrials++;
        const s0=api.score,yaw0=api.pos.yaw;window.dispatchEvent(new KeyboardEvent('keydown',{code:'Space'}));
        let maxA=0,lastPhase='';
        for(let k=0;k<90;k++) {
          const before=api.phase;api.step(1/60);const ph=api.phase;
          if(ph==='wind') {const d=Math.abs(Math.atan2(Math.sin(api.pos.yaw-yaw0),Math.cos(api.pos.yaw-yaw0)));maxA=Math.max(maxA,d);}
          if(lastPhase==='recover'&&ph==='idle')break;lastPhase=ph;
        }
        retargets.push(Number(maxA.toFixed(4)));if(api.score>s0)catches++;
        window.dispatchEvent(new KeyboardEvent('keyup',{code:'Space'}));
      }
      const cap=12*Math.PI/180;
      return {trials:N,lateralTrials,catches,catchRate:Number((catches/N).toFixed(2)),maxRetargetDeg:Number((Math.max(...retargets)*180/Math.PI).toFixed(2)),capDeg:12,retargetsWithinCap:retargets.every(a=>a<=cap+0.02),retargeted:retargets.some(a=>a>0.01),driver:'qa.step(1/60)'};
    })()`);

    // —— B2 垂直捕获窗 ——
    console.log('SCENARIO vertical window');
    report.scenarios.verticalWindow = await evalJS(`(async () => {
      const api=window.__playAsFox,pp=await import('/src/core/predator-prey.js'),cfg=api.cfg;
      const pure={apexMiss:pp.canCatch(0.2,0,1.05,0,cfg)===false,lowArcHit:pp.canCatch(0.2,0,0.3,0,cfg)===true,groundHit:pp.canCatch(0.2,0,0,0,cfg)===true,terrainBlock:pp.canCatch(0.2,0,0,1,cfg)===false,horizontalMiss:pp.canCatch(2,0,0,0,cfg)===false};
      const saved={preyFlee:cfg.preyFlee,preyBurst:cfg.preyBurst,catchRadius:cfg.catchRadius};cfg.preyFlee=0;cfg.preyBurst=0;
      api.respawnAll(1);for(let i=0;i<90&&api.phase!=='idle';i++)api.step(1/60);
      const p=api.prey[0];api.teleport(-20,-20,0);p.x=-20;p.z=-17.15;p.vx=0;p.vz=0;p.yaw=Math.PI;p.state='wander';p.suspicion=0;
      cfg.catchRadius=1.0; // 高空组缩小水平圈：进入圈时已在高空，捕获判定保持开启
      window.dispatchEvent(new KeyboardEvent('keydown',{code:'Space'}));const frames=[];
      for(let k=0;k<75;k++) {api.step(1/60);frames.push({d:Number(Math.hypot(p.x-api.pos.x,p.z-api.pos.z).toFixed(2)),airY:Number(api.pos.airY.toFixed(2)),caught:p.caught});if(api.phase==='idle'&&k>10)break;}
      window.dispatchEvent(new KeyboardEvent('keyup',{code:'Space'}));Object.assign(cfg,saved);
      const terrainDelta=Number((api.terrainHeightAt(-20,-20)-api.terrainHeightAt(-20,-17.15)).toFixed(4));
      const overshootDenied=frames.some(f=>f.d<1.0&&f.airY>=0.8&&!f.caught);
      const neverCaughtHighArc=frames.every(f=>!f.caught);
      api.respawnAll(1);for(let i=0;i<90&&api.phase!=='idle';i++)api.step(1/60);
      const q=api.prey[0];api.teleport(-20,-20,0);q.x=-20;q.z=-18.7;q.vx=0;q.vz=0;q.state='flee';q.suspicion=1;
      const s0=api.score;window.dispatchEvent(new KeyboardEvent('keydown',{code:'Space'}));for(let i=0;i<75;i++)api.step(1/60);window.dispatchEvent(new KeyboardEvent('keyup',{code:'Space'}));
      return {pure,highArcCatchRadius:1.0,highArcCaptureEnabled:true,terrainDelta,neverCaughtHighArc,overshootDeniedAtApex:overshootDenied,closePounceCatch:api.score>s0,apexFrames:frames.filter(f=>f.d<1.0).slice(0,12),driver:'qa.step(1/60)'};
    })()`);
    await shot('03-pounce');

    // —— E3 重生防贴脸
    console.log('SCENARIO respawn');
    report.scenarios.respawn = await evalJS(`(() => {
      const api = window.__playAsFox;
      const p = api.prey[0];
      const D2R = Math.PI / 180;
      let okN = 0, minD = Infinity, minAngle = 99;
      for (let i = 0; i < 60; i++) {
        p.respawnAt(api.bounds, { x: 0, z: 0, yaw: 0 }, api.cfg);
        const d = Math.hypot(p.x, p.z);
        const ang = Math.abs(Math.atan2(p.x, p.z));
        minD = Math.min(minD, d); minAngle = Math.min(minAngle, ang * 180 / Math.PI);
        if (d >= api.cfg.respawnMinDist - 1e-9 && ang > D2R * api.cfg.respawnViewDeg) okN++;
      }
      return { trials: 60, strictOk: okN, minDist: Number(minD.toFixed(2)), minViewAngleDeg: Number(minAngle.toFixed(1)) };
    })()`);

    // —— 窄屏 / 触屏 ——
    console.log('SCENARIO narrow');
    await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/index.html?webgl=1&play-as-fox=1&pafqa=1&narrow=1&t=${Date.now()}` });
    for (let i=0;i<160;i++) { if (await evalJS(`!!window.__enterPlayAsFox`).catch(()=>false)) break; await wait(250); }
    await enterPaf();
    await wait(1200);
    report.scenarios.narrow = await evalJS(`(() => {
      const hud = document.getElementById('playAsFoxHud');
      const r = hud.getBoundingClientRect();
      const stick = document.getElementById('pafStick');
      return { width: Math.round(r.width), touchClass: hud.classList.contains('paf-touch'), stickVisible: !!stick && getComputedStyle(document.getElementById('pafTouch')).display === 'block' && stick.getBoundingClientRect().width > 0 };
    })()`);
    await shot('04-narrow-touch');

    // —— 刷新后重入 ——
    console.log('SCENARIO refresh');
    await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
    await send('Emulation.setTouchEmulationEnabled', { enabled: false });
    await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/index.html?webgl=1&play-as-fox=1&pafqa=1&refresh=1&t=${Date.now()}` });
    for (let i=0;i<160;i++) { if (await evalJS(`!!window.__enterPlayAsFox`).catch(()=>false)) break; await wait(250); }
    await enterPaf();
    await wait(800);
    report.scenarios.refresh = await evalJS(`!!(window.__playAsFox && window.__playAsFox.active && window.__playAsFox.prey.length === 8)`);
    await wait(400);
    await shot('05-after-refresh');

    // —— 退出重进
    console.log('SCENARIO exit/reenter');
    report.scenarios.exitReenter = await evalJS(`(async () => {
      const wait=(ms)=>new Promise(r=>setTimeout(r,ms));
      document.getElementById('pafExit')?.click(); await wait(250);
      const exited = !window.__playAsFox && !document.getElementById('playAsFoxHud');
      await window.__enterPlayAsFox(); await wait(600);
      return { exited, reentered:!!(window.__playAsFox?.active && document.getElementById('playAsFoxHud')) };
    })()`);


    report.scenarios.storageFailure = await evalJS(`(async () => {
      const wait = (ms) => new Promise(r => setTimeout(r, ms));
      const trap = () => { throw new Error('blocked'); };
      const proto = Storage.prototype;
      const g = proto.getItem, s = proto.setItem, rm = proto.removeItem;
      proto.getItem = trap; proto.setItem = trap; proto.removeItem = trap;
      document.getElementById('pafExit')?.click();
      await wait(300);
      let enterOk = false, err = null;
      try { await window.__enterPlayAsFox(); await wait(400); enterOk = !!(window.__playAsFox && window.__playAsFox.active); } catch (e) { err = String(e); }
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space' }));
      for(let i=0;i<18;i++)window.__playAsFox.step(1/60);
      const phaseAfterPounce = window.__playAsFox && window.__playAsFox.phase;
      proto.getItem = g; proto.setItem = s; proto.removeItem = rm;
      return { enterOk, err, phaseAfterPounce };
    })()`);

    // —— 断网路径
    console.log('SCENARIO offline');
    await send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
    const scoreBefore = await evalJS(`window.__playAsFox.score`);
    await evalJS(`window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space' }))`);
    await evalJS(`(() => {for(let i=0;i<30;i++)window.__playAsFox.step(1/60);})()`);
    report.scenarios.offline = await evalJS(`({ active: window.__playAsFox.active, phase: window.__playAsFox.phase })`);
    await send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });

    // —— ?pafdebug=1
    console.log('SCENARIO debug GUI');
    await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/index.html?pafdebug=1&pafqa=1&play-as-fox=1&webgl=1&t=${Date.now()}` });
    for (let i=0;i<160;i++) { if (await evalJS(`!!window.__enterPlayAsFox`).catch(()=>false)) break; await wait(250); }
    await enterPaf();
    await wait(1500);
    report.scenarios.debugGui = await evalJS(`(() => {
      const gui = document.querySelector('.lil-gui');
      const labels = [...document.querySelectorAll('.lil-gui .property-name')].map(e => e.textContent);
      const params = window.__pafDebug?.gui?.controllers?.map(c => c.property) || [];
      const allControllers = []; const walk = g => { allControllers.push(...g.controllers.map(c=>c.property)); g.folders.forEach(walk); }; if(window.__pafDebug?.gui)walk(window.__pafDebug.gui);
      const requiredProps = ['visionHalfAngleDeg','freezeMin','zigzagDistance','evadeLandingWeight','windRetargetDeg','catchVerticalTol','respawnMinDist'];
      const want = ['视锥半角°(全锥2倍)', '冻结最短s', 'zigzag距离', '回避·着陆点', 'wind重瞄上限°', '垂直容差±', '重生最近距离'];
      return { exists: !!gui, handle: !!window.__pafDebug, newParamsAllPresent: requiredProps.every(w => allControllers.includes(w)), visibleLabels:labels.length, paramCount: allControllers.length, missing:requiredProps.filter(w=>!allControllers.includes(w)) };
    })()`);
    await shot('06-paf-debug');

    // —— 普通玩家路径：无 QA step、无懒加载调试台、无额外调试几何体 ——
    console.log('SCENARIO normal player');
    await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/index.html?webgl=1&play-as-fox=1&normal=1&t=${Date.now()}` });
    for (let i=0;i<160;i++) { if (await evalJS(`!!window.__enterPlayAsFox`).catch(()=>false)) break; await wait(250); }
    await enterPaf();
    report.scenarios.normalPlayer = await evalJS(`(() => ({
      active:!!window.__playAsFox?.active,
      noQaStep:typeof window.__playAsFox?.step === 'undefined',
      noDebugGui:!window.__pafDebug && !document.querySelector('.lil-gui'),
      noDebugGeometry:!window.__game.scene.getObjectByName('paf-debug-view')
    }))()`);

    const S = report.scenarios;
    report.checks = {
      freezeSequence: S.freeze?.seenStates?.slice(0,4)?.join('>') === 'wander>alert>freeze>flee' && S.freeze?.freezeDurationsMs?.some(d => d >= 180 && d <= 600),
      freezeStillFacing: S.freeze?.maxFreezeMoveM < 0.03 && S.freeze?.facingErrorDeg < 1 && S.freezeScreenshotState === 'freeze',
      zigzag: S.zigzag?.flips >= 2 && S.zigzag?.medianSpeed >= 3.0,
      landingEvasion: S.landingEvasion?.errorDeg < 20 && S.landingEvasion?.differsFromRadialDeg > 1,
      leadPounce: S.leadPounce?.catches > 0 && S.leadPounce?.lateralTrials > 0 && S.leadPounce?.retargeted && S.leadPounce?.retargetsWithinCap,
      verticalWindow: S.verticalWindow && Object.values(S.verticalWindow.pure).every(Boolean) && S.verticalWindow.overshootDeniedAtApex && S.verticalWindow.neverCaughtHighArc && S.verticalWindow.closePounceCatch,
      respawn: S.respawn?.strictOk === S.respawn?.trials && S.respawn?.minDist >= 18 && S.respawn?.minViewAngleDeg > 35,
      narrow: S.narrow?.width === 390 && !!S.narrow?.stickVisible,
      refresh: S.refresh === true,
      exitReenter: S.exitReenter?.exited && S.exitReenter?.reentered,
      storageFailure: S.storageFailure?.enterOk && ['wind','lunge','recover'].includes(S.storageFailure?.phaseAfterPounce),
      offline: S.offline?.active && ['wind','lunge','recover'].includes(S.offline?.phase),
      debugGui: S.debugGui?.exists && S.debugGui?.newParamsAllPresent,
      normalPlayer: S.normalPlayer?.active && S.normalPlayer?.noQaStep && S.normalPlayer?.noDebugGui && S.normalPlayer?.noDebugGeometry,
    };
    console.log('CHECKS '+JSON.stringify(report.checks));
    report.pass = Object.values(report.checks).every(Boolean) && report.errors.length === 0;
    report.finishedAt = new Date().toISOString();
    fs.writeFileSync(path.join(OUT, 'qa-results.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
    if (!report.pass) process.exitCode = 1;
  } finally {
    await cleanup();
    clearTimeout(hardTimeout);
  }
}

function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => { let d = ''; res.on('data', (c) => d += c); res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } }); }).on('error', reject);
  });
}

main().catch((e) => {
  report.errors.push('[harness fatal] ' + (e?.stack || String(e)));
  report.finishedAt = new Date().toISOString();
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'qa-results.json'), JSON.stringify(report, null, 2));
  console.error('FATAL', e);
  process.exit(1);
});
