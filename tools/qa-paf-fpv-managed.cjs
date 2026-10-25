/**
 * 扮演藏狐 FPV + 新模型 · Chrome CDP 实测（beta 通道）。
 *
 * 覆盖：
 *  1) 第三人称 vs 第一人称截图对比；FPV 无糊屏（头部隐藏）；
 *  2) V 键切换 + 触屏视角按钮切换，HUD 标识反馈；
 *  3) FPV 视线解耦（身体转向不动视线）、pitch 夹紧、扑击期间视线锁定；
 *  4) 新狐狸/土拨鼠模型可辨认（截图）；
 *  5) 窄屏移动视口 + 刷新 + 退出重进；
 *  6) 渲染后端检测（WebGL2 / WebGPU / 软件渲染）。
 *
 * Chrome 来源（环境适配）：
 *  - 默认连接已有自动化 Chrome：`PAF_QA_CDP`（缺省 http://127.0.0.1:18800），
 *    通过 Target.createTarget 开独立标签页，测完关闭，不影响其它标签；
 *  - 若该端点不可用则自起 headless Chrome（PAF_QA_CDP=off 强制自起）。
 *
 * 产物：outputs/paf-fpv-k31/*.png + qa-result.json
 * 用法：node tools/qa-paf-fpv-managed.cjs
 */
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'outputs', 'paf-fpv-k31');
const HTTP_PORT = 8377;
const CDP_PORT = 9463;
const BASE = `http://127.0.0.1:${HTTP_PORT}/index.html?version=beta`;
const EXTERNAL = process.env.PAF_QA_CDP === 'off' ? null : (process.env.PAF_QA_CDP || 'http://127.0.0.1:18800');

const results = [];
const record = (name, pass, detail = '') => {
  results.push({ name, pass: !!pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const getJson = (u) => fetch(u).then((r) => r.json());

function findChrome() {
  for (const c of [process.env.CHROME_PATH, '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium'].filter(Boolean)) {
    if (fs.existsSync(c)) return c;
  }
  throw new Error('未找到 Chrome');
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const server = spawn(process.execPath, [path.join(ROOT, 'tools', 'serve.cjs'), String(HTTP_PORT)], { stdio: 'ignore' });
  let chrome = null;
  let browserWs = null;
  let tabTargetId = null;
  const cleanup = async () => {
    try {
      if (browserWs && tabTargetId) {
        const i = ++msgId; browserWs.send(JSON.stringify({ id: i, method: 'Target.closeTarget', params: { targetId: tabTargetId } }));
        await sleep(300);
      }
    } catch {}
    try { browserWs?.close(); } catch {}
    if (tabTargetId && EXTERNAL) { try { await fetch(`${EXTERNAL}/json/close/${tabTargetId}`); } catch {} }
    try { chrome?.kill('SIGKILL'); } catch {}
    try { server.kill('SIGKILL'); } catch {}
  };
  process.on('exit', () => { try { chrome?.kill('SIGKILL'); } catch {} try { server.kill('SIGKILL'); } catch {} });

  // —— 统一 CDP 通道（外部浏览器用 flat session，自起用页面直连） ——
  let msgId = 0;
  const pend = new Map();
  const consoleErrs = [];
  let sessionId = null;
  let rawSend;   // (method, params) => Promise

  const dispatch = (m) => {
    if (m.id && pend.has(m.id)) { const q = pend.get(m.id); pend.delete(m.id); m.error ? q.rej(new Error(JSON.stringify(m.error))) : q.res(m.result); return; }
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      consoleErrs.push(m.params.args.map((a) => a.value ?? a.description ?? a.type).join(' ').slice(0, 300));
    }
  };

  try {
    let useExternal = false;
    if (EXTERNAL) {
      try { await getJson(`${EXTERNAL}/json/version`); useExternal = true; } catch { useExternal = false; }
    }
    if (useExternal) {
      const ver = await getJson(`${EXTERNAL}/json/version`);
      console.log(`CDP：外部 Chrome ${ver.Browser}（${EXTERNAL}，独立标签页，测完关闭）`);
      browserWs = new WebSocket(ver.webSocketDebuggerUrl);
      await new Promise((res, rej) => { browserWs.addEventListener('open', res, { once: true }); browserWs.addEventListener('error', rej, { once: true }); });
      browserWs.addEventListener('message', (ev) => dispatch(JSON.parse(ev.data)));
      rawSend = (method, params = {}) => new Promise((res, rej) => {
        const i = ++msgId; pend.set(i, { res, rej });
        const msg = { id: i, method, params };
        if (sessionId) msg.sessionId = sessionId;
        browserWs.send(JSON.stringify(msg));
        setTimeout(() => { if (pend.has(i)) { pend.delete(i); rej(new Error('timeout ' + method)); } }, 60000);
      });
      const t = await rawSend('Target.createTarget', { url: 'about:blank' });
      tabTargetId = t.targetId;
      // 前置激活：后台标签 rAF 被节流会导致游戏循环停走、键盘转向无效
      await rawSend('Target.activateTarget', { targetId: tabTargetId });
      const a = await rawSend('Target.attachToTarget', { targetId: tabTargetId, flatten: true });
      sessionId = a.sessionId;
    } else {
      console.log('CDP：自起 headless Chrome');
      const profile = path.join(os.tmpdir(), 'paf-fpv-' + Date.now());
      chrome = spawn(findChrome(), [
        '--headless', `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${profile}`,
        '--no-first-run', '--no-default-browser-check', '--enable-unsafe-swiftshader',
        '--window-size=1280,720', 'about:blank',
      ], { stdio: 'ignore' });
      let target = null;
      for (let i = 0; i < 80; i++) {
        await sleep(500);
        try { target = (await getJson(`http://127.0.0.1:${CDP_PORT}/json/list`)).find((x) => x.type === 'page'); if (target) break; } catch {}
      }
      if (!target) throw new Error('CDP 连接失败');
      browserWs = new WebSocket(target.webSocketDebuggerUrl);
      await new Promise((res, rej) => { browserWs.addEventListener('open', res, { once: true }); browserWs.addEventListener('error', rej, { once: true }); });
      browserWs.addEventListener('message', (ev) => dispatch(JSON.parse(ev.data)));
      rawSend = (method, params = {}) => new Promise((res, rej) => {
        const i = ++msgId; pend.set(i, { res, rej });
        browserWs.send(JSON.stringify({ id: i, method, params }));
        setTimeout(() => { if (pend.has(i)) { pend.delete(i); rej(new Error('timeout ' + method)); } }, 60000);
      });
    }

    const send = rawSend;
    // 共享浏览器下其它自动化可能抢前台导致 rAF 节流：关键段落前重新激活本标签
    const reactivate = async () => {
      if (!tabTargetId) return;
      try {
        const i = ++msgId;
        await new Promise((res, rej) => {
          pend.set(i, { res, rej });
          browserWs.send(JSON.stringify({ id: i, method: 'Target.activateTarget', params: { targetId: tabTargetId } }));
          setTimeout(() => { if (pend.has(i)) { pend.delete(i); rej(new Error('timeout activate')); } }, 10000);
        });
      } catch {}
    };
    const trace = (m) => console.log('  … ' + m);
    const evalOnce = async (expr) => {
      const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
      if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails.exception || r.exceptionDetails.text).slice(0, 600));
      return r.result?.value;
    };
    const evalJS = async (expr) => {
      try { return await evalOnce(expr); }
      catch (e) { if (!/timeout/.test(e.message)) throw e; await sleep(2000); return evalOnce(expr); }
    };
    // 轮询直到页面表达式为真（模块加载/主循环启动在共享 GPU 下耗时抖动大）
    const waitFor = async (expr, timeoutMs = 40000, step = 500) => {
      const t0 = Date.now();
      for (;;) {
        try { if (await evalJS(expr)) return true; } catch {}
        if (Date.now() - t0 > timeoutMs) return false;
        await sleep(step);
      }
    };
    const shot = async (name) => {
      const s = await send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(path.join(OUT, name + '.png'), Buffer.from(s.data, 'base64'));
      console.log('  截图 ' + name + '.png');
    };
    const key = (code, type = 'keydown') => evalJS(`document.body.dispatchEvent(new KeyboardEvent('${type}', { code: '${code}', bubbles: true }))`);

    await send('Runtime.enable'); await send('Page.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
    try { await send('Emulation.setFocusEmulationEnabled', { enabled: true }); } catch {}

    // —— 渲染后端检测 ——
    trace('navigate ' + BASE);
    await send('Page.navigate', { url: BASE });
    const booted = await waitFor(`typeof window.__enterPlayAsFox === 'function'`);
    record('页面模块就绪（__enterPlayAsFox）', booted);
    trace('backend probe');
    const backend = await evalJS(`(() => {
      const c = document.querySelector('canvas');
      if (!c) return { backend: 'no-canvas' };
      const gl = c.getContext('webgl2') || c.getContext('webgl');
      if (!gl) return { backend: 'webgpu-or-unknown' };
      let renderer = 'unknown';
      try {
        const ext = gl.getExtension('WEBGL_debug_renderer_info');
        renderer = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
      } catch (e) {}
      return { backend: (typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext) ? 'WebGL2' : 'WebGL1', renderer };
    })()`);
    record('渲染后端检测', !!backend && backend.backend !== 'no-canvas', JSON.stringify(backend));

    // —— 进入扮演藏狐 ——
    trace('enterPlayAsFox');
    await evalJS(`window.__enterPlayAsFox()`);
    await waitFor(`!!window.__playAsFox && window.__playAsFox.active`, 15000);
    record('进入扮演藏狐模式', await evalJS(`!!window.__playAsFox && window.__playAsFox.active`));
    // 主循环活性由后续硬证据推出（共享浏览器前台竞争下单点计时探针不可靠）：
    // 身体转向（update 里的键盘转向）+ 扑击相位推进（update 里的相位机）都只在主循环运行时发生。
    record('默认第三人称', (await evalJS(`window.__playAsFox.viewMode`)) === 'tps');
    await evalJS(`window.__playAsFox.teleport(0, -6, 0)`);
    await sleep(800);
    await shot('01-tps-default');

    // 第三人称冲刺姿态
    await key('ShiftLeft'); await key('KeyW');
    await sleep(1500);
    await shot('02-tps-dash');
    await key('KeyW', 'keyup'); await key('ShiftLeft', 'keyup');
    await sleep(400);

    // —— V 键切 FPV ——
    await key('KeyV');
    await sleep(500);
    record('V 键切到第一人称', (await evalJS(`window.__playAsFox.viewMode`)) === 'fpv');
    const tag1 = await evalJS(`document.querySelector('#pafViewTag')?.textContent`);
    record('HUD 视角标识=第一人称', tag1 === '第一人称', String(tag1));
    const fpvIdle = await evalJS(`window.__playAsFox.fpvVisual`);
    record('FPV 狐狸双前爪与身体 cues 可见', !!(fpvIdle?.visible && fpvIdle.paws?.length === 2 && fpvIdle.paws.every(p => p.y < 0.08)), JSON.stringify(fpvIdle));
    await shot('03-fpv-default');

    await key('KeyW');
    await waitFor(`window.__playAsFox.fpvVisual.pose === 'walk'`, 8000, 150);
    await sleep(250);
    const fpvWalk = await evalJS(`window.__playAsFox.fpvVisual`);
    record('FPV 移动步态响应', fpvWalk?.pose === 'walk'
      && Math.abs(fpvWalk.rootZ - fpvIdle.rootZ) > 0.005
      && fpvWalk.paws.some((p) => Math.abs(p.z) > 0.001), JSON.stringify(fpvWalk));
    await shot('03b-fpv-walk');
    await key('KeyW', 'keyup');
    await sleep(250);

    // FPV 视线解耦：身体转向，视线 yaw 不变
    await reactivate();
    const lookBefore = await evalJS(`window.__playAsFox.look`);
    await key('KeyA');
    await waitFor(`Math.abs(window.__playAsFox.pos.yaw) > 0.5`, 8000, 200);
    await key('KeyA', 'keyup');
    const lookAfter = await evalJS(`window.__playAsFox.look`);
    const posAfter = await evalJS(`window.__playAsFox.pos`);
    record('FPV 视线与身体解耦（转身不动视线）',
      Math.abs(lookAfter.yaw - lookBefore.yaw) < 0.05 && Math.abs(posAfter.yaw) > 0.5,
      `look.yaw ${lookBefore.yaw.toFixed(2)}→${lookAfter.yaw.toFixed(2)}, body.yaw=${posAfter.yaw.toFixed(2)}`);
    await shot('04-fpv-body-turned');

    // pitch 夹紧（QA 钩子超界应被夹）
    const clamped = await evalJS(`(() => { const qa = window.__playAsFox;
      qa.setLook(0, -10); const lo = qa.look.pitch;
      qa.setLook(0, 10); const hi = qa.look.pitch;
      qa.setLook(0, -0.1);
      return { lo, hi, min: qa.cfg.fpvPitchMin * Math.PI / 180, max: qa.cfg.fpvPitchMax * Math.PI / 180 }; })()`);
    record('FPV pitch 夹紧', Math.abs(clamped.lo - clamped.min) < 1e-6 && Math.abs(clamped.hi - clamped.max) < 1e-6, JSON.stringify(clamped));

    // 低头看自身躯干（FPV 遮挡处理）
    await evalJS(`window.__playAsFox.setLook(${posAfter.yaw}, -0.9)`);
    await sleep(400);
    await shot('05-fpv-look-down');

    // 扑击：FPV 下视线连续、无 NaN
    await reactivate();
    await evalJS(`window.__playAsFox.setLook(${posAfter.yaw}, -0.1)`);
    const pounceProbe = await evalJS(`(async () => { const qa = window.__playAsFox;
      return await new Promise((done) => {
        const ys = [];
        document.body.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', bubbles: true }));
        const t0 = qa.elapsed;
        const t = setInterval(() => {
          ys.push({ phase: qa.phase, y: qa.pos.y, lookPitch: qa.look.pitch });
          // 以游戏内时间为准（rAF 被节流时 wall clock 不可靠）
          if (qa.elapsed - t0 > 1.6 || qa.elapsed - t0 > 0.3 && qa.phase === 'recover') { clearInterval(t); done(ys); }
        }, 30);
        setTimeout(() => { clearInterval(t); done(ys); }, 20000);
      }); })()`);
    const camOk = pounceProbe.length > 10 && pounceProbe.every((p) => Number.isFinite(p.lookPitch) && Number.isFinite(p.y));
    const phases = [...new Set(pounceProbe.map((p) => p.phase))];
    record('FPV 扑击过程视线连续（无 NaN）', camOk, `samples=${pounceProbe.length} phases=${phases.join('/')}`);
    record('扑击相位完整推进（wind→lunge→recover）', phases.includes('wind') && phases.includes('lunge'), phases.join('/'));
    record('主循环运行（转向+相位推进推出）',
      phases.includes('lunge') && Math.abs(posAfter.yaw) > 0.5,
      `body.yaw=${posAfter.yaw.toFixed(2)}, phases=${phases.join('/')}`);
    await shot('06-fpv-after-pounce');

    // A second pounce provides actual action-frame visual evidence.
    // Extend only this QA-staged pounce so CDP readback cannot miss a phase;
    // production defaults and the preceding contract probe remain unchanged.
    await evalJS(`(() => { const c = window.__playAsFox.cfg;
      window.__pafQaTiming = { windTime: c.windTime, lungeTime: c.lungeTime };
      c.windTime = 1.2; c.lungeTime = 1.2; })()`);
    await key('Space');
    await waitFor(`window.__playAsFox.phase === 'wind'`, 5000, 30);
    await shot('06a-fpv-wind');
    await waitFor(`window.__playAsFox.phase === 'lunge'`, 5000, 30);
    await shot('06b-fpv-lunge');
    await evalJS(`Object.assign(window.__playAsFox.cfg, window.__pafQaTiming)`);
    await waitFor(`window.__playAsFox.phase === 'idle'`, 12000, 200);

    // V 键切回第三人称
    await key('KeyV');
    await sleep(600);
    record('V 键切回第三人称', (await evalJS(`window.__playAsFox.viewMode`)) === 'tps');
    const tag2 = await evalJS(`document.querySelector('#pafViewTag')?.textContent`);
    record('HUD 视角标识=第三人称', tag2 === '第三人称', String(tag2));
    await shot('07-back-to-tps');

    // —— 土拨鼠近景 ——
    const preyInfo = await evalJS(`(() => { const qa = window.__playAsFox;
      const p = qa.prey.find((p) => !p.caught);
      if (!p) return null;
      const bx = p.x - Math.sin(p.yaw) * 1.6, bz = p.z - Math.cos(p.yaw) * 1.6;
      qa.teleport(bx, bz, Math.atan2(p.x - bx, p.z - bz));
      return { x: p.x, z: p.z }; })()`);
    record('找到猎物用于近景', !!preyInfo);
    await sleep(200);
    await shot('08-marmot-closeup-tps');

    // —— 窄屏 + 触屏仿真（刷新页面） ——
    await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    await send('Emulation.setDeviceMetricsOverride', { width: 420, height: 800, deviceScaleFactor: 2, mobile: true });
    await send('Page.navigate', { url: BASE });
    await waitFor(`typeof window.__enterPlayAsFox === 'function'`);
    await evalJS(`window.__enterPlayAsFox()`);
    await waitFor(`!!window.__playAsFox && window.__playAsFox.active`, 15000);
    await reactivate();
    const touchUi = await evalJS(`(() => {
      const hud = document.querySelector('#playAsFoxHud');
      const btn = document.querySelector('#pafView');
      return { touchClass: hud?.classList.contains('paf-touch'), hasBtn: !!btn,
        btnVisible: btn ? btn.getBoundingClientRect().width > 0 : false };
    })()`);
    record('窄屏触屏 HUD（视角按钮可见）', !!(touchUi.touchClass && touchUi.hasBtn && touchUi.btnVisible), JSON.stringify(touchUi));
    await shot('09-narrow-touch-tps');
    await evalJS(`document.querySelector('#pafView').click()`);
    await sleep(500);
    record('触屏视角按钮切到 FPV', (await evalJS(`window.__playAsFox.viewMode`)) === 'fpv');
    const btnOn = await evalJS(`document.querySelector('#pafView').classList.contains('paf-on')`);
    record('触屏按钮高亮反馈', btnOn === true);
    await shot('10-narrow-touch-fpv');
    const narrowFpv = await evalJS(`window.__playAsFox.fpvVisual`);
    record('窄屏 FPV 双爪仍启用且处于下缘', !!(narrowFpv?.visible && narrowFpv.paws.every(p => p.y < 0.08)), JSON.stringify(narrowFpv));
    await evalJS(`document.querySelector('#pafView').click()`);
    await sleep(400);
    record('触屏按钮切回第三人称', (await evalJS(`window.__playAsFox.viewMode`)) === 'tps');

    // —— 退出重进 ——
    await key('Escape');
    await sleep(800);
    record('Esc 退出模式', (await evalJS(`window.__playAsFox`)) === null);
    await evalJS(`window.__enterPlayAsFox()`);
    await waitFor(`!!window.__playAsFox && window.__playAsFox.active`, 15000);
    const re = await evalJS(`window.__playAsFox && window.__playAsFox.active && window.__playAsFox.viewMode`);
    record('退出后重进且视角复位第三人称', re === 'tps', String(re));
    await shot('11-reenter-tps');

    // Isolated closeups make model-only silhouette/fur/paw changes reviewable.
    await send('Emulation.setTouchEmulationEnabled', { enabled: false });
    await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
    await send('Page.navigate', { url: `http://127.0.0.1:${HTTP_PORT}/outputs/paf-fpv-k31/model-viewer.html` });
    await waitFor(`window.__ready === true`, 20000);
    await sleep(500);
    await shot('12-models-front');
    await evalJS(`window.__set({ camYaw: 1.25, camDist: 2.7 })`);
    await sleep(350);
    await shot('13-models-side');
    await evalJS(`window.__set({ camYaw: 0.15, camDist: 2.4, moleState: 'alert', foxAnim: 'wind' })`);
    await sleep(600);
    await shot('14-models-alert-wind');

    const realErrs = consoleErrs.filter((e) => !/favicon|404/.test(e));
    record('无控制台错误', realErrs.length === 0, realErrs.slice(0, 3).join(' | '));

    const summary = { backend, pass: results.filter((r) => r.pass).length, fail: results.filter((r) => !r.pass).length, results };
    fs.writeFileSync(path.join(OUT, 'qa-result.json'), JSON.stringify(summary, null, 2));
    console.log(`\n合计：${summary.pass} 通过 / ${summary.fail} 失败`);
    console.log('渲染后端：' + JSON.stringify(backend));
    process.exitCode = summary.fail ? 1 : 0;
  } catch (e) {
    console.error('QA 失败：', e.message);
    process.exitCode = 1;
  } finally {
    await cleanup();
  }
})();
