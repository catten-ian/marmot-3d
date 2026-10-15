/**
 * 量测 SPZ 场景的真实尺度与坐标分布。
 *
 * 为什么必须实测：网格 PLY 是 25×25×6.8m，但 SPZ 解出来的坐标
 * 却是几百米量级 —— 两者坐标系/单位不同，直接套用网格的缩放系数
 * 会得到 6000m 的巨型物体糊满整个视野。
 * 缩放只能靠实测，不能靠推测。
 *
 * 用法：node tools/probe-spz.cjs
 */
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');

const PORT = 9401;
const URL = 'http://127.0.0.1:8123/gs.html?webgl=1';

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
  const profile = path.join(os.tmpdir(), 'marmot-spz-' + Date.now());
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
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails.exception || r.exceptionDetails.text).slice(0, 400));
    return r.result?.value;
  };

  await new Promise((r) => ws.addEventListener('open', r, { once: true }));
  await send('Runtime.enable'); await send('Page.enable');
  await send('Page.navigate', { url: URL });
  await new Promise((r) => setTimeout(r, 6000));

  const r = await evalJS(`(async () => {
    const { SPZLoader } = await import('/vendor/addons/loaders/SPZLoader.js');
    const geo = await new SPZLoader().loadAsync('/assets/splats/scene.spz');
    const pos = geo.attributes.position.array;
    const n = geo.attributes.position.count;
    const bb = geo.boundingBox || (geo.computeBoundingBox(), geo.boundingBox);
    const size = [bb.max.x - bb.min.x, bb.max.y - bb.min.y, bb.max.z - bb.min.z];
    // 抽样统计分布（每 97 个取一个），找出主体范围与离群点
    const step = 97;
    const xs = [], ys = [], zs = [];
    for (let i = 0; i < n; i += step) {
      xs.push(pos[i * 3]); ys.push(pos[i * 3 + 1]); zs.push(pos[i * 3 + 2]);
    }
    const pct = (arr, p) => {
      const a = arr.slice().sort((x, y) => x - y);
      return a[Math.floor(a.length * p)];
    };
    // 只看中间 90% 的样本，判断"主体"范围（排除飞点）
    const main = [0.05, 0.95];
    return {
      count: n,
      sizeRaw: size.map(v => +v.toFixed(1)),
      center: [bb.min.x, bb.min.y, bb.min.z].map(v => +v.toFixed(1)),
      mainX: +(pct(xs, main[1]) - pct(xs, main[0])).toFixed(1),
      mainY: +(pct(ys, main[1]) - pct(ys, main[0])).toFixed(1),
      mainZ: +(pct(zs, main[1]) - pct(zs, main[0])).toFixed(1),
      sample: { x: [+pct(xs, 0.05).toFixed(1), +pct(xs, 0.95).toFixed(1)],
               y: [+pct(ys, 0.05).toFixed(1), +pct(ys, 0.95).toFixed(1)],
               z: [+pct(zs, 0.05).toFixed(1), +pct(zs, 0.95).toFixed(1)] },
      shDegree: geo.getAttribute('sphericalHarmonics3') ? 3
        : geo.getAttribute('sphericalHarmonics2') ? 2
        : geo.getAttribute('sphericalHarmonics1') ? 1 : 0,
      attrs: Object.keys(geo.attributes),
    };
  })()`);

  console.log('======== SPZ 场景实测 ========');
  console.log('  泼溅数: ' + r.count.toLocaleString());
  console.log('  球谐阶数: ' + r.shDegree + '   属性: ' + r.attrs.join(', '));
  console.log('  包围盒尺寸(原始单位): ' + r.sizeRaw.join(' × '));
  console.log('  包围盒最小角: ' + r.center.join(', '));
  console.log('  主体 90% 跨度: ' + [r.mainX, r.mainY, r.mainZ].join(' × '));
  console.log('  抽样分布 X: ' + JSON.stringify(r.sample.x));
  console.log('             Y: ' + JSON.stringify(r.sample.y));
  console.log('             Z: ' + JSON.stringify(r.sample.z));
  console.log();
  console.log('  → 与网格 PLY 的 25×25×6.8m 相比，SPZ 是 ' + r.mainX + '×' + r.mainY + '×' + r.mainZ);
  console.log('    若要缩放到与网格同量级，scale ≈ ' + (25 / Math.max(r.mainX, 0.001)).toFixed(4));

  ws.close(); chrome.kill();
  await new Promise((r2) => setTimeout(r2, 300));
  process.exit(0);
})();
