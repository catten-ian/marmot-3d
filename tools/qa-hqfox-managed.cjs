/**
 * dev 高质量贴图狐狸渲染验证（内嵌静态服务器 + OpenClaw 托管 Chrome CDP）。
 * 打开 ?version=dev&webgl=1，进游戏，把一只狐狸摆到镜头前，多角度截图。
 */
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');

const ROOT = path.resolve(__dirname, '..');
const PORT = 8327;
const OUT = path.join(ROOT, 'outputs', 'hqfox-qa');
fs.mkdirSync(OUT, { recursive: true });
const MIME = { '.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.glb':'model/gltf-binary','.woff2':'font/woff2','.spz':'application/octet-stream','.bin':'application/octet-stream','.ktx2':'application/octet-stream' };
const server = http.createServer((req,res)=>{
  let rel=decodeURIComponent(req.url.split('?')[0]); if(rel==='/')rel='/index.html';
  const f=path.join(ROOT,path.normalize(rel).replace(/^(\.\.[\/\\])+/,''));
  if(!f.startsWith(ROOT)){res.writeHead(403).end('403');return;}
  fs.readFile(f,(e,d)=>{ if(e){res.writeHead(404).end('404');return;} res.writeHead(200,{'Content-Type':MIME[path.extname(f).toLowerCase()]||'application/octet-stream','Cache-Control':'no-cache'});res.end(d); });
});

const CDP='http://127.0.0.1:18800';
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const hj=async(u,o)=>{const r=await fetch(u,o);return r.json();};

async function main(){
  await new Promise(r=>server.listen(PORT,'127.0.0.1',r));
  console.log('serve on',PORT);
  const URL='http://127.0.0.1:'+PORT+'/index.html?version=dev&webgl=1&t='+Date.now();
  let tab; const nu=CDP+'/json/new?'+encodeURIComponent(URL);
  try{tab=await hj(nu,{method:'PUT'});}catch{tab=await hj(nu,{method:'GET'});}
  const ws=new WebSocket(tab.webSocketDebuggerUrl);
  let seq=0;const pend=new Map();const errs=[];
  ws.onmessage=e=>{const m=JSON.parse(e.data);
    if(m.id&&pend.has(m.id)){pend.get(m.id)(m);pend.delete(m.id);}
    else if(m.method==='Runtime.exceptionThrown')errs.push('EXC '+(m.params.exceptionDetails?.exception?.description||m.params.exceptionDetails?.text||''));
    else if(m.method==='Runtime.consoleAPICalled'&&m.params.type==='error')errs.push('ERR '+m.params.args.map(a=>a.value??a.description??a.type).join(' ').slice(0,200));
  };
  const send=(method,params={})=>new Promise(res=>{const id=++seq;pend.set(id,res);ws.send(JSON.stringify({id,method,params}));});
  const ev=async expr=>{const r=await send('Runtime.evaluate',{expression:expr,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw new Error((r.exceptionDetails.exception?.description||r.exceptionDetails.text||'').slice(0,300));return r.result?.value;};
  const shot=async n=>{const s=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(OUT,n+'.png'),Buffer.from(s.data,'base64'));console.log(' shot',n);};

  await new Promise(r=>ws.onopen=r);
  await send('Runtime.enable');await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride',{width:1280,height:720,deviceScaleFactor:1,mobile:false});
  await send('Page.navigate',{url:URL});
  let ready=false;
  for(let i=0;i<90;i++){await wait(1000);ready=await ev('!!window.__game').catch(()=>false);if(ready)break;}
  if(!ready)throw new Error('__game not ready. errs: '+errs.slice(0,5).join(' | '));
  await wait(2000);

  // 开始游戏
  await ev(`document.getElementById('startBtn')&&document.getElementById('startBtn').click()`).catch(()=>{});
  await wait(3000);
  await ev(`document.getElementById('overlay')&&document.getElementById('overlay').setAttribute('hidden','')`).catch(()=>{});

  // 找一只真狐狸，放到镜头前，第三人称
  const info=await ev(`(async()=>{
    const g=window.__game; await new Promise(r=>setTimeout(r,1500));
    const fs=g.foxes().filter(f=>!f.isSandboxDummy);
    return { foxes:g.foxes().length, real:fs.length,
      modelLevel: fs[0]?.modelLevel, hasReal:!!fs[0]?.realModel,
      hasTex: (()=>{let t=false; fs[0]?.realModel?.traverse(o=>{if(o.isMesh){const ms=Array.isArray(o.material)?o.material:[o.material];if(ms.some(m=>m&&m.map))t=true;}});return t;})(),
      isDev:g.isDev, mode:g.game.mode };
  })()`);
  console.log('INFO',JSON.stringify(info));

  // 把第一只狐狸摆到玩家前方 4m，正对镜头；第一人称特写
  await ev(`(()=>{const g=window.__game,f=g.foxes().find(x=>!x.isSandboxDummy),c=g.controller,p=g.game.player;
    if(!f)return; const y=c.bodyYaw; f.x=p.x+Math.sin(y)*4; f.z=p.z+Math.cos(y)*4; f.yaw=y+Math.PI;
    f.state='roam'; f.leap=0;
  })()`);
  await wait(1200);
  await shot('fp-fox-close');

  // 再放 9m 全身
  await ev(`(()=>{const g=window.__game,f=g.foxes().find(x=>!x.isSandboxDummy),c=g.controller,p=g.game.player;
    const y=c.bodyYaw; f.x=p.x+Math.sin(y)*9; f.z=p.z+Math.cos(y)*9; f.yaw=y+Math.PI; f.state='roam';})()`);
  await wait(1200);
  await shot('fp-fox-far');

  // 第三人称：玩家与狐狸同框
  await ev(`window.__game.setViewMode&&window.__game.setViewMode(true)`).catch(()=>{});
  await ev(`(()=>{const g=window.__game,f=g.foxes().find(x=>!x.isSandboxDummy),c=g.controller,p=g.game.player;
    const y=c.bodyYaw; f.x=p.x+Math.sin(y)*5; f.z=p.z+Math.cos(y)*5; f.yaw=y+Math.PI; f.state='roam';})()`);
  await wait(1500);
  await shot('tp-player-fox');

  // 渲染器/贴图诊断
  const diag=await ev(`(()=>{const g=window.__game,f=g.foxes().find(x=>!x.isSandboxDummy);
    const mats=[]; f?.realModel?.traverse(o=>{if(o.isMesh){const ms=Array.isArray(o.material)?o.material:[o.material];
      ms.forEach(m=>{if(m)mats.push({name:m.name,hasMap:!!m.map,mapSize:m.map?m.map.image?.width+'x'+m.map.image?.height:null,rough:m.roughness});});}});
    return {modelLevel:f?.modelLevel,hasReal:!!f?.realModel,mats};})()`);
  console.log('DIAG',JSON.stringify(diag));
  fs.writeFileSync(path.join(OUT,'report.json'),JSON.stringify({info,diag,errors:errs},null,2));
  console.log('errors:',errs.length); errs.slice(0,8).forEach(e=>console.log(' ',e.slice(0,160)));
  await fetch(CDP+'/json/close/'+tab.id).catch(()=>{});ws.close();server.close();
  const ok=info.hasReal && diag.mats.some(m=>m.hasMap);
  console.log(ok?'\nPASS ✅ 贴图狐狸已渲染':'\nCHECK ⚠️ 未检测到贴图网格');
  process.exit(ok?0:2);
}
main().catch(e=>{console.error('FATAL',e);process.exit(1);});
