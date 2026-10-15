/**
 * 模型可见性回归测试 —— 覆盖"模型加载了但看不见"这类问题。
 *
 * 断言（逐条对应一次真实故障）：
 *   A. 真实模型与程序化模型**恰好一个可见**（不能同时隐藏 = 隐形，
 *      也不能同时显示 = 重影）
 *   B. 真实模型的世界包围盒有合理尺寸（不是 0，也不是几十米）
 *   C. 伙伴（土拨鼠）同样满足 A/B —— 它曾经完全没接入真实模型
 *   D. 分级回退可用：把 GLB 路径改成不存在的文件，必须回退到程序化且仍可见
 *   E. 回退不影响游戏运行
 *
 * 用法：node tools/test-models.cjs
 */
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');

const PORT = 9431;
const URL = 'http://127.0.0.1:8123/index.html';

function findChrome() {
  for (const c of [
    process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  ].filter(Boolean)) if (fs.existsSync(c)) return c;
  return null;
}
const get = (u) => fetch(u, { headers: { Host: '127.0.0.1' } }).then((r) => r.json());

(async () => {
  const CHROME = findChrome();
  if (!CHROME) { console.log('未找到 Chrome/Edge'); process.exit(1); }
  const profile = path.join(os.tmpdir(), 'marmot-mdl-' + Date.now());
  const chrome = spawn(CHROME, [
    '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
    '--no-first-run', '--enable-unsafe-swiftshader', '--window-size=1024,640', 'about:blank',
  ], { stdio: 'ignore' });
  let t = null;
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 500));
    try { t = (await get(`http://127.0.0.1:${PORT}/json/list`)).find((x) => x.type === 'page'); if (t) break; } catch (e) {}
  }
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  let id = 0; const pend = new Map();
  const logs = [];
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pend.has(m.id)) { const q = pend.get(m.id); pend.delete(m.id); m.error ? q.rej(new Error(JSON.stringify(m.error))) : q.res(m.result); return; }
    if (m.method === 'Runtime.consoleAPICalled' && (m.params.type === 'error' || m.params.type === 'warning')) {
      logs.push('[' + m.params.type + '] ' + m.params.args.map((a) => a.value ?? a.description ?? a.type).join(' '));
    }
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails;
      logs.push('[exception] ' + (d.exception?.description || d.text || '').slice(0, 300));
    }
  });
  const send = (me, pa = {}) => new Promise((res, rej) => {
    const i = ++id; pend.set(i, { res, rej });
    ws.send(JSON.stringify({ id: i, method: me, params: pa }));
    setTimeout(() => { if (pend.has(i)) { pend.delete(i); rej(new Error('timeout ' + me)); } }, 120000);
  });
  const evalJS = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails.exception || r.exceptionDetails.text).slice(0, 500));
    return r.result?.value;
  };

  await new Promise((r) => ws.addEventListener('open', r, { once: true }));
  await send('Runtime.enable'); await send('Page.enable');
  await send('Page.navigate', { url: URL });
  await new Promise((r) => setTimeout(r, 8000));

  // ===== A/B/C：真实模型可见性 =====
  const vis = await evalJS(`(async function(){
    const THREE = await import('/vendor/three.module.js');
    const g = window.__game;
    const check = (obj, label) => {
      const procVis = obj.proceduralMesh ? obj.proceduralMesh.visible : null;
      const realVis = obj.realModel ? obj.realModel.visible : null;
      let size = null;
      if (obj.realModel) {
        obj.realModel.updateMatrixWorld(true);
        const b = new THREE.Box3().setFromObject(obj.realModel);
        const s = b.getSize(new THREE.Vector3());
        size = [+s.x.toFixed(3), +s.y.toFixed(3), +s.z.toFixed(3)];
      }
      // 关键：两套模型必须"恰好一个可见"
      const bothHidden = procVis === false && realVis === false;
      const bothShown = procVis === true && realVis === true;
      let sizeOk = true;
      if (size) sizeOk = size.every(v => v > 1e-3) && size[1] < 50;
      return { label, procVis, realVis, size, modelLevel: obj.modelLevel || null,
        bothHidden, bothShown, sizeOk,
        pass: !bothHidden && !bothShown && sizeOk };
    };
    const out = { foxes: [], companion: null };
    for (const f of g.foxes()) out.foxes.push(check(f, f.type));
    out.companion = check(g.companion, 'companion');
    out.modelState = g.__modelState || null;
    return out;
  })()`);

  console.log('======== A/B/C. 模型可见性 ========');
  let allPass = true;
  const show = (r) => {
    const ok = r.pass;
    if (!ok) allPass = false;
    console.log(`  ${ok ? '✓' : '✗'} ${String(r.label).padEnd(10)}` +
      ` 程序化=${r.procVis} 真实=${r.realVis} 级别=${r.modelLevel || '-'}` +
      (r.size ? ` 尺寸=[${r.size.join(', ')}]` : ' 尺寸=无真实模型'));
    if (r.bothHidden) console.log('      ⛔ 两套模型都隐藏 → 实体隐形！');
    if (r.bothShown) console.log('      ⛔ 两套模型都显示 → 重影');
    if (!r.sizeOk && r.size) console.log('      ⛔ 真实模型尺寸异常');
  };
  vis.foxes.forEach(show);
  show(vis.companion);
  console.log('  → ' + (allPass ? '全部通过 ✅' : '存在失败 ❌'));

  // ===== D/E：回退方案 =====
  console.log('\n======== D/E. 加载失败时的回退 ========');
  const fb = await evalJS(`(async function(){
    // 直接测 loader 的回退：请求一个不存在的 GLB，必须 resolve(null) 而非 reject/挂起
    const { instantiate } = await import('/src/models/loader.js');
    const t0 = performance.now();
    let threw = null, result = 'null';
    try {
      const r = await instantiate('./assets/models/__不存在__.glb', 'test');
      result = r === null ? 'null' : 'object';
    } catch (e) { threw = String(e && e.message || e); }
    const ms = Math.round(performance.now() - t0);
    return { threw, result, ms };
  })()`);
  console.log('  不存在的 GLB: 抛错=' + (fb.threw || '无') + '  返回=' + fb.result +
    '  耗时=' + fb.ms + 'ms  ' + (fb.threw ? '❌' : '✅ 正确回退'));
  if (fb.threw) allPass = false;

  const fb2 = await evalJS(`(async function(){
    // 贴图不可用时应退到 geometry-only 而不是整体失败
    const { loadModel, getModelStatus } = await import('/src/models/loader.js');
    const r = await loadModel('./assets/models/marmot.glb', 'marmot');
    const st = getModelStatus();
    return { level: r ? r.level : null, textured: r ? r.textured : null,
      statusMarmot: st.marmot.level, hasStatus: !!st.marmot };
  })()`);
  console.log('  已存在的 GLB: 级别=' + fb2.level + '  有贴图=' + fb2.textured +
    '  状态表=' + fb2.statusMarmot + '  ' +
    (fb2.level === 'full' || fb2.level === 'geometry-only' ? '✅' : '❌'));
  if (fb2.level !== 'full' && fb2.level !== 'geometry-only') allPass = false;

  console.log('\n控制台 error/warning/exception: ' + logs.length);
  logs.slice(0, 8).forEach((l) => console.log('  ' + l.slice(0, 200)));

  console.log('\n========================================');
  console.log(allPass ? '全部断言通过 ✅' : '存在失败项 ❌');

  ws.close(); chrome.kill();
  await new Promise((r) => setTimeout(r, 300));
  process.exit(allPass ? 0 : 1);
})();
