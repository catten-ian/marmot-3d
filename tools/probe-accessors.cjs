/**
 * 逐个 accessor 手动解码，定位 GLB 里具体哪个属性出错。
 * 用法：node tools/probe-accessors.cjs
 */
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');

const PORT = 9333;
const BASE = `http://127.0.0.1:8123/index.html`;
const TARGET = process.argv[2] || './assets/models/terrain.glb';

function findChrome() {
  for (const c of [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  ]) if (fs.existsSync(c)) return c;
  return null;
}
const get = (u) => fetch(u, { headers: { Host: '127.0.0.1' } }).then((r) => r.json());

(async () => {
  const CHROME = findChrome();
  if (!CHROME) { console.log('未找到 Chrome/Edge'); process.exit(1); }
  const profile = path.join(os.tmpdir(), 'marmot-probe-' + Date.now());
  const chrome = spawn(CHROME, [
    '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
    '--no-first-run', '--disable-gpu', '--use-gl=swiftshader', '--enable-unsafe-swiftshader',
    '--window-size=800,600', 'about:blank',
  ], { stdio: 'ignore' });
  let target = null;
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 500));
    try { target = (await get(`http://127.0.0.1:${PORT}/json/list`)).find((t) => t.type === 'page'); if (target) break; } catch (e) {}
  }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let id = 0; const pending = new Map();
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); }
  });
  const send = (method, params = {}) => new Promise((res, rej) => {
    const mid = ++id; pending.set(mid, { res, rej });
    ws.send(JSON.stringify({ id: mid, method, params }));
    setTimeout(() => { if (pending.has(mid)) { pending.delete(mid); rej(new Error('timeout')); } }, 30000);
  });
  await new Promise((r) => ws.addEventListener('open', r, { once: true }));
  await send('Runtime.enable'); await send('Page.enable');
  await send('Page.navigate', { url: BASE });
  await new Promise((r) => setTimeout(r, 5000));

  const expr = `(async () => {
    const url = ${JSON.stringify(TARGET)};
    const buf = await (await fetch(url)).arrayBuffer();
    const dv = new DataView(buf);
    const headerLen = dv.getUint32(8, true);
    let js = null, binOff = -1, binLen = 0, o = 12;
    while (o < headerLen) {
      const L = dv.getUint32(o, true), T = dv.getUint32(o + 4, true);
      if (T === 0x4e4f534a) js = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, o + 8, L)).trimEnd());
      else if (T === 0x004e4942) { binOff = o + 8; binLen = L; }
      o += 8 + L;
    }
    const TA = { 5120: Int8Array, 5121: Uint8Array, 5122: Int16Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array };
    const NI = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
    const CS = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
    const out = { file: url, binLen, bufferViews: [], accessors: [] };
    js.bufferViews.forEach((bv, i) => {
      const elem = NI[ js.accessors.find(a => a.bufferView === i)?.type ] || 1;
      out.bufferViews.push({ i, byteOffset: bv.byteOffset, byteLength: bv.byteLength,
        end: (bv.byteOffset||0) + bv.byteLength, over: (bv.byteOffset||0) + bv.byteLength > binLen });
    });
    js.accessors.forEach((a, i) => {
      const bv = js.bufferViews[a.bufferView];
      const elem = NI[a.type] * CS[a.componentType];
      const stride = bv.byteStride || elem;
      const need = stride * (a.count - 1) + elem;
      const rec = { i, type: a.type, componentType: a.componentType, count: a.count,
        bv: a.bufferView, bvOffset: bv.byteOffset || 0, bvLength: bv.byteLength,
        elemBytes: elem, stride, needBytes: need, fitsInBV: need <= bv.byteLength };
      try {
        const arr = new TA[a.componentType](buf, binOff + (bv.byteOffset || 0), a.count * NI[a.type]);
        rec.decoded = true;
        rec.first3 = Array.from(arr.slice(0, 3)).map(x => +x.toFixed(4));
      } catch (e) { rec.decoded = false; rec.err = String(e.message || e); }
      out.accessors.push(rec);
    });
    out.meshes = js.meshes.map(m => m.primitives.map(p => ({ attrs: p.attributes, indices: p.indices, mode: p.mode, material: p.material })));
    out.materials = js.materials;
    return out;
  })()`;

  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  const v = r.result?.value;
  if (r.exceptionDetails) console.log('异常:', JSON.stringify(r.exceptionDetails.exception || r.exceptionDetails.text).slice(0, 600));
  if (!v) { console.log('无结果'); }
  else {
    console.log('文件', v.file, ' BIN 长度', v.binLen);
    console.log('\nbufferViews:');
    v.bufferViews.forEach((b) => console.log(`  #${b.i} off=${b.byteOffset} len=${b.byteLength} end=${b.end} 越界=${b.over}`));
    console.log('\naccessors:');
    v.accessors.forEach((a) => {
      console.log(`  #${a.i} ${a.type}/CT${a.componentType} count=${a.count} bv=${a.bv}` +
        ` elemBytes=${a.elemBytes} stride=${a.stride} 需${a.needBytes} bvLen=${a.bvLength} 装得下=${a.fitsInBV}`);
      console.log(`      解码=${a.decoded ? 'OK' + JSON.stringify(a.first3) : 'FAIL ' + a.err}`);
    });
    console.log('\nprimitives:', JSON.stringify(v.meshes));
    console.log('materials:', JSON.stringify(v.materials));
  }
  ws.close(); chrome.kill();
  await new Promise((r) => setTimeout(r, 300));
  process.exit(0);
})();
