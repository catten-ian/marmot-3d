const { spawn } = require('node:child_process');
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
const http = require('node:http');
const PORT=18800, OUT=path.resolve('outputs/marmot-rig-visual');
const wait=(n)=>new Promise(r=>setTimeout(r,n));
const getJson=(url)=>new Promise((resolve,reject)=>{http.get(url,r=>{let s='';r.on('data',c=>s+=c);r.on('end',()=>{try{resolve(JSON.parse(s))}catch(e){reject(e)}})}).on('error',reject)});
(async()=>{
 fs.mkdirSync(OUT,{recursive:true}); const chrome=null; let targetId=null;
 let ws; try {
  let target; for(let i=0;i<100;i++){await wait(200);try{const list=await getJson(`http://127.0.0.1:${PORT}/json/list`);target=list.find(x=>x.type==='page' && x.url.includes('127.0.0.1:8700'));if(target)break;}catch{}}
  if(!target){const browser=await getJson(`http://127.0.0.1:${PORT}/json/version`);const bws=new WebSocket(browser.webSocketDebuggerUrl);await new Promise((res,rej)=>{bws.addEventListener('open',res,{once:true});bws.addEventListener('error',rej,{once:true})});let bid=0;const bp=new Map();bws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.id&&bp.has(m.id)){const p=bp.get(m.id);bp.delete(m.id);p(m.result)}});const create=()=>new Promise(res=>{const n=++bid;bp.set(n,res);bws.send(JSON.stringify({id:n,method:'Target.createTarget',params:{url:'http://127.0.0.1:8700/index.html?version=beta'}}))});targetId=(await create()).targetId;bws.close();for(let i=0;i<100;i++){await wait(200);try{target=(await getJson(`http://127.0.0.1:${PORT}/json/list`)).find(x=>x.id===targetId);if(target)break}catch{}}}
  if(!target)throw Error('Chrome CDP failed'); ws=new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res,rej)=>{ws.addEventListener('open',res,{once:true});ws.addEventListener('error',rej,{once:true})});
  let id=0; const pending=new Map(); ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.id&&pending.has(m.id)){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result)}});
  const send=(method,params={})=>new Promise((resolve,reject)=>{const n=++id;pending.set(n,{resolve,reject});ws.send(JSON.stringify({id:n,method,params}));setTimeout(()=>{if(pending.has(n)){pending.delete(n);reject(Error(method+' timeout'))}},30000)});
  const ev=async expression=>{const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.text);return r.result?.value};
  await send('Runtime.enable'); await send('Page.enable'); await send('Page.navigate',{url:'http://127.0.0.1:8700/index.html?version=beta'});
  let ready=false;for(let i=0;i<120;i++){await wait(500);try{ready=await ev('!!window.__game?.companion');if(ready)break}catch{}}
  if(!ready)throw Error('Game not ready');
  await wait(9000);
  const init=await ev(`(() => {const g=window.__game,c=g.companion;document.getElementById('startBtn')?.click();g.setViewMode?.(true);g.controller.teleport(0,0,0);const d=new g.THREE.Vector3();g.camera.getWorldDirection(d);c.placeAt(g.camera.position.x+d.x*5,g.camera.position.z+d.z*5);c.rescued=false;return {beta:g.isBeta,level:c.modelLevel,real:!!c.realModel,clip:c.activeClip,mixer:!!c.mixer,animations:[...c.actions.keys()],pos:[c.x,c.z]}})()`);
  await wait(2500);
  const sample=async(name)=>{const {data}=await send('Page.captureScreenshot',{format:'png',fromSurface:true});const file=path.join(OUT,name+'.png');fs.writeFileSync(file,Buffer.from(data,'base64'));return file};
  const idle=await sample('rig-idle-front');
  await ev(`(() => {const c=window.__game.companion;c.showEmote('check');return true})()`); await wait(80); const biteStart=await sample('rig-transition-bite-start'); await wait(100); const biteMid=await sample('rig-transition-bite-mid'); await wait(300); const bite=await sample('rig-transition-bite-settled');
  await ev(`(() => {const c=window.__game.companion;c.emote=null;c.rescued=true;c.x=0;c.z=-5;c._setRigClip('Run');window.__game.controller.teleport(0,0,0);return true})()`); await wait(900); const run=await sample('rig-follow-run');
  const final=await ev(`(() => {const c=window.__game.companion;return {level:c.modelLevel,clip:c.activeClip,beta:window.__game.isBeta,actions:[...c.actions.keys()],metalness:(()=>{let v=[];c.realModel?.traverse(o=>{if(o.isMesh)for(const m of (Array.isArray(o.material)?o.material:[o.material]))if(m)v.push(m.metalness)});return [...new Set(v)]})()}})()`);
  console.log(JSON.stringify({init,final,shots:[idle,biteStart,biteMid,bite,run]},null,2));
 } finally {if(ws)ws.close();if(targetId){try{const browser=await getJson(`http://127.0.0.1:${PORT}/json/version`);const bws=new WebSocket(browser.webSocketDebuggerUrl);await new Promise(res=>bws.addEventListener('open',res,{once:true}));bws.send(JSON.stringify({id:99,method:'Target.closeTarget',params:{targetId}}));setTimeout(()=>bws.close(),300)}catch{}}chrome?.kill('SIGTERM')}
})().catch(e=>{console.error(e);process.exitCode=1});
