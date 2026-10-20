/** babylon 藏狐实体。 */
import { TransformNode, MeshBuilder, StandardMaterial, Color3 } from '@babylonjs/core';

const FOX_COLORS = {
  normal: '#a04927',
  fast: '#d2a364',
  heavy: '#5e4a3a',
  boss: '#1f140e',
};

export class BabylonFox {
  /**
   * @param {Scene} scene babylon scene
   * @param {{type: 'normal'|'fast'|'heavy'|'boss', x: number, z: number, modelMesh?: Mesh}} opts
   */
  constructor(scene, opts = {}) {
    this.scene = scene;
    this.type = opts.type || 'normal';
    this.root = new TransformNode(`fox_${this.type}`, scene);
    this.root.position.set(opts.x ?? 0, opts.y ?? 0, opts.z ?? 0);
    this.state = 'roam';
    this.timer = 0;
    this.alive = true;

    // A preloaded Babylon mesh is preferred. The fallback keeps first boot visible
    // even when the GLB is unavailable or still loading.
    if (opts.modelMesh) {
      this.mesh = opts.modelMesh.clone(`fox_${this.type}_mesh`, this.root, true);
      if (!this.mesh) this.mesh = this._buildFallback();
    } else {
      this.mesh = this._buildFallback();
    }
    this.mesh.parent = this.root;
  }

  _buildFallback() {
    const mesh = MeshBuilder.CreateCylinder(`fox_${this.type}_fb`, {
      diameter: 0.4,
      height: 0.9,
      tessellation: 12,
    }, this.scene);
    const material = new StandardMaterial(`fox_${this.type}_fb_mat`, this.scene);
    material.diffuseColor = Color3.FromHexString(FOX_COLORS[this.type] || FOX_COLORS.normal);
    material.specularColor = Color3.Black();
    mesh.material = material;
    return mesh;
  }

  /** Minimal state-machine hook for the Babylon entity layer. */
  update(dt = 0) {
    if (!this.alive) return;
    this.timer += dt;
    if (this.timer < 2) return;
    this.timer = 0;
    this.state = this.state === 'roam' ? 'wind'
      : this.state === 'wind' ? 'dash'
        : this.state === 'dash' ? 'rest' : 'roam';
  }

  dispose() {
    if (this.mesh) this.mesh.dispose(false, true);
    this.root.dispose(false, true);
    this.alive = false;
  }
}
