import type { CdpSession } from './cdp.ts';
import type { Sample } from './types.ts';
import { clockTicksPerSecond, readChromeTree, round } from './util.ts';
import { summarizeMetricDeltas } from './stats.ts';
const METRICS = ['ScriptDuration','TaskDuration','LayoutDuration','RecalcStyleDuration'];
export class MetricsCollector {
  readonly page: CdpSession;
  readonly rootPid: number;
  readonly samples: Sample[] = [];
  readonly stages: Array<{stage:string;at:string;elapsedMs:number}> = [];
  readonly procPids = new Set<number>();
  readonly gpuPids = new Set<number>();
  private prevMetrics = new Map<string,number>();
  private prevCpuTicks = 0;
  private prevGroupCpuTicks = new Map<string,number>();
  private prevProcAt = 0;
  private lastStage = '';
  readonly ticksPerSecond = clockTicksPerSecond();
  readonly startedAtMs: number;
  constructor(page:CdpSession, rootPid:number, startedAtMs:number) { this.page=page; this.rootPid=rootPid; this.startedAtMs=startedAtMs; }
  async sample(phase:string) {
    const now=Date.now();
    const performance=await this.page.send('Performance.getMetrics').catch(()=>null);
    const pageMetrics:Record<string,number|null>={};
    for(const metric of performance?.metrics||[]) if(METRICS.includes(metric.name)) pageMetrics[metric.name]=metric.value;
    const metricDeltas:Record<string,number|null>={};
    for(const key of METRICS){const current=pageMetrics[key];const previous=this.prevMetrics.get(key);metricDeltas[key]=typeof current==='number'&&typeof previous==='number'?Math.max(0,current-previous):null;if(typeof current==='number')this.prevMetrics.set(key,current);}
    const task=metricDeltas.TaskDuration;
    const metricRatios={
      scriptOfTask:typeof task==='number'&&task>0&&typeof metricDeltas.ScriptDuration==='number'?metricDeltas.ScriptDuration/task:null,
      layoutOfTask:typeof task==='number'&&task>0&&typeof metricDeltas.LayoutDuration==='number'?metricDeltas.LayoutDuration/task:null,
      recalcStyleOfTask:typeof task==='number'&&task>0&&typeof metricDeltas.RecalcStyleDuration==='number'?metricDeltas.RecalcStyleDuration/task:null,
    };
    const pageState=await this.page.evaluate<any>(`(()=>{const m=performance.memory;return {heap:m?{usedJSHeapSize:m.usedJSHeapSize,totalJSHeapSize:m.totalJSHeapSize,jsHeapSizeLimit:m.jsHeapSizeLimit}:null,stage:String(window.__m3dBootStage||''),firstFrameAt:window.__m3dFirstFrameAt||null,mainStartedAt:window.__m3dMainStartedAt||null,ready:!!document.querySelector('#sandboxEntryBtn.sandbox-entry')}})()`).catch(()=>null);
    if(pageState?.stage && pageState.stage!==this.lastStage){this.lastStage=pageState.stage;this.stages.push({stage:pageState.stage,at:new Date(now).toISOString(),elapsedMs:now-this.startedAtMs});}
    const proc=readChromeTree(this.rootPid); for(const pid of proc.pids)this.procPids.add(pid);for(const pid of proc.gpuPids)this.gpuPids.add(pid);
    const elapsed=this.prevProcAt?now-this.prevProcAt:0;
    const cpuPercent=this.prevProcAt&&elapsed>0?((proc.cpuTicks-this.prevCpuTicks)/this.ticksPerSecond)/(elapsed/1000)*100:null;
    const processGroups:Record<string,any>={};for(const [name,group] of Object.entries(proc.groups as Record<string,any>)){const previous=this.prevGroupCpuTicks.get(name);processGroups[name]={pids:group.pids,rssBytes:group.rssBytes,cpuTicks:group.cpuTicks,cpuPercent:previous!==undefined&&elapsed>0?round(((group.cpuTicks-previous)/this.ticksPerSecond)/(elapsed/1000)*100,2):null};this.prevGroupCpuTicks.set(name,group.cpuTicks);}
    this.prevCpuTicks=proc.cpuTicks;this.prevProcAt=now;
    const sample:Sample={ts:new Date(now).toISOString(),elapsedMs:now-this.startedAtMs,phase,pageMetrics,metricDeltas,metricRatios,heap:pageState?.heap||null,chrome:{pids:proc.pids,gpuPids:proc.gpuPids,rssBytes:proc.rssBytes,cpuTicks:proc.cpuTicks,cpuPercent:round(cpuPercent??NaN,2),processGroups}};
    this.samples.push(sample);
    return {sample,pageState};
  }
  phaseSummary(){
    const phases=[...new Set(this.samples.map(s=>s.phase))];const out:Record<string,any>={};
    for(const phase of phases){const rows=this.samples.filter(s=>s.phase===phase);const cpus=rows.map(s=>s.chrome?.cpuPercent).filter((x):x is number=>typeof x==='number');const rss=rows.map(s=>s.chrome?.rssBytes||0);const processGroups=Object.fromEntries(['browser','renderer','gpu','other'].map((name)=>{const groupRows=rows.map((s)=>s.chrome?.processGroups?.[name]).filter(Boolean);const groupCpus=groupRows.map((x:any)=>x.cpuPercent).filter((x:any)=>typeof x==='number');return [name,{cpuPercentMean:groupCpus.length?round(groupCpus.reduce((a:number,b:number)=>a+b,0)/groupCpus.length,2):null,cpuPercentMax:groupCpus.length?Math.max(...groupCpus):null,rssBytesPeak:Math.max(0,...groupRows.map((x:any)=>x.rssBytes||0)),rssBytesLast:groupRows.at(-1)?.rssBytes||0,pids:[...new Set(groupRows.flatMap((x:any)=>x.pids||[]))]}];}));out[phase]={sampleCount:rows.length,performance:summarizeMetricDeltas(rows),chromeProcessCpuPercent:{mean:cpus.length?round(cpus.reduce((x,y)=>x+y,0)/cpus.length,2):null,max:cpus.length?Math.max(...cpus):null,unit:'aggregate process-tree CPU percent of one logical core'},chromeProcessTreeRssBytes:{peak:Math.max(0,...rss),last:rss.at(-1)||0},processGroups};}
    return out;
  }
  memorySummary(){const heaps=this.samples.map(s=>s.heap).filter((x):x is NonNullable<typeof x>=>!!x);const used=heaps.map(x=>x.usedJSHeapSize);return {sampleCount:this.samples.length,heapSamples:heaps.length,usedJSHeapSizeBytes:{peak:Math.max(0,...used),last:used.at(-1)||null},totalJSHeapSizeBytes:{last:heaps.at(-1)?.totalJSHeapSize||null},jsHeapSizeLimitBytes:{last:heaps.at(-1)?.jsHeapSizeLimit||null},chromeProcessTreeRssBytes:{peak:Math.max(0,...this.samples.map(s=>s.chrome?.rssBytes||0)),last:this.samples.at(-1)?.chrome?.rssBytes||null},samples:this.samples};}
}
export async function installPageInstrumentation(page:CdpSession){
  const source=`(()=>{window.__e2ePageErrors=[];window.__e2eSeenPageErrors=0;window.addEventListener('error',e=>window.__e2ePageErrors.push({kind:'error',message:e.message||String(e.error||'error'),filename:e.filename||'',lineno:e.lineno||0,at:Date.now()}),true);window.addEventListener('unhandledrejection',e=>window.__e2ePageErrors.push({kind:'unhandledrejection',message:String(e.reason?.stack||e.reason||'unhandled rejection'),at:Date.now()}));window.__e2eTouches=[];window.__e2eInputs=[];const inputRecord=e=>window.__e2eInputs.push({type:e.type,target:e.target?.closest?.('#sandboxEntryBtn')?.id||e.target?.id||e.target?.tagName||'',x:e.clientX??null,y:e.clientY??null,at:Date.now()});for(const n of ['pointerdown','pointerup','mousedown','mouseup','click'])document.addEventListener(n,inputRecord,true);const record=e=>{const target=e.target?.closest?.('[data-touch-action]')?.dataset?.touchAction||e.target?.id||e.target?.tagName||'';window.__e2eTouches.push({type:e.type,target,activeIds:Array.from(e.touches||[],t=>t.identifier),changedIds:Array.from(e.changedTouches||[],t=>t.identifier),at:Date.now()})};document.addEventListener('touchstart',record,true);document.addEventListener('touchmove',record,true);document.addEventListener('touchend',record,true);document.addEventListener('touchcancel',record,true)})()`;
  await page.send('Page.addScriptToEvaluateOnNewDocument',{source});
}
