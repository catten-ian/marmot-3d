/**
 * 场景搭建：天空、地形、光照、雾。
 * 每关切换配色与日照强度，从清晨草原过渡到阴沉的最终关。
 */
import * as THREE from 'three';
import { FIELD_W, FIELD_H } from '../core/config.js';
import { terrainHeight } from '../core/utils.js';
import { getRenderProfile } from '../core/performance.js';

export class Sky {
  constructor(scene, renderer) {
    this.scene = scene;
    this.renderer = renderer;

    // 半球光模拟天空漫射
    this.hemi = new THREE.HemisphereLight(0xbdd6ea, 0x6a7a4e, 0.62);
    scene.add(this.hemi);

    this.ambient = new THREE.AmbientLight(0xffffff, 0.25);
    scene.add(this.ambient);

    // 主平行光投射阴影，跟随玩家以保证阴影分辨率
    this.sun = new THREE.DirectionalLight(0xfff3d4, 2.5);
    const renderProfile = getRenderProfile();
    this.sun.castShadow = renderProfile.shadows;
    this.sun.shadow.mapSize.set(renderProfile.shadowMapSize, renderProfile.shadowMapSize);
    const cam = this.sun.shadow.camera;
    cam.near = 0.5;
    cam.far = 90;
    cam.left = -26; cam.right = 26; cam.top = 26; cam.bottom = -26;
    this.sun.shadow.bias = -0.0012;
    this.sun.shadow.normalBias = 0.03;
    scene.add(this.sun);
    scene.add(this.sun.target);

    // 进洞暗化：记录地表基准光强，setUnderground(k) 按 k∈[0,1] 压暗。
    this._baseHemi = this.hemi.intensity;
    this._baseAmbient = this.ambient.intensity;
    this._baseSun = this.sun.intensity;
    this._underground = 0;

    this._buildDome();
    this._buildTerrain();

    // 雾的 far 要小于地形边缘半径（215），让边缘完全隐入雾中；
    // near 保持在 70 以保证场内视野清晰。
    // 雾的 far 要大于最远的可见物体（远山椭圆环 ~330m），
    // 让边缘完全隐入雾中；near 保持在 70 以保证场内视野清晰。
    scene.fog = new THREE.Fog(0x93a4a8, 70, 420);
  }

  /** Verdant Trail 的阴天森林光照：保留柔和方向性，避免 PBR 植被死黑或塑料高光。 */
  setVerdantMood() {
    this.hemi.color.set(0xb8cfe0);
    this.hemi.groundColor.set(0x42513a);
    this.hemi.intensity = 0.82;
    this.ambient.color.set(0xdce8e4);
    this.ambient.intensity = 0.42;
    this.sun.color.set(0xd8e4dc);
    this.sun.intensity = 1.65;
    this.sun.position.set(-34, 52, 22);
    this.sun.target.position.set(0, 0, 0);
    this.scene.fog = new THREE.Fog(0x82969a, 42, 175);
    if (this.dome?.material?.uniforms) {
      this.dome.material.uniforms.topColor.value.set('#718a9c');
      this.dome.material.uniforms.bottomColor.value.set('#b9c8c8');
      this.dome.material.uniforms.hazeColor.value.set('#82969a');
      this.dome.material.uniforms.glowColor.value.set('#d9e4df');
      this.dome.material.uniforms.cloudiness.value = 0.62;
    }
  }

  /** 按渲染器后端选择天穹实现：
   *  - 经典 WebGLRenderer：原有 GLSL ShaderMaterial 穹顶（stable 逐字保留）。
   *  - WebGPURenderer（webgpu / webgl2-fallback）：NodeBuilder 无法转换旧式
   *    ShaderMaterial（会告警 "Material ShaderMaterial is not compatible" 并渲染成
   *    空白），改用后端无关的烘焙等距柱状天空贴图 + MeshBasicMaterial。
   * 两者暴露一致的 material.uniforms 适配接口，setVerdantMood/applyLevel 无需分叉。 */
  _buildDome() {
    this._skyPalette = {
      top: '#8fa8c4', bottom: '#c9d8dd', haze: '#93a4a8',
      glow: '#fff3d4', cloudiness: 0.42,
    };
    this.sunDir = new THREE.Vector3(26, 44, 20).normalize();
    this.domeTime = { value: 0 };
    if (this.renderer && this.renderer.isWebGPURenderer === true) {
      this._buildDomeBaked();
    } else {
      this._buildDomeGL();
    }
  }

  /** 经典 GLSL 天穹（仅经典 WebGLRenderer；stable 路径逐字保留）。 */
  _buildDomeGL() {
    const geo = new THREE.SphereGeometry(900, 40, 24);
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        topColor: { value: new THREE.Color(this._skyPalette.top) },
        bottomColor: { value: new THREE.Color(this._skyPalette.bottom) },
        // 地平线以下的球面渐变到雾色，与远处地形无缝衔接
        hazeColor: { value: new THREE.Color(this._skyPalette.haze) },
        glowColor: { value: new THREE.Color(this._skyPalette.glow) },
        sunDir: { value: this.sunDir },
        uTime: this.domeTime,
        offset: { value: 60 },
        exponent: { value: 0.85 },
        // 云量：0.42 左右的覆盖率最像草原多云天；阴天关由天空色自然压暗
        cloudiness: { value: this._skyPalette.cloudiness },
      },
      vertexShader: /* glsl */ `
        varying vec3 vWorldPosition;
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorldPosition = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 topColor;
        uniform vec3 bottomColor;
        uniform vec3 hazeColor;
        uniform vec3 glowColor;
        uniform vec3 sunDir;
        uniform float uTime;
        uniform float offset;
        uniform float exponent;
        uniform float cloudiness;
        varying vec3 vWorldPosition;

        float hash2(vec2 p) {
          return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
        }
        float vnoise(vec2 p) {
          vec2 i = floor(p), f = fract(p);
          vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(mix(hash2(i), hash2(i + vec2(1.0, 0.0)), u.x),
                     mix(hash2(i + vec2(0.0, 1.0)), hash2(i + vec2(1.0, 1.0)), u.x), u.y);
        }
        float fbm2(vec2 p) {
          float v = 0.0, a = 0.5;
          for (int i = 0; i < 4; i++) { v += a * vnoise(p); p *= 2.03; a *= 0.5; }
          return v;
        }

        void main() {
          vec3 n = normalize(vWorldPosition);
          float h = normalize(vWorldPosition + vec3(0.0, offset, 0.0)).y;
          float t = pow(max(h, 0.0), exponent);
          vec3 sky = mix(bottomColor, topColor, t);
          // 地平线以下（含接缝处）平滑过渡到雾色，消除色带
          float below = smoothstep(0.06, -0.02, n.y);
          vec3 col = mix(sky, hazeColor, below);

          // —— 云：只在地平线以上。用 n.xz/n.y 做天球平面投影，
          // 越靠近地平线坐标越大，云被透视自然压扁成一条条，符合真实观感。
          float above = smoothstep(0.0, 0.14, n.y);
          if (above > 0.001) {
            vec2 cuv = n.xz / max(n.y, 0.06) * 0.55 + vec2(uTime * 0.006, uTime * 0.0025);
            float c = fbm2(cuv * 1.4);
            // 双频：大块云团 + 细碎云絮
            float c2 = fbm2(cuv * 4.1 + 7.3);
            float cloud = smoothstep(1.0 - cloudiness, 1.0 - cloudiness + 0.28, c * 0.78 + c2 * 0.22);
            cloud *= above;
            // 高处云更亮（受光强），低处云染地平线色
            vec3 cloudCol = mix(topColor, vec3(1.06), 0.55);
            cloudCol = mix(cloudCol, glowColor, pow(max(dot(n, sunDir), 0.0), 6.0) * 0.35);
            col = mix(col, cloudCol, cloud * 0.85);
          }

          // —— 太阳辉光：方向与主平行光一致 ——
          float s = max(dot(n, sunDir), 0.0);
          float glow = pow(s, 220.0) * 0.55 + pow(s, 10.0) * 0.10;
          col += glowColor * glow * (1.0 - below);

          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
    this.dome = new THREE.Mesh(geo, mat);
    this.dome.frustumCulled = false;
    this.scene.add(this.dome);
  }

  /**
   * 后端无关天穹（WebGPURenderer：webgpu / webgl2-fallback）。
   * NodeBuilder 不支持旧式 ShaderMaterial，这里把与 GLSL 版等价的
   * 「天顶→地平线渐变 + 地平线雾过渡 + fbm 云带 + 太阳辉光」逐像素烘焙到
   * 等距柱状（equirectangular）canvas，再用 MeshBasicMaterial 贴到 BackSide 球。
   * 两类渲染器都能正常显示；烘焙为静态云（无时间漂移），换关/变天只重烘一次。
   * 暴露与 GLSL 版一致的 material.uniforms 适配接口（topColor/bottomColor/
   * hazeColor/glowColor 用 .set()，cloudiness 赋 .value），调用点无需分叉。
   */
  _buildDomeBaked() {
    this._skyW = 1024; this._skyH = 512;
    this._skyCanvas = document.createElement('canvas');
    this._skyCanvas.width = this._skyW; this._skyCanvas.height = this._skyH;
    this._skyCtx = this._skyCanvas.getContext('2d');
    this._skyImg = this._skyCtx.createImageData(this._skyW, this._skyH);
    this._bakeSkyCanvas();
    const tex = new THREE.CanvasTexture(this._skyCanvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = THREE.RepeatWrapping;
    this._skyTexture = tex;

    const geo = new THREE.SphereGeometry(900, 48, 24);
    const mat = new THREE.MeshBasicMaterial({
      map: tex, side: THREE.BackSide, depthWrite: false, fog: false,
      // 原 GLSL ShaderMaterial 未走 tonemapping/颜色管线；这里同样跳过 ACES，
      // 让烘焙的 sRGB 天色直出，两后端观感与经典版最接近。
      toneMapped: false,
    });
    this.dome = new THREE.Mesh(geo, mat);
    this.dome.frustumCulled = false;

    // uniforms 适配：set() 合入调色板并合并重烘（同一帧内多次 set 只烘一次）。
    const colorUniform = (key) => ({
      value: { set: (hex) => { this._skyPalette[key] = hex; this._queueSkyRebake(); } },
    });
    const sky = this;
    mat.uniforms = {
      topColor: colorUniform('top'),
      bottomColor: colorUniform('bottom'),
      hazeColor: colorUniform('haze'),
      glowColor: colorUniform('glow'),
      sunDir: { value: this.sunDir },
      uTime: this.domeTime,
      cloudiness: {
        set value(v) { sky._skyPalette.cloudiness = v; sky._queueSkyRebake(); },
        get value() { return sky._skyPalette.cloudiness; },
      },
    };
    this.scene.add(this.dome);
  }

  _queueSkyRebake() {
    if (this._skyRebakeQueued || !this._skyImg) return;
    this._skyRebakeQueued = true;
    const run = () => { this._skyRebakeQueued = false; if (!this._skyImg) return; this._bakeSkyCanvas(); if (this._skyTexture) this._skyTexture.needsUpdate = true; };
    if (typeof queueMicrotask === 'function') queueMicrotask(run); else setTimeout(run, 0);
  }

  /** #rrgggb → sRGB 字节三元组（天色直接在 sRGB 空间烘焙，贴近原 shader 直出）。 */
  static _hexRGB(hex) {
    const n = parseInt(String(hex).replace('#', ''), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  _bakeSkyCanvas() {
    const W = this._skyW, H = this._skyH, data = this._skyImg.data;
    const P = this._skyPalette;
    const top = Sky._hexRGB(P.top), bottom = Sky._hexRGB(P.bottom);
    const haze = Sky._hexRGB(P.haze), glow = Sky._hexRGB(P.glow);
    const sd = this.sunDir; const sx = sd.x, sy = sd.y, sz = sd.z;
    const offset = 60, exponent = 0.85, cloudiness = P.cloudiness;
    const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
    const mix = (a, b, t) => a + (b - a) * t;
    const smooth = (e0, e1, x) => { const t = clamp01((x - e0) / (e1 - e0)); return t * t * (3 - 2 * t); };
    const hash = (x, y) => { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); };
    const vnoise = (x, y) => {
      const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
      const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
      const a = hash(ix, iy), b = hash(ix + 1, iy), c = hash(ix, iy + 1), d = hash(ix + 1, iy + 1);
      return mix(mix(a, b, ux), mix(c, d, ux), uy);
    };
    const fbm = (x, y) => { let v = 0, a = 0.5; for (let i = 0; i < 4; i++) { v += a * vnoise(x, y); x *= 2.03; y *= 2.03; a *= 0.5; } return v; };
    let p = 0;
    for (let y = 0; y < H; y++) {
      // 对齐 SphereGeometry：v=1 在天顶；theta 从天顶 0 到天底 π。
      const theta = (y / H) * Math.PI;
      const ny = Math.cos(theta), st = Math.sin(theta);
      for (let x = 0; x < W; x++) {
        const phi = (x / W) * Math.PI * 2;
        const nx = -Math.cos(phi) * st, nz = Math.sin(phi) * st;

        const upLen = Math.hypot(nx, ny + offset, nz) || 1;
        const h = Math.max((ny + offset) / upLen, 0);
        const t = Math.pow(h, exponent);
        let r = mix(bottom[0], top[0], t), g = mix(bottom[1], top[1], t), b = mix(bottom[2], top[2], t);

        const below = smooth(0.06, -0.02, ny);
        r = mix(r, haze[0], below); g = mix(g, haze[1], below); b = mix(b, haze[2], below);

        const above = smooth(0.0, 0.14, ny);
        if (above > 0.001) {
          const invY = 1 / Math.max(ny, 0.06);
          const cu = (nx * invY) * 0.55, cv = (nz * invY) * 0.55; // uTime=0 静态云
          const cc = fbm(cu * 1.4, cv * 1.4);
          const cc2 = fbm(cu * 4.1 + 7.3, cv * 4.1 + 7.3);
          const cloud = smooth(1 - cloudiness, 1 - cloudiness + 0.28, cc * 0.78 + cc2 * 0.22) * above;
          let cr = mix(top[0], 270, 0.55), cg = mix(top[1], 270, 0.55), cb = mix(top[2], 270, 0.55);
          const dotn = Math.max(nx * sx + ny * sy + nz * sz, 0);
          const gw = Math.pow(dotn, 6) * 0.35;
          cr = mix(cr, glow[0], gw); cg = mix(cg, glow[1], gw); cb = mix(cb, glow[2], gw);
          const k = cloud * 0.85;
          r = mix(r, cr, k); g = mix(g, cg, k); b = mix(b, cb, k);
        }

        const sdot = Math.max(nx * sx + ny * sy + nz * sz, 0);
        const glowAmt = (Math.pow(sdot, 220) * 0.55 + Math.pow(sdot, 10) * 0.10) * (1 - below);
        r += glow[0] * glowAmt; g += glow[1] * glowAmt; b += glow[2] * glowAmt;

        data[p++] = r < 0 ? 0 : r > 255 ? 255 : r;
        data[p++] = g < 0 ? 0 : g > 255 ? 255 : g;
        data[p++] = b < 0 ? 0 : b > 255 ? 255 : b;
        data[p++] = 255;
      }
    }
    this._skyCtx.putImageData(this._skyImg, 0, 0);
  }

  /** 地形网格：顶点位移采样高度场，逐顶点色做草地斑驳 */
  _buildTerrain() {
    // 地形比竞技场大得多，越靠边缘越向下倾斜并变暗，
    // 这样边界不会以"直��� + 天空色"的方形硬边暴露在玩家视野里。
    // 地形尺寸要足够大，让边缘完全没入雾中（雾 far = 420）。
// 若边缘落在可见距离内，天空与地形交界的"地平线缝"会显示为一条亮线。
const segX = 200, segZ = 170;
    const sizeX = FIELD_W + 300, sizeZ = FIELD_H + 300;
    const geo = new THREE.PlaneGeometry(sizeX, sizeZ, segX, segZ);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const cA = new THREE.Color('#93a978');
    const cB = new THREE.Color('#718f65');
    const cEdge = new THREE.Color('#5c7350');
    const tmp = new THREE.Color();

    const hw = FIELD_W / 2, hh = FIELD_H / 2;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      let y = terrainHeight(x, z);

      // 超出竞技场后不再下沉：地形平缓延伸到雾里，
      // 由雾而不是几何落差来隐藏边界，避免地平线出现接缝。
      pos.setY(i, y);

      const h = y;
      // 用地形高度本身 + 无规则相位的噪声做斑驳。
      // 注意：不要用 sin(x)*cos(z) 这类规则函数，它会形成连续的
      // 明暗条带，在贴地视角下看起来就是一条横贯视野的亮线。
      const n1 = Math.sin(x * 0.13 + z * 0.07) * Math.sin(z * 0.11 - x * 0.05);
      const t = THREE.MathUtils.clamp(0.5 + h * 0.13 + n1 * 0.07, 0, 1);
      tmp.copy(cA).lerp(cB, t);
      // 竞技场之外的远景压暗，配合雾营造纵深
      const out = Math.max(0, Math.abs(x) - hw, Math.abs(z) - hh);
      const edgeK = Math.min(1, Math.max(0, (out - 10) / 55));
      if (edgeK > 0) tmp.lerp(cEdge, edgeK * 0.7);
      colors[i * 3] = tmp.r; colors[i * 3 + 1] = tmp.g; colors[i * 3 + 2] = tmp.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();

    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.96,
      metalness: 0,
    });
    this.terrain = new THREE.Mesh(geo, mat);
    this.terrain.receiveShadow = true;
    this.scene.add(this.terrain);

    // 竞技场外的远山剪影，给开阔感
    this._buildHills();
  }

  /** 远山环：低多边形山脊，纯装饰不参与碰撞。
   *  关键是山脚必须埋在地形边缘之下、山脊必须高过地平线，
   *  否则会出现"地形边缘露出一条细脊"的接缝。 */
  _buildHills() {
    const group = new THREE.Group();
    const rand = (i) => {
      const s = Math.sin(i * 12.9898) * 43758.5453;
      return Math.abs(s - Math.floor(s));
    };
    for (let i = 0; i < 44; i++) {
      const a = (i / 44) * Math.PI * 2;
      // 层次（从近到远）：
      //   地形边缘 X±215/Z±189 → 摄影测量远景 X±246/Z±218 →
      //   程序化远山 X±330/Z±292 → 雾（far = 420）
      // 远山必须落在远景**之后**，否则会把真实草甸挡得看不见；
      // 又不能太远，否则会被雾吞成一片纯色。
      const h = 52 + rand(i + 99) * 60;
      const w = 80 + rand(i + 7) * 110;
      const geo = new THREE.ConeGeometry(w, h, 5, 1);
      // 远山**必须吃雾**：不吃雾时它是完全不透明的实色块，会把放在
      // 更近处的摄影测量远景挡得看不见；吃雾后越远越淡，
      // 层次变成"真实草甸 → 淡远山"，才像开阔草原。
      const mat = new THREE.MeshBasicMaterial({ color: 0x6d7f74, fog: true });
      const m = new THREE.Mesh(geo, mat);
      // 山脚埋入地面，山脊远高于视平线。
      // 用椭圆环（与摄影测量远景同一个 rx/rz 比例 246:218），
      // 否则在 Z 方向远山会跑到摄影远景**内侧**，把真实草甸遮掉。
      const ERX = 330, ERZ = 292;
      m.position.set(Math.cos(a) * ERX * (0.9 + rand(i) * 0.2),
        h / 2 - 12,
        Math.sin(a) * ERZ * (0.9 + rand(i) * 0.2));
      m.rotation.y = rand(i + 3) * Math.PI;
      m.scale.y = 0.8 + rand(i + 5) * 0.5;
      group.add(m);
    }
    this.hills = group;
    this.scene.add(group);
  }

  /** 应用关卡配色 */
  applyLevel(cfg) {
    this.dome.material.uniforms.topColor.value.set(cfg.sky[0]);
    this.dome.material.uniforms.bottomColor.value.set(cfg.sky[1]);
    // 地平线以下的雾色必须与场景雾一致，否则接缝处会出现色带
    this.dome.material.uniforms.hazeColor.value.set(cfg.fog);
    this.hemi.color.set(cfg.sky[1]);
    this.sun.color.set(cfg.sun);
    this.sun.intensity = cfg.sunIntensity;
    this.ambient.intensity = cfg.ambient;
    this.scene.fog.color.set(cfg.fog);
    // 太阳辉光跟随关卡日照色：阴天关（如第 8 关冷光）不会出现暖阳违和感
    this.dome.material.uniforms.glowColor.value.set(cfg.sun);

    const cA = new THREE.Color(cfg.grass[0]);
    const cB = new THREE.Color(cfg.grass[1]);
    const cEdge = new THREE.Color(cfg.fog).multiplyScalar(0.72);
    const pos = this.terrain.geometry.attributes.position;
    const colors = this.terrain.geometry.attributes.color;
    const tmp = new THREE.Color();
    const hw = FIELD_W / 2, hh = FIELD_H / 2;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i), h = pos.getY(i);
      const n1 = Math.sin(x * 0.13 + z * 0.07) * Math.sin(z * 0.11 - x * 0.05);
      const t = THREE.MathUtils.clamp(0.5 + h * 0.13 + n1 * 0.07, 0, 1);
      tmp.copy(cA).lerp(cB, t);
      const out = Math.max(0, Math.abs(x) - hw, Math.abs(z) - hh);
      const edgeK = Math.min(1, Math.max(0, (out - 10) / 55));
      if (edgeK > 0) tmp.lerp(cEdge, edgeK * 0.7);
      colors.setXYZ(i, tmp.r, tmp.g, tmp.b);
    }
    colors.needsUpdate = true;
    this.hills.children.forEach((m) => m.material.color.set(cfg.fog).multiplyScalar(1.12));
    // 关卡基准光强随关卡变化，刷关卡时重置并重新应用进洞压暗。
    this._baseHemi = this.hemi.intensity;
    this._baseAmbient = this.ambient.intensity;
    this._baseSun = this.sun.intensity;
    this._applyUnderground();
  }

  /** k=0 地表 / k=1 洞内：压暗半球光与平行光，洞内只留 burrow 自带暖光。 */
  setUnderground(k) {
    this._underground = THREE.MathUtils.clamp(k, 0, 1);
    this._applyUnderground();
  }
  _applyUnderground() {
    const k = this._underground;
    this.hemi.intensity = this._baseHemi * (1 - 0.88 * k);
    this.ambient.intensity = this._baseAmbient * (1 - 0.9 * k);
    this.sun.intensity = this._baseSun * (1 - 0.96 * k);
  }

  /** 阴影相机跟随玩家，保证近处阴影清晰；天穹云随时间漂移 */
  update(playerPos, dt = 0) {
    this.sun.position.set(playerPos.x + 26, 44, playerPos.z + 20);
    this.sun.target.position.set(playerPos.x, 0, playerPos.z);
    this.sun.target.updateMatrixWorld();
    this.dome.position.set(playerPos.x, 0, playerPos.z);
    if (dt > 0) this.domeTime.value += dt;
  }
}