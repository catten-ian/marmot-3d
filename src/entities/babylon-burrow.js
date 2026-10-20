/** babylon 洞穴占位实体（首跑只做位置标记）。 */
import { TransformNode, MeshBuilder, StandardMaterial, Color3 } from '@babylonjs/core';

export class BabylonBurrow {
  constructor(scene, opts = {}) {
    this.scene = scene;
    this.id = opts.id ?? 0;
    this.x = opts.x ?? 0;
    this.z = opts.z ?? 0;
    this.root = new TransformNode(`burrow_${this.id}`, scene);
    this.root.position.set(this.x, opts.y ?? 0, this.z);

    const mesh = MeshBuilder.CreateTorus(`burrow_${this.id}_rim`, {
      diameter: 1.2,
      thickness: 0.15,
      tessellation: 24,
    }, scene);
    mesh.position.y = 0.1;
    mesh.rotation.x = Math.PI / 2;
    const material = new StandardMaterial(`burrow_${this.id}_mat`, scene);
    material.diffuseColor = Color3.FromHexString('#4b3621');
    material.specularColor = Color3.Black();
    mesh.material = material;
    mesh.parent = this.root;
    this.mesh = mesh;
  }

  dispose() {
    this.root.dispose(false, true);
  }
}
