/** Production game QA. Own Chrome/CDP, never connects to shared 18800. */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const OUT = path.resolve('outputs/m3d-20261101-beta-marmot-upload/visual');
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const profile = fs.mkdtempSync(path.join(OUT, '.chrome-'));
  const chrome = spawn(process.env.CHROME_PATH || '/usr/bin/google-chrome', ['--headless=new', '--no-sandbox', '--no-first-run', '--disable-background-networking', '--disable-dev-shm-usage', '--disable-gpu', '--enable-unsafe-swiftshader', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
  let ws;
  try {
    const activePort = path.join(profile, 'DevToolsActivePort');
    for (let i = 0; i < 100 && !fs.existsSync(activePort); i++) await wait(100);
    const port = Number(fs.readFileSync(activePort, 'utf8').split('\n')[0]);
    assert.notEqual(port, 18800);
    const tabs = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    ws = new WebSocket(tabs.find((t) => t.type === 'page').webSocketDebuggerUrl);
    await new Promise((resolve) => ws.addEventListener('open', resolve, { once: true }));
    let id = 0;
    const pending = new Map(), exceptions = [];
    ws.addEventListener('message', (event) => {
      const m = JSON.parse(event.data);
      if (m.method === 'Runtime.exceptionThrown') exceptions.push(m.params);
      if (m.method === 'Runtime.consoleAPICalled' && process.env.M3D_QA_PROBE) console.error(m.params.type, m.params.args.map(a=>a.value||a.description).join(' '));
      if (!m.id || !pending.has(m.id)) return;
      const p = pending.get(m.id); pending.delete(m.id); clearTimeout(p.timer);
      if (m.error) p.reject(Error(JSON.stringify(m.error))); else p.resolve(m.result);
    });
    const send = (method, params = {}) => new Promise((resolve, reject) => {
      const n = ++id;
      const timer = setTimeout(() => { pending.delete(n); reject(Error(`${method} timeout`)); }, 60000);
      pending.set(n, { resolve, reject, timer }); ws.send(JSON.stringify({ id: n, method, params }));
    });
    const ev = async (expression) => {
      const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails));
      return r.result?.value;
    };
    await send('Runtime.enable'); await send('Page.enable');
    await send('Page.addScriptToEvaluateOnNewDocument', {source: 'let qaSeed=20261101;Math.random=()=>{qaSeed=(Math.imul(qaSeed,1664525)+1013904223)>>>0;return qaSeed/4294967296;};'});
    await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
    await send('Page.navigate', { url: process.env.M3D_QA_URL || 'http://127.0.0.1:8767/index.html?version=beta' });
    let ready = false;
    for (let i = 0; i < 180; i++) {
      await wait(500);
      ready = await ev('!!(window.__game?.playerRig && window.__game.companion?.rig)');
      if (ready) break;
    }
    assert.ok(ready, 'production player and companion must both load uploaded rigs');
    await ev(`(() => {
      const g = window.__game;
      g.qaPaused = true;
      document.getElementById('startBtn')?.click();
      g.game.mode = 'play'; g.setViewMode(true);
      g.foxes().forEach(f => f.alive = false);
      g.game.player.hp = 100; g.game.player.energy = 80;
      g.sky.update(g.controller.position, 0);
      return true;
    })()`);
    const sample = () => ev(`(() => {
      const g = window.__game;
      const read = (rig, actor) => {
        actor.updateMatrixWorld(true);
        const skins = []; rig.root.traverse(o => { if(o.isSkinnedMesh) { o.skeleton.update(); skins.push(o); } });
        const skin = skins[0], p = new g.THREE.Vector3();
        const verts = [0, Math.floor(skin.geometry.attributes.position.count / 3), Math.floor(skin.geometry.attributes.position.count * 2 / 3)].map(i => skin.getVertexPosition(i, p).toArray());
        const box = new g.THREE.Box3().setFromObject(rig.root, true);
        const head=skin.skeleton.bones.find(b=>b.name==='Head').getWorldPosition(new g.THREE.Vector3());
        const tail=skin.skeleton.bones.find(b=>b.name==='Tail').getWorldPosition(new g.THREE.Vector3());
        return { clip: rig.activeClip, time: rig.actions.get(rig.activeClip).time, mixerTime: rig.mixer.time,
          forward:head.sub(tail).toArray(),speed: rig.speed, state: rig.state, pos: actor.position.toArray(),
          bones: skin.skeleton.bones.map(b => ({name:b.name,q:b.quaternion.toArray(),p:b.position.toArray()})), verts,
          bounds: { min:box.min.toArray(),max:box.max.toArray() },
          skinCount:skins.length,joints:skin.skeleton.bones.length, texturing:!!skin.material.map,
          actions:[...rig.actions].map(([name,a])=>({name,time:a.time,weight:a.getEffectiveWeight(),running:a.isRunning()})) };
      };
      const gl=g.renderer.getContext(), ext=gl.getExtension('WEBGL_debug_renderer_info');
      return { player:read(g.playerRig,g.playerModel), companion:read(g.companion.rig,g.companion.group),
        companionSpeed:g.companion._lastFollowSpeed, backend:{contextLost:gl.isContextLost(),version:gl.getParameter(gl.VERSION),webgl2:g.renderer.capabilities.isWebGL2,renderer:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER)},
        mode:g.game.mode, forage:g.controller.forcedProne, gameTime:g.game.totalTime };
    })()`);
    // All steps below drive the existing production update; no clip setter is called.
    const setup = async (scenario) => ev(`(() => {
      const g=window.__game,c=g.controller, friend=g.companion;
      for(const code of g.keys)window.dispatchEvent(new KeyboardEvent('keyup',{code}));
      g.keys.clear(); c.velocity.set(0,0,0); c.externalVelocity.set(0,0,0);
      c.yaw=0; c.moveFacingYaw=0; c.bodyYaw=0;
      // Open terrain away from the burrow. Plant state is production scenery.
      c.teleport(8,8,0);
      friend.placeAt(25,8); friend.emote=null; friend.saved=false;
      g.game.friend.rescued=false; g.game.friend.saved=false;
      g.game.player.hp=100; g.game.player.energy=80;
      g.game.mode='play'; g.game.time=999;
      return true;
    })()`);
    const tick = (frames = 1) => ev(`(() => { const g=window.__game,trace=[]; for(let i=0;i<${frames};i++){g.qaStep(1/60);trace.push({frame:i,speed:g.companion._lastFollowSpeed,clip:g.companion.activeClip,x:g.companion.x,z:g.companion.z});}return trace;})()`);
    const frame = async () => { await ev('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))'); };
    const capture = async (name) => {
      await frame();
      const shot = await send('Page.captureScreenshot', { format: 'png', fromSurface: true });
      const file = `${name}.png`; fs.writeFileSync(path.join(OUT, file), Buffer.from(shot.data, 'base64')); return file;
    };
    const backend = (await sample()).backend;
    assert.equal(backend.contextLost, false, 'render context must be live');
    const matrix = [];
    for (const [width,height] of [[1280,720],[768,1024],[390,844]]) {
      await send('Emulation.setDeviceMetricsOverride', { width,height,deviceScaleFactor:1,mobile:false });
      for (const scenario of ['player-idle','player-run','player-sprint','player-graze','companion-idle','companion-follow','companion-stop','companion-alert']) {
        await setup(scenario);
        if (scenario === 'player-run' || scenario === 'player-sprint') await ev(`window.__game.keys.add('KeyW');${scenario === 'player-sprint' ? "window.__game.keys.add('ShiftLeft');" : ''}`);
        if (scenario === 'player-graze') {
          // Use an actual production grass food node and the held interact binding.
          await ev(`(() => {const g=window.__game;let found=null;for(let x=4;x<30&&!found;x+=0.5)for(let z=4;z<20&&!found;z+=0.5)if(g.scenery.hasGrazeable(x,z,0.5,0)&&g.berries().every(b=>b.taken||Math.hypot(b.x-x,b.z-z)>3.5))found={x,z};if(!found)throw Error('No production grass');g.controller.teleport(found.x,found.z,0);window.dispatchEvent(new KeyboardEvent('keydown',{code:g.binds.keys('interact')[0]}));return true})()`);
        }
        if (scenario === 'companion-follow' || scenario === 'companion-stop') await ev(`(() => {const g=window.__game,c=g.companion;c.placeAt(8,2);c.rescued=true;g.game.friend.rescued=true;return true})()`);
        if (scenario === 'companion-alert') await ev(`window.__game.companion.placeAt(13,8);window.__game.companion.showEmote('exclaim')`);
        const trace = await tick(scenario === 'companion-stop' ? 120 : 20);
        if(scenario === 'companion-stop') {
          assert.ok(trace.some(t=>t.speed>0.05&&t.clip==='Run'));
          const arrival=trace.findIndex(t=>t.speed===0);
          assert.ok(arrival>0);assert.ok(trace.slice(arrival).every(t=>t.speed===0&&t.clip==='StandIdle'));
        }
        await frame();
        // Camera only: frame the production actor closely, preserving the world/HUD.
        await ev(`(() => {const g=window.__game,isFriend=${scenario.startsWith('companion')},o=isFriend?g.companion.group:g.playerModel;g.camera.position.set(o.position.x+2.1,o.position.y+1.25,o.position.z+2.7);g.camera.lookAt(o.position.x,o.position.y+0.48,o.position.z);g.camera.updateMatrixWorld(true);return true})()`);
        const before = await sample();
        const screenshot = await capture(`${scenario}__${width}x${height}`);
        await tick(7);
        await frame();
        const after = await sample();
        fs.writeFileSync(path.join(OUT,'latest-case.json'),JSON.stringify({scenario,before,after},null,2));
        const secondScreenshot = ['player-run','player-graze','companion-follow'].includes(scenario) ? await capture(`${scenario}-motion__${width}x${height}`) : null;
        const target = scenario.startsWith('companion') ? 'companion' : 'player';
        const expected = ['player-run','player-sprint','player-graze','companion-follow'].includes(scenario) ? 'Run' : scenario === 'companion-alert' ? 'StandUp' : 'StandIdle';
        assert.equal(before[target].clip, expected, `${scenario} before`);
        assert.equal(after[target].clip, expected, `${scenario} after`);
        assert.ok(after[target].mixerTime > before[target].mixerTime, `${scenario} mixer advances`);
        assert.notDeepEqual(before[target].bones, after[target].bones, `${scenario} skin bones change`);
        assert.notDeepEqual(before[target].verts, after[target].verts, `${scenario} skin vertices deform`);
        assert.ok(Math.abs(before[target].bounds.min[1]-before[target].pos[1])<1e-6,`${scenario} ground contact`);
        if(scenario==='player-run'||scenario==='companion-follow') {
          const dx=after[target].pos[0]-before[target].pos[0],dz=after[target].pos[2]-before[target].pos[2];
          assert.ok(before[target].forward[0]*dx+before[target].forward[2]*dz>0,`${scenario} faces displacement`);
        }
        assert.equal(before.backend.contextLost,false);assert.equal(after.backend.contextLost,false);
        assert.equal(before[target].skinCount,1); assert.equal(before[target].joints,12); assert.ok(before[target].texturing);
        if (scenario === 'companion-stop') assert.equal(before.companionSpeed, 0);
        if (scenario === 'companion-follow') assert.ok(before.companionSpeed > 0.05);
        matrix.push({scenario,width,height,screenshot,secondScreenshot,trace,before,after});
        console.log(`PASS ${scenario} ${width}x${height} ${expected} speed=${before[target].speed.toFixed(3)}`);
      }
    }
    assert.equal(exceptions.length,0, 'no unhandled production exceptions');
    fs.writeFileSync(path.join(OUT,'manifest.json'),JSON.stringify({url:process.env.M3D_QA_URL||'http://127.0.0.1:8767/index.html?version=beta', chromePort:port,softwareRenderer:true,deviceEmulation:false,exceptions,matrix},null,2));
  } finally {
    ws?.close(); chrome.kill('SIGTERM');
    await new Promise(resolve=>chrome.once('exit',resolve));
    fs.rmSync(profile,{recursive:true,force:true});
  }
})().catch(e=>{console.error(e);process.exitCode=1});
