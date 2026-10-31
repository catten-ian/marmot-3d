import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawn } from 'node:child_process';
import { describeSchedule, DEFAULT_LOAD_WAIT_MS, DEFAULT_MOVE_MS, DEFAULT_SETTLE_MS } from './plan.ts';

const ROOT=path.resolve(process.cwd());
const OUTPUT=path.join(ROOT,'outputs','m3d-20261030-dev-e2e-smoke');
const RUNNER=path.join(ROOT,'tools','e2e-smoke','run.ts');
const DEFAULTS=['--load-wait-ms=120000','--settle-ms=15000','--move-ms=10000'];
const CASES=[['local','desktop'],['local','mobile'],['official','desktop'],['official','mobile']] as const;
type RunResult={target:string;device:string;command:string[];exitCode:number|null;startedAt:string;endedAt:string;runDir:string|null;pass:boolean|null;gates:Record<string,any>;metrics:Record<string,any>;error?:string};
function dirs(){try{return new Set(fs.readdirSync(OUTPUT,{withFileTypes:true}).filter(x=>x.isDirectory()).map(x=>x.name));}catch{return new Set<string>();}}
function summarize(report:any){
  const groups=report.cpu||{};const fullTimings=report.timings||{};
  const timings={navigationStart:fullTimings.navigationStart,titleButtonFirstDetected:fullTimings.titleButtonFirstDetected,bootReadyAt:fullTimings.bootReadyAt,firstFrameAt:fullTimings.firstFrameAt,actualLoadDurationMs:fullTimings.actualLoadDurationMs,actualBootReadyDurationMs:fullTimings.actualBootReadyDurationMs,sandboxButtonClick:fullTimings.sandboxButtonClick,sandboxStateAtDeadline:fullTimings.sandboxStateAtDeadline,movementStart:fullTimings.movementStart,jump:fullTimings.jump,movementEnd:fullTimings.movementEnd,requestedTimings:report.requestedTimings};
  const memory=report.memory?.summary?{...report.memory.summary}:null;if(memory)delete memory.samples;
  const frame=(x:any)=>x?{sampleCount:x.sampleCount,meanDtMs:x.meanDtMs,p50DtMs:x.p50DtMs,p95DtMs:x.p95DtMs,p99DtMs:x.p99DtMs,maxDtMs:x.maxDtMs,over50ms:x.over50ms,averageFps:x.averageFps}:null;
  return {timings,backend:report.backend,tier:report.tier,networkPolicy:report.networkPolicy,stages:report.stages,
    cpu:Object.fromEntries(Object.entries(groups).map(([phase,row]:any)=>[phase,{processTreeCpuPercent:row.chromeProcessCpuPercent,processTreeRss:row.chromeProcessTreeRssBytes,processGroups:row.processGroups,performance:row.performance}])),
    memory,frameRate:{idle:frame(report.frameRate?.idle),movement:frame(report.frameRate?.movement),visibility:report.frameRate?.visibility},
    console:report.console?{counts:report.console.counts,fatalErrors:report.console.fatalErrors,nonFatalEvents:report.console.nonFatalEvents}:null,
    screenshots:report.screenshots,cleanup:report.cleanup,errors:report.errors};
}
function runChild(args:string[],target:string,device:string):Promise<{code:number|null;signal:string|null;error?:string}>{
  return new Promise(resolve=>{
    const child=spawn(process.execPath,[RUNNER,...args,`--target=${target}`,`--device=${device}`],{cwd:ROOT,stdio:'inherit',env:process.env});
    const forward=(signal:'SIGINT'|'SIGTERM')=>{try{child.kill(signal);}catch{}};
    const onInt=()=>forward('SIGINT'),onTerm=()=>forward('SIGTERM');
    process.on('SIGINT',onInt);process.on('SIGTERM',onTerm);
    let error:string|undefined;
    child.once('error',e=>{error=String(e)});
    child.once('close',(code,signal)=>{process.off('SIGINT',onInt);process.off('SIGTERM',onTerm);resolve({code,signal,error});});
  });
}
function writeSuite(runs:RunResult[],suiteArgs:string[],effectiveArgs:string[]){
  const endedAt=new Date().toISOString();
  const schedule=describeSchedule(effectiveArgs);
  const suite={schemaVersion:1,task:'m3d-20261030-dev-e2e-smoke-suite',startedAt:runs[0]?.startedAt||endedAt,endedAt,
    command:['node','tools/e2e-smoke/suite.ts',...suiteArgs],defaultTimingsMs:{loadWaitMs:schedule.loadWaitMs,settleMs:schedule.settleMs,settleInMs:schedule.settleInMs,settleAfterMs:schedule.settleAfterMs,moveMs:schedule.moveMs},settleMode:schedule.mode,settleStage1Ms:schedule.stage1Ms,settleStage2Ms:schedule.stage2Ms,pass:runs.length===CASES.length&&runs.every(x=>x.exitCode===0&&x.pass===true),runs};
  const jsonPath=path.join(OUTPUT,'suite-result.json'),mdPath=path.join(OUTPUT,'m3d-20261030-dev-e2e-smoke-report.md');
  fs.mkdirSync(OUTPUT,{recursive:true});fs.writeFileSync(jsonPath,JSON.stringify(suite,null,2));
  const scheduleLine=schedule.mode==='two-stage'
    ?`- Wait schedule: **two-stage** — stage1 (ready) ${schedule.stage1Ms}ms + stage2 (post-ready settle) ${schedule.stage2Ms}ms`
    :`- Wait schedule: single-stage — settle ${schedule.stage1Ms}ms (fixed deadline)`;
  const lines=['# m3d dev CDP E2E smoke', '',`- Suite: **${suite.pass?'PASS':'FAIL'}**`,`- Start / end: ${suite.startedAt} / ${suite.endedAt}`,scheduleLine,`- Load wait: ${schedule.loadWaitMs}ms; movement: ${schedule.moveMs}ms`,`- Invocation: \`${suite.command.join(' ')}\``, '', '## Run summary', '', '| Target | Device | Exit | Result | Frame mean FPS (idle / move) | Renderer | Screenshots | Run artifact |','|---|---|---:|---|---:|---|---:|---|'];
  for(const r of runs){const m=r.metrics;const fps=`${m.frameRate?.idle?.averageFps??'n/a'} / ${m.frameRate?.movement?.averageFps??'n/a'}`;lines.push(`| ${r.target} | ${r.device} | ${r.exitCode??'signal'} | ${r.pass===null?'NO REPORT':r.pass?'PASS':'FAIL'} | ${fps} | ${m.backend?.rendererName||m.backend?.classification||'不可得'} | ${m.screenshots?.length||0} | \`${r.runDir||'不可得'}\` |`);}
  lines.push('','## Gate details','');
  for(const r of runs){lines.push(`### ${r.target} / ${r.device}`,`- Command: \`${r.command.join(' ')}\``,`- Exit code: ${r.exitCode}; pass: ${r.pass}`,`- Gates: \`${JSON.stringify(r.gates)}\``,`- Requested timings: \`${JSON.stringify(r.metrics.timings?.requestedTimings||{})}\``,`- Load / ready: ${r.metrics.timings?.actualLoadDurationMs??'不可得'}ms / ${r.metrics.timings?.actualBootReadyDurationMs??'不可得'}ms`,`- Active tier: ${r.metrics.tier?.active??'不可得'}`,`- Renderer/backend: \`${JSON.stringify(r.metrics.backend||{})}\``,`- GPU utilization: explicitly unavailable in CDP/proc sampling; no utilization percentage is inferred.`,`- Frame summary: idle \`${JSON.stringify(r.metrics.frameRate?.idle||{})}\`; movement \`${JSON.stringify(r.metrics.frameRate?.movement||{})}\``,`- CPU phase summaries: \`${JSON.stringify(r.metrics.cpu||{})}\``,`- JS heap / process RSS: \`${JSON.stringify(r.metrics.memory||{})}\``,`- Console counters/fatal errors: \`${JSON.stringify(r.metrics.console||{})}\``,`- Screenshots (${r.metrics.screenshots?.length||0}): ${JSON.stringify(r.metrics.screenshots||[])}`,`- Cleanup: \`${JSON.stringify(r.metrics.cleanup||{})}\``);if(r.error)lines.push(`- Runner error: ${r.error}`);lines.push('');}
  lines.push('## Usage and implementation','', 'Run the full matrix with `node tools/e2e-smoke/suite.ts`. It sequentially executes local desktop/mobile and official desktop/mobile with the fixed default timings, continues after failures, and writes `suite-result.json` plus this Markdown report. For individual iteration, run `node tools/e2e-smoke/run.ts --target=local --device=desktop` and use `--load-wait-ms`, `--settle-ms`, or `--move-ms` only to shorten/adjust an exploratory run.', '', 'The runner uses only Node.js built-ins and raw CDP; there are no npm dependencies, package installation, AI/LLM calls, or API-key reads. Local mode serves this checkout only on `127.0.0.1`, with the local static server and a fail-closed request policy. Official mode visits the dev URL, allows only the site and its required published asset origin, blocks unrelated origins, and launches Chrome with proxy variables removed. It uses isolated Chrome profiles and a non-shared debugging port.', '', '## Performance interpretation','', 'CPU is `/proc` process-tree CPU as percent of one logical core, plus CDP Performance metric deltas; heap uses `performance.memory`. RAF timing is the measured injected `requestAnimationFrame` callback interval: mobile-emulated and idle phases may be throttled, so inspect raw dt arrays and visibility. GPU utilization is unavailable; renderer vendor/name and GPU process presence are reported separately. Mobile device emulation, Linux Mesa driver naming, and page-side throttling may differ from a physical device.', '', '## Artifacts and cleanup','', 'Each run directory contains `run-result.json`, `report.md`, and `screenshots/manifest.json` with PNG captures. Cleanup evidence records Browser/Target close, Chrome process-tree termination, profile removal, and listener closure.', '', '## Repository status','', 'Expected base: `54a708ec91514bdf7fd9299b85bc47bcc69d669a` (`integ/dev-20261030`); branch: `feat/dev-e2e-smoke-20261030`. This task does not change game/product files. No commit, push, or deployment is performed by the suite.', '', `Suite machine report: \`${path.relative(ROOT,jsonPath)}\``);
  fs.writeFileSync(mdPath,lines.join('\n')+'\n');
  return suite;
}
async function main(){
  fs.mkdirSync(OUTPUT,{recursive:true});const suiteArgs=process.argv.slice(2);const forwarded=suiteArgs.length?suiteArgs:DEFAULTS;const runs:RunResult[]=[];
  for(const [target,device] of CASES){
    const startedAt=new Date().toISOString(),before=dirs(),command=['node','tools/e2e-smoke/run.ts',...forwarded,`--target=${target}`,`--device=${device}`];
    console.log(`\n=== ${target}/${device}: ${command.join(' ')} ===`);
    const outcome=await runChild(forwarded,target,device);const endedAt=new Date().toISOString();
    const found=[...dirs()].filter(name=>!before.has(name)).map(name=>path.join(OUTPUT,name,'run-result.json')).filter(p=>fs.existsSync(p));
    found.sort((a,b)=>fs.statSync(b).mtimeMs-fs.statSync(a).mtimeMs);const file=found[0]||null;let report:any=null;try{if(file)report=JSON.parse(fs.readFileSync(file,'utf8'));}catch{}
    runs.push({target,device,command,exitCode:outcome.code,startedAt,endedAt,runDir:report?.runDir||null,pass:typeof report?.pass==='boolean'?report.pass:null,gates:report?.gates||{},metrics:report?summarize(report):{},...(outcome.error?{error:outcome.error}:outcome.signal?{error:`terminated by ${outcome.signal}`}:{})});
  }
  const suite=writeSuite(runs,suiteArgs,forwarded);console.log(`\nSuite ${suite.pass?'PASS':'FAIL'}; report: ${path.join(OUTPUT,'m3d-20261030-dev-e2e-smoke-report.md')}`);process.exitCode=suite.pass?0:1;
}
main().catch(e=>{console.error(e);process.exitCode=1;});
