/**
 * Minimal raw WebGL 1 fallback for older X5/WebViews. Three r186's
 * WebGLRenderer only requests WebGL2, so this keeps the texture-splat scene
 * available without instancing, GLSL3, compute, or WebGL2-only texture formats.
 */
import { splat } from '../core/config.js';
import { terrainHeight, terrainNormal } from './heightfield.js';
import { generateSplatWeights } from './splat-painter.js';
import { makeAllTextures } from './textures.js';

const VS = `
attribute vec3 aPosition;
attribute vec3 aNormal;
attribute vec2 aUv;
uniform mat4 uViewProjection;
varying vec2 vUv;
varying vec3 vNormal;
varying vec3 vWorld;
void main() {
  vUv = aUv;
  vNormal = aNormal;
  vWorld = aPosition;
  gl_Position = uViewProjection * vec4(aPosition, 1.0);
}`;

const FS = `
precision mediump float;
uniform sampler2D uSplat;
uniform sampler2D uGrass;
uniform sampler2D uSand;
uniform sampler2D uSnow;
uniform sampler2D uRock;
uniform vec3 uSunDir;
uniform vec3 uCameraPos;
uniform vec3 uFogColor;
uniform float uFogNear;
uniform float uFogFar;
uniform float uRepeat;
varying vec2 vUv;
varying vec3 vNormal;
varying vec3 vWorld;
void main() {
  vec4 w = texture2D(uSplat, vUv);
  vec2 tileUv = vUv * uRepeat;
  vec3 c = w.r * texture2D(uGrass, tileUv).rgb
         + w.g * texture2D(uSand, tileUv).rgb
         + w.b * texture2D(uSnow, tileUv).rgb
         + w.a * texture2D(uRock, tileUv).rgb;
  c /= max(w.r + w.g + w.b + w.a, 0.0001);
  float ndl = max(0.0, dot(normalize(vNormal), normalize(uSunDir)));
  c *= 0.45 + 0.55 * ndl;
  float fog = clamp((length(vWorld - uCameraPos) - uFogNear) / (uFogFar - uFogNear), 0.0, 1.0);
  gl_FragColor = vec4(mix(c, uFogColor, fog), 1.0);
}`;

function compile(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader) || 'unknown shader error';
    gl.deleteShader(shader);
    throw new Error(`WebGL1 shader compile failed: ${message}`);
  }
  return shader;
}

function makeProgram(gl) {
  const vs = compile(gl, gl.VERTEX_SHADER, VS);
  const fs = compile(gl, gl.FRAGMENT_SHADER, FS);
  const program = gl.createProgram();
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const message = gl.getProgramInfoLog(program) || 'unknown link error';
    gl.deleteProgram(program);
    throw new Error(`WebGL1 program link failed: ${message}`);
  }
  return program;
}

/** Build a single indexed XZ terrain mesh; vertex layout = xyz, normal, uv. */
function makeTerrainBuffers(gl) {
  const { fieldW, fieldH, segX, segZ } = splat;
  const cols = segX + 1, rows = segZ + 1;
  const vertices = new Float32Array(cols * rows * 8);
  for (let j = 0; j < rows; j++) {
    const v = j / segZ;
    const z = fieldH / 2 - v * fieldH;
    for (let i = 0; i < cols; i++) {
      const u = i / segX;
      const x = -fieldW / 2 + u * fieldW;
      const y = terrainHeight(x, z);
      const n = terrainNormal(x, z);
      const k = (j * cols + i) * 8;
      vertices[k] = x; vertices[k + 1] = y; vertices[k + 2] = z;
      vertices[k + 3] = n.x; vertices[k + 4] = n.y; vertices[k + 5] = n.z;
      vertices[k + 6] = u; vertices[k + 7] = v;
    }
  }
  const indices = new Uint16Array(segX * segZ * 6);
  let p = 0;
  for (let j = 0; j < segZ; j++) {
    for (let i = 0; i < segX; i++) {
      const a = j * cols + i, b = a + 1, c = a + cols, d = c + 1;
      indices[p++] = a; indices[p++] = b; indices[p++] = c;
      indices[p++] = b; indices[p++] = d; indices[p++] = c;
    }
  }
  const vertexBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
  const indexBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);
  return { vertexBuffer, indexBuffer, indexCount: indices.length, vertices, indices };
}

function uploadTexture(gl, data, size, repeat, mipmaps) {
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, size, size, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, repeat ? gl.REPEAT : gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, repeat ? gl.REPEAT : gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mipmaps ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
  if (mipmaps) gl.generateMipmap(gl.TEXTURE_2D);
  return texture;
}

export class WebGL1SplatRenderer {
  constructor(THREE, canvas) {
    this.THREE = THREE;
    this._viewProjection = new THREE.Matrix4();
    this.domElement = canvas;
    this.gl = canvas.getContext('webgl', { alpha: false, antialias: true, powerPreference: 'high-performance' });
    if (!this.gl) throw new Error('No WebGL1 context available');
    const gl = this.gl;
    if (gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS) < 5) throw new Error('WebGL1 device exposes fewer than five texture units');
    this.program = makeProgram(gl);
    this.buffers = makeTerrainBuffers(gl);

    const painted = generateSplatWeights({
      width: splat.mapSize,
      height: splat.mapSize,
      fieldW: splat.fieldW,
      fieldH: splat.fieldH,
    });
    const pixels = makeAllTextures();
    this.textures = [
      uploadTexture(gl, painted.data, splat.mapSize, false, false),
      uploadTexture(gl, pixels.grass, splat.textureSize, true, true),
      uploadTexture(gl, pixels.sand, splat.textureSize, true, true),
      uploadTexture(gl, pixels.snow, splat.textureSize, true, true),
      uploadTexture(gl, pixels.rock, splat.textureSize, true, true),
    ];
    this.terrain = { name: 'splat-terrain-webgl1', painted, geometry: this.buffers };
    this.pixelRatio = 1;
    this._animation = null;
    this._frame = 0;
    this._locations = {
      viewProjection: gl.getUniformLocation(this.program, 'uViewProjection'),
      sunDir: gl.getUniformLocation(this.program, 'uSunDir'),
      cameraPos: gl.getUniformLocation(this.program, 'uCameraPos'),
      fogColor: gl.getUniformLocation(this.program, 'uFogColor'),
      fogNear: gl.getUniformLocation(this.program, 'uFogNear'),
      fogFar: gl.getUniformLocation(this.program, 'uFogFar'),
      repeat: gl.getUniformLocation(this.program, 'uRepeat'),
      samplers: ['uSplat', 'uGrass', 'uSand', 'uSnow', 'uRock'].map((n) => gl.getUniformLocation(this.program, n)),
    };
    this._attribs = {
      position: gl.getAttribLocation(this.program, 'aPosition'),
      normal: gl.getAttribLocation(this.program, 'aNormal'),
      uv: gl.getAttribLocation(this.program, 'aUv'),
    };
    this._sun = new Float32Array([splat.sun.dir.x, splat.sun.dir.y, splat.sun.dir.z]);
    const sl = Math.hypot(this._sun[0], this._sun[1], this._sun[2]) || 1;
    this._sun[0] /= sl; this._sun[1] /= sl; this._sun[2] /= sl;
    this._fog = new Float32Array([0x87 / 255, 0xce / 255, 0xeb / 255]);
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
  }

  setPixelRatio(ratio) { this.pixelRatio = Math.max(1, ratio || 1); }
  setSize(width, height) {
    this.domElement.width = Math.max(1, Math.round(width * this.pixelRatio));
    this.domElement.height = Math.max(1, Math.round(height * this.pixelRatio));
    const gl = this.gl;
    gl.viewport(0, 0, this.domElement.width, this.domElement.height);
  }

  setAnimationLoop(callback) {
    this._animation = callback;
    if (this._frame) cancelAnimationFrame(this._frame);
    this._frame = 0;
    if (callback) {
      const tick = () => {
        if (!this._animation) return;
        this._animation();
        this._frame = requestAnimationFrame(tick);
      };
      this._frame = requestAnimationFrame(tick);
    }
  }

  render(_scene, camera) {
    const gl = this.gl, loc = this._locations;
    camera.updateMatrixWorld(true);
    camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
    const viewProjection = this._viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    gl.viewport(0, 0, this.domElement.width, this.domElement.height);
    gl.clearColor(0x87 / 255, 0xce / 255, 0xeb / 255, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.useProgram(this.program);
    gl.uniformMatrix4fv(loc.viewProjection, false, viewProjection.elements);
    gl.uniform3fv(loc.sunDir, this._sun);
    gl.uniform3f(loc.cameraPos, camera.position.x, camera.position.y, camera.position.z);
    gl.uniform3fv(loc.fogColor, this._fog);
    gl.uniform1f(loc.fogNear, splat.fog.near);
    gl.uniform1f(loc.fogFar, splat.fog.far);
    gl.uniform1f(loc.repeat, splat.tileRepeat);
    for (let i = 0; i < this.textures.length; i++) {
      gl.activeTexture(gl.TEXTURE0 + i);
      gl.bindTexture(gl.TEXTURE_2D, this.textures[i]);
      gl.uniform1i(loc.samplers[i], i);
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.vertexBuffer);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.buffers.indexBuffer);
    const stride = 8 * Float32Array.BYTES_PER_ELEMENT;
    gl.enableVertexAttribArray(this._attribs.position);
    gl.vertexAttribPointer(this._attribs.position, 3, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(this._attribs.normal);
    gl.vertexAttribPointer(this._attribs.normal, 3, gl.FLOAT, false, stride, 3 * 4);
    gl.enableVertexAttribArray(this._attribs.uv);
    gl.vertexAttribPointer(this._attribs.uv, 2, gl.FLOAT, false, stride, 6 * 4);
    gl.drawElements(gl.TRIANGLES, this.buffers.indexCount, gl.UNSIGNED_SHORT, 0);
  }

  dispose() {
    if (this._frame) cancelAnimationFrame(this._frame);
    const gl = this.gl;
    if (!gl) return;
    for (const texture of this.textures || []) gl.deleteTexture(texture);
    if (this.buffers) {
      gl.deleteBuffer(this.buffers.vertexBuffer);
      gl.deleteBuffer(this.buffers.indexBuffer);
    }
    if (this.program) gl.deleteProgram(this.program);
  }
}
