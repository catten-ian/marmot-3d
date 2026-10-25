/**
 * BETA 专属：扮演藏狐 · 调试后台（lil-gui）。
 *
 * 仅在 `?pafdebug=1` 且进入扮演藏狐模式后懒加载。普通玩家、stable/dev 永不加载。
 * 提供：
 *  - 移动 / 扑击 / 猎物 AI / 追尾相机全部平衡数值实时滑块；
 *  - 碰撞体积（藏狐、土拨鼠）、扑击捕获范围、当前察觉半径的 3D 实时可视化；
 *  - 猎物增删 / 复位、计时归零、配置持久化（localStorage）、重置默认、导入导出 JSON；
 *  - 反馈：查看本机反馈队列、一键打开反馈面板（沿用 src/ui/feedback.js）。
 *
 * 数据全部来自 window.__playAsFox（见 play-as-fox.js 暴露的只读 + cfg 调试钩子）。
 */
import * as THREE from 'three';
import { GUI } from '../../vendor/lil-gui/lil-gui.esm.js';

const QUEUE_KEY = 'm3d_feedback_queue';

function installLilGuiCss() {
  if (document.querySelector('link[data-lil-gui]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = new URL('../../vendor/lil-gui/lil-gui.css', import.meta.url);
  link.dataset.lilGui = '1';
  document.head.appendChild(link);
}

function readFeedbackQueue() {
  try { const v = JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; }
}

/** 一组贴地 3D 辅助线（圆环 / 圆柱线框），每帧按当前状态重定位。 */
class PafDebugView {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.name = 'paf-debug-view';
    this.group.renderOrder = 999;
    scene.add(this.group);

    this.catchRing = this._ring(0xff8a4a, 0.95);   // 扑击范围（橙）
    this.detectRing = this._ring(0xffd24a, 0.55);  // 视觉察觉半径（黄）
    this.hearRing = this._ring(0x7fd8ff, 0.4);     // 听觉半径（蓝，全向）
    this.foxCyl = this._cylinder(0x63c7ff);        // 藏狐碰撞（蓝）
    this.preyCyl = new THREE.Group();              // 土拨鼠碰撞（红，多个）
    this.group.add(this.catchRing, this.detectRing, this.hearRing, this.foxCyl, this.preyCyl);
    this._preyMeshes = [];
  }
  _ring(color, opacity) {
    const pts = [];
    for (let i = 0; i <= 64; i++) { const a = (i / 64) * Math.PI * 2; pts.push(new THREE.Vector3(Math.cos(a), 0.02, Math.sin(a))); }
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    const line = new THREE.LineLoop(geo, new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthTest: false }));
    line.renderOrder = 999;
    return line;
  }
  _cylinder(color) {
    // 单位圆柱，每帧按半径/高度缩放
    const geo = new THREE.CylinderGeometry(1, 1, 1, 20, 1, true);
    const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, wireframe: true, transparent: true, opacity: 0.9, depthTest: false }));
    mesh.renderOrder = 999;
    return mesh;
  }
  _syncPreyMeshes(count) {
    while (this._preyMeshes.length < count) {
      const m = this._cylinder(0xff5a4a);
      this.preyCyl.add(m); this._preyMeshes.push(m);
    }
    while (this._preyMeshes.length > count) { const m = this._preyMeshes.pop(); this.preyCyl.remove(m); m.geometry.dispose(); m.material.dispose(); }
  }
  update(api, view) {
    const cfg = api.cfg;
    const pos = api.pos;
    const visible = !!view.enabled;
    this.group.visible = visible;
    if (!visible) return;

    // 藏狐碰撞圆柱（以足部为底）
    this.foxCyl.visible = !!view.collision;
    if (view.collision) {
      this.foxCyl.visible = true;
      this.foxCyl.scale.set(cfg.foxRadius, cfg.foxHeight, cfg.foxRadius);
      this.foxCyl.position.set(pos.x, pos.y + cfg.foxHeight / 2, pos.z);
    }

    // 扑击水平范围（仅扑击相位显示；实际捕获还需通过垂直窗口）
    const pouncing = api.phase === 'lunge' || api.phase === 'wind';
    this.catchRing.visible = !!view.catchRange;
    if (view.catchRange) {
      this.catchRing.scale.set(cfg.catchRadius, 1, cfg.catchRadius);
      this.catchRing.position.set(pos.x, pos.y + 0.03, pos.z);
      (this.catchRing.material).opacity = pouncing ? 0.95 : 0.35;
    }

    // 当前视觉/听觉察觉半径（档位：潜行 / 冲刺 / wind+lunge）
    this.detectRing.visible = !!view.detect;
    this.hearRing.visible = !!view.detect;
    if (view.detect) {
      const threat = api.phase === 'wind' || api.phase === 'lunge';
      const vr = threat ? cfg.visionRadiusLunge : api.sprint ? cfg.detectSprint : cfg.detectStalk;
      const hr = threat ? cfg.detectLunge : api.sprint ? cfg.hearRadiusSprint : cfg.hearRadiusStalk;
      this.detectRing.scale.set(vr, 1, vr);
      this.detectRing.position.set(pos.x, pos.y + 0.02, pos.z);
      this.hearRing.scale.set(hr, 1, hr);
      this.hearRing.position.set(pos.x, pos.y + 0.02, pos.z);
    }

    // 土拨鼠碰撞圆柱
    const prey = api.prey.filter((p) => !p.caught);
    this.preyCyl.visible = !!view.collision;
    if (view.collision) {
      this._syncPreyMeshes(prey.length);
      const th = 0.6;
      prey.forEach((p, i) => {
        const m = this._preyMeshes[i];
        m.visible = true;
        m.scale.set(cfg.preyRadius, th, cfg.preyRadius);
        const y = api.terrainHeightAt(p.x, p.z);
        m.position.set(p.x, y + th / 2, p.z);
      });
    } else this._syncPreyMeshes(0);
  }
  dispose() {
    this.scene.remove(this.group);
    this.group.traverse((o) => { o.geometry?.dispose?.(); o.material?.dispose?.(); });
  }
}

export function attachPlayAsFoxDebug(api, hooks = {}) {
  installLilGuiCss();
  if (window.__pafDebug) { try { window.__pafDebug.dispose(); } catch { /* ignore */ } }

  const scene = hooks.scene;
  const view3d = scene ? new PafDebugView(scene) : null;
  const view = { enabled: true, collision: true, catchRange: true, detect: true };
  const cfg = api.cfg;

  const gui = new GUI({ title: '扮演藏狐 · 调试后台' });
  gui.width = 300;
  const controllers = [];
  const track = (c) => { controllers.push(c); return c; };

  // —— 实时状态（只读显示） ——
  const status = {
    get 阶段() { return api.phase; },
    get 得分() { return api.score; },
    get 计时() { return Number(api.elapsed.toFixed(1)); },
    get 存活猎物() { return api.prey.filter((p) => !p.caught).length; },
    get x() { return Number(api.pos.x.toFixed(2)); },
    get z() { return Number(api.pos.z.toFixed(2)); },
    get yaw() { return Number(api.pos.yaw.toFixed(2)); },
  };
  const sf = gui.addFolder('状态 / Status');
  track(sf.add(status, '阶段').listen());
  track(sf.add(status, '得分').listen());
  track(sf.add(status, '计时').listen());
  track(sf.add(status, '存活猎物').listen());
  track(sf.add(status, 'x').listen()); track(sf.add(status, 'z').listen()); track(sf.add(status, 'yaw').listen());

  // —— 移动 ——
  const fMove = gui.addFolder('移动 / Movement');
  track(fMove.add(cfg, 'stalkSpeed', 0.5, 10, 0.05).name('潜行速度'));
  track(fMove.add(cfg, 'runSpeed', 1, 16, 0.1).name('冲刺速度'));
  track(fMove.add(cfg, 'reverseSpeed', 0, 1, 0.01).name('后退倍率'));
  track(fMove.add(cfg, 'turnRate', 0.5, 8, 0.05).name('键盘转向'));
  track(fMove.add(cfg, 'mouseTurn', 0.0004, 0.008, 0.0001).name('鼠标转向'));

  // —— 扑击 ——
  const fPounce = gui.addFolder('扑击 / Pounce');
  track(fPounce.add(cfg, 'windTime', 0, 1, 0.01).name('蓄力时间'));
  track(fPounce.add(cfg, 'pounceMaxCharge', 0.22, 3, 0.01).name('触屏最长蓄力'));
  track(fPounce.add(cfg, 'lungeTime', 0.1, 1.2, 0.01).name('腾空时间'));
  track(fPounce.add(cfg, 'lungeSpeed', 4, 26, 0.1).name('腾空速度'));
  track(fPounce.add(cfg, 'lungeHeight', 0, 3, 0.05).name('腾空高度'));
  track(fPounce.add(cfg, 'recoverTime', 0, 1.5, 0.01).name('硬直时间'));
  track(fPounce.add(cfg, 'catchRadius', 0.3, 6, 0.05).name('扑击范围 r'));
  track(fPounce.add(cfg, 'leadLungeFraction', 0, 1.2, 0.01).name('lead 腾空系数'));
  track(fPounce.add(cfg, 'windRetargetDeg', 0, 45, 0.5).name('wind重瞄上限°'));
  track(fPounce.add(cfg, 'windRetargetFrac', 0, 1, 0.02).name('wind可重瞄比例'));
  track(fPounce.add(cfg, 'windRetargetDamp', 0, 30, 0.5).name('wind重瞄速率'));
  track(fPounce.add(cfg, 'catchFoxCenter', 0.1, 1.2, 0.02).name('命中中心高'));
  track(fPounce.add(cfg, 'catchVerticalTol', 0.1, 2, 0.02).name('垂直容差±'));
  track(fPounce.add(cfg, 'preyCenterHeight', 0.1, 1.2, 0.02).name('猎物中心高'));

  // —— 碰撞体积 ——
  const fCol = gui.addFolder('碰撞体积 / Collision');
  track(fCol.add(cfg, 'foxRadius', 0.1, 2, 0.02).name('藏狐半径'));
  track(fCol.add(cfg, 'foxHeight', 0.2, 2.5, 0.02).name('藏狐高度'));
  track(fCol.add(cfg, 'preyRadius', 0.1, 1.5, 0.02).name('土拨鼠半径'));

  // —— 猎物 AI ——
  const fPrey = gui.addFolder('猎物 AI / Prey');
  track(fPrey.add(cfg, 'preyCount', 1, 30, 1).name('猎物数量(复位生效)'));
  track(fPrey.add(cfg, 'preyWander', 0, 6, 0.05).name('游荡速度'));
  track(fPrey.add(cfg, 'preyFlee', 1, 12, 0.1).name('惊逃速度'));
  track(fPrey.add(cfg, 'preyBurst', 1, 16, 0.1).name('扑击惊逃峰值'));
  track(fPrey.add(cfg, 'respawnTime', 0, 6, 0.05).name('重生时间'));
  track(fPrey.add(cfg, 'detectStalk', 1, 24, 0.2).name('潜行察觉半径'));
  track(fPrey.add(cfg, 'detectSprint', 1, 30, 0.2).name('冲刺察觉半径'));
  track(fPrey.add(cfg, 'detectLunge', 1, 40, 0.2).name('扑击察觉半径'));
  track(fPrey.add(cfg, 'alertTime', 0, 1.5, 0.02).name('警觉停留'));
  track(fPrey.add(cfg, 'fleeCommit', 0.1, 1, 0.01).name('逼近立即逃比例'));
  // A1 多线索察觉
  track(fPrey.add(cfg, 'visionHalfAngleDeg', 20, 180, 1).name('视锥半角°(全锥2倍)'));
  track(fPrey.add(cfg, 'visionRadiusLunge', 1, 40, 0.2).name('扑击视觉半径'));
  track(fPrey.add(cfg, 'hearRadiusStalk', 0, 20, 0.2).name('潜行听觉半径'));
  track(fPrey.add(cfg, 'hearRadiusSprint', 0, 30, 0.2).name('冲刺听觉半径'));
  track(fPrey.add(cfg, 'visionFalloffInner', 0, 1, 0.02).name('视觉满强度内圈'));
  track(fPrey.add(cfg, 'hearFalloffInner', 0, 1, 0.02).name('听觉满强度内圈'));
  track(fPrey.add(cfg, 'visionRate', 0, 6, 0.05).name('视觉上升率/s'));
  track(fPrey.add(cfg, 'hearRate', 0, 6, 0.05).name('听觉上升率/s'));
  track(fPrey.add(cfg, 'speedCoefStalk', 0, 2, 0.02).name('视觉系数·潜行'));
  track(fPrey.add(cfg, 'speedCoefSprint', 0, 2, 0.02).name('视觉系数·冲刺'));
  track(fPrey.add(cfg, 'speedCoefLunge', 0, 2, 0.02).name('视觉系数·扑击'));
  track(fPrey.add(cfg, 'noiseCoefStalk', 0, 2, 0.02).name('听觉系数·潜行'));
  track(fPrey.add(cfg, 'noiseCoefSprint', 0, 2, 0.02).name('听觉系数·冲刺'));
  track(fPrey.add(cfg, 'noiseCoefLunge', 0, 2, 0.02).name('听觉系数·扑击'));
  track(fPrey.add(cfg, 'suspicionAlert', 0, 2, 0.02).name('suspicion警觉阈'));
  track(fPrey.add(cfg, 'suspicionFlee', 0, 2, 0.02).name('suspicion逃跑阈'));
  track(fPrey.add(cfg, 'suspicionDecay', 0, 3, 0.02).name('suspicion衰减/s'));
  // A2 freeze
  track(fPrey.add(cfg, 'freezeMin', 0, 1.5, 0.02).name('冻结最短s'));
  track(fPrey.add(cfg, 'freezeMax', 0, 1.5, 0.02).name('冻结最长s'));
  track(fPrey.add(cfg, 'freezeBandMin', 0, 1.5, 0.02).name('冻结距离带近'));
  track(fPrey.add(cfg, 'freezeBandMax', 0, 1.5, 0.02).name('冻结距离带远'));
  // A3 zigzag
  track(fPrey.add(cfg, 'zigzagDistance', 0, 25, 0.5).name('zigzag距离'));
  track(fPrey.add(cfg, 'zigzagAngleMin', 0, 90, 1).name('zigzag偏角小°'));
  track(fPrey.add(cfg, 'zigzagAngleMax', 0, 90, 1).name('zigzag偏角大°'));
  track(fPrey.add(cfg, 'zigzagPeriodMin', 0.05, 1.2, 0.01).name('反转周期短s'));
  track(fPrey.add(cfg, 'zigzagPeriodMax', 0.05, 1.2, 0.01).name('反转周期长s'));
  track(fPrey.add(cfg, 'zigzagJitter', 0, 0.5, 0.02).name('反转周期抖动'));
  track(fPrey.add(cfg, 'zigzagSpeedFactor', 0.5, 1, 0.01).name('zigzag速度系数'));
  // A4 轨迹回避
  track(fPrey.add(cfg, 'evadeCurrentWeight', 0, 1, 0.02).name('回避·当前位置'));
  track(fPrey.add(cfg, 'evadeLandingWeight', 0, 1, 0.02).name('回避·着陆点'));
  track(fPrey.add(cfg, 'landingPredict', 0, 1.2, 0.02).name('着陆点预测系数'));
  // E3 重生防贴脸
  track(fPrey.add(cfg, 'respawnMinDist', 0, 60, 0.5).name('重生最近距离'));
  track(fPrey.add(cfg, 'respawnViewDeg', 0, 90, 1).name('重生避开视角°'));
  track(fPrey.add(cfg, 'respawnAttempts', 1, 50, 1).name('重生尝试次数'));

  // —— 相机 ——
  const fCam = gui.addFolder('相机 / Camera');
  track(fCam.add(cfg, 'camDist', 2, 12, 0.1).name('跟随距离'));
  track(fCam.add(cfg, 'camHeight', 0.5, 6, 0.05).name('高度'));
  track(fCam.add(cfg, 'camPitch', -0.4, 1.2, 0.02).name('俯仰'));
  track(fCam.add(cfg, 'camLookAhead', 0, 6, 0.1).name('注视超前'));
  track(fCam.add(cfg, 'camDamp', 1, 30, 0.5).name('跟随平滑'));

  // —— 可视化开关 ——
  const fView = gui.addFolder('可视化 / Visualize');
  track(fView.add(view, 'enabled').name('显示辅助线'));
  track(fView.add(view, 'collision').name('碰撞体积'));
  track(fView.add(view, 'catchRange').name('扑击范围'));
  track(fView.add(view, 'detect').name('察觉半径'));

  // —— 工具 ——
  const tools = {
    扑击一次: () => hooks.pounce?.(),
    增加猎物: () => api.addPrey(),
    移除猎物: () => api.removePrey(),
    复位猎物: () => api.respawnAll(cfg.preyCount),
    回到原点: () => api.teleport(0, -6, 0),
    保存配置: () => { localStorage.setItem('m3d_paf_cfg_v1', JSON.stringify(cfg, null, 2)); flashStatus('已保存到本机 localStorage'); },
    重置默认: () => { api.resetTuning(); controllers.forEach((c) => c.updateDisplay()); flashStatus('已重置为默认（未保存）'); },
    导出JSON: () => exportJson(),
    导入JSON: () => importJson(),
    打开反馈: () => hooks.openFeedback?.(),
    查看本机反馈: () => showLocalFeedback(),
  };
  const fTools = gui.addFolder('工具 / Tools');
  track(fTools.add(tools, '扑击一次'));
  track(fTools.add(tools, '增加猎物'));
  track(fTools.add(tools, '移除猎物'));
  track(fTools.add(tools, '复位猎物'));
  track(fTools.add(tools, '回到原点'));
  track(fTools.add(tools, '保存配置'));
  track(fTools.add(tools, '重置默认'));
  track(fTools.add(tools, '导出JSON'));
  track(fTools.add(tools, '导入JSON'));
  track(fTools.add(tools, '打开反馈'));
  track(fTools.add(tools, '查看本机反馈'));

  [sf, fView, fTools].forEach((f) => f.open());

  // —— 状态提示条 ——
  const toast = document.createElement('div');
  toast.style.cssText = 'position:fixed;left:16px;bottom:16px;z-index:200;background:rgba(20,28,20,.9);color:#cfe6c0;border:1px solid #5a6b4c;border-radius:8px;padding:8px 12px;font-size:12px;max-width:340px;display:none;font-family:inherit';
  document.body.appendChild(toast);
  let toastT = null;
  function flashStatus(t) { toast.textContent = t; toast.style.display = 'block'; clearTimeout(toastT); toastT = setTimeout(() => { toast.style.display = 'none'; }, 2200); }

  function exportJson() {
    const blob = new Blob([JSON.stringify(cfg, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = 'play-as-fox-config.json';
    a.click(); URL.revokeObjectURL(a.href);
    flashStatus('已导出配置 JSON');
  }
  function importJson() {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = 'application/json,.json';
    inp.onchange = () => {
      const f = inp.files?.[0]; if (!f) return;
      const r = new FileReader();
      r.onload = () => {
        try {
          const data = JSON.parse(String(r.result));
          Object.keys(cfg).forEach((k) => { if (Number.isFinite(data[k])) cfg[k] = data[k]; });
          controllers.forEach((c) => c.updateDisplay());
          flashStatus('已导入并应用（记得点保存配置）');
        } catch { flashStatus('导入失败：JSON 解析错误'); }
      };
      r.readAsText(f);
    };
    inp.click();
  }
  function showLocalFeedback() {
    const q = readFeedbackQueue();
    const wrap = document.createElement('div');
    wrap.style.cssText = 'position:fixed;inset:0;z-index:210;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center';
    const box = document.createElement('div');
    box.style.cssText = 'background:#1c261a;color:#dfe8d6;border:1px solid #5a6b4c;border-radius:12px;padding:16px;width:min(680px,86vw);max-height:82vh;overflow:auto;font-size:13px';
    const items = q.length
      ? q.map((it, i) => `<div style="border-bottom:1px solid #33402f;padding:8px 0"><b>#${i + 1} [${it.type || '反馈'}]</b> ${new Date(it.createdAt || 0).toLocaleString()}<br>${String(it.description || '').replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]))}</div>`).join('')
      : '<p>本机暂无反馈。未联网上报成功的反馈会保存在这里（localStorage 离线队列）。</p>';
    box.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px"><b>本机反馈队列（${q.length} 条）</b><button id="pafFbClose" style="background:#3a4a30;color:#e7eedf;border:none;border-radius:8px;padding:6px 12px;cursor:pointer">关闭</button></div>${items}`;
    wrap.appendChild(box); document.body.appendChild(wrap);
    wrap.querySelector('#pafFbClose').onclick = () => wrap.remove();
    wrap.onclick = (e) => { if (e.target === wrap) wrap.remove(); };
  }

  // —— 每帧驱动 3D 可视化（独立 rAF；模式退出后自停） ——
  let raf = 0; let alive = true;
  const tick = () => {
    if (!alive) return;
    if (!window.__playAsFox) { dispose(); return; }
    try { view3d?.update(api, view); } catch (e) { /* 可视化绝不影响玩法 */ }
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);

  function dispose() {
    if (!alive) return;
    alive = false;
    cancelAnimationFrame(raf);
    try { gui.destroy(); } catch { /* ignore */ }
    toast.remove();
    view3d?.dispose();
    if (window.__pafDebug === handle) window.__pafDebug = null;
  }
  const handle = { dispose, gui, flashStatus };
  window.__pafDebug = handle;
  return handle;
}
