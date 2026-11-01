/**
 * One lazy full-screen scene pass. Source remains linear HDR; grading happens
 * before Three's existing ACES tone mapping and single sRGB output conversion.
 */
import { getSceneFilterPreset } from './scene-filter-settings.mjs';

const vertexShader = /* glsl */`
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;
const fragmentShader = /* glsl */`
  uniform sampler2D sceneColor;
  uniform float strength;
  uniform float saturation;
  uniform float contrast;
  uniform float brightness;
  uniform float shadowLift;
  uniform float highlightSoftness;
  uniform float filmic;
  uniform vec3 tint;
  varying vec2 vUv;
  void main() {
    vec4 source = texture2D(sceneColor, vUv);
    vec3 graded = source.rgb * brightness * tint;
    float luma = dot(graded, vec3(0.2126, 0.7152, 0.0722));
    graded = mix(vec3(luma), graded, saturation);
    // Lift shadows gently, compress only the hottest highlights, then apply a
    // restrained filmic shoulder. All operations stay in scene-linear space.
    float shadowMask = 1.0 - smoothstep(0.02, 0.34, luma);
    graded += vec3(shadowLift) * shadowMask;
    graded = max(vec3(0.0), (graded - vec3(0.18)) * contrast + vec3(0.18));
    float highlightMask = smoothstep(0.58, 1.0, luma);
    graded = mix(graded, graded / (vec3(1.0) + graded * highlightSoftness), highlightMask);
    graded = mix(graded, graded / (vec3(1.0) + graded * 0.16), filmic);
    gl_FragColor = vec4(mix(source.rgb, graded, strength), source.a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export class SceneFilterRenderer {
  constructor(renderer, settings, { onUnavailable = null, THREE } = {}) {
    this.renderer = renderer;
    this.THREE = THREE;
    this.settings = settings;
    this.onUnavailable = onUnavailable;
    this.target = null;
    this.scene = null;
    this.camera = null;
    this.material = null;
    this.geometry = null;
    this.stats = { passes: 0, bypasses: 0, createdTargets: 0, disposedTargets: 0, resizeCount: 0, failures: 0 };
    this._unsubscribe = settings.onChange(() => this.sync());
    this.sync();
  }

  sync() {
    if (!this.settings.active) this.disposeResources();
  }

  _createResources() {
    const THREE = this.THREE;
    if (this.target) return;
    if (this.renderer.capabilities?.isWebGL2 === false) throw new Error('scene filter requires WebGL2');
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    this.target = new THREE.WebGLRenderTarget(Math.max(1, size.x), Math.max(1, size.y), {
      type: THREE.HalfFloatType,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: true,
      stencilBuffer: false,
      samples: 0,
    });
    this.target.texture.name = 'SceneFilterLinearHDR';
    this.target.texture.colorSpace = THREE.LinearSRGBColorSpace;
    this.material = new THREE.ShaderMaterial({
      name: 'SceneFilterGradeThenOutput',
      uniforms: {
        sceneColor: { value: this.target.texture }, strength: { value: 0 },
        saturation: { value: 1 }, contrast: { value: 1 }, brightness: { value: 1 },
        shadowLift: { value: 0 }, highlightSoftness: { value: 0 }, filmic: { value: 0 },
        tint: { value: new THREE.Vector3(1, 1, 1) },
      },
      vertexShader, fragmentShader, depthTest: false, depthWrite: false, toneMapped: true,
    });
    this.geometry = new THREE.PlaneGeometry(2, 2);
    this.scene = new THREE.Scene();
    this.scene.add(new THREE.Mesh(this.geometry, this.material));
    this.camera = new THREE.Camera();
    this.stats.createdTargets++;
    this.resize();
  }

  resize() {
    const THREE = this.THREE;
    if (!this.target || !this.settings.active) return false;
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    const w = Math.max(1, size.x), h = Math.max(1, size.y);
    if (this.target.width === w && this.target.height === h) return false;
    this.target.setSize(w, h);
    this.stats.resizeCount++;
    return true;
  }

  _fail(error) {
    this.stats.failures++;
    this.disposeResources();
    try { this.onUnavailable?.(error); } catch (_) { /* fallback below is authoritative */ }
    this.settings.reset();
  }

  render(scene, camera) {
    if (!this.settings.active) {
      this.stats.bypasses++;
      this.renderer.render(scene, camera);
      return false;
    }
    const toneMapping = this.renderer.toneMapping;
    const THREE = this.THREE;
    const info = this.renderer.info;
    const autoReset = info?.autoReset;
    try {
      // Preserve the project's scene-level draw/triangle accounting, plus the
      // single fullscreen pass, instead of exposing only the fullscreen quad.
      if (info) { info.autoReset = false; info.reset(); }
      this._createResources();
      this.resize();
      const preset = getSceneFilterPreset(this.settings.snapshot().preset);
      const u = this.material.uniforms;
      u.strength.value = this.settings.snapshot().intensity / 100;
      u.saturation.value = preset.saturation;
      u.contrast.value = preset.contrast;
      u.brightness.value = preset.brightness;
      u.shadowLift.value = preset.shadowLift;
      u.highlightSoftness.value = preset.highlightSoftness;
      u.filmic.value = preset.filmic;
      u.tint.value.fromArray(preset.tint);

      this.renderer.setRenderTarget(this.target);
      // The offscreen texture must stay scene-linear. Only the screen pass
      // performs ACES + output sRGB, exactly once.
      this.renderer.toneMapping = THREE.NoToneMapping;
      this.renderer.render(scene, camera);
      this.renderer.setRenderTarget(null);
      this.renderer.toneMapping = toneMapping;
      this.renderer.render(this.scene, this.camera);
      this.stats.passes++;
      if (info) info.autoReset = autoReset;
      return true;
    } catch (error) {
      try { this.renderer.setRenderTarget(null); } catch (_) {}
      this.renderer.toneMapping = toneMapping;
      if (info) info.autoReset = autoReset;
      this._fail(error);
      // Immediate fail-soft frame, without changing user-facing settings code.
      this.renderer.render(scene, camera);
      return false;
    }
  }

  disposeResources() {
    this.target?.dispose();
    this.material?.dispose();
    this.geometry?.dispose();
    if (this.target) this.stats.disposedTargets++;
    this.target = null; this.material = null; this.geometry = null;
    this.scene = null; this.camera = null;
  }

  dispose() {
    this._unsubscribe?.();
    this.disposeResources();
  }

  debugState() {
    return {
      ...this.stats,
      allocated: !!this.target,
      targetSize: this.target ? [this.target.width, this.target.height] : null,
      settings: this.settings.snapshot(),
      active: this.settings.active,
    };
  }
}
