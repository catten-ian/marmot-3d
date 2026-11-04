const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const { loadPafDefaults } = require('./paf-test-helper.cjs');
let noise, pounce, input, predator;
const cfg = loadPafDefaults();
before(async () => {
  noise = await import('../src/core/paf-noise.js'); pounce = await import('../src/core/paf-pounce.js');
  input = await import('../src/core/paf-input.js'); predator = await import('../src/core/predator-prey.js');
});
test('quiet preparation has independent radius/strength and zero hearing outside its radius', () => {
  const stationary = noise.pafNoiseState({ phase: 'wind', groundSpeed: 0, sprint: true }, cfg);
  assert.equal(stationary.hearingRadius, .9); assert.equal(stationary.noiseCoef, .12);
  assert.ok(stationary.hearingRadius < cfg.hearRadiusStalk);
  assert.ok(stationary.noiseCoef < cfg.noiseCoefStalk);
  const cue = predator.perceptionCue({dist:1.5,inCone:false,mode:stationary.mode}, noise.pafNoiseConfig(stationary,cfg));
  assert.equal(cue.hearing, 0);
  assert.ok(predator.perceptionCue({dist:1.5,inCone:false,mode:'stalk'},cfg).hearing > 0);
  const tuned = {...cfg,hearRadiusStalk:.3,noiseCoefStalk:.04};
  const quietTuned = noise.pafNoiseState({phase:'wind'},tuned);
  assert.ok(quietTuned.hearingRadius < tuned.hearRadiusStalk); assert.ok(quietTuned.noiseCoef < tuned.noiseCoefStalk);
});
test('noise modes follow ground state: idle, wind quiet/stalk/sprint, and lunge', () => {
  const idleQuiet = noise.pafNoiseState({ phase: 'idle', groundSpeed: 0, sprint: false }, cfg);
  assert.equal(idleQuiet.mode, 'stalk');
  assert.equal(idleQuiet.hearingRadius, cfg.hearRadiusStalk);
  assert.equal(idleQuiet.noiseCoef, cfg.noiseCoefStalk);

  const windQuiet = noise.pafNoiseState({ phase: 'wind', groundSpeed: 0, sprint: true }, cfg);
  assert.equal(windQuiet.mode, 'stalk');
  assert.equal(windQuiet.hearingRadius, .9);
  assert.equal(windQuiet.noiseCoef, .12);
  assert.equal(windQuiet.quietPreparation, true);

  const windStalk = noise.pafNoiseState({ phase: 'wind', groundSpeed: 1, sprint: false }, cfg);
  assert.equal(windStalk.mode, 'stalk');
  assert.equal(windStalk.hearingRadius, cfg.hearRadiusStalk);
  assert.equal(windStalk.noiseCoef, cfg.noiseCoefStalk);
  assert.equal(windStalk.visionMode, 'lunge');

  const windSprint = noise.pafNoiseState({ phase: 'wind', groundSpeed: cfg.runSpeed, sprint: true }, cfg);
  assert.equal(windSprint.mode, 'sprint');
  assert.equal(windSprint.hearingRadius, cfg.hearRadiusSprint);
  assert.equal(windSprint.noiseCoef, cfg.noiseCoefSprint);
  assert.equal(windSprint.visionMode, 'lunge');

  const lunge = noise.pafNoiseState({ phase: 'lunge', groundSpeed: 0, lungeRange: cfg.pounceRangeDefault }, cfg);
  assert.equal(lunge.mode, 'lunge');
  assert.equal(lunge.hearingRadius, cfg.detectLunge);
  assert.equal(lunge.noiseCoef, cfg.noiseCoefLunge);
  assert.equal(lunge.visionMode, 'lunge');
  for (const wind of [windQuiet, windStalk, windSprint]) assert.notEqual(wind.mode, 'lunge');

  const min = noise.pafNoiseState({phase:'lunge',lungeRange:cfg.pounceRangeMin},cfg);
  const max = noise.pafNoiseState({phase:'lunge',lungeRange:cfg.pounceRangeMax},cfg);
  assert.ok(min.hearingRadius < lunge.hearingRadius && lunge.hearingRadius < max.hearingRadius);
  for (const n of [windQuiet, windStalk, windSprint, lunge, min, max]) {
    const actual = predator.perceptionCue({dist:n.hearingRadius * .9,inCone:false,mode:n.mode}, noise.pafNoiseConfig(n,cfg));
    assert.equal(actual.hearR,n.hearingRadius);
  }
  assert.equal(noise.pafNoiseState({phase:'lunge',groundSpeed:0,lungeRange:cfg.pounceRangeMin},cfg).noiseCoef,cfg.noiseCoefLunge);
  for (const phase of ['idle','recover']) for(const sprint of [false,true]) {
    const n=noise.pafNoiseState({phase,sprint},cfg);
    assert.equal(n.hearingRadius,sprint?cfg.hearRadiusSprint:cfg.hearRadiusStalk);
    assert.equal(n.noiseCoef,sprint?cfg.noiseCoefSprint:cfg.noiseCoefStalk);
  }
});
test('preview phases include full recovery but exclude idle and canceled state', () => {
  assert.deepEqual(['idle','wind','lunge','recover','idle'].map(pounce.pafPouncePreviewActive),[false,true,true,true,false]);
  assert.deepEqual(pounce.PAF_POUNCE_PREVIEW_STYLE,{color:0x9fd8ff,opacity:.28});
});
test('footprint rotates with the exact live path, retaining configured length/width and no rear ring', () => {
  for(const yaw of [0,.7,Math.PI/2,-2.3]) {
    const params={startX:2,startZ:-4,yaw,lungeSpeed:cfg.lungeSpeed,lungeTime:cfg.lungeTime,catchRadius:cfg.catchRadius};
    const f=pounce.pafPounceFootprint(params);
    assert.deepEqual(f.start,pounce.pafPouncePathAt({...params,t:.5}));
    assert.deepEqual(f.end,pounce.pafPouncePathAt({...params,t:1}));
    assert.equal(f.radius,cfg.catchRadius);
    for(const v of f.points){
      const along=(v.x-params.startX)*Math.sin(yaw)+(v.z-params.startZ)*Math.cos(yaw);
      const lateral=(v.x-params.startX)*Math.cos(yaw)-(v.z-params.startZ)*Math.sin(yaw);
      assert.ok(along>=cfg.lungeSpeed*cfg.lungeTime*.5-cfg.catchRadius-1e-9);
      assert.ok(along<=cfg.lungeSpeed*cfg.lungeTime+cfg.catchRadius+1e-9);
      assert.ok(Math.abs(lateral)<=cfg.catchRadius+1e-9);
    }
  }
});
test('no input at a nonzero heading preserves facing instead of adding yaw twice',()=>{
  for(const cameraYaw of [.7,-2,3.1]) assert.equal(input.pafDirectionFromInput({cameraYaw}).yaw,cameraYaw);
});

class ClassList {
  constructor() { this.s = new Set(); }
  add(c) { this.s.add(c); } remove(c) { this.s.delete(c); } toggle(c, f) { const on = f === undefined ? !this.s.has(c) : !!f; on ? this.s.add(c) : this.s.delete(c); return on; }
  contains(c) { return this.s.has(c); }
}
class El {
  constructor(tag, attrs = {}) { this.tag = tag; this.attrs = attrs; this.listeners = []; this.classList = new ClassList(); this.style = { _m: {}, setProperty(k, v) { this._m[k] = v; } }; this.children = []; this.dataset = {}; }
  addEventListener(type, fn, opts) { this.listeners.push({ type, fn, capture: opts === true || (opts && opts.capture) }); }
  dispatch(type, ev) {
    for (const l of this.listeners.filter((x) => x.type === type)) l.fn(ev);
  }
  appendChild(c) { this.children.push(c); return c; }
  querySelector(sel) { return this._walk().find((e) => e._match(sel)) || null; }
  querySelectorAll(sel) { return this._walk().filter((e) => e._match(sel)); }
  _walk(out = []) { for (const c of this.children) { out.push(c); c._walk(out); } return out; }
  _match(sel) {
    const mHas = sel.match(/^\[([\w-]+)\]$/);
    if (mHas) return Object.prototype.hasOwnProperty.call(this.attrs, mHas[1]);
    const m = sel.match(/^\[([\w-]+)="?([^"\]]+)"?\]$/);
    if (m) return this.attrs[m[1]] === m[2];
    return this.tag === sel;
  }
  getBoundingClientRect() { return { left: 0, top: 0, width: 100, height: 100 }; }
  setPointerCapture() {}
}


test('real TouchControls: PAF cancellation is guarded, three roles coexist, restore preserves ordinary releases', async () => {
  const handlers = {};
  globalThis.window = {ontouchstart:null,addEventListener(type,fn){(handlers[type] ||= []).push(fn);}};
  globalThis.document = {body:{classList:new ClassList()},addEventListener(){},pointerLockElement:null};
  const {TouchControls}=await import('../src/core/touch-controls.js');
  const root=new El('div'), lookZone=new El('div'), joystick=new El('div'), stick=new El('div');
  const attack=new El('button',{'data-touch-action':'attack'});attack.dataset.touchAction='attack';root.appendChild(attack);
  const normalEvents=[];const normal={yaw:0,pitch:0,touchLookSensitivity:.006};
  const tc=new TouchControls({canvas:{},controller:normal,root,lookZone,joystick,stick,enabled:true,isActive:()=>true,onAction:(...e)=>normalEvents.push(e)});
  const event=(id,x=50,y=50)=>({changedTouches:[{identifier:id,clientX:x,clientY:y}],preventDefault(){},stopPropagation(){}});
  const fire=(type,id)=>{for(const f of handlers[type]||[])f({...event(id),type});};
  const route=new input.PafInputRoute(tc);const canceled=[],actions=[],look=[],pitch=[];
  route.activate({onAction:(...e)=>actions.push(e),onCancel:(...e)=>canceled.push(e),onLook:d=>look.push(d),onPitch:d=>pitch.push(d)});
  joystick.dispatch('touchstart',event(1,50,26));lookZone.dispatch('touchstart',event(2));attack.dispatch('touchstart',event(3));
  assert.deepEqual([...tc.pointerRoles.values()],['move','look','button:attack']);
  lookZone.dispatch('touchmove',event(2,70,30));assert.ok(look.at(-1)<0);assert.ok(pitch.at(-1)>0);
  tc._finishPointer({pointerId:3,pointerType:'touch',type:'pointerup'});
  assert.equal(tc.pointerRoles.get(3),'button:attack','compatibility pointerup for another finger cannot release touch identifier 3');
  fire('touchcancel',3);assert.deepEqual(canceled,[['attack',3]]);assert.equal(actions.filter(e=>!e[1]).length,0);
  assert.equal(tc.movePointer,1);assert.equal(tc.lookPointer,2);assert.equal(tc.move.y,.5);
  attack.dispatch('touchstart',event(4));fire('touchend',4);assert.equal(actions.filter(e=>!e[1]).length,1);
  route.restore();assert.equal(tc.controller,normal);assert.equal(tc.onCancel,undefined);assert.equal(tc.pointerRoles.size,0);
  attack.dispatch('touchstart',event(5));tc._finishPointer({pointerId:5,pointerType:'touch',type:'pointercancel'});
  assert.equal(normalEvents.length,2);assert.equal(normalEvents[1][1],false,'ordinary cancellation retains the pre-existing release callback');
  attack.dispatch('touchstart',event(6));tc.releaseAll();assert.equal(normalEvents.at(-1)[1],false);
});
test('terrain preview vertices and centers pass the actual catch predicate, including height; impossible height emits nothing',()=>{
  const params={...cfg,startX:2,startZ:-4,yaw:.7};
  const terrain=(x,z)=>.06*x+.03*z;
  const vertices=pounce.pafPounceGroundPreview(params,terrain);
  assert.ok(vertices.length>0);
  const hit=(x,z)=>pounce.pafPouncePredictionHitsTarget({...params,targetX:x,targetZ:z,foxTerrainAt:terrain,preyTerrainAt:terrain}).hit;
  for(let i=0;i<vertices.length;i+=3) assert.equal(hit(vertices[i],vertices[i+2]),true);
  for(let i=0;i<vertices.length;i+=9) assert.equal(hit((vertices[i]+vertices[i+3]+vertices[i+6])/3,(vertices[i+2]+vertices[i+5]+vertices[i+8])/3),true);
  assert.equal(pounce.pafPounceGroundPreview({...params,catchVerticalTol:0},terrain).length,0);
});

test('global cancel gate respects the Touch/pointer namespace and owns only its mouse/pointer',()=>{
  assert.equal(input.pafChargeCanceledByPointer(3,{pointerId:3,pointerType:'touch'},true),false);
  assert.equal(input.pafChargeCanceledByPointer(3,{pointerId:3,pointerType:'touch'},false),true);
  assert.equal(input.pafChargeCanceledByPointer(3,{pointerId:4,pointerType:'mouse'},false),false);
  assert.equal(input.pafChargeCanceledByPointer('mouse',{pointerId:9,pointerType:'mouse'},false),true);
  assert.equal(input.pafChargeCanceledByPointer(null,{pointerId:3,pointerType:'mouse'},false),false);
});
