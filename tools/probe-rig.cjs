/**
 * 绑定角色探针（rig probe）—— 用真 three.js 实测 GLB 的骨骼/动画/占位/朝向。
 *
 * 为什么必须用真渲染器实测：
 *   手写蒙皮矩阵（jointWorld × inverseBind）算出的包围盒与渲染器实际
 *   加载结果对不上（root 节点的旋转四元数、Blender 的 Y-up 约定、
 *   inverseBind 的绑定姿态基准都会影响结果），实测数字才可信。
 *
 * 用法：
 *   node tools/probe-rig.cjs [model]            # 默认 assets/models/marmot-rig.glb
 *   node tools/probe-rig.cjs --clips             # 逐个 clip 采样 + 截图
 *
 * 输出：JSON（骨架/动画/posed 包围盒/关节世界坐标）+ outputs/rig-probe/*.png
 */
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');

const PORT = 9493;
const SERVER_PORT = 8213;
// 复用已运行的 Chrome CDP（这台机器上直启 Chrome 不稳）；
// 用 CDP_PORT 环境变量指定，未指定则自己拉一个。
const CDP_PORT = Number(process.env.CDP_PORT || 0);
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'outputs', 'rig-probe');

const argv = process.argv.slice(2);
const wantClips = argv.includes('--clips');
// --views: 从 4 个水平方位角 + 侧面渲染同一姿态，用于和参照模型对比朝向/骨架轴
const wantViews = argv.includes('--views');
const viewClip = (argv.find((a) => a.startsWith('--viewclip=')) || '').split('=')[1] || '';
const modelArg = argv.find((a) => !a.startsWith('--')) || './assets/models/marmot-rig.glb';
const MODEL = modelArg.startsWith('/') ? modelArg
  : (modelArg.startsWith('.') ? modelArg.replace(/^\.\//, '/') : '/assets/models/' + modelArg);
// 缓存击穿：同一 Chrome 实例里探针页会复用旧 GLB 缓存（材质尺寸与 clip 切换都测不准）
const MODEL_URL = MODEL + (MODEL.includes('?') ? '&' : '?') + 'cb=' + Date.now();

function findChrome() {
  for (const c of [
    process.env.CHROME_PATH,
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
  ].filter(Boolean)) if (fs.existsSync(c)) return c;
  return null;
}

function getJSON(url) {
  return fetch(url).then((r) => r.json());
}

(async () => {
  const CHROME = findChrome();
  if (!CHROME) { console.error('未找到 Chrome'); process.exit(1); }
  fs.mkdirSync(OUT, { recursive: true });

  // 静态服务器
  const server = spawn('node', [path.join(ROOT, 'tools', 'serve.cjs'), String(SERVER_PORT)], {
    cwd: ROOT, stdio: 'ignore',
  });
  await new Promise((r) => setTimeout(r, 900));

  let chrome = null;
  const cdpPort = CDP_PORT || PORT;
  if (!CDP_PORT) {
    const profile = path.join(os.tmpdir(), 'marmot-rig-' + Date.now());
    chrome = spawn(CHROME, [
      '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
      '--no-first-run', '--no-sandbox', '--enable-unsafe-swiftshader',
      '--window-size=900,640', 'about:blank',
    ], { stdio: 'ignore' });
  }

  let target = null;
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 500));
    try {
      const list = await getJSON(`http://127.0.0.1:${cdpPort}/json/list`);
      target = list.find((x) => x.type === 'page' && !x.url.startsWith('devtools://'));
      if (target) break;
    } catch (e) { /* 等 Chrome 起来 */ }
  }
  if (!target) { console.error('Chrome 未就绪'); server.kill(); if (chrome) chrome.kill(); process.exit(1); }

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let id = 0;
  const pend = new Map();
  const logs = [];
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pend.has(m.id)) {
      const q = pend.get(m.id); pend.delete(m.id);
      m.error ? q.rej(new Error(JSON.stringify(m.error))) : q.res(m.result);
      return;
    }
    if (m.method === 'Runtime.consoleAPICalled' && (m.params.type === 'error' || m.params.type === 'warning')) {
      logs.push('[' + m.params.type + '] ' + m.params.args.map((a) => a.value ?? a.description ?? a.type).join(' '));
    }
  });
  const send = (method, params = {}) => new Promise((res, rej) => {
    const i = ++id; pend.set(i, { res, rej });
    ws.send(JSON.stringify({ id: i, method, params }));
    setTimeout(() => { if (pend.has(i)) { pend.delete(i); rej(new Error('timeout ' + method)); } }, 120000);
  });
  const evalJS = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails.exception || r.exceptionDetails.text).slice(0, 500));
    return r.result?.value;
  };

  await new Promise((r) => ws.addEventListener('open', r, { once: true }));
  await send('Runtime.enable');
  await send('Page.enable');

  const FLAT = process.env.PROBE_FLAT === '1' ? '&mat=flat' : '';
  const url = `http://127.0.0.1:${SERVER_PORT}/tools/probe-rig.html?model=${encodeURIComponent(MODEL_URL)}${FLAT}`;
  // **必须复用已连接的 target**：新建标签后若仍用原 ws 的 send()，所有求值都会
  // 打在旧页面上（表现为"换了模型参数但加载的还是上一个模型"）。
  // MODEL_URL 已带 cb= 时间戳破缓存，这里直接 navigate 当前 target 即可。
  await send('Page.navigate', { url });
  // 轮询等探针就绪（8MB 模型 + WebGL 编译，固定 sleep 不可靠）
  let probe = null;
  for (let i = 0; i < 80; i++) {
    await new Promise((r) => setTimeout(r, 500));
    try {
      const raw = await evalJS('window.__probe ? JSON.stringify(window.__probe) : ""');
      if (raw) { probe = raw; break; }
    } catch (e) { /* 页面还在导航 */ }
  }
  const data = probe ? JSON.parse(probe) : { ready: false, error: '探针未就绪（超时）' };
  if (!data.ready) {
    console.error('探针失败: ' + (data.error || 'unknown'));
    console.error('控制台: ' + logs.slice(0, 8).join('\n  '));
    ws.close(); if (chrome) chrome.kill(); server.kill();
    process.exit(1);
  }

  console.log('======== 绑定角色探针: ' + MODEL + ' ========');
  console.log('  蒙皮网格: ' + (data.isSkinned ? '是 ✅' : '否 ❌'));
  console.log('  骨骼数:   ' + data.bones.length);
  console.log('  动画数:   ' + data.clips.length);
  for (const c of data.clips) {
    console.log(`    - ${c.name.padEnd(8)} ${c.duration.toFixed(3)}s  ${c.tracks} tracks`);
  }
  console.log('  三角面:   ' + data.tris.toLocaleString());
  console.log('  raw  尺寸: ' + data.rawSize.map((v) => v.toFixed(3)).join(' × '));
  console.log('  posed 尺寸: ' + (data.posed ? data.posed.size.join(' × ') : 'n/a'));
  console.log('  norm@0.75:  ' + (data.normSize ? data.normSize.join(' × ') : 'n/a'));
  console.log('  关节世界坐标: ' + JSON.stringify(data.jpos));
  console.log('  材质: ' + JSON.stringify(data.materials));

  // 逐 clip 采样 posed 包围盒（动画会让包围盒变化）
  // 4 方位对比渲染：front=从 +Z 看(角色朝 +Z 时=正面), right=+X, back=-Z, left=-X
  if (wantViews) {
    const views = [
      { n: 'front', th: 0, ph: 1.30 },
      { n: 'right', th: Math.PI / 2, ph: 1.30 },
      { n: 'back', th: Math.PI, ph: 1.30 },
      { n: 'left', th: -Math.PI / 2, ph: 1.30 },
    ];
    if (viewClip) {
      const c = data.clips.find((x) => x.name === viewClip);
      if (c) {
        await evalJS(`window.__probe.setClip(${JSON.stringify(viewClip)}, ${(c.duration * 0.5).toFixed(3)})`);
        await new Promise((r) => setTimeout(r, 300));
      }
    }
    for (const v of views) {
      await evalJS(`window.__probe.setView(${v.th}, ${v.ph}, 4.0, 1.05, 0)`);
      await new Promise((r) => setTimeout(r, 260));
      const s = await send('Page.captureScreenshot', { format: 'png' });
      const tag = (viewClip ? viewClip + '__' : '') + v.n;
      const file = path.join(OUT, `view_${tag}.png`);
      fs.writeFileSync(file, Buffer.from(s.data, 'base64'));
      console.log('    ' + tag + ' → ' + file.replace(ROOT + '/', ''));
    }
  }

  if (wantClips && data.clips.length) {
    console.log('\n  各 clip 采样（t=0 / t=50% / t=90%）:');
    for (const c of data.clips) {
      const rows = [];
      for (const frac of [0, 0.5, 0.9]) {
        const t = +(c.duration * frac).toFixed(3);
        await evalJS(`window.__probe.setClip(${JSON.stringify(c.name)}, ${t})`);
        await new Promise((r) => setTimeout(r, 260));
        const box = await evalJS(`(function(){
          const THREE = window.__three;
          return null;
        })()`);
        const s = await send('Page.captureScreenshot', { format: 'png' });
        const file = path.join(OUT, `${c.name}__t${String(t).replace('.', 'p')}.png`);
        fs.writeFileSync(file, Buffer.from(s.data, 'base64'));
        rows.push(`t=${t}s → ${file.replace(ROOT + '/', '')}`);
      }
      console.log(`    ${c.name.padEnd(8)} ${rows.join('  ')}`);
    }
  }

  if (logs.length) {
    console.log('\n  控制台 (' + logs.length + '):');
    logs.slice(0, 6).forEach((l) => console.log('    ' + l.slice(0, 200)));
  }

  fs.writeFileSync(path.join(OUT, 'probe.json'), JSON.stringify(data, null, 2));
  console.log('\n  JSON: outputs/rig-probe/probe.json');

  ws.close(); if (chrome) chrome.kill();
  await new Promise((r) => setTimeout(r, 300));
  server.kill();
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
