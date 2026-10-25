const VIEW_RADIUS = 34;

/**
 * Source-of-truth for observation visibility. Beta keeps the map available for
 * the whole stationary posture blend (including grazing crouch and standing
 * back up); stable/dev retain the original settled-upright requirement.
 */
export function shouldObserveMinimap({
  beta = false, moving = false, inBurrow = false, crouch = 0, postureSpeed = 0,
} = {}) {
  if (moving || inBurrow) return false;
  if (beta) return true;
  return crouch < 0.08 && postureSpeed < 0.04;
}

/**
 * 世界坐标到小地图坐标：北向上，世界 +X 向屏幕右，世界 +Z 向屏幕下。
 * 因而世界 +Z 的标定点位保持在地图下方，不对地图本身做镜像。
 */
export function worldToMap(x, z, originX = 0, originZ = 0) {
  return { x: x - originX, y: z - originZ };
}

/**
 * Canvas 三角形的默认顶点朝屏幕上方；Three yaw=0 的角色前向是 -Z。
 * 在上述地图约定下，角度 = -yaw：-Z→上、+Z→下、+X→右、-X→左。
 */
export function worldYawToMapAngle(yaw) { return -Number(yaw || 0); }

/** 站立静止时显示的有限视野地图，北向上。 */
export class Minimap {
  constructor({ beta = false } = {}) {
    this.root = document.createElement('div');
    this.root.className = 'minimap';
    const label = beta ? '原地观察' : '站立观察';
    this.root.innerHTML = `<canvas width="220" height="220" aria-label="${label}小地图"></canvas><span>${label}</span>`;
    document.body.appendChild(this.root);
    this.canvas = this.root.querySelector('canvas');
    this.ctx = this.canvas.getContext('2d');
    this._visible = false;
  }

  update(data) {
    const now = performance.now();
    if (data?.visible) this._candidateSince ||= now;
    else this._candidateSince = 0;
    const show = !!data?.visible && now - (this._candidateSince || now) > 220;
    if (show !== this._visible) { this._visible = show; this.root.classList.toggle('on', show); }
    if (!show) return;
    const c = this.ctx, w = this.canvas.width, h = this.canvas.height;
    c.clearRect(0, 0, w, h);
    c.fillStyle = 'rgba(9,20,16,.42)'; c.fillRect(0, 0, w, h);
    c.strokeStyle = 'rgba(181,207,177,.18)'; c.lineWidth = 2; c.strokeRect(1, 1, w - 2, h - 2);
    const p = data.player, sx = w / 2, sy = h / 2, scale = (w * 0.44) / VIEW_RADIUS;
    const mark = (x, z, color, size = 4, alpha = 1) => {
      const d = worldToMap(x, z, p.x, p.z), dist = Math.hypot(d.x, d.y);
      if (dist > VIEW_RADIUS) return;
      c.globalAlpha = alpha * Math.max(0.22, 0.72 * (1 - dist / VIEW_RADIUS));
      c.fillStyle = color; c.beginPath(); c.arc(sx + d.x * scale, sy + d.y * scale, size, 0, Math.PI * 2); c.fill();
      c.globalAlpha = 1;
    };
    c.strokeStyle = 'rgba(222,245,206,.1)'; c.beginPath(); c.arc(sx, sy, VIEW_RADIUS * scale, 0, Math.PI * 2); c.stroke();
    mark(data.base.x, data.base.z, '#ffc978', 6);
    for (const b of data.shelters || []) mark(b.x, b.z, '#83b6c2', 4);
    for (const b of data.berries || []) if (!b.taken) mark(b.x, b.z, '#d98683', 3);
    if (data.companion && !data.companion.saved) mark(data.companion.x, data.companion.z, '#8fe8b0', 4);
    for (const f of data.foxes || []) if (f.alive) mark(f.x, f.z, '#ff6654', 4);
    c.save(); c.translate(sx, sy); c.rotate(worldYawToMapAngle(p.yaw)); c.fillStyle = '#fff5d0';
    c.beginPath(); c.moveTo(0, -9); c.lineTo(-5, 6); c.lineTo(0, 3); c.lineTo(5, 6); c.closePath(); c.fill(); c.restore();
  }
}

export { VIEW_RADIUS };
