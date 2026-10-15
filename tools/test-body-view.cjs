/**
 * 第一人称身体视野回归 —— 验证低头能看到腹部与脚，而不是手/腿锁死在准星下。
 *
 * 断言：
 *   A. 低头（pitch≈-0.8）时腹部与后脚进入视野，且位于画面中下部
 *   B. 抬头（pitch≈+0.5）时身体整体下沉出画面下缘（不再遮挡前方）
 *   C. 平视时爪子仍在画面下缘可见（保留 FPS viewmodel 的基本构图）
 *   D. 三个俯仰角下腹部 NDC 位置必须各不相同（不能恒定贴屏）
 *   E. 腹部是真实存在的可见网格（不只改了相机参数）
 *
 * 用法：node tools/test-body-view.cjs [url]
 */
const { spawn } = require('child_process');
const http = require('http');
const os = require('os');
const path = require('path');
const fs = require('fs');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9491;
const URL = process.argv[2] || 'http://127.0.0.1:8200/index.html';

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
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cdpBody-'));
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
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'evaluate failed');
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
      if (await evaluate('!!window.__game?.viewModel')) { ready = true; break; }
    } catch (_) {}
  }
  if (!ready) throw new Error('viewModel not ready');

  const result = await evaluate(`(async () => {
    const g = window.__game;
    const THREE = await import('/vendor/three.module.js');
    const vm = g.viewModel;
    const hasBelly = !!vm.belly;
    const bellyMeshes = hasBelly
      ? (() => { let n = 0; vm.belly.traverse((o) => { if (o.isMesh) n++; }); return n; })()
      : 0;

    // 用 viewmodel 自己的相机做投影（viewmodel 在独立场景里渲染）
    const ndcOf = (obj) => {
      obj.updateWorldMatrix(true, false);
      const v = new THREE.Vector3();
      v.setFromMatrixPosition(obj.matrixWorld);
      const p = v.clone().project(vm.camera);
      return { x: +p.x.toFixed(3), y: +p.y.toFixed(3), z: +p.z.toFixed(3),
        onScreen: p.z < 1 && Math.abs(p.x) <= 1 && Math.abs(p.y) <= 1 };
    };
    // 用几何中心而不是节点原点，避免 group 原点落在体外
    const centerOf = (obj) => {
      const box = new THREE.Box3().setFromObject(obj);
      const c = box.getCenter(new THREE.Vector3());
      const p = c.clone().project(vm.camera);
      return { x: +p.x.toFixed(3), y: +p.y.toFixed(3), z: +p.z.toFixed(3),
        onScreen: p.z < 1 && Math.abs(p.x) <= 1 && Math.abs(p.y) <= 1,
        sizeY: +box.getSize(new THREE.Vector3()).y.toFixed(3) };
    };

    const pose = async (pitch, crouch) => {
      // 连续多帧，让 lookPitch 平滑到目标，避免读到过渡值
      for (let i = 0; i < 40; i++) {
        vm.update(1 / 60, crouch, 0, false, -1, pitch);
        await new Promise((r) => setTimeout(r, 4));
      }
      vm.camera.updateMatrixWorld(true);
      vm.scene.updateMatrixWorld(true);
      return {
        pitch,
        crouch,
        cameraPitch: +vm.camera.rotation.x.toFixed(3),
        belly: hasBelly ? centerOf(vm.belly) : null,
        leg: centerOf(vm.legs.userData.left),
        paw: centerOf(vm.paws.userData.left),
      };
    };

    return {
      hasBelly,
      bellyMeshes,
      lookingDown: await pose(-0.85, 0.1),
      level: await pose(0, 0),
      lookingUp: await pose(0.55, 0),
      running: await pose(-0.5, 1),
    };
  })()`);

  const fmt = (label, pose) => {
    const b = pose.belly ? `belly=(${b.label || ''}${''})` : '';
    const line = ['  ' + label.padEnd(14),
      'camPitch=' + String(pose.cameraPitch).padStart(7),
      'belly=' + (pose.belly ? `(${pose.belly.x}, ${pose.belly.y}) on=${pose.belly.onScreen}` : '缺失'),
      'leg=' + `(${pose.leg.x}, ${pose.leg.y}) on=${pose.leg.onScreen}`,
      'paw=' + `(${pose.paw.x}, ${pose.paw.y}) on=${pose.paw.onScreen}`];
    return line.join(' ');
  };

  console.log('belly present:', result.hasBelly, ' meshes:', result.bellyMeshes);
  console.log(fmt('lookingDown', result.lookingDown));
  console.log(fmt('level', result.level));
  console.log(fmt('lookingUp', result.lookingUp));
  console.log(fmt('running', result.running));

  const checks = [];
  const check = (name, ok, extra = '') => checks.push({ name, ok: !!ok, extra });

  check('A. 腹部网格存在且有可见面', result.hasBelly && result.bellyMeshes >= 1,
    `meshes=${result.bellyMeshes}`);
  check('A. 低头时腹部在视野中下部',
    result.lookingDown.belly?.onScreen && result.lookingDown.belly.y < 0.35,
    `ndc.y=${result.lookingDown.belly?.y}`);
  check('A. 低头时后脚在视野内',
    result.lookingDown.leg.onScreen, `ndc=(${result.lookingDown.leg.x}, ${result.lookingDown.leg.y})`);
  check('A. 低头时前爪仍在视野内', result.lookingDown.paw.onScreen);

  check('B. 抬头时身体沉出画面（腹部离屏或明显下移）',
    !result.lookingUp.belly.onScreen || result.lookingUp.belly.y < result.level.belly.y - 0.08,
    `up=${result.lookingUp.belly.y} level=${result.level.belly.y}`);
  check('B. 抬头时相机确实上仰', result.lookingUp.cameraPitch > 0.05,
    `camPitch=${result.lookingUp.cameraPitch}`);
  check('B. 低头时相机确实下俯', result.lookingDown.cameraPitch < -0.05,
    `camPitch=${result.lookingDown.cameraPitch}`);

  check('C. 平视时爪子仍可见', result.level.paw.onScreen,
    `ndc=(${result.level.paw.x}, ${result.level.paw.y})`);

  const spread = Math.abs(result.lookingDown.belly.y - result.lookingUp.belly.y);
  check('D. 腹部投影随俯仰变化（未锁死贴屏）', spread > 0.15, `Δy=${spread.toFixed(3)}`);

  check('E. 俯伏奔跑时腹部与脚仍可见',
    result.running.belly?.onScreen && result.running.leg.onScreen);

  let failed = 0;
  for (const c of checks) {
    if (!c.ok) failed++;
    console.log(`${c.ok ? 'PASS' : 'FAIL'} ${c.name}${c.extra ? '  — ' + c.extra : ''}`);
  }
  console.log('uncaught page exceptions:', pageErrors.length);
  pageErrors.slice(0, 5).forEach((e) => console.log('  ' + String(e).slice(0, 240)));
  ws.close();
  spawn('taskkill', ['/PID', String(chrome.pid), '/T', '/F'], {
    stdio: 'ignore', windowsHide: true,
  });
  process.exitCode = failed || pageErrors.length ? 1 : 0;
})().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
