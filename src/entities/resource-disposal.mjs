/** Dispose instance-owned resources while retaining shared cached model geometry/textures. */
export function disposeOwnedTree(root, sharedRoot = null) {
  if (!root?.traverse) return { geometries: 0, materials: 0 };
  const sharedGeometries = new Set();
  sharedRoot?.traverse?.((obj) => { if (obj.geometry) sharedGeometries.add(obj.geometry); });
  const geometries = new Set(), materials = new Set();
  root.traverse((obj) => {
    if (obj.geometry && !sharedGeometries.has(obj.geometry)) geometries.add(obj.geometry);
    const list = Array.isArray(obj.material) ? obj.material : [obj.material];
    for (const material of list) if (material) materials.add(material);
  });
  for (const geometry of geometries) geometry.dispose?.();
  // instantiate() clones materials per instance; material.dispose() does not dispose
  // the shared map/texture, so every instance material can be released safely.
  for (const material of materials) material.dispose?.();
  return { geometries: geometries.size, materials: materials.size };
}
