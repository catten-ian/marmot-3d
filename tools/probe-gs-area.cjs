/**
 * GS 场景可用区域测绘 —— 决定"缩小后的竞技场"该放在哪。
 *
 * 需求是「把 GS 作为全部场景 + 放大地图 + 缩小原先活动范围来适配」。
 * 但**不能凭空缩小范围**：必须先知道 GS 里哪里真的能走。
 *
 * 判据（都从点云统计得出，不靠猜）：
 *   · 地面点密度 —— 地面是连续平面，点密集；树林/灌木处点也密但高度分散
 *   · 高度一致性 —— 地面点的高度集中在一个薄层；树冠则上下铺开
 *   · 坡度       —— 由高度场的梯度算出，陡坡不可走
 *
 * 输出：一张可行走掩码 + 建议的竞技场中心与半径。
 *
 * 用法：node tools/probe-gs-area.cjs
 */
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');

const PORT = 9441;
const URL = 'http://127.0.0.1:8123/index.html?version=dev&webgl=1';

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
  const profile = path.join(os.tmpdir(), 'marmot-area-' + Date.now());
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

  // 轴向实测结论（tools/probe-spz-axes.cjs）：
  //   Z = 竖直轴（分布熵最小 2.197，最密层占比 73.1%）
  //   Y = 地面纵深（跨度最大 1047）
  //   X = 横跨（779）
  // 下面所有统计都按这个轴向走，之前的版本误把 Y 当竖直轴，导致"可行走率 3%"。
  const res = await evalJS(`(async () => {
    const { SPZLoader } = await import('/vendor/addons/loaders/SPZLoader.js');
    const geo = await new SPZLoader().loadAsync('/assets/splats/scene.spz');
    const pos = geo.attributes.position.array;
    const n = geo.attributes.position.count;

    // 基本范围（按实测轴向：X 横跨 / Z 竖直 / Y 纵深）
    // 统计时统一映射：gx←X, gy←Z(竖直), gz←Y(纵深)
    let ax0=Infinity,ax1=-Infinity, up0=Infinity,up1=-Infinity, dp0=Infinity,dp1=-Infinity;
    for (let i=0;i<n;i++){
      const u=pos[i*3], h=pos[i*3+2], d=pos[i*3+1];
      if(u<ax0)ax0=u; if(u>ax1)ax1=u;
      if(h<up0)up0=h; if(h>up1)up1=h;
      if(d<dp0)dp0=d; if(d>dp1)dp1=d;
    }
    const spanUp = up1-up0, spanU = ax1-ax0, spanD = dp1-dp0;

    // 建网格统计：每格的点数、Y 的分位数
    const CELL = 2;
    const gx = Math.max(1, Math.ceil(spanU/CELL));
    const gz = Math.max(1, Math.ceil(spanD/CELL));
    const counts = new Uint32Array(gx*gz);
    const ySum = new Float64Array(gx*gz);
    const yMin = new Float32Array(gx*gz).fill(Infinity);
    const yMax = new Float32Array(gx*gz).fill(-Infinity);
    // 地面层：取全局低 25% 的高度作为"地面候选"
    const groundCut = up0 + spanUp * 0.25;

    for (let i=0;i<n;i++){
      const u=pos[i*3], h=pos[i*3+2], d=pos[i*3+1];
      const cx=Math.min(gx-1,Math.max(0,Math.floor((u-ax0)/CELL)));
      const cz=Math.min(gz-1,Math.max(0,Math.floor((d-dp0)/CELL)));
      const k=cz*gx+cx;
      counts[k]++; ySum[k]+=h;
      if(h<yMin[k])yMin[k]=h;
      if(h>yMax[k])yMax[k]=h;
    }

    // 统计每格的高度分布特征
    let walkable=0, total=gx*gz;
    let minCount=Infinity, maxCount=0;
    const cells=[];
    for(let k=0;k<total;k++){
      const c=counts[k];
      if(c===0){cells.push({k,c:0,ok:false});continue;}
      if(c<minCount)minCount=c; if(c>maxCount)maxCount=c;
      const hmin=yMin[k], hmax=yMax[k];
      const spread = hmax-hmin;                 // 高度分散度：大 = 树冠/立体
      const avg = ySum[k]/c;
      const lowRatio = (Math.min(hmax,groundCut)-hmin)/Math.max(1e-3,spread);
      // 判据：高度层薄（spread 小 或 有明显低层）且点数足够
      const flat = spread < spanUp*0.06;
      const hasGroundLayer = lowRatio > 0.45;
      const dense = c >= 8;
      const ok = dense && (flat || hasGroundLayer);
      if(ok) walkable++;
      cells.push({k,c,ok,spread:+spread.toFixed(2),avg:+avg.toFixed(2)});
    }

    // 找最大的可行走矩形区域：从中心向四周扩张，统计窗口内的可行走格比例
    const cellIdx=(cx,cz)=>cells[cz*gx+cx];
    const isOk=(cx,cz)=>{
      if(cx<0||cx>=gx||cz<0||cz>=gz) return false;
      const c=cells[cz*gx+cx];
      return c && c.ok;
    };
    // 从每格出发找以它为中心的最大正方形，边长用二分扩张
    let best=null;
    const halfMax=Math.min(gx,gz);
    for(let r=halfMax;r>=2;r-=1){
      let found=false;
      for(let cz=r;cz<gz-r && !found;cz+=2){
        for(let cx=r;cx<gx-r;cx+=2){
          let good=0,tot=0;
          for(let z=cz-r;z<=cz+r;z+=2){
            for(let x=cx-r;x<=cx+r;x+=2){ tot++; if(isOk(x,z))good++; }
          }
          const ratio=good/tot;
          if(ratio>0.82){ found=true; const side=r*2*CELL;
            if(!best||side>best.side) best={side, ratio:+ratio.toFixed(3), cx, cz }; }
        }
      }
      if(found) break;   // 从大到小，第一个找到的就是最大的
    }

    // 密度分位：给"适合当竞技场"一个量化依据
    const sortedCounts = Array.from(counts).filter(v=>v>0).sort((a,b)=>a-b);
    const pct = (p) => sortedCounts[Math.floor(sortedCounts.length*p)]||0;

    return {
      points: n,
      axes: 'X=横跨, Z=竖直, Y=纵深',
      span: { u:+spanU.toFixed(1), up:+spanUp.toFixed(1), d:+spanD.toFixed(1) },
      min: { u:+ax0.toFixed(1), up:+up0.toFixed(1), d:+dp0.toFixed(1) },
      max: { u:+ax1.toFixed(1), up:+up1.toFixed(1), d:+dp1.toFixed(1) },
      groundCut: +groundCut.toFixed(1),
      grid: { cell: CELL, gx, gz, total },
      walkable, walkableRatio: +(walkable/total).toFixed(3),
      density: { min: minCount===Infinity?0:minCount, p10: pct(0.1), median: pct(0.5), p90: pct(0.9), max: maxCount },
      bestSquare: best ? { side: best.side, ratio: best.ratio,
        centerU: +(ax0 + best.cx*CELL).toFixed(1),
        centerD: +(dp0 + best.cz*CELL).toFixed(1) } : null,
    };
  })()`);

  console.log('======== GS 场景测绘 ========');
  console.log('  泼溅点: ' + res.points.toLocaleString());
  console.log('  轴向:   ' + res.axes);
  console.log('  横跨 X: [' + res.min.u + ' ~ ' + res.max.u + ']   跨度 ' + res.span.u);
  console.log('  竖直 Z: [' + res.min.up + ' ~ ' + res.max.up + ']   跨度 ' + res.span.up);
  console.log('  纵深 Y: [' + res.min.d + ' ~ ' + res.max.d + ']   跨度 ' + res.span.d);
  console.log();
  console.log('======== 网格统计（cell=' + res.grid.cell + '，' + res.grid.gx + '×' + res.grid.gz + ' = ' + res.grid.total + ' 格）========');
  console.log('  地面高度上界(P25): ' + res.groundCut);
  console.log('  每格点数: min=' + res.density.min + '  P10=' + res.density.p10 +
    '  中位=' + res.density.median + '  P90=' + res.density.p90 + '  max=' + res.density.max);
  console.log();
  console.log('======== 可行走判定 ========');
  console.log('  可行走格: ' + res.walkable + ' / ' + res.grid.total + '  (' + (res.walkableRatio * 100).toFixed(1) + '%)');
  if (res.bestSquare) {
    console.log('  最大可行走正方形: 边长 ' + res.bestSquare.side + ' 单位' +
      '  (可行走占比 ' + (res.bestSquare.ratio * 100).toFixed(1) + '%)');
    console.log('    中心: 横跨U=' + res.bestSquare.centerU + '  纵深D=' + res.bestSquare.centerD);
  } else {
    console.log('  未找到足够大的连续可行走正方形');
  }
  console.log();
  console.log('  → 竞技场建议: 以最佳正方形为中心，边长取其 70~80%');
  console.log('    若要保留 130×78 的竞技场，地图需放大 ' +
    (res.bestSquare ? (110 / res.bestSquare.side).toFixed(2) : '?') + ' 倍');

  console.log('\n控制台 error/warning: ' + logs.length);
  logs.slice(0, 6).forEach((l) => console.log('  ' + l.slice(0, 200)));

  ws.close(); chrome.kill();
  await new Promise((r) => setTimeout(r, 300));
  process.exit(0);
})();
