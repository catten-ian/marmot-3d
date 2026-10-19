/** Babylon.js rendering host with a small Three-compatible surface for legacy systems. */
import { Engine, Scene, ArcRotateCamera, HemisphericLight, DirectionalLight, Vector3, Color4, MeshBuilder, StandardMaterial, Color3 } from '@babylonjs/core';
import '@babylonjs/loaders';

export class BabylonRenderer {
  constructor(canvas, options = {}) {
    this.canvas = canvas;
    this.engine = new Engine(canvas, options.antialias ?? true, { preserveDrawingBuffer: false, stencil: false }, true);
    this.info = { render: { triangles: 0, calls: 0 }, memory: { geometries: 0, textures: 0 } };
    this.shadowMap = { enabled: false };
    this.domElement = canvas;
    this.autoClear = true;
    this.backend = { isWebGPUBackend: false, name: 'babylon-webgl2' };
  }
  setPixelRatio(value) { this.engine.setHardwareScalingLevel(1 / Math.max(0.5, value || 1)); }
  setSize(width, height) { this.engine.resize(); this.width = width; this.height = height; }
  render(_legacyScene, _legacyCamera) {
    if (this.scene) this.scene.render();
    const meshes = this.scene?.getActiveMeshes?.().data || [];
    this.info.render.calls = meshes.length;
    this.info.render.triangles = meshes.reduce((n, m) => n + (m.getTotalVertices?.() || 0) / 3, 0) | 0;
  }
  clearDepth() {}
  setAnimationLoop(fn) { this.engine.runRenderLoop(() => fn(performance.now())); }
  dispose() { this.engine.dispose(); }
}

export function createBabylonScene(renderer, { width = 130, depth = 100 } = {}) {
  const scene = new Scene(renderer.engine);
  scene.clearColor = new Color4(0.56, 0.66, 0.72, 1);
  const camera = new ArcRotateCamera('camera', -Math.PI / 2, 1.18, 42, new Vector3(0, 0, 0), scene);
  camera.minZ = 0.05; camera.maxZ = 1600;
  camera.attachControl(renderer.canvas, false);
  const hemi = new HemisphericLight('hemi', new Vector3(0, 1, 0), scene);
  hemi.intensity = 0.8;
  const sun = new DirectionalLight('sun', new Vector3(-0.4, -1, -0.3), scene);
  sun.position = new Vector3(25, 45, 20); sun.intensity = 1.8;
  const ground = MeshBuilder.CreateGround('babylon-ground', { width, height: depth, subdivisions: 2 }, scene);
  const mat = new StandardMaterial('ground-material', scene);
  mat.diffuseColor = new Color3(0.28, 0.42, 0.24); mat.specularColor = new Color3(0, 0, 0);
  ground.material = mat; ground.receiveShadows = true;
  renderer.scene = scene; renderer.camera = camera; renderer.ground = ground;
  return { scene, camera, hemi, sun, ground };
}

export function createRenderer(canvas, options = {}) {
  const renderer = new BabylonRenderer(canvas, options);
  const world = createBabylonScene(renderer, options);
  return { renderer, ...world, status: { backend: 'babylon-webgl2', gpuAvailable: false, gpuReason: 'Babylon Engine WebGL2 host', degraded: false, supportsSplat: false } };
}
