// Single browser WS + flatten session: create tab, attach, navigate, capture. Always exits.
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const get=u=>new Promise((res,rej)=>{const r=http.get(u,x=>{let d='';x.on('data',c=>d+=c);x.on('end',()=>res(d));});r.on('error',rej);r.setTimeout(5000,()=>r.destroy(new Error('getto')));});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const CDP_PORT=process.env.CDP_PORT||'18988';
const STATIC=process.env.STATIC_PORT||'8351';
const SECS=+(process.env.SECS||'90');
const TIER=process.env.TIER||'low';
const OUT=process.env.OUT||'outputs/scene-boot-probe/fresh.json';
class C{constructor(u){this.u=u;this.seq=0;this.p=new Map();this.ev=[];this.urlById=new Map();}
 async connect(){this.ws=new WebSocket(this.u);this.ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.id&&this.p.has(m.id)){const x=this.p.get(m.id);this.p.delete(m.id);m.error?x[1](new Error(JSON.stringify(m.error).slice(0,160))):x[0](m.result);}else if(m.method){this.ev.push(m);if(m.method==='Network.requestWillBeSent')this.urlById.set(m.params.requestId,m.params.request.url);}});await new Promise((r,j)=>{this.ws.addEventListener('open',r,{once:true});this.ws.addEventListener('error',j,{once:true});});}
 // session-scoped send (flatten): every page command carries sid
 send(method,params={},sid,ms=10000){return new Promise((res,rej)=>{const id=++this.seq;this.p.set(id,[res,rej]);const msg={id,method,params};if(sid)msg.sessionId=sid;this.ws.send(JSON.stringify(msg));setTimeout(()=>{if(this.p.has(id)){this.p.delete(id);rej(new Error('tmo '+method));}},ms);});}
 drain(sid){const out=[];for(let i=this.ev.length-1;i>=0;i--){if(this.ev[i].sessionId===sid)out.unshift(this.ev.splice(i,1)[0]);}return out;}
 close(){try{this.ws.close();}catch(_){}}}
const rep={startedAt:new Date().toISOString(),readyAt:-1,probe:null,failed:[],errors:[]};
const hard=setTimeout(()=>{try{fs.writeFileSync(OUT,JSON.stringify(rep,null,2));}catch(_){}console.log('HARD EXIT');process.exit(2);},(SECS+30)*1000);
(async()=>{
 let c,sid;
 try{
  const ver=JSON.parse(await get(`http://127.0.0.1:${CDP_PORT}/json/version`));
  c=new C(ver.webSocketDebuggerUrl); await c.connect();
  const ct=await c.send('Target.createTarget',{url:'about:blank'},null,8000);
  const att=await c.send('Target.attachToTarget',{targetId:ct.targetId,flatten:true},null,8000);
  sid=att.sessionId;
  await c.send('Runtime.enable',{},sid);await c.send('Page.enable',{},sid);await c.send('Log.enable',{},sid);await c.send('Network.enable',{},sid);
  const url=`http://127.0.0.1:${STATIC}/index.html?version=dev&webgl=1&models=off&verdantTier=${TIER}&fr=${Date.now()}`;
  await c.send('Page.navigate',{url},sid,12000);
  const t0=Date.now();
  for(let i=0;i<SECS;i++){
    await sleep(1000);
    for(const e of c.drain(sid)){
      if(e.method==='Network.loadingFailed')rep.failed.push({err:e.params.errorText,type:e.params.type,url:(c.urlById.get(e.params.requestId)||'').slice(-100)});
      else if(e.method==='Runtime.exceptionThrown')rep.errors.push((e.params.exceptionDetails.exception?.description||e.params.exceptionDetails.text||'exc').slice(0,400));
      else if(e.method==='Runtime.consoleAPICalled'&&e.params.type==='error')rep.errors.push((e.params.args||[]).map(a=>a.value||a.description||'').join(' ').slice(0,400));
      else if(e.method==='Log.entryAdded'&&e.params.entry.level==='error')rep.errors.push(e.params.entry.text.slice(0,400));
    }
    if(rep.readyAt<0){const r=await c.send('Runtime.evaluate',{expression:'!!window.__game',returnByValue:true},sid,3000).then(x=>x.result?.value).catch(()=>null);if(r===true)rep.readyAt=Math.round((Date.now()-t0)/1000);}
  }
  rep.probe=await c.send('Runtime.evaluate',{expression:`({ready:!!window.__game,title:document.title,loc:location.href,body:(document.body?document.body.innerText:'').slice(0,700),hf:!!(window.__game&&window.__game.heightFieldActive),env:!!(window.__game&&window.__game.scene&&window.__game.scene.getObjectByName&&window.__game.scene.getObjectByName('VerdantTrailEnvironment')),scripts:[...document.scripts].map(s=>(s.src||'inline').split('/').pop())})`,returnByValue:true},sid,5000).then(x=>x.result?.value).catch(e=>({__evalFail:String(e.message)}));
  rep.failed=rep.failed.filter(f=>!String(f.url).includes('favicon')).slice(0,20);
  rep.errors=[...new Set(rep.errors)].slice(0,20);
  try{await c.send('Target.closeTarget',{targetId:ct.targetId},null,5000);rep.closed=true;}catch(_){}
 }catch(e){rep.fatal=(e.stack||String(e)).slice(0,500);}
 fs.mkdirSync(path.dirname(OUT),{recursive:true});
 fs.writeFileSync(OUT,JSON.stringify(rep,null,2));
 console.log(JSON.stringify(rep,null,2));
 clearTimeout(hard);c&&c.close();process.exit(0);
})();
