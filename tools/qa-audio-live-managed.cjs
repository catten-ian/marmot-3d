// Real-MP3 live QA for the beta audio system. Opens/closes only its own tab
// on the managed Chrome at 127.0.0.1:18800; in-process static server.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const ROOT = path.resolve(process.cwd());
const OUT = path.join(ROOT, 'outputs/audio-live-qa');
fs.mkdirSync(OUT, { recursive: true });
const PORT = 8413;
const getJson = (url) => new Promise((resolve, reject) => {
  http.get(url, (res) => { let d=''; res.on('data',c=>d+=c); res.on('end',()=>{try{resolve(JSON.parse(d));}catch(e){reject(e);}}); }).on('error', reject);
});
const sleep = ms => new Promise(r => setTimeout(r, ms));
const TYPES = { '.html':'text/html', '.js':'text/javascript', '.mjs':'text/javascript', '.json':'application/json', '.mp3':'audio/mpeg', '.css':'text/css' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/qa-audio-live.html';
  const fp = path.join(ROOT, p);
  if (!fp.startsWith(ROOT)) { res.writeHead(403); return res.end('no'); }
  fs.readFile(fp, (err, buf) => {
    if (err) { res.writeHead(404); return res.end('nf'); }
    res.writeHead(200, { 'content-type': TYPES[path.extname(fp)] || 'application/octet-stream', 'cache-control': 'no-store', 'access-control-allow-origin': '*' });
    res.end(buf);
  });
});
class CDP {
  constructor(url){ this.url=url; this.seq=0; this.pending=new Map(); this.events=[]; }
  async connect(){ this.ws=new WebSocket(this.url); this.ws.addEventListener('message',e=>{const m=JSON.parse(e.data); if(m.id&&this.pending.has(m.id)){const p=this.pending.get(m.id);this.pending.delete(m.id);m.error?p.reject(new Error(JSON.stringify(m.error))):p.resolve(m.result);}else if(m.method)this.events.push(m);}); await new Promise((res,rej)=>{this.ws.addEventListener('open',res,{once:true});this.ws.addEventListener('error',rej,{once:true});}); }
  send(method,params={}){ return new Promise((resolve,reject)=>{const id=++this.seq;this.pending.set(id,{resolve,reject});this.ws.send(JSON.stringify({id,method,params}));setTimeout(()=>{if(this.pending.has(id)){this.pending.delete(id);reject(new Error('CDP timeout '+method));}},60000);}); }
  async eval(expr){ const r=await this.send('Runtime.evaluate',{expression:expr,returnByValue:true,awaitPromise:true}); if(r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0,500)); return r.result?.value; }
  close(){ try{this.ws?.close();}catch(_){} }
}
async function main(){
  await new Promise((res,rej)=>{ server.once('error',rej); server.listen(PORT,'127.0.0.1',res); });
  const base = `http://127.0.0.1:${PORT}/qa-audio-live.html`;
  const version = await getJson('http://127.0.0.1:18800/json/version');
  const browser = new CDP(version.webSocketDebuggerUrl); await browser.connect();
  const created = await browser.send('Target.createTarget',{url:'about:blank',background:false});
  const targetId = created.targetId;
  let pageInfo;
  for(let i=0;i<60;i++){ const list=await getJson('http://127.0.0.1:18800/json/list'); pageInfo=list.find(x=>x.id===targetId&&x.type==='page'); if(pageInfo)break; await sleep(250); }
  const page=new CDP(pageInfo.webSocketDebuggerUrl); await page.connect();
  const errors=[];
  await page.send('Runtime.enable'); await page.send('Page.enable'); await page.send('Log.enable');
  page.events=[];
  await page.send('Emulation.setFocusEmulationEnabled',{enabled:true});
  await page.send('Network.setCacheDisabled',{cacheDisabled:true});
  await page.send('Page.navigate',{url:base});
  let ready=false;
  for(let i=0;i<60;i++){ await sleep(500); try{ ready=await page.eval('!!(window.__qa&&window.__qa.ready&&window.__audio)'); }catch(_){} if(ready)break; }
  if(!ready) throw new Error('audio qa page not ready: ' + await page.eval('JSON.stringify(window.__qa||null)').catch(()=>'noqa'));
  // user gesture: click to unlock AudioContext in headless
  await page.send('Input.dispatchMouseEvent',{type:'mousePressed',x:200,y:200,button:'left',clickCount:1});
  await page.send('Input.dispatchMouseEvent',{type:'mouseReleased',x:200,y:200,button:'left',clickCount:1});
  await sleep(300);
  await page.eval(`(async()=>{ try{ await window.__audio.ctx.resume(); }catch(e){} return window.__audio.ctx.state; })()`);
  await sleep(200);

  // 1) ctx running
  const ctxState = await page.eval('window.__audio.ctx.state');

  // 2) manifest + real decode of every SFX (loadBuffer directly), count valid durations
  const sfxResult = await page.eval(`(async () => {
    const a = window.__audio;
    const man = await a._readManifest('sfx');
    const names = Object.keys(window.__SFX_ASSETS);
    const detail = {}; let ok=0, bad=[];
    for (const n of names) {
      const buf = await a._loadBuffer(window.__SFX_ASSETS[n], a._sfxCache);
      if (buf && buf.duration>0.05) { ok++; detail[n]=Math.round(buf.duration*1000)/1000; } else bad.push(n);
    }
    return { manifestAssets: Object.keys(man?.assets||{}).length, names: names.length, ok, bad, sample: {swing:detail.swing,hit:detail.hit,win:detail.win} };
  })()`);

  // 3) actual SFX dispatch plays a FILE (instrument via bus node count is hard; verify
  //    the sfx cache buffer gets created and a BufferSource starts — check via Analyser signal)
  const sfxPlay = await page.eval(`(async () => {
    const a=window.__audio; const ctx=a.ctx;
    // attach analyser to sfx bus
    const an=ctx.createAnalyser(); an.fftSize=256; a.buses.sfx.connect(an);
    const buf=await a._loadBuffer(window.__SFX_ASSETS.hit, a._sfxCache);
    const started=a._playBuffer(buf,a.buses.sfx,{volume:1});
    await new Promise(r=>setTimeout(r,120));
    const d=new Uint8Array(an.fftSize); an.getByteTimeDomainData(d);
    let peak=0; for(const v of d) peak=Math.max(peak,Math.abs(v-128));
    return { started, peak };
  })()`);

  // 4) BGM: request explore -> current slot + loop=true + buffer ~180s; crossfade to combat
  const bgmResult = await page.eval(`(async () => {
    const a=window.__audio; const m=a._bgmManager;
    a.updateBgmState({mode:'play',stress:0,threats:0});
    for(let i=0;i<100;i++){ if(m.current) break; await new Promise(r=>setTimeout(r,100)); }
    const first = m.current ? { slot:m.current.slot, loop:m.current.source.loop, dur:Math.round(m.current.source.buffer.duration) } : null;
    a.updateBgmState({mode:'play',stress:90,threats:3,combat:true});
    await new Promise(r=>setTimeout(r,3200)); // > 2.5s crossfade
    const second = m.current ? { slot:m.current.slot, loop:m.current.source.loop } : null;
    // bgm bus analyser signal
    const an=a.ctx.createAnalyser(); an.fftSize=256; a.buses.bgm.connect(an);
    await new Promise(r=>setTimeout(r,250));
    const d=new Uint8Array(an.fftSize); an.getByteTimeDomainData(d); let peak=0; for(const v of d)peak=Math.max(peak,Math.abs(v-128));
    return { first, second, bgmPeak:peak, slots:window.__BGM_SLOTS };
  })()`);

  // 5) settings persistence + buses
  const settingsResult = await page.eval(`(() => {
    const a=window.__audio;
    a.setSettings({masterVolume:55,sfxVolume:70,bgmVolume:25});
    const levels=a.getBusLevels();
    const saved=JSON.parse(localStorage.getItem('marmot3d.audio.beta.v1')||'null');
    return { levels, saved, persisted: saved && saved.masterVolume===55 };
  })()`);

  const consoleEvents = page.events.filter(e=>e.method==='Runtime.exceptionThrown' || (e.method==='Runtime.consoleAPICalled'&&e.params.type==='error') || (e.method==='Log.entryAdded'&&e.params.entry?.level==='error'));
  for(const ev of consoleEvents){ const t=ev.params; const msg=t.exceptionDetails?.text || t.exceptionDetails?.exception?.description || (t.entry&&t.entry.text) || (Array.isArray(t.args)?t.args.map(x=>x.value||x.description).join(' '):''); if(msg) errors.push(String(msg).slice(0,300)); }

  const report = { base, ctxState, sfxResult, sfxPlay, bgmResult, settingsResult, consoleErrors: errors,
    pass: ctxState==='running' && sfxResult.ok===sfxResult.names && sfxResult.bad.length===0 && sfxPlay.started===true && sfxPlay.peak>0
      && bgmResult.first && bgmResult.first.loop===true && bgmResult.second && bgmResult.second.slot==='combat' && bgmResult.bgmPeak>0
      && settingsResult.persisted && errors.length===0 };
  fs.writeFileSync(path.join(OUT,'audio-live-report.json'), JSON.stringify(report,null,2));
  const shot = await page.send('Page.captureScreenshot',{format:'png'});
  fs.writeFileSync(path.join(OUT,'audio-live.png'), Buffer.from(shot.data,'base64'));
  console.log(JSON.stringify(report,null,2));
  page.close(); await browser.send('Target.closeTarget',{targetId}); browser.close(); server.close();
  if(!report.pass) process.exitCode=1;
}
main().catch(e=>{ console.error(e.stack||e); process.exitCode=1; });
