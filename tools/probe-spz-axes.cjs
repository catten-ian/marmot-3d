/**
 * 判定 SPZ 的哪根轴是"竖直"、哪根是"地面深度"。
 *
 * 这是全 GS 方案的前提：如果搞错轴向，整张地图会横躺过来，
 * 后面所有缩放/可行走判定都建立在错误的前提上。
 *
 * 判据（不靠假设，靠数据）：
 *   · 竖直轴：垂直截面的"点密度分布"最集中 —— 地面是一条薄层，
 *     而水平轴上点在 Y 方向铺得很开
 *   · 对每一根候选轴，统计"沿该轴切成 50 层，每层点数"的分布，
 *     层数分布越尖锐（少数层占绝大多数点）→ 越像竖直轴
 *
 * 用法：node tools/probe-spz-axes.cjs
 */
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');

const PORT = 9451;
const URL = 'http://127.0.0.1:8123/index.html?version=dev&webgl=1';

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
  const profile = path.join(os.tmpdir(), 'marmot-axes-' + Date.now());
  const chrome = spawn(CHROME, [
    '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
    '--no-first-run', '--enable-unsafe-swiftshader', '--disable-gpu-sandbox',
    '--window-size=800,600', 'about:blank',
  ], { stdio: 'ignore' });
  let t = null;
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 500));
    try { t = (await get(`http://127.0.0.1:${PORT}/json/list`)).find((x) => x.type === 'page'); if (t) break; } catch (e) {}
  }
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  let id = 0; const pend = new Map();
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pend.has(m.id)) { const q = pend.get(m.id); pend.delete(m.id); m.error ? q.rej(new Error(JSON.stringify(m.error))) : q.res(m.result); }
  });
  const send = (me, pa = {}) => new Promise((res, rej) => {
    const i = ++id; pend.set(i, { res, rej });
    ws.send(JSON.stringify({ id: i, method: me, params: pa }));
    setTimeout(() => { if (pend.has(i)) { pend.delete(i); rej(new Error('timeout')); } }, 180000);
  });
  const evalJS = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails.exception || r.exceptionDetails.text).slice(0, 500));
    return r.result?.value;
  };

  await new Promise((r) => ws.addEventListener('open', r, { once: true }));
  await send('Runtime.enable'); await send('Page.enable');
  await send('Page.navigate', { url: URL });
  await new Promise((r) => setTimeout(r, 7000));

  const res = await evalJS(`(async () => {
    const { SPZLoader } = await import('/vendor/addons/loaders/SPZLoader.js');
    const geo = await new SPZLoader().loadAsync('/assets/splats/scene.spz');
    const a = geo.attributes.position.array;
    const n = geo.attributes.position.count;

    const axes = [];
    for (let ax = 0; ax < 3; ax++) {
      let mn=Infinity, mx=-Infinity;
      for (let i=0;i<n;i++){ const v=a[i*3+ax]; if(v<mn)mn=v; if(v>mx)mx=v; }
      const span = mx-mn;
      // 切成 60 层看点数分布
      const L = 60;
      const hist = new Float64Array(L);
      for (let i=0;i<n;i++){
        const k = Math.min(L-1, Math.max(0, Math.floor((a[i*3+ax]-mn)/span*L)));
        hist[k]++;
      }
      // 峰值占比：最密的 10 层占了多少点
      const sorted = Array.from(hist).sort((p,q)=>q-p);
      const top10 = sorted.slice(0,6).reduce((s,v)=>s+v,0)/n;
      // 集中度：熵（越小越集中）
      let ent=0;
      for(let k=0;k<L;k++){ const p=hist[k]/n; if(p>0) ent -= p*Math.log(p); }
      axes.push({ ax: 'XYZ'[ax], span:+span.toFixed(1), mn:+mn.toFixed(1), mx:+mx.toFixed(1),
        top6LayerRatio: +top10.toFixed(3), entropy: +ent.toFixed(3),
        hist: Array.from(hist).map(v=>Math.round(v/n*1000)/10) });
    }

    // 对最可能的竖直轴：沿该轴分层的点数，看地面层在哪
    return { axes, n };
  })()`);

  console.log('======== SPZ 轴向分析 ========');
  console.log('  泼溅点 ' + res.n.toLocaleString() + '\n');
  res.axes.forEach((ax) => {
    console.log(`  轴 ${ax.ax}: 跨度 ${ax.span}  范围 [${ax.mn}, ${ax.mx}]`);
    console.log(`      最密 6 层占比 ${(ax.top6LayerRatio * 100).toFixed(1)}%   分布熵 ${ax.entropy}`);
    // 画个简易柱状图（每格 = 一个百分位层的点数占比）
    const bars = ax.hist.map((v) => {
      const w = Math.min(6, Math.round(v));
      return w > 0 ? '█'.repeat(w) : '·';
    });
    console.log('      点数分布（每列=1%厚度）:');
    console.log('      ' + bars.join(''));
  });

  // 判定：熵最小 + 最密层占比最高的 = 竖直轴
  const sorted = [...res.axes].sort((p, q) => (p.entropy - q.entropy));
  console.log('\n======== 判定 ========');
  console.log('  熵最小（最集中）= 轴 ' + sorted[0].ax + '  → 最可能是竖直轴');
  console.log('  最密层占比最高 = 轴 ' + [...res.axes].sort((p, q) => q.top6LayerRatio - p.top6LayerRatio)[0].ax);
  console.log('  跨度最大的轴   = 轴 ' + [...res.axes].sort((p, q) => q.span - p.span)[0].ax + '（地面纵深）');

  ws.close(); chrome.kill();
  await new Promise((r) => setTimeout(r, 300));
  process.exit(0);
})();
