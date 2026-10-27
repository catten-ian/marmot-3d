// Force-close stale local dead-port WebGL tabs on managed Chrome via browser-level CDP.
const http=require('node:http');
const get=u=>new Promise((res,rej)=>{http.get(u,r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>res(d));}).on('error',rej);});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
class CDP{constructor(u){this.u=u;this.seq=0;this.p=new Map();}
 async connect(){this.ws=new WebSocket(this.u);this.ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.id&&this.p.has(m.id)){const x=this.p.get(m.id);this.p.delete(m.id);m.error?x[1](new Error(JSON.stringify(m.error))):x[0](m.result);}});await new Promise((r,j)=>{this.ws.addEventListener('open',r,{once:true});this.ws.addEventListener('error',j,{once:true});});}
 send(m,p={}){return new Promise((res,rej)=>{const id=++this.seq;this.p.set(id,[res,rej]);this.ws.send(JSON.stringify({id,method:m,params:p}));setTimeout(()=>{if(this.p.has(id)){this.p.delete(id);rej(new Error('timeout '+m));}},8000);});}
 close(){try{this.ws.close();}catch(_){}}}
(async()=>{
  const ver=JSON.parse(await get('http://127.0.0.1:18800/json/version'));
  const br=new CDP(ver.webSocketDebuggerUrl); await br.connect();
  const list=JSON.parse(await get('http://127.0.0.1:18800/json/list'));
  // 关掉：本地随机端口(3xxxx/4xxxx/83xx/84xx)、且静态服已不存在的僵尸 dev/sandbox/qa 页
  const stale=[];
  for(const t of list){
    if(t.type!=='page') continue;
    const u=t.url||'';
    let m=u.match(/127\.0\.0\.1:(\d+)\//);
    if(m){
      const port=+m[1];
      const deadLocal = (port>=30000)||(port>=8300&&port<=8499);
      if(deadLocal) stale.push({id:t.id,url:u});
    }
  }
  for(const s of stale){
    try{ await br.send('Target.closeTarget',{targetId:s.id}); console.log('closed',s.id.slice(0,12),s.url.slice(0,70)); }
    catch(e){ console.log('FAIL',s.id.slice(0,12),String(e.message).slice(0,60)); }
  }
  await sleep(1500);
  const after=JSON.parse(await get('http://127.0.0.1:18800/json/list'));
  console.log('--- 剩余 page ---');
  for(const t of after) if(t.type==='page') console.log(' ',t.id.slice(0,12),t.url.slice(0,78));
  br.close();
})().catch(e=>{console.error(e.stack||e);process.exit(1);});
