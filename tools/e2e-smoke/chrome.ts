import fs from 'node:fs';
import { spawn, type ChildProcess } from 'node:child_process';
import { CdpConnection, CdpSession } from './cdp.ts';
import type { Device } from './types.ts';
import { sleep, portListening, readChromeTree } from './util.ts';
export interface ChromeRun {
  child: ChildProcess; browser: CdpConnection; page: CdpSession; targetId: string; sessionId: string;
  port: number; profile: string; version: any;
  viewport: {width:number;height:number;deviceScaleFactor:number;mobile:boolean;maxTouchPoints:number};
}
export function startChrome(port:number,profile:string):ChildProcess {
  const args=[
    `--remote-debugging-port=${port}`,`--user-data-dir=${profile}`,
    '--no-first-run','--no-default-browser-check','--no-sandbox','--disable-dev-shm-usage',
    '--no-proxy-server','--proxy-bypass-list=*','--enable-precise-memory-info',
    '--disable-background-networking','--disable-component-update','--disable-sync','--metrics-recording-only','--disable-default-apps','--disable-extensions',
    '--disable-breakpad','--disable-crash-reporter','--disable-background-timer-throttling','--disable-backgrounding-occluded-windows','--disable-renderer-backgrounding',
    '--use-gl=angle','--use-angle=gl','--enable-gpu','--disable-gpu-sandbox','--window-size=1280,720','about:blank',
  ];
  const env:Record<string,string>={PATH:process.env.PATH||'/usr/bin:/bin',HOME:process.env.HOME||'/tmp',LANG:process.env.LANG||'C.UTF-8'};for(const key of ['DISPLAY','XAUTHORITY','XDG_RUNTIME_DIR'])if(process.env[key])env[key]=process.env[key]!;
  const child=spawn('/usr/bin/google-chrome',args,{stdio:'ignore',env,detached:true});
  if(!child.pid)throw new Error('Chrome did not start');
  return child;
}
export async function connectChrome(child:ChildProcess,port:number,profile:string,device:Device):Promise<ChromeRun>{
  const viewport=device==='desktop'?{width:1280,height:720,deviceScaleFactor:1,mobile:false,maxTouchPoints:0}:{width:390,height:844,deviceScaleFactor:3,mobile:true,maxTouchPoints:5};
  let version:any=null;
  const deadline=Date.now()+30000;
  while(Date.now()<deadline){try{const response=await fetch(`http://127.0.0.1:${port}/json/version`);if(response.ok){version=await response.json();break;}}catch{}await sleep(250);}
  if(!version)throw new Error('Timed out waiting for isolated Chrome DevTools port');
  const browser=await CdpConnection.connect(version.webSocketDebuggerUrl);
  const created=await browser.send('Target.createTarget',{url:'about:blank'});
  const targetId=created.targetId as string;
  const attached=await browser.send('Target.attachToTarget',{targetId,flatten:true});
  const sessionId=attached.sessionId as string;
  const page=new CdpSession(browser,sessionId);
  await page.send('Emulation.setDeviceMetricsOverride',{width:viewport.width,height:viewport.height,deviceScaleFactor:viewport.deviceScaleFactor,mobile:viewport.mobile,screenWidth:viewport.width,screenHeight:viewport.height});
  if(device==='mobile')await page.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:5});
  await page.send('Page.bringToFront');
  return {child,browser,page,targetId,sessionId,port,profile,version,viewport};
}
export async function terminateChromeProcess(child:ChildProcess|undefined){
  if(!child?.pid)return {terminated:true,remainingPids:[] as number[]};
  try{process.kill(-child.pid,'SIGTERM');}catch{}
  const until=Date.now()+4000;
  while(Date.now()<until){if(child.exitCode!==null||child.signalCode!==null)break;await sleep(100);}
  try{process.kill(-child.pid,'SIGKILL');}catch{}
  await sleep(200);
  const remains=chromePidsForProfile((child.spawnargs||[]).find((x)=>x.startsWith('--user-data-dir='))?.slice('--user-data-dir='.length)||'');
  return {terminated:remains.length===0,remainingPids:remains};
}
export function chromePidsForProfile(profile:string){
  if(!profile)return [];
  const found:number[]=[];
  let pids:string[]=[];try{pids=fs.readdirSync('/proc').filter((p)=>/^\d+$/.test(p));}catch{return found;}
  for(const pid of pids){try{const cmd=fs.readFileSync(`/proc/${pid}/cmdline`,'utf8');if(cmd.includes('--user-data-dir='+profile)&&cmd.includes('/chrome'))found.push(Number(pid));}catch{}}
  return found;
}
export async function closeChrome(run:ChromeRun|undefined, childPids:Set<number>){
  if(!run)return {browserCloseSent:false,targetCloseSent:false,terminated:false,childPids:[...childPids],remainingPids:[] as number[]};
  const before=readChromeTree(run.child.pid!);for(const pid of before.pids)childPids.add(pid);
  let targetCloseSent=false,browserCloseSent=false;
  try{await run.browser.send('Target.closeTarget',{targetId:run.targetId},undefined,3000);targetCloseSent=true;}catch{}
  try{await run.browser.send('Browser.close',{},undefined,3000);browserCloseSent=true;}catch{}
  const term=await terminateChromeProcess(run.child);
  run.browser.close();
  return {browserCloseSent,targetCloseSent,terminated:term.terminated,childPids:[...childPids].sort((a,b)=>a-b),remainingPids:term.remainingPids};
}
export function chromeProfileExists(profile:string){return fs.existsSync(profile);}
export async function waitPortClosed(port:number,timeoutMs=5000){const until=Date.now()+timeoutMs;while(Date.now()<until){if(!(await portListening(port)))return true;await sleep(100);}return !(await portListening(port));}
