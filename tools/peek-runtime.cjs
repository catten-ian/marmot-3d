const http=require('node:http');
const get=u=>new Promise((res,rej)=>{const r=http.get(u,x=>{let d='';x.on('data',c=>d+=c);x.on('end',()=>res(d));});r.on('error',rej);r.setTimeout(5000,()=>r.destroy(new Error('getto')));});
class C{constructor(u){this.u=u;this.seq=0;this.p=new Map();}
 async connect(){this.ws=new WebSocket(this.u);this.ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.id&&this.p.has(m.id)){const x=this.p.get(m.id);this.p.delete(m.id);m.error?x[1](new Error(JSON.stringify(m.error).slice(0,160))):x[0](m.result);}});await new Promise((r,j)=>{this.ws.addEventListener('open',r,{once:true});this.ws.addEventListener('error',j,{once:true});});}
 send(method,params={},sid,ms=7000){return new Promise((res,rej)=>{const id=++this.seq;this.p.set(id,[res,rej]);const msg={id,method,params};if(sid)msg.sessionId=sid;this.ws.send(JSON.stringify(msg));setTimeout(()=>{if(this.p.has(id)){this.p.delete(id);rej(new Error('tmo '+method));}},ms);});}
 evl(e,sid){return this.send('Runtime.evaluate',{expression:e,returnByValue:true,awaitPromise:true},sid,6000).then(r=>r.result?.value).catch(x=>({__fail:String(x.message)}));}
 close(){try{this.ws.close();}catch(_){}}}
(async()=>{
 const port=process.env.CDP_PORT||'18988',match=process.env.MATCH||':8351';
 const ver=JSON.parse(await get(`http://127.0.0.1:${port}/json/version`));
 const c=new C(ver.webSocketDebuggerUrl);await c.connect();
 const list=JSON.parse(await get(`http://127.0.0.1:${port}/json/list`));
 const tab=list.find(t=>t.type==='page'&&(t.url||'').includes(match));
 const att=await c.send('Target.attachToTarget',{targetId:tab.id,flatten:true},null,7000);const sid=att.sessionId;
 await c.send('Runtime.enable',{},sid);
 const st=await c.evl(`(()=>{
   const g=window.__game||{};
   let glb=null;
   const res=performance.getEntriesByType('resource').filter(r=>/\\.glb($|\\?)/.test(r.name));
   glb=res.map(r=>({n:r.name.split('/').slice(-3).join('/'),st:r.responseStatus||0,dur:Math.round(r.duration),sz:r.transferSize,decoded:r.decodedBodySize}));
   let envStats=null,meshCount=0,tri=0;
   const env=g.scene&&g.scene.getObjectByName&&g.scene.getObjectByName('VerdantTrailEnvironment');
   if(env){envStats=env.userData&&env.userData.verdantManifest?env.userData.verdantManifest.stats:null;}
   if(g.scene){g.scene.traverse(o=>{if(o.isMesh){meshCount++;tri+=Math.floor((o.geometry?.index?.count||o.geometry?.attributes?.position?.count||0)/3);}});}
   const r2=g.renderer||{};
   return {
     hasGame:!!window.__game, heightField:!!g.heightFieldActive,
     envPresent:!!env, envStats,
     backend:(r2.capabilities?r2.capabilities.isWebGL2?'webgl2':'webgl1':'?')+':'+String(r2.getParameter?(r2.getParameter(r2.VERSION)||''):''),
     rendererFrame: r2.info&&r2.info.render?r2.info.render.frame:null,
     drawCalls: r2.info&&r2.info.render?r2.info.render.calls:null,
     trianglesScanned:tri, meshes:meshCount,
     mode:g.game&&g.game.mode, isBeta:!!g.isBeta,
     glbRes:glb,
     watchdog:(window.__verdantWatchdog||null)
   };
 })()`,sid);
 console.log(JSON.stringify(st,null,2));
 c.close();process.exit(0);
})().catch(e=>{console.error('FATAL',(e.stack||String(e)).slice(0,400));process.exit(1);});
