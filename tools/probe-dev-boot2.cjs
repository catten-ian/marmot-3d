// Robust dev-boot probe: always flushes a report; tolerates crashed renderer.
const fs=require('node:fs'), path=require('node:path'), http=require('node:http');
const ROOT=path.resolve(process.cwd()), PORT=8351, OUT='outputs/scene-boot-probe';
const MIME={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.json':'application/json','.glb':'model/gltf-binary','.bin':'application/octet-stream','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp','.css':'text/css','.svg':'image/svg+xml','.wasm':'application/wasm'};
fs.mkdirSync(OUT,{recursive:true});
const flush=(r)=>{fs.writeFileSync(path.join(OUT,'boot-probe.json'),JSON.stringify(r,null,2));};
let server;
const srv=http.createServer((req,res)=>{let rel=decodeURIComponent(req.url.split('?')[0]);if(rel==='/')rel='/index.html';const f=path.join(ROOT,path.normalize(rel).replace(/^(\.\.[\/\\])+/,''));if(!f.startsWith(ROOT))return res.writeHead(403).end();fs.readFile(f,(e,d)=>{if(e){return res.writeHead(404).end('404');}res.writeHead(200,{'Content-Type':MIME[path.extname(f).toLowerCase()]||'application/octet-stream','Cache-Control':'no-store'});res.end(d);});});
const get=u=>new Promise((res,rej)=>{const r=http.get(u,x=>{let d='';x.on('data',c=>d+=c);x.on('end',()=>res(d));});r.on('error',rej);r.setTimeout(5000,()=>r.destroy(new Error('get timeout')));});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
class CDP{constructor(u){this.u=u;this.seq=0;this.p=new Map();this.ev=[];this.urlById=new Map();}
 async connect(){this.ws=new WebSocket(this.u);this.ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.id&&this.p.has(m.id)){const x=this.p.get(m.id);this.p.delete(m.id);m.error?x[1](new Error(JSON.stringify(m.error).slice(0,200))):x[0](m.result);}else if(m.method){this.ev.push(m);if(m.method==='Network.requestWillBeSent')this.urlById.set(m.params.requestId,m.params.request.url);}});await new Promise((r,j)=>{this.ws.addEventListener('open',r,{once:true});this.ws.addEventListener('error',j,{once:true});});}
 _raw(m,p){return new Promise((res,rej)=>{const id=++this.seq;this.p.set(id,[res,rej]);this.ws.send(JSON.stringify({id,method:m,params:p}));});}
 send(m,p={},ms=8000){return Promise.race([this._raw(m,p),new Promise((_,rej)=>setTimeout(()=>rej(new Error('cdp-timeout '+m)),ms))]);}
 async evl(expr,ms=3000){try{const r=await this.send('Runtime.evaluate',{expression:expr,returnByValue:true,awaitPromise:true},ms);if(r.exceptionDetails)return {__err:JSON.stringify(r.exceptionDetails).slice(0,300)};return r.result?.value;}catch(e){return {__evalfail:String(e.message)};}}
 drain(){const out=this.ev.splice(0);this.ev.length=0;return out;}
 close(){try{this.ws.close();}catch(_){}}}
(async()=>{
 const report={startedAt:new Date().toISOString(),readyAt:-1,probe:null,failed:[],consoleErrors:[],crashed:null};
 try{
  await new Promise(r=>{server=srv.listen(PORT,'127.0.0.1',r);});
  const url=`http://127.0.0.1:${PORT}/index.html?version=dev&webgl=1&models=off&verdantTier=low&p=${Date.now()}`;
  const CDP_BASE='http://127.0.0.1:'+(process.env.CDP_PORT||'18800');
  const ver=JSON.parse(await get(CDP_BASE+'/json/version'));
  const br=new CDP(ver.webSocketDebuggerUrl); await br.connect();
  const ct=await br.send('Target.createTarget',{url:'about:blank'}); const tid=ct.targetId;
  let info=null; for(let i=0;i<40;i++){const l=JSON.parse(await get(CDP_BASE+'/json/list'));info=l.find(x=>x.id===tid&&x.type==='page');if(info)break;await sleep(250);}
  if(!info)throw new Error('target not found');
  const pg=new CDP(info.webSocketDebuggerUrl); await pg.connect();
  await pg.send('Runtime.enable');await pg.send('Page.enable');await pg.send('Log.enable');await pg.send('Network.enable');
  pg.ws.addEventListener('message',()=>{});
  await pg.send('Page.navigate',{url});
  const t0=Date.now();
  for(let i=0;i<70;i++){
    await sleep(1000);
    for(const e of pg.drain()){
      if(e.method==='Network.loadingFailed'){report.failed.push({err:e.params.errorText,type:e.params.type,url:(pg.urlById.get(e.params.requestId)||'').slice(-110)});}
      else if(e.method==='Runtime.exceptionThrown'){report.consoleErrors.push((e.params.exceptionDetails.exception?.description||e.params.exceptionDetails.text||'exc').slice(0,400));}
      else if(e.method==='Runtime.consoleAPICalled'&&e.params.type==='error'){report.consoleErrors.push((e.params.args||[]).map(a=>a.value||a.description||'').join(' ').slice(0,400));}
      else if(e.method==='Log.entryAdded'&&e.params.entry.level==='error'){report.consoleErrors.push(e.params.entry.text.slice(0,400));}
    }
    const rdy=await pg.evl('!!window.__game');
    if(rdy===true){report.readyAt=Math.round((Date.now()-t0)/1000);break;}
  }
  report.probe=await pg.evl(`({href:location.href,title:document.title,ready:!!window.__game,body:(document.body?document.body.innerText:'').slice(0,700),hf:!!(window.__game&&window.__game.heightFieldActive),env:!!(window.__game&&window.__game.scene&&window.__game.scene.getObjectByName&&window.__game.scene.getObjectByName('VerdantTrailEnvironment'))})`,4000);
  report.consoleErrors=[...new Set(report.consoleErrors)].slice(0,25);
  report.failed=report.failed.filter(f=>!String(f.url).includes('favicon')).slice(0,25);
  try{await br.send('Target.closeTarget',{targetId:tid});}catch(_){}
  pg.close();br.close();
 }catch(e){report.fatal=(e.stack||String(e)).slice(0,600);}
 flush(report);
 console.log(JSON.stringify(report,null,2));
 try{server.close();}catch(_){}
 process.exit(0);
})();
