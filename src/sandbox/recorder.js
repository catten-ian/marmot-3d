/**
 * 沙盒操作录制器（仅在 beta 沙盒由调用方用 IS_BETA 守卫后使用）。
 *
 * 设计目标：记录"一段时间内玩家与狐狸的离散动作序列"（不是视频、不做确定性回放），
 * 让人事后能读懂"玩家是怎么把狐狸打退 / 打死首领的"。
 * AI/特效层大量使用无 seed 的 Math.random()，本模块只做观测记录，不承诺可复现回放。
 *
 * 事件为普通对象：{ t: <相对开始秒>, type, ...参数 }。
 */
export const RECORD_FORMAT = 'marmot-3d-action-recording';
export const RECORD_VERSION = 1;
export const RECORD_LIMIT_EVENTS = 4000;
export const RECORD_POSE_HZ = 12;

/** 需要记录的狐狸状态迁移（其余中间态不记）。 */
export const SIGNIFICANT_FOX_STATES = new Set([
  'wind', 'dash', 'rest', 'retreat', 'rest_safe', 'flee', 'dead', 'dummy', 'defeated',
]);

function round(n, d = 2) {
  return Number(Number(n).toFixed(d));
}

/**
 * 从一段事件里提炼"战斗账本"：按狐聚合伤害、列出出招/命中/驱退时间线。
 * 纯函数，便于单测，也供面板内可读输出使用。
 */
export function summarizeTake(events = []) {
  const byType = {};
  const damageByFox = new Map();
  const strikes = [];
  const playerHits = [];
  const foxFates = []; // repelled / gone / respawn
  const timeline = [];
  for (const e of events) {
    byType[e.type] = (byType[e.type] || 0) + 1;
    if (e.type === 'strike') {
      strikes.push({ t: e.t, move: e.move, running: !!e.running });
      timeline.push({ t: e.t, kind: '出招', text: `${e.move}${e.running ? '(奔跑)' : ''}` });
    } else if (e.type === 'fox-hit') {
      const key = e.fox || '?';
      const cur = damageByFox.get(key) || { fox: key, foxType: e.foxType, hits: 0, damage: 0, lastHp: e.hpAfter, events: [] };
      cur.hits += 1;
      cur.damage += Number(e.damage) || 0;
      cur.lastHp = e.hpAfter;
      cur.events.push({ t: e.t, damage: e.damage, hpAfter: e.hpAfter, outcome: e.outcome });
      damageByFox.set(key, cur);
      timeline.push({ t: e.t, kind: '命中', text: `${e.foxType} -${e.damage} → hp ${e.hpAfter}（${e.outcome}）` });
      if (e.outcome === 'repelled' || e.outcome === 'gone') {
        foxFates.push({ t: e.t, fox: key, foxType: e.foxType, outcome: e.outcome });
      }
    } else if (e.type === 'player-hit') {
      playerHits.push({ t: e.t, foxType: e.foxType, damage: e.damage, hpAfter: e.hpAfter, prevented: !!e.preventedByGodMode });
      timeline.push({ t: e.t, kind: '受伤', text: `${e.foxType} 造成 ${e.damage}${e.preventedByGodMode ? '（无敌挡下）' : ''} → hp ${e.hpAfter}` });
    } else if (e.type === 'fox-state') {
      if (e.to === 'flee' || e.to === 'dead' || e.to === 'rest_safe' || e.to === 'retreat' || e.to === 'defeated') {
        timeline.push({ t: e.t, kind: '狐状态', text: `${e.foxType || e.fox} ${e.from}→${e.to}` });
      }
    } else if (e.type === 'fox-respawn') {
      foxFates.push({ t: e.t, fox: e.fox, foxType: e.foxType, outcome: 'respawn' });
      timeline.push({ t: e.t, kind: '增援', text: `${e.foxType} 重新出现` });
    } else if (e.type === 'jump' || e.type === 'dodge' || e.type === 'burst' || e.type === 'ultimate' || e.type === 'view') {
      timeline.push({ t: e.t, kind: { jump: '跳跃', dodge: '翻滚', burst: '爆发', ultimate: '大招', view: '视角' }[e.type], text: e.type === 'view' ? (e.thirdPerson ? '第三人称' : '第一人称') : '' });
    } else if (e.type === 'graze' || e.type === 'gather' || e.type === 'forage') {
      timeline.push({ t: e.t, kind: '采食', text: e.phase || e.kind || e.type });
    }
  }
  const foxes = Array.from(damageByFox.values()).map((f) => ({
    fox: f.fox, foxType: f.foxType, hits: f.hits, damage: round(f.damage, 2), lastHp: f.lastHp,
    ledger: f.events,
  }));
  timeline.sort((a, b) => a.t - b.t);
  return {
    counts: byType,
    strikes,
    foxes,
    playerHits,
    fates: foxFates,
    timeline,
    duration: events.length ? round(events[events.length - 1].t, 2) : 0,
  };
}

/** 把 summary 渲染成可读文本（面板展示 / 报告用）。 */
export function renderSummaryText(summary) {
  const L = [];
  L.push(`时长 ${summary.duration}s；事件统计：${Object.entries(summary.counts).map(([k, v]) => `${k}×${v}`).join('、') || '无'}`);
  if (summary.foxes.length) {
    L.push('— 按狐伤害账本 —');
    for (const f of summary.foxes) {
      L.push(`[${f.fox} ${f.foxType}] 命中 ${f.hits} 次 / 累计 ${f.damage} / 末血 ${f.lastHp}`);
      L.push('   ' + f.ledger.map((g) => `t${g.t}s -${g.damage}→${g.hpAfter}(${g.outcome})`).join('  '));
    }
  }
  if (summary.fates.length) {
    L.push('— 结局 —');
    for (const x of summary.fates) L.push(`t${x.t}s ${x.foxType||x.fox}：${x.outcome}`);
  }
  if (summary.playerHits.length) {
    L.push('— 玩家受伤 —');
    for (const h of summary.playerHits) L.push(`t${h.t}s ${h.foxType} -${h.damage} → hp${h.hpAfter}${h.prevented ? '（无敌）' : ''}`);
  }
  L.push('— 战斗时间线（前 60 条）—');
  L.push(...summary.timeline.slice(0, 60).map((x) => `t${x.t}s ${x.kind} ${x.text}`.trimEnd()));
  return L.join('\n');
}

export class SandboxRecorder {
  constructor({ maxEvents = RECORD_LIMIT_EVENTS, now = () => 0 } = {}) {
    this.maxEvents = maxEvents;
    this._now = now;
    this._ids = new WeakMap();
    this._nextId = 1;
    this.reset();
  }

  reset() {
    this.active = false;
    this.startAt = 0;
    this.events = [];
    this.lastTake = null;
    this._poseAcc = 0;
    this._lastPose = null;
    this._foxState = new Map();
  }

  status(nowSec = this._now()) {
    return {
      active: this.active,
      events: this.events.length,
      elapsed: this.active ? round(nowSec - this.startAt, 1) : (this.lastTake?.durationSec ?? 0),
      hasTake: !!this.lastTake,
    };
  }

  idFor(fox) {
    let id = this._ids.get(fox);
    if (!id) { id = `F${this._nextId++}`; this._ids.set(fox, id); }
    return id;
  }

  start(nowSec = this._now(), meta = {}) {
    this.reset();
    this.active = true;
    this.startAt = nowSec;
    this._startMeta = { ...meta };
    this.push('rec-start', meta, nowSec);
  }

  /** 停止并生成最近一段 take（含 summary）。 */
  stop(nowSec = this._now(), meta = {}) {
    if (!this.active) return this.lastTake;
    this.push('rec-stop', meta, nowSec);
    this.active = false;
    const summary = summarizeTake(this.events);
    this.lastTake = {
      format: RECORD_FORMAT,
      version: RECORD_VERSION,
      recordedAt: new Date().toISOString(),
      durationSec: summary.duration,
      meta: this._startMeta || {},
      events: this.events.slice(),
      summary,
    };
    return this.lastTake;
  }

  push(type, data = {}, nowSec = this._now()) {
    if (!this.active) return false;
    const ev = { t: round(nowSec - this.startAt, 3), type, ...data };
    this.events.push(ev);
    if (this.events.length > this.maxEvents) {
      // 超长录制只保留最近的事件（仍保留首条 rec-start 语义由事件类型自描述）。
      this.events.splice(1, this.events.length - this.maxEvents);
    }
    return true;
  }

  /** 离散动作便捷记录。 */
  strike(move, extra = {}, nowSec = this._now()) { return this.push('strike', { move, ...extra }, nowSec); }
  foxHit(data, nowSec = this._now()) { return this.push('fox-hit', data, nowSec); }
  playerHit(data, nowSec = this._now()) { return this.push('player-hit', data, nowSec); }
  jump(extra = {}, nowSec = this._now()) { return this.push('jump', extra, nowSec); }
  dodge(extra = {}, nowSec = this._now()) { return this.push('dodge', extra, nowSec); }
  burst(nowSec = this._now()) { return this.push('burst', {}, nowSec); }
  ultimate(nowSec = this._now()) { return this.push('ultimate', {}, nowSec); }
  view(thirdPerson, nowSec = this._now()) { return this.push('view', { thirdPerson }, nowSec); }
  forageEvent(type, data, nowSec = this._now()) { return this.push(type, data, nowSec); }

  /**
   * 周期采样玩家位姿：按 RECORD_POSE_HZ 节流；移动/奔跑/防御/在洞状态变化才记录，
   * 静止时插入少量心跳，避免无意义刷屏。
   */
  samplePose(dt, nowSec, pose) {
    if (!this.active) return;
    this._poseAcc += Math.max(0, dt);
    const interval = 1 / RECORD_POSE_HZ;
    if (this._poseAcc < interval) return;
    this._poseAcc = 0;
    const last = this._lastPose;
    const moved = !last ? Infinity : Math.hypot(pose.x - last.x, pose.z - last.z);
    const flagsChanged = !last || last.running !== !!pose.running || last.guard !== !!pose.guard
      || last.inBurrow !== !!pose.inBurrow || Math.abs((last.speed || 0) - (pose.speed || 0)) > 0.4;
    const heartbeat = !last || nowSec - (last._at ?? this.startAt) > 0.5;
    if (!flagsChanged && moved < 0.05 && !(moved >= 0.05) && !heartbeat) return;
    const rec = {
      x: round(pose.x), z: round(pose.z), yaw: round(pose.yaw, 3),
      speed: round(pose.speed || 0), running: !!pose.running, guard: !!pose.guard,
      inBurrow: !!pose.inBurrow, hp: pose.hp, energy: pose.energy,
    };
    this._lastPose = { ...pose, _at: nowSec };
    this.push('pose', rec, nowSec);
  }

  /** 每帧调用：检测狐狸显著状态迁移并记录（含增援/死亡）。 */
  sampleFoxStates(nowSec, foxes = []) {
    if (!this.active) return;
    const live = new Set();
    for (const f of foxes) {
      if (!f || f.isSandboxDummy) continue;
      const id = this.idFor(f);
      live.add(id);
      const from = this._foxState.get(id);
      const to = f.state;
      if (from !== to) {
        // flee→roam 且血量回满：离场增援重新出现（区别于一般状态迁移）
        if (from === 'flee' && to === 'roam') {
          this.push('fox-respawn', {
            fox: id, foxType: f.type, hp: round(f.hp, 1), x: round(f.x), z: round(f.z),
          }, nowSec);
        } else if (!from || SIGNIFICANT_FOX_STATES.has(to)) {
          this.push('fox-state', {
            fox: id, foxType: f.type, from: from || null, to,
            hp: round(f.hp, 1), x: round(f.x), z: round(f.z),
          }, nowSec);
        }
        this._foxState.set(id, to);
      }
    }
  }

  /** 显式记录增援（fox 重新出现）。 */
  foxRespawn(fox, nowSec = this._now()) {
    if (!this.active) return;
    const id = this.idFor(fox);
    this._foxState.set(id, fox.state);
    this.push('fox-respawn', { fox: id, foxType: fox.type, x: round(fox.x), z: round(fox.z) }, nowSec);
  }

  toJSON(nowSec = this._now()) {
    const summary = summarizeTake(this.events);
    return {
      format: RECORD_FORMAT, version: RECORD_VERSION, recordedAt: new Date().toISOString(),
      durationSec: summary.duration, meta: this._startMeta || {}, events: this.events.slice(), summary,
    };
  }
}

/**
 * 触发浏览器下载（JSON）。无 DOM（node 单测）时 fail-soft 返回 false，不抛错。
 */
export function downloadTake(take, filename) {
  try {
    if (typeof document === 'undefined' || typeof URL === 'undefined' || typeof Blob === 'undefined') return false;
    const name = filename || `marmot-action-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    const blob = new Blob([JSON.stringify(take, null, 2)], { type: 'application/json' });
    const href = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = href; a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(href), 1000);
    return true;
  } catch (_) {
    return false;
  }
}
