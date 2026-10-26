/**
 * dev 洞穴扫描内景 + sorrel + 尖叫土拨鼠 · Chrome CDP 实测（dev 通道）。
 *
 * 覆盖验收矩阵：
 *  1) dev 洞口外观：朴素土堆 + 小洞口 + 文字；无光柱/顶环/临时洞 beacon/sbeam；
 *  2) 主洞与临时洞可进入、可退出，扫描内景 GLB 懒加载成功（网络层证据）；
 *  3) inBurrow 语义正常（洞内不可攻击、回储备抑制、天气抑制）；
 *  4) 可采集草本为 shrub-sorrel 模型（realModel 存在）；
 *  5) 第三人称玩家与同伴使用尖叫土拨鼠（playerBody 隐藏 = 真模型接管）；
 *  6) stable 通道零影响（地标光柱/顶环保留、IS_DEV 关闭）。
 *
 * Chrome 来源：连接已有托管 Chrome（BURROW_QA_CDP，缺省 http://127.0.0.1:18800），
 * 通过 Target.createTarget 开独立标签页，测完关闭，不影响其它标签。
 * BURROW_QA_CDP=off 时才自起 headless Chrome（软件渲染较慢，仅作兜底）。
 *
 * 产物：outputs/m3d-20261026-dev-burrow-sorrel-marmot/visual/*.png + qa-result.json
 * 用法：node tools/qa-dev-burrow-managed.cjs
 */
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'outputs', 'm3d-20261026-dev-burrow-sorrel-marmot', 'visual');
const HTTP_PORT = Number(process.env.BURROW_QA_PORT || 8352);
const CDP = process.env.BURROW_QA_CDP === 'off' ? null : (process.env.BURROW_QA_CDP || 'http://127.0.0.1:18800');
const TIER = process.env.BURROW_QA_TIER || 'low';
const TOTAL_TIMEOUT_MS = Number(process.env.BURROW_QA_TIMEOUT || 8 * 60 * 1000);

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon', '.svg': 'image/svg+xml', '.woff2': 'font/woff2',
  '.glb': 'model/gltf-binary', '.bin': 'application/octet-stream',
  '.hdr': 'application/octet-stream', '.exr': 'application/octet-stream',
  '.ktx2': 'image/ktx2', '.basis': 'application/octet-stream', '.png2': 'image/png',
};

const results = [];
const record = (name, pass, detail = '') => {
  results.push({ name, pass: !!pass, detail: String(detail).slice(0, 400) });
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const startedAt = Date.now();
const overBudget = () => Date.now() - startedAt > TOTAL_TIMEOUT_MS;

function startStaticServer() {
  const server = http.createServer((req, res) => {
    let rel = decodeURIComponent(req.url.split('?')[0]);
    if (rel === '/') rel = '/index.html';
    const file = path.join(ROOT, path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));
    if (!file.startsWith(ROOT)) return res.writeHead(403).end();
    fs.readFile(file, (e, d) => {
      if (e) return res.writeHead(404).end('404');
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
        'Cache-Control': 'no-cache',
        'Accept-Ranges': 'bytes',
      });
      res.end(d);
    });
  });
  return new Promise((resolve, reject) => {
    server.once('error', async (err) => {
      if (err && err.code === 'EADDRINUSE') {
        // 端口已被占用：复用已有静态服务（必须确实指向本工作树，否则拒绝）
        try {
          const probe = await fetch(`http://127.0.0.1:${HTTP_PORT}/src/main.js`);
          const body = await probe.text();
          if (body.includes('USE_REAL_MODELS')) {
            console.log(`[qa] 复用已在 ${HTTP_PORT} 运行的静态服务`);
            return resolve(null);
          }
        } catch (_) {}
        return reject(new Error(`端口 ${HTTP_PORT} 被占用，但不是本工作树的静态服务`));
      }
      reject(err);
    });
    server.listen(HTTP_PORT, '127.0.0.1', () => resolve(server));
  });
}

function findChrome() {
  for (const c of [process.env.CHROME_PATH, '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium'].filter(Boolean)) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

async function waitGame(ev, budgetMs) {
  const deadline = Date.now() + budgetMs;
  while (Date.now() < deadline) {
    const ok = await ev('!!window.__game').catch(() => false);
    if (ok) return true;
    await sleep(1000);
  }
  return false;
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const server = await startStaticServer();
  const ownsServer = !!server;
  let chrome = null;
  if (!CDP) {
    const bin = findChrome();
    if (!bin) throw new Error('未找到 Chrome，且 BURROW_QA_CDP 未提供可用端点');
    chrome = spawn(bin, [
      '--headless=new', `--remote-debugging-port=${HTTP_PORT + 100}`, '--no-sandbox',
      '--disable-gpu-sandbox', '--enable-unsafe-swiftshader', '--use-angle=swiftshader',
      '--window-size=1280,720', 'about:blank',
    ], { stdio: 'ignore' });
    await sleep(2500);
  }
  const cdpBase = CDP || `http://127.0.0.1:${HTTP_PORT + 100}`;
  const origBase = CDP;
  if (!CDP) { /* 兜底模式改写 CDP 基准 */ }
  const cdp = origBase || cdpBase;
  const devUrl = `http://127.0.0.1:${HTTP_PORT}/index.html?version=dev&webgl=1&verdantTier=${TIER}&t=${Date.now()}`;
  let page = null;
  try {
    page = await openTabWith(cdp, devUrl);
    const { ev, send, errors, requests } = page;

    const ready = await waitGame(ev, 240000);
    if (!ready) {
      const probe = await ev(`({href:location.href,ready:!!window.__game,body:(document.body?.innerText||'').slice(0,300)})`).catch((e) => ({ err: String(e) }));
      record('dev 页面加载到 __game', false, JSON.stringify(probe).slice(0, 300));
      throw new Error('dev 页面未就绪');
    }
    record('dev 页面加载到 __game', true, devUrl);

    // 进入游戏
    await ev("document.getElementById('startBtn')?.click()").catch(() => {});
    await sleep(6000);

    const info = await ev(`(() => {
      const g = window.__game;
      return {
        isDev: !!g.isDev, isBeta: !!g.isBeta,
        backend: g.rendererStatus?.backend,
        burrows: (g.burrows||[]).map(b=>({id:b.id,type:b.type,x:b.x,z:b.z})),
        hasBurrowObj: !!g.burrowObj,
        burrowObjKeys: g.burrowObj ? Object.keys(g.burrowObj).filter(k=>['beam','cap','beacon','sbeam','labelSprite','interiorGroup','label','isBase','mouth'].includes(k)) : [],
        companionModel: g.companion?.modelLevel || null,
        companionHasReal: !!g.companion?.realModel,
        playerBodyVisible: g.playerBody?.visible,
        playerModelChildren: g.playerModel?.children?.length ?? -1,
        foodCount: (g.berries?.()||[]).length,
        foodSorrel: (g.berries?.()||[]).filter(f=>f.herbivore && f.realModel).length,
        foodHerb: (g.berries?.()||[]).filter(f=>f.herbivore).length,
        drawCalls: g.renderer?.info?.render?.calls,
      };
    })()`);
    record('dev 通道生效 (IS_DEV)', info.isDev === true, JSON.stringify({ isDev: info.isDev, isBeta: info.isBeta, backend: info.backend }));

    // ---- 1) 洞口外观：地标光柱/顶环/beacon 必须不存在 ----
    const b0 = info.burrowObjKeys;
    record('dev 洞口无光柱/顶环/beacon 地标', !b0.includes('beam') && !b0.includes('cap') && !b0.includes('beacon') && !b0.includes('sbeam'), `burrowObj 键: ${b0.join(',') || '(空)'}`);
    record('dev 洞口保留悬浮文字标识', b0.includes('labelSprite'), `labelSprite=${b0.includes('labelSprite')}`);
    record('dev 洞口具备扫描内景容器', b0.includes('interiorGroup'), `interiorGroup=${b0.includes('interiorGroup')}`);

    const shot = async (name) => {
      const s = await send('Page.captureScreenshot', { format: 'png' });
      const buf = Buffer.from(s.data, 'base64');
      fs.writeFileSync(path.join(OUT, `${name}.png`), buf);
      return buf.length;
    };

    // 找主洞与一个临时洞
    const base = info.burrows.find((b) => b.type === 'base');
    const shelter = info.burrows.find((b) => b.type === 'shelter');
    record('存在主洞与临时洞定义', !!base && !!shelter, JSON.stringify(info.burrows));

    const place = async (x, y, z, yaw, pitch, third) => {
      await ev(`(()=>{const g=window.__game,c=g.controller;g.setViewMode?.(${!!third});c.position.set(${x},${y},${z});c.yaw=${yaw};c.pitch=${pitch};c.velocity?.set?.(0,0,0);c.vy=0;})()`);
      await sleep(2200);
    };

    // ---- 2) 主洞外观多角度截图 ----
    if (base) {
      const surf = await ev(`window.__game.terrainHeight(${base.x}, ${base.z})`);
      const y = Number(surf) || 0;
      await place(base.x, y + 1.2, base.z + 7, Math.PI, -0.22, true);
      const s1 = await shot('01-base-mouth-third');
      await place(base.x + 6.5, y + 1.4, base.z + 6.5, Math.PI * 0.75, -0.25, false);
      const s2 = await shot('02-base-mouth-fpv');
      await place(base.x, y + 3.2, base.z, Math.PI, -0.85, false);
      const s3 = await shot('03-base-mouth-topdown');
      record('主洞外观截图产出', s1 > 5000 && s2 > 5000 && s3 > 5000, `${s1}/${s2}/${s3} 字节`);
    }

    // ---- 3) 进入主洞：inBurrow + 内景懒加载 ----
    const enterBurrow = async (b, tag) => {
      const surf = await ev(`window.__game.terrainHeight(${b.x}, ${b.z})`);
      const surface = Number(surf) || 0;
      let inBurrow = false;
      for (const dy of [-1.0, -1.8, -2.6, -3.2]) {
        await place(b.x, surface + dy, b.z, Math.PI, -0.15, false);
        inBurrow = await ev('!!window.__game.game.inBurrow');
        if (inBurrow) break;
      }
      await sleep(2500);
      const glb = b.type === 'base' ? 'burrow-main-interior.glb' : 'burrow-shelter-interior.glb';
      const req = requests.find((r) => r.url.includes(glb));
      const interiorChildren = await ev(`(()=>{const g=window.__game;const o=g.burrowObj;return o&&o.interiorGroup?o.interiorGroup.children.length:-1})()`);
      record(`${tag} 可进入（inBurrow）`, inBurrow === true, `inBurrow=${inBurrow}`);
      record(`${tag} 扫描内景 GLB 已请求`, !!req, req ? `${req.status} ${glb}` : `未观察到 ${glb} 请求`);
      record(`${tag} 内景容器非空`, Number(interiorChildren) > 0, `children=${interiorChildren}`);
      return inBurrow;
    };

    if (base) await enterBurrow(base, '主洞');
    if (base) {
      await place(base.x, (Number(await ev(`window.__game.terrainHeight(${base.x}, ${base.z})`)) || 0) - 1.2, base.z, Math.PI, -0.1, false);
      await sleep(1500);
      const s = await shot('04-base-interior');
      record('主洞内景截图产出', s > 5000, `${s} 字节`);
    }

    // ---- 4) 临时洞 ----
    if (shelter) {
      const surf = await ev(`window.__game.terrainHeight(${shelter.x}, ${shelter.z})`);
      await place(shelter.x, (Number(surf) || 0) + 1.2, shelter.z + 5, Math.PI, -0.25, true);
      const s = await shot('05-shelter-mouth-third');
      record('临时洞外观截图产出', s > 5000, `${s} 字节`);
      await enterBurrow(shelter, '临时洞');
      await place(shelter.x, (Number(await ev(`window.__game.terrainHeight(${shelter.x}, ${shelter.z})`)) || 0) - 0.8, shelter.z, Math.PI, -0.1, false);
      await sleep(1200);
      const s2 = await shot('06-shelter-interior');
      record('临时洞内景截图产出', s2 > 5000, `${s2} 字节`);
    }

    // ---- 5) 出洞：inBurrow 必须回到 false ----
    if (base) {
      await place(base.x + 30, (Number(await ev(`window.__game.terrainHeight(${base.x + 30}, ${base.z + 30})`)) || 0) + 1, base.z + 30, 0, 0, false);
      await sleep(2000);
      const out = await ev('window.__game.game.inBurrow');
      record('可退出洞穴（inBurrow=false）', out === false, `inBurrow=${out}`);
    }

    // ---- 6) sorrel 食物 + 尖叫土拨鼠 ----
    const mdl = await ev(`(()=>{const g=window.__game;return {
      herb: (g.berries?.()||[]).filter(f=>f.herbivore).length,
      sorrel: (g.berries?.()||[]).filter(f=>f.herbivore&&f.realModel).length,
      companionLevel: g.companion?.modelLevel||null,
      companionReal: !!g.companion?.realModel,
      playerBodyVisible: g.playerBody?.visible,
      playerModelKids: g.playerModel?.children?.length??-1,
    }})()`);
    record('可采集草本已替换为 sorrel 模型', mdl.sorrel > 0 && mdl.sorrel === mdl.herb, `sorrel=${mdl.sorrel}/${mdl.herb}`);
    record('同伴使用尖叫土拨鼠真模型', mdl.companionReal === true, `modelLevel=${mdl.companionLevel}`);
    record('第三人称玩家使用真模型接管', mdl.playerBodyVisible === false, `playerBody.visible=${mdl.playerBodyVisible}`);
    await place(base ? base.x + 10 : 0, 1.2, base ? base.z + 10 : 0, Math.PI * 0.5, -0.15, true);
    const s7 = await shot('07-third-person-screaming-marmot');
    record('第三人称玩家截图产出', s7 > 5000, `${s7} 字节`);

    // ---- 7) stable 通道零影响 ----
    const stableUrl = `http://127.0.0.1:${HTTP_PORT}/index.html?version=stable&t=${Date.now()}`;
    const sp = await openTabWith(cdp, stableUrl);
    const sReady = await waitGame(sp.ev, 120000);
    let stableInfo = null;
    if (sReady) {
      await sp.ev("document.getElementById('startBtn')?.click()").catch(() => {});
      await sleep(4000);
      stableInfo = await sp.ev(`(()=>{const g=window.__game;const o=g.burrowObj;return {
        isDev: !!g.isDev,
        hasBeam: !!(o&&o.beam), hasCap: !!(o&&o.cap), hasBeacon: !!(o&&o.beacon),
        hasInterior: !!(o&&o.interiorGroup),
        label: o&&o.label,
      }})()`);
      await sp.send('Page.captureScreenshot', { format: 'png' }).then((r) =>
        fs.writeFileSync(path.join(OUT, '08-stable-isolation.png'), Buffer.from(r.data, 'base64')));
    }
    await sp.close();
    record('stable 通道 IS_DEV 关闭', stableInfo && stableInfo.isDev === false, JSON.stringify(stableInfo));
    record('stable 保留原有地标光柱/顶环', stableInfo && stableInfo.hasBeam === true && stableInfo.hasCap === true, JSON.stringify(stableInfo));
    record('stable 无扫描内景容器', stableInfo && stableInfo.hasInterior === false, JSON.stringify(stableInfo));

    const hardErrors = errors.filter((e) => !/favicon|Failed to load resource.*404/i.test(e));
    record('页面无未捕获异常', hardErrors.length === 0, hardErrors.slice(0, 4).join(' | ').slice(0, 300));

    fs.writeFileSync(path.join(OUT, 'qa-result.json'), JSON.stringify({
      task: 'm3d-20261026-dev-burrow-sorrel-marmot', url: devUrl, tier: TIER,
      backend: info.backend, info, stableInfo, errors: hardErrors.slice(0, 20),
      requests: requests.filter((r) => /burrow|sorrel|marmot-screaming/i.test(r.url)).slice(0, 40),
      results,
    }, null, 2));

    const failed = results.filter((r) => !r.pass);
    console.log(`\n=== ${results.length - failed.length}/${results.length} PASS ===`);
    if (failed.length) console.log('FAILED:\n' + failed.map((f) => ` - ${f.name} (${f.detail})`).join('\n'));
    await page.close();
  } finally {
    if (chrome) try { chrome.kill('SIGKILL'); } catch (_) {}
    if (ownsServer && server) server.close();
  }
}

// openTabWith：允许自起 Chrome 模式下用不同 CDP 基准
async function openTabWith(cdpBase, url) {
  const saved = CDP;
  const t = await (async () => {
    let tab;
    try { tab = await (await fetch(`${cdpBase}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' })).json(); }
    catch { tab = await (await fetch(`${cdpBase}/json/new?${encodeURIComponent(url)}`)).json(); }
    const ws = new WebSocket(tab.webSocketDebuggerUrl);
    let id = 0; const pending = new Map(); const errors = []; const requests = [];
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
      if (m.method === 'Runtime.exceptionThrown') errors.push(`exception: ${m.params.exceptionDetails?.text || 'unknown'}`);
      else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push('console: ' + m.params.args.map((a) => a.value ?? a.description ?? a.type).join(' ').slice(0, 240));
      else if (m.method === 'Network.responseReceived') requests.push({ url: m.params.response.url, status: m.params.response.status });
    };
    const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
    const ev = async (expression) => {
      const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.text || 'eval failed');
      return r.result?.value;
    };
    await new Promise((r) => { ws.onopen = r; });
    await send('Runtime.enable'); await send('Page.enable'); await send('Log.enable'); await send('Network.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
    return { tab, ws, send, ev, errors, requests, close: async () => { try { await fetch(`${cdpBase}/json/close/${tab.id}`); } catch (_) {} try { ws.close(); } catch (_) {} } };
  })();
  return t;
}

main().catch((e) => { console.error('QA FAILED:', e.message); process.exit(1); });
