const { spawn } = require('child_process');
const http = require('http');
const os = require('os');
const path = require('path');
const fs = require('fs');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9483;
const URL = process.argv[2] || 'http://127.0.0.1:8200/index.html?version=dev';

function get(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cdpFoxTypes-'));
  const chrome = spawn(CHROME, [
    '--headless=new', `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`, '--no-first-run', '--disable-gpu',
    '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--window-size=1280,800',
    'about:blank',
  ], { stdio: 'ignore' });
  let target;
  for (let i = 0; i < 60; i++) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    try {
      target = JSON.parse(await get(`http://127.0.0.1:${PORT}/json/list`))
        .find((item) => item.type === 'page');
      if (target) break;
    } catch (_) {}
  }
  if (!target) throw new Error('Chrome debug page unavailable');

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let seq = 0;
  const pending = new Map();
  const pageErrors = [];
  ws.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const item = pending.get(message.id);
      pending.delete(message.id);
      message.error ? item.reject(new Error(JSON.stringify(message.error))) : item.resolve(message.result);
      return;
    }
    if (message.method === 'Runtime.exceptionThrown') {
      pageErrors.push(message.params.exceptionDetails.exception?.description || message.params.text);
    }
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error(`CDP timeout: ${method}`));
      }
    }, 120000);
  });
  const evaluate = async (expression) => {
    const result = await send('Runtime.evaluate', {
      expression, returnByValue: true, awaitPromise: true,
    });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'browser evaluation failed');
    return result.result.value;
  };

  await new Promise((resolve) => ws.addEventListener('open', resolve, { once: true }));
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Page.navigate', { url: URL });
  let ready = false;
  for (let i = 0; i < 90; i++) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    try {
      if (await evaluate('!!window.__game?.FoxClass')) { ready = true; break; }
    } catch (_) {}
  }
  if (!ready) throw new Error('Fox constructor test hook unavailable');

  const result = await evaluate(`(async () => {
    const g = window.__game;
    const THREE = await import('/vendor/three.module.js');
    const types = ['normal', 'pup', 'fast', 'heavy', 'boss'];
    const scene = new THREE.Scene();
    const foxes = types.map((type, index) =>
      new g.FoxClass(scene, index * 3, 0, type, 5, index));
    const initialFallbackVisible = foxes.every((fox) => fox.proceduralMesh.visible);
    await new Promise((resolve) => setTimeout(resolve, 18000));
    const rows = foxes.map((fox) => {
      fox._applyTransform(1 / 60, () => 0);
      fox._updateHpBar();
      fox.mesh.updateMatrixWorld(true);
      const visibleModel = fox.realModel?.visible ? fox.realModel : fox.proceduralMesh;
      const box = new THREE.Box3().setFromObject(visibleModel);
      const size = box.getSize(new THREE.Vector3());
      return {
        type: fox.type,
        modelLevel: fox.modelLevel,
        procVisible: fox.proceduralMesh.visible,
        realPresent: !!fox.realModel,
        realVisible: !!fox.realModel?.visible,
        hasMesh: fox.proceduralMesh.children.some((child) => child.isMesh)
          || !!fox.realModel?.getObjectByProperty('isMesh', true),
        size: [size.x, size.y, size.z].map((value) => +value.toFixed(3)),
        label: fox.labelSprite?.userData?.labelText || '',
        labelVisible: fox.labelSprite.visible,
        labelParentIsScene: fox.labelSprite.parent === scene,
        labelY: +fox.labelSprite.position.y.toFixed(3),
        expectedLabelY: +(0.92 * 1.05 * fox.cfg.scale + 0.28).toFixed(3),
        typeScale: fox.cfg.scale,
      };
    });
    foxes.forEach((fox) => fox.dispose(scene));
    return { initialFallbackVisible, rows };
  })()`);

  console.log('fallback visible during async model load:', result.initialFallbackVisible);
  let failed = !result.initialFallbackVisible;
  for (const row of result.rows) {
    const visible = row.procVisible !== row.realVisible;
    const sizeOk = row.size.every((value) => value > 0.001 && Number.isFinite(value));
    const labelOk = row.label && row.labelVisible && row.labelParentIsScene
      && row.labelY >= row.expectedLabelY - 0.04;
    const ok = visible && row.hasMesh && sizeOk && labelOk;
    console.log(`${ok ? 'PASS' : 'FAIL'} ${row.type}: level=${row.modelLevel}, proc=${row.procVisible}, real=${row.realVisible}, size=${row.size.join('x')}, label=${row.label || '(empty)'}`);
    if (!ok) failed = true;
  }
  console.log('uncaught page exceptions:', pageErrors.length);
  pageErrors.slice(0, 5).forEach((error) => console.log('  ' + String(error).slice(0, 250)));
  ws.close();
  spawn('taskkill', ['/PID', String(chrome.pid), '/T', '/F'], {
    stdio: 'ignore', windowsHide: true,
  });
  process.exitCode = failed || pageErrors.length ? 1 : 0;
})().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
