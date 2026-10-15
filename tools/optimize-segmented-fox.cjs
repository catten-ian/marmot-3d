const fs = require('fs');

const [src, dst] = process.argv.slice(2);
if (!src || !dst) throw new Error('Usage: node optimize-segmented-fox.cjs input.glb output.glb');

function readGlb(file) {
  const data = fs.readFileSync(file);
  let offset = 12;
  let json;
  let binary;
  while (offset + 8 <= data.length) {
    const length = data.readUInt32LE(offset);
    const type = data.readUInt32LE(offset + 4);
    const chunk = data.subarray(offset + 8, offset + 8 + length);
    if (type === 0x4e4f534a) json = JSON.parse(chunk.toString('utf8'));
    if (type === 0x004e4942) binary = chunk;
    offset += 8 + length;
  }
  if (!json || !binary) throw new Error('Missing GLB JSON or BIN chunk');
  return { json, binary };
}

function readAccessor(json, binary, index) {
  const accessor = json.accessors[index];
  const view = json.bufferViews[accessor.bufferView];
  const components = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[accessor.type];
  const byteSize = { 5121: 1, 5123: 2, 5125: 4, 5126: 4 }[accessor.componentType];
  if (!components || !byteSize) throw new Error(`Unsupported accessor: ${index}`);
  const stride = view.byteStride || components * byteSize;
  const start = (view.byteOffset || 0) + (accessor.byteOffset || 0);
  const values = accessor.componentType === 5126
    ? new Float32Array(accessor.count * components)
    : new Uint32Array(accessor.count * components);
  for (let i = 0; i < accessor.count; i++) {
    for (let c = 0; c < components; c++) {
      const offset = start + i * stride + c * byteSize;
      const target = i * components + c;
      if (accessor.componentType === 5126) values[target] = binary.readFloatLE(offset);
      else if (accessor.componentType === 5121) values[target] = binary[offset];
      else if (accessor.componentType === 5123) values[target] = binary.readUInt16LE(offset);
      else values[target] = binary.readUInt32LE(offset);
    }
  }
  return values;
}

function simplify(positions, normals, indices, resolution) {
  const vertexCount = positions.length / 3;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    for (let axis = 0; axis < 3; axis++) {
      min[axis] = Math.min(min[axis], positions[i + axis]);
      max[axis] = Math.max(max[axis], positions[i + axis]);
    }
  }
  const extent = max.map((v, axis) => Math.max(v - min[axis], 1e-8));
  const remap = new Int32Array(vertexCount);
  const cells = new Map();
  const positionsSum = [];
  const normalsSum = [];
  const counts = [];

  for (let i = 0; i < vertexCount; i++) {
    const p = i * 3;
    const x = Math.min(resolution - 1, Math.floor((positions[p] - min[0]) / extent[0] * resolution));
    const y = Math.min(resolution - 1, Math.floor((positions[p + 1] - min[1]) / extent[1] * resolution));
    const z = Math.min(resolution - 1, Math.floor((positions[p + 2] - min[2]) / extent[2] * resolution));
    const key = (x * resolution + y) * resolution + z;
    let mapped = cells.get(key);
    if (mapped === undefined) {
      mapped = counts.length;
      cells.set(key, mapped);
      positionsSum.push(0, 0, 0);
      normalsSum.push(0, 0, 0);
      counts.push(0);
    }
    remap[i] = mapped;
    positionsSum[mapped * 3] += positions[p];
    positionsSum[mapped * 3 + 1] += positions[p + 1];
    positionsSum[mapped * 3 + 2] += positions[p + 2];
    normalsSum[mapped * 3] += normals[p];
    normalsSum[mapped * 3 + 1] += normals[p + 1];
    normalsSum[mapped * 3 + 2] += normals[p + 2];
    counts[mapped]++;
  }

  const newPositions = new Float32Array(counts.length * 3);
  const newNormals = new Float32Array(counts.length * 3);
  for (let i = 0; i < counts.length; i++) {
    const p = i * 3;
    const inverseCount = 1 / counts[i];
    newPositions[p] = positionsSum[p] * inverseCount;
    newPositions[p + 1] = positionsSum[p + 1] * inverseCount;
    newPositions[p + 2] = positionsSum[p + 2] * inverseCount;
    let nx = normalsSum[p], ny = normalsSum[p + 1], nz = normalsSum[p + 2];
    let length = Math.hypot(nx, ny, nz);
    if (length < 1e-8) {
      nx = newPositions[p] - (min[0] + max[0]) * 0.5;
      ny = newPositions[p + 1] - (min[1] + max[1]) * 0.5;
      nz = newPositions[p + 2] - (min[2] + max[2]) * 0.5;
      length = Math.hypot(nx, ny, nz) || 1;
    }
    newNormals[p] = nx / length;
    newNormals[p + 1] = ny / length;
    newNormals[p + 2] = nz / length;
  }

  const newIndices = [];
  for (let i = 0; i + 2 < indices.length; i += 3) {
    const a = remap[indices[i]], b = remap[indices[i + 1]], c = remap[indices[i + 2]];
    if (a !== b && b !== c && a !== c) newIndices.push(a, b, c);
  }
  return { positions: newPositions, normals: newNormals, indices: new Uint32Array(newIndices) };
}

const { json: source, binary: sourceBinary } = readGlb(src);
const chunks = [];
const bufferViews = [];
const accessors = [];
const meshes = [];
const stats = [];
let byteOffset = 0;

function append(array, type, withBounds = false) {
  const padding = (4 - byteOffset % 4) % 4;
  if (padding) { chunks.push(Buffer.alloc(padding)); byteOffset += padding; }
  const data = Buffer.from(array.buffer, array.byteOffset, array.byteLength);
  const bufferView = bufferViews.length;
  bufferViews.push({ buffer: 0, byteOffset, byteLength: data.length });
  chunks.push(data);
  byteOffset += data.length;
  const components = type === 'SCALAR' ? 1 : 3;
  const accessor = { bufferView, componentType: type === 'SCALAR' ? 5125 : 5126,
    count: array.length / components, type };
  if (withBounds && type === 'VEC3') {
    accessor.min = [Infinity, Infinity, Infinity];
    accessor.max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < array.length; i += 3) {
      for (let axis = 0; axis < 3; axis++) {
        accessor.min[axis] = Math.min(accessor.min[axis], array[i + axis]);
        accessor.max[axis] = Math.max(accessor.max[axis], array[i + axis]);
      }
    }
  }
  accessors.push(accessor);
  return accessors.length - 1;
}

for (let meshIndex = 0; meshIndex < source.meshes.length; meshIndex++) {
  const sourceMesh = source.meshes[meshIndex];
  const primitives = [];
  for (const primitive of sourceMesh.primitives) {
    const positions = readAccessor(source, sourceBinary, primitive.attributes.POSITION);
    const normals = readAccessor(source, sourceBinary, primitive.attributes.NORMAL);
    const indices = readAccessor(source, sourceBinary, primitive.indices);
    const resolution = meshIndex === 1 ? 80 : meshIndex >= 2 ? 56 : 64;
    const result = simplify(positions, normals, indices, resolution);
    const positionAccessor = append(result.positions, 'VEC3', true);
    const normalAccessor = append(result.normals, 'VEC3');
    const indexAccessor = append(result.indices, 'SCALAR');
    primitives.push({ attributes: { POSITION: positionAccessor, NORMAL: normalAccessor },
      indices: indexAccessor, material: meshIndex === 0 ? 0 : meshIndex === 1 ? 1 : 2, mode: 4 });
    stats.push({ name: sourceMesh.name || `part_${meshIndex}`, vertices: positions.length / 3,
      triangles: indices.length / 3, optimizedVertices: result.positions.length / 3,
      optimizedTriangles: result.indices.length / 3 });
  }
  meshes.push({ name: sourceMesh.name, primitives });
}

const json = {
  asset: { version: '2.0', generator: 'marmot3d-segmented-fox-optimizer' },
  scene: source.scene || 0,
  scenes: source.scenes,
  nodes: source.nodes,
  meshes,
  materials: [
    { name: 'TailFur', pbrMetallicRoughness: { baseColorFactor: [0.78, 0.42, 0.2, 1], metallicFactor: 0, roughnessFactor: 0.92 } },
    { name: 'BodyFur', pbrMetallicRoughness: { baseColorFactor: [0.78, 0.42, 0.2, 1], metallicFactor: 0, roughnessFactor: 0.92 } },
    { name: 'LegFur', pbrMetallicRoughness: { baseColorFactor: [0.48, 0.28, 0.16, 1], metallicFactor: 0, roughnessFactor: 0.92 } },
  ],
  accessors,
  bufferViews,
  buffers: [{ byteLength: byteOffset }],
};
const jsonBytes = Buffer.from(JSON.stringify(json));
const jsonPadding = (4 - jsonBytes.length % 4) % 4;
const binPadding = (4 - byteOffset % 4) % 4;
const binary = Buffer.concat(chunks);
const totalLength = 12 + 8 + jsonBytes.length + jsonPadding + 8 + binary.length + binPadding;
const glb = Buffer.alloc(totalLength);
glb.writeUInt32LE(0x46546c67, 0);
glb.writeUInt32LE(2, 4);
glb.writeUInt32LE(totalLength, 8);
glb.writeUInt32LE(jsonBytes.length + jsonPadding, 12);
glb.writeUInt32LE(0x4e4f534a, 16);
jsonBytes.copy(glb, 20);
glb.fill(0x20, 20 + jsonBytes.length, 20 + jsonBytes.length + jsonPadding);
const binHeader = 20 + jsonBytes.length + jsonPadding;
glb.writeUInt32LE(binary.length + binPadding, binHeader);
glb.writeUInt32LE(0x004e4942, binHeader + 4);
binary.copy(glb, binHeader + 8);
fs.writeFileSync(dst, glb);
console.log(JSON.stringify({ sourceBytes: fs.statSync(src).size, outputBytes: glb.length, stats }, null, 2));
