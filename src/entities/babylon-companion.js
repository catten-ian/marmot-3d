/** babylon 陪伴 NPC（占位）。 */
import { TransformNode, MeshBuilder, StandardMaterial, Color3 } from '@babylonjs/core';

export class BabylonCompanion {
  constructor(scene, opts = {}) {
    this.scene = scene;
    this.root = new TransformNode('companion', scene);
    this.root.position.set(opts.x ?? 2, opts.y ?? 0, opts.z ?? 2);
    this.x = this.root.position.x;
    this.z = this.root.position.z;

    const mesh = MeshBuilder.CreateSphere('companion_mesh', { diameter: 0.5 }, scene);
    const material = new StandardMaterial('companion_mat', scene);
    material.diffuseColor = Color3.FromHexString('#88ddff');
    material.specularColor = Color3.Black();
    mesh.material = material;
    mesh.parent = this.root;
    this.mesh = mesh;
  }

  dispose() {
    this.root.dispose(false, true);
  }
}
