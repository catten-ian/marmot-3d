import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeFrames, percentile, allGatesPass } from './stats.ts';
import { multiTouchMoveFrames, touchPoint } from './input.ts';
import { rewritePublishedAssetUrl } from './server.ts';
import { resolveSettlePlan, shouldExitStage1Early, describeSchedule, DEFAULT_SETTLE_IN_MS, DEFAULT_SETTLE_AFTER_MS } from './plan.ts';

test('wait plan: no explicit two-stage flags keeps the legacy single fixed deadline',()=>{
  const plan=resolveSettlePlan({settleMs:15000,settleInMs:null,settleAfterMs:null});
  assert.equal(plan.mode,'single');
  assert.equal(plan.stage1Ms,15000);
  assert.equal(plan.stage2Ms,0);
  assert.equal(plan.maxTotalMs,15000);
  // 单段模式必须跑满固定死线，不得改成"就绪即退出"。
  assert.equal(shouldExitStage1Early(plan.mode),false);
});

test('wait plan: either explicit flag switches to two-stage with independent budgets',()=>{
  const both=resolveSettlePlan({settleMs:15000,settleInMs:60000,settleAfterMs:5000});
  assert.equal(both.mode,'two-stage');
  assert.equal(both.stage1Ms,60000);
  assert.equal(both.stage2Ms,5000);
  assert.equal(both.maxTotalMs,65000);
  assert.equal(shouldExitStage1Early(both.mode),true);

  // 只给第一段：第二段回落到默认值，第一段按用户给的值。
  const onlyIn=resolveSettlePlan({settleMs:15000,settleInMs:30000,settleAfterMs:null});
  assert.equal(onlyIn.mode,'two-stage');
  assert.equal(onlyIn.stage1Ms,30000);
  assert.equal(onlyIn.stage2Ms,DEFAULT_SETTLE_AFTER_MS);

  // 只给第二段：第一段回落到默认值。
  const onlyAfter=resolveSettlePlan({settleMs:15000,settleInMs:null,settleAfterMs:20000});
  assert.equal(onlyAfter.mode,'two-stage');
  assert.equal(onlyAfter.stage1Ms,DEFAULT_SETTLE_IN_MS);
  assert.equal(onlyAfter.stage2Ms,20000);
});

test('wait plan: invalid timings are rejected instead of silently falling back',()=>{
  assert.throws(()=>resolveSettlePlan({settleMs:-1,settleInMs:null,settleAfterMs:null}),/Invalid timing: settleMs/);
  assert.throws(()=>resolveSettlePlan({settleMs:15000,settleInMs:-5,settleAfterMs:null}),/Invalid timing: settleInMs/);
  assert.throws(()=>resolveSettlePlan({settleMs:15000,settleInMs:null,settleAfterMs:-5}),/Invalid timing: settleAfterMs/);
  assert.throws(()=>resolveSettlePlan({settleMs:Number.NaN,settleInMs:null,settleAfterMs:null}),/Invalid timing: settleMs/);
});

test('wait plan: describeSchedule reports the actually effective schedule',()=>{
  const legacy=describeSchedule(['--load-wait-ms=120000','--settle-ms=15000','--move-ms=10000']);
  assert.equal(legacy.mode,'single');
  assert.equal(legacy.stage1Ms,15000);
  assert.equal(legacy.stage2Ms,0);

  const twoStage=describeSchedule(['--settle-in-ms=90000','--settle-after-ms=8000']);
  assert.equal(twoStage.mode,'two-stage');
  assert.equal(twoStage.stage1Ms,90000);
  assert.equal(twoStage.stage2Ms,8000);
  assert.equal(twoStage.loadWaitMs,120000);
  assert.equal(twoStage.moveMs,10000);
});

test('frame summary computes deterministic percentiles and counts',()=>{
  const result=summarizeFrames([10,20,30,51]);
  assert.equal(result.sampleCount,4);assert.equal(result.meanDtMs,27.75);assert.equal(result.p50DtMs,20);assert.equal(result.p95DtMs,51);assert.equal(result.over50ms,1);assert.ok(Math.abs((result.averageFps||0)-1000/27.75)<1e-10);
});
test('percentile handles empty and single samples',()=>{assert.equal(percentile([],0.5),null);assert.equal(percentile([17],0.99),17);});
test('multitouch preserves joystick while jump finger is lifted',()=>{
  const joystick={x:100,y:700,left:40,top:640,width:120,height:120};const jump={x:330,y:700,left:300,top:670,width:60,height:60};
  const frames=multiTouchMoveFrames(joystick,jump,60);
  assert.deepEqual(frames.map((x)=>x.type),['touchStart','touchMove','touchStart','touchEnd']);
  assert.deepEqual(frames[0].points.map((x)=>[x.id,x.x,x.y]),[[1,100,700]]);
  assert.deepEqual(frames[1].points.map((x)=>[x.id,x.x,x.y]),[[1,100,640]]);
  assert.deepEqual(frames[2].points.map((x)=>x.id),[1,2]);
  assert.deepEqual(frames[3].points.map((x)=>x.id),[2]);
  assert.equal(touchPoint(2,330,700).id,2);
});
test('gate aggregation never treats missing/false gates as green',()=>{
  assert.equal(allGatesPass({a:{pass:true},b:{pass:true}}),true);assert.equal(allGatesPass({a:{pass:true},b:{pass:false}}),false);assert.equal(allGatesPass({}),false);
});

test('published assets rewrite only to a safe local URL path',()=>{
  assert.equal(rewritePublishedAssetUrl('https://marmot.tos-cn-shanghai.volces.com/m3d-dev/20261027/low/assets/models/marmot.glb?x=1',18432),'http://127.0.0.1:18432/assets/models/marmot.glb?x=1');
  assert.equal(rewritePublishedAssetUrl('https://example.com/assets/models/marmot.glb',18432),null);
  assert.equal(rewritePublishedAssetUrl('https://marmot.tos-cn-shanghai.volces.com/no-assets/marmot.glb',18432),null);
});
