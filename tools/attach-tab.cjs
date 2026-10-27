// Attach to an existing managed tab (URL match), reload with full capture, hard-exit.
const http=require('node:http');
const get=u=>new Promise((res,rej)=>{const r=http.get(u,x=>{let d='';x.on('data',c=>d+=c);x.on('end',()=>res(d));});r.on('error',rej);r.setTimeout(5000,()=>r.destroy(new Error('get timeout')));});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const MATCH=process.env.MATCH||':8351';
const SECS=+(process.env.SECS||'75');
class CDP{constructor(u){this.u=u;this.seq=0;this.p=new Map();this.ev=[];this.urlById=new Map();}
 async connect(){this.ws=new WebSocket(this.u);this.ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.id&&this.p.has(m.id)){const x=this.p.get(m.id);this.p.delete(m.id);m.error?x[1](new Error(JSON.stringify(m.error).slice(0,160))):x[0](m.result);}else if(m.method){this.ev.push(m);if(m.method==='Network.requestWillBeSent')this.urlById.set(m.params.requestId,m.params.request.url);}});await new Promise((r,j)=>{this.ws.addEventListener('open',r,{once:true});this.ws.addEventListener('error',j,{once:true});});}
 _raw(m,p){return new Promise((res,rej)=>{const id=++this.seq;this.p.set(id,[res,rej]);this.ws.send(JSON.stringify({id,method:m,params:p}));});}
 send(m,p={}){return Promise.race([this._raw(m,p),new Promise((_,rej)=>setTimeout(()=>rej(new Error('tmo '+m)),6000))]);}
 async evl(e){try{const r=await this.send('Runtime.evaluate',{expression:e,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)return {__err:JSON.stringify(r.exceptionDetails).slice(0,250)};return r.result?.value;}catch(x){return {__fail:String(x.message)};}}
 drain(){const a=this.ev.splice(0);this.ev.length=0;return a;}
 close(){try{this.ws.close();}catch(_){}}}
const hard=setTimeout(()=>{console.log('\n!!! HARD TIMEOUT — forcing exit');process.exit(2);},(SECS+25)*1000);
(async()=>{
 const ver=JSON.parse(await get('http://127.0.0.1:18800/json/version'));
 const br=new CDP(ver.webSocketDebuggerUrl); await br.connect();
 const list=JSON.parse(await get('http://127.0.0.1:18800/json/list'));
 const tab=list.find(t=>t.type==='page'&&(t.url||'').includes(MATCH));
 if(!tab){console.log('NO TAB MATCH',MATCH);process.exit(3);}
 console.log('attach tab',tab.id.slice(0,12),tab.url.slice(0,90));
 const pg=new CDP(tab.webSocketDebuggerUrl); await pg.connect();
 await pg.send('Runtime.enable');await pg.send('Page.enable');await pg.send('Log.enable');await pg.send('Network.enable');
 const failed=[],errs=[];
 await pg.send('Page.reload',{ignoreCache:true});
 const t0=Date.now();let readyAt=-1;
 for(let i=0;i<SECS;i++){
   await sleep(1000);
   for(const e of pg.drain()){
     if(e.method==='Network.loadingFailed')failed.push({err:e.params.errorText,type:e.params.type,url:(pg.urlById.get(e.params.requestId)||'').slice(-100)});
     else if(e.method==='Runtime.exceptionThrown')errs.push((e.params.exceptionDetails.exception?.description||e.params.exceptionDetails.text||'exc').slice(0,400));
     else if(e.method==='Runtime.consoleAPICalled'&&e.params.type==='error')errs.push((e.params.args||[]).map(a=>a.value||a.description||'').join(' ').slice(0,400));
     else if(e.method==='Log.entryAdded'&&e.params.entry.level==='error')errs.push(e.params.entry.text.slice(0,400));
   }
   if(readyAt<0){const r=await pg.evl('!!window.__game');if(r===true)readyAt=Math.round((Date.now()-t0)/1000);}
 }
 const probe=await pg.evl(`({ready:!!window.__game,title:document.title,body:(document.body?document.body.innerText:'').slice(0,500),scripts:[...document.scripts].map(s=>(s.src||'inline').split('/').pop()),hf:!!(window.__game&&window.__game.heightFieldActive)})`);
 const rep={readyAt,probe,failed:failed.filter(f=>!String(f.url).includes('favicon')).slice(0,20),errors:[...new Set(errs)].slice(0,20)};
 console.log(JSON.stringify(rep,null,2));
 pg.close();br.close();clearTimeout(hard);process.exit(0);
})().catch(e=>{console.error('FATAL',(e.stack||String(e)).slice(0,500));process.exit(1);});
