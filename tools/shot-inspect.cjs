/**
 * 模型检查台截图 —— 独立页面，不受游戏逻辑干扰。
 *
 * 为什么要有这个：
 *   在游戏里验证模型时踩了两次坑：
 *     ① 属性全"正常"（visible/包围盒/贴图都对）但画面上什么都没有
 *     ② 用 drawImage 读 WebGL 画布统计像素，全黑 ——
 *        因为 WebGL 画布默认 preserveDrawingBuffer:false，合成后就被丢弃，
 *        **检测方法本身是错的**，导致误判"没渲染出来"
 *   所以做一个纯展示页面：只有相机、灯光、模型、地网格，
 *   并开 preserveDrawingBuffer 让像素统计可信。
 *
 * 用法：node tools/shot-inspect.cjs [model] [up]
 *   model: fox | marmot | terrain-lod（默认 fox）
 *   up:    y | z（默认 y）
 */
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');

const PORT = 9491;
const MODEL = process.argv[2] || 'fox';
const UP = process.argv[3] || 'y';
const isExternalUrl = /^https?:\/\//i.test(MODEL);
const MODEL_LABEL = isExternalUrl ? MODEL.split('/').pop() : MODEL;
const UP_MAP = { fox: 'y', marmot: 'z', 'terrain-lod': 'y' };
const up = UP !== 'auto' ? UP : (UP_MAP[MODEL] || 'y');
const modelUrl = isExternalUrl ? MODEL : `./assets/models/${MODEL}.glb`;
const URL = `http://127.0.0.1:8123/inspect.html?model=${encodeURIComponent(modelUrl)}&up=${up}`;

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
  const profile = path.join(os.tmpdir(), 'marmot-insp-' + Date.now());
  const chrome = spawn(CHROME, [
    '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
    '--no-first-run', '--enable-unsafe-swiftshader', '--window-size=900,640', 'about:blank',
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
  });
  const send = (me, pa = {}) => new Promise((res, rej) => {
    const i = ++id; pend.set(i, { res, rej });
    ws.send(JSON.stringify({ id: i, method: me, params: pa }));
    setTimeout(() => { if (pend.has(i)) { pend.delete(i); rej(new Error('timeout ' + me)); } }, 120000);
  });
  const evalJS = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails.exception || r.exceptionDetails.text).slice(0, 400));
    return r.result?.value;
  };

  // 像素统计：这里可信，因为页面开了 preserveDrawingBuffer
  const probe = async () => evalJS(`(function(){
    const src = document.getElementById('view');
    const W=180,H=120;
    const c=document.createElement('canvas'); c.width=W; c.height=H;
    const x=c.getContext('2d');
    // 只取中央区域（模型所在处），排除网格线等干扰
    x.drawImage(src, src.width*0.25, src.height*0.2, src.width*0.5, src.height*0.5, 0,0,W,H);
    const d=x.getImageData(0,0,W,H).data;
    // 背景是 #3a4038 附近；统计与背景差异大的像素 = 模型
    let model=0, sum=0, maxv=0;
    for(let i=0;i<d.length;i+=4){
      const r=d[i],g=d[i+1],b=d[i+2];
      const v=(r+g+b)/3; sum+=v; if(v>maxv)maxv=v;
      if(Math.abs(r-0x3a)>14||Math.abs(g-0x40)>14||Math.abs(b-0x38)>14) model++;
    }
    const total=d.length/4;
    return { modelRatio:+(model/total).toFixed(3), avg:+(sum/total).toFixed(1), max:maxv };
  })()`);

  await new Promise((r) => ws.addEventListener('open', r, { once: true }));
  await send('Runtime.enable'); await send('Page.enable');
  await send('Page.navigate', { url: URL });
  await new Promise((r) => setTimeout(r, 6000));

  const insp = await evalJS('JSON.stringify(window.__inspect ? window.__inspect.info : {error:"not ready"})');
  console.log('======== 模型检查台: ' + MODEL_LABEL + (isExternalUrl ? '' : '.glb') + ' (up=' + up + ') ========');
  try {
    const i = JSON.parse(insp);
    if (i.error) console.log('  错误: ' + i.error);
    else {
      console.log('  源尺寸:   ' + i.srcSize.map((v) => v.toFixed(3)).join(' × '));
      console.log('  归一后:   ' + i.finalSize.map((v) => v.toFixed(3)).join(' × '));
      const lh = i.finalSize[0] / i.finalSize[1];
      console.log('  三角面:   ' + i.tris.toLocaleString() + '   双面材质: ' + i.dbl);
      console.log('  长/高:    ' + lh.toFixed(2) +
        (lh > 1.4 && lh < 3.0 ? '  ← 像四足动物 ✅' : '  ← 可疑（可能是横躺的）❌'));
      console.log('  材质:     ' + JSON.stringify(i.mats));
    }
  } catch (e) { console.log('  解析失败: ' + insp); }

  // 四个角度各拍一张
  const views = [
    { name: '0',   th: 0,           ph: Math.PI / 2, r: 2.6, ty: 0.46 },
    { name: '45',  th: Math.PI / 4, ph: Math.PI / 2, r: 2.6, ty: 0.46 },
    { name: '90',  th: Math.PI / 2, ph: Math.PI / 2, r: 2.6, ty: 0.46 },
    { name: '135', th: 0,           ph: 0.55,        r: 2.8, ty: 0.46 },
  ];
  console.log('\n  多角度截图 + 像素统计:');
  for (const v of views) {
    await evalJS(`window.__inspect.setView(${v.th}, ${v.ph}, ${v.r}, ${v.ty})`);
    await new Promise((r) => setTimeout(r, 450));
    const px = await probe();
    const s = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(`D:/gam3/3d/marmot-3d/tools/view-yaw${v.name}.png`, Buffer.from(s.data, 'base64'));
    const verdict = px.modelRatio > 0.03 ? '有模型 ✅' : (px.max > 90 ? '有内容但很淡' : '什么都没有 ❌');
    console.log(`    视角${v.name}: 模型像素 ${(px.modelRatio * 100).toFixed(1)}%  最亮 ${px.max}  ${verdict}`);
  }

  console.log('\n  控制台: ' + logs.length);
  logs.slice(0, 5).forEach((l) => console.log('    ' + l.slice(0, 180)));

  ws.close(); chrome.kill();
  await new Promise((r) => setTimeout(r, 300));
  process.exit(0);
})();
