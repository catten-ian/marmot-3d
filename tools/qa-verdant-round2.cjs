/**
 * Managed-CDP round-2 Verdant geometry/camera verification.
 *
 * This is deliberately a fresh target (not an old local/public tab) and keeps
 * the visual-ground / heightJson / collision-field samples in the report.
 */
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'outputs', 'scene-assembly-qa', 'round2');
const RUNTIME_OUT = path.join(ROOT, 'outputs', 'scene-assembly-qa', 'runtime-grounding.json');
const BACKEND_OUT = path.join(OUT, 'backend-errors.json');
const CDP = process.env.CDP_URL || 'http://127.0.0.1:18800';
const TIER = process.env.TIER || 'low';
const PORT = Number(process.env.QA_PORT || 0);
fs.mkdirSync(OUT, { recursive: true });
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.glb': 'model/gltf-binary', '.bin': 'application/octet-stream',
  '.hdr': 'application/octet-stream', '.woff2': 'font/woff2',
};
const server = http.createServer((req, res) => {
  let rel;
  try { rel = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname); }
  catch (_) { res.writeHead(400).end(); return; }
  if (rel === '/') rel = '/index.html';
  const file = path.resolve(ROOT, `.${rel}`);
  if (!file.startsWith(ROOT + path.sep) && file !== path.join(ROOT, 'index.html')) {
    res.writeHead(403).end(); return;
  }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404).end('not found'); return; }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    res.end(data);
  });
});
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const getJson = async (url) => (await (await fetch(url)).json());

class Cdp {
  constructor(url) { this.url = url; this.seq = 0; this.pending = new Map(); this.events = []; }
  async open() {
    this.ws = new WebSocket(this.url);
    this.ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && this.pending.has(msg.id)) {
        const p = this.pending.get(msg.id); this.pending.delete(msg.id);
        if (msg.error) p.reject(new Error(JSON.stringify(msg.error).slice(0, 400)));
        else p.resolve(msg);
      } else if (msg.method) this.events.push(msg);
    };
    await new Promise((resolve, reject) => {
      this.ws.onopen = resolve; this.ws.onerror = reject;
    });
  }
  send(method, params = {}, sessionId = null, timeout = 15000) {
    return new Promise((resolve, reject) => {
      const id = ++this.seq;
      const timer = setTimeout(() => {
        this.pending.delete(id); reject(new Error(`CDP timeout ${method}`));
      }, timeout);
      this.pending.set(id, {
        resolve: (value) => { clearTimeout(timer); resolve(value); },
        reject: (error) => { clearTimeout(timer); reject(error); },
      });
      const msg = { id, method, params };
      if (sessionId) msg.sessionId = sessionId;
      this.ws.send(JSON.stringify(msg));
    });
  }
  drain(sessionId) {
    const out = [];
    this.events = this.events.filter((event) => {
      if (event.sessionId === sessionId) { out.push(event); return false; }
      return true;
    });
    return out;
  }
  close() { try { this.ws.close(); } catch (_) {} }
}

function collectErrors(events, errors, warnings) {
  for (const event of events) {
    if (event.method === 'Runtime.exceptionThrown') {
      errors.push((event.params.exceptionDetails?.exception?.description
        || event.params.exceptionDetails?.text || 'uncaught exception').slice(0, 600));
    } else if (event.method === 'Runtime.consoleAPICalled') {
      const text = (event.params.args || []).map((a) => a.value ?? a.description ?? a.type).join(' ').slice(0, 600);
      if (event.params.type === 'error') errors.push(text);
      else if (event.params.type === 'warning') warnings.push(text);
    } else if (event.method === 'Log.entryAdded' && event.params.entry?.level === 'error') {
      errors.push((event.params.entry.text || 'log error').slice(0, 600));
    }
  }
}

async function main() {
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(PORT, '127.0.0.1', resolve); });
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const url = `${baseUrl}/index.html?version=dev&webgl=1&models=off&tos=0&verdantTier=${encodeURIComponent(TIER)}&qaRound=2&t=${Date.now()}`;
  const report = {
    round: 2, tier: TIER, url, startedAt: new Date().toISOString(), shots: [],
    errors: [], warnings: [], checks: {}, groundingAudit: null,
  };
  let browser = null; let targetId = null; let sessionId = null;
  try {
    const version = await getJson(`${CDP}/json/version`);
    browser = new Cdp(version.webSocketDebuggerUrl); await browser.open();
    const created = await browser.send('Target.createTarget', { url: 'about:blank' });
    targetId = created.result.targetId;
    const attached = await browser.send('Target.attachToTarget', { targetId, flatten: true });
    sessionId = attached.result.sessionId;
    for (const method of ['Runtime.enable', 'Page.enable', 'Log.enable', 'Network.enable']) {
      await browser.send(method, {}, sessionId);
    }
    await browser.send('Emulation.setDeviceMetricsOverride', {
      width: 1280, height: 720, deviceScaleFactor: 1, mobile: false,
    }, sessionId);
    await browser.send('Page.navigate', { url }, sessionId, 20000);

    const evaluate = async (expression, timeout = 90000) => {
      const result = await browser.send('Runtime.evaluate', {
        expression, returnByValue: true, awaitPromise: true,
      }, sessionId, timeout);
      if (result.result?.exceptionDetails) {
        throw new Error(result.result.exceptionDetails.text || 'Runtime.evaluate exception');
      }
      return result.result?.result?.value;
    };
    // The GLB rasterizer is intentionally synchronous. During that phase a
    // Runtime.evaluate can queue behind the main thread, so poll patiently and
    // treat individual timeouts as expected loading rather than as a hard fail.
    let ready = null;
    const waitStarted = Date.now();
    for (let i = 0; i < 360; i++) {
      collectErrors(browser.drain(sessionId), report.errors, report.warnings);
      try {
        ready = await evaluate(`(() => {
          const g = window.__game;
          const env = g?.scene?.getObjectByName?.('VerdantTrailEnvironment');
          return { game: !!g, env: !!env, frame: g?.renderer?.info?.render?.frame || 0 };
        })()`, 6000);
      } catch (_) { ready = null; }
      if (ready?.game && ready?.env && ready.frame > 5) break;
      await sleep(1000);
    }
    report.readyAfterSeconds = Number(((Date.now() - waitStarted) / 1000).toFixed(1));
    console.log('ready state', JSON.stringify(ready), 'after', report.readyAfterSeconds, 's');
    if (!ready?.game || !ready?.env) throw new Error(`game not ready after ${report.readyAfterSeconds}s`);
    await sleep(2500);
    console.log('clicking start');
    // The start handler does heavy synchronous work (field build under
    // SwiftShader can exceed any evaluate timeout), so dispatch the click
    // asynchronously and return immediately, then poll for play mode.
    await evaluate(`(() => { setTimeout(() => document.getElementById('startBtn')?.click(), 0); return true; })()`, 15000);
    console.log('start dispatched');
    let playing = false;
    for (let i = 0; i < 600; i++) {
      try {
        playing = await evaluate(`(() => window.__game?.game?.mode === 'play')()`, 30000);
      } catch (_) { playing = false; }
      if (playing) break;
      await sleep(1000);
    }
    console.log('play mode after start:', playing);
    if (!playing) throw new Error('game did not enter play mode after start');
    await sleep(7000);
    console.log('phase: initialSpawn');
    report.checks.initialSpawn = await evaluate(`(() => {
      const g = window.__game, c = g.controller, f = window.__verdantField;
      const p = c.position; const rg = f?.resolveGround?.(p.x, p.z);
      document.getElementById('overlay')?.setAttribute('hidden', '');
      window.__qaSpawn = { x: p.x, z: p.z };
      return { mode: g.game.mode, spawn: { x: p.x, y: p.y, z: p.z },
        heightAt: f?.heightAt?.(p.x, p.z) ?? null, resolveGround: rg ?? null,
        walkable: rg?.walkable ?? null };
    })()`);

    const place = async (x, z, yaw, pitch, third) => evaluate(`(() => {
      const g = window.__game, c = g.controller, f = window.__verdantField;
      const requested = { x: ${x}, z: ${z} };
      const safe = f?.nearestWalkable?.(${x}, ${z}) || requested;
      const h = f?.resolveGround?.(safe.x, safe.z)?.y ?? g.terrainHeight(safe.x, safe.z);
      g.game.mode = 'play'; g.setViewMode(${third});
      c.position.set(safe.x, h, safe.z); c.yaw = ${yaw}; c.pitch = ${pitch};
      c.bodyYaw = ${yaw}; c.moveFacingYaw = ${yaw}; c.velocity.set(0, 0, 0);
      c.externalVelocity.set(0, 0, 0); c.vy = 0; c.grounded = true; c.airHeight = 0;
      c.cameraDistance = 5.4; c.cameraHeight = 2.15; c.cameraLookDown = -0.38;
      c._lastGround = f?.resolveGround?.(safe.x, safe.z) || { y: h, walkable: true };
      c.onGroundY = h; c.visualGroundY = h; g.playerModel.visible = !!${third};
      c._applyCamera?.(h, 0, h);
      g.playerModel.position.set(safe.x, h, safe.z); g.playerModel.updateMatrixWorld(true);
      return { requested, player: { x: safe.x, y: h, z: safe.z }, walkable: c._lastGround.walkable ?? null };
    })()`);

    const capture = async (name, mode) => {
      await sleep(2200);
      collectErrors(browser.drain(sessionId), report.errors, report.warnings);
      const image = await browser.send('Page.captureScreenshot', {
        format: 'png', fromSurface: true, captureBeyondViewport: false,
      }, sessionId, 90000);
      const file = path.join(OUT, `${name}.png`);
      fs.writeFileSync(file, Buffer.from(image.result.data, 'base64'));
      const diagnostic = await evaluate(`(() => {
        const g = window.__game, c = g.controller, field = window.__verdantField;
        const p = c.position, cam = g.camera.position, model = g.playerModel;
        let box = null, center = null;
        if (model) { model.updateMatrixWorld(true); box = new g.THREE.Box3().setFromObject(model); center = box.getCenter(new g.THREE.Vector3()); }
        const v = (q) => q ? { x: +q.x.toFixed(3), y: +q.y.toFixed(3), z: +q.z.toFixed(3) } : null;
        return { mode: ${JSON.stringify(mode)}, player: v(p), ground: +g.terrainHeight(p.x, p.z).toFixed(3),
          camera: v(cam), cameraPlayerDistance: +cam.distanceTo(p).toFixed(3),
          cameraInsidePlayerBox: !!(box && !box.isEmpty() && box.containsPoint(cam)),
          playerModelVisible: !!(model?.visible && box && !box.isEmpty()),
          playerModelBounds: box && !box.isEmpty() ? { min: v(box.min), max: v(box.max), size: v(box.getSize(new g.THREE.Vector3())) } : null,
          playerModelCameraDistance: center ? +cam.distanceTo(center).toFixed(3) : null,
          walkable: field?.resolveGround?.(p.x, p.z)?.walkable ?? null };
      })()`);
      report.shots.push({ name, file: path.relative(ROOT, file).replaceAll(path.sep, '/'), bytes: fs.statSync(file).size, ...diagnostic });
      return diagnostic;
    };

    console.log('phase: shot1');
    await place(0, 20, 0, -0.05, false); await capture('01-path-ground', 'first-person path');
    await place(-18, 8, 0.72, -0.12, false); await capture('02-mid-foliage', 'first-person foliage');
    await place(24, -18, 3.0, -0.18, false); await capture('03-cliffs-depth', 'first-person cliffs/depth');
    console.log('phase: shot4');
    // Third-person proof must show the whole marmot from outside its capsule.
    // Pick the first yaw whose player->camera segment has no scene mesh hit
    // (QA-side placement; the runtime fix is the larger 5.4m/2.15m distance).
    const clearYaw = await evaluate(`(() => {
      const g = window.__game, THREE = g.THREE, c = g.controller, f = window.__verdantField;
      const sp = (window.__qaSpawn && window.__qaSpawn.x !== undefined) ? window.__qaSpawn : { x: -41.03, z: -1.87 };
      const safe = f?.nearestWalkable?.(sp.x, sp.z) || sp;
      const h = f?.resolveGround?.(safe.x, safe.z)?.y ?? g.terrainHeight(safe.x, safe.z);
      const env = g.scene.getObjectByName('VerdantTrailEnvironment');
      const ray = new THREE.Raycaster();
      const from = new THREE.Vector3(safe.x, h + 0.45, safe.z);
      for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2, Math.PI * 0.75, -Math.PI * 0.75, Math.PI / 4, -Math.PI / 4]) {
        const pitch = -0.08 - 0.38;
        const hd = Math.cos(pitch) * 5.4;
        const to = new THREE.Vector3(safe.x + Math.sin(yaw) * hd, h + 2.15, safe.z + Math.cos(yaw) * hd);
        const dir = to.clone().sub(from); const len = dir.length(); dir.normalize();
        ray.set(from, dir); ray.far = len;
        const hits = env ? ray.intersectObject(env, true).filter((it) => it.object.name !== 'ground' || it.point.y > h + 0.6) : [];
        if (!hits.length) return { x: safe.x, z: safe.z, y: h, yaw };
      }
      return { x: safe.x, z: safe.z, y: h, yaw: 0 };
    })()`);
    console.log('shot4 clear yaw', JSON.stringify(clearYaw));
    await place(clearYaw.x, clearYaw.z, clearYaw.yaw, -0.08, true); await capture('04-third-person', 'true third-person controller camera');

    // High overview is intentionally a QA-only camera placement, not a hidden
    // first-person pose: pause the game, place the player/model, and look from
    // 34m above it so the entire model is measurable in the frame.
    await evaluate(`(() => {
      const g = window.__game, c = g.controller, f = window.__verdantField;
      const safe = f?.nearestWalkable?.(0, 0) || { x: 0, z: 0 };
      const y = f?.resolveGround?.(safe.x, safe.z)?.y ?? g.terrainHeight(safe.x, safe.z);
      g.game.mode = 'pause'; g.setViewMode(true); g.playerModel.visible = true;
      c.position.set(safe.x, y, safe.z); c.grounded = true; c.onGroundY = y; c.visualGroundY = y;
      g.playerModel.position.set(safe.x, y, safe.z); g.playerModel.updateMatrixWorld(true);
      g.camera.position.set(safe.x + 0.3, y + 34, safe.z + 5.5);
      g.camera.lookAt(safe.x, y + 0.45, safe.z);
      return { player: { x: safe.x, y, z: safe.z }, altitude: 34 };
    })()`);
    await capture('05-overview', 'high-altitude bird-eye overview');

    console.log('phase: surfaceComparison');
    report.checks.surfaceComparison = await evaluate(`(async () => {
      const g = window.__game, THREE = g.THREE, field = window.__verdantField;
      const height = await (await fetch('./assets/verdant/tiers/${TIER}/verdant-trail-${TIER}-height.json?qa=' + Date.now())).json();
      const n = height.gridSize, b = height.bounds;
      const jsonAt = (x, z) => {
        const tx = THREE.MathUtils.clamp((x - b.minX) / (b.maxX - b.minX), 0, 1);
        const tz = THREE.MathUtils.clamp((z - b.minZ) / (b.maxZ - b.minZ), 0, 1);
        const gx = tx * (n - 1), gz = tz * (n - 1), i = Math.floor(gx), j = Math.floor(gz);
        const i1 = Math.min(n - 1, i + 1), j1 = Math.min(n - 1, j + 1), fx = gx - i, fz = gz - j;
        const at = (ii, jj) => height.heights[jj * n + ii] ?? null;
        const vals = [at(i, j), at(i1, j), at(i, j1), at(i1, j1)];
        if (vals.some((v) => !Number.isFinite(v))) return null;
        return (vals[0] * (1 - fx) + vals[1] * fx) * (1 - fz) + (vals[2] * (1 - fx) + vals[3] * fx) * fz;
      };
      let ground = g.scene.getObjectByName('ground');
      g.scene.updateMatrixWorld(true);
      const ray = new THREE.Raycaster();
      const points = [[0, 20], [-18, 8], [24, -18], [0, 0], [-30, -20], [20, 10]];
      const samples = points.map(([x, z]) => {
        ray.set(new THREE.Vector3(x, 200, z), new THREE.Vector3(0, -1, 0));
        const hit = ground ? ray.intersectObject(ground, true)[0] : null;
        const visual = hit ? hit.point.y : null;
        const json = jsonAt(x, z);
        const collision = field?.heightAt?.(x, z);
        const resolved = field?.resolveGround?.(x, z);
        return { x, z, visualGroundY: visual === null ? null : +visual.toFixed(4),
          heightJsonY: json === null ? null : +json.toFixed(4),
          collisionY: Number.isFinite(collision) ? +collision.toFixed(4) : null,
          walkable: resolved?.walkable ?? null,
          visualMinusJson: visual === null || json === null ? null : +(visual - json).toFixed(4),
          visualMinusCollision: visual === null || !Number.isFinite(collision) ? null : +(visual - collision).toFixed(4),
          jsonMinusCollision: json === null || !Number.isFinite(collision) ? null : +(json - collision).toFixed(4) };
      });
      const aligned = samples.filter((s) => s.walkable && Number.isFinite(s.visualGroundY) && Number.isFinite(s.collisionY));
      const origin = samples.find((s) => s.x === 0 && s.z === 0);
      return { groundMeshFound: !!ground, samples,
        maxAbsVisualMinusCollision: Math.max(...aligned.map((s) => Math.abs(s.visualMinusCollision))),
        originAbsVisualMinusCollision: origin && Number.isFinite(origin.visualMinusCollision) ? Math.abs(origin.visualMinusCollision) : null };
    })()`);
    report.checks.backend = await evaluate(`(() => {
      const r = window.__game.renderer, gl = r.getContext();
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      return { contextLost: gl.isContextLost(), glError: gl.getError(),
        backend: r.capabilities.isWebGL2 ? 'webgl2' : 'webgl1',
        renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER) };
    })()`);
    const auditPath = path.join(ROOT, 'outputs', 'scene-assembly-qa', 'grounding-audit.json');
    if (fs.existsSync(auditPath)) report.groundingAudit = JSON.parse(fs.readFileSync(auditPath, 'utf8'));
    const surface = report.checks.surfaceComparison;
    const runtime = {
      format: 1, source: 'CDP fresh managed target', tier: TIER,
      spawn: report.checks.initialSpawn, samples: surface.samples,
      camera: report.shots.filter((s) => /third-person|overview/.test(s.mode)).map((s) => ({
        name: s.name, player: s.player, camera: s.camera,
        cameraPlayerDistance: s.cameraPlayerDistance,
        playerModelCameraDistance: s.playerModelCameraDistance,
        cameraInsidePlayerBox: s.cameraInsidePlayerBox,
        playerModelVisible: s.playerModelVisible,
      })),
    };
    fs.writeFileSync(RUNTIME_OUT, JSON.stringify(runtime, null, 2) + '\n');
    report.errors = [...new Set(report.errors)]; report.warnings = [...new Set(report.warnings)];
    fs.writeFileSync(BACKEND_OUT, JSON.stringify({
      backend: report.checks.backend, consoleErrors: report.errors,
    }, null, 2) + '\n');
    report.finishedAt = new Date().toISOString();
    const externalShots = report.shots.filter((s) => /third-person|overview/.test(s.mode));
    report.pass = report.errors.length === 0 && report.shots.length === 5
      && externalShots.every((s) => s.playerModelVisible && !s.cameraInsidePlayerBox && (s.playerModelCameraDistance || 0) > 1)
      && surface.maxAbsVisualMinusCollision <= 0.15
      && surface.originAbsVisualMinusCollision <= 0.05
      && !report.checks.backend.contextLost && report.checks.backend.glError === 0;
    report.requirements = {
      zeroConsoleErrors: report.errors.length === 0,
      fiveShots: report.shots.length === 5,
      externalCameraModelVisible: externalShots.every((s) => s.playerModelVisible && !s.cameraInsidePlayerBox && (s.playerModelCameraDistance || 0) > 1),
      surfaceSamplesPresent: surface.groundMeshFound && surface.samples.length === 6,
      walkableTerrainAligned: surface.maxAbsVisualMinusCollision <= 0.15,
      originGroundingClosed: surface.originAbsVisualMinusCollision <= 0.05,
      backendHealthy: !report.checks.backend.contextLost && report.checks.backend.glError === 0,
      sceneGroundingSummaryAttached: !!report.groundingAudit,
    };
    fs.writeFileSync(path.join(OUT, 'cdp-report.json'), JSON.stringify(report, null, 2) + '\n');
    if (!report.pass) throw new Error(`QA checks failed ${JSON.stringify(report.requirements)}`);
    console.log(JSON.stringify({ pass: report.pass, readyAfterSeconds: report.readyAfterSeconds,
      shots: report.shots.map((s) => ({ name: s.name, bytes: s.bytes, playerModelVisible: s.playerModelVisible,
        cameraInsidePlayerBox: s.cameraInsidePlayerBox, playerModelCameraDistance: s.playerModelCameraDistance })),
      surfaceComparison: report.checks.surfaceComparison, errors: report.errors }, null, 2));
  } finally {
    try { if (targetId) await browser?.send('Target.closeTarget', { targetId }, null, 5000); } catch (_) {}
    try { browser?.close(); } catch (_) {}
    server.close();
  }
}
main().catch((error) => { console.error(error.stack || String(error)); server.close(); process.exit(1); });
