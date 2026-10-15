/**
 * dev 版（生态学改写）专项测试，同时回归正式版。
 * 关键断言：
 *   · 正式版行为完全不变（浆果、无季节、消耗高）
 *   · dev 版出现草本植物、按关卡变化季节、耐饥渴参数生效
 *   · 亚油酸 / 多汁加成正确
 *   · 两个版本都零控制台错误
 */
const { spawn } = require('child_process');
const http = require('http'); const os = require('os'); const path = require('path'); const fs = require('fs');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
let PORT = 9380;
const BASE = 'http://127.0.0.1:8200/index.html';

function get(u) {
  return new Promise((res, rej) => http.get(u, (r) => {
    let d = ''; r.on('data', c => d += c); r.on('end', () => res(d));
  }).on('error', rej));
}

async function run(url, label) {
  PORT += 1;
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cdpEco-'));
  const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
    '--no-first-run', '--disable-gpu', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', 'about:blank'], { stdio: 'ignore' });
  let target = null;
  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 500));
    try { target = JSON.parse(await get(`http://127.0.0.1:${PORT}/json/list`)).find(t => t.type === 'page'); if (target) break; } catch (e) {}
  }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let id = 0; const pending = new Map(); const pageErrors = []; const consoleMsgs = [];
  ws.addEventListener('message', ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); return; }
    if (m.method === 'Runtime.exceptionThrown') { const d = m.params.exceptionDetails; pageErrors.push(d.exception?.description || d.text); }
    if (m.method === 'Runtime.consoleAPICalled' && (m.params.type === 'error' || m.params.type === 'warning')) {
      consoleMsgs.push(`[${m.params.type}] ` + m.params.args.map(a => a.value ?? a.description ?? a.type).join(' '));
    }
  });
  const send = (method, params = {}) => new Promise((res, rej) => {
    const mid = ++id; pending.set(mid, { res, rej });
    ws.send(JSON.stringify({ id: mid, method, params }));
    setTimeout(() => { if (pending.has(mid)) { pending.delete(mid); rej(new Error('timeout')); } }, 60000);
  });
  await new Promise(r => ws.addEventListener('open', r, { once: true }));
  await send('Runtime.enable'); await send('Page.enable');
  await send('Page.navigate', { url });
  await new Promise(r => setTimeout(r, 7000));

  const expr = `(async () => {
    const g = window.__game;
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const out = {};
    document.getElementById('startBtn')?.click();
    await sleep(1000);

    out.version = {
      isDev: g.isDev,
      tag: (document.getElementById('versionTag')?.textContent || '').slice(0, 40),
      hasDevIntro: !!document.querySelector('.dev-intro'),
    };

    // 采食物形态
    const foods = g.berries();
    out.food = {
      count: foods.length,
      herbivore: foods[0].herbivore,
      hasPlant: !!foods[0].plant,
      plantName: foods[0].plant ? foods[0].plant.name : null,
      season: g.game.season ? g.game.season.season : null,
    };

    // 采集测试：吃掉第一个
    g.controller.teleport(foods[0].x, foods[0].z, 0);
    await sleep(500);
    const eBefore = g.game.player.energy;
    out.gather = { foodCount: g.game.foodCount, energyBefore: +eBefore.toFixed(1) };

    // 逐关检查季节变化：必须走真实 loadLevel，季节与采食点才会按关重建。
    // 早期只写 g.game.level=lv 而不换关，game.season 永远停在第 1 关的"早春"，
    // 5 关读出来全是早春，等于没测。
    out.seasons = [];
    for (let lv = 0; lv < g.LEVELS.length; lv++) {
      g.loadLevel(lv);
      await sleep(60); // 让重建后的实体/环境有机会应用
      const s = g.game.season;
      const f0 = g.berries()[0];
      out.seasons.push({
        level: lv + 1,
        season: s ? s.season : null,
        note: s ? s.seasonNote.slice(0, 16) : null,
        food: f0 && f0.plant ? f0.plant.name : null,
        foodCount: g.berries().length,
      });
    }

    // 耐饥渴：见底惩罚对比
    g.game.level = 0;
    const e0 = g.game.player.energy;
    g.game.player.energy = 2;
    const weakStats = g.combatStats();
    g.game.player.energy = 90;
    const normStats = g.combatStats();
    g.game.player.energy = e0;
    out.famine = {
      weakSpeedMul: +weakStats.speedMul.toFixed(3),
      normSpeedMul: +normStats.speedMul.toFixed(3),
      weakDamage: +weakStats.damage.toFixed(3),
      normDamage: +normStats.damage.toFixed(3),
    };

    // 亚油酸与多汁加成
    out.energyTable = g.ecology ? {
      plain: g.ecology.energyOfPlant({ key: 'x', moisture: 'mid' }),
      juicy: g.ecology.energyOfPlant({ key: 'x', moisture: 'high' }),
      linoleic: g.ecology.energyOfPlant({ key: 'x', moisture: 'mid', linoleic: true }),
    } : null;

    // 关卡摘要里的季节信息
    out.hudObjective = (document.getElementById('objective')?.textContent || '').replace(/\\s+/g, ' ').slice(0, 120);

    return out;
  })()`;

  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(`D:/gam3/3d/marmot-3d/tools/eco-${label}.png`, Buffer.from(shot.data, 'base64'));
  ws.close(); chrome.kill();
  await new Promise(r => setTimeout(r, 400));
  return { data: r.result?.value, pageErrors, consoleMsgs };
}

(async () => {
  console.log('========== 正式版（无参数） ==========');
  const stable = await run(BASE, 'stable');
  console.log(JSON.stringify(stable.data, null, 1));
  console.log('异常:', stable.pageErrors.length, '控制台:', stable.consoleMsgs.length);
  stable.pageErrors.slice(0, 3).forEach(e => console.log('  ' + String(e).slice(0, 250)));
  stable.consoleMsgs.slice(0, 3).forEach(e => console.log('  ' + String(e).slice(0, 200)));

  console.log('\n========== dev 版（?version=dev） ==========');
  const dev = await run(BASE + '?version=dev', 'dev');
  console.log(JSON.stringify(dev.data, null, 1));
  console.log('异常:', dev.pageErrors.length, '控制台:', dev.consoleMsgs.length);
  dev.pageErrors.slice(0, 3).forEach(e => console.log('  ' + String(e).slice(0, 250)));
  dev.consoleMsgs.slice(0, 3).forEach(e => console.log('  ' + String(e).slice(0, 200)));

  process.exit(0);
})();