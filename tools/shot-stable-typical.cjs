/**
 * 通过 OpenClaw 托管 Chrome（CDP 18800，宿主真实 GPU）渲染本地 stable rev12 工作树。
 * 不自己起 Chrome（exec 沙箱里多进程 zygote 挂起 / single-process 遇 WebGL 段错误）。
 * serve.cjs 需已在 127.0.0.1:8321 运行。
 *
 * 用法：node tools/shot-via-managed.cjs
 * 输出：outputs/stable-typical/*.png
 */
const fs = require('node:fs');
const path = require('node:path');

const CDP_HTTP = 'http://127.0.0.1:18800';
const TARGET_URL = 'http://127.0.0.1:8321/index.html?t=' + Date.now();
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'outputs', 'stable-typical');
fs.mkdirSync(OUT, { recursive: true });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const SHOTS = ['title', 'fp-idle-remote', 'fp-approach', 'fox-closeup', 'third-person-grounded', 'overhead-field'];

async function httpJson(u, opts) {
  const r = await fetch(u, opts);
  return r.json();
}

async function main() {
  const report = { target: TARGET_URL, screenshots: [], errors: [] };

  // 新建标签页（Chrome 要求 PUT /json/new）
  let tab;
  const newUrl = CDP_HTTP + '/json/new?' + encodeURIComponent(TARGET_URL);
  try { tab = await httpJson(newUrl, { method: 'PUT' }); }
  catch (_) { tab = await httpJson(newUrl, { method: 'GET' }); }
  if (!tab || !tab.webSocketDebuggerUrl) throw new Error('无法新建标签页: ' + JSON.stringify(tab).slice(0, 300));
  console.log('新标签页:', tab.id, tab.url);

  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  let seq = 0;
  const pending = new Map();
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result); }
    else if (m.method === 'Runtime.exceptionThrown') report.errors.push('[exception] ' + (m.params.exceptionDetails?.text || 'x'));
    else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') report.errors.push('[error] ' + m.params.args.map(a => a.value ?? a.description ?? a.type).join(' '));
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++seq; pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error('timeout ' + method)); } }, 60000);
  });
  const evalJS = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text || JSON.stringify(r.exceptionDetails.exception || {}).slice(0, 300));
    return r.result?.value;
  };

  await new Promise((res) => ws.addEventListener('open', res, { once: true }));
  await send('Runtime.enable'); await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });

  // 可能 new 时没带成功导航，显式再导航一次
  await send('Page.navigate', { url: TARGET_URL });

  let ready = false;
  for (let i = 0; i < 90; i++) { await wait(1000); ready = await evalJS('!!window.__game').catch(() => false); if (ready) break; }
  if (!ready) throw new Error('window.__game 未就绪');
  let modelReady = false;
  for (let i = 0; i < 30; i++) { modelReady = await evalJS('!!(window.__game.foxes&&window.__game.foxes()[0]&&window.__game.foxes()[0].realModel)').catch(()=>false); if (modelReady) break; await wait(500); }
  await wait(2000);

  report.initial = await evalJS(`(()=>{const g=window.__game,f=g.foxes()[0];return{isDev:g.isDev,mode:g.game.mode,foxes:g.foxes().length,foxReal:!!f.realModel,verdict:document.body.innerText.match(/Verdant[^\\n]{0,30}/)?.[0]||null};})()`);
  console.log('场景:', JSON.stringify(report.initial));

  const shot = async (name) => {
    const s = await send('Page.captureScreenshot', { format: 'png' });
    const file = path.join(OUT, name + '.png');
    fs.writeFileSync(file, Buffer.from(s.data, 'base64'));
    report.screenshots.push({ file: path.relative(ROOT, file), bytes: fs.statSync(file).size });
    console.log('  截图:', name);
  };
  const settle = (ms) => wait(ms);

  await shot('title');
  await evalJS(`document.getElementById('startBtn')&&document.getElementById('startBtn').click()`);
  await settle(2200);

  // 用游戏真实出生机位（设计师选定）；暗色谷地+悬浮岩石是 Verdant Trail 的既定美术。
  const pose = await evalJS(`(() => { const g=window.__game,c=g.controller; return {x:+c.position.x.toFixed(3),z:+c.position.z.toFixed(3),y:+c.position.y.toFixed(3),yaw:+c.yaw.toFixed(3)}; })()`);
  report.spawnPose = pose; console.log('出生机位:', JSON.stringify(pose));
  if(!pose) throw new Error('出生机位不可用');

  // 在玩家朝向上，找与眼高齐平、沿线梯度小的放狐距离
  const findDist = async (pref) => evalJS(`(() => {
    const g=window.__game,T=g.terrainHeight, yaw=${pose.yaw};
    const fx=-Math.sin(yaw), fz=-Math.cos(yaw), ex=${pose.x}, ez=${pose.z}, ey=${pose.y};
    const grad=(x,z)=>Math.max(Math.abs(T(x+1,z)-T(x-1,z))/2,Math.abs(T(x,z+1)-T(x,z-1))/2);
    const cands=[];
    for(let d=2.2; d<=17; d+=0.4){
      const x=ex+fx*d, z=ez+fz*d;
      const y=T(x,z);
      // 狐狸脚面相对玩家眼高不能太高/太低；狐狸所在局部要平；玩家到狐狸之间不能有上坡墙
      let corridor=true,maxGrad=0;
      for(let k=0;k<=d;k+=1){const cx=ex+fx*k,cz=ez+fz*k;const gr=grad(cx,cz);maxGrad=Math.max(maxGrad,gr); if(gr>0.22){corridor=false;break;} if(T(cx,cz)-ey>1.4){corridor=false;break;}}
      if(corridor && Math.abs(y-ey)<1.2 && grad(x,z)<0.15) cands.push({d:+d.toFixed(2),y:+y.toFixed(2),maxGrad:+maxGrad.toFixed(2)});
    }
    if(!cands.length) return null;
    // 选离期望距离最近的
    cands.sort((a,b)=>Math.abs(a.d-${pref})-Math.abs(b.d-${pref}));
    return cands[0];
  })()`);

  const placeFoxAt = async (prefDist) => {
    const spot = await findDist(prefDist);
    report['foxSpot_'+prefDist] = spot;
    if(!spot) return null;
    await evalJS(`(()=>{const g=window.__game,f=g.foxes()[0],yaw=${pose.yaw},fx=-Math.sin(yaw),fz=-Math.cos(yaw);f.x=${pose.x}+fx*${spot.d};f.z=${pose.z}+fz*${spot.d};f.yaw=yaw+Math.PI;f.state='rest';f.timer=999;f.hp=f.maxHp||f.hp;if(f.mesh)f.mesh.visible=true;return true;})()`);
    return spot;
  };

  await evalJS(`(()=>{const g=window.__game;g.game.mode='play';g.setViewMode(false);return true;})()`);
  let s;
  s = await placeFoxAt(13); console.log('idle 狐狸点:', JSON.stringify(s)); await settle(1000); await shot('fp-idle-remote');
  s = await placeFoxAt(6.5); console.log('approach 狐狸点:', JSON.stringify(s)); await settle(600); await shot('fp-approach');
  s = await placeFoxAt(2.6); console.log('closeup 狐狸点:', JSON.stringify(s)); await settle(700); await shot('fox-closeup');

  // 第三人称电影机位：把玩家沿朝向移到前方平坦小径（避开身后的洞口半球），
  // 狐狸再放前，暂停后相机抬升到身后 6m/高 3.4m 俯拍，玩家后背入镜。
  const tp = await evalJS(`(()=>{
    const g=window.__game,T=g.terrainHeight,yaw=${pose.yaw},fx=-Math.sin(yaw),fz=-Math.cos(yaw),ex=${pose.x},ez=${pose.z};
    const grad=(x,z)=>Math.max(Math.abs(T(x+1,z)-T(x-1,z))/2,Math.abs(T(x,z+1)-T(x,z-1))/2);
    let pad=null;
    for(let pd=5;pd<=9;pd+=0.5){
      const px=ex+fx*pd,pz=ez+fz*pd;
      if(grad(px,pz)<0.12 && Math.abs(T(px,pz)-${pose.y})<1.2
        && grad(px-fx*5,pz-fz*5)<0.25){ pad={px,pz,pd}; break; }
    }
    if(!pad) pad={px:ex+fx*7,pz:ez+fz*7,pd:7};
    const fd=pad.pd+5, foxX=ex+fx*fd, foxZ=ez+fz*fd;
    const f=g.foxes()[0];f.x=foxX;f.z=foxZ;f.yaw=yaw+Math.PI;f.state='rest';f.timer=999;f.hp=f.maxHp||f.hp;if(f.mesh)f.mesh.visible=true;
    g.setViewMode(true);g.controller.teleport(pad.px,pad.pz,yaw);g.game.mode='pause';
    const py=T(pad.px,pad.pz);
    g.camera.position.set(pad.px-fx*6.2,py+3.4,pad.pz-fz*6.2);
    g.camera.lookAt(pad.px+fx*2.5,py+0.8,pad.pz+fz*2.5);
    return {pad:{x:+pad.px.toFixed(2),z:+pad.pz.toFixed(2)},fox:{x:+foxX.toFixed(2),z:+foxZ.toFixed(2)},py:+py.toFixed(2)};
  })()`);
  console.log('第三人称机位:', JSON.stringify(tp));
  await settle(1300); await shot('third-person-grounded');

  // 俯瞰：暂停玩法，相机升到出生草地上方，朝玩家前方框景
  await evalJS(`(()=>{const g=window.__game,yaw=${pose.yaw},fx=-Math.sin(yaw),fz=-Math.cos(yaw);g.setViewMode(false);g.game.mode='pause';g.camera.position.set(${pose.x},30,${pose.z}+10);g.camera.lookAt(${pose.x},0,${pose.z}-6);return true;})()`);
  await settle(500); await shot('overhead-field');

  report.pass = report.screenshots.length === SHOTS.length;
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ pass: report.pass, shots: report.screenshots.map(s=>s.file), errors: report.errors.slice(0,10) }, null, 2));

  // 关掉这个标签页，别干扰托管浏览器
  await fetch(CDP_HTTP + '/json/close/' + tab.id).catch(()=>{});
  ws.close();
  process.exit(report.pass ? 0 : 1);
}

main().catch((e) => { console.error(e.stack || e); process.exit(1); });
