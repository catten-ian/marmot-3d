// One-shot attach to an existing tab by URL match on a given CDP port; quick state probe.
const http=require('node:http');
const get=u=>new Promise((res,rej)=>{const r=http.get(u,x=>{let d='';x.on('data',c=>d+=c);x.on('end',()=>res(d));});r.on('error',rej);r.setTimeout(5000,()=>r.destroy(new Error('getto')));});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const CDP_PORT=process.env.CDP_PORT||'18988';
const MATCH=process.env.MATCH||':8351';
class C{constructor(u){this.u=u;this.seq=0;this.p=new Map();}
 async connect(){this.ws=new WebSocket(this.u);this.ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.id&&this.p.has(m.id)){const x=this.p.get(m.id);this.p.delete(m.id);m.error?x[1](new Error(JSON.stringify(m.error).slice(0,160))):x[0](m.result);}});await new Promise((r,j)=>{this.ws.addEventListener('open',r,{once:true});this.ws.addEventListener('error',j,{once:true});});}
 send(method,params={},sid,ms=7000){return new Promise((res,rej)=>{const id=++this.seq;this.p.set(id,[res,rej]);const msg={id,method,params};if(sid)msg.sessionId=sid;this.ws.send(JSON.stringify(msg));setTimeout(()=>{if(this.p.has(id)){this.p.delete(id);rej(new Error('tmo '+method));}},ms);});}
 evl(expr,sid){return this.send('Runtime.evaluate',{expression:expr,returnByValue:true,awaitPromise:true},sid,6000).then(r=>r.result?.value).catch(e=>({__fail:String(e.message)}));}
 close(){try{this.ws.close();}catch(_){}}}
(async()=>{
 const ver=JSON.parse(await get(`http://127.0.0.1:${CDP_PORT}/json/version`));
 const c=new C(ver.webSocketDebuggerUrl); await c.connect();
 const list=JSON.parse(await get(`http://127.0.0.1:${CDP_PORT}/json/list`));
 const tab=list.find(t=>t.type==='page'&&(t.url||'').includes(MATCH));
 if(!tab){console.log('no tab',MATCH);process.exit(3);}
 const att=await c.send('Target.attachToTarget',{targetId:tab.id,flatten:true},null,7000); const sid=att.sessionId;
 await c.send('Runtime.enable',{},sid);await c.send('Log.enable',{},sid);
 const state=await c.evl(`(()=>({
   href:location.href, readyState:document.readyState,
   hasGame:!!window.__game,
   title:document.title,
   bodyLen:(document.body?document.body.innerHTML.length:0),
   bodyText:(document.body?document.body.innerText:'').slice(0,400),
   scripts:[...document.scripts].map(s=>({src:(s.src||'inline').split('/').slice(-2).join('/'),type:s.type||'classic'})),
   perfRes: performance.getEntriesByType('resource').map(r=>({n:r.name.split('/').slice(-2).join('/'),st:Math.round(r.responseStatus||0),dur:Math.round(r.duration),sz:r.transferSize})).slice(0,60)
 }))()`,sid);
 console.log(JSON.stringify(state,null,2));
 c.close();process.exit(0);
})().catch(e=>{console.error('FATAL',(e.stack||String(e)).slice(0,400));process.exit(1);});
