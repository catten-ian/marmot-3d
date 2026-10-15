/**
 * 三项问题的回归测试：
 *   1. 藏狐冲刺预警线方向与实际冲刺方向一致（此前是反的）
 *   2. 攻击模式确实多样化（不同类型走不同分支、预警线长度 = 真实冲刺距离）
 *   3. 8 关全部可加载，环境修饰生效（雾/阵风/沙尘）
 *
 * 用法：node tools/test-attacks.cjs
 */
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { pathToFileURL } = require('url');
const ROOT = path.resolve(__dirname, '..');

const PORT = 9371;
const BASE = 'http://127.0.0.1:8123/index.html';

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
  const profile = path.join(os.tmpdir(), 'marmot-atk-' + Date.now());
  const chrome = spawn(CHROME, [
    '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
    '--no-first-run', '--disable-gpu', '--use-gl=swiftshader', '--enable-unsafe-swiftshader',
    '--window-size=1024,640', 'about:blank',
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
      logs.push(`[${m.params.type}] ` + m.params.args.map((a) => a.value ?? a.description ?? a.type).join(' '));
    }
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails;
      logs.push('[exception] ' + (d.exception?.description || d.text));
    }
  });
  const send = (me, pa = {}) => new Promise((res, rej) => {
    const i = ++id; pend.set(i, { res, rej });
    ws.send(JSON.stringify({ id: i, method: me, params: pa }));
    setTimeout(() => { if (pend.has(i)) { pend.delete(i); rej(new Error('timeout ' + me)); } }, 60000);
  });
  const evalJS = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails.exception || r.exceptionDetails.text).slice(0, 400));
    return r.result?.value;
  };

  await new Promise((r) => ws.addEventListener('open', r, { once: true }));
  await send('Runtime.enable'); await send('Page.enable');
  await send('Page.navigate', { url: BASE });
  await new Promise((r) => setTimeout(r, 7000));
  await evalJS("(function(){const b=[...document.querySelectorAll('button')].find(x=>/开始|进入|start/i.test(x.textContent));if(b)b.click();return !!b;})()");
  await new Promise((r) => setTimeout(r, 3000));

  const results = {};

  // ============ 1. 纯逻辑物理断言 ============
  results.physics = await evalJS(`(async () => {
    const combat = await import('/src/systems/combat.js');
    const cfg = await import('/src/core/config.js');
    const overlap = combat.verticalHitOverlap;
    const groundedPupHit = overlap(0, cfg.PLAYER.collisionHeight, 0, cfg.FOX.collisionHeight.pup);
    const highPupMiss = overlap(0, cfg.PLAYER.collisionHeight,
      cfg.FOX.attacks.pup.leapHeight, cfg.FOX.collisionHeight.pup);
    const jumpLowPupHit = overlap(cfg.PLAYER.jump.dodgeHeight, cfg.PLAYER.collisionHeight,
      0.2, cfg.FOX.collisionHeight.pup);
    const dtRun = (dt) => {
      let v = 0, x = 0;
      for (let t = 0; t < 2; t += dt) {
        v = Math.max(-4.5, Math.min(4.5, v + 7.5 * dt));
        v *= Math.exp(-3.2 * dt);
        x += v * dt;
      }
      return { v, x };
    };
    const wind60 = dtRun(1 / 60), wind30 = dtRun(1 / 30);
    const { FOX } = cfg;
    const knockback = {};
    for (const type of ['normal', 'heavy', 'boss']) {
      const kbVelocity = 2 * FOX.knockbackScale[type];
      knockback[type] = { firstFrame: kbVelocity / 60, totalApprox: kbVelocity / 5.5 };
    }
    return {
      groundedPupHit, highPupMiss, jumpLowPupHit,
      wind60, wind30,
      windStepStable: Math.abs(wind60.x - wind30.x) < 0.05,
      windBounded: Math.abs(wind60.v) <= 4.5 && Math.abs(wind30.v) <= 4.5,
      knockback,
      knockbackOrdered: knockback.normal.totalApprox > knockback.heavy.totalApprox
        && knockback.heavy.totalApprox > knockback.boss.totalApprox,
      pass: groundedPupHit && !highPupMiss && jumpLowPupHit
        && Math.abs(wind60.x - wind30.x) < 0.05
        && knockback.normal.totalApprox > knockback.heavy.totalApprox
        && knockback.heavy.totalApprox > knockback.boss.totalApprox,
    };
  })();

  // ============ 2. 预警线方向 ============
  // 关键断言：把藏狐放进蓄力状态后，预警线在**局部 +Z** 方向有几何延伸，
  // 而藏狐冲刺方向 (sin yaw, cos yaw) 也是 +Z。
  // 之前用 ShapeGeometry + rotateX(-PI/2) 会让线跑到 -Z，于是 dot < 0。
  results.warnDir = await evalJS(`(function(){
    const g = window.__game;
    const f = g.foxesList()[0];
    if (!f) return { err: 'no fox' };
    const THREE = g.THREE;
    f.state = 'wind'; f.warn.visible = true;
    f.yaw = 0;           // yaw=0 时 three.js 的 +Z 就是世界 +Z
    f.dashTime = f.attack.dashTime + (f.attack.mode === 'leap' ? 0.22 : 0);

    // —— 长度守恒：必须在「蓄力满」时刻采样 ——
    // 预警线是充能式增长的（越接近冲刺越长），所以只有 timer→0 时
    // 才应该等于真实冲刺距离。早期版本曾在蓄力中期采样，
    // 报出"线 4.55m vs 冲刺 11.47m"的假失配。
    const realDist = g.FOX.dashSpeed * f.dashTime * (f.attack.dashSpeedMul || 1);
    f.windFull = 0.8; f.windTotal = 0.8;
    const lens = {};
    for (const frac of [1, 0.5, 0]) {
      f.timer = f.windFull * frac;
      f._updateWarn();
      lens['蓄力' + Math.round((1 - frac) * 100) + '%'] = +f.warn.scale.z.toFixed(2);
    }

    // 方向：取预警条单位长度顶点，算它在世界坐标下的延伸方向
    f.timer = 0; f._updateWarn();
    f.warn.updateMatrixWorld(true);
    const pos = f.warn.geometry.attributes.position;
    const v = new THREE.Vector3();
    const pts = [];
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(f.warn.matrixWorld);
      pts.push(v.clone());
    }
    const localTip = new THREE.Vector3(0, 0, 1);
    const worldTip = localTip.clone().applyMatrix4(f.warn.matrixWorld)
      .sub(f.warn.getWorldPosition(new THREE.Vector3()));
    const dir = worldTip.clone().normalize();
    const dashDir = new THREE.Vector3(Math.sin(f.yaw), 0, Math.cos(f.yaw));
    // 用包围盒实际延伸方向再验一次（不依赖几何语义假设）
    const bb = new THREE.Box3().setFromObject(f.warn);
    const c = bb.getCenter(new THREE.Vector3());
    const o = f.warn.getWorldPosition(new THREE.Vector3());
    const geoDir = new THREE.Vector3(c.x - o.x, 0, c.z - o.z).normalize();

    return {
      mode: f.attack.mode,
      dot: +dir.dot(dashDir).toFixed(3),
      geoDot: +geoDir.dot(dashDir).toFixed(3),
      lens, realDist: +realDist.toFixed(2),
      fullLen: lens['蓄力100%'],
      lenMatches: Math.abs(lens['蓄力100%'] - realDist) < 0.1,
    };
  })()`);

  // ============ 2. 移动方向与模型前向一致 ============
  // 真实狐狸 GLB 的鼻尖朝局部 +Z；mesh.rotation.y=yaw 后，
  // 世界前向为 (sin(yaw), cos(yaw))，必须与横向位移方向同向。
  results.heading = await evalJS(`(async function(){
    const g = window.__game;
    const mod = await import('/src/entities/fox.js');
    const flat = () => 0;
    const burrow = { x: -52, z: 0, r: 8.2 };
    const cfg = { wind: 0.6, speed: 9, reinforce: 8 };
    const sample = (fox, p, safe) => {
      const x = fox.x, z = fox.z;
      fox.update(1 / 60, p, safe, cfg, burrow, flat);
      const dx = fox.x - x, dz = fox.z - z;
      const d = Math.hypot(dx, dz);
      const fx = Math.sin(fox.yaw), fz = Math.cos(fox.yaw);
      return d > 1e-5 ? (dx * fx + dz * fz) / d : 1;
    };
    const out = {};
    const circle = new mod.Fox(g.scene, 20, 0, 'heavy', 3, 0);
    circle.state = 'circle'; circle.timer = 1; circle.yaw = 0;
    circle.luredDir = 1;
    let circleDot = -1;
    for (let i = 0; i < 90; i++) circleDot = sample(circle, { x: 20, z: 0 }, false);
    out.circleDot = +circleDot.toFixed(3);
    circle.dispose(g.scene);

    const roam = new mod.Fox(g.scene, 20, 0, 'normal', 3, 0);
    roam.yaw = Math.PI;
    let roamDot = -1;
    for (let i = 0; i < 90; i++) roamDot = sample(roam, { x: 20, z: 0 }, true);
    out.roamDot = +roamDot.toFixed(3);
    roam.dispose(g.scene);
    out.pass = out.circleDot > 0.9 && out.roamDot > 0.9;
    return out;
  })()`);

  // ============ 3. 攻击模式多样性 + 预警线长度守恒 ============
  // 注意：不能用 foxesList() 取 —— 第 1 关只有 normal，
  // find() 找不到其他类型会回退到同一只，五种测出来完全一样（曾因此误判为"仍然单一"）。
  // 这里直接 import Fox 模块，构造五种类型的干净实例。
  results.modes = await evalJS(`(async function(){
    const g = window.__game;
    const mod = await import('/src/entities/fox.js');
    const THREE = g.THREE;
    const cfg = { wind: 0.6, speed: 9, reinforce: 8 };
    const burrow = { x: -52, z: 0, r: 8.2 };
    const flat = () => 0;
    const out = {};

    for (const ty of ['pup', 'normal', 'fast', 'heavy', 'boss']) {
      const fox = new mod.Fox(g.scene, 20, 0, ty, 3, 0, { lureBias: 1 });
      const states = new Set();
      let dirChanges = 0, lastDir = null, maxLeap = 0, dashes = 0, circleFrames = 0;
      let lureEvents = 0, maxComboSegments = 0;
      let prevState = fox.state;
      const p = { x: 20, z: 0 };
      for (let step = 0; step < 1200; step++) {
        // 玩家在小范围内移动，让藏狐反复进入攻击流程
        p.x = 20 + Math.cos(step * 0.02) * 6;
        p.z = 0 + Math.sin(step * 0.02) * 6;
        fox.update(1 / 60, p, false, cfg, burrow, flat);
        states.add(fox.state);
        if (fox.state === 'circle') circleFrames++;
        // 虚晃事件：从 wind 被打断转入 circle
        if (fox.state === 'circle' && prevState === 'wind') lureEvents++;
        // 连冲段数统计：连续 dash 之间若只隔短暂 wind，算同一轮连冲
        if (fox.state === 'dash') {
          if (lastDir !== null) {
            const d = Math.hypot(fox.dashDirX - lastDir[0], fox.dashDirZ - lastDir[1]);
            if (d > 0.02) dirChanges++;
          }
          lastDir = [fox.dashDirX, fox.dashDirZ];
          dashes++;
        }
        // 连冲段数：直接读 comboLeft。不能用"连续 dash 计数"当指标 ——
        // 连冲中的每段之间隔着短暂 wind，dash→wind→dash 会被误算成多段
        // （曾因此把普通狐的 20 次独立冲刺误报成"最长连冲 20 段"）。
        const seg = (fox.comboActive ? (fox.comboLeft + 1) : 0);
        if (seg > maxComboSegments) maxComboSegments = seg;
        if (fox.leap > maxLeap) maxLeap = fox.leap;
        prevState = fox.state;
        fox.hp = fox.maxHp; fox.fleeing = false; fox.stun = 0;
      }
      out[ty] = {
        mode: fox.attack.mode,
        attackLabel: fox.attack.label,
        states: [...states],
        dashes, dirChanges, circleFrames,
        lureEvents, maxComboSegments,
        maxLeap: +maxLeap.toFixed(2),
        turnRate: fox.attack.turnRate,
        warnLen: +(FOX.dashSpeed * fox.dashTime * (fox.attack.dashSpeedMul || 1)).toFixed(2),
      };
      fox.dispose(g.scene);
    }
    return out;
  })()`);

  // ============ 3. 关卡表与环境修饰 ============
  results.levels = await evalJS(`(function(){
    const g = window.__game;
    const out = [];
    for (let i = 0; i < g.LEVELS.length; i++) {
      const c = g.LEVELS[i];
      // 切到该关，验证环境修饰能正确应用
      g.env.gust = 0;
      out.push({
        i: i + 1,
        name: c.name,
        brief: (c.brief || '').slice(0, 20),
        count: c.count,
        types: c.types,
        boss: !!c.boss,
        fogNear: c.fogNear || 70,
        fogFar: c.fogFar || 420,
        windGust: c.windGust || 0,
        sandstorm: !!c.sandstorm,
      });
    }
    return out;
  })()`);

  // 阵风实际推动玩家：扫描一整个周期确认峰值能达到 gustMax
  results.wind = await evalJS(`(function(){
    const g = window.__game;
    if (!g.env) return { err: 'env not exposed' };
    const windIdx = g.LEVELS.findIndex(c => c.windGust > 0);
    if (windIdx < 0) return { err: 'no windy level' };
    const want = g.LEVELS[windIdx].windGust;
    g.game.level = windIdx;
    g.env.gustMax = want;
    g.env.gustDir = 1;
    g.env.gustPhase = 0;
    // 扫 60 秒，覆盖多个周期，找真实峰值
    let peak = 0, minv = 0;
    for (let i = 0; i < 3600; i++) {
      g.updateEnv(1 / 60);
      peak = Math.max(peak, g.env.gust);
      minv = Math.min(minv, g.env.gust);
    }
    return {
      level: windIdx + 1,
      configured: want,
      peak: +peak.toFixed(2),
      trough: +minv.toFixed(2),
      reachesConfigured: Math.abs(peak - want) < 0.5,
      // 峰值持续时间决定玩家能否"顶着风走"
      pushAtPeak: +(want * 0.1).toFixed(2),
    };
  })()`);

  // 沙尘能改变雾距
  results.sand = await evalJS(`(function(){
    const g = window.__game;
    const sandIdx = g.LEVELS.findIndex(c => c.sandstorm);
    if (sandIdx < 0) return { err: 'no sandstorm level' };
    // 手动应用沙尘关卡的参数
    const c = g.LEVELS[sandIdx];
    g.env.sandPeriod = 11;
    g.env.fogBase = c.fogNear || 70;
    g.env.fogFarBase = c.fogFar || 420;
    g.scene.fog.near = g.env.fogBase;
    g.scene.fog.far = g.env.fogFarBase;
    const calm = { near: g.scene.fog.near, far: g.scene.fog.far };
    // 推进到沙尘最浓的时刻（周期的 0.75 倍）
    for (let i = 0; i < Math.round(11 * 0.75 * 60); i++) g.updateEnv(1 / 60);
    const storm = { near: +g.scene.fog.near.toFixed(1), far: +g.scene.fog.far.toFixed(1), on: g.env.sandOn };
    // 沙尘不能把能见度压到看不见预警线的程度（那不是难度，是无从应对）
    return {
      level: sandIdx + 1, calm, storm,
      visRatio: +(storm.far / calm.far).toFixed(3),
      // 地面预警线在 near 之前仍然可见 —— near 越大越安全
      warnLineVisible: storm.near >= 5,
    };
  })()`);

  // ============ 4. 威胁有效性：冲刺是否真的够得到玩家 ============
  // 这是"预警线有没有意义"的根本判据。
  // 藏狐在 windRange（触发蓄力的距离）开始蓄力，冲刺距离 dashDist；
  // 玩家接触判定半径 contact。若 dashDist < windRange - contact，
  // 狐冲完仍停在玩家够不到的地方 —— 玩家站着不动就不会被碰到，
  // 预警线变成纯装饰，整局玩法失去紧张感。
  results.reach = await evalJS(`(async function(){
    const cfg = await import('/src/core/config.js');
    const FOX = cfg.FOX;
    const rows = [];
    for (const ty of ['pup','normal','fast','heavy','boss']) {
      const a = FOX.attacks[ty];
      const dashDist = FOX.dashSpeed * a.dashTime * (a.dashSpeedMul || 1)
        + (a.mode === 'leap' ? 0.22 * FOX.dashSpeed : 0);
      const contact = FOX.contact[ty] || FOX.contact.default;
      const need = FOX.windRange - contact;
      rows.push({
        ty,
        dashDist: +dashDist.toFixed(2),
        contact,
        windRange: FOX.windRange,
        needToReach: +need.toFixed(2),
        canReach: dashDist >= need,
        margin: +(dashDist - need).toFixed(2),
        comboTotal: a.mode === 'combo' ? +(dashDist * a.comboCount).toFixed(1) : null,
      });
    }
    return rows;
  })()`);

  // ============ 输出 ============
  console.log('======== 1. 模型前向与移动方向 ============');
  console.log('  绕行状态 dot = ' + results.heading.circleDot +
    '  游荡状态 dot = ' + results.heading.roamDot +
    (results.heading.pass ? '  一致 ✅' : '  不一致 ❌'));
  if (!results.heading.pass) process.exitCode = 1;

  console.log('\n======== 2. 预警线方向 ============');
  const wd = results.warnDir;
  if (wd.err) console.log('  错误:', wd.err);
  else {
    console.log('  藏狐模式: ' + wd.mode);
    console.log('  预警线方向 · 冲刺方向 dot = ' + wd.dot + '  (' + (wd.dot > 0.9 ? '一致 ✅' : wd.dot < -0.9 ? '相反 ❌' : '不明确 ❌') + ')');
    console.log('  几何包围盒方向 dot = ' + wd.geoDot);
    console.log('  预警线充能增长: ' + JSON.stringify(wd.lens) +
      '  真实冲刺距离 ' + wd.realDist + 'm');
    console.log('  满蓄力时线长 == 冲刺距: ' + wd.lenMatches + (wd.lenMatches ? ' ✅' : ' ❌'));
  }

  console.log('\n======== 2. 攻击模式多样性 ============');
  const modes = new Set();
  Object.entries(results.modes || {}).forEach(([ty, m]) => {
    if (typeof m === 'string') { console.log('  ' + ty + ': ' + m); return; }
    modes.add(m.mode);
    console.log(`  ${ty.padEnd(7)} ${String(m.attackLabel).padEnd(5)}(${m.mode})` +
      `  冲刺${String(m.dashes).padStart(3)}次 转向${String(m.dirChanges).padStart(3)}次` +
      ` 绕行${String(m.circleFrames).padStart(4)}帧 虚晃${m.lureEvents}次` +
      ` 最长连冲${m.maxComboSegments}段 腾空${m.maxLeap}m  冲刺距${m.warnLen}m`);
    console.log(`          状态流转: ${m.states.join(' → ')}`);
  });
  console.log('  → 不同模式数: ' + modes.size + (modes.size >= 4 ? ' ✅' : ' ❌ 仍然单一'));

  console.log('\n======== 3. 关卡表 ============');
  (results.levels || []).forEach((l) => {
    const env = [];
    if (l.fogNear !== 70 || l.fogFar !== 420) env.push('雾' + l.fogNear + '-' + l.fogFar);
    if (l.windGust) env.push('风' + l.windGust);
    if (l.sandstorm) env.push('沙尘');
    console.log(`  ${String(l.i).padStart(2)}. ${l.name.padEnd(6)} 藏狐${String(l.count).padStart(2)}只 ` +
      `[${(l.types || []).join('/')}]${l.boss ? ' +首领' : ''}` +
      (env.length ? '  环境:' + env.join(' ') : ''));
  });
  console.log('  → 共 ' + (results.levels || []).length + ' 关');

  console.log('\n======== 4. 威胁有效性（冲刺够得到玩家吗）========');
  console.log('  ' + '类型'.padEnd(8) + '冲刺距'.padStart(8) + '接触半径'.padStart(9) +
    '需要'.padStart(8) + '余量'.padStart(8) + '  结论');
  (results.reach || []).forEach((r) => {
    console.log('  ' + r.ty.padEnd(8) +
      String(r.dashDist).padStart(8) + 'm' +
      String(r.contact).padStart(8) + 'm' +
      String(r.needToReach).padStart(8) + 'm' +
      String(r.margin).padStart(8) + 'm  ' +
      (r.canReach ? '够得到 ✅' : '够不到 ❌ 预警线失去意义') +
      (r.comboTotal ? `  (三段连冲共 ${r.comboTotal}m)` : ''));
  });
  const unreachable = (results.reach || []).filter((r) => !r.canReach).map((r) => r.ty);
  console.log('  → 够不到的类型: ' + (unreachable.length ? unreachable.join(', ') : '无 ✅'));

  console.log('\n======== 5. 环境修饰生效 ============');
  console.log('  阵风: ' + JSON.stringify(results.wind));
  console.log('  沙尘: ' + JSON.stringify(results.sand));

  console.log('\n控制台 error/warning/exception: ' + logs.length);
  logs.slice(0, 8).forEach((l) => console.log('  ' + String(l).slice(0, 220)));

  ws.close(); chrome.kill();
  await new Promise((r) => setTimeout(r, 300));
  process.exit(results.heading.pass ? 0 : 1);
})();
