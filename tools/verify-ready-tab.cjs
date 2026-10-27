// Lightweight verify on the ALREADY-READY tab: enter sandbox, third person, ground correctly,
// place camera at several spots, shoot with generous timeouts. Uses window.__game.THREE.
const http=require('node:http'), fs=require('node:fs'), path=require('node:path');
const get=u=>new Promise((res,rej)=>{const r=http.get(u,x=>{let d='';x.on('data',c=>d+=c);x.on('end',()=>res(d));});r.on('error',rej);r.setTimeout(5000,()=>r.destroy(new Error('getto')));});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const PORT=process.env.CDP_PORT||'18988', MATCH=process.env.MATCH||':8351';
const OUT=process.env.OUT||'outputs/scene-assembly-qa/round3b';
fs.mkdirSync(OUT,{recursive:true});
class C{constructor(u){this.u=u;this.seq=0;this.p=new Map();}
 async connect(){this.ws=new WebSocket(this.u);this.ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.id&&this.p.has(m.id)){const x=this.p.get(m.id);this.p.delete(m.id);m.error?x[1](new Error(JSON.stringify(m.error).slice(0,160))):x[0](m.result);}});await new Promise((r,j)=>{this.ws.addEventListener('open',r,{once:true});this.ws.addEventListener('error',j,{once:true});});}
 send(method,params={},sid,ms=20000){return new Promise((res,rej)=>{const id=++this.seq;this.p.set(id,[res,rej]);const msg={id,method,params};if(sid)msg.sessionId=sid;this.ws.send(JSON.stringify(msg));setTimeout(()=>{if(this.p.has(id)){this.p.delete(id);rej(new Error('tmo '+method));}},ms);});}
 evl(e,sid,ms=20000){return this.send('Runtime.evaluate',{expression:e,returnByValue:true,awaitPromise:true},sid,ms).then(r=>r.result?.value).catch(x=>({__fail:String(x.message)}));}
 close(){try{this.ws.close();}catch(_){}}}
(async()=>{
 const ver=JSON.parse(await get(`http://127.0.0.1:${PORT}/json/version`));
 const c=new C(ver.webSocketDebuggerUrl);await c.connect();
 const list=JSON.parse(await get(`http://127.0.0.1:${PORT}/json/list`));
 const tab=list.find(t=>t.type==='page'&&(t.url||'').includes(MATCH));
 if(!tab){console.log('no tab');process.exit(3);}
 const att=await c.send('Target.attachToTarget',{targetId:tab.id,flatten:true},null,8000);const sid=att.sessionId;
 await c.send('Runtime.enable',{},sid);
 const rep={};
 // enter sandbox + third person + invincible
 rep.enter=await c.evl(`(function(){var g=window.__game;try{g.enterSandbox&&g.enterSandbox();}catch(e){} try{g.setViewMode&&g.setViewMode(true);}catch(e){} var cc=g.controller; try{cc.hp=1000;cc.health=1000;}catch(e){} return {mode:g.game.mode,third:g.thirdPerson,hasTHREE:!!g.THREE};})()`,sid);
 await sleep(6000);
 // env center + ground y via THREE + terrainHeight
 rep.center=await c.evl(`(function(){var g=window.__game,T=g.THREE;var env=g.scene.getObjectByName('VerdantTrailEnvironment');var box=new T.Box3().setFromObject(env);var cx=(box.min.x+box.max.x)/2,cz=(box.min.z+box.max.z)/2;var gy=g.terrainHeight(cx,cz);return{cx:cx,cz:cz,minY:box.min.y,maxY:box.max.y,groundY:gy};})()`,sid,15000);
 await sleep(1000);
 const place=(x,z,yaw,pitch)=>c.evl(`(function(){var g=window.__game,cc=g.controller;var y=g.terrainHeight(${x},${z});cc.position.set(${x},y+0.1,${z});cc.yaw=${yaw};cc.pitch=${pitch};cc.velocity&&cc.velocity.set(0,0,0);cc.vy=0;return [y];})()`,sid);
 const shot=(name)=>c.send('Page.captureScreenshot',{format:'png'},sid,25000).then(d=>{fs.writeFileSync(path.join(OUT,name+'.png'),Buffer.from(d.data,'base64'));console.log('shot',name);}).catch(e=>console.log('shotfail',name,String(e.message).slice(0,50)));
 const cx=rep.center.cx, cz=rep.center.cz;
 // third-person views at and around center
 const views=[['r3b-01-center',cx,cz+5,0,-0.15],['r3b-02-foliage',cx+7,cz+10,0.7,-0.25],['r3b-03-cliffs',cx-12,cz-14,-0.9,-0.3],['r3b-04-overview',cx+16,cz+18,0.8,-1.05]];
 for(const [n,x,z,y,p] of views){ await place(x,z,y,p); await sleep(5000); await shot(n); }
 rep.frame=await c.evl(`window.__game.renderer.info.render.frame`,sid);
 fs.writeFileSync(path.join(OUT,'report.json'),JSON.stringify(rep,null,2));
 console.log(JSON.stringify(rep,null,2));
 c.close();process.exit(0);
})().catch(e=>{console.error('FATAL',(e.stack||String(e)).slice(0,400));process.exit(1);});
