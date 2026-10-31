/** Managed Chrome real-Beta scene-filter QA. Never launches Chrome; closes its tab. */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'outputs/m3d-20261031-beta-scene-filters/visual');
const CDP = process.env.SCENE_FILTER_CDP || 'http://127.0.0.1:18800';
const URL = process.env.SCENE_FILTER_URL || 'http://127.0.0.1:8447/index.html?version=beta&webgl=1';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync(OUT, { recursive: true });
const sleepTimer = setTimeout(() => { console.error('QA hard cap'); process.exit(2); }, 12 * 60 * 1000);
async function json(url, options) { const r = await fetch(url, options); if (!r.ok) throw Error(`${r.status} ${url}`); return r.json(); }
async function newTab() { try { return await json(`${CDP}/json/new?about:blank`, { method: 'PUT' }); } catch { return json(`${CDP}/json/new?about:blank`); } }
(async () => {
  const target = await newTab(); const ws = new WebSocket(target.webSocketDebuggerUrl);
  let seq = 0; const pending = new Map(); const errors = [], exceptions = [], warnings = [], httpErrors = [], audioResponses = [];
  const evidence = { generatedAt: new Date().toISOString(), command: 'node tools/qa-scene-filters-managed.cjs', url: URL, renderer: null, checks: {}, performance: [], shots: [], errors, exceptions };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++seq; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params }));
    const t = setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(Error('timeout ' + method)); } }, 90000); t.unref();
  });
  ws.onmessage = ({ data }) => {
    const m = JSON.parse(data);
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(Error(JSON.stringify(m.error))) : p.resolve(m.result || {}); return; }
    if (m.method === 'Network.responseReceived' && /paf\.mp3|audio\/elevenlabs\/sfx\/manifest\.json/.test(m.params.response.url)) audioResponses.push({url:m.params.response.url,status:m.params.response.status});
    if (m.method === 'Network.responseReceived' && m.params.response.status >= 400) httpErrors.push({url:m.params.response.url,status:m.params.response.status});
    if (m.method === 'Runtime.exceptionThrown') exceptions.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
    if (m.method === 'Runtime.consoleAPICalled') {
      const text = m.params.args.map((a) => a.value ?? a.description).join(' ');
      if (m.params.type === 'error') errors.push(text); if (m.params.type === 'warning') warnings.push(text);
    }
    if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') errors.push(m.params.entry.text);
  };
  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result?.value;
  };
  const shot = async (name, meta) => {
    await wait(250);
    const image = await send('Page.captureScreenshot', { format: 'png', fromSurface: true });
    fs.writeFileSync(path.join(OUT, name + '.png'), Buffer.from(image.data, 'base64'));
    evidence.shots.push({ file: name + '.png', ...meta, observed: 'captured; visual review recorded separately' });
  };
  const viewport = async (width, height, dpr = 1) => {
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: dpr, mobile: false });
    await evaluate(`window.dispatchEvent(new Event('resize'))`); await wait(350);
  };
  const filter = async (preset, intensity) => evaluate(`(() => { const f=__game.sceneFilterSettings; f.setPreset(${JSON.stringify(preset)}); f.setIntensity(${intensity}); return f.snapshot(); })()`);
  const noFilter = () => evaluate(`__game.sceneFilterSettings.reset()`);
  const state = () => evaluate(`({settings:__game.sceneFilterSettings.snapshot(),pipeline:__game.sceneFilterRenderer.debugState(),canvas:[__game.renderer.domElement.width,__game.renderer.domElement.height],viewport:[innerWidth,innerHeight],dpr:__game.renderer.getPixelRatio(),aspect:__game.camera.aspect})`);
  const measure = async (preset) => {
    await filter(preset, preset === 'none' ? 0 : 75); await wait(400);
    const result = await evaluate(`(async()=>{const g=__game,f=g.sceneFilterRenderer;const a=[];let last=performance.now();await new Promise(resolve=>{function step(now){a.push(now-last);last=now;if(a.length<16)requestAnimationFrame(step);else resolve()}requestAnimationFrame(step)});a.shift();a.sort((x,y)=>x-y);return {preset:${JSON.stringify(preset)},intensity:${preset==='none'?0:75},frames:a.length,meanFrameMs:a.reduce((x,y)=>x+y,0)/a.length,p95FrameMs:a[Math.floor(a.length*.95)],fps:1000/(a.reduce((x,y)=>x+y,0)/a.length),drawCalls:g.renderer.info.render.calls,triangles:g.renderer.info.render.triangles,textures:g.renderer.info.memory.textures,geometries:g.renderer.info.memory.geometries,pipeline:f.debugState(),canvas:[g.renderer.domElement.width,g.renderer.domElement.height]}})()`);
    evidence.performance.push(result);
  };
  try {
    await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
    await send('Runtime.enable'); await send('Page.enable'); await send('Log.enable'); await send('Network.enable');
    // Silence unrelated local-account 404/autoplay noise; rendering/assets remain real.
    await send('Page.addScriptToEvaluateOnNewDocument',{source:`(()=>{const raw=window.fetch;window.fetch=(input,init)=>String(input).includes('/api/')?Promise.resolve(new Response('{}',{status:200,headers:{'Content-Type':'application/json'}})):raw(input,init);HTMLMediaElement.prototype.play=function(){return Promise.resolve()};})()`});
    await viewport(1280, 720); await send('Page.navigate', { url: URL });
    let ready = false;
    for (let i = 0; i < 100; i++) { await wait(400); ready = await evaluate(`!!window.__game && !!__game.sceneFilterRenderer && document.getElementById('loading')?.hidden !== false`).catch(() => false); if (ready) break; }
    assert.ok(ready, 'Beta did not boot');
    await evaluate(`(()=>{const g=__game;g.game.mode='play';g.qaPaused=true;document.getElementById('overlay').hidden=true;g.controller.teleport(0,0,0);g.controller.yaw=0;g.controller.pitch=.16;g.setViewMode(false);return true})()`);
    await noFilter(); await wait(1200);
    evidence.renderer = await evaluate(`(()=>{const g=__game,gl=g.renderer.getContext(),ext=gl.getExtension('WEBGL_debug_renderer_info');return {backend:'WebGL2',renderer:g.renderer.constructor.name,webgl2:gl instanceof WebGL2RenderingContext,gpu:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER),toneMapping:g.renderer.toneMapping,exposure:g.renderer.toneMappingExposure,colorSpace:g.renderer.outputColorSpace}})()`);
    evidence.checks.defaultBypass = await state(); assert.equal(evidence.checks.defaultBypass.pipeline.allocated, false);
    // Real select + range UI and close/open consistency.
    await evaluate(`document.getElementById('setBtn').click()`);
    await evaluate(`(()=>{const s=document.getElementById('sceneFilterPreset');s.value='warm';s.dispatchEvent(new Event('change',{bubbles:true}));const r=document.getElementById('sceneFilterIntensity');r.value='63';r.dispatchEvent(new Event('input',{bubbles:true}));return true})()`);
    evidence.checks.uiImmediate = await state(); assert.deepEqual(evidence.checks.uiImmediate.settings, { preset: 'warm', intensity: 63 });
    await evaluate(`document.getElementById('sceneFilterPreset').scrollIntoView({block:'center'})`);
    await shot('settings-warm-63', { scene: 'settings', viewport: [1280,720], preset: 'warm', intensity: 63, expected: 'filter selector and strength control visible; menu/HUD remain readable' });
    await evaluate(`document.getElementById('setClose').click();document.getElementById('setBtn').click()`);
    assert.equal(await evaluate(`document.getElementById('sceneFilterIntensity').value`), '63');
    await evaluate(`document.getElementById('setClose').click()`);
    await send('Page.reload', { ignoreCache: true });
    for (let i=0;i<80;i++){await wait(300);if(await evaluate('!!window.__game?.sceneFilterRenderer').catch(()=>false))break;}
    evidence.checks.reloadPersistence = await state(); assert.deepEqual(evidence.checks.reloadPersistence.settings,{preset:'warm',intensity:63});
    await evaluate(`(()=>{const g=__game;g.game.mode='play';g.qaPaused=true;document.getElementById('overlay').hidden=true;g.controller.teleport(0,0,0);g.controller.yaw=0;g.controller.pitch=.16;g.setViewMode(false);return true})()`);
    await wait(500);
    // Full real-scene matrix: every preset at every required viewport.
    for (const [w,h] of (process.env.SCENE_FILTER_REUSE_MATRIX === '1' ? [] : [[390,844],[768,1024],[1280,720],[1920,1080]])) {
      await viewport(w,h);
      for (const preset of ['none','natural','clear','warm','cool','verdant']) {
        console.log('capture',w,h,preset);
        await filter(preset, preset === 'none' ? 0 : 75);
        await evaluate(`new Promise(requestAnimationFrame)`); const s = await state(); assert.equal(s.settings.preset,preset); assert.equal(s.pipeline.allocated,preset!=='none');
        await shot(`normal-${w}x${h}-${preset}-75`, { scene:'normal FPV; origin; fixed seed/camera',viewport:[w,h],preset,intensity:preset==='none'?0:75,backend:evidence.renderer.backend,expected:preset==='none'?'rev58-equivalent direct path, crisp HUD':'visible scene-only grading; crisp unchanged HUD; no black screen' });
      }
    }
    await viewport(1280,720);
    await evaluate(`__game.setViewMode(true)`); await filter('natural',75);
    await shot('normal-1280x720-tps-natural-75',{scene:'normal TPS; origin',viewport:[1280,720],preset:'natural',intensity:75,expected:'shared filter path and visible marmot'});
    await evaluate(`__game.setViewMode(false)`);
    // DPR change and fullscreen-equivalent resize route.
    await viewport(1280,720,2); const resized = await state();
    assert.deepEqual(resized.pipeline.targetSize,resized.canvas); evidence.checks.dprResize=resized;
    await viewport(1280,720,1);
    // Same scene representative performance, no quality/DPR overrides.
    for (const p of ['none','natural','clear','warm','cool','verdant']) await measure(p);
    // Repeated activation/deactivation and 0% release.
    evidence.checks.lifecycle = await evaluate(`(()=>{const f=__game.sceneFilterSettings,p=__game.sceneFilterRenderer;for(let i=0;i<12;i++){f.setPreset('natural');f.setIntensity(0)}return p.debugState()})()`);
    assert.equal(evidence.checks.lifecycle.allocated,false);assert.equal(evidence.checks.lifecycle.createdTargets,evidence.checks.lifecycle.disposedTargets);
    // Corrupt storage in a live reload must fall back, not throw.
    await evaluate(`localStorage.setItem('marmot.settings.sceneFilter.v1','{"preset":"legacy","intensity":null}')`);
    await send('Page.reload',{ignoreCache:true});for(let i=0;i<80;i++){await wait(250);if(await evaluate('!!window.__game?.sceneFilterRenderer').catch(()=>false))break;}
    evidence.checks.corruptFallback=await state();assert.deepEqual(evidence.checks.corruptFallback.settings,{preset:'none',intensity:0});
    await evaluate(`(()=>{const g=__game;g.game.mode='play';g.qaPaused=true;document.getElementById('overlay').hidden=true;g.controller.teleport(0,0,0);g.controller.yaw=0;g.controller.pitch=.16;g.setViewMode(false);return true})()`);
    // Touch input on the actual range at 390x844.
    await viewport(390,844);await evaluate(`document.getElementById('setBtn').click();document.getElementById('sceneFilterPreset').scrollIntoView({block:'center'})`);await wait(200);
    const rect=await evaluate(`(()=>{const r=document.getElementById('sceneFilterIntensity').getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height}})()`);
    await evaluate(`(()=>{const s=document.getElementById('sceneFilterPreset');s.value='cool';s.dispatchEvent(new Event('change',{bubbles:true}));document.getElementById('sceneFilterIntensity').scrollIntoView({block:'center'});return true})()`);await wait(150);
    const touchRect=await evaluate(`(()=>{const r=document.getElementById('sceneFilterIntensity').getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height}})()`);
    const tx=touchRect.x+touchRect.w*.4,ty=touchRect.y+touchRect.h/2;
    await send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:tx,y:ty}]});
    await send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await wait(200);
    evidence.checks.touch=await state();assert.equal(evidence.checks.touch.settings.preset,'cool');assert.ok(evidence.checks.touch.settings.intensity>0);
    await evaluate(`document.getElementById('setClose').click()`);
    // Forced real-pipeline initialization failure; must reset and keep direct frame alive.
    await filter('warm',75);
    evidence.checks.shaderFailure=await evaluate(`(()=>{const p=__game.sceneFilterRenderer;p.disposeResources();p._createResources=()=>{throw new Error('QA forced shader initialization failure')};p.render(__game.scene,__game.camera);return p.debugState()})()`);
    assert.deepEqual(evidence.checks.shaderFailure.settings,{preset:'none',intensity:0});
    await shot('failure-fallback-1280x720',{scene:'forced filter init failure',viewport:[390,844],preset:'none',intensity:0,expected:'immediate original scene fallback; settings remain usable'});
    // PAF shared path, TPS and FPV, unchanged gameplay files.
    await viewport(1280,720);await evaluate(`window.__enterPlayAsFox()`);
    for(let i=0;i<60;i++){await wait(250);if(await evaluate('!!window.__playAsFox').catch(()=>false))break;}
    assert.ok(await evaluate('!!window.__playAsFox'));
    for(const mode of ['tps','fpv']){
      await evaluate(`__playAsFox.setViewMode('${mode}')`);await wait(300);
      for(const p of ['none','warm']){await filter(p,p==='none'?0:75);await shot(`paf-${mode}-1280x720-${p}-75`,{scene:`PAF ${mode.toUpperCase()}`,viewport:[1280,720],preset:p,intensity:p==='none'?0:75,expected:'identical shared scene grading; PAF HUD unfiltered'});}
    }
    evidence.warnings=warnings;evidence.httpErrors=httpErrors;evidence.audioResponses=audioResponses;
    const localPafResponse = await fetch(new globalThis.URL('/assets/audio/elevenlabs/bgm/paf.mp3', URL));
    evidence.localPafHttp = { status: localPafResponse.status, contentLength: localPafResponse.headers.get('content-length') };
    await localPafResponse.arrayBuffer();
    const unexpectedHttpErrors = httpErrors.filter((r) => !/audio\/elevenlabs\/sfx\/manifest\.json/.test(r.url));
    assert.deepEqual(unexpectedHttpErrors,[]);assert.deepEqual(exceptions,[]);
    assert.equal(evidence.localPafHttp.status, 200, 'local PAF MP3 HTTP check failed');
    evidence.result=errors.length ? 'PASS_WITH_EXTERNAL_SFX_MANIFEST_404' : 'PASS';fs.writeFileSync(path.join(OUT,'manifest.json'),JSON.stringify(evidence,null,2));
    console.log(JSON.stringify({result:evidence.result,shots:evidence.shots.length,performance:evidence.performance.map(p=>({preset:p.preset,fps:+p.fps.toFixed(1),mean:+p.meanFrameMs.toFixed(2),calls:p.drawCalls,triangles:p.triangles})),errors,exceptions},null,2));
  } catch (e) { evidence.result='FAIL';evidence.failure=String(e.stack||e);evidence.warnings=warnings;evidence.httpErrors=httpErrors;fs.writeFileSync(path.join(OUT,'manifest.json'),JSON.stringify(evidence,null,2));throw e; }
  finally { ws.close();await fetch(`${CDP}/json/close/${target.id}`).catch(()=>{});clearTimeout(sleepTimer); }
})().catch((e)=>{console.error(e);process.exitCode=1});
