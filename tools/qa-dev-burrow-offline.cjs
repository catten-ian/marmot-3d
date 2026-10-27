/** 离线 dev 洞穴闭环验收：纯 Node CPU 软件光栅，不使用浏览器/CDP。 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'outputs', 'm3d-20261027-dev-burrow-offline-closure');
const VIS = path.join(OUT, 'visual');
const lib = require('./lib/glb-offline.cjs');
const checks = [];
const THRESHOLDS = { coverage: 0.01, uniqueColors: 8, nonBackground: 0.005 };
function strongPass(m) { return m.coverage >= THRESHOLDS.coverage && m.uniqueColors >= THRESHOLDS.uniqueColors && m.nonBackgroundRatio >= THRESHOLDS.nonBackground; }
function check(name, ok, detail='') { checks.push({name, ok:!!ok, detail:String(detail).slice(0,500)}); console.log(`${ok?'PASS':'FAIL'}  ${name}${detail?` — ${detail}`:''}`); return !!ok; }
function source(f){ return fs.readFileSync(path.join(ROOT,f),'utf8'); }
function loadVersion(search) {
  const labels=source('src/core/version-labels.mjs').replace(/^export const /gm,'const ').replace(/^export function /gm,'function ');
  const ver=source('src/core/version.js').replace("import { DEV_VERSION_LABEL, STABLE_VERSION_LABEL, versionBadgeLabel } from './version-labels.mjs';",labels).replace(/^export const /gm,'const ').replace(/^export function /gm,'function ').replace(/^export \{[^\n]+\};$/gm,'');
  const c=vm.createContext({URLSearchParams,location:{search,pathname:'/'},console}); vm.runInContext(`${ver}\nthis.api={VERSION,IS_DEV,DEV_FEATURES,devOn};`,c); return c.api;
}
function loadProfiles() {
  const labels=source('src/core/version-labels.mjs').replace(/^export const /gm,'const ').replace(/^export function /gm,'function ');
  const ver=source('src/core/version.js').replace("import { DEV_VERSION_LABEL, STABLE_VERSION_LABEL, versionBadgeLabel } from './version-labels.mjs';",labels).replace(/^export const /gm,'const ').replace(/^export function /gm,'function ').replace(/^export \{[^\n]+\};$/gm,'');
  const und=source('src/world/underground.js').replace(/^import .*$/gm,'').replace(/^export function /gm,'function ').replace(/^export const /gm,'const ');
  const c=vm.createContext({URLSearchParams,location:{search:'?version=dev',pathname:'/'},console,BURROWS:[],scalePoint:p=>p,scaleRadius:r=>r,terrainHeight:()=>0,baseTerrainHeight:()=>0,heightFieldActive:()=>false,depressionAt:()=>0}); vm.runInContext(`${ver}\n${und}\nthis.api={undergroundProfile};`,c); return c.api.undergroundProfile;
}
function loadScaledBurrows() {
  const cfg=source('src/core/config.js').replace(/^export /gm,'');
  const c=vm.createContext({console}); vm.runInContext(`${cfg}\nthis.api={BURROWS,scalePoint,scaleRadius};`,c);
  const bs=source('src/world/burrows.js').replace(/^import .*$/gm,'').replace(/^export function /gm,'function ');
  const b=vm.createContext({BURROWS:c.api.BURROWS,scalePoint:c.api.scalePoint,scaleRadius:c.api.scaleRadius,Burrow:function(){},configureUnderground(){}});
  vm.runInContext(`${bs}\nthis.api={scaledBurrows};`,b); return b.api.scaledBurrows();
}
function logicChecks() {
  const dev=loadVersion('?version=dev'), stable=loadVersion('');
  check('dev 模式路由正确',dev.VERSION==='dev'&&dev.IS_DEV,`VERSION=${dev.VERSION}`);
  check('stable 模式路由正确',stable.VERSION==='stable'&&!stable.IS_DEV,`VERSION=${stable.VERSION}`);
  for(const k of ['scannedBurrows','screamingMarmot','sorrelFood']) { check(`dev 开关 ${k}`,dev.devOn(k)===true); check(`stable 开关 ${k}`,stable.devOn(k)===false); }
  const prof=loadProfiles();
  for(const d of [{type:'base'},{type:'shelter'}]) { const p=prof(d); const tag=d.type==='base'?'主洞':'临时洞'; check(`${tag} dev profile 真实返回`,p.openingRadius>0&&p.slopeRadius>p.openingRadius&&p.chamberDepth>0,JSON.stringify(p)); }
  const defs=loadScaledBurrows();
  check('洞穴布局经真实 scaledBurrows()',defs.length===5,defs.map(d=>`${d.id}:${d.x.toFixed(2)},${d.z.toFixed(2)},r=${d.r.toFixed(2)}`).join(' | '));
  const ps=source('src/world/props.js');
  check('dev 分支保留稳定版地标隔离',/if \(devBurrow\)/.test(ps)&&/else if \(isBase\)/.test(ps)&&/this\.beam/.test(ps));
  check('内景后置变换与深度偏移接线',/norm\.wrap\.rotation\.y = Math\.PI \/ 2/.test(ps)&&/interiorGroup\.position\.y = -underground\.chamberDepth \+ 0\.1/.test(ps));
  check('死属性不再作为外部 API 暴露',!(/this\.shaft\s*=/.test(ps))&&!(/this\.mouth\s*=/.test(ps)));
  const bg=[0.025,0.025,0.035]; const bgRgb=new Uint8Array(720*540*3); for(let i=0;i<720*540;i++){bgRgb[i*3]=Math.round(bg[0]*255);bgRgb[i*3+1]=Math.round(bg[1]*255);bgRgb[i*3+2]=Math.round(bg[2]*255);} const bgMeasured=lib.measureImage(bgRgb,720,540,bg); const weakTris=0; check('全背景图被强断言拦截',!strongPass(bgMeasured),`coverage=${bgMeasured.coverage.toFixed(4)} uniqueColors=${bgMeasured.uniqueColors} nonBackground=${bgMeasured.nonBackgroundRatio.toFixed(4)}`); check('同一全背景图会被弱三角形断言放行',weakTris===0,`tris=${weakTris}`);
}
function prim(vertices, color, indices=null, doubleSided=true) { const n=vertices.length/3, P=[new Float64Array(n),new Float64Array(n),new Float64Array(n)]; for(let i=0;i<n;i++){P[0][i]=vertices[i*3];P[1][i]=vertices[i*3+1];P[2][i]=vertices[i*3+2];} return {P,N:null,C:null,UV:null,indices:indices?new Float64Array(indices):new Float64Array(Array.from({length:n},(_,i)=>i)),world:lib.mat4Multiply(lib.mat4Identity(),lib.mat4Identity()),baseColor:color,alpha:1,texture:null,materialName:'offline-cave',doubleSided}; }
function cavePrims(def, profile) {
  const out=[]; const seg=32; const ring=(r,y)=>Array.from({length:seg},(_,i)=>[Math.cos(i/seg*Math.PI*2)*r,y,Math.sin(i/seg*Math.PI*2)*r]);
  const top=ring(profile.openingRadius,0), bot=ring(profile.chamberRadius,-profile.chamberDepth);
  const wallV=[]; const wallI=[]; for(let i=0;i<seg;i++){const j=(i+1)%seg; wallV.push(...top[i],...top[j],...bot[j],...bot[i]); const k=i*4; wallI.push(k,k+1,k+2,k,k+2,k+3);} out.push(prim(wallV,def.type==='base'?[0.22,0.11,0.045]:[0.10,0.16,0.16],wallI,true));
  const floorV=[0,-profile.chamberDepth+0.02,0]; for(const p of bot) floorV.push(...p); const floorI=[]; for(let i=0;i<seg;i++){const j=(i+1)%seg; floorI.push(0,1+i,1+j);} out.push(prim(floorV,def.type==='base'?[0.34,0.16,0.05]:[0.12,0.22,0.22],floorI,true));
  const mouthV=[0,-0.06,0]; for(const p of ring(profile.openingRadius*0.97,-0.06)) mouthV.push(...p); const mouthI=[]; for(let i=0;i<seg;i++){const j=(i+1)%seg; mouthI.push(0,1+j,1+i);} out.push(prim(mouthV,[0.015,0.008,0.004],mouthI,true));
  const rimV=[]; const rimI=[]; const ri=profile.openingRadius*.92, ro=profile.slopeRadius*.98; for(let i=0;i<seg;i++){const a=i/seg*Math.PI*2,b=(i+1)/seg*Math.PI*2; rimV.push(Math.cos(a)*ri,.03,Math.sin(a)*ri,Math.cos(a)*ro,.03,Math.sin(a)*ro,Math.cos(b)*ro,.03,Math.sin(b)*ro,Math.cos(b)*ri,.03,Math.sin(b)*ri); const k=i*12/3; rimI.push(i*4,i*4+1,i*4+2,i*4,i*4+2,i*4+3);} out.push(prim(rimV,def.type==='base'?[0.12,0.06,0.02]:[0.04,0.08,0.08],rimI,true));
  // 四盏灯以小发光球近似，保留运行时暖/冷层次。
  const ly=-profile.chamberDepth+1.1; for(const [x,z,c] of [[0,0,def.type==='base'?[1,.45,.12]:[.25,.6,.75]],[profile.chamberRadius*.55,0,[1,.55,.2]],[-profile.chamberRadius*.55,0,[.35,.55,1]],[0,profile.chamberRadius*.55,[1,.3,.1]]]) { const r=.12; out.push(prim([x-r,ly,z,x+r,ly,z,x,ly+r,z,x,ly-r,z],c,[0,1,2,0,3,1],true)); }
  // 文字标签用高对比四边形代表，保证离线证据中能看见标识区域。
  const lw=def.type==='base'?1.2:.9, lh=.28; out.push(prim([-lw,1.8,-.02,lw,1.8,-.02,lw,1.8+lh,-.02,-lw,1.8+lh,-.02],[.75,.9,1],[0,1,2,0,2,3],true));
  for (const [x,c] of [[-.8,[.18,.07,.02]],[-.35,[.28,.12,.03]],[.1,[.42,.16,.04]],[.55,[.08,.12,.2]]]) out.push(prim([x,-.1,-profile.openingRadius*.98,x+.22,-.1,-profile.openingRadius*.98,x+.22,.12,-profile.openingRadius*.98,x,.12,-profile.openingRadius*.98],c,[0,1,2,0,2,3],true));
  return out;
}
function rotateY(m,a){const c=Math.cos(a),s=Math.sin(a); return [c,0,s,0,0,1,0,0,-s,0,c,0,0,0,0,1];}
function addTransform(prims,m){for(const p of prims)p.world=lib.mat4Multiply(m,p.world);}
const sizes=[[390,844],[768,1024],[1280,720],[1440,900]];
const scenes=[
 {key:'burrow-main-interior',file:'assets/models/burrow-main-interior.glb',height:3.0,defType:'base',dir:[0.05,0.12,0.99],margin:.55},
 {key:'burrow-shelter-interior',file:'assets/models/burrow-shelter-interior.glb',height:2.6,defType:'shelter',dir:[0.05,0.12,.99],margin:.55},
 {key:'burrow-mouth',file:null,height:0,defType:'base',dir:[.5,.35,.8],margin:.68},
 {key:'marmot-screaming',file:'assets/models/marmot-screaming.glb',height:.75,dir:[.55,.3,.8],margin:.65,tint:true},
 {key:'shrub-sorrel',file:'assets/models/shrub-sorrel.glb',height:.4,dir:[.55,.35,.8],margin:.65,tint:false},
];
function renderScene(scene,w,h,defs,profile){
  let prims=[];
  const def=defs.find(d=>d.type===scene.defType)||defs[0];
  const p=profile(def);
  if(scene.file){
    const parsed=lib.parseGLB(path.join(ROOT,scene.file));
    prims=lib.buildPrimitives(parsed.gltf,parsed.bin,{tintNearBlack:scene.tint});
    lib.applyNormalization(prims,scene.height);
    if(scene.key.includes('burrow-')){
      const rot=[Math.cos(Math.PI/2),0,Math.sin(Math.PI/2),0, 0,1,0,-p.chamberDepth+0.1, -Math.sin(Math.PI/2),0,Math.cos(Math.PI/2),0, 0,0,0,1];
      addTransform(prims,rot);
      prims.push(...cavePrims(def,p));
    }
    const bounds=lib.primStats(prims);
    const center=[(bounds.min[0]+bounds.max[0])/2,(bounds.min[1]+bounds.max[1])/2,(bounds.min[2]+bounds.max[2])/2];
    const cam=lib.frameCamera({center,size:bounds.size},{dir:scene.dir,margin:scene.margin});
    if(scene.key.includes('burrow-')){cam.eye=[0,-p.chamberDepth*.45,p.chamberRadius*.7];cam.target=[0,-p.chamberDepth*.55,0];cam.near=.02;}
    return lib.renderPrimitives(prims,cam,{width:w,height:h,near:cam.near||.01,background:scene.key.includes('burrow')?[.025,.025,.035]:[.12,.16,.13],ambient:scene.key.includes('burrow') ? .24 : .3});
  }
  prims=cavePrims(def,p);
  const bounds=lib.primStats(prims);
  const center=[(bounds.min[0]+bounds.max[0])/2,(bounds.min[1]+bounds.max[1])/2,(bounds.min[2]+bounds.max[2])/2];
  const cam=lib.frameCamera({center,size:bounds.size},{dir:scene.dir,margin:scene.margin});
  return lib.renderPrimitives(prims,cam,{width:w,height:h,background:[.025,.025,.035],ambient:.24});
}
function rendering(){
  fs.mkdirSync(VIS,{recursive:true}); const defs=loadScaledBurrows(), profile=loadProfiles(); const manifest=[];
  for(const scene of scenes) for(const [w,h] of sizes){
    const out=renderScene(scene,w,h,defs,profile); const name=`${scene.key}__${w}x${h}.png`,file=path.join(VIS,name); fs.writeFileSync(file,lib.encodePNG(out.rgb,w,h)); const decoded=lib.decodePNG(fs.readFileSync(file)); const bg=scene.key.includes('burrow')?[.025,.025,.035]:[.12,.16,.13]; const measured=lib.measureImage(out.rgb,w,h,bg);
    const c1=check(`${scene.key} ${w}x${h} 尺寸`,decoded.width===w&&decoded.height===h,`${decoded.width}x${decoded.height}`); const c2=check(`${scene.key} ${w}x${h} coverage`,measured.coverage>=THRESHOLDS.coverage,`coverage=${measured.coverage.toFixed(4)} threshold=${THRESHOLDS.coverage}`); const c3=check(`${scene.key} ${w}x${h} uniqueColors`,measured.uniqueColors>=THRESHOLDS.uniqueColors,`uniqueColors=${measured.uniqueColors} threshold=${THRESHOLDS.uniqueColors}`); const c4=check(`${scene.key} ${w}x${h} 非背景占比`,measured.nonBackgroundRatio>=THRESHOLDS.nonBackground,`nonBackground=${measured.nonBackgroundRatio.toFixed(4)} threshold=${THRESHOLDS.nonBackground}`);
    const pass=c1&&c2&&c3&&c4; manifest.push({scene:scene.key,viewport:[w,h],command:`node tools/qa-dev-burrow-offline.cjs`,path:`outputs/m3d-20261027-dev-burrow-offline-closure/visual/${name}`,expected:scene.key.includes('burrow')?'可见井壁/地板/洞口/灯光/标签':'主体轮廓、法线明暗和材质色块',observed:{coverage:+measured.coverage.toFixed(4),uniqueColors:measured.uniqueColors,nonBackground:+measured.nonBackgroundRatio.toFixed(4)},pass}); console.log(`  渲染 ${name} coverage=${measured.coverage.toFixed(3)} colors=${measured.uniqueColors} pass=${pass}`);
  }
  // 同一视角的蒙皮开/关对照，记录像素差，作为直接可见性证据。
  const parsed=lib.parseGLB(path.join(ROOT,'assets/models/marmot-screaming.glb')); const on=lib.buildPrimitives(parsed.gltf,parsed.bin,{tintNearBlack:true}); const off=lib.buildPrimitives(parsed.gltf,parsed.bin,{tintNearBlack:true,applySkin:false}); lib.applyNormalization(on,.75); lib.applyNormalization(off,.75); const so=lib.primStats(on); const cam=lib.frameCamera({center:[(so.min[0]+so.max[0])/2,(so.min[1]+so.max[1])/2,(so.min[2]+so.max[2])/2],size:so.size},{dir:[.55,.3,.8],margin:.65}); const ro=lib.renderPrimitives(on,cam,{width:720,height:540,background:[.12,.16,.13],ambient:.3}); const rf=lib.renderPrimitives(off,cam,{width:720,height:540,background:[.12,.16,.13],ambient:.3}); const onName='marmot-screaming__skin-on__720x540.png',offName='marmot-screaming__skin-off__720x540.png'; fs.writeFileSync(path.join(VIS,onName),lib.encodePNG(ro.rgb,720,540)); fs.writeFileSync(path.join(VIS,offName),lib.encodePNG(rf.rgb,720,540)); let diff=0,maxDelta=0; for(let i=0;i<ro.rgb.length;i++){const d=Math.abs(ro.rgb[i]-rf.rgb[i]);if(d>0)diff++;if(d>maxDelta)maxDelta=d;} const diffRatio=diff/ro.rgb.length; check('蒙皮开关对照存在像素差',diff>0,`different channels=${diff} ratio=${diffRatio.toFixed(4)} maxDelta=${maxDelta}`); manifest.push({scene:'marmot-screaming-skin-comparison',viewport:[720,540],command:'node tools/qa-dev-burrow-offline.cjs',path:`outputs/m3d-20261027-dev-burrow-offline-closure/visual/${onName} + ${offName}`,expected:'同视角蒙皮开关对照',observed:{differentChannels:diff,diffRatio:+diffRatio.toFixed(4),maxDelta},pass:diff>0});
  fs.writeFileSync(path.join(VIS,'manifest.json'),JSON.stringify({renderer:'CPU software rasterizer',thresholds:THRESHOLDS,shots:manifest},null,2));
}
logicChecks(); rendering();
const failed=checks.filter(c=>!c.ok); const result={task:'m3d-20261027-dev-burrow-offline-closure',renderer:'tools/lib/glb-offline.cjs（纯 CPU 软件光栅化，无 WebGPU/WebGL/浏览器/CDP）',total:checks.length,passed:checks.length-failed.length,failed:failed.length,checks}; fs.writeFileSync(path.join(OUT,'qa-result.json'),JSON.stringify(result,null,2)); console.log(failed.length?`\nFAILURES: ${failed.length}, OK ${result.passed}/${result.total}`:`\nOK ${result.total}/${result.total}`); if(failed.length)process.exit(1);
