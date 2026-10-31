import * as THREE from 'three';
import { GUI } from '../../vendor/lil-gui/lil-gui.esm.js';
import { PLAYER, FOX } from '../core/config.js';
import { STRIKE_VOLUMES } from './combat.js';

export { strikeVolumeGeometryData, rollGeometryData, foxAttackGeometryData, resolveStrikeProfile } from './debug-volume-data.js';
import { strikeVolumeGeometryData, rollGeometryData, foxAttackGeometryData, resolveStrikeProfile } from './debug-volume-data.js';

function makeLineMaterial(color, opacity) { return new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthTest: false }); }
function makeLabel(text, color = '#ffffff') { const c = document.createElement('canvas'); c.width = 256; c.height = 48; const x = c.getContext('2d'); x.font = '24px sans-serif'; x.fillStyle = color; x.strokeStyle = 'rgba(0,0,0,.8)'; x.lineWidth = 5; x.strokeText(text, 8, 32); x.fillText(text, 8, 32); const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthTest: false })); s.scale.set(1.8, 0.34, 1); return s; }
function makeFan(profile, color, opacity) {
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  for (const p of strikeVolumeGeometryData(profile).arc) shape.lineTo(p.x, p.z);
  shape.lineTo(0, 0);
  const geo = new THREE.ExtrudeGeometry(shape, { depth: profile.upper - profile.lower, bevelEnabled: false });
  geo.rotateX(Math.PI / 2); geo.translate(0, profile.lower, 0);
  return new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: opacity * 0.22, depthTest: false, side: THREE.DoubleSide }));
}

export class DebugVolumes {
  constructor({ scene, controller, foxes }) {
    this.scene = scene; this.controller = controller; this.foxes = foxes;
    if (typeof document !== 'undefined' && !document.querySelector('link[data-lil-gui]')) { const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = new URL('../../vendor/lil-gui/lil-gui.css', import.meta.url); link.dataset.lilGui = '1'; document.head.appendChild(link); }
    this.state = { enabled: true, opacity: 0.55, attacks: true, dodge: true, collision: true, foxAttacks: true, labels: false, followYaw: true, move: 'lunge' };
    this._stats = null; this._running = false; this._attackKey = '';
    this.root = new THREE.Group(); this.root.name = 'debug-volumes'; this.root.renderOrder = 999; scene.add(this.root);
    this.attack = new THREE.Group(); this.roll = new THREE.Group(); this.collision = new THREE.Group(); this.foxAttack = new THREE.Group(); this.labels = new THREE.Group();
    this.root.add(this.attack, this.roll, this.collision, this.foxAttack, this.labels);
    this._buildGui();
  }

  _buildGui() {
    const gui = new GUI({ title: '战斗数据显示' }); this.gui = gui;
    const attack = gui.addFolder('Player attack');
    attack.add(STRIKE_VOLUMES, 'halfAngle', 0.2, Math.PI, 0.01).name('halfAngle').onChange(() => this._rebuildAttack());
    for (const move of ['tap', 'stand', 'lunge']) {
      const f = attack.addFolder(move);
      const cfg = this._moveConfig(move);
      f.add(cfg, 'rangeMul', 0.2, 3, 0.01); f.add(cfg, 'range', -1, 5, 0.01);
      f.add(STRIKE_VOLUMES[move], 'lower', -1, 2, 0.01); f.add(STRIKE_VOLUMES[move], 'upper', 0.1, 3, 0.01);
      f.add(cfg, 'damageMul', 0, 5, 0.01); f.add(cfg, 'cooldownMul', 0, 3, 0.01); f.add(cfg, 'recovery', 0, 2, 0.01);
    }
    const dodge = gui.addFolder('Dodge');
    dodge.add(PLAYER.combatWheel.dodge, 'distance', 0, 8, 0.01); dodge.add(PLAYER.combatWheel.dodge, 'invuln', 0, 2, 0.01);
    dodge.add(PLAYER.combatWheel.dodge, 'recovery', 0, 2, 0.01); dodge.add(PLAYER.jump, 'dodgeHeight', 0, 2, 0.01);
    const collision = gui.addFolder('Collision'); collision.add(PLAYER, 'radius', 0.1, 2, 0.01); collision.add(PLAYER, 'collisionHeight', 0.1, 2, 0.01);
    for (const type of Object.keys(FOX.collisionRadius)) { collision.add(FOX.collisionRadius, type, 0.1, 3, 0.01).name(`${type} radius`); collision.add(FOX.collisionHeight, type, 0.1, 2, 0.01).name(`${type} height`); }
    const fox = gui.addFolder('Fox attack'); fox.add(FOX, 'windRange', 0, 20, 0.1); fox.add(FOX, 'groundAttackHeight', 0, 2, 0.01);
    for (const type of Object.keys(FOX.attacks)) { const a = FOX.attacks[type]; if (a.dashTime != null) fox.add(a, 'dashTime', 0.05, 2, 0.01).name(`${type} dashTime`); if (a.leapHeight != null) fox.add(a, 'leapHeight', 0, 3, 0.01).name(`${type} leapHeight`); }
    this._rebuildAttack();
    const vis = gui.addFolder('Visualization'); for (const k of ['enabled', 'attacks', 'dodge', 'collision', 'foxAttacks', 'labels', 'followYaw']) vis.add(this.state, k).onChange(() => this._rebuildAttack()); vis.add(this.state, 'opacity', 0, 1, 0.01).onChange(() => this._rebuildAttack()); vis.add(this.state, 'move', ['tap', 'stand', 'lunge']).onChange(() => this._rebuildAttack());
  }

  _moveConfig(move) { return PLAYER.combatWheel[move]; }
  _clear(group) { while (group.children.length) { const o = group.children.pop(); o.geometry?.dispose(); o.material?.dispose(); o.material?.map?.dispose(); } }
  _rebuildAttack() {
    this._clear(this.attack); if (!this.state.enabled || !this.state.attacks) return;
    const wheel = this._moveConfig(this.state.move);
    const profile = resolveStrikeProfile({ move: this.state.move, baseRange: this._stats?.range ?? 2.4, baseCooldown: this._stats?.cooldown ?? 0.58, wheel, running: this._running });
    this._attackKey = [this.state.move, profile.range, profile.lower, profile.upper, profile.halfAngle, this.state.opacity].join('|');
    const mesh = makeFan(profile, this.state.move === 'lunge' ? 0xffa36f : 0xfff1a9, this.state.opacity); this.attack.add(mesh);
  }

  update({ controller = this.controller, foxes = null, attackYaw = null, playerAttackAnim = '', stats = null, terrainHeight = null } = {}) {
    const foxList = typeof foxes === 'function' ? foxes() : (foxes || (typeof this.foxes === 'function' ? this.foxes() : []));
    if (!this.state.enabled) { this.root.visible = false; return; } this.root.visible = true;
    this._stats = stats || this._stats;
    this._running = !!(controller.crouch > 0.5 || controller.touchSprint);
    this.attack.position.set(controller.position.x, controller.position.y, controller.position.z); this.attack.rotation.y = this.state.followYaw ? (attackYaw ?? controller.yaw) : 0;
    const wheel = this._moveConfig(this.state.move);
    const currentProfile = resolveStrikeProfile({ move: this.state.move, baseRange: this._stats?.range ?? 2.4, baseCooldown: this._stats?.cooldown ?? 0.58, wheel, running: this._running });
    const currentKey = [this.state.move, currentProfile.range, currentProfile.lower, currentProfile.upper, currentProfile.halfAngle, this.state.opacity].join('|');
    if (currentKey !== this._attackKey) this._rebuildAttack();
    this._clear(this.roll);
    if (this.state.dodge) { const dir = { x: -Math.sin(controller.bodyYaw), z: -Math.cos(controller.bodyYaw) }; const rg = rollGeometryData({ distance: PLAYER.combatWheel.dodge.distance, invuln: PLAYER.combatWheel.dodge.invuln, direction: dir }); const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(controller.position.x, controller.position.y + 0.03, controller.position.z), new THREE.Vector3(controller.position.x + dir.x * rg.distance, controller.position.y + 0.03, controller.position.z + dir.z * rg.distance)]); this.roll.add(new THREE.Line(g, makeLineMaterial(0x9fe6a0, this.state.opacity))); }
    this._clear(this.collision);
    if (this.state.collision) { const g = new THREE.CylinderGeometry(PLAYER.radius, PLAYER.radius, PLAYER.collisionHeight, 20); const m = new THREE.MeshBasicMaterial({ color: 0x63c7ff, wireframe: true, transparent: true, opacity: this.state.opacity, depthTest: false }); const o = new THREE.Mesh(g, m); o.position.set(controller.position.x, controller.position.y + PLAYER.collisionHeight / 2, controller.position.z); this.collision.add(o); }
    if (this.state.collision) for (const f of foxList) {
      if (!f.alive) continue;
      const r = FOX.collisionRadius[f.type] ?? FOX.collisionRadius.normal; const h = FOX.collisionHeight[f.type] ?? FOX.collisionHeight.normal;
      const g = new THREE.CylinderGeometry(r, r, h, 20); const m = new THREE.MeshBasicMaterial({ color: 0xff6654, wireframe: true, transparent: true, opacity: this.state.opacity, depthTest: false });
      const o = new THREE.Mesh(g, m); o.position.set(f.x, (f.baseY || 0) + h / 2 + (f.leap || 0), f.z); this.collision.add(o);
    }
    this._clear(this.foxAttack);
    if (this.state.foxAttacks) for (const f of foxList) {
      if (!f.alive) continue;
      const d = foxAttackGeometryData(f);
      const groundY = typeof terrainHeight === 'function' ? terrainHeight(f.x, f.z) : 0.04;
      const y = groundY + (f.leap || 0);
      const endX = f.x + Math.sin(d.yaw) * d.distance; const endZ = f.z + Math.cos(d.yaw) * d.distance;
      const isLeap = d.type === 'fox-leap-track';
      const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(f.x, y + 0.03, f.z), new THREE.Vector3(endX, y + (isLeap ? d.leapHeight : 0) + 0.03, endZ)]);
      this.foxAttack.add(new THREE.Line(g, makeLineMaterial(isLeap ? 0xffc36a : 0xff6654, this.state.opacity)));
      // 线表示冲刺路径；当前位置的半径/高度柱表示实际接触攻击盒。
      const attackHeight = isLeap ? (FOX.collisionHeight[f.type] ?? FOX.collisionHeight.normal) : d.groundAttackHeight;
      const attackRadius = FOX.collisionRadius[f.type] ?? FOX.collisionRadius.normal;
      const attackGeo = new THREE.CylinderGeometry(attackRadius, attackRadius, attackHeight, 20);
      const attackMat = new THREE.MeshBasicMaterial({ color: isLeap ? 0xffc36a : 0xff6654, wireframe: true, transparent: true, opacity: this.state.opacity * 0.9, depthTest: false });
      const attackMesh = new THREE.Mesh(attackGeo, attackMat);
      attackMesh.position.set(f.x, y + attackHeight / 2, f.z);
      this.foxAttack.add(attackMesh);
    }
    this._clear(this.labels); if (this.state.labels) { const label = makeLabel(`attack: ${playerAttackAnim || this.state.move}`, '#fff1a9'); label.position.set(controller.position.x, controller.position.y + 1.1, controller.position.z); this.labels.add(label); if (foxList[0]) { const f = foxList[0]; const fl = makeLabel(`fox: ${f.state || 'idle'}`, '#ff9c8c'); fl.position.set(f.x, (f.baseY || 0) + 1.2 + (f.leap || 0), f.z); this.labels.add(fl); } }
  }
}
