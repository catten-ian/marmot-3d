/** 复现 smoke.cjs 的操作序列，逐个隐藏对象找出白线真凶 */
const { spawn } = require('child_process');
const http = require('http'); const os = require('os'); const path = require('path'); const fs = require('fs');
const zlib = require('zlib');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9340;
const get = (u) => new Promise((res, rej) => http.get(u, (r) => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(d)); }).on('error', rej));

function decodePNG(buf) {
  let pos = 8, width = 0, height = 0, colorType = 0, bitDepth = 0;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.slice(pos + 8, pos + 8 + len);
    if (type === 'IHDR') { width = data.readUInt32BE(0); height = data.readUInt32BE(4); bitDepth = data[8]; colorType = data[9]; }
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 0 ? 1 : 4;
  const bpp = channels * (bitDepth / 8), stride = width * bpp;
  const out = Buffer.alloc(height * stride);
  let rp = 0;
  for (let y = 0; y < height; y++) {
    const f = raw[rp++];
    const line = raw.slice(rp, rp + stride); rp += stride;
    const cur = out.slice(y * stride, (y + 1) * stride);
    const prev = y > 0 ? out.slice((y - 1) * stride, y * stride) : Buffer.alloc(stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x - bpp] : 0, b = prev[x], c = x >= bpp ? prev[x - bpp] : 0;
      let v = line[x];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c); }
      cur[x] = v & 0xff;
    }
  }
  return { width, height, channels, data: out };
}
/** 统计横贯视野的"连续亮像素段"最大长度 —— 白线特征是某一行的亮段很长 */
function longestBrightRun(png, y) {
  const { width, channels, data } = png;
  const off = y * width * channels;
  const lum = [];
  for (let x = 0; x < width; x++) lum.push(0.299*data[off+x*channels] + 0.587*data[off+x*channels+1] + 0.114*data[off+x*channels+2]);
  const sorted=[...lum].sort((a,b)=>a-b); const med=sorted[Math.floor(width/2)];
  const thr = Math.max(med + 20, 170);
  let best=0, cur=0;
  for (const l of lum) { if (l>thr){cur++; if(cur>best)best=cur;} else cur=0; }
  return { bestRun: best, med:+med.toFixed(0) };
}

(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cdp8-'));
  const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
    '--no-first-run','--disable-gpu','--use-gl=swiftshader','--enable-unsafe-swiftshader','--window-size=1244,615','about:blank'],{stdio:'ignore'});
  let target=null;
  for (let i=0;i<60;i++){ await new Promise(r=>setTimeout(r,500));
    try{ target=JSON.parse(await get(`http://127.0.0.1:${PORT}/json/list`)).find(t=>t.type==='page'); if(target)break;}catch(e){} }
  const ws=new WebSocket(target.webSocketDebuggerUrl);
  let id=0; const pending=new Map();
  ws.addEventListener('message',ev=>{const m=JSON.parse(ev.data);
    if(m.id&&pending.has(m.id)){const p=pending.get(m.id);pending.delete(m.id);m.error?p.rej(new Error(JSON.stringify(m.error))):p.res(m.result);}});
  const send=(method,params={})=>new Promise((res,rej)=>{const mid=++id;pending.set(mid,{res,rej});
    ws.send(JSON.stringify({id:mid,method,params}));
    setTimeout(()=>{if(pending.has(mid)){pending.delete(mid);rej(new Error('timeout'));}},30000);});
  await new Promise(r=>ws.addEventListener('open',r,{once:true}));
  await send('Runtime.enable'); await send('Page.enable');
  await send('Page.navigate',{url:'http://127.0.0.1:8123/index.html'});
  await new Promise(r=>setTimeout(r,6500));

  // 复现 smoke 的序列：开始 → 移动 → J → K → 攻击
  await send('Runtime.evaluate',{expression:`(async()=>{
    const g = window.__game;
    document.getElementById('startBtn')?.click();
    await new Promise(r=>setTimeout(r,1200));
    g.keys.add('KeyW'); g.keys.add('Space');
    await new Promise(r=>setTimeout(r,1500));
    g.keys.clear();
    window.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyJ'}));
    await new Promise(r=>setTimeout(r,300));
    g.game.charge=100;
    window.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyK'}));
    await new Promise(r=>setTimeout(r,600));
    // 保持 K 大招活跃状态（overdrive 未结束）
  })()`,awaitPromise:true,returnByValue:true});
  await new Promise(r=>setTimeout(r,300));

  const shot0=await send('Page.captureScreenshot',{format:'png'});
  const png0=decodePNG(Buffer.from(shot0.data,'base64'));
  let worst={bestRun:0,y:0};
  for(let y=200;y<450;y+=3){const r=longestBrightRun(png0,y); if(r.bestRun>worst.bestRun)worst={...r,y};}
  console.log('复现后最长亮段:', JSON.stringify(worst));
  fs.writeFileSync('D:/gam3/3d/marmot-3d/tools/repro.png',Buffer.from(shot0.data,'base64'));

  if (worst.bestRun>200){
    const T=worst.y;
    const names=['aura.mesh','aura.glow','claw.group','burrow.group','sky.terrain','sky.hills','scenery.grass','scenery.group','dome'];
    for(const nm of names){
      await send('Runtime.evaluate',{expression:`(()=>{
        const g=window.__game;
        const map={'aura.mesh':()=>g.aura.mesh,'aura.glow':()=>g.aura.glow,'claw.group':()=>g.claw.group,
          'burrow.group':()=>g.burrowObj.group,'sky.terrain':()=>g.sky.terrain,'sky.hills':()=>g.sky.hills,
          'scenery.grass':()=>g.scenery.grass,'scenery.group':()=>g.scenery.group,'dome':()=>g.sky.dome};
        const o=map['${nm}']();
        o.__v=o.visible; o.visible=false;
      })()`,returnByValue:true});
      await new Promise(r=>setTimeout(r,320));
      const s=await send('Page.captureScreenshot',{format:'png'});
      const rr=longestBrightRun(decodePNG(Buffer.from(s.data,'base64')),T);
      console.log(`隐藏 ${nm}: bestRun=${rr.bestRun} ${rr.bestRun<worst.bestRun*0.5?'★白线消失':''}`);
      await send('Runtime.evaluate',{expression:`(()=>{const g=window.__game;
        const map={'aura.mesh':()=>g.aura.mesh,'aura.glow':()=>g.aura.glow,'claw.group':()=>g.claw.group,
          'burrow.group':()=>g.burrowObj.group,'sky.terrain':()=>g.sky.terrain,'sky.hills':()=>g.sky.hills,
          'scenery.grass':()=>g.scenery.grass,'scenery.group':()=>g.scenery.group,'dome':()=>g.sky.dome};
        map['${nm}']().visible=true;})()`,returnByValue:true});
    }
  } else console.log('未复现长亮段');
  ws.close(); chrome.kill(); await new Promise(r=>setTimeout(r,300)); process.exit(0);
})();