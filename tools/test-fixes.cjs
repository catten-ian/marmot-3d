/**
 * 本轮问题修复的回归测试。
 *
 * 分两层：
 *   A. Node 纯逻辑 / 源码断言 —— 不依赖浏览器，直接 import 无 DOM 依赖的模块，
 *      并用文本断言锁定那些"只有读代码才能确定"的修复（轴向、文案、属性名）。
 *   B. 无头 Chrome 运行时断言 —— 验证 Enter 放行、地形挂载位置、dev 换关不泄漏
 *      采食点、季节随真实 loadLevel 变化。
 *
 * 前置：静态服务器已在 127.0.0.1:8200 运行（node tools/serve.cjs 8200）。
 */
const { spawn } = require('child_process');
const http = require('http'); const os = require('os'); const path = require('path');
const fs = require('fs'); const { pathToFileURL } = require('url');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const ROOT = path.resolve(__dirname, '..');
const BASE = 'http://127.0.0.1:8200/index.html';
let PORT = 9411;

let failures = 0;
function check(name, cond, extra = '') {
  const ok = !!cond;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`);
  if (!ok) failures++;
}

function get(u) {
  return new Promise((res, rej) => http.get(u, (r) => {
    let d = ''; r.on('data', c => d += c); r.on('end', () => res(d));
  }).on('error', rej));
}

// ————————————————————————————————————————
// A. Node 层断言
// ————————————————————————————————————————
async function nodeChecks() {
  console.log('\n======== A. 纯逻辑 / 源码断言 ========');

  const cfg = await import(pathToFileURL(path.join(ROOT, 'src', 'core', 'config.js')).href);
  check('LEVELS 共 12 关', cfg.LEVELS.length === 12, `实际 ${cfg.LEVELS.length}`);

  // 稳定版系数 1
  let b = cfg.moveBounds();
  check('moveBounds 稳定版 = ±77/±51',
    Math.abs(b.hw - 77) < 1e-9 && Math.abs(b.hh - 51) < 1e-9,
    `${b.hw.toFixed(1)}/${b.hh.toFixed(1)}`);
  let r = cfg.roamBounds();
  check('roamBounds 稳定版 = ±74/±44',
    Math.abs(r.hw - 74) < 1e-9 && Math.abs(r.hh - 44) < 1e-9);

  // GS 缩放后边界随系数变化
  cfg.setPointScale(0.831, 0, 0);
  b = cfg.moveBounds(); r = cfg.roamBounds();
  check('缩放后 moveBounds 随 K', Math.abs(b.hw - 77 * 0.831) < 1e-6, b.hw.toFixed(2));
  check('缩放后 roamBounds 随 K', Math.abs(r.hw - 74 * 0.831) < 1e-6, r.hw.toFixed(2));
  check('scalePoint 缩放+居中', (() => {
    const [x, z] = cfg.scalePoint([100, 0]);
    return Math.abs(x - 83.1) < 1e-6;
  })());
  cfg.setPointScale(1, 0, 0); // 复位

  // ecology：季节按关变化且循环（5 个季节表）
  const eco = await import(pathToFileURL(path.join(ROOT, 'src', 'core', 'ecology.js')).href);
  check('第 1 关季节 = 早春', eco.seasonForLevel(0).season === '早春');
  check('第 5 关季节 = 冬眠前', eco.seasonForLevel(4).season === '冬眠前');
  check('亚油酸加成 > 多汁加成',
    eco.energyOfPlant({ key: 'x', linoleic: true }) > eco.energyOfPlant({ key: 'x', moisture: 'high' }));

  // keybinds：优化方案不得有同一按键绑多个动作（历史上 jump 与 interact 同绑 KeyF）
  const kb = await import(pathToFileURL(path.join(ROOT, 'src', 'core', 'keybinds.js')).href);
  const k = new kb.Keybinds();
  k.setScheme('optimized');
  const conflicts = kb.findConflicts(k.map);
  check('优化方案无按键冲突', conflicts.size === 0,
    conflicts.size ? [...conflicts.entries()].map(([c, a]) => `${c}:${a.join('/')}`).join('; ') : '');
  check('优化方案 jump 不再绑 KeyF', !k.keys('jump').includes('KeyF'));
  check('优化方案 interact 仍为 KeyF', k.key('interact') === 'KeyF');

  // —— 源码文本断言（锁定"读代码才能确定"的修复）——
  const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
  const hud = read('src/ui/hud.js');
  check('hud.js 关卡总数取自 LEVELS.length', hud.includes('LEVELS.length'));
  check('hud.js 不再写死 LEVEL_COUNT=5', !/const\s+LEVEL_COUNT\s*=\s*5/.test(hud));

  const main = read('src/main.js');
  check('Enter 在 isBound 放行', /if \(code === 'Enter'\) return true;/.test(main));
  check('GS 隐藏块改挂 sky.terrain', main.includes('if (sky.terrain) sky.terrain.visible = false;'));
  check('旧 Food 换关时 dispose', /berries\.forEach\(\(b\) => b\.dispose\(scene\)\)/.test(main));
  check('伙伴点位经 scalePoint', /scalePoint\(cfg\.friend\)/.test(main));
  check('标题关卡数用 LEVELS.length', main.includes('${LEVELS.length} 关逐步引入'));
  check('__game 暴露 loadLevel 供测试', /loadLevel: \(i\) => loadLevel\(i, false\)/.test(main));

  const pe = read('src/entities/props_entities.js');
  check('companion 模型开关用布尔判断', /if \(!USE_REAL_MODELS\) return;/.test(pe));
  check('Food 提供 dispose', /dispose\(scene = this\.scene\)/.test(pe));

  const fox = read('src/entities/fox.js');
  check('fox 边界用 roamBounds', fox.includes('roamBounds()'));
  check('fox hit 清连冲账本', /this\.comboActive = false;\s*this\.comboLeft = 0;/.test(fox));
  check('血条只缩放 fill（不再移动 children[0]）', fox.includes('this.hpBar.userData.fill'));
  check('fox dispose 释放 hpBar 子树', /disposeTree\(this\.hpBar\)/.test(fox));

  const controls = read('src/core/controls.js');
  check('controls 用 moveBounds', controls.includes('moveBounds()'));
  check('controls 岩石经 scalePoint/scaleRadius',
    controls.includes('scalePoint(rp)') && controls.includes('scaleRadius(rp[2])'));

  const utils = read('src/core/utils.js');
  check('地形洞穴压平用 BURROW 配置', utils.includes('scaleCoord(BURROW.x') && !/Math\.hypot\(x \+ 52, z\)/.test(utils));

  const props = read('src/world/props.js');
  check('Burrow 半径取 pos.r', /this\.r = pos\.r \?\? 8\.2;/.test(props));
  check('草丛洞穴排除用缩放坐标', props.includes('scaleCoord(BURROW.x'));

  const gsmain = read('src/gs/main.js');
  check('gs/main.js 轴向旋转为 -π/2', /g\.rotation\.set\(-Math\.PI \/ 2, 0, 0\);/.test(gsmain));
  check('gs/main.js 水平跨度取源 X/Y', gsmain.includes('srcSpanY') && !/srcSpanZ = Math\.max\(1, sbb\.max\.z/.test(gsmain));
  check('gs/main.js 垂直锚定地面分位层', gsmain.includes('groundZ') && gsmain.includes('r.y - groundZ * sc'));
  check('gs/main.js 纵深居中用 +srcCenterY', gsmain.includes('srcCenterY * sc'));
  check('gs/main.js 不再宣称"含球谐"', !/含球谐/.test(gsmain));

  const loader = read('src/models/loader.js');
  check('loader 超时后忽略迟到成功', /if \(timedOut\) \{/.test(loader));
  check('preloadModels 上报 STATUS', /STATUS\.marmot\.level/.test(loader));

  const ver = read('src/core/version.js');
  check('version.js 提供 ?gs= 覆盖', ver.includes('GS_OVERRIDE'));

  const html = read('index.html');
  check('引导层接入 GS_OVERRIDE', html.includes('GS_OVERRIDE'));
}

// ————————————————————————————————————————
// B. 无头浏览器运行时断言
// ————————————————————————————————————————
async function runBrowser(url, label, expr, opts = {}) {
  const port = ++PORT;
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cdpFix-'));
  const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
    '--no-first-run', '--disable-gpu', '--use-gl=swiftshader', '--enable-unsafe-swiftshader',
    '--use-fake-ui-for-media-stream', 'about:blank'], { stdio: 'ignore' });
  let target = null;
  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 500));
    try { target = JSON.parse(await get(`http://127.0.0.1:${port}/json/list`)).find(t => t.type === 'page'); if (target) break; } catch (e) {}
  }
  if (!target) { chrome.kill(); throw new Error(`[${label}] 找不到 Chrome 调试目标`); }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let id = 0; const pending = new Map(); const errors = [];
  ws.addEventListener('message', ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); return; }
    if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description || m.params.text);
  });
  const send = (method, params = {}, timeoutMs = 60000) => new Promise((res, rej) => {
    const mid = ++id; pending.set(mid, { res, rej });
    ws.send(JSON.stringify({ id: mid, method, params }));
    setTimeout(() => { if (pending.has(mid)) { pending.delete(mid); rej(new Error('timeout')); } }, timeoutMs);
  });
  await new Promise(r => ws.addEventListener('open', r, { once: true }));
  await send('Runtime.enable'); await send('Page.enable');
  await send('Page.navigate', { url });
  // 轮询等待游戏引导完成（dev 版要探 WebGPU，连续第二个 SwiftShader 实例可能很慢），
  // 不用固定 sleep —— 快的时候不浪费，慢的时候不至于误判超时。
  let ready = false;
  for (let i = 0; i < 40; i++) {
    await new Promise(r => setTimeout(r, 600));
    try {
      const probe = await send('Runtime.evaluate',
        { expression: '!!(window.__game && window.__game.LEVELS && window.__game.scene)', returnByValue: true }, 8000);
      if (probe.result.value) { ready = true; break; }
    } catch (e) { /* 导航中上下文重建，忽略 */ }
  }
  if (!ready) throw new Error(`[${label}] __game 引导超时`);
  // __game 就绪后主线程仍可能被模型预加载占满（headless SwiftShader 下实测约 20s），
  // 此时求值会排队。固定等待让其冷静，最终求值再用较长超时兜底（见 evalTimeoutMs）。
  await new Promise(r => setTimeout(r, opts.settleMs ?? 500));

  const r = await send('Runtime.evaluate',
    { expression: `(async () => { ${expr} })()`, returnByValue: true, awaitPromise: true },
    opts.evalTimeoutMs ?? 30000);
  ws.close();
  // Windows 下 chrome.kill() 只杀浏览器主进程，SwiftShader 的 GPU 子进程会残留，
  // 拖慢下一个实例。用 taskkill /T 强制结束整棵进程树。
  try { spawn('taskkill', ['/PID', String(chrome.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }); } catch (e) {}
  await new Promise(r => setTimeout(r, 1200));
  return { checks: r.result?.value || [], errors };
}

function report(label, res) {
  console.log(`\n======== B. 浏览器运行时（${label}） ========`);
  for (const c of res.checks) check(c.name, c.ok, c.extra || '');
  check(`[${label}] 无未捕获异常`, res.errors.length === 0,
    res.errors.slice(0, 2).map(e => String(e).slice(0, 160)).join(' | '));
}

(async () => {
  await nodeChecks();

  const stableExpr = `
    const out = [];
    const g = window.__game;
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    out.push({ name: '正式版 LEVELS=12', ok: g.LEVELS.length === 12, extra: String(g.LEVELS.length) });

    // 地形挂在 sky 上，不在 scenery 上
    out.push({ name: 'sky.terrain 存在', ok: !!g.sky.terrain });
    out.push({ name: 'scenery.terrain 为 undefined（属性名修正）', ok: g.scenery.terrain === undefined });
    out.push({ name: 'sky.hills / sky.dome 存在', ok: !!g.sky.hills && !!g.sky.dome });

    // Enter 在标题界面能直接开始游戏（历史死代码：先被 isBound 拦掉）
    g.game.mode = 'title';
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Enter' }));
    await sleep(200);
    out.push({ name: '标题界面按 Enter 进入 play', ok: g.game.mode === 'play', extra: g.game.mode });

    // 正式版采食点为浆果、复用不重建
    out.push({ name: '正式版无季节（season=null）', ok: g.game.season === null });
    out.push({ name: '正式版采食点 12 个', ok: g.berries().length === 12 });

    // 血条 fill 句柄存在（所有狐狸）
    const f0 = g.foxesList()[0];
    out.push({ name: '狐狸血条 fill 句柄存在', ok: !!(f0 && f0.hpBar.userData.fill) });

    // 缩放系数稳定版为 1，伙伴点位即配置坐标
    g.loadLevel(0);
    const cfg0 = g.LEVELS[0];
    out.push({ name: '稳定版伙伴点位=配置坐标', ok:
      Math.abs(g.companion.x - cfg0.friend[0]) < 1e-6 && Math.abs(g.companion.z - cfg0.friend[1]) < 1e-6,
      extra: [g.companion.x, g.companion.z].join(',') });
    return out;
  `;

  // 注意：headless + SwiftShader 下进入持续 play 主循环会拖慢事件循环，
  // 而季节/换关/dispose 都在 loadLevel 层即可验证，无需 start 渲染。
  // Enter 断言放最后，派发后只读一次 mode。
  const devExpr = `
    const out = [];
    const g = window.__game;
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    out.push({ name: 'dev 版 isDev=true', ok: g.isDev === true });

    // 季节随真实 loadLevel 变化（旧测试只改 level，五关全是早春）
    g.loadLevel(0); await sleep(30);
    const s0 = g.game.season && g.game.season.season;
    g.loadLevel(4); await sleep(30);
    const s4 = g.game.season && g.game.season.season;
    out.push({ name: '第1关早春 / 第5关冬眠前', ok: s0 === '早春' && s4 === '冬眠前', extra: s0 + ' -> ' + s4 });

    // 换关采食点不泄漏：旧实例必须被 dispose（group 置空），新数组仍为 12
    g.loadLevel(0); await sleep(30);
    const before = g.berries();
    out.push({ name: 'dev 采食点为草本', ok: before[0].herbivore === true && !!before[0].plant });
    g.loadLevel(2); await sleep(30);
    const after = g.berries();
    const oldDisposed = before.every(b => b.group === null);
    out.push({ name: '换关后旧 Food 全部 dispose', ok: oldDisposed });
    out.push({ name: '换关后新采食点仍为 12', ok: after.length === 12, extra: String(after.length) });
    // 连续多换几关，采食点数量不应累积增长
    g.loadLevel(1); await sleep(20); g.loadLevel(3); await sleep(20); g.loadLevel(0); await sleep(30);
    out.push({ name: '多次换关后采食点稳定 12（无累积泄漏）', ok: g.berries().length === 12 });

    // Enter 在标题界面可直接开始（历史死代码）
    g.game.mode = 'title';
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Enter' }));
    out.push({ name: 'dev 标题界面按 Enter 进入 play', ok: g.game.mode === 'play', extra: g.game.mode });
    return out;
  `;

  // 先跑更重的 dev 段：它作为第一个 SwiftShader 实例，__game 就绪后约 1s 即可响应；
  // 若放第二个，前一实例的 GPU 进程残留会让它主线程长时间占满、求值反复超时。
  try {
    const dev = await runBrowser(BASE + '?version=dev', 'dev 版', devExpr,
      { settleMs: 2500, evalTimeoutMs: 45000 });
    report('dev 版', dev);
  } catch (e) {
    console.log('  [dev 版浏览器段执行失败]', e.message);
    check('dev 版浏览器段执行', false, e.message);
  }

  try {
    const stable = await runBrowser(BASE, '正式版', stableExpr);
    report('正式版', stable);
  } catch (e) {
    console.log('  [正式版浏览器段执行失败]', e.message);
    check('正式版浏览器段执行', false, e.message);
  }

  console.log(`\n================ 结论 ================`);
  console.log(failures === 0 ? '全部通过 ✅' : `有 ${failures} 项失败 ❌`);
  process.exit(failures === 0 ? 0 : 1);
})();
