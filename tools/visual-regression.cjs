/**
 * 游戏视觉回归测试：完整启动页面，覆盖标题、实战、暂停、设置和窄屏。
 * 输出截图到 outputs/visual-regression，并用 DOM/画布基本指标拦截空画布和遮挡布局。
 * 用法：node tools/visual-regression.cjs [url]
 */
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const PORT = 9501;
const BASE = process.argv[2] || 'http://127.0.0.1:8123/index.html';
const BASE_URL = new URL(BASE);
const EXPECT_REAL_MODEL = BASE_URL.searchParams.get('models') !== 'off'
  && BASE_URL.searchParams.get('foxmodel') !== 'off';
const RUN_MODE = EXPECT_REAL_MODEL ? 'real-model' : 'procedural-fallback';
const OUT = path.join(ROOT, 'outputs', 'visual-regression');
fs.mkdirSync(OUT, { recursive: true });

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
const get = (u) => fetch(u).then((r) => r.json());
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const chromePath = findChrome();
  if (!chromePath) throw new Error('未找到 Chrome/Edge');
  const profile = path.join(os.tmpdir(), `marmot-vr-${Date.now()}`);
  const chrome = spawn(chromePath, [
    '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
    '--no-first-run', '--enable-unsafe-swiftshader', 'about:blank',
  ], { stdio: 'ignore' });
  let tab;
  for (let i = 0; i < 80; i++) {
    await wait(250);
    try { tab = (await get(`http://127.0.0.1:${PORT}/json/list`)).find((x) => x.type === 'page'); if (tab) break; } catch {}
  }
  if (!tab) throw new Error('调试页面启动失败');
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  let seq = 0; const pending = new Map(); const consoleErrors = [];
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const p = pending.get(m.id); pending.delete(m.id);
      m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result); return;
    }
    if (m.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(m.params.type)) {
      consoleErrors.push(`[${m.params.type}] ${m.params.args.map((a) => a.value ?? a.description ?? a.type).join(' ')}`);
    }
    if (m.method === 'Runtime.exceptionThrown') consoleErrors.push('[exception] ' + (m.params.exceptionDetails.text || 'exception'));
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++seq; pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error(`timeout ${method}`)); } }, 30000);
  });
  const evalJS = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text || '页面脚本异常');
    return r.result?.value;
  };
  const capture = async (name, width, height, setup = '') => {
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 700 });
    await evalJS(setup || 'true');
    await wait(800);
    const shot = await send('Page.captureScreenshot', { format: 'png', fromSurface: true });
    fs.writeFileSync(path.join(OUT, `${name}-${width}x${height}.png`), Buffer.from(shot.data, 'base64'));
    const metrics = await evalJS(`(() => {
      const c = document.getElementById('scene');
      const r = c?.getBoundingClientRect();
      const visible = (e) => { if (!e) return false; const s=getComputedStyle(e), b=e.getBoundingClientRect(); return s.display !== 'none' && s.visibility !== 'hidden' && b.width > 0 && b.height > 0; };
      const overlayOpen = visible(document.getElementById('overlay'));
      const candidates = overlayOpen ? ['#overlay'] : ['.hud-top','.hud-left','.hud-right','.crosshair','#setSheet','#helpSheet'];
      const els = candidates.map(s=>document.querySelector(s)).filter(visible);
      const overlaps = [];
      for (let i=0;i<els.length;i++) for (let j=i+1;j<els.length;j++) { const a=els[i].getBoundingClientRect(), b=els[j].getBoundingClientRect(); const area=Math.max(0,Math.min(a.right,b.right)-Math.max(a.left,b.left))*Math.max(0,Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)); if (area > 300) overlaps.push([els[i].id||els[i].className,els[j].id||els[j].className,Math.round(area)]); }
      const levelOptions = [...document.querySelectorAll('.level-option')];
      const vm = window.__game?.viewModel;
      const pawLeft = vm?.paws.userData.left;
      const pawRight = vm?.paws.userData.right;
      const paws = pawLeft && pawRight ? {
        leftZ: +pawLeft.position.z.toFixed(3), rightZ: +pawRight.position.z.toFixed(3),
        forwardFacing: pawLeft.children.filter(x=>x.geometry?.type==='ConeGeometry').every(x=>x.position.z<0 && x.rotation.x<0),
        clawsExtendPastPalm: Math.max(...pawLeft.children.filter(x=>x.geometry?.type==='ConeGeometry').map(x=>x.position.z)) < -0.08,
        armsVisible: vm.paws.userData.arms.left.children.length>0 && vm.paws.userData.arms.right.children.length>0,
        groundedPose: vm.paws.position.y < 0.04,
      } : null;
      const back = document.getElementById('selectBackBtn')?.getBoundingClientRect();
      const levelBackVisible = !!back && back.top >= 0 && back.bottom <= innerHeight && back.left >= 0 && back.right <= innerWidth;
      const info = window.__game ? { mode: window.__game.game.mode, foxes: window.__game.foxes().map(f=>({ real:!!f.realModel, realVisible:!!f.realModel?.visible, proc:f.proceduralMesh.visible, level:f.modelLevel })), content: document.getElementById('mission')?.textContent || '', levelCount: window.__game.LEVELS.length, levelOptions: levelOptions.length, lockedOptions: levelOptions.filter(x=>x.disabled).length, levelBackVisible, paws } : null;
      const sheetOpen = !document.getElementById('setSheet')?.hidden;
      const hudOpacity = getComputedStyle(document.querySelector('.hud-top')).opacity;
      const panelRect = sheetOpen ? document.getElementById('setSheet').getBoundingClientRect() : null;
      const panelFits = !panelRect || (panelRect.left >= 0 && panelRect.top >= 0 && panelRect.right <= innerWidth && panelRect.bottom <= innerHeight);
      return { canvas: [c?.width||0,c?.height||0], canvasRect: r ? [Math.round(r.width),Math.round(r.height)] : null, visibleUi: els.map(e=>e.id||e.className), overlaps, sheetOpen, hudOpacity, panelFits, info };
    })()`);
    return metrics;
  };
  await new Promise((r) => ws.addEventListener('open', r, { once: true }));
  await send('Runtime.enable'); await send('Page.enable');
  await send('Page.navigate', { url: BASE });
  await wait(6000);
  const scenarios = [
    ['title', 1280, 720, 'document.exitPointerLock?.();'],
    ['title-narrow', 390, 844, 'document.exitPointerLock?.();'],
    ['level-select', 1280, 720, `document.getElementById('levelSelectBtn')?.click()`],
    ['level-select-narrow', 390, 844, `document.getElementById('levelSelectBtn')?.click()`],
    ['play', 1280, 720, `(() => { document.getElementById('selectBackBtn')?.click(); const b=[...document.querySelectorAll('button')].find(x=>/从第 .* 关继续|进入草原|开始|start/i.test(x.textContent)); if(b) b.click(); return true; })()`],
  ];
  const results = [];
  for (const [name,w,h,setup] of scenarios) results.push({ name, width:w, height:h, ...(await capture(name,w,h,setup)) });
  await wait(1200);
  results.push({ name:'play-narrow', width:390, height:844, ...(await capture('play-narrow',390,844,'document.exitPointerLock?.();')) });
  const freezeViewModel = (crouch, speed, airborne=false) => `(() => {
    document.exitPointerLock?.();
    const c=window.__game.controller, update=c.update.bind(c);
    c.update=(...args)=>{ update(...args); c.crouch=${crouch}; c.postureSpeed=${speed}; c.grounded=${!airborne}; };
    window.__game.viewModel.t=0.24;
    return true;
  })()`;
  results.push({ name:'paws-stand', width:1280, height:720, ...(await capture('paws-stand',1280,720,freezeViewModel(0,0))) });
  results.push({ name:'paws-run', width:1280, height:720, ...(await capture('paws-run',1280,720,freezeViewModel(1,1))) });
  results.push({ name:'paws-run-narrow', width:390, height:844, ...(await capture('paws-run-narrow',390,844,freezeViewModel(1,1))) });
  results.push({ name:'fox-closeup', width:1280, height:720, ...(await capture('fox-closeup',1280,720,`(() => {
    const g=window.__game, f=g.foxes()[0], dir=new g.THREE.Vector3();
    g.camera.getWorldDirection(dir);
    const p=g.camera.position;
    f.x=p.x+dir.x*3.2; f.z=p.z+dir.z*3.2; f.baseY=0; f.yaw=Math.atan2(p.x-f.x,p.z-f.z);
    f.state='roam'; f.leap=0; f.mesh.position.set(f.x,f.baseY,f.z); f.mesh.rotation.set(0,f.yaw,0); f.mesh.scale.setScalar(f.cfg.scale*1.05);
    f.update=()=>{ f.mesh.position.set(f.x,f.baseY,f.z); f.mesh.rotation.set(0,f.yaw,0); };
    if(f.proceduralMesh)f.proceduralMesh.visible=!f.realModel; if(f.realModel)f.realModel.visible=true;
    return true;
  })()`)) });
  const progression = await evalJS(`(async () => {
    const g=window.__game, cfg=g.LEVELS[0];
    g.game.foodCount=cfg.goal; g.game.levelRepels=cfg.repels;
    g.game.friend.rescued=true; g.game.friend.saved=true; g.companion.rescued=true; g.companion.saved=true;
    g.game.bossDown=true;
    g.controller.teleport(g.burrow.x+4, g.burrow.z+2, 0);
    await new Promise(r=>setTimeout(r,250));
    const clearMode=g.game.mode;
    const saved=JSON.parse(localStorage.getItem('marmot3d.progress.v1')||'{}');
    const unlocked=saved.maxUnlocked;
    document.getElementById('nextBtn')?.click();
    await new Promise(r=>setTimeout(r,250));
    const seasons=Array.from({length:g.LEVELS.length},(_,i)=>g.ecology.seasonForLevel(i).season);
    const levelDataValid=g.LEVELS.every(x=>x.name&&x.brief&&x.count>=1&&x.goal>=1&&x.repels>=1&&Array.isArray(x.types));
    return { clearMode, unlocked, nextLevel:g.game.level, count:g.LEVELS.length, seasons, levelDataValid };
  })()`);
  results.push({ name:'pause', width:1280, height:720, ...(await capture('pause',1280,720,`window.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyP',key:'p',bubbles:true}));`)) });
  results.push({ name:'settings', width:1280, height:720, ...(await capture('settings',1280,720,`(() => { document.getElementById('overlay').hidden=true; document.getElementById('setBtn').click(); return true; })()`)) });
  const modelPass = (r) => !r.info || r.info.foxes.every(f => EXPECT_REAL_MODEL ? (f.real && f.realVisible !== f.proc) : (f.proc && !f.realVisible));
  const report = { base: BASE, runMode: RUN_MODE, generatedAt: new Date().toISOString(), progression, results, consoleErrors, pass: progression.clearMode==='levelclear' && progression.unlocked===1 && progression.nextLevel===1 && progression.count===12 && progression.levelDataValid && new Set(progression.seasons).size===5 && results.every((r) => r.canvas[0] > 0 && r.canvas[1] > 0 && r.canvasRect?.[0] > 0 && r.canvasRect?.[1] > 0 && (r.overlaps.length === 0 || (r.name==='settings' && r.sheetOpen && Number(r.hudOpacity) <= 0.2)) && (!r.info || !r.info.content.includes('undefined')) && (r.name.startsWith('level-select') ? (r.info.levelCount===12 && r.info.levelOptions===12 && r.info.lockedOptions===11 && r.info.levelBackVisible) : true) && (r.name.startsWith('paws-') ? (r.info.paws?.forwardFacing && r.info.paws?.clawsExtendPastPalm && r.info.paws?.armsVisible && r.info.paws?.groundedPose) : true) && (r.name==='paws-run' ? (Math.abs(r.info.paws.leftZ-r.info.paws.rightZ)>0.03) : true) && modelPass(r) && (r.name!=='settings' || (r.sheetOpen && Number(r.hudOpacity) <= 0.2 && r.panelFits))) && results.some(r=>r.name==='play' && r.info?.mode==='play') && results.some(r=>r.name==='pause' && r.info?.mode==='pause') && results.some(r=>r.name==='fox-closeup' && r.info?.foxes.every(f=>EXPECT_REAL_MODEL ? f.realVisible && !f.proc : f.proc && !f.realVisible)) && consoleErrors.filter((x) => x.startsWith('[error]') || x.startsWith('[exception]')).length === 0 };
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  ws.close(); chrome.kill();
  process.exit(report.pass ? 0 : 1);
})().catch((e) => { console.error(e.stack || e); process.exit(1); });
