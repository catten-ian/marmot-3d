import { Fox } from './fox.js';
import { FOX, roamBounds } from '../core/config.js';
import { clamp, terrainHeight } from '../core/utils.js';
import { utilityScores, updatePerception, applyInterruption, stepSmartMotion } from './smart-fox-core.mjs';

/** DEV-only intelligent fox. Ordinary Fox never imports or uses this class. */
export class SmartFox extends Fox {
  constructor(scene, x, z, level, slot, opts = {}) {
    super(scene, x, z, 'normal', level, slot, opts);
    this.type = 'smart';
    this.cfg = { ...this.cfg, label: '智能狐', scale: this.cfg.scale * 1.04 };
    this.maxHp = this.hp = opts.hp ?? this.maxHp;
    this.intent = 'observe';
    this.topScores = {};
    this.suspicion = 0;
    this.memory = 0;
    this.interruptions = 0;
    this.fatigue = 0;
    this.pounceCommitted = false;
    this._smartState = { x, z, vx: 0, vz: 0, yaw: this.yaw, maxTurnRate: 2.8, acceleration: 18 };
  }

  update(dt, p, safe, levelCfg, burrow, terrainAt = terrainHeight) {
    if (this.fleeing || this.hp <= 0 || this.stun > 0) {
      return super.update(dt, p, safe, levelCfg, burrow, terrainAt);
    }
    const dx = p.x - this.x, dz = p.z - this.z;
    const distance = Math.hypot(dx, dz);
    const facingYaw = p.facingYaw ?? p.yaw ?? 0;
    const viewDot = Math.cos(facingYaw - Math.atan2(this.x - p.x, this.z - p.z));
    const guard = !!(p.guard || p.guarding);
    const perceived = updatePerception({ suspicion: this.suspicion }, {
      distance, viewDot, guard, running: !!p.running,
    }, dt);
    this.suspicion = perceived.suspicion;
    const scores = utilityScores({ distance, playerFacing: Math.max(0, viewDot), guard,
      fatigue: this.fatigue, health: this.hp / this.maxHp, interruptions: this.interruptions,
      memory: this.memory, suspicion: this.suspicion });
    let intent = this.pounceCommitted ? 'pounce' : scores.topIntent;
    if (safe) intent = 'recover';
    this.intent = intent;
    this.topScores = scores.scores;
    const next = stepSmartMotion({ ...this._smartState, x: this.x, z: this.z, yaw: this.yaw,
      pounceCommitted: this.pounceCommitted, pounceCooldown: this._smartState.pounceCooldown || 0, intent: this.intent }, { x: p.x, z: p.z }, dt, intent);
    this._smartState = next;
    this.x = next.x; this.z = next.z; this.yaw = next.yaw; this.pounceCommitted = !!next.pounceCommitted;
    this.state = this.pounceCommitted ? 'dash' : intent === 'observe' ? 'roam' : intent;
    this.fatigue = clamp(this.fatigue + (this.pounceCommitted ? 0.2 : 0.04) * dt - 0.03 * dt);
    const bounds = roamBounds();
    this.x = clamp(this.x, -bounds.hw, bounds.hw); this.z = clamp(this.z, -bounds.hh, bounds.hh);
    this._resolveObstacleOverlaps(burrow);
    this._applyTransform(dt, terrainAt);
    this._updateHpBar();
    this.warn.visible = this.pounceCommitted;
  }

  hit(damage, knockback, stun, fromX, fromZ) {
    const result = super.hit(damage, knockback, stun, fromX, fromZ);
    this.interruptions += 1;
    const m = applyInterruption({ memory: this.memory, interruptions: this.interruptions, health: this.hp / this.maxHp },
      'damage');
    this.memory = m.memory ?? this.memory;
    this.fatigue = clamp(this.fatigue + 0.18);
    this.pounceCommitted = false;
    return result;
  }
}
