import { Box3, BufferAttribute, BufferGeometry, Mesh, Vector3 } from 'three';

// Body_Trim in the deployed asset is a joined mesh. Recover the original
// disconnected bumper assemblies without slicing their faces or baking new UVs.
export function separateBumpers(vehicle) {
  const trim = vehicle.getObjectByName('Body_Trim');
  const { geometry } = trim;
  const { position } = geometry.attributes;
  const indices = geometry.index.array;
  const parent = Uint32Array.from({ length: position.count }, (_, i) => i);
  function root(i) {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  }
  const welds = new Map();
  for (let i = 0; i < position.count; i++) {
    const key = [position.getX(i), position.getY(i), position.getZ(i)].map(v => Math.round(v * 1e5)).join(',');
    if (welds.has(key)) parent[root(i)] = root(welds.get(key));
    else welds.set(key, i);
  }
  for (let i = 0; i < indices.length; i += 3) {
    const seed = root(indices[i]);
    parent[root(indices[i + 1])] = seed;
    parent[root(indices[i + 2])] = seed;
  }

  const islands = new Map();
  for (let i = 0; i < position.count; i++) {
    const key = root(i);
    if (!islands.has(key)) islands.set(key, new Box3());
    islands.get(key).expandByPoint(new Vector3().fromBufferAttribute(position, i));
  }
  const partitions = { chassis: [], frontBumper: [], rearBumper: [] };
  for (let i = 0; i < indices.length; i += 3) {
    const { min, max } = islands.get(root(indices[i]));
    const lowerTrim = min.y >= -0.015 && max.y < 0.365;
    const end = lowerTrim && min.z > 1.34 ? 'frontBumper'
      : lowerTrim && max.z < -1.34 ? 'rearBumper' : 'chassis';
    partitions[end].push(indices[i], indices[i + 1], indices[i + 2]);
  }

  for (const [id, sourceIndices] of Object.entries(partitions)) {
    if (!sourceIndices.length) throw new Error('Missing trim assembly: ' + id);
    const compact = new BufferGeometry();
    const remap = new Map();
    const original = [];
    const compactIndices = sourceIndices.map(idx => {
      if (!remap.has(idx)) {
        remap.set(idx, original.length);
        original.push(idx);
      }
      return remap.get(idx);
    });
    for (const [name, attribute] of Object.entries(geometry.attributes)) {
      const stride = attribute.isInterleavedBufferAttribute ? attribute.data.stride : attribute.itemSize;
      const offset = attribute.isInterleavedBufferAttribute ? attribute.offset : 0;
      const source = attribute.array;
      const array = new source.constructor(original.length * attribute.itemSize);
      for (let i = 0; i < original.length; i++) {
        const start = original[i] * stride + offset;
        for (let n = 0; n < attribute.itemSize; n++) array[i * attribute.itemSize + n] = source[start + n];
      }
      compact.setAttribute(name, new BufferAttribute(array, attribute.itemSize, attribute.normalized));
    }
    compact.setIndex(compactIndices);
    if (id === 'chassis') {
      trim.geometry = compact;
      continue;
    }
    compact.computeBoundingBox();
    const pivot = compact.boundingBox.getCenter(new Vector3());
    compact.translate(-pivot.x, -pivot.y, -pivot.z);
    const bumper = new Mesh(compact, trim.material);
    bumper.name = id;
    bumper.position.copy(pivot);
    trim.parent.add(bumper);
  }
  geometry.dispose();
  return vehicle;
}
