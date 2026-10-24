/**
 * HUD 与界面流程：状态条更新、准星、目标面板、提示、面板切换。
 * DOM 更新做了节流，避免每帧操作布局导致掉帧。
 */
import { LEVELS } from '../core/config.js';
import { bindText } from '../core/key-hints.mjs';

const CH_CIRCUMFERENCE = 2 * Math.PI * 18;

export class HUD {
  constructor() {
    this.el = {
      hpBar: document.getElementById('hpBar'),
      hpText: document.getElementById('hpText'),
      energyBar: document.getElementById('energyBar'),
      energyText: document.getElementById('energyText'),
      stressBar: document.getElementById('stressBar'),
      stressText: document.getElementById('stressText'),
      mission: document.getElementById('mission'),
      combatInfo: document.getElementById('combatInfo'),
      ultimateStatus: document.getElementById('ultimateStatus'),
      chargeBar: document.getElementById('chargeBar'),
      boostStatus: document.getElementById('boostStatus'),
      cortisolStatus: document.getElementById('cortisolStatus'),
      socialStatus: document.getElementById('socialStatus'),
      objective: document.getElementById('objective'),
      sandboxStatus: document.getElementById('sandboxStatus'),
      toast: document.getElementById('toast'),
      banner: document.getElementById('banner'),
      overlay: document.getElementById('overlay'),
      panel: document.getElementById('panel'),
      interactPrompt: document.getElementById('interactPrompt'),
      forageFeedback: document.getElementById('forageFeedback'),
      chCharge: document.getElementById('chCharge'),
      threat: document.getElementById('threatIndicator'),
      perfHint: document.getElementById('perfHint'),
      loader: document.getElementById('loader'),
      loaderFill: document.getElementById('loaderFill'),
    };

    this.toastTimer = 0;
    this.bannerTimer = 0;
    this._threatMarks = [];
    this._lastObjective = '';

    // 屏幕状态描边（替代地面光环）
    this.vignette = document.getElementById('stateVignette');

    // 受击红闪层
    this.flash = document.createElement('div');
    this.flash.id = 'flashLayer';
    document.body.appendChild(this.flash);

    // 大招白闪层（与受击红闪分开，避免两种反馈互相覆盖）
    this.ultFlash = document.createElement('div');
    this.ultFlash.id = 'ultFlashLayer';
    document.body.appendChild(this.ultFlash);
    this._ultFlashTimer = null;
  }

  setForage({ active = false, kind = 'grass', progress = 0, emergency = false } = {}) {
    const el = this.el.forageFeedback;
    if (!el) return;
    el.hidden = !active;
    if (!active) return;
    const labels = { grass: '啃食中…', flower: '采花中…', berry: '采食中…' };
    el.classList.toggle('emergency', !!emergency);
    el.querySelector('.forage-label').textContent = emergency ? '危险！进食变慢' : labels[kind] || labels.grass;
    el.querySelector('.forage-track i').style.width = `${Math.max(0, Math.min(1, progress)) * 100}%`;
  }

  setLoading(pct) {
    this.el.loaderFill.style.width = pct + '%';
  }

  hideLoader() {
    this.el.loader.classList.add('gone');
    setTimeout(() => { this.el.loader.style.display = 'none'; }, 600);
  }

  /** 短提示气泡 */
  say(text, dur = 2.4) {
    this.el.toast.textContent = text;
    this.el.toast.classList.add('on');
    this.toastTimer = dur;
  }

  /** 大字横幅（关卡开始 / 结算） */
  banner(text, dur = 2.2) {
    this.el.banner.textContent = text;
    this.el.banner.classList.add('on');
    this.bannerTimer = dur;
  }

  hurtFlash() {
    this.flash.classList.add('on');
    setTimeout(() => this.flash.classList.remove('on'), 90);
  }

  /** K 协同大招释放时的全屏白闪 */
  flashScreen() {
    const el = this.ultFlash;
    el.classList.add('on');
    clearTimeout(this._ultFlashTimer);
    this._ultFlashTimer = setTimeout(() => el.classList.remove('on'), 320);
  }

  /** 交互提示（靠近伙伴/洞穴） */
  setInteractPrompt(text) {
    const el = this.el.interactPrompt;
    if (text) {
      el.innerHTML = text;
      el.classList.add('on');
    } else {
      el.classList.remove('on');
    }
  }

  /**
   * 主更新：所有数值面板。dt 用于节流内部文本重写。
   */
  update(g, stats, cfg, dt) {
    const p = g.player;

    this.el.hpBar.style.width = p.hp + '%';
    this.el.energyBar.style.width = p.energy + '%';
    this.el.stressBar.style.width = p.stress + '%';

    document.body.classList.toggle('overloaded', stats.overloaded);

    // 屏幕状态描边：优先级 大招 > 爆发 > 过载 > 疲劳 > 陪伴
    const v = this.vignette;
    let vig = '';
    if (g.overdrive > 0) vig = 'overdrive';
    else if (g.boost > 0) vig = 'boost';
    else if (stats.overloaded) vig = 'overloaded';
    else if (g.fatigue > 0) vig = 'fatigue';
    else if (g.social > 0) vig = 'social';
    if (vig !== this._vig) {
      v.className = vig;
      this._vig = vig;
    }

    // 准星蓄力环
    const chargeRatio = g.charge / 100;
    this.el.chCharge.style.strokeDashoffset = String(CH_CIRCUMFERENCE * (1 - chargeRatio));
    this.el.chCharge.style.stroke = g.overdrive > 0 ? '#f0c8ff' : chargeRatio >= 1 ? '#ffd97e' : '#b58ae8';

    if (this.toastTimer > 0) {
      this.toastTimer -= dt;
      if (this.toastTimer <= 0) this.el.toast.classList.remove('on');
    }
    if (this.bannerTimer > 0) {
      this.bannerTimer -= dt;
      if (this.bannerTimer <= 0) this.el.banner.classList.remove('on');
    }

    // 文本类内容节流到 10Hz
    this._textAcc = (this._textAcc || 0) + dt;
    if (this._textAcc < 0.1) return;
    this._textAcc = 0;

    this.el.hpText.textContent = Math.round(p.hp) + '/100';
    this.el.energyText.textContent = Math.round(p.energy) + '/100';
    this.el.stressText.textContent = Math.round(p.stress) + (stats.overloaded ? ' · 过载' : '');

    // Keep only level identity and live status in the always-visible mission
    // chip. Instructional text lives in the always-visible objective card.
    this.el.mission.innerHTML = g.sandbox
      ? '<b>自由测试 · 无关卡 / 无时间限制</b><br>移动、攻击与狐狸机动均可反复测试'
      : `第 <b>${g.level + 1}</b> / ${LEVELS.length} 关 · ${cfg.name}<br>` +
      `${g.freezeTimer ? '测试模式：无时间限制' : `剩余 <b>${Math.ceil(g.time)}</b> 秒`} · 位置：${g.inBaseBurrow ? '<b style="color:#ffd080">大本营内</b>' : g.inBurrow ? '<b style="color:#9bd4dc">临时避难洞内</b>' : '草地上'}`;

    const state = g.overdrive > 0 ? '协同大招'
      : g.boost > 0 ? '应急爆发'
      : stats.tier > 0 ? '持续动员'
      : '常态';
    let detail = `伤害 ${stats.damage.toFixed(1)} · 攻速 ${(1 / stats.cooldown).toFixed(1)}/秒`;
    if (stats.overloaded) detail += '<br><span class="warn">负荷 ≥75：伤害 −25%、攻速下降、移动 −18%</span>';
    else if (g.fatigue > 0) detail += `<br><span style="color:#c9c3d7">大招后疲劳 ${Math.ceil(g.fatigue)}s：移速 −20%、攻速下降</span>`;
    else if (stats.weak) detail += '<br><span style="color:#ffb1a4">储备见底：伤害与移速下降，回洞休息或采食</span>';
    this.el.combatInfo.innerHTML = `战斗：<strong>${state}</strong> · 范围 ${stats.range.toFixed(1)}m · `
      + `移速 ${ (6.6 * stats.speedMul).toFixed(1) }m/s`
      + `<span class="combat-detail">${detail}</span>`;

    const burstKey = bindText(null, 'burst', '');
    const ultKey = bindText(null, 'ultimate', '');
    const interactKey = bindText(null, 'interact', '');
    if (g.overdrive > 0) {
      this.el.ultimateStatus.textContent = `${ultKey} 大招生效 ${Math.ceil(g.overdrive)}s · 伤害 +5`;
    } else if (g.overCD > 0) {
      this.el.ultimateStatus.textContent = `${ultKey} 大招冷却 ${Math.ceil(g.overCD)}s · 蓄力 ${Math.round(g.charge)}/100`;
    } else if (g.charge >= 100) {
      this.el.ultimateStatus.textContent = `${ultKey} 大招就绪 · 范围冲击`;
    } else {
      this.el.ultimateStatus.textContent = `${ultKey} 大招蓄力 ${Math.round(g.charge)}/100`;
    }
    this.el.chargeBar.style.width = g.charge + '%';

    this.el.boostStatus.innerHTML = '<strong>' + (burstKey ? `${burstKey} ` : '') + '应急爆发</strong> '
      + (g.boost > 0 ? `生效 ${Math.ceil(g.boost)}s` : g.boostCD > 0 ? `冷却 ${Math.ceil(g.boostCD)}s` : '就绪');
    this.el.cortisolStatus.innerHTML = '<strong>持续动员</strong> '
      + `${Math.round(g.cortisol)}/100`
      + (g.cortisol >= 60 ? ' · 攻击 +2' : g.cortisol >= 25 ? ' · 攻击 +1' : ' · 达 25 后攻击 +1');
    this.el.socialStatus.innerHTML = '<strong>' + (interactKey ? `${interactKey} ` : '') + '陪伴</strong> '
      + (!g.friend.saved ? '先救伙伴' : g.social > 0 ? `缓压中 ${Math.ceil(g.social)}s` : g.socialCD > 0 ? `冷却 ${Math.ceil(g.socialCD)}s` : '回大本营使用');

    this._updateObjective(g, cfg);
  }

  _updateObjective(g, cfg) {
    if (g.sandbox) {
      // Keep a defensive fallback for any embedded shell without a dedicated
      // sandbox card; the canonical beta shells provide #sandboxStatus.
      if (!this.el.sandboxStatus) {
        this.el.objective.hidden = false;
        if (this._lastObjective !== 'sandbox') {
          this._lastObjective = 'sandbox';
          this.el.objective.innerHTML = '<div class="obj-title">沙盒状态</div><div class="obj-row done"><span>关卡目标</span><b>关闭</b></div><div class="obj-row done"><span>时间限制</span><b>关闭</b></div>';
        }
        return;
      }
      this.el.objective.hidden = true;
      this.el.sandboxStatus.classList.add('on');
      this.el.sandboxStatus.setAttribute('aria-hidden', 'false');
      if (this._lastObjective === 'sandbox') return;
      this._lastObjective = 'sandbox';
      this.el.sandboxStatus.innerHTML = '<div class="obj-title">沙盒状态</div><div class="obj-row done"><span>关卡目标</span><b>关闭</b></div><div class="obj-row done"><span>时间限制</span><b>关闭</b></div>';
      return;
    }
    this.el.objective.hidden = false;
    this.el.sandboxStatus?.classList.remove('on');
    this.el.sandboxStatus?.setAttribute('aria-hidden', 'true');
    const f = g.friend;
    const key = `${g.level}/${g.foodCount}/${f.rescued}/${f.saved}/${g.inBurrow}/${cfg.goal}/${Math.ceil(g.time)}/${g.season ? g.season.season : ''}`;
    if (key === this._lastObjective) return;
    this._lastObjective = key;

    const row = (label, cur, need) =>
      `<div class="obj-row ${cur >= need ? 'done' : ''}"><span>${label}</span><b>${cur}/${need}</b></div>`;

    // 普通关卡：目标卡常驻显示（与沙盒状态卡一致，不再需要点击展开）。
    let html = '<div class="obj-title">本关目标</div>';
    // dev 版：采食对象随季节变化，标签应随之改变
    const eatLabel = g.season ? `采食 · ${g.season.season}` : '采食浆果';
    html += row(eatLabel, g.foodCount, cfg.goal);
    html += `<div class="obj-row ${f.saved ? 'done' : ''}"><span>伙伴</span><b>${f.saved ? '已到家' : f.rescued ? '跟随中' : '待救援'}</b></div>`;
    html += `<div class="obj-row ${g.inBaseBurrow ? 'done' : ''}"><span>回大本营结算</span><b>${g.inBaseBurrow ? '在大本营' : g.inBurrow ? '临时避难中' : '未回洞'}</b></div>`;
    const levelHint = cfg.subtitle || cfg.brief;
    if (levelHint) html += `<div class="obj-hint">关卡提示：${levelHint}</div>`;
    // dev 版：显示当季说明，把季节性与进食强度联系起来（移动端 CSS 隐藏以控制高度）
    if (g.season) {
      html += `<div class="obj-season">${g.season.seasonNote}</div>`;
    }
    this.el.objective.innerHTML = html;
  }

  /**
   * 背后威胁方向指示：视野外的藏狐用屏幕边缘箭头提示，
   * 这是第一人称下防止被偷袭的关键信息。
   *
   * 同时也指示同伴：被困的伙伴会发出呼救（屏幕边缘的绿色箭头 + 文字），
   * 玩家不必四处张望就能朝它走去。
   */
  updateThreats(foxes, player, camera, forward, companion) {
    const marks = this._threatMarks;
    while (marks.length < 6) {
      const d = document.createElement('div');
      d.className = 'threat-mark';
      this.el.threat.appendChild(d);
      marks.push(d);
    }

    const camYaw = Math.atan2(forward.x, forward.z);

    // 收集需要指示的目标：藏狐（威胁）+ 被困伙伴（呼救）
    const items = [];
    for (const f of foxes) {
      if (!f.alive || f.hp <= 0) continue;
      const dx = f.x - player.x, dz = f.z - player.z;
      const d = Math.hypot(dx, dz);
      if (d > 22) continue;
      const dot = (dx * forward.x + dz * forward.z) / (d || 1);
      if (dot > 0.35) continue; // 在视野内，不需要指示
      items.push({
        ang: Math.atan2(dx, dz), d,
        kind: 'fox',
        color: f.state === 'wind' ? '#ff8a2a' : '#ff5a44',
        label: '',
      });
    }

    // 呼救的同伴：只要还没被救起就持续指示（不限于视野内 —— 呼救就是为了引你过去）
    if (companion && !companion.rescued && !companion.saved) {
      const dx = companion.x - player.x, dz = companion.z - player.z;
      const d = Math.hypot(dx, dz) || 1;
      const dot = (dx * forward.x + dz * forward.z) / d;
      // 在视野内时不显示边缘箭头（HUD 已有“伙伴·救援”提示）
      if (dot <= 0.35) {
        items.push({
          ang: Math.atan2(dx, dz), d,
          kind: 'help',
          color: '#7fe0a0',
          label: '呼救',
        });
      }
    }

    // 威胁优先显示（被偷袭更要紧），其次按距离
    items.sort((a, b) => (a.kind === b.kind ? a.d - b.d : a.kind === 'fox' ? -1 : 1));

    for (let i = 0; i < marks.length; i++) {
      const m = marks[i];
      if (i < items.length) {
        const t = items[i];
        let rel = t.ang - camYaw;
        while (rel > Math.PI) rel -= Math.PI * 2;
        while (rel < -Math.PI) rel += Math.PI * 2;
        m.style.display = 'block';
        m.style.transform = `rotate(${-rel}rad)`;
        m.style.opacity = String(Math.max(0.4, 1 - t.d / 24));
        m.style.borderBottomColor = t.color;
        m.dataset.kind = t.kind;
        // 呼救箭头带文字标签，威胁箭头不带（保持画面干净）
        m.dataset.label = t.label;
      } else {
        m.style.display = 'none';
      }
    }
  }

  setPerfHint(text) { this.el.perfHint.textContent = text; }

  // —— 面板 ——
  showPanel(html) {
    this.el.panel.classList.remove('level-select-panel');
    this.el.panel.innerHTML = html;
    this.el.overlay.hidden = false;
  }
  hidePanel() { this.el.overlay.hidden = true; }
}

// Total level count is read from the shared level configuration.
