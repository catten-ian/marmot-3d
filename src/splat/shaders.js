/**
 * splat 贴图版 —— GLSL ES 1.00（WebGL1/X5 可跑：不用 GLSL3、derivatives、整数贴图）。
 *
 * 通道约定：uSplat = R 草 / G 沙 / B 雪 / A 岩，每通道 0-255 权重。
 * uSplat 采样 vUv（权重图覆盖全场，不重复；重复会让 6m 高的山影铺满 130m 场地），
 * 4 张贴图采样 vUv * uRepeat（全场重复 20 次）。这与任务书示例里
 * “uSplat 也 ×20”唯一的偏差：权重图是全场函数，重复会破坏高度带语义。
 */

export const SPLAT_VERTEX_SHADER = /* glsl */`
uniform float uRepeat;
varying vec2 vUv;
varying vec3 vNormal;
varying vec3 vWorld;

void main() {
  vUv = uv;
  // 地形 mesh 不带非均匀缩放，mat3(modelMatrix) 即世界法线
  vNormal = normalize(mat3(modelMatrix) * normal);
  vec4 worldPos = modelMatrix * vec4(position, 1.0);
  vWorld = worldPos.xyz;
  gl_Position = projectionMatrix * viewMatrix * worldPos;
}
`;

export const SPLAT_FRAGMENT_SHADER = /* glsl */`
uniform sampler2D uSplat;
uniform sampler2D uGrass;
uniform sampler2D uSand;
uniform sampler2D uSnow;
uniform sampler2D uRock;
uniform float uRepeat;
uniform vec3 uSunDir;

varying vec2 vUv;
varying vec3 vNormal;
varying vec3 vWorld;

void main() {
  // 4 通道 splat 权重（全场一次，不重复）
  vec4 w = texture2D(uSplat, vUv);

  // 4 张地表贴图（全场重复 20 次）
  vec2 tuv = vUv * uRepeat;
  vec3 c = w.r * texture2D(uGrass, tuv).rgb
         + w.g * texture2D(uSand,  tuv).rgb
         + w.b * texture2D(uSnow,  tuv).rgb
         + w.a * texture2D(uRock,  tuv).rgb;

  // 8-bit 量化后权重和可能不是 1，归一化兜底，防止接缝发暗/发亮
  float wsum = w.r + w.g + w.b + w.a;
  c /= max(wsum, 0.0001);

  // 简单 Lambert + ambient（与任务书简化版一致）
  float ndl = max(0.0, dot(normalize(vNormal), normalize(uSunDir)));
  gl_FragColor = vec4(c * (0.45 + 0.55 * ndl), 1.0);
}
`;

// 契约别名（tools/test-splatmap.cjs 读取 shader.fragmentShader）
export const vertexShader = SPLAT_VERTEX_SHADER;
export const fragmentShader = SPLAT_FRAGMENT_SHADER;
