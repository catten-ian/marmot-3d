/**
 * Beta runtime performance harness, using only an OpenClaw-managed Chrome tab.
 * Starts an in-process static server, opens/closes only tabs created by this run,
 * measures desktop/mobile/peak campaign load, captures screenshots and CDP data.
 * No external dependencies; use: node tools/perf-managed.cjs [--tag=baseline|after]
 */
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'outputs', 'perf');
const CDP = 'http://127.0.0.1:18800';
const tag = process.argv.find((arg) => arg.startsWith('--tag='))?.split('=')[1] || 'baseline';
const probeAdaptive = process.argv.includes('--probe-adaptive');
const onlyAdaptive = process.argv.includes('--only-adaptive');
const HOLD_MS = 25_000;
const WARMUP_MS = 4_000;
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.glb': 'model/gltf-binary', '.spz': 'application/octet-stream', '.woff2': 'font/woff2',
};
const server = http.createServer((req, res) => {
  let rel;
  try { rel = decodeURIComponent((req.url || '/').split('?')[0]); }
  catch (_) { res.writeHead(400).end('bad request'); return; }
  if (rel === '/') rel = '/index.html';
  const file = path.resolve(ROOT, '.' + path.normalize(rel));
  if (file !== ROOT && !file.startsWith(ROOT + path.sep)) { res.writeHead(403).end('forbidden'); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404).end('not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
});
server.on('error', (err) => { console.error('[perf] server error:', err.message); process.exitCode = 1; });
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const pctl = (a, p) => {
  if (!a.length) return null;
  const i = (a.length - 1) * p, lo = Math.floor(i), hi = Math.ceil(i);
  return +(a[lo] + (a[hi] - a[lo]) * (i - lo)).toFixed(3);
};
const mean = (a) => a.length ? +(a.reduce((s, v) => s + v, 0) / a.length).toFixed(3) : null;

async function jsonFetch(url, opts) {
  const res = await fetch(url, opts);
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
  return res.json();
}
async function openNewTab(url) {
  try { return await jsonFetch(`${CDP}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' }); }
  catch (e) {
    // Some OpenClaw builds expose GET rather than PUT for new-target creation.
    return await jsonFetch(`${CDP}/json/new?${encodeURIComponent(url)}`, { method: 'GET' });
  }
}

const NEW_DOCUMENT_PROBE = `(() => {
  const nativeRAF = window.requestAnimationFrame.bind(window);
  window.__perfMeasuring = false;
  window.__perfMainFrames = [];
  window.__perfRafNames = Object.create(null);
  window.__perfLastMainStart = null;
  window.__perfBucket = {passes:0,calls:0,triangles:0,lines:0,points:0,renderMs:0,geometries:0,textures:0};
  window.requestAnimationFrame = function(callback) {
    const name = callback && callback.name || '(anonymous)';
    return nativeRAF((ts) => {
      window.__perfRafNames[name] = (window.__perfRafNames[name] || 0) + 1;
      if (name !== 'frame' || !window.__perfMeasuring) { callback(ts); return; }
      const start = performance.now();
      try { callback(ts); }
      finally {
        const end = performance.now();
        const bucket = window.__perfBucket;
        const dt = window.__perfLastMainStart == null ? null : start - window.__perfLastMainStart;
        window.__perfLastMainStart = start;
        window.__perfMainFrames.push({timestamp:start,rafTimestamp:ts,dt,callbackMs:end-start,...bucket});
        window.__perfBucket = {passes:0,calls:0,triangles:0,lines:0,points:0,renderMs:0,geometries:bucket.geometries,textures:bucket.textures};
      }
    });
  };
})();`;

function summarizeCpuProfile(profile) {
  if (!profile?.nodes) return null;
  return profile.nodes.map((node) => ({
    functionName: node.callFrame?.functionName || '(anonymous)',
    url: node.callFrame?.url || '',
    line: (node.callFrame?.lineNumber ?? -1) + 1,
    samples: node.hitCount || 0,
  })).filter((n) => n.samples > 0)
    .sort((a, b) => b.samples - a.samples).slice(0, 20);
}

async function scenario(def) {
  const suffix = `${def.name}-${Date.now()}`;
  const url = `http://127.0.0.1:${port}/index.html?version=beta&webgl=1&models=off&perf=${encodeURIComponent(suffix)}`;
  const target = await openNewTab(url);
  if (!target?.webSocketDebuggerUrl || !target.id) throw new Error('新建自有 CDP 标签失败: ' + JSON.stringify(target));
  console.log(`[perf] ${def.name}: 自建标签 ${target.id} → ${url}`);
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  const pending = new Map();
  const events = { consoleErrors: [], exceptions: [], logErrors: [] };
  let sequence = 0;
  ws.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const entry = pending.get(message.id); pending.delete(message.id);
      if (message.error) entry.reject(new Error(JSON.stringify(message.error))); else entry.resolve(message.result || {});
    } else if (message.method === 'Runtime.exceptionThrown') {
      const d=message.params.exceptionDetails||{};
      events.exceptions.push({text:d.text||'exception',description:d.exception?.description||'',url:d.url||'',lineNumber:d.lineNumber??null});
    } else if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
      events.consoleErrors.push(message.params.args.map((x) => x.value ?? x.description ?? x.type).join(' ').slice(0, 400));
    } else if (message.method === 'Log.entryAdded' && message.params.entry?.level === 'error') {
      events.logErrors.push(message.params.entry.text?.slice(0, 400) || 'log error');
    }
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence; pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
    const timer = setTimeout(() => {
      if (pending.has(id)) { pending.delete(id); reject(new Error('CDP timeout: ' + method)); }
    }, 120_000);
    timer.unref?.();
  });
  const evaluate = async (expression) => {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, timeout: 120_000 });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text + ' ' + (result.exceptionDetails.exception?.description || ''));
    return result.result?.value;
  };
  try {
    await new Promise((resolve, reject) => {
      ws.onopen = resolve; ws.onerror = reject;
      setTimeout(() => reject(new Error('CDP websocket open timeout')), 10_000).unref?.();
    });
    // Domains must be enabled before navigation, as required for complete boot traces.
    await send('Runtime.enable'); await send('Network.enable'); await send('Log.enable'); await send('Page.enable');
    await send('Performance.enable'); await send('Profiler.enable');
    await send('Profiler.setSamplingInterval', { interval: 1000 });
    await send('Page.addScriptToEvaluateOnNewDocument', { source: NEW_DOCUMENT_PROBE });
    const emulation = def.mobile
      ? { width: 390, height: 844, deviceScaleFactor: 3, mobile: true, screenOrientation: { type: 'portraitPrimary', angle: 0 } }
      : { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false };
    await send('Emulation.setDeviceMetricsOverride', emulation);
    if (def.mobile) {
      await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
      await send('Emulation.setEmitTouchEventsForMouse', { enabled: true, configuration: 'mobile' }).catch(() => {});
    } else {
      await send('Emulation.setTouchEmulationEnabled', { enabled: false });
    }
    await send('Page.navigate', { url });

    let ready = false;
    for (let sec = 0; sec < 120; sec++) {
      await wait(1000);
      ready = await evaluate('!!window.__game && !!window.__game.renderer').catch(() => false);
      if (ready) break;
    }
    if (!ready) throw new Error('页面未在 120 秒内就绪');
    const setup = await evaluate(`(() => {
      const g = window.__game;
      g.setViewMode(false);
      g.loadLevel(${def.level});
      g.game.mode = 'play';
      g.game.sandbox = false;
      g.testState.godMode = true; // keeps the deterministic load scenario in play without changing AI/render load
      g.game.player.invuln = Infinity; // suppresses hits/camera shake while retaining active fox AI
      g.env.gustMax = 0; g.env.gust = 0; // keep the measured camera stationary; retain level visuals/geometry
      document.getElementById('overlay').hidden = true;
      document.body.classList.remove('paused');
      g.controller.teleport(0, 0, 0);
      g.game.player.x = 0; g.game.player.z = 0; g.game.player.invuln = Infinity;
      const layout = ${JSON.stringify(def.foxCoords)};
      g.foxesList().forEach((f, i) => {
        const p = layout[i % layout.length]; f.x = p[0]; f.z = p[1];
        f.vx = 0; f.vz = 0; f.state = 'roam'; f.timer = 0; f.dashVX = 0; f.dashVZ = 0;
        f.warn.visible = false; f.hpBar.visible = false;
      });
      g.companion.placeAt(1.2, -7.2);
      g.companion.rescued = true; g.companion.saved = false;
      g.game.friend.rescued = true; g.game.friend.saved = false;
      g.particles.burst(0, 0.5, 6, new g.THREE.Color(0xd6a1ff), 36, 1.3);
      g.shockwave.fire(0, 6, 7);
      g.damageText.spawn(0, 1.6, 8, '-8 生命', '#ffb2a2');
      const canvas = document.querySelector('#scene');
      window.__perfSetup = {
        mode: g.game.mode, level: g.game.level + 1, foxes: g.foxes().length,
        mobile: matchMedia('(pointer: coarse)').matches, dpr: devicePixelRatio,
        profile: g.renderProfile(), backend: g.renderer.isWebGLRenderer ? 'webgl2-forced' : 'unknown',
        canvas: [canvas.width, canvas.height], vegetationInstances: g.scenery?.grass?.count || null,
        overlayHidden: document.getElementById('overlay').hidden,
        thirdPerson: g.thirdPerson, controllerPosition: g.controller.position.toArray(), camera: { position: g.camera.position.toArray(), yaw: g.controller.yaw },
      };
      return window.__perfSetup;
    })()`);
    console.log(`[perf] ${def.name} setup ${JSON.stringify(setup)}`);
    if (def.heavy) {
      await evaluate(`(() => {
        const g=window.__game;
        window.__perfFxTimer = setInterval(() => {
          const x=5.5, z=-13, color=new g.THREE.Color(0xd6a1ff);
          g.particles.burst(x,0.5,z,color,18,1.15);
          g.shockwave.fire(x,z,6);
          g.damageText.spawn(x,1.6,z,'-8 生命','#ffb2a2');
          g.claw.fire(x,0.15,z,0,1.4,0xfff1a9);
        }, 1100);
      })()`);
    }
    await wait(1800);
    const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    fs.writeFileSync(path.join(OUT, `${tag}-${def.name}.png`), Buffer.from(shot.data, 'base64'));

    // Gather a short CPU profile only on the deliberately high-load scene.
    // Warm-up asset decode/shader compilation and transient launch frames are excluded.
    const instrumentation = `(() => {
      const g=window.__game, r=g.renderer;
      const nativeRender=r.render;
      const nativeViewRender=g.viewModel.render.bind(g.viewModel);
      window.__perfViewModelPasses=0;
      g.viewModel.render=function(...args){window.__perfViewModelPasses++;return nativeViewRender(...args)};
      window.__perfMainFrames=[];
      window.__perfHeap=[];
      window.__perfLongTasks=[];
      window.__perfGC=[];
      window.__perfBucket={passes:0,calls:0,triangles:0,lines:0,points:0,renderMs:0,geometries:0,textures:0};
      r.render=function(...args){
        const t=performance.now();
        try{return nativeRender.apply(this,args);}
        finally{
          const ms=performance.now()-t, info=this.info, b=window.__perfBucket;
          b.passes++; b.renderMs+=ms; b.calls+=info.render.calls||0;
          b.triangles+=info.render.triangles||0; b.lines+=info.render.lines||0; b.points+=info.render.points||0;
          b.geometries=info.memory.geometries||0; b.textures=info.memory.textures||0;
        }
      };
      const supports=PerformanceObserver.supportedEntryTypes||[];
      if(supports.includes('longtask')) new PerformanceObserver(list=>{window.__perfLongTasks.push(...list.getEntries().map(e=>({startTime:e.startTime,duration:e.duration})));if(window.__perfLongTasks.length>300)window.__perfLongTasks.splice(0,window.__perfLongTasks.length-250)}).observe({type:'longtask',buffered:true});
      if(supports.includes('gc')) new PerformanceObserver(list=>{window.__perfGC.push(...list.getEntries().map(e=>({startTime:e.startTime,duration:e.duration,kind:e.detail?.kind||null})));if(window.__perfGC.length>100)window.__perfGC.splice(0,window.__perfGC.length-80)}).observe({type:'gc',buffered:true});
      return {supportedEntryTypes:supports,longtask:supports.includes('longtask'),gc:supports.includes('gc')};
    })()`;
    const probeSupport = await evaluate(instrumentation);
    await wait(WARMUP_MS);
    if (def.adaptiveProbe) {
      await evaluate(`(() => {
        window.__perfPressure = {startedAt:performance.now(), durationMs:19000, intervalMs:70, busyMs:32, ticks:0};
        window.__perfAdaptiveTrace = [];
        window.__perfPressureTimer = setInterval(() => {
          const p=window.__perfPressure;
          if (performance.now()-p.startedAt >= p.durationMs) { clearInterval(window.__perfPressureTimer); p.stoppedAt=performance.now(); return; }
          const end=performance.now()+p.busyMs; let n=0; while(performance.now()<end) n+=Math.sqrt((n%97)+1);
          p.ticks++; p.work=n;
        }, window.__perfPressure.intervalMs);
        window.__perfAdaptiveTraceTimer = setInterval(() => {
          if (window.__game) window.__perfAdaptiveTrace.push({at:performance.now(), state:window.__game.adaptivePerformance()});
        }, 250);
      })()`);
    }
    await evaluate('window.__perfMainFrames=[]; window.__perfHeap=[]; window.__perfLongTasks=[]; window.__perfGC=[]; window.__perfLastMainStart=null; window.__perfMeasuring=true; window.__perfHeapTimer=setInterval(()=>window.__perfHeap.push({time:performance.now(),used:performance.memory?.usedJSHeapSize??null}),500); true');
    const beforeMetrics = await send('Performance.getMetrics');
    if (def.heavy) await send('Profiler.start').catch(() => {});
    let adaptiveProbeState = null;
    if (def.adaptiveProbe) {
      const stressCaptureAt = 25_000;
      await wait(stressCaptureAt);
      adaptiveProbeState = await evaluate('window.__game.adaptivePerformance()');
      const stressedShot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      fs.writeFileSync(path.join(OUT, `${tag}-adaptive-stressed.png`), Buffer.from(stressedShot.data, 'base64'));
      await wait(Math.max(0, (def.holdMs || HOLD_MS) - stressCaptureAt));
      const recoveredShot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      fs.writeFileSync(path.join(OUT, `${tag}-adaptive-recovered.png`), Buffer.from(recoveredShot.data, 'base64'));
    } else {
      await wait(def.holdMs || HOLD_MS);
    }
    const afterMetrics = await send('Performance.getMetrics');
    const samplesResult = await evaluate(`(() => ({
      frames:window.__perfMainFrames, heap:window.__perfHeap,
      longTasks:window.__perfLongTasks, gc:window.__perfGC,
      setup:{...window.__perfSetup, camera:{position:window.__game.camera.position.toArray(),yaw:window.__game.controller.yaw}},
      stateAtEnd:{mode:window.__game.game.mode,thirdPerson:window.__game.thirdPerson,foxes:window.__game.foxes().length,viewModelPasses:window.__perfViewModelPasses},
      adaptiveTransitions:window.__game.adaptiveTransitions.slice(),
      adaptivePerformance:window.__game.adaptivePerformance(),
      pressure:window.__perfPressure||null,
      adaptiveTrace:window.__perfAdaptiveTrace||[],
      support:${JSON.stringify(probeSupport)}, rafNames:window.__perfRafNames
    }))()`);
    let cpuProfile = null;
    if (def.heavy) {
      const stopped = await send('Profiler.stop').catch(() => ({}));
      cpuProfile = summarizeCpuProfile(stopped.profile);
    } else {
      await send('Profiler.stop').catch(() => {});
    }
    await evaluate('clearInterval(window.__perfFxTimer); clearInterval(window.__perfHeapTimer); window.__perfMeasuring=false; true').catch(() => {});
    const frames = (samplesResult.frames || []).filter((s) => s.dt > 0 && Number.isFinite(s.dt));
    const dts = frames.map((s) => s.dt);
    const callbackDurations = frames.map((s) => s.callbackMs);
    const sortedDts = dts.slice().sort((a,b)=>a-b);
    const sortedCallbackDurations = callbackDurations.slice().sort((a,b)=>a-b);
    const over20 = dts.filter((x) => x > 20).length;
    const over50 = dts.filter((x) => x > 50).length;
    const toMetricMap = (result) => Object.fromEntries((result.metrics || []).map((m) => [m.name, m.value]));
    const before = toMetricMap(beforeMetrics), after = toMetricMap(afterMetrics);
    const metricDelta = {};
    for (const key of ['TaskDuration','ScriptDuration','HeapUsedSize','JSHeapUsedSize','Nodes','JSEventListeners','LayoutDuration','RecalcStyleDuration']) {
      const a = after[key], b = before[key]; if (Number.isFinite(a) && Number.isFinite(b)) metricDelta[key] = +(a-b).toFixed(4);
    }
    const averageDt = mean(dts);
    const result = {
      scenario: def.name, viewport: emulation, durationSeconds: +(dts.reduce((s,x)=>s+x,0)/1000).toFixed(3),
      sampleCount: dts.length,
      fps: {
        average: dts.length ? +(dts.length / (dts.reduce((s,x)=>s+x,0) / 1000)).toFixed(2) : null,
        meanFrameMs: averageDt, p50FrameMs: pctl(sortedDts,.5), p95FrameMs: pctl(sortedDts,.95), worstFrameMs: dts.length ? +Math.max(...dts).toFixed(3) : null,
        over20msCount: over20, over20msPercent: dts.length ? +(100*over20/dts.length).toFixed(3) : null,
        over50msCount: over50, over50msPercent: dts.length ? +(100*over50/dts.length).toFixed(3) : null,
      },
      mainFrameCallbackMs: { count: callbackDurations.length, mean: mean(callbackDurations), p50: pctl(sortedCallbackDurations,.5), p95: pctl(sortedCallbackDurations,.95), worst: callbackDurations.length ? +Math.max(...callbackDurations).toFixed(3) : null },
      render: {
        passesPerFrame: mean(frames.map(s=>s.passes)), drawCallsPerFrame: mean(frames.map(s=>s.calls)), trianglesPerFrame: mean(frames.map(s=>s.triangles)),
        renderMsPerFrame: mean(frames.map(s=>s.renderMs)), p95RenderMsPerFrame: pctl(frames.map(s=>s.renderMs).sort((a,b)=>a-b),.95),
        geometries: frames.length ? frames[frames.length-1].geometries : null, textures: frames.length ? frames[frames.length-1].textures : null,
      },
      longTasks: { count: (samplesResult.longTasks||[]).length, totalMs: +((samplesResult.longTasks||[]).reduce((a,x)=>a+x.duration,0)).toFixed(2), durations: samplesResult.longTasks||[], over50msFrameOverlap: frames.filter(f=>f.dt>50 && (samplesResult.longTasks||[]).some(t=>f.timestamp>=t.startTime && f.timestamp-f.dt<=t.startTime+t.duration)).length, callbackOver50msOverlap: frames.filter(f=>f.callbackMs>50 && (samplesResult.longTasks||[]).some(t=>f.timestamp<=t.startTime+t.duration && f.timestamp+f.callbackMs>=t.startTime)).length },
      heap: { sampleCount:(samplesResult.heap||[]).length, firstUsedBytes:samplesResult.heap?.[0]?.used??null, lastUsedBytes:samplesResult.heap?.at(-1)?.used??null, minimumUsedBytes:Math.min(...(samplesResult.heap||[]).map(x=>x.used).filter(Number.isFinite)), maximumUsedBytes:Math.max(...(samplesResult.heap||[]).map(x=>x.used).filter(Number.isFinite)) },
      gc: { supported: !!samplesResult.support?.gc, count:(samplesResult.gc||[]).length, totalMs:+((samplesResult.gc||[]).reduce((a,x)=>a+x.duration,0)).toFixed(3), events:samplesResult.gc||[] },
      performanceMetricsDelta: metricDelta,
      setup: samplesResult.setup,
      stateAtEnd: samplesResult.stateAtEnd,
      adaptiveTransitions: samplesResult.adaptiveTransitions,
      adaptivePerformance: samplesResult.adaptivePerformance,
      pressure: samplesResult.pressure,
      adaptiveProbeState, adaptiveTrace: samplesResult.adaptiveTrace,
      instrumentationSupport: samplesResult.support,
      rafCallbackCounts: samplesResult.rafNames,
      cpuProfileTop: cpuProfile,
      errors: events,
      frameSamples: frames,
      heapSamples: samplesResult.heap || [],
    };
    fs.writeFileSync(path.join(OUT, `${tag}-${def.name}.json`), JSON.stringify(result,null,2));
    console.log(`[perf] ${def.name} RESULT ${JSON.stringify({fps:result.fps,render:result.render,mainFrameCallbackMs:result.mainFrameCallbackMs,setup:result.setup,metrics:result.performanceMetricsDelta,longTasks:result.longTasks.count,gc:result.gc.count})}`);
    return result;
  } finally {
    try { await fetch(`${CDP}/json/close/${target.id}`); } catch (_) {}
    try { ws.close(); } catch (_) {}
  }
}

let port = 8340;
async function startServer() {
  for (; port < 8350; port++) {
    try {
      await new Promise((resolve, reject) => {
        const onError = (err) => { server.off('listening', resolve); reject(err); };
        server.once('error', onError);
        server.listen(port, '127.0.0.1', () => { server.off('error', onError); resolve(); });
      });
      return port;
    } catch (e) {
      if (e.code !== 'EADDRINUSE') throw e;
    }
  }
  throw new Error('8340-8349 端口均被占用');
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const version = await jsonFetch(`${CDP}/json/version`);
  if (!version.Browser) throw new Error('CDP /json/version 缺少 Browser 信息');
  await startServer();
  console.log(`[perf] OpenClaw Chrome ${version.Browser}; embedded static server :${port}; hold=${HOLD_MS/1000}s + warmup=${WARMUP_MS/1000}s${probeAdaptive ? ' + adaptive probe' : ''}`);
  const scenarios = onlyAdaptive ? [] : [
    { name:'desktop', mobile:false, level:4, foxCoords:[[-7,-10],[-4,-12],[-1,-14],[2,-11],[5,-13],[7,-10]], heavy:false },
    { name:'mobile', mobile:true, level:4, foxCoords:[[-7,-10],[-4,-12],[-1,-14],[2,-11],[5,-13],[7,-10]], heavy:false },
    { name:'heavy', mobile:false, level:11, foxCoords:[[-8,-9],[-6,-12],[-4,-15],[-2,-10],[0,-13],[2,-16],[4,-10],[6,-13],[8,-16]], heavy:true },
  ];
  // Run the disruptive controlled-pressure probe last so it cannot contaminate
  // the three clean before/after scenarios or change their historical order.
  if (probeAdaptive) scenarios.push({ name:'adaptive-probe', mobile:false, level:4, foxCoords:[[-7,-10],[-4,-12],[-1,-14],[2,-11],[5,-13],[7,-10]], heavy:false, adaptiveProbe:true, holdMs:48_000 });
  const results = [];
  try {
    for (const def of scenarios) results.push(await scenario(def));
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
  const manifest = {
    tag, capturedAt: new Date().toISOString(), branch: 'codex/beta-smart-fox-20261021',
    commit: require('node:child_process').execFileSync('git',['rev-parse','HEAD'],{cwd:ROOT,encoding:'utf8'}).trim(),
    chrome: version.Browser, protocol: version['Protocol-Version'], userAgent: version['User-Agent'],
    host: `${process.platform}/${process.arch}`, node: process.version,
    measurement: { holdMs:HOLD_MS, warmupMs:WARMUP_MS, serverPort:port, path:'outputs/perf' },
    scenarios: results.map(r=>({name:r.scenario,fps:r.fps,render:r.render,mainFrameCallbackMs:r.mainFrameCallbackMs,setup:r.setup,stateAtEnd:r.stateAtEnd,adaptiveTransitions:r.adaptiveTransitions,adaptivePerformance:r.adaptivePerformance,pressure:r.pressure,performanceMetricsDelta:r.performanceMetricsDelta,longTasks:r.longTasks,gc:r.gc,cpuProfileTop:r.cpuProfileTop,errors:r.errors})),
  };
  fs.writeFileSync(path.join(OUT, `${tag}.json`), JSON.stringify(manifest,null,2));
  console.log(`[perf] wrote outputs/perf/${tag}.json and ${results.length} scenario screenshots / samples`);
}
main().catch((err) => { console.error('[perf] FATAL', err); try { server.close(); } catch (_) {} process.exitCode=1; });
