import test from 'node:test';
import assert from 'node:assert/strict';
import { createResourceEntryGate } from '../src/models/beta-resource-gate.mjs';

const defer = () => { let resolve, reject; const promise = new Promise((r,j)=>{resolve=r;reject=j}); return {promise,resolve,reject}; };
test('waits for all resources and audio, dedupes concurrent entry, enters once', async () => {
  const d = defer(); let loads = 0, enters = 0;
  const gate = createResourceEntryGate({ resources: [{id:'rig', load: async()=>{loads++; return d.promise;}}], audioReady: async()=>{} });
  const a = gate.enter(()=>{ enters++; }); const b = gate.enter(()=>{ enters++; });
  d.resolve(true); await Promise.all([a,b]); assert.equal(loads,1); assert.equal(enters,1);
});
test('pending or rejected resource blocks entry and reset retries', async () => {
  let ok = false, calls = 0;
  const gate = createResourceEntryGate({ resources: [{id:'fox', load: async()=>{calls++; if(!ok) throw new Error('offline'); return true;}}], audioReady: async()=>{} });
  await assert.rejects(gate.preload(), /offline/); assert.equal(calls,1); gate.reset(); ok=true; await gate.enter(); assert.equal(calls,2);
});
test('audio rejection blocks entry with explicit failure', async () => {
  let entered = false;
  const gate = createResourceEntryGate({ resources: [{id:'m',load:async()=>true}], audioReady: async()=>{throw new Error('decode failed');} });
  await assert.rejects(gate.enter(()=>{entered=true}), /decode failed/); assert.equal(entered,false);
});
test('cache promise is reused after success', async () => {
  let calls=0; const gate=createResourceEntryGate({resources:[{id:'x',load:async()=>{calls++;return 1}}],audioReady:async()=>{}});
  await gate.preload(); await gate.enter(); assert.equal(calls,1);
});
