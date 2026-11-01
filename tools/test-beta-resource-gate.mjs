import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createResourceEntryGate } from '../src/models/beta-resource-gate.mjs';

const defer = () => { let resolve, reject; const promise = new Promise((r,j)=>{resolve=r;reject=j}); return {promise,resolve,reject}; };
test('concurrent callers share one ready batch and first action only', async () => {
  const d = defer(); let loads = 0, enters = [];
  const gate = createResourceEntryGate({ resources: [{id:'rig', load: async()=>{loads++; return d.promise;}}], audioReady: async()=>{} });
  const a = gate.enter(()=>enters.push('first')); const b = gate.enter(()=>enters.push('second'));
  d.resolve(true); await Promise.all([a,b]); assert.equal(loads,1); assert.deepEqual(enters,['first']);
  await gate.enter(()=>enters.push('later')); assert.deepEqual(enters,['first','later']);
});
test('pending or rejected resource blocks entry and reset retries only failed resource', async () => {
  let ok = false, calls = 0, resets = 0;
  const gate = createResourceEntryGate({ resources: [{id:'fox', load: async()=>{calls++; if(!ok) throw new Error('offline'); return true;}, reset:()=>{resets++;}}], audioReady: async()=>{} });
  const pending = gate.enter(()=>{ throw new Error('must not enter'); });
  await assert.rejects(pending, /offline/); assert.equal(calls,1); gate.reset(); assert.equal(resets,1); ok=true; await gate.enter(); assert.equal(calls,2);
});
test('audio failure preserves successful model cache and retries audio only', async () => {
  let modelCalls=0, audioCalls=0, failAudio=true, modelResets=0;
  const gate = createResourceEntryGate({ resources: [{id:'model',load:async()=>{modelCalls++;return true;},reset:()=>{modelResets++;}}], audioReady:async()=>{audioCalls++;if(failAudio)throw new Error('decode failed');} });
  await assert.rejects(gate.preload(), /decode failed/); gate.reset(); failAudio=false; await gate.preload(); assert.equal(modelCalls,1); assert.equal(modelResets,0); assert.equal(audioCalls,2);
});
test('integrated audio gate uses the real public whenReady API', async () => {
  const main = fs.readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  const { Audio } = await import('../src/systems/audio.js');
  assert.equal(typeof Audio.prototype.whenReady, 'function');
  assert.match(main, /typeof audio\.whenReady !== 'function'/);
  assert.match(main, /await audio\.whenReady\(\{ retry: true \}\)/);
  assert.doesNotMatch(main, /await audio\.ready\(\)/);
});
test('main uses gate action injection, preserves stable/dev ensure, and wires URL sandbox', () => {
  const main = fs.readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  assert.match(main, /betaEntryGate\.enter\(async \(\) =>/);
  assert.doesNotMatch(main, /await betaEntryGate\.enter\(\);\s*return await action/);
  assert.match(main, /function startPlay\(\) \{\s*if \(!IS_BETA\) audio\.ensure\(\);/s);
  assert.match(main, /if \(SANDBOX_MODE\).*enterSandbox/s);
});
test('Beta manifest covers required model, scene, and sky URLs/types', () => {
  const src = fs.readFileSync(new URL('../src/models/beta-resources.js', import.meta.url), 'utf8');
  for (const path of ['marmot-run-stand.glb','fox.glb','terrain-lod.glb','citrus_orchard_road_puresky_1k.jpg']) assert.match(src, new RegExp(path.replaceAll('.', '\\.' )));
  assert.match(src, /requiredClips: \['Run', 'StandIdle', 'StandUp'\]/);
  assert.match(src, /kind: 'model'/); assert.match(src, /kind: 'scene'/); assert.match(src, /kind: 'texture'/);
});

// Execute the production functions with injected browser/loader dependencies;
// no DOM renderer, GPU, network, browser or simulated timer is involved.

const mainSource = fs.readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
const propsSource = fs.readFileSync(new URL('../src/entities/props_entities.js', import.meta.url), 'utf8');
const entryCode = mainSource.slice(mainSource.indexOf('let betaEntryAttempt = null;'), mainSource.indexOf('// —— 场景远景 ——'));
const playerCode = mainSource.slice(mainSource.indexOf('let playerRig = null;'), mainSource.indexOf('if (IS_BETA) void ensurePlayerRig()'));
function entryHarness({ beta = true, gate } = {}) {
  const events = [];
  const ctx = vm.createContext({ IS_BETA: beta, betaEntryGate: gate,
    audio: { ensure() { events.push('ensure'); return true; } },
    hud: { beginLoadingSession() {}, hideLoader() {}, showPanel() {} },
    document: { getElementById() { return { addEventListener() {} }; } }, escapeHtml: String,
  });
  vm.runInContext(entryCode, ctx);
  return { ctx, events, enter: (action) => ctx.enterWithBetaGate('test', action) };
}
test('actual main wrapper dedupes click/Enter actions and allows later restart/reentry', async () => {
  const model = defer(), audio = defer(); let actions = [];
  const gate = createResourceEntryGate({resources:[{id:'rig',load:()=>model.promise}],audioReady:()=>audio.promise});
  const h = entryHarness({gate});
  const first = h.enter(()=>actions.push('click')); const second=h.enter(()=>actions.push('Enter'));
  assert.equal(first,second); assert.deepEqual(h.events,['ensure']); assert.deepEqual(actions,[]);
  model.resolve(true); await Promise.resolve(); assert.deepEqual(actions,[]);
  audio.resolve(true); await first; assert.deepEqual(actions,['click']);
  await h.enter(()=>actions.push('restart')); await h.enter(()=>actions.push('exit and reenter'));
  assert.deepEqual(actions,['click','restart','exit and reenter']);
});
test('actual startPlay preserves synchronous Stable and Dev ensure-before-load semantics', () => {
  const code = mainSource.slice(mainSource.indexOf('function startPlay()'), mainSource.indexOf('function resetAll()'));
  for (const version of ['stable','dev']) {
    const h=entryHarness({beta:false});
    Object.assign(h.ctx, { hidePauseMini(){}, hud:{hidePanel(){}}, game:{level:2},
      controller:{touchEnabled:true}, loadLevel:(level)=>h.events.push(`load:${level}`) });
    vm.runInContext(code,h.ctx); h.ctx.startPlay();
    assert.deepEqual(h.events,['ensure','load:2'],version); assert.equal(h.ctx.game.mode,'play');
  }
});
test('actual player initializer waits for model and rig, retries rejection/empty/rig failure, attaches once', async () => {
  for (const failure of ['reject','empty','rig']) {
    const pending=defer(); let calls=0, attaches=0, constructs=0;
    const ctx=vm.createContext({IS_BETA:true,USE_REAL_MODELS:true,console:{warn(){}},disposeModelInstance(){},
      instantiate:()=>{ calls++; return calls===1 ? (failure==='reject' ? Promise.reject(new Error('offline')) : Promise.resolve(failure==='empty'?null:{})) : pending.promise; },
      BetaMarmotModel:class {constructor(){ constructs++; if(failure==='rig' && constructs===1)throw new Error('rig failure');this.wrap={};}},
      playerModel:{add(){attaches++;}},playerBody:{visible:true},
    });
    vm.runInContext(playerCode,ctx);
    await assert.rejects(ctx.ensurePlayerRig());
    const retry=ctx.ensurePlayerRig(); assert.equal(ctx.ensurePlayerRig(),retry);
    let entered=0;
    const gate=createResourceEntryGate({resources:[{id:'player-rig',load:()=>retry}],audioReady:async()=>{}});
    const entering=gate.enter(()=>entered++);
    await Promise.resolve(); assert.equal(entered,0); assert.equal(attaches,0);
    pending.resolve({}); await entering; await ctx.ensurePlayerRig();
    assert.equal(entered,1); assert.equal(calls,2); assert.equal(attaches,1);
  }
});
test('actual Companion ready waits for initialization and retries failed/empty initialization', async () => {
  const methods=propsSource.slice(propsSource.indexOf('  ensureReady()'), propsSource.indexOf('  /**',propsSource.indexOf('  resetReady()')));
  for (const failure of ['reject','empty']) {
    let calls=0,resets=0; const pending=defer();
    const ctx=vm.createContext({resetModelLoadCache(){resets++;}});
    vm.runInContext(`class ReadyCompanion {${methods}}; globalThis.ReadyCompanion=ReadyCompanion;`,ctx);
    const c=new ctx.ReadyCompanion();
    c._loadRealModel=async()=>{calls++;if(calls===1){if(failure==='reject')throw new Error('load');return false;}await pending.promise;c.realModel={};c.rig={};return true;};
    await assert.rejects(c.ensureReady()); c.resetReady();
    const retry=c.ensureReady(); assert.equal(retry,c.ensureReady());
    let entered=0; const gate=createResourceEntryGate({resources:[{id:'companion-rig',load:()=>c.ensureReady()}],audioReady:async()=>{}});
    const entering=gate.enter(()=>entered++); await Promise.resolve();assert.equal(entered,0);
    pending.resolve();await entering;await c.ensureReady();c.resetReady();
    assert.equal(entered,1);assert.equal(calls,2);assert.equal(resets,1);
  }
});
test('actual URL auto-sandbox callback passes through the same main entry wrapper', async () => {
  const h=entryHarness({gate:createResourceEntryGate({resources:[{id:'m',load:async()=>true}],audioReady:async()=>{}})});
  const frames=[];let enters=0;
  Object.assign(h.ctx,{SANDBOX_MODE:true,requestAnimationFrame:(fn)=>frames.push(fn),enterSandboxReady:()=>enters++});
  const code=mainSource.slice(mainSource.indexOf('function enterSandbox()'),mainSource.indexOf('function enterSandboxReady()'));
  vm.runInContext(code,h.ctx);
  const line=mainSource.split('\n').find((line)=>line.startsWith('if (SANDBOX_MODE) requestAnimationFrame'));
  vm.runInContext(line,h.ctx);frames.shift()();const done=frames.shift()();await done;
  assert.equal(enters,1);assert.deepEqual(h.events,['ensure']);
});

test('actual main retry button keeps first action and reuses fulfilled models after audio failure', async () => {
  let modelLoads=0,audioLoads=0,first=0,second=0,retry;
  const gate=createResourceEntryGate({resources:[{id:'model',load:async()=>{modelLoads++;return true;}}],audioReady:async()=>{if(++audioLoads===1)throw new Error('decode failed');}});
  const h=entryHarness({gate});
  h.ctx.document.getElementById=()=>({addEventListener:(_event,fn)=>{retry=fn;}});
  await Promise.all([h.enter(()=>first++),h.enter(()=>second++)]);
  assert.equal(first,0);assert.equal(second,0);assert.equal(typeof retry,'function');
  retry(); await vm.runInContext('betaEntryAttempt',h.ctx);
  assert.equal(first,1);assert.equal(second,0);assert.equal(modelLoads,1);assert.equal(audioLoads,2);
});
test('resource batch waits for all pending initializers before failed reset; only failed resources reload', async () => {
  const late=defer();let fail=true,goodCalls=0,badCalls=0,resets=0,entered=0;
  const gate=createResourceEntryGate({resources:[
    {id:'bad',load:async()=>{badCalls++;if(fail)throw new Error('404');return true;},reset:()=>resets++},
    {id:'good-rig',load:async()=>{goodCalls++;await late.promise;return true;}},
  ],audioReady:async()=>{}});
  const attempt=gate.enter(()=>entered++);await Promise.resolve();gate.reset();
  assert.equal(resets,0);assert.equal(entered,0);assert.equal(gate.pending,true);
  late.resolve();await assert.rejects(attempt,/404/);gate.reset();fail=false;
  await gate.enter(()=>entered++);assert.equal(entered,1);assert.equal(goodCalls,1);assert.equal(badCalls,2);assert.equal(resets,1);assert.equal(gate.pending,false);
});
test('manifest maps player and companion to the same runtime URL and validates exact required types', () => {
  const src=fs.readFileSync(new URL('../src/models/beta-resources.js',import.meta.url),'utf8');
  const literal=src.slice(src.indexOf('Object.freeze([')+'Object.freeze('.length,src.indexOf(']);')+1);
  const manifest=vm.runInNewContext(literal);
  assert.deepEqual(Array.from(manifest,(s)=>[s.url,s.kind]),[
    ['./assets/models/marmot-run-stand.glb','model'],['./assets/models/fox.glb','model'],
    ['./assets/models/terrain-lod.glb','scene'],['assets/sky/citrus_orchard_road_puresky_1k.jpg','texture'],
  ]);
  assert.deepEqual(Array.from(manifest[0].consumers),['player','companion']);
  assert.match(mainSource,/PLAYER_MODEL_URL = '\.\/assets\/models\/marmot-run-stand.glb'/);
  assert.match(propsSource,/IS_BETA \? 'marmot-run-stand.glb' : 'marmot.glb'/);
  assert.match(mainSource,/load: \(\) => companion.ensureReady\(\)/);
});

test('loader failedOnly reset retains successful parsed GLBs and removes failed cache entries', () => {
  const src=fs.readFileSync(new URL('../src/models/loader.js',import.meta.url),'utf8');
  const code=src.slice(src.indexOf('export function resetModelLoadCache'),src.indexOf('export function loadModel(')).replace('export ','');
  const entries=new Map([['good',{failed:false}],['bad',{failed:true}]]);
  const ctx=vm.createContext({cache:{entries}});vm.runInContext(code,ctx);
  ctx.resetModelLoadCache('good',{failedOnly:true});ctx.resetModelLoadCache('bad',{failedOnly:true});
  assert.equal(entries.has('good'),true);assert.equal(entries.has('bad'),false);
});
test('failed rig instance cleanup releases materials/skeleton but retains shared geometry/textures', () => {
  const src=fs.readFileSync(new URL('../src/models/loader.js',import.meta.url),'utf8');
  const code=src.slice(src.indexOf('export function disposeModelInstance'),src.indexOf('/**\n * 预加载：')).replace('export ','');
  const ctx=vm.createContext({});vm.runInContext(code,ctx);let material=0,skeleton=0,shared=0;
  ctx.disposeModelInstance({traverse(fn){fn({isSkinnedMesh:true,skeleton:{dispose(){skeleton++;}},geometry:{dispose(){shared++;}},material:{dispose(){material++;},map:{dispose(){shared++;}}}});}});
  assert.equal(material,1);assert.equal(skeleton,1);assert.equal(shared,0);
});
