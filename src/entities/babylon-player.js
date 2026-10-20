/** 玩家在 babylon 路径下的脚手架（第一人称视角）。 */
import { TransformNode, Vector3, UniversalCamera } from '@babylonjs/core';

export class BabylonPlayer {
  /**
   * @param {Scene} scene babylon scene
   * @param {{camera, heroY, height}} cfg
   */
  constructor(scene, cfg = {}) {
    this.scene = scene;
    this.camera = cfg.camera;
    this.heroY = cfg.heroY ?? 0.46;
    this.height = cfg.height ?? 1.7;
    this.root = new TransformNode('player', scene);
    if (this.camera) {
      this.camera.parent = this.root;
      this.isUniversalCamera = this.camera instanceof UniversalCamera;
    }
    this._spawn(cfg.x ?? 0, cfg.z ?? 0);
  }

  _spawn(x, z) {
    this.root.position.set(x, this.heroY, z);
    if (!this.camera) return;
    // The camera is parented to the player root, so its local position is the eye offset.
    this.camera.position.copyFrom(new Vector3(0, this.height * 0.55, 0));
  }
}
