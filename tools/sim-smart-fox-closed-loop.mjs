import assert from 'node:assert/strict';
import { utilityScores, updatePerception, debounceIntent, stepSmartMotion } from '../src/entities/smart-fox-core.mjs';
import { BETA_TUNE } from '../src/core/beta-tuning.js';

const beta = process.env.SMARTFOX_BETA !== '0';
const dt = 1 / 60;
const duration = 60;
const scenarios = [
  ['facing', 1, 0],
  ['back_turned', -1, 0],
  ['memory_one', 1, 1],
  ['multi_fox', 1, 0],
];
function pointSeg(ax, az, bx, bz, px, pz) {
  const dx=bx-ax,dz=bz-az,l=dx*dx+dz*dz;
  const t=l?Math.max(0,Math.min(1,((px-ax)*dx+(pz-az)*dz)/l)):0;
  return Math.hypot(ax+dx*t-px, az+dz*t-pz);
}
function run(name, viewDot, memoryStart, pack=false) {
  let s={x:0,z:-5.5,vx:0,vz:0,yaw:0,pounceCooldown:0,pounceCommitted:false,pounceMinDistance: beta?BETA_TUNE.smartPounceMinDistance:4.2,pounceMaxDistance: beta?BETA_TUNE.smartPounceMaxDistance:6.2,pounceSpeed:10.6,pounceDashSpeedMul:1.18,pounceStrikeSpeed:13.5,pounceDashDuration:.42,pounceCooldownDuration:1};
  let suspicion=viewDot > 0 ? 1 : 0,memory=memoryStart,held=0,candidate='observe',fatigue=0,commits=0,hits=0,hitSet=false, rec=[];
  for(let i=0;i<duration/dt;i++) {
    const now=i*dt; const dist=Math.hypot(s.x,s.z);
    suspicion=updatePerception({suspicion},{distance:dist,viewDot,guard:false,running:false,decayRate:.48},dt).suspicion;
    const scores=utilityScores({distance:dist,playerFacing:Math.max(0,viewDot),guard:false,fatigue,health:1,interruptions:0,memory,suspicion,betaOn:beta});
    let intent=s.pounceCommitted?'pounce':scores.topIntent;
    const band=beta?BETA_TUNE.smartPounceApproachRadius:3.4;
    if(intent==='approach'||intent==='observe') { if(dist<band) intent='observe'; else if(dist>7.7) intent='approach'; else intent='observe'; }
    const d=debounceIntent(candidate,intent,held,dt); candidate=d.intent; held=d.held; intent=d.intent;
    const dx=-s.x,dz=-s.z, dn=Math.hypot(dx,dz)||1, ux=-dx/dn,uz=-dz/dn;
    const R=intent==='observe'?(beta?BETA_TUNE.smartPounceObserveRadius:7.2):(beta?BETA_TUNE.smartPounceApproachRadius:3.4);
    const target=(intent==='observe'||intent==='approach')?{x:ux*R,z:uz*R}:{x:0,z:0};
    const prevX=s.x,prevZ=s.z;
    if(beta&&intent==='pounce'){ const targetDash=Math.max(1.5,Math.min(4.3,dist-2.5)); let lo=.08,hi=.42; for(let k=0;k<12;k++){const mid=(lo+hi)/2; const accel=18, speed=10.6*1.18; let v=0,dd=0,t=mid; while(t>1e-9){v+=Math.max(-accel*dt,Math.min(accel*dt,speed-v));dd+=v*dt;t-=dt;} if(dd<targetDash)lo=mid;else hi=mid;} s.pounceDashDuration=hi; }
    const n=stepSmartMotion(s,target,dt,intent,{commitAllowed:true,stalkSpeed:2.4,sprintSpeed:6.5});
    if(!s.pounceCommitted&&n.pounceCommitted){ commits++; rec.push({time:+now.toFixed(2),distance:+dist.toFixed(2),angle:0,suspicion:+suspicion.toFixed(2),memory:+memory.toFixed(2),fatigue:+fatigue.toFixed(2)}); }
    if(n.pounceCommitted&&n.pounceStriking&&!hitSet&&pointSeg(prevX,prevZ,n.x,n.z,0,0)<1.3){hits++;hitSet=true;}
    if(!n.pounceCommitted&&s.pounceCommitted) hitSet=false;
    fatigue=Math.max(0,Math.min(1,fatigue+(n.pounceCommitted?.22:-.08)*dt)); s=n;
  }
  return {scenario:name,commits,hits,commitRate:+(commits/(duration/60)).toFixed(3),hitRate:commits?+(hits/commits).toFixed(3):0,submissions:rec.slice(0,8)};
}
const results=scenarios.map(([n,v,m])=>run(n,v,m,n==='multi_fox'));
if (process.env.SMARTFOX_ASSERT === '1') {
  const facing = results.find((r) => r.scenario === 'facing');
  assert.ok(facing.commits > 0, 'closed loop must submit at least once');
  assert.ok(facing.hits > 0, 'closed loop must hit at least once');
  assert.ok(facing.commitRate > 0 && facing.hitRate > 0, 'submission and hit rates are independent non-zero assertions');
}
console.log(JSON.stringify({beta,results},null,2));
