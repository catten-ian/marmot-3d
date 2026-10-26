// Navigate fresh isolated chrome to dev low tier, wait until __game + env + several frames,
// click start, teleport to Verdant camp, shoot 5 angles. Long readiness window for SwiftShader.
const http=require('node:http'), fs=require('node:fs'), path=require('node:path');
const get=u=>new Promise((res,rej)=>{const r=http.get(u,x=>{let d='';x.on('data',c=>d+=c);x.on('end',()=>res(d));});r.on('error',rej);r.setTimeout(5000,()=>r.destroy(new Error('getto')));});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const PORT=process.env.CDP_PORT||'18988', STATIC=process.env.STATIC_PORT||'8351';
const TIER=process.env.TIER||'low', OUT=process.env.OUT||'outputs/scene-assembly-qa/round3';
const WAIT=+(process.env.WAIT||'260');
fs.mkdirSync(OUT,{recursive:true});
class C{constructor(u){this.u=u;this.seq=0;this.p=new Map();this.ev=[];}
 async connect(){this.ws=new WebSocket(this.u);this.ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.id&&this.p.has(m.id)){const x=this.p.get(m.id);this.p.delete(m.id);m.error?x[1](new Error(JSON.stringify(m.error).slice(0,160))):x[0](m.result);}else if(m.method){this.ev.push(m);}});await new Promise((r,j)=>{this.ws.addEventListener('open',r,{once:true});this.ws.addEventListener('error',j,{once:true});});}
 send(method,params={},sid,ms=12000){return new Promise((res,rej)=>{const id=++this.seq;this.p.set(id,[res,rej]);const msg={id,method,params};if(sid)msg.sessionId=sid;this.ws.send(JSON.stringify(msg));setTimeout(()=>{if(this.p.has(id)){this.p.delete(id);rej(new Error('tmo '+method));}},ms);});}
 evl(e,sid,ms=9000){return this.send('Runtime.evaluate',{expression:e,returnByValue:true,awaitPromise:true},sid,ms).then(r=>r.result?.value).catch(x=>({__fail:String(x.message)}));}
 shot(name,sid){return this.send('Page.captureScreenshot',{format:'png'},sid,15000).then(d=>fs.writeFileSync(path.join(OUT,name+'.png'),Buffer.from(d.data,'base64'))).catch(e=>console.log('shotfail',name,String(e.message).slice(0,60)));}
 close(){try{this.ws.close();}catch(_){}}}
(async()=>{
 const rep={startedAt:new Date().toISOString(),readyAt:-1,errors:[]};
 const ver=JSON.parse(await get(`http://127.0.0.1:${PORT}/json/version`));
 const c=new C(ver.webSocketDebuggerUrl);await c.connect();
 const ct=await c.send('Target.createTarget',{url:'about:blank'},null,8000);
 const att=await c.send('Target.attachToTarget',{targetId:ct.targetId,flatten:true},null,8000);const sid=att.sessionId;
 await c.send('Runtime.enable',{},sid);await c.send('Page.enable',{},sid);await c.send('Log.enable',{},sid);await c.send('Network.enable',{},sid);
 c.ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.sessionId===sid&&m.method==='Runtime.exceptionThrown')rep.errors.push((m.params.exceptionDetails.exception?.description||m.params.exceptionDetails.text||'').slice(0,300));});
 const url=`http://127.0.0.1:${STATIC}/index.html?version=dev&webgl=1&models=off&verdantTier=${TIER}&fr=${Date.now()}`;
 await c.send('Page.navigate',{url},sid,12000);
 const t0=Date.now();
 for(let i=0;i<WAIT;i++){
   await sleep(1000);
   const st=await c.evl(`(function(){var g=window.__game;if(!g)return{game:false};var env=g.scene&&g.scene.getObjectByName?g.scene.getObjectByName('VerdantTrailEnvironment'):null;var fr=g.renderer&&g.renderer.info?g.renderer.info.render.frame:0;return{game:true,env:!!env,frame:fr};})()`,sid);
   if(st&&st.game&&st.env&&st.frame>5){rep.readyAt=Math.round((Date.now()-t0)/1000);break;}
 }
 await sleep(3000);
 // click start / enter
 await c.evl(`(function(){var b=document.getElementById('startBtn');if(b)b.click();return true;})()`,sid);
 await sleep(8000);
 // ensure invincible + find camp spawn from manifest; teleport player to trail center
 const camp=await c.evl(`(function(){
   var g=window.__game;
   try{var cc=g.controller;if('hp' in cc)cc.hp=1000;if('health' in cc)cc.health=1000;}catch(e){}
   var env=g.scene.getObjectByName('VerdantTrailEnvironment');
   var min={x:Infinity,y:Infinity,z:Infinity},max={x:-Infinity,y:-Infinity,z:-Infinity};
   // JS-side bounds from mesh world matrices + geometry position bounds (no global THREE needed)
   var p0={},p1={};
   env.updateMatrixWorld(true);
   env.traverse(function(o){
     if(!o.isMesh||!o.geometry||!o.geometry.attributes.position)return;
     var pos=o.geometry.attributes.position;
     var e=o.matrixWorld.elements;
     for(var s=0;s<pos.count;s+=37){
       var x=pos.getX(s),y=pos.getY(s),z=pos.getZ(s);
       // column-major Matrix4 transform
       var wx=e[0]*x+e[4]*y+e[8]*z+e[12];
       var wy=e[1]*x+e[5]*y+e[9]*z+e[13];
       var wz=e[2]*x+e[6]*y+e[10]*z+e[14];
       if(wx<min.x)min.x=wx;if(wx>max.x)max.x=wx;
       if(wy<min.y)min.y=wy;if(wy>max.y)max.y=wy;
       if(wz<min.z)min.z=wz;if(wz>max.z)max.z=wz;
     }
   });
   return {min:[min.x,min.y,min.z],max:[max.x,max.y,max.z],cx:(min.x+max.x)/2,cz:(min.z+max.z)/2};
 })()`,sid,12000);
 rep.camp=camp;
 await sleep(1000);
 // helper to position camera
 const place=async(x,z,yaw,pitch,third)=>c.evl(`(function(){var g=window.__game,c=g.controller;c.position.set(${x},0,${z});c.yaw=${yaw};c.pitch=${pitch};c.velocity.set(0,0,0);c.vy=0;if(c.cameraDistance!==undefined){c.cameraDistance=5.4;c.cameraHeight=2.15;}return true;})()`,sid);
 // 5 views: path-ground, mid-foliage, cliffs-depth, third-person, overview
 await place(camp.cx, camp.cz, 0, -0.05, false); await sleep(3500); await c.shot('01-path-ground',sid);
 await place(camp.cx+6, camp.cz+8, 0.6, -0.25, false); await sleep(3500); await c.shot('02-mid-foliage',sid);
 await place(camp.cx-10, camp.cz-12, -0.8, -0.35, false); await sleep(3500); await c.shot('03-cliffs-depth',sid);
 await place(camp.cx, camp.cz+4, 0, -0.2, true); await sleep(3500); await c.shot('04-third-person',sid);
 await place(camp.cx+18, camp.cz+18, 0.8, -1.15, true); await sleep(3500); await c.shot('05-overview',sid);
 rep.frameEnd=(await c.evl(`(window.__game&&window.__game.renderer.info.render.frame)||0`,sid)).valueOf();
 rep.errors=[...new Set(rep.errors)].slice(0,15);
 fs.writeFileSync(path.join(OUT,'round3-report.json'),JSON.stringify(rep,null,2));
 console.log(JSON.stringify(rep,null,2));
 try{await c.send('Target.closeTarget',{targetId:ct.targetId},null,5000);}catch(_){}
 c.close();process.exit(0);
})().catch(e=>{console.error('FATAL',(e.stack||String(e)).slice(0,400));process.exit(1);});
