/**
 * 主版本真实模型加载诊断。
 *
 * 关注四件事（这是"模型没能正确加载"的四种典型表现）：
 *   1. 网络层 —— 文件是否真的取到（200 / 404 / 传输中断）
 *   2. 解析层 —— GLTFLoader 是否成功、报什么错
 *   3. 材质层 —— 贴图是否解码成功（decodeImage / HTMLImageElement）
 *   4. 场景层 —— mesh 是否真的挂进场景、可见、有材质
 *
 * 注意：贴图解码必须用**与 GLTFLoader 相同的方式**测（ImageBitmap），
 * 否则测出来"能解码"但 GLTFLoader 实际失败，就是假结论。
 *
 * 用法：node tools/diag-models.cjs
 */
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');

const PORT = 9421;
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
  const profile = path.join(os.tmpdir(), 'marmot-diagm-' + Date.now());
  const chrome = spawn(CHROME, [
    '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
    '--no-first-run', '--enable-unsafe-swiftshader',
    '--window-size=1024,640', 'about:blank',
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

  console.log('======== 1. 网络层：直接取文件 ========');
  const net = await evalJS(`(async () => {
    const urls = ['./assets/models/marmot.glb', './assets/models/fox.glb',
                  './assets/models/terrain.glb', './assets/models/terrain-lod.glb'];
    const out = [];
    for (const u of urls) {
      try {
        const r = await fetch(u);
        const b = await r.arrayBuffer();
        out.push({ u, status: r.status, bytes: b.byteLength,
          type: r.headers.get('content-type'),
          magic: Array.from(new Uint8Array(b.slice(0, 4))).map(c => c.toString(16).padStart(2, '0')).join('') });
      } catch (e) {
        out.push({ u, err: String(e && e.message || e) });
      }
    }
    return out;
  })()`);
  net.forEach((r) => console.log('  ' + (r.err ? `${r.u}  ✗ ${r.err}`
    : `  ${r.u}  ${r.status}  ${r.bytes.toLocaleString()}B  magic=${r.magic}  ${r.type || ''}`)));

  console.log('\n======== 2. 贴图解码能力（GLTFLoader 用同一路径）========');
  const tex = await evalJS(`(async () => {
    // GLTFLoader 内部用 ImageBitmapLoader 或 TextureLoader；
    // 两者最终都要 createImageBitmap / decode。
    const r = { hasImageBitmap: typeof createImageBitmap === 'function',
                hasImage: typeof Image === 'function',
                hasOffscreen: typeof OffscreenCanvas === 'function' };
    // 用一个真实的 1x1 PNG 试解码
    try {
      const png = Uint8Array.from(atob(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
      ), c => c.charCodeAt(0));
      const bmp = await createImageBitmap(new Blob([png], { type: 'image/png' }));
      r.bitmapDecode = 'OK ' + bmp.width + 'x' + bmp.height;
    } catch (e) { r.bitmapDecode = 'FAIL ' + e.message; }
    try {
      const url = URL.createObjectURL(new Blob([Uint8Array.from([1,2,3])]));
      await new Promise((res, rej) => {
        const im = new Image();
        im.onload = res; im.onerror = () => rej(new Error('Image onerror'));
        im.src = url;
      });
      r.imageDecode = 'OK';
    } catch (e) { r.imageDecode = 'FAIL ' + e.message; }
    return r;
  })()`);
  console.log('  createImageBitmap: ' + tex.hasImageBitmap);
  console.log('  ImageBitmap 解码:  ' + tex.bitmapDecode);
  console.log('  HTMLImage 解码:   ' + tex.imageDecode);
  console.log('  OffscreenCanvas:  ' + tex.hasOffscreen);

  console.log('\n======== 3. GLTFLoader 实际加载 ========');
  await send('Page.navigate', { url: URL });
  await new Promise((r) => setTimeout(r, 6000));

  const load = await evalJS(`(async () => {
    const { GLTFLoader } = await import('/vendor/addons/loaders/GLTFLoader.js');
    const loader = new GLTFLoader();
    const urls = ['./assets/models/marmot.glb', './assets/models/fox.glb',
                  './assets/models/terrain-lod.glb'];
    const out = [];
    for (const u of urls) {
      const rec = { u };
      try {
        const g = await new Promise((res, rej) => {
          loader.load(u, res, undefined, (e) => rej(e instanceof Error ? e : new Error(String(e?.message || e))));
        });
        const root = g.scene;
        let meshes = 0, tris = 0, mats = new Set(), hasMap = 0, mapOk = 0;
        const texTypes = new Set();
        root.traverse((o) => {
          if (!o.isMesh) return;
          meshes++;
          const idx = o.geometry.index;
          tris += (idx ? idx.count : o.geometry.attributes.position.count) / 3;
          const ms = Array.isArray(o.material) ? o.material : [o.material];
          for (const m of ms) {
            if (!m) continue;
            mats.add(m.type);
            if (m.map) {
              hasMap++;
              texTypes.add(m.map.constructor?.name || typeof m.map);
              // 检查贴图是否真的可用（有 image 且尺寸正常）
              const img = m.map.image;
              const w = img?.width || img?.videoWidth || 0;
              const h = img?.height || img?.videoHeight || 0;
              if (img && (w > 1 && h > 1)) mapOk++;
              else mapOk += 0.001;   // 标记"有贴图但解码失败"
            }
          }
        });
        out.push({ ...rec, ok: true, meshes, tris: Math.round(tris),
          matTypes: [...mats], texTypes: [...texTypes], mapOk: Math.round(mapOk) });
      } catch (e) {
        out.push({ ...rec, ok: false, err: String(e && e.message || e) });
      }
    }
    return out;
  })()`);
  load.forEach((r) => {
    if (!r.ok) { console.log('  ' + r.u + '  ✗ 加载失败: ' + r.err); return; }
    console.log(`  ${r.u}  ✓ ${r.meshes} 网格 / ${r.tris.toLocaleString()} 面`);
    console.log(`      材质 ${r.matTypes.join(',')}   贴图 ${r.texTypes.join(',') || '无'}   可用贴图 ${r.mapOk}`);
  });

  console.log('\n======== 4. 场景里的实际状态（跑起来之后）========');
  const live = await evalJS(`(function(){
    const g = window.__game;
    if (!g) return { err: 'no __game' };
    const info = { foxes: [], companion: null };
    for (const f of g.foxes()) {
      let real = false, vis = false, mats = [];
      f.mesh.traverse((o) => {
        if (!o.isMesh) return;
        if (o.name === 'wrap' || o.parent?.name === 'wrap') real = true;
        vis = vis || o.visible;
        const ms = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of ms) if (m) mats.push(m.type + (m.map ? '+map' : ''));
      });
      info.foxes.push({ type: f.type, hasReal: !!f.realModel,
        meshVisible: f.mesh.visible, procVisible: f.proceduralMesh ? f.proceduralMesh.visible : null,
        mats: [...new Set(mats)] });
    }
    info.count = g.foxes().length;
    info.backdrop = !!g.backdrop();
    return info;
  })()`);
  if (live.err) console.log('  ' + live.err);
  else {
    console.log('  藏狐 ' + live.count + ' 只   远景=' + (live.backdrop ? '已加载' : '未加载'));
    live.foxes.slice(0, 4).forEach((f) => {
      console.log(`    ${f.type.padEnd(7)} 真实模型=${f.hasReal ? '有' : '无(用程序化)'}  ` +
        `mesh可见=${f.meshVisible} 程序化可见=${f.procVisible}  ${f.mats.join('/')}`);
    });
  }

  console.log('\n控制台 error/warning/exception: ' + logs.length);
  logs.slice(0, 12).forEach((l) => console.log('  ' + l.slice(0, 240)));

  ws.close(); chrome.kill();
  await new Promise((r) => setTimeout(r, 300));
  process.exit(0);
})();
