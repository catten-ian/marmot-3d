/**
 * 验证真实 GLB 模型（marmot / fox / terrain）能否被 GLTFLoader 正常加载。
 *
 * 重点：checkGltfChunks 复刻 three.js GLTFBinaryExtension 的定位逻辑
 *       （chunkIndex += chunkLength，不额外补对齐），因此能提前抓到
 *       「JSON chunk 长度未含 padding」这类 three.js 加载不了的格式错误。
 */
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');

const PORT = 9331;
const BASE = `http://127.0.0.1:8123/index.html`;

function findChrome() {
  const cands = [
    process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  ].filter(Boolean);
  for (const c of cands) if (fs.existsSync(c)) return c;
  return null;
}

const get = (u) =>
  fetch(u, { headers: { 'Host': '127.0.0.1' } }).then((r) => r.json());

(async () => {
  const CHROME = findChrome();
  if (!CHROME) { console.log('未找到 Chrome/Edge'); process.exit(1); }
  const profile = path.join(os.tmpdir(), 'marmot-chunk-' + Date.now());
  const chrome = spawn(CHROME, [
    '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
    '--no-first-run', '--disable-gpu', '--use-gl=swiftshader', '--enable-unsafe-swiftshader',
    '--window-size=1280,720', 'about:blank',
  ], { stdio: 'ignore' });

  let target = null;
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 500));
    try { target = (await get(`http://127.0.0.1:${PORT}/json/list`)).find((t) => t.type === 'page'); if (target) break; } catch (e) {}
  }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  const pageErrors = [];
  const consoleMsgs = [];
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const p = pending.get(m.id); pending.delete(m.id);
      m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result);
      return;
    }
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails;
      pageErrors.push(d.exception?.description || d.text);
    }
    if (m.method === 'Runtime.consoleAPICalled' &&
        (m.params.type === 'error' || m.params.type === 'warning')) {
      consoleMsgs.push(`[${m.params.type}] ` + m.params.args.map((a) => a.value ?? a.description ?? a.type).join(' '));
    }
  });
  const send = (method, params = {}) => new Promise((res, rej) => {
    const mid = ++id; pending.set(mid, { res, rej });
    ws.send(JSON.stringify({ id: mid, method, params }));
    setTimeout(() => { if (pending.has(mid)) { pending.delete(mid); rej(new Error('timeout ' + method)); } }, 60000);
  });

  await new Promise((r) => ws.addEventListener('open', r, { once: true }));
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Page.navigate', { url: BASE });
  await new Promise((r) => setTimeout(r, 6000));

  const expr = `(async () => {
    // 注意：importmap 只对页面里的 <script type="module"> 生效，
    // Runtime.evaluate 里的动态 import 不走 importmap，必须用绝对 URL。
    const THREE = await import('/vendor/three.module.js');
    const { GLTFLoader } = await import('/vendor/addons/loaders/GLTFLoader.js');

    // ---- 复刻 GLTFLoader 的 chunk 定位：chunkIndex += chunkLength，不补对齐 ----
    async function checkGltfChunks(url) {
      const buf = await (await fetch(url)).arrayBuffer();
      const dv = new DataView(buf);
      const res = { url, header: dv.getUint32(8, true), chunks: [], jsonOk: false, binFound: false };
      let chunkIndex = 0;
      const end = res.header - 12;
      while (chunkIndex < end) {
        const chunkLength = dv.getUint32(12 + chunkIndex, true);
        const chunkType = dv.getUint32(12 + chunkIndex + 4, true);
        res.chunks.push({ offset: 12 + chunkIndex, type: chunkType.toString(16), length: chunkLength, aligned: chunkLength % 4 === 0 });
        if (chunkType === 0x4e4f534a) {
          try {
            const txt = new TextDecoder().decode(new Uint8Array(buf, 12 + chunkIndex + 8, chunkLength));
            res.jsonOk = !!JSON.parse(txt);
            res.jsonLen = txt.trimEnd().length;
          } catch (e) { res.jsonErr = String(e); }
        } else if (chunkType === 0x004e4942) {
          res.binFound = true;
          res.binLength = chunkLength;
        }
        chunkIndex += 8 + chunkLength;
      }
      return res;
    }

    const loader = new GLTFLoader();
    function load(url) {
      return new Promise((resolve) => {
        loader.load(url, (g) => resolve({
          ok: true,
          children: g.scene.children.length,
          meshes: (() => { let n = 0; g.scene.traverse((o) => { if (o.isMesh) n++; }); return n; })(),
          triangles: (() => { let n = 0; g.scene.traverse((o) => {
            if (!o.isMesh) return;
            const idx = o.geometry.index;
            n += (idx ? idx.count : o.geometry.attributes.position.count) / 3;
          }); return Math.round(n); })(),
          textures: (() => { const set = new Set(); g.scene.traverse((o) => {
            if (!o.isMesh) return;
            const mats = Array.isArray(o.material) ? o.material : [o.material];
            for (const m of mats) if (m && m.map) set.add(m.map.name || m.map.uuid.slice(0, 6));
          }); return [...set]; })(),
          hasVertexColor: (() => { let v = false; g.scene.traverse((o) => {
            if (o.isMesh && o.geometry.attributes.color) v = true;
          }); return v; })(),
          box: (() => { const b = new THREE.Box3().setFromObject(g.scene); const s = b.getSize(new THREE.Vector3());
            return [ +s.x.toFixed(3), +s.y.toFixed(3), +s.z.toFixed(3) ]; })(),
        }), undefined, (e) => resolve({ ok: false, err: String(e && e.message || e) }));
      });
    }

    const urls = ['./assets/models/marmot.glb', './assets/models/fox.glb', './assets/models/terrain.glb', './assets/models/terrain-lod.glb'];
    const chunks = {};
    const models = {};
    for (const u of urls) {
      chunks[u] = await checkGltfChunks(u);
      models[u] = await load(u);
    }
    return { chunks, models };
  })()`;

  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  const v = r.result?.value;
  if (r.exceptionDetails) {
    console.log('页面内异常:', JSON.stringify(r.exceptionDetails, null, 1).slice(0, 1500));
  }
  if (!v) {
    console.log('未拿到结果:', JSON.stringify(r.result || r).slice(0, 800));
  } else {
    console.log('=========== GLB chunk 结构（复刻 three.js 定位逻辑） ===========');
    for (const [u, c] of Object.entries(v.chunks)) {
      console.log('\n' + u);
      console.log('  header.length ' + c.header + '  chunks ' + c.chunks.length +
        '  JSON 解析 ' + (c.jsonOk ? 'OK' : 'FAIL ' + (c.jsonErr || '')) +
        '  BIN 找到 ' + (c.binFound ? 'YES (' + c.binLength + ')' : 'NO'));
      for (const ch of c.chunks) {
        console.log('    @' + String(ch.offset).padStart(7) + '  type ' + ch.type +
          '  len ' + String(ch.length).padStart(8) + '  4字节对齐 ' + (ch.aligned ? 'OK' : '** 否 **'));
      }
    }
    console.log('\n=========== 模型加载结果 ===========');
    for (const [u, m] of Object.entries(v.models)) {
      console.log('\n' + u);
      if (!m.ok) { console.log('  加载失败:', m.err); continue; }
      console.log('  meshes ' + m.meshes + '  三角面 ' + m.triangles +
        '  顶点色 ' + m.hasVertexColor + '  贴图 ' + (m.textures.length ? m.textures.join(',') : '无'));
      console.log('  包围盒尺寸 ' + JSON.stringify(m.box));
    }
  }
  console.log('\n页面异常:', pageErrors.length);
  pageErrors.slice(0, 5).forEach((e) => console.log('  ' + String(e).slice(0, 300)));
  console.log('控制台 error/warning:', consoleMsgs.length);
  consoleMsgs.slice(0, 10).forEach((e) => console.log('  ' + String(e).slice(0, 250)));

  ws.close();
  chrome.kill();
  await new Promise((r) => setTimeout(r, 300));
  process.exit(0);
})();
