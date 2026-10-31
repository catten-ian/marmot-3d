import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import type { ChildProcess } from 'node:child_process';
import { createStaticServer, rewritePublishedAssetUrl } from './server.ts';
import { startChrome, connectChrome, closeChrome, terminateChromeProcess, chromePidsForProfile, waitPortClosed, type ChromeRun } from './chrome.ts';
import { MetricsCollector, installPageInstrumentation } from './metrics.ts';
import { elementCenter, mouseClick, multiTouchMoveFrames, touchFrame, type RectCenter } from './input.ts';
import { summarizeFrames, allGatesPass } from './stats.ts';
import { finalizeRun } from './report.ts';
import { createProfileDir, ensureDir, freePort, iso, portListening, readChromeTree, safeRmProfile, sleep } from './util.ts';
import { resolveSettlePlan, shouldExitStage1Early, DEFAULT_LOAD_WAIT_MS, DEFAULT_MOVE_MS, DEFAULT_SETTLE_MS } from './plan.ts';
import type { Config, Device, Target } from './types.ts';

const ROOT=path.resolve(process.cwd());
function parseArgs():Config {
  const c:Config={target:'local',device:'desktop',loadWaitMs:DEFAULT_LOAD_WAIT_MS,settleMs:DEFAULT_SETTLE_MS,moveMs:DEFAULT_MOVE_MS,outputDir:path.join(ROOT,'outputs','m3d-20261030-dev-e2e-smoke'),globalTimeoutMs:20*60*1000,settleInMs:null,settleAfterMs:null};
  for(const arg of process.argv.slice(2)){
    const [k,v]=arg.split('=',2);
    if(k==='--target'&&(v==='official'||v==='local'))c.target=v as Target;
    else if(k==='--device'&&(v==='desktop'||v==='mobile'))c.device=v as Device;
    else if(k==='--load-wait-ms')c.loadWaitMs=Number(v);
    else if(k==='--settle-ms')c.settleMs=Number(v);
    else if(k==='--settle-in-ms')c.settleInMs=Number(v);
    else if(k==='--settle-after-ms')c.settleAfterMs=Number(v);
    else if(k==='--move-ms')c.moveMs=Number(v);
    else if(k==='--output')c.outputDir=path.resolve(v);
    else if(k==='--static-port')c.staticPort=Number(v);
    else if(k==='--cdp-port')c.cdpPort=Number(v);
    else if(k==='--timeout-ms')c.globalTimeoutMs=Number(v);
    else throw new Error(`Unknown argument: ${arg}`);
  }
  for(const key of ['loadWaitMs','settleMs','moveMs','globalTimeoutMs'] as const)if(!Number.isFinite(c[key])||c[key]<0)throw new Error(`Invalid timing: ${key}=${c[key]}`);
  // 提前校验等待调度，非法值立刻失败而不是跑到一半才报错。
  resolveSettlePlan({settleMs:c.settleMs,settleInMs:c.settleInMs,settleAfterMs:c.settleAfterMs});
  return c;
}
function initialGates(device:Device){
  const pending=(evidence:unknown=null)=>({pass:false,evidence});
  return {pageOpened:pending(),httpReachable:pending(),titleAndSandboxButton:pending(),enteredSandbox:pending(),lowTier:pending(),nonZeroFrameRate:pending(),noFatalPageErrors:pending(),screenshotCount:pending(),...(device==='mobile'?{mobileMultiTouch:pending()}:{}),cleanupChrome:pending(),cleanupPorts:pending(),cleanupTempProfile:pending()};
}
function makeReport(config:Config,runDir:string){
  const viewport=config.device==='desktop'?{width:1280,height:720,deviceScaleFactor:1,mobile:false,maxTouchPoints:0}:{width:390,height:844,deviceScaleFactor:3,mobile:true,maxTouchPoints:5};
  return {schemaVersion:1,task:'m3d-20261030-dev-e2e-smoke',target:config.target,device:config.device,runDir,startedAt:iso(),command:['node','tools/e2e-smoke/run.ts',...process.argv.slice(2)],viewport,requestedTimings:{loadWaitMs:config.loadWaitMs,settleMs:config.settleMs,moveMs:config.moveMs},timings:{},backend:{},tier:{},stages:[],cpu:{},memory:{},frameRate:{},console:{counts:{log:0,info:0,warn:0,error:0},events:[],fatalErrors:[],nonFatalEvents:[],handledResourceErrors:[]},network:{requests:[],responses:[],failures:[],blockedExternal:[],rewrittenAssetUrls:[]},screenshots:[],gates:initialGates(config.device),cleanup:{},errors:[] as string[]};
}
function safeText(v:any){const s=typeof v==='string'?v:JSON.stringify(v);return (s||'').slice(0,3000);}
function makeRecorder(report:any){
  const requestUrls=new Map<string,string>();
  return (message:any)=>{
    const at=iso();
    if(message.method==='Runtime.consoleAPICalled'){
      const t=message.params.type;const level=t==='warning'?'warn':t==='debug'?'log':t;
      const text=(message.params.args||[]).map((a:any)=>a.value??a.description??a.type).join(' ');
      report.console.counts[level]=(report.console.counts[level]||0)+1;report.console.events.push({ts:at,protocolTimestamp:message.params.timestamp,type:message.method,level,text});
      if(level==='error')report.console.fatalErrors.push({ts:at,kind:'console.error',text});
    }else if(message.method==='Runtime.exceptionThrown'){
      const d=message.params.exceptionDetails||{};const text=d.exception?.description||d.text||'uncaught exception';
      report.console.counts.error++;report.console.fatalErrors.push({ts:at,kind:'exceptionThrown',text});report.console.events.push({ts:at,type:message.method,level:'error',text});
    }else if(message.method==='Log.entryAdded'){
      const e=message.params.entry;const level=e.level==='warning'?'warn':e.level;
      const row={ts:at,type:message.method,level,text:e.text,url:e.url||'',source:e.source};report.console.counts[level]=(report.console.counts[level]||0)+1;report.console.events.push(row);
      if(level==='error'){
        if(e.source==='network'||String(e.url||'').includes('static.cloudflareinsights.com'))report.console.handledResourceErrors.push(row);
        else report.console.fatalErrors.push(row);
      }
    }else if(message.method==='Network.requestWillBeSent'){
      const p=message.params;requestUrls.set(p.requestId,p.request?.url||'');report.network.requests.push({ts:at,url:p.request?.url||'',method:p.request?.method,type:p.type});
    }else if(message.method==='Network.responseReceived'){
      const r=message.params.response;report.network.responses.push({ts:at,status:r.status,url:r.url,type:message.params.type,mimeType:r.mimeType});
    }else if(message.method==='Network.loadingFailed'){
      const p=message.params;report.network.failures.push({ts:at,url:requestUrls.get(p.requestId)||'',errorText:p.errorText,type:p.type,blockedReason:p.blockedReason||null});
    }
  };
}
async function collectPageErrors(run:ChromeRun,report:any){
  const errors=await run.page.evaluate<any[]>(`(()=>{const a=window.__e2ePageErrors||[];const i=window.__e2eSeenPageErrors||0;window.__e2eSeenPageErrors=a.length;return a.slice(i)})()`).catch(()=>[]);
  for(const e of errors){const text=String(e.message||'');const filename=String(e.filename||'');const ts=new Date(e.at||Date.now()).toISOString();const blockedDependency=filename.includes('static.cloudflareinsights.com')||(!filename&&text==='error'&&report.network.failures.some((f:any)=>String(f.url||'').includes('static.cloudflareinsights.com')&&Math.abs(Date.parse(f.ts)-Date.parse(ts))<5000));const row={ts,kind:e.kind,text,filename,lineno:e.lineno||0};if(blockedDependency)report.console.nonFatalEvents.push({...row,reason:'error correlated with intentionally blocked analytics dependency'});else report.console.fatalErrors.push(row);report.console.counts.error++;report.console.events.push({ts:row.ts,type:`page.${e.kind}`,level:'error',text,fatal:!blockedDependency,filename,lineno:row.lineno});}
}
async function capture(run:ChromeRun,report:any,runDir:string,node:string){
  try{const result=await run.page.send('Page.captureScreenshot',{format:'png',fromSurface:true,captureBeyondViewport:false},45000);const v=report.viewport;const file=`${report.device}__${node}__${v.width}x${v.height}.png`;fs.writeFileSync(path.join(runDir,'screenshots',file),Buffer.from(result.data,'base64'));report.screenshots.push({node,ts:iso(),file:path.join('screenshots',file),viewport:v});}
  catch(e){report.errors.push(`screenshot ${node}: ${String(e)}`);}
}
function stateExpression(){return `(()=>({href:location.href,title:document.title,button:!!document.querySelector('#sandboxEntryBtn.sandbox-entry'),sandbox:window.__game?.game?.sandbox===true,mode:window.__game?.game?.mode||null,loaderGone:!!document.querySelector('#loader.gone'),stage:String(window.__m3dBootStage||''),activeTier:window.__VERDANT_ACTIVE_TIER__||null,initialTier:window.__m3dInitialVerdantTier||null,requestedTier:window.__m3dRequestedVerdantTier||null,firstFrameAt:window.__m3dFirstFrameAt||null,mainStartedAt:window.__m3dMainStartedAt||null}))()`;}
function startSampling(run:ChromeRun,report:any,collector:MetricsCollector,drainEvents:()=>void,phase:()=>string,onProbe?:(state:any)=>Promise<void>|void){
  let busy=false;const tasks=new Set<Promise<void>>();
  const kick=()=>{
    if(busy)return;busy=true;let task!:Promise<void>;
    task=(async()=>{
      try{
        drainEvents();const chosen=phase();const state=await run.page.evaluate<any>(stateExpression()).catch(()=>null);
        const {pageState}=await collector.sample(chosen);
        if(pageState?.firstFrameAt&&!report.timings.firstFrameAt)report.timings.firstFrameAt=new Date(pageState.firstFrameAt).toISOString();
        if(pageState?.mainStartedAt&&!report.timings.mainStartedAt)report.timings.mainStartedAt=new Date(pageState.mainStartedAt).toISOString();
        if(state?.stage==='ready'&&!report.timings.bootReadyAt){report.timings.bootReadyAt=iso();report.timings.actualBootReadyDurationMs=Date.now()-Date.parse(report.timings.navigationStart);}
        if(state?.button&&!report.timings.titleButtonFirstDetected){report.timings.titleButtonFirstDetected=iso();report.timings.bootReadyAt=report.timings.titleButtonFirstDetected;report.timings.actualLoadDurationMs=Date.now()-Date.parse(report.timings.navigationStart);report.timings.actualBootReadyDurationMs=report.timings.actualLoadDurationMs;}
        await collectPageErrors(run,report);if(onProbe)await onProbe(state);
      }catch(e){report.errors.push(`sampling: ${String(e)}`);}finally{busy=false;tasks.delete(task);}
    })();tasks.add(task);
  };
  const timer=setInterval(kick,1000);kick();
  return {stop(){clearInterval(timer);},async drain(){while(tasks.size)await Promise.allSettled([...tasks]);}};
}
async function waitUntil(deadline:number,report:any){while(Date.now()<deadline){if(report.abortRequested)throw new Error(report.abortRequested);await sleep(Math.min(100,Math.max(1,deadline-Date.now())));}}
async function pageProbe(run:ChromeRun){return run.page.evaluate<any>(stateExpression()).catch(()=>null);}
async function readBackend(run:ChromeRun,collector:MetricsCollector){
  return run.page.evaluate<any>(`(()=>{let webgl=null;try{const gl=window.__game?.renderer?.getContext?.();const ext=gl?.getExtension?.('WEBGL_debug_renderer_info');if(ext)webgl={vendor:String(gl.getParameter(ext.UNMASKED_VENDOR_WEBGL)||''),renderer:String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)||''),api:'WebGL'}}catch{}const status=window.__game?.rendererStatus?.()||null;const name=String(status?.gpuName||webgl?.renderer||'');const software=/swiftshader|llvmpipe|software|lavapipe/i.test(name);return {backend:status?.backend||window.__resourceRendererBackend||'不可得',rendererStatus:status,webgl,webgpu:{available:!!navigator.gpu,selected:status?.backend==='webgpu'},rendererName:name||'不可得',classification:status?.hardwareAccelerationKnown?(status.hardwareAccelerated?'hardware':'software'):name?(software?'software':'reported renderer'): '不可得',gpuProcessPresent:${JSON.stringify(collector.gpuPids.size>0)},gpuUtilization:{value:null,reason:'不可得：CDP 与 /proc 不提供可靠的逐进程 GPU 利用率'}}})()`).catch(()=>({backend:'不可得',gpuProcessPresent:collector.gpuPids.size>0,gpuUtilization:{value:null,reason:'不可得'}}));
}
async function main(){
  const config=parseArgs();ensureDir(config.outputDir);
  const runDir=path.join(config.outputDir,`${new Date().toISOString().replace(/[:.]/g,'-')}-${config.target}-${config.device}`);ensureDir(path.join(runDir,'screenshots'));
  const report=makeReport(config,runDir);let server:any;let run:ChromeRun|undefined;let child:ChildProcess|undefined;let profile:string|undefined;let staticPort:number|undefined;let cdpPort:number|undefined;let collector:MetricsCollector|undefined;let record:(event:any)=>void=()=>{};let unsubscribe=()=>{};let unsubscribeFetch=()=>{};
  const shotTasks:Promise<void>[]=[];const samplerDrains:Array<()=>Promise<void>>=[];const childPids=new Set<number>();
  const timeout=setTimeout(()=>{report.abortRequested='overall timeout';if(child?.pid){try{process.kill(-child.pid,'SIGTERM');}catch{}}},config.globalTimeoutMs);
  const signalAbort=(signal:'SIGINT'|'SIGTERM')=>{report.abortRequested=signal;if(child?.pid){try{process.kill(-child.pid,'SIGTERM');}catch{}}};
  process.once('SIGINT',()=>signalAbort('SIGINT'));process.once('SIGTERM',()=>signalAbort('SIGTERM'));
  const captureLater=(node:string)=>{if(run)shotTasks.push(capture(run,report,runDir,node));};
  try{
    if(config.target==='local'){staticPort=await freePort(config.staticPort||18432);server=createStaticServer(ROOT,staticPort);report.localServer={host:'127.0.0.1',port:staticPort};}
    cdpPort=await freePort(config.cdpPort||18822);profile=createProfileDir();child=startChrome(cdpPort,profile);report.chrome={rootPid:child.pid,profile,version:'Google Chrome 147 (runtime checked via /json/version)'};
    run=await connectChrome(child,cdpPort,profile,config.device);report.chrome.version=run.version.Browser;report.viewport=run.viewport;
    const url=config.target==='official'?'https://www.catten.cyou/marmot3d/?version=dev&verdantTier=low':`http://127.0.0.1:${staticPort}/index-public.html?version=dev&verdantTier=low`;
    const allowedOrigins=new Set([new URL(url).origin,...(config.target==='official'?['https://marmot.tos-cn-shanghai.volces.com']:[])]);report.networkPolicy={allowedOrigins:[...allowedOrigins],mode:config.target==='local'?'CDP Fetch interception; published asset CDN URLs are rewritten to this run local static server, all other external HTTP(S) origins fail closed':'CDP Fetch interception; only target site and its configured static asset origin are allowed, all other HTTP(S) origins fail closed'};
    await run.page.send('Runtime.enable');await run.page.send('Log.enable');await run.page.send('Page.enable');await run.page.send('Performance.enable');await run.page.send('Network.enable');await run.page.send('Network.setCacheDisabled',{cacheDisabled:true});await run.page.send('Network.setBlockedURLs',{urls:['https://static.cloudflareinsights.com/*']});
    await installPageInstrumentation(run.page);
    const pending:any[]=[];unsubscribe=run.browser.listen((event)=>{if(!event.sessionId||event.sessionId===run!.sessionId)pending.push(event);});
    unsubscribeFetch=run.browser.listen((event)=>{
      if(event.method!=='Fetch.requestPaused'||event.sessionId!==run!.sessionId)return;
      const params=event.params||{};const requestUrl=String(params.request?.url||'');let allowed=false,continueParams:any={requestId:params.requestId};let rewrittenUrl:string|null=null;try{allowed=allowedOrigins.has(new URL(requestUrl).origin);}catch{}
      if(config.target==='local'&&staticPort!==undefined){
        rewrittenUrl=rewritePublishedAssetUrl(requestUrl,staticPort);
        if(rewrittenUrl){
          const assetPath=new URL(rewrittenUrl).pathname;const file=path.resolve(ROOT,`.${assetPath}`);const safe=file.startsWith(`${ROOT}${path.sep}`);
          let body=Buffer.alloc(0),status=404;try{if(safe&&fs.statSync(file).isFile()){body=fs.readFileSync(file);status=200;}}catch{}
          const ext=path.extname(file).toLowerCase();const mime=ext==='.json'?'application/json':ext==='.glb'?'model/gltf-binary':'application/octet-stream';
          const headers=[{name:'Access-Control-Allow-Origin',value:'*'},{name:'Access-Control-Allow-Methods',value:'GET, HEAD, OPTIONS'},{name:'Content-Type',value:status===200?mime:'text/plain; charset=utf-8'},{name:'Content-Length',value:String(body.length)}];
          report.network.rewrittenAssetUrls.push({ts:iso(),from:requestUrl,to:rewrittenUrl,localFile:safe?file:null,status,bytes:body.length,resourceType:params.resourceType||null});
          run!.browser.send('Fetch.fulfillRequest',{requestId:params.requestId,responseCode:status,responseHeaders:headers,body:body.toString('base64')},run!.sessionId,15000).catch((error)=>report.errors.push(`local asset fulfillment failed: ${String(error)}`));return;
        }
      }
      if(!allowed)report.network.blockedExternal.push({ts:iso(),url:requestUrl,resourceType:params.resourceType||null,origin:(()=>{try{return new URL(requestUrl).origin;}catch{return null;}})()});
      run!.browser.send(allowed?'Fetch.continueRequest':'Fetch.failRequest',allowed?continueParams:{requestId:params.requestId,errorReason:'BlockedByClient'},run!.sessionId,10000).catch((error)=>report.errors.push(`network policy response failed: ${String(error)}`));
    });
    await run.page.send('Fetch.enable',{patterns:[{urlPattern:'http://*/*',requestStage:'Request'},{urlPattern:'https://*/*',requestStage:'Request'}]});
    const drainEvents=()=>{while(pending.length)record(pending.shift());};record=makeRecorder(report);
    const navStart=Date.now();report.url=url;report.timings.navigationStart=new Date(navStart).toISOString();const navigation=await run.page.send('Page.navigate',{url});report.timings.navigationCommandResult=navigation;
    collector=new MetricsCollector(run.page,child.pid!,navStart);
    await sleep(250);captureLater('loading-in-progress');
    let latestTitle:any=null;
    const loadingSampler=startSampling(run,report,collector,drainEvents,()=> 'loading',(state)=>{if(state?.button)latestTitle=state;});samplerDrains.push(loadingSampler.drain);
    await waitUntil(navStart+config.loadWaitMs,report);loadingSampler.stop();
    const finalProbe=await pageProbe(run);drainEvents();
    const finalTitle=finalProbe?.button?await elementCenter(run.page,'#sandboxEntryBtn.sandbox-entry'):null;
    if(finalTitle){report.timings.titleButtonAtLoadDeadline=iso();report.timings.titleButtonCenter={...finalTitle};report.tier={requested:finalProbe.requestedTier,initial:finalProbe.initialTier,active:finalProbe.activeTier};}
    captureLater(finalTitle?(config.loadWaitMs===120000?'title-120s':`title-${config.loadWaitMs}ms`):'title-not-reached');
    report.gates.pageOpened={pass:finalProbe?.href===url,evidence:{href:finalProbe?.href,title:finalProbe?.title,expected:url,navigation}};
    const docResponses=report.network.responses.filter((r:any)=>r.type==='Document'&&r.url===url);
    report.gates.httpReachable={pass:docResponses.some((r:any)=>r.status>=200&&r.status<400),evidence:docResponses};
    report.gates.titleAndSandboxButton={pass:!!finalTitle,evidence:{atDeadline:!!finalTitle,firstDetectedAt:report.timings.titleButtonFirstDetected,center:finalTitle}};
    if(!finalTitle)throw new Error(`Title / #sandboxEntryBtn absent at ${config.loadWaitMs}ms deadline`);

    if(config.device==='desktop')await mouseClick(run.page,finalTitle.x,finalTitle.y);
    else {report.timings.buttonHitTest=await run.page.evaluate<any>(`(()=>{const e=document.elementFromPoint(${finalTitle.x},${finalTitle.y});return {tag:e?.tagName||null,id:e?.id||'',className:String(e?.className||''),sandboxButton:!!e?.closest?.('#sandboxEntryBtn')}})()`);const mobileScale=run.viewport.deviceScaleFactor;await run.page.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{id:11,x:finalTitle.x*mobileScale,y:finalTitle.y*mobileScale,radiusX:1,radiusY:1,force:1}]});await run.page.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await run.page.send('Input.dispatchMouseEvent',{type:'mousePressed',x:finalTitle.x*mobileScale,y:finalTitle.y*mobileScale,button:'left',clickCount:1});await run.page.send('Input.dispatchMouseEvent',{type:'mouseReleased',x:finalTitle.x*mobileScale,y:finalTitle.y*mobileScale,button:'left',clickCount:1});report.timings.buttonInputTrace=await run.page.evaluate<any[]>(`(window.__e2eInputs||[]).slice(-20)`);report.timings.buttonTouchTrace=await run.page.evaluate<any[]>(`(window.__e2eTouches||[]).slice(-20)`);}
    report.timings.sandboxButtonClick={xCss:finalTitle.x,yCss:finalTitle.y,xCdp:config.device==='mobile'?finalTitle.x*run.viewport.deviceScaleFactor:finalTitle.x,yCdp:config.device==='mobile'?finalTitle.y*run.viewport.deviceScaleFactor:finalTitle.y,device:config.device,at:iso(),input:config.device==='desktop'?'CDP mouse press/release':'CDP touch+mouse; scaled by deviceScaleFactor'};captureLater('sandbox-click');
    const settlePlan=resolveSettlePlan({settleMs:config.settleMs,settleInMs:config.settleInMs,settleAfterMs:config.settleAfterMs});
    const settleStart=Date.now();const settleDeadline=settleStart+settlePlan.stage1Ms;let loaderGoneObserved=false;let rafInstalled=false;
    const markReady=async(state:any)=>{
      if(loaderGoneObserved)return;
      if(!(state?.sandbox&&state?.mode==='play'&&state?.loaderGone))return;
      loaderGoneObserved=true;report.timings.loaderGoneFirstObserved=iso();
      if(!rafInstalled){rafInstalled=true;await run!.page.evaluate("window.__e2eRafPhase='idle'");captureLater('sandbox-enter');}
    };
    await run.page.evaluate(`(()=>{window.__e2eRafSamples={idle:[],movement:[]};window.__e2eRafLast=null;window.__e2eRafPhase='settle';window.__e2eRafRunning=true;const f=t=>{if(!window.__e2eRafRunning)return;if(window.__e2eRafLast!==null&&(window.__e2eRafPhase==='idle'||window.__e2eRafPhase==='movement'))window.__e2eRafSamples[window.__e2eRafPhase].push(t-window.__e2eRafLast);window.__e2eRafLast=t;requestAnimationFrame(f)};requestAnimationFrame(f)})()`);
    const settleSampler=startSampling(run,report,collector,drainEvents,()=>loaderGoneObserved?'sandbox-idle':'sandbox-settle',markReady);samplerDrains.push(settleSampler.drain);
    const settleShot5=setTimeout(()=>captureLater('sandbox-settle-5s'),5000);const settleShot10=setTimeout(()=>captureLater('sandbox-settle-10s'),10000);
    // 第一段：等待进入沙盒就绪（加载遮罩退场）。
    //   单段模式：跑满固定死线，与旧版行为一致。
    //   两段模式：就绪即退出，把剩余预算让给第二段。
    if(shouldExitStage1Early(settlePlan.mode)){
      while(Date.now()<settleDeadline){
        if(report.abortRequested)throw new Error(report.abortRequested);
        await markReady(await pageProbe(run));
        if(loaderGoneObserved)break;
        await sleep(200);
      }
    }else{
      await waitUntil(settleDeadline,report);
    }
    report.timings.settleStage1={mode:settlePlan.mode,budgetMs:settlePlan.stage1Ms,readyObserved:loaderGoneObserved,readyAt:report.timings.loaderGoneFirstObserved||null,exhausted:!loaderGoneObserved};
    // 第二段：就绪后继续静置，用于采集稳定的 idle 帧率。
    if(settlePlan.mode==='two-stage'){
      const stage2Start=Date.now();await waitUntil(stage2Start+settlePlan.stage2Ms,report);
      report.timings.settleStage2={budgetMs:settlePlan.stage2Ms,elapsedMs:Date.now()-stage2Start};
    }
    clearTimeout(settleShot5);clearTimeout(settleShot10);settleSampler.stop();const sandboxState=await pageProbe(run);drainEvents();
    report.timings.sandboxSettleDeadline=iso();report.timings.sandboxStateAtDeadline=sandboxState;report.tier={...report.tier,active:sandboxState?.activeTier||null,initial:sandboxState?.initialTier||null};
    report.gates.sandboxMode={pass:sandboxState?.sandbox===true&&sandboxState?.mode==='play',evidence:{sandbox:sandboxState?.sandbox,mode:sandboxState?.mode}};
    report.gates.enteredSandbox={pass:report.gates.sandboxMode.pass&&sandboxState?.loaderGone===true,evidence:sandboxState};
    const actualTier=sandboxState?.activeTier||sandboxState?.initialTier||sandboxState?.requestedTier||report.tier.active;
    report.gates.lowTier={pass:actualTier==='low',evidence:{actual:actualTier,active:sandboxState?.activeTier,initial:sandboxState?.initialTier,requested:sandboxState?.requestedTier}};
    if(!report.gates.enteredSandbox.pass){captureLater('sandbox-loading-at-deadline');throw new Error('Sandbox/loader was not ready at the fixed settle deadline');}
    captureLater('idle-end');
    const idleData=await run.page.evaluate<number[]>(`window.__e2eRafSamples?.idle||[]`);report.frameRate.idle=summarizeFrames(idleData);

    const frameKick=(phase:string)=>run!.page.evaluate(`window.__e2eRafPhase=${JSON.stringify(phase)};window.__e2eRafLast=null;window.__e2eRafRunning=true`);
    if(config.device==='desktop'){await mouseClick(run.page,run.viewport.width/2,run.viewport.height/2);report.timings.pointerLockAttempt={x:run.viewport.width/2,y:run.viewport.height/2,at:iso(),pointerLocked:await run.page.evaluate<boolean>('!!document.pointerLockElement').catch(()=>false)};captureLater('pointer-lock');}
    const movementStart=Date.now();const movementDeadline=movementStart+config.moveMs;const halfway=movementStart+config.moveMs/2;
    await frameKick('movement');let movementSampler=startSampling(run,report,collector,drainEvents,()=> 'movement');samplerDrains.push(movementSampler.drain);
    if(config.device==='desktop'){
      const down=run.page.send('Input.dispatchKeyEvent',{type:'rawKeyDown',code:'KeyW',key:'w',windowsVirtualKeyCode:87});report.timings.movementStart=new Date(movementStart).toISOString();report.timings.inputEvents=[{type:'rawKeyDown',code:'KeyW',at:report.timings.movementStart}];
      await waitUntil(halfway,report);
      const jumpAt=iso();const spaceDown=run.page.send('Input.dispatchKeyEvent',{type:'rawKeyDown',code:'Space',key:' ',windowsVirtualKeyCode:32});const spaceUp=run.page.send('Input.dispatchKeyEvent',{type:'keyUp',code:'Space',key:' ',windowsVirtualKeyCode:32});report.timings.jump={at:jumpAt,method:'CDP rawKeyDown/keyUp',code:'Space'};report.timings.inputEvents.push({type:'rawKeyDown',code:'Space',at:jumpAt},{type:'keyUp',code:'Space',at:iso()});captureLater('jump-5s');
      await waitUntil(movementDeadline,report);const keyUp=run.page.send('Input.dispatchKeyEvent',{type:'keyUp',code:'KeyW',key:'w',windowsVirtualKeyCode:87});report.timings.movementEnd=iso();report.timings.inputEvents.push({type:'keyUp',code:'KeyW',at:report.timings.movementEnd});await Promise.all([down,spaceDown,spaceUp,keyUp]);
    }else{
      const joystick=await elementCenter(run.page,'#touchJoystick');const jump=await elementCenter(run.page,'[data-touch-action="jump"]');const frames=multiTouchMoveFrames(joystick,jump,Math.max(50,joystick.height*.7));report.timings.touch={joystick,jump,coordinateSpace:'CSS pixels; CDP coordinates scaled by deviceScaleFactor',deviceScaleFactor:run.viewport.deviceScaleFactor,events:[],domEvents:[],multiTouchVerified:false};
      const startPoint=frames[0].points[0];const movePoint=frames[1].points[0];
      const scale=run.viewport.deviceScaleFactor;const cdpPoints=(points:any[])=>points.map((p)=>({...p,x:p.x*scale,y:p.y*scale}));const touchStart=run.page.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:cdpPoints([startPoint])});const touchMove=run.page.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:cdpPoints([movePoint])});report.timings.movementStart=iso();report.timings.touch.events.push({type:'touchStart',points:[startPoint],cdpTouchPoints:cdpPoints([startPoint]),at:report.timings.movementStart},{type:'touchMove',points:[movePoint],cdpTouchPoints:cdpPoints([movePoint]),at:iso()});
      await waitUntil(halfway,report);
      const jumpStart=frames[2].points;const jumpAt=iso();const multiStart=run.page.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:cdpPoints(jumpStart)});report.timings.jump={at:jumpAt,method:'CDP touchStart',coordinates:jump};report.timings.touch.events.push({type:'touchStart',points:jumpStart,cdpTouchPoints:cdpPoints(jumpStart),at:jumpAt});captureLater('jump-5s');
      await sleep(Math.min(120,Math.max(0,movementDeadline-Date.now())));const liftJump=run.page.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:cdpPoints(frames[3].points)});report.timings.touch.events.push({type:'touchEnd',liftedPoints:frames[3].points,cdpTouchPoints:cdpPoints(frames[3].points),remainingPoints:[startPoint],at:iso()});
      await waitUntil(movementDeadline,report);const liftJoystick=run.page.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});report.timings.movementEnd=iso();report.timings.touch.events.push({type:'touchEnd',liftedPoints:[startPoint],cdpTouchPoints:cdpPoints([startPoint]),remainingPoints:[],at:report.timings.movementEnd});await Promise.all([touchStart,touchMove,multiStart,liftJump,liftJoystick]);
      report.timings.touch.domEvents=await run.page.evaluate<any[]>(`(window.__e2eTouches||[]).slice(-30)`);
      const simultaneous=report.timings.touch.domEvents.find((e:any)=>e.type==='touchstart'&&String(e.target).includes('jump')&&e.activeIds.includes(1)&&e.activeIds.includes(2));
      const overlapEnd=report.timings.touch.domEvents.find((e:any)=>e.type==='touchend'&&String(e.target).includes('jump')&&e.activeIds.includes(1));report.timings.touch.multiTouchVerified=!!simultaneous&&!!overlapEnd;
      report.gates.mobileMultiTouch={pass:report.timings.touch.multiTouchVerified,evidence:{protocol:report.timings.touch.events,jumpStartWithTwoTouches:simultaneous||null,jumpEndWithJoystickHeld:overlapEnd||null}};
    }
    movementSampler.stop();await capture(run,report,runDir,'movement-end');
    const frames=await run.page.evaluate<any>(`(()=>{window.__e2eRafRunning=false;const s=window.__e2eRafSamples||{};return {idle:s.idle||[],movement:s.movement||[],visible:document.visibilityState,running:true}})()`).catch(()=>({idle:[],movement:[],visible:'unavailable',running:false}));
    report.frameRate.movement=summarizeFrames(frames.movement);report.frameRate.visibility=frames.visible;report.frameRate.rafInstalled=true;
    report.gates.nonZeroFrameRate={pass:frames.idle.length>0&&frames.movement.length>0,evidence:{idleSampleCount:frames.idle.length,movementSampleCount:frames.movement.length,visibility:frames.visible}};
    drainEvents();await collectPageErrors(run,report);report.gates.noFatalPageErrors={pass:report.console.fatalErrors.length===0,evidence:{fatalErrors:report.console.fatalErrors,handledResourceErrors:report.console.handledResourceErrors}};
    report.backend=await readBackend(run,collector);if(config.device==='desktop'&&report.timings.pointerLockAttempt)report.timings.pointerLockAttempt.pointerLockedAtEnd=await run.page.evaluate<boolean>('!!document.pointerLockElement').catch(()=>false);
    report.timings.finishedAt=iso();
  }catch(error:any){report.errors.push(error?.stack||String(error));report.timings.failedAt=iso();}
  finally{
    if(run){try{drainEvents();await collectPageErrors(run,report);}catch{}}
    report.gates.noFatalPageErrors={pass:report.console.fatalErrors.length===0,evidence:{fatalErrors:report.console.fatalErrors,nonFatalEvents:report.console.nonFatalEvents,handledResourceErrors:report.console.handledResourceErrors}};
    clearTimeout(timeout);unsubscribe();unsubscribeFetch();
    try{await Promise.allSettled(samplerDrains.map((drain)=>drain()));for(const promise of shotTasks)await promise;}catch{}
    if(collector){report.stages=collector.stages;report.cpu=collector.phaseSummary();report.memory={summary:collector.memorySummary(),samples:collector.samples};if(run&&!report.backend.backend)report.backend=await readBackend(run,collector).catch(()=>({unavailable:'不可得'}));}
    if(run){for(const p of readChromeTree(run.child.pid!).pids)childPids.add(p);report.cleanup.chrome=await closeChrome(run,childPids);}
    else report.cleanup.chrome=await terminateChromeProcess(child);
    unsubscribe();unsubscribeFetch();if(server){try{server.closeAllConnections?.();}catch{}await new Promise<void>((resolve)=>server.close(()=>resolve()));report.cleanup.staticServerClosed=true;}else report.cleanup.staticServerClosed=true;
    if(staticPort!==undefined)report.cleanup.staticPortClosed=!(await portListening(staticPort));if(cdpPort!==undefined)report.cleanup.cdpPortClosed=await waitPortClosed(cdpPort);
    report.cleanup.chromePids=[...childPids].sort((a,b)=>a-b);report.cleanup.chromePidsRemaining=profile?chromePidsForProfile(profile):[];
    report.cleanup.tempProfile=profile?{path:profile,removed:safeRmProfile(profile)}:{path:null,removed:true};
    report.gates.screenshotCount={pass:report.screenshots.length>=5&&report.screenshots.length<=10,evidence:{count:report.screenshots.length,minimum:5,maximum:10,files:report.screenshots.map((x:any)=>x.file)}};
    report.gates.cleanupChrome={pass:report.cleanup.chrome.terminated===true&&report.cleanup.chromePidsRemaining.length===0,evidence:report.cleanup.chrome};
    report.gates.cleanupPorts={pass:report.cleanup.staticPortClosed!==false&&report.cleanup.cdpPortClosed!==false,evidence:{staticPort,staticPortClosed:report.cleanup.staticPortClosed,cdpPort,cdpPortClosed:report.cleanup.cdpPortClosed,staticServerClosed:report.cleanup.staticServerClosed}};
    report.gates.cleanupTempProfile={pass:report.cleanup.tempProfile.removed===true,evidence:report.cleanup.tempProfile};
    for(const [name,gate] of Object.entries(report.gates) as Array<[string,any]>)if(!gate||typeof gate.pass!=='boolean')report.gates[name]={pass:false,evidence:'not completed'};
    report.endedAt=iso();finalizeRun(runDir,report);console.log(JSON.stringify({runDir,pass:report.pass,gates:report.gates,error:report.errors.at(-1)||null},null,2));process.exitCode=report.pass?0:1;
  }
}
main().catch((error)=>{console.error(error);process.exitCode=1;});
