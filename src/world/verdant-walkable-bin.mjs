const MAGIC = 'M3DWF01';
const VERSION = 1;

function asBytes(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  throw new TypeError('walkable field payload must be ArrayBuffer or Uint8Array');
}

function sameNumber(a, b) { return Number.isFinite(a) && Number.isFinite(b) && Object.is(a, b) || Math.abs(a - b) <= 1e-6; }

export function serializeWalkableField({ top, surfaceLayers, nx, nz, cellSize, bounds, layerCount = 4, stats = {} }) {
  if (!(top instanceof Float32Array) || !(surfaceLayers instanceof Float32Array)) throw new TypeError('walkable arrays must be Float32Array');
  if (top.length !== nx * nz || surfaceLayers.length !== nx * nz * layerCount) throw new Error('walkable array lengths do not match header');
  const topBytes = new Uint8Array(top.buffer, top.byteOffset, top.byteLength);
  const layersBytes = new Uint8Array(surfaceLayers.buffer, surfaceLayers.byteOffset, surfaceLayers.byteLength);
  const payload = new Uint8Array(topBytes.byteLength + layersBytes.byteLength);
  payload.set(topBytes); payload.set(layersBytes, topBytes.byteLength);
  const checksum = sha256Hex(payload);
  const header = { magic: MAGIC, version: VERSION, nx, nz, cellSize, bounds: { ...bounds }, layerCount, checksum, stats: { ...stats } };
  const headerBytes = new TextEncoder().encode(JSON.stringify(header));
  const out = new Uint8Array(4 + headerBytes.byteLength + payload.byteLength);
  new DataView(out.buffer).setUint32(0, headerBytes.byteLength, true);
  out.set(headerBytes, 4); out.set(payload, 4 + headerBytes.byteLength);
  return out;
}

export function parseWalkableFieldBin(input, { expected = null, verifyChecksum = true } = {}) {
  const bytes = asBytes(input);
  if (bytes.byteLength < 4) throw new Error('walkable field bin too short');
  const headerLength = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0, true);
  if (headerLength < 2 || 4 + headerLength > bytes.byteLength) throw new Error('invalid walkable field header length');
  let header;
  try { header = JSON.parse(new TextDecoder().decode(bytes.subarray(4, 4 + headerLength))); } catch (error) { throw new Error(`invalid walkable field JSON header: ${error.message}`); }
  if (header.magic !== MAGIC || header.version !== VERSION) throw new Error('unsupported walkable field format');
  const { nx, nz, layerCount, cellSize, bounds } = header;
  if (!Number.isInteger(nx) || !Number.isInteger(nz) || !Number.isInteger(layerCount) || layerCount < 1 || nx < 1 || nz < 1) throw new Error('invalid walkable field dimensions');
  const payloadBytes = bytes.byteLength - 4 - headerLength;
  const expectedBytes = (nx * nz * (1 + layerCount)) * 4;
  if (payloadBytes !== expectedBytes) throw new Error(`walkable field payload length ${payloadBytes} != ${expectedBytes}`);
  if (!bounds || !['minX', 'maxX', 'minZ', 'maxZ'].every((key) => Number.isFinite(bounds[key])) || !Number.isFinite(cellSize) || cellSize <= 0) throw new Error('invalid walkable field bounds');
  if (typeof header.checksum !== 'string' || !/^[a-f0-9]{64}$/i.test(header.checksum)) throw new Error('invalid walkable field checksum');
  const payload = bytes.subarray(4 + headerLength);
  if (verifyChecksum && sha256Hex(payload) !== header.checksum.toLowerCase()) throw new Error('walkable field checksum mismatch');
  if (expected && !validateWalkableFieldHeader(header, expected)) throw new Error('walkable field header does not match manifest mapping');
  const topBytes = payload.subarray(0, nx * nz * 4);
  const layerBytes = payload.subarray(nx * nz * 4);
  const top = new Float32Array(topBytes.buffer.slice(topBytes.byteOffset, topBytes.byteOffset + topBytes.byteLength));
  const surfaceLayers = new Float32Array(layerBytes.buffer.slice(layerBytes.byteOffset, layerBytes.byteOffset + layerBytes.byteLength));
  return { top, surfaceLayers, nx, nz, cellSize, bounds, layerCount, stats: header.stats || {}, header };
}

export function validateWalkableFieldHeader(header, expected) {
  if (!header || !expected) return false;
  if (header.nx !== expected.nx || header.nz !== expected.nz || header.layerCount !== expected.layerCount) return false;
  if (!sameNumber(header.cellSize, expected.cellSize)) return false;
  return ['minX', 'maxX', 'minZ', 'maxZ'].every((key) => sameNumber(header.bounds?.[key], expected.bounds?.[key]));
}

/** Pick the validated offline raster or lazily run the legacy device rasterizer. */
export function resolveWalkableRaster({ precomputed = null, bounds, cellSize = 0.22, layerCount = 4, rasterize, warn = null }) {
  const expected = {
    nx: Math.max(8, Math.ceil((bounds.maxX - bounds.minX) / cellSize)),
    nz: Math.max(8, Math.ceil((bounds.maxZ - bounds.minZ) / cellSize)),
    layerCount, cellSize, bounds,
  };
  if (precomputed && validateWalkableFieldHeader(precomputed.header || precomputed, expected)) return precomputed;
  if (precomputed) warn?.('预计算可行走地形校验失败，回退设备端栅格化');
  if (typeof rasterize !== 'function') throw new TypeError('rasterize callback is required for walkable field fallback');
  return rasterize();
}

export function sha256Hex(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const K = [0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
  const bitLen = bytes.length * 8, total = Math.ceil((bytes.length + 9) / 64) * 64;
  const data = new Uint8Array(total); data.set(bytes); data[bytes.length] = 0x80;
  const view = new DataView(data.buffer); view.setUint32(total - 4, bitLen >>> 0, false); view.setUint32(total - 8, Math.floor(bitLen / 0x100000000) >>> 0, false);
  let a=0x6a09e667,b=0xbb67ae85,c=0x3c6ef372,d=0xa54ff53a,e=0x510e527f,f=0x9b05688c,g=0x1f83d9ab,h=0x5be0cd19;
  const w = new Uint32Array(64), rotr=(x,n)=>(x>>>n)|(x<<(32-n));
  for (let o=0;o<total;o+=64) { for(let i=0;i<16;i++) w[i]=view.getUint32(o+i*4,false); for(let i=16;i<64;i++){const s0=rotr(w[i-15],7)^rotr(w[i-15],18)^(w[i-15]>>>3),s1=rotr(w[i-2],17)^rotr(w[i-2],19)^(w[i-2]>>>10); w[i]=(w[i-16]+s0+w[i-7]+s1)>>>0;} let A=a,B=b,C=c,D=d,E=e,F=f,G=g,H=h; for(let i=0;i<64;i++){const S1=rotr(E,6)^rotr(E,11)^rotr(E,25), ch=(E&F)^(~E&G), t1=(H+S1+ch+K[i]+w[i])>>>0, S0=rotr(A,2)^rotr(A,13)^rotr(A,22), maj=(A&B)^(A&C)^(B&C), t2=(S0+maj)>>>0; H=G;G=F;F=E;E=(D+t1)>>>0;D=C;C=B;B=A;A=(t1+t2)>>>0;} a=(a+A)>>>0;b=(b+B)>>>0;c=(c+C)>>>0;d=(d+D)>>>0;e=(e+E)>>>0;f=(f+F)>>>0;g=(g+G)>>>0;h=(h+H)>>>0; }
  return [a,b,c,d,e,f,g,h].map((x)=>x.toString(16).padStart(8,'0')).join('');
}
