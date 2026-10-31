// Independent probe: why does dev page fail to set window.__game after round2 re-export?
const fs=require('node:fs'), path=require('node:path'), http=require('node:http');
const ROOT=path.resolve(process.cwd());
const PORT=8351;
const MIME={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.json':'application/json','.glb':'model/gltf-binary','.bin':'application/octet-stream','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp','.css':'text/css','.svg':'image/svg+xml','.wasm':'application/wasm'};
const server=http.createServer((req,res)=>{
  let rel=decodeURIComponent(req.url.split('?')[0]); if(rel==='/')rel='/index.html';
  const f=path.join(ROOT,path.normalize(rel).replace(/^(\.\.[\/\\])+/,''));
  if(!f.startsWith(ROOT))return res.writeHead(403).end();
  fs.readFile(f,(e,d)=>{ if(e){console.log('404',rel);return res.writeHead(404).end('404');} res.writeHead(200,{'Content-Type':MIME[path.extname(f).toLowerCase()]||'application/octet-stream','Cache-Control':'no-store'}); res.end(d); });
});
const get=u=>new Promise((res,rej)=>{http.get(u,r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>res(d));}).on('error',rej);});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
class CDP{constructor(u){this.u=u;this.seq=0;this.p=new Map();this.ev=[];}
 async connect(){this.ws=new WebSocket(this.u);this.ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.id&&this.p.has(m.id)){const x=this.p.get(m.id);this.p.delete(x);m.error?x.rej(new Error(JSON.stringify(m.error))):x.res(m.result);}else if(m.method)this.ev.push(m);});await new Promise((r,j)=>{this.ws.addEventListener('open',r,{once:true});this.ws.addEventListener('error',j,{once:true});});}
 send(m,p={}){return new Promise((res,rej)=>{const id=++this.seq;this.p.set(id,{res,rej});this.ws.send(JSON.stringify({id,method:m,params:p}));setTimeout(()=>{if(this.p.has(id)){this.p.delete(id);rej(new Error('timeout '+m));}},60000);});}
 async evl(e){const r=await this.send('Runtime.evaluate',{expression:e,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)return {__evalError:JSON.stringify(r.exceptionDetails).slice(0,400)};return r.result?.value;}
 close(){try{this.ws.close();}catch(_){}}}
(async()=>{
  await new Promise(r=>server.listen(PORT,'127.0.0.1',r));
  const url=`http://127.0.0.1:${PORT}/index.html?version=dev&webgl=1&models=off&verdantTier=low&probe=${Date.now()}`;
  const ver=JSON.parse(await get('http://127.0.0.1:18800/json/version'));
  const br=new CDP(ver.webSocketDebuggerUrl); await br.connect();
  const ct=await br.send('Target.createTarget',{url:'about:blank'}); const tid=ct.targetId;
  let info; for(let i=0;i<40;i++){const l=JSON.parse(await get('http://127.0.0.1:18800/json/list'));info=l.find(x=>x.id===tid&&x.type==='page');if(info)break;await sleep(250);}
  const pg=new CDP(info.webSocketDebuggerUrl); await pg.connect();
  await pg.send('Runtime.enable');await pg.send('Page.enable');await pg.send('Log.enable');await pg.send('Network.enable');
  const failed=[], consoleErr=[];
  await pg.send('Page.navigate',{url});
  const t0=Date.now(); let readyAt=-1;
  for(let i=0;i<90;i++){
    await sleep(1000);
    for(const e of pg.ev.splice(0)){
      if(e.method==='Network.loadingFailed'){const p=e.params; failed.push({url:pg._urlMap?.get(p.requestId)||p.requestId,err:p.errorText,type:p.type});}
      if(e.method==='Network.requestWillBeSent'){(pg._urlMap=pg._urlMap||new Map()).set(e.params.requestId,e.params.request.url);}
      if(e.method==='Runtime.exceptionThrown')consoleErr.push((e.params.exceptionDetails.exception?.description||e.params.exceptionDetails.text||'exc').slice(0,300));
      if(e.method==='Runtime.consoleAPICalled'&&e.params.type==='error')consoleErr.push((e.params.args||[]).map(a=>a.value||a.description||'').join(' ').slice(0,300));
      if(e.method==='Log.entryAdded'&&e.params.entry.level==='error')consoleErr.push(e.params.entry.text.slice(0,300));
    }
    const rdy=await pg.evl('!!window.__game').catch(()=>false);
    if(rdy&&readyAt<0){readyAt=(Date.now()-t0)/1000;break;}
  }
  const probe=await pg.evl(`({href:location.href,title:document.title,ready:!!window.__game,body:(document.body?.innerText||'').slice(0,600),scripts:[...document.scripts].map(s=>s.src.split('/').pop()),hf:!!window.__game?.heightFieldActive,env:!!window.__game?.scene?.getObjectByName?.('VerdantTrailEnvironment')})`);
  // map failed urls
  const failedNamed=failed.map(f=>({url:pg._urlMap?.get(f.url)||f.url,err:f.err,type:f.type})).filter(f=>!String(f.url).includes('/favicon'));
  const report={readyAt,probe,failed:failedNamed.slice(0,20),consoleErrors:[...new Set(consoleErr)].slice(0,20)};
  fs.mkdirSync('outputs/scene-boot-probe',{recursive:true});
  fs.writeFileSync('outputs/scene-boot-probe/boot-probe.json',JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
  await br.send('Target.closeTarget',{targetId:tid});pg.close();br.close();server.close();
  process.exit(0);
})().catch(e=>{console.error(e.stack||e);process.exit(1);});
