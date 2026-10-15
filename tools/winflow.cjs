/** 通关流程测试：验证 5 关全部可加载、通关判定、结算与重开 */
const { spawn } = require('child_process');
const http = require('http'); const os = require('os'); const path = require('path'); const fs = require('fs');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9341;
const get = (u) => new Promise((res, rej) => http.get(u, (r) => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(d)); }).on('error', rej));

(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cdp9-'));
  const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
    '--no-first-run','--disable-gpu','--use-gl=swiftshader','--enable-unsafe-swiftshader','--window-size=1244,615','about:blank'],{stdio:'ignore'});
  let target=null;
  for (let i=0;i<60;i++){ await new Promise(r=>setTimeout(r,500));
    try{ target=JSON.parse(await get(`http://127.0.0.1:${PORT}/json/list`)).find(t=>t.type==='page'); if(target)break;}catch(e){} }
  const ws=new WebSocket(target.webSocketDebuggerUrl);
  let id=0; const pending=new Map(); const pageErrors=[];
  ws.addEventListener('message',ev=>{const m=JSON.parse(ev.data);
    if(m.id&&pending.has(m.id)){const p=pending.get(m.id);pending.delete(m.id);m.error?p.rej(new Error(JSON.stringify(m.error))):p.res(m.result);}
    else if(m.method==='Runtime.exceptionThrown'){const d=m.params.exceptionDetails;pageErrors.push(d.exception?.description||d.text);}});
  const send=(m,p={})=>new Promise((res,rej)=>{const mid=++id;pending.set(mid,{res,rej});
    ws.send(JSON.stringify({id:mid,method:m,params:p}));
    setTimeout(()=>{if(pending.has(mid)){pending.delete(mid);rej(new Error('timeout '+m));}},30000);});
  await new Promise(r=>ws.addEventListener('open',r,{once:true}));
  await send('Runtime.enable'); await send('Page.enable');
  await send('Page.navigate',{url:'http://127.0.0.1:8123/index.html'});
  await new Promise(r=>setTimeout(r,6500));

  const expr = `(async () => {
    const g = window.__game;
    const log = [];
    document.getElementById('startBtn')?.click();
    await new Promise(r=>setTimeout(r,1000));

    // 逐关"作弊通关"：直接满足条件，验证流程与关卡切换
    for (let lvl = 0; lvl < 5; lvl++) {
      const cfg = g.LEVELS[g.game.level];
      // 满足三目标
      g.game.foodCount = cfg.goal;
      g.game.levelKills = cfg.kills;
      g.game.friend.rescued = true;
      g.game.friend.saved = true;
      g.companion.rescued = true; g.companion.saved = true;
      if (cfg.boss) {
        g.game.bossDown = true;
        const boss = g.foxes().find(f => f.type === 'boss');
        if (boss) boss.hp = 0;
      }
      // 传送回洞内
      g.controller.teleport(g.burrow.x, g.burrow.z, 0);
      await new Promise(r=>setTimeout(r,500));
      log.push({ before: g.game.level, inBurrow: g.game.inBurrow, mode: g.game.mode });

      // 等待通关判定
      await new Promise(r=>setTimeout(r,700));
      log.push({ after: g.game.level, mode: g.game.mode,
        hasNextBtn: !!document.getElementById('nextBtn'),
        panelText: (document.getElementById('panel')?.textContent||'').slice(0,40) });

      const nb = document.getElementById('nextBtn');
      if (nb) { nb.click(); await new Promise(r=>setTimeout(r,900)); }
      else break;
    }
    await new Promise(r=>setTimeout(r,800));
    return { log, finalMode: g.game.mode, completed: g.game.completed,
      finalLevel: g.game.level, totalKills: g.game.totalKills,
      panel: (document.getElementById('panel')?.textContent||'').slice(0,120) };
  })()`;

  const r = await send('Runtime.evaluate',{expression:expr,returnByValue:true,awaitPromise:true});
  console.log(JSON.stringify(r.result?.value,null,1));
  console.log('\\n页面异常:', pageErrors.length);
  pageErrors.slice(0,5).forEach(e=>console.log('  '+String(e).slice(0,200)));

  const shot = await send('Page.captureScreenshot',{format:'png'});
  fs.writeFileSync('D:/gam3/3d/marmot-3d/tools/win.png',Buffer.from(shot.data,'base64'));
  ws.close(); chrome.kill(); await new Promise(r=>setTimeout(r,300)); process.exit(0);
})();