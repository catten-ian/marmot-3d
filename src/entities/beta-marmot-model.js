import * as THREE from 'three';
import { normalizeModel } from '../models/loader.js';
import { MARMOT_CLIPS, marmotClipForState, animationTransition } from './marmot-rig.js';

/** One skeleton/mixer per instance, using only the upload's original clips. */
export class BetaMarmotModel {
  constructor(root, height) {
    const clips = root.userData.animations || [];
    if (!MARMOT_CLIPS.every((name) => clips.some((c) => c.name === name && c.duration > 0 && c.tracks.length))) {
      throw new Error('Uploaded marmot is missing Run/StandIdle/StandUp animation tracks');
    }
    this.root = root;
    this.mixer = new THREE.AnimationMixer(root);
    this.actions = new Map();
    for (const name of MARMOT_CLIPS) {
      const action = this.mixer.clipAction(clips.find((c) => c.name === name));
      action.setLoop(name === 'StandUp' ? THREE.LoopOnce : THREE.LoopRepeat, name === 'StandUp' ? 1 : Infinity);
      action.clampWhenFinished = name === 'StandUp';
      this.actions.set(name, action);
    }
    this.activeClip = null;
    this.speed = 0;
    this.state = 'idle';
    this.setClip('StandIdle', true);
    this.mixer.update(0);
    root.updateMatrixWorld(true);
    root.traverse((o) => {
      if (!o.isMesh) return;
      if (o.isSkinnedMesh) { o.computeBoundingBox(); o.frustumCulled = false; }
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        if (!m) continue;
        m.metalness = 0.08;
        m.roughness = Math.max(0.72, m.roughness || 0);
      }
    });
    const norm = normalizeModel(root, height);
    this.wrap = norm.wrap;
    this.scale = norm.appliedScale;
    this.box = new THREE.Box3();
    this.ground();
  }

  setClip(name, immediate = false) {
    const transition = animationTransition(this.activeClip, name, 0.16);
    if (!transition.changed) return;
    const previous = this.actions.get(this.activeClip);
    const next = this.actions.get(name);
    if (previous) previous.fadeOut(transition.fade);
    next.reset().setEffectiveTimeScale(1).setEffectiveWeight(1).play();
    if (!immediate) next.fadeIn(transition.fade);
    this.activeClip = name;
  }

  update(dt, state, speed) {
    this.state = state;
    this.speed = speed;
    this.setClip(marmotClipForState(state, speed));
    this.mixer.update(Math.max(0, dt));
    this.ground();
  }

  ground() {
    // The upload changes from upright to quadruped. Ground the deformed skin,
    // including blended poses, rather than the immutable bind-pose bounds.
    // Work in model space so terrain height/entity yaw never feed back here.
    const parent = this.wrap.parent;
    this.wrap.parent = null;
    this.wrap.updateMatrixWorld(true);
    this.root.traverse((o) => { if (o.isSkinnedMesh) o.skeleton.update(); });
    this.box.setFromObject(this.root, true);
    this.root.position.y -= this.box.min.y / this.scale;
    this.wrap.parent = parent;
    this.wrap.updateMatrixWorld(true);
  }

  dispose() {
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.root);
  }
}
