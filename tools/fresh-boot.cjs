// Browser-level: create ONE fresh tab, enable domains BEFORE navigate, capture, always exit.
const http=require('node:http');
const fs=require('node:fs');
const get=u=>new Promise((res,rej)=>{const r=http.get(u,x=>{let d='';x.on('data',c=>d+=c);x.on('end',()=>res(d));});r.on('error',rej);r.setTimeout(5000,()=>r.destroy(new Error('getto')));});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const PORT=process.env.STATIC_PORT||'8351';
const SECS=+(process.env.SECS||'70');
const TIER=process.env.TIER||'low';
const OUT=process.env.OUT||'outputs/scene-boot-probe/fresh-boot.json';
class CDP{constructor(u,sessionId){this.u=u;this.sid=sessionId||null;this.seq=0;this.p=new Map();this.ev=[];this.urlById=new Map();}
 async connect(){this.ws=new WebSocket(this.u);this.ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.id&&this.p.has(m.id)){const x=this.p.get(m.id);this.p.delete(m.id);m.error?x[1](new Error(JSON.stringify(m.error).slice(0,150))):x[0](m.result);}else if(m.method==='Target.attachedToTarget'){this._attached=m.params;}else if(m.method&&(!this.sid||m.sessionId===this.sid)){this.ev.push(m);if(m.method==='Network.requestWillBeSent')this.urlById.set(m.params.requestId,m.params.request.url);}});await new Promise((r,j)=>{this.ws.addEventListener('open',r,{once:true});this.ws.addEventListener('error',j,{once:true});});}
 _raw(m,p){return new Promise((res,rej)=>{const id=++this.seq;this.p.set(id,[res,rej]);this.ws.send(JSON.stringify(Object.assign({id,method:m,params:p},this.sid?{sessionId:this.sid}:{})));});}
 send(m,p={}){return Promise.race([this._raw(m,p),new Promise((_,rej)=>setTimeout(()=>rej(new Error('tmo '+m)),10000))]);}
 async evl(e){try{const r=await this.send('Runtime.evaluate',{expression:e,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)return {__err:JSON.stringify(r.exceptionDetails).slice(0,250)};return r.result?.value;}catch(x){return {__fail:String(x.message)};}}
 drain(){const a=this.ev.splice(0);this.ev.length=0;return a;}
 close(){try{this.ws.close();}catch(_){}}}
const rep={startedAt:new Date().toISOString(),readyAt:-1,probe:null,failed:[],errors:[],closed:false};
const hard=setTimeout(()=>{try{fs.writeFileSync(OUT,JSON.stringify(rep,null,2));}catch(_){}console.log('HARD EXIT');process.exit(2);},(SECS+30)*1000);
(async()=>{
 try{
  const ver=JSON.parse(await get('http://127.0.0.1:18800/json/version'));
  const br=new CDP(ver.webSocketDebuggerUrl); await br.connect();
  // create target at about:blank then attach (flatten) so page-level commands route correctly
  const ct=await br.send('Target.createTarget',{url:'about:blank'}); const tid=ct.targetId;
  const att=await br.send('Target.attachToTarget',{targetId:tid,flatten:true}); const sid=att.sessionId;
  // page-scoped channel shares the browser WS but every send carries sessionId
  const pg=new CDP(ver.webSocketDebuggerUrl,sid); await pg.connect();
  await pg.send('Runtime.enable');await pg.send('Page.enable');await pg.send('Log.enable');await pg.send('Network.enable');
  const url=`http://127.0.0.1:${PORT}/index.html?version=dev&webgl=1&models=off&verdantTier=${TIER}&fr=${Date.now()}`;
  await pg.send('Page.navigate',{url});
  const t0=Date.now();
  for(let i=0;i<SECS;i++){
    await sleep(1000);
    for(const e of pg.drain()){
      if(e.method==='Network.loadingFailed')rep.failed.push({err:e.params.errorText,type:e.params.type,url:(pg.urlById.get(e.params.requestId)||'').slice(-100)});
      else if(e.method==='Runtime.exceptionThrown')rep.errors.push((e.params.exceptionDetails.exception?.description||e.params.exceptionDetails.text||'exc').slice(0,400));
      else if(e.method==='Runtime.consoleAPICalled'&&e.params.type==='error')rep.errors.push((e.params.args||[]).map(a=>a.value||a.description||'').join(' ').slice(0,400));
      else if(e.method==='Log.entryAdded'&&e.params.entry.level==='error')rep.errors.push(e.params.entry.text.slice(0,400));
    }
    if(rep.readyAt<0){const r=await pg.evl('!!window.__game');if(r===true)rep.readyAt=Math.round((Date.now()-t0)/1000);}
  }
  rep.probe=await pg.evl(`({ready:!!window.__game,title:document.title,body:(document.body?document.body.innerText:'').slice(0,600),hf:!!(window.__game&&window.__game.heightFieldActive),env:!!(window.__game&&window.__game.scene&&window.__game.scene.getObjectByName&&window.__game.scene.getObjectByName('VerdantTrailEnvironment'))})`);
  rep.failed=rep.failed.filter(f=>!String(f.url).includes('favicon')).slice(0,20);
  rep.errors=[...new Set(rep.errors)].slice(0,20);
  try{await br.send('Target.closeTarget',{targetId:tid});rep.closed=true;}catch(_){}
  pg.close();br.close();
 }catch(e){rep.fatal=(e.stack||String(e)).slice(0,500);}
 fs.mkdirSync(require('node:path').dirname(OUT),{recursive:true});
 fs.writeFileSync(OUT,JSON.stringify(rep,null,2));
 console.log(JSON.stringify(rep,null,2));
 clearTimeout(hard);process.exit(0);
})();
