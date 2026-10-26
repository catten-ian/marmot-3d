/**
 * 场景搭建：天空、地形、光照、雾。
 * 每关切换配色与日照强度，从清晨草原过渡到阴沉的最终关。
 */
import * as THREE from 'three';
import { FIELD_W, FIELD_H } from '../core/config.js';
import { terrainHeight, fbm } from '../core/utils.js';
import { getRenderProfile } from '../core/performance.js';
import { IS_BETA } from '../core/version.js';

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
    this.skyTextureStatus = { state: IS_BETA ? 'loading' : 'disabled' };
    if (IS_BETA) this._loadCitrusSky();

    // 雾的 far 要小于地形边缘半径（215），让边缘完全隐入雾中；
    // near 保持在 70 以保证场内视野清晰。
    // 雾的 far 要大于最远的可见物体（远山椭圆环 ~330m），
    // 让边缘完全隐入雾中；near 保持在 70 以保证场内视野清晰。
    scene.fog = new THREE.Fog(0x93a4a8, IS_BETA ? 60 : 70, 420);
  }

  /** Beta-only citrus panorama; procedural dome remains a fail-soft loading/error fallback. */
  _loadCitrusSky() {
    const url = 'assets/sky/citrus_orchard_road_puresky_1k.jpg';
    this.skyTextureStatus = { state: 'loading', url };
    new THREE.TextureLoader().load(url, (texture) => {
      texture.mapping = THREE.EquirectangularReflectionMapping;
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.minFilter = THREE.LinearFilter;
      texture.magFilter = THREE.LinearFilter;
      texture.generateMipmaps = false;
      // Preserve source panorama orientation (2:1, no flip/crop); this is background only,
      // so existing level fog, hemisphere light, sun and WebGL2/WebGPU profiles stay authoritative.
      this.scene.backgroundRotation.set(0, 0, 0);
      this.scene.backgroundIntensity = 1;
      this.scene.background = texture;
      this.dome.visible = false;
      this.skyTexture = texture;
      this.skyTextureStatus = { state: 'loaded', url, mapping: texture.mapping, colorSpace: texture.colorSpace };
    }, undefined, () => {
      this.scene.background = null;
      this.dome.visible = true;
      this.skyTextureStatus = { state: 'fallback', url, reason: 'texture-load-failed' };
    });
  }

  /** 应用静态/自适应渲染预算，尺寸变化时重建阴影贴图。 */
  applyRenderProfile(profile) {
    const shadow = this.sun.shadow;
    const size = Math.max(1, Math.floor(profile.shadowMapSize || shadow.mapSize.x));
    const sizeChanged = shadow.mapSize.x !== size || shadow.mapSize.y !== size;
    const shadowModeChanged = this.sun.castShadow !== !!profile.shadows;
    if (sizeChanged || shadowModeChanged) {
      shadow.map?.dispose?.();
      shadow.map = null;
      shadow.mapPass?.dispose?.();
      shadow.mapPass = null;
    }
    this.sun.castShadow = !!profile.shadows;
    if (sizeChanged) shadow.mapSize.set(size, size);
    if (sizeChanged || shadowModeChanged) shadow.needsUpdate = true;
  }

  /** 渐变天穹：半透明大球，从天顶色渐变到地平线色。
   *  半径必须大于地形边缘半径（FIELD_W/2+150 = 215），
   *  否则地面与天球之间会露出缝隙，在地平线处显示为一条亮带。
   *  同时把球心跟随玩家，保证玩家永远看不到天球边缘。
   *
   *  云与太阳辉光：程序化 fbm 云沿海平线透视压扁、随时间漂移；
   *  太阳方向与主平行光一致（sun.position - player = (26,44,20) 归一化），
   *  辉光颜色随关卡日照色变化，阴天关不会出现暖阳违和感。 */
  _buildDome() {
    const geo = new THREE.SphereGeometry(900, 40, 24);
    this.domeTime = { value: 0 };
    this.sunDir = new THREE.Vector3(26, 44, 20).normalize();
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        topColor: { value: new THREE.Color('#8fa8c4') },
        bottomColor: { value: new THREE.Color('#c9d8dd') },
        // 地平线以下的球面渐变到雾色，与远处地形无缝衔接
        hazeColor: { value: new THREE.Color('#93a4a8') },
        glowColor: { value: new THREE.Color('#fff3d4') },
        sunDir: { value: this.sunDir },
        uTime: this.domeTime,
        offset: { value: 60 },
        exponent: { value: 0.85 },
        // 云量：0.42 左右的覆盖率最像草原多云天；阴天关由天空色自然压暗
        cloudiness: { value: 0.42 },
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
      const patch = IS_BETA ? fbm(x * 0.038, z * 0.038, 3) : 0;
      const detailPatch = IS_BETA ? fbm(x * 0.15, z * 0.15, 2) : 0;
      const t = THREE.MathUtils.clamp(0.5 + h * 0.13 + n1 * 0.07 + patch * 0.15, 0, 1);
      tmp.copy(cA).lerp(cB, t);
      if (IS_BETA) tmp.multiplyScalar(0.88 + patch * 0.12 + detailPatch * 0.035);
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
      roughness: IS_BETA ? 0.98 : 0.96,
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
    if (!IS_BETA) { this._buildLegacyHills(); return; }
    // Beta uses layered continuous ridges for a softer horizon, without changing stable/dev.
    const group = new THREE.Group();
    const layers = [
      { rx: 250, rz: 224, count: 56, height: 34, color: 0x586a60 },
      { rx: 282, rz: 252, count: 64, height: 48, color: 0x718075 },
      { rx: 315, rz: 282, count: 72, height: 66, color: 0x8a9186 },
    ];
    const ridgeRand = (i, seed) => { const v = Math.sin(i * 12.9898 + seed * 78.233) * 43758.5453; return v - Math.floor(v); };
    for (let li = 0; li < layers.length; li++) {
      const layer = layers[li], positions = [], indices = [];
      for (let i = 0; i <= layer.count; i++) {
        const a = (i / layer.count) * Math.PI * 2;
        const wobble = 0.92 + ridgeRand(i, layer.count) * 0.16;
        const rx = layer.rx * wobble, rz = layer.rz * wobble;
        const wave = Math.sin(a * 5.0 + li * 1.7) * 0.23 + Math.sin(a * 11.0 - li * 0.8) * 0.11 + Math.sin(a * 19.0 + 2.3) * 0.035;
        const h = layer.height * (0.78 + wave);
        positions.push(Math.cos(a) * rx, -16, Math.sin(a) * rz);
        positions.push(Math.cos(a) * rx, h - 16, Math.sin(a) * rz);
      }
      for (let i = 0; i < layer.count; i++) {
        const j = i * 2, n = (i + 1) * 2;
        indices.push(j, n, j + 1, n, n + 1, j + 1);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geo.setIndex(indices); geo.computeVertexNormals();
      const mat = new THREE.MeshBasicMaterial({ color: layer.color, fog: true, side: THREE.DoubleSide });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.name = `beta-ridge-layer-${li}`;
      group.add(mesh);
    }
    this.hills = group;
    this.scene.add(group);
  }

  _buildLegacyHills() {
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
    // 太阳辉光跟随关卡日照色：阴天关（如后期冷光关）不会出现暖阳违和感
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
      const patch = IS_BETA ? fbm(x * 0.038, z * 0.038, 3) : 0;
      const detailPatch = IS_BETA ? fbm(x * 0.15, z * 0.15, 2) : 0;
      const t = THREE.MathUtils.clamp(0.5 + h * 0.13 + n1 * 0.07 + patch * 0.15, 0, 1);
      tmp.copy(cA).lerp(cB, t);
      if (IS_BETA) tmp.multiplyScalar(0.88 + patch * 0.12 + detailPatch * 0.035);
      const out = Math.max(0, Math.abs(x) - hw, Math.abs(z) - hh);
      const edgeK = Math.min(1, Math.max(0, (out - 10) / 55));
      if (edgeK > 0) tmp.lerp(cEdge, edgeK * 0.7);
      colors.setXYZ(i, tmp.r, tmp.g, tmp.b);
    }
    colors.needsUpdate = true;
    if (IS_BETA) {
      const ridgePalette = [0x586a60, 0x718075, 0x8a9186].map((hex) => new THREE.Color(hex));
      const haze = new THREE.Color(cfg.fog);
      this.hills.children.forEach((m, i) => m.material.color.copy(ridgePalette[i]).lerp(haze, 0.32));
    } else {
      this.hills.children.forEach((m) => m.material.color.set(cfg.fog).multiplyScalar(1.12));
    }
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