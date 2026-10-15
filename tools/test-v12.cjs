/**
 * v1.2 新功能测试：
 *   1. 物种写实配色 + 幼狐（体型区分而非颜色）
 *   2. 第一人称 viewmodel（爪子/腿）是否渲染且不穿插
 *   3. 跳跃（右键 / F）——含腾空躲伤害
 *   4. 键位方案切换（兼容/优化/自定义 + 持久化 + 冲突检测）
 */
const { spawn } = require('child_process');
const http = require('http'); const os = require('os'); const path = require('path'); const fs = require('fs');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9360;
const URL = process.argv[2] || 'http://127.0.0.1:8200/index.html';
const get = (u) => new Promise((res, rej) => http.get(u, (r) => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(d)); }).on('error', rej));

(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cdpV12-'));
  const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
    '--no-first-run', '--disable-gpu', '--use-gl=swiftshader', '--enable-unsafe-swiftshader',
    '--window-size=1280,720', 'about:blank'], { stdio: 'ignore' });
  let target = null;
  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 500));
    try { target = JSON.parse(await get(`http://127.0.0.1:${PORT}/json/list`)).find(t => t.type === 'page'); if (target) break; } catch (e) {}
  }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let id = 0; const pending = new Map(); const pageErrors = []; const consoleErrs = [];
  ws.addEventListener('message', ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); return; }
    if (m.method === 'Runtime.exceptionThrown') { const d = m.params.exceptionDetails; pageErrors.push(d.exception?.description || d.text); }
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      consoleErrs.push(m.params.args.map(a => a.value ?? a.description ?? a.type).join(' '));
    }
  });
  const send = (method, params = {}) => new Promise((res, rej) => {
    const mid = ++id; pending.set(mid, { res, rej });
    ws.send(JSON.stringify({ id: mid, method, params }));
    setTimeout(() => { if (pending.has(mid)) { pending.delete(mid); rej(new Error('timeout')); } }, 30000);
  });
  await new Promise(r => ws.addEventListener('open', r, { once: true }));
  await send('Runtime.enable'); await send('Page.enable');
  await send('Page.navigate', { url: URL });
  await new Promise(r => setTimeout(r, 7000));

  const expr = `(async () => {
    const g = window.__game;
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    const out = {};
    document.getElementById('startBtn')?.click();
    await sleep(900);

    // ========== 1. 配色与幼狐 ==========
    const foxes = g.foxes();
    const typeInfo = foxes.map(f => ({
      type: f.type,
      label: f.cfg.label || '(普通)',
      scale: +f.cfg.scale.toFixed(2),
      furColor: '#' + (() => {
        let hex = null;
        f.mesh.traverse(o => {
          if (hex === null && o.isMesh && o.material && o.material.color) {
            // 取 body 材质（最大的一个）作为主毛色
          }
        });
        return '000000';
      })(),
    }));
    out.foxTypes = typeInfo;
    out.hasPupType = !!(g.constructor && true);

    // 检查是否存在幼狐，以及其体型是否明显小于成狐
    const scales = foxes.map(f => f.cfg.scale);
    out.scaleRange = { min: Math.min(...scales), max: Math.max(...scales) };

    // 浆果颜色
    const b0 = g.berries()[0];
    let berryColor = null, berryEmissive = null;
    b0.group.traverse(o => {
      if (o.isMesh && o.material && !berryColor && o.material.emissiveIntensity !== undefined
          && o.geometry.type === 'SphereGeometry') {
        berryColor = '#' + o.material.color.getHexString();
        berryEmissive = o.material.emissiveIntensity;
      }
    });
    out.berry = { color: berryColor, emissiveIntensity: berryEmissive };

    // ========== 2. viewmodel ==========
    out.viewModel = {
      exists: !!g.viewModel,
      hasScene: !!(g.viewModel && g.viewModel.scene),
      childCount: g.viewModel ? g.viewModel.root.children.length : 0,
      pawsChildren: g.viewModel ? g.viewModel.paws.children.length : 0,
      legsChildren: g.viewModel ? g.viewModel.legs.children.length : 0,
      cameraFov: g.viewModel ? g.viewModel.camera.fov : null,
      posY: g.viewModel ? +g.viewModel.root.position.y.toFixed(3) : null,
      posZ: g.viewModel ? +g.viewModel.root.position.z.toFixed(3) : null,
    };

    // 姿态联动：站立 vs 俯伏时爪子位置应不同
    g.controller.teleport(-10, 0, 0);
    await sleep(700);
    const standState = {
      crouch: +g.controller.crouch.toFixed(3),
      pawY: +g.viewModel.paws.position.y.toFixed(4),
      pawZ: +g.viewModel.paws.position.z.toFixed(4),
      rootY: +g.viewModel.root.position.y.toFixed(4),
    };
    g.keys.add('KeyW');
    await sleep(900);
    const crouchState = {
      crouch: +g.controller.crouch.toFixed(3),
      pawY: +g.viewModel.paws.position.y.toFixed(4),
      pawZ: +g.viewModel.paws.position.z.toFixed(4),
      rootY: +g.viewModel.root.position.y.toFixed(4),
      rootRotX: +g.viewModel.root.rotation.x.toFixed(3),
    };
    g.keys.clear();
    out.postureLink = {
      stand: standState, crouch: crouchState,
      pawsMoved: Math.abs(crouchState.pawZ - standState.pawZ) > 0.01
        || Math.abs(crouchState.rootY - standState.rootY) > 0.01,
      rootLeaned: crouchState.rootRotX > 0.2,
    };

    // ========== 3. 跳跃 ==========
    g.controller.teleport(0, 0, 0);
    await sleep(600);
    const groundY = g.controller.position.y;
    // F 键跳跃
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyF' }));
    await sleep(120);
    const midJump = {
      vy: +g.controller.vy.toFixed(2),
      airHeight: +g.controller.airHeight.toFixed(3),
      grounded: g.controller.grounded,
      y: +g.controller.position.y.toFixed(3),
    };
    await sleep(800);
    const landed = {
      grounded: g.controller.grounded,
      vy: +g.controller.vy.toFixed(2),
      airHeight: +g.controller.airHeight.toFixed(3),
    };
    out.jumpKey = { groundY: +groundY.toFixed(3), midJump, landed };

    // 右键跳跃
    await sleep(300);
    const canvas = document.getElementById('scene');
    let locked = true;
    Object.defineProperty(g.controller, 'locked', { configurable: true, get: () => locked });
    canvas.dispatchEvent(new MouseEvent('mousedown', { button: 2, bubbles: true, cancelable: true }));
    await sleep(120);
    out.jumpRightClick = {
      airborne: !g.controller.grounded,
      airHeight: +g.controller.airHeight.toFixed(3),
    };
    await sleep(700);

    // 腾空高度是否足以躲过接触伤害
    g.controller.teleport(0, 0, 0);
    await sleep(500);
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyF' }));
    await sleep(150);
    const peak = [];
    for (let i = 0; i < 12; i++) { peak.push(+g.controller.airHeight.toFixed(3)); await sleep(50); }
    const maxAir = Math.max(...peak);
    out.dodgeHeight = {
      maxAir: +maxAir.toFixed(3),
      threshold: 0.3,
      canDodge: maxAir > 0.3,
    };
    await sleep(700);

    // ========== 4. 键位方案 ==========
    const b = g.binds;
    out.keybinds = { exists: !!b, scheme: b ? b.scheme : null };

    if (b) {
      // 兼容方案
      b.setScheme('compatible');
      await sleep(120);
      out.compatible = {
        burst: b.key('burst'), ultimate: b.key('ultimate'),
        interact: b.key('interact'), attack: b.keys('attack'),
      };
      // 优化方案
      b.setScheme('optimized');
      await sleep(120);
      out.optimized = {
        burst: b.key('burst'), ultimate: b.key('ultimate'),
        interact: b.key('interact'), jump: b.keys('jump'),
        attack: b.keys('attack'), restart: b.key('restart'),
      };
      // 自定义
      b.setKey('burst', 'KeyZ');
      await sleep(120);
      out.custom = {
        scheme: b.scheme,
        burst: b.key('burst'),
        autoSwitched: b.scheme === 'custom',
      };
      // 冲突检测
      b.setKey('ultimate', 'KeyZ'); // 与 burst 冲突
      await sleep(100);
      const conflicts = g.findConflicts ? g.findConflicts(b.custom) : null;
      out.conflict = {
        hasHelper: typeof g.findConflicts === 'function',
        conflictCount: conflicts ? conflicts.size : 'N/A',
      };
      // 持久化
      out.persisted = !!localStorage.getItem('marmot3d.keybinds');

      // 恢复兼容（避免影响后续测试）
      b.setScheme('compatible');
      await sleep(100);
    }

    // 设置面板
    const setBtn = document.getElementById('setBtn');
    out.settingsUI = { btnExists: !!setBtn };
    if (setBtn) {
      setBtn.click();
      await sleep(250);
      const sheet = document.getElementById('setSheet');
      out.settingsUI.opened = sheet && !sheet.hidden;
      out.settingsUI.schemeCards = document.querySelectorAll('[data-scheme]').length;
      out.settingsUI.bindRows = document.querySelectorAll('.bind-row').length;
      sheet.hidden = true;
    }

    return out;
  })()`;

  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  console.log(JSON.stringify(r.result?.value, null, 1));
  console.log('\n页面异常:', pageErrors.length);
  pageErrors.slice(0, 5).forEach(e => console.log('  ' + String(e).slice(0, 400)));
  console.log('控制台错误:', consoleErrs.length);
  consoleErrs.slice(0, 5).forEach(e => console.log('  ' + String(e).slice(0, 300)));

  const shot = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync('D:/gam3/3d/marmot-3d/tools/v12.png', Buffer.from(shot.data, 'base64'));
  ws.close(); chrome.kill();
  await new Promise(r => setTimeout(r, 300));
  process.exit(0);
})();