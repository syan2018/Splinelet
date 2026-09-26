import * as THREE from 'three';

const meshKey = (cellKey, polygonIndex) => `${cellKey}\u0000${polygonIndex}`;
const polygonSignature = (rings) => JSON.stringify(rings);
const visibleCells = (scene) =>
  (scene?.cells || []).filter(
    (cell) =>
      cell.painted &&
      !cell.flatOnly &&
      !cell.conflict &&
      cell.mode !== 'cut' &&
      cell.mode !== 'through' &&
      cell.enabled !== false &&
      scene.creation.objects.some(
        (object) => object.id === cell.objectId && object.visible,
      ),
  );

const extrusion = (rings) => {
  const shape = new THREE.Shape(
    rings[0].map(([x, y]) => new THREE.Vector2(x, y)),
  );
  shape.holes = rings
    .slice(1)
    .map(
      (ring) => new THREE.Path(ring.map(([x, y]) => new THREE.Vector2(x, y))),
    );
  return new THREE.ExtrudeGeometry(shape, {
    depth: 1,
    bevelEnabled: false,
    steps: 1,
  });
};

const disposeMesh = (content, entry) => {
  content.remove(entry.mesh);
  entry.mesh.geometry.dispose();
  entry.mesh.material.dispose();
};

export const createCreationMeshCache = () => new Map();

/**
 * Keeps the inexpensive display-only properties on existing meshes. The XY
 * signature deliberately compares coordinate content: Worker DTO cloning gives
 * every accepted evaluation new array identities even when its polygons match.
 */
export function syncCreationMeshes(content, cache, scene, selected = []) {
  const selectedKeys = new Set(selected);
  const present = new Set();
  let pickOrder = 0;
  for (const cell of visibleCells(scene)) {
    const polygons =
      cell.geometry.type === 'Polygon'
        ? [cell.geometry.coordinates]
        : cell.geometry.coordinates;
    for (const [polygonIndex, rings] of polygons.entries()) {
      const key = meshKey(cell.key, polygonIndex);
      const signature = polygonSignature(rings);
      let entry = cache.get(key);
      if (!entry) {
        const material = new THREE.MeshStandardMaterial({
          polygonOffset: true,
          roughness: 0.76,
          metalness: 0,
          emissiveIntensity: 0.3,
        });
        entry = { mesh: new THREE.Mesh(extrusion(rings), material), signature };
        cache.set(key, entry);
        content.add(entry.mesh);
      } else if (entry.signature !== signature) {
        entry.mesh.geometry.dispose();
        entry.mesh.geometry = extrusion(rings);
        entry.signature = signature;
      }
      const { mesh } = entry;
      const material = mesh.material;
      mesh.scale.set(1, 1, cell.heightMM);
      mesh.position.z = cell.bottomMM ?? cell.zMM ?? 0;
      mesh.userData.key = cell.key;
      mesh.userData.pickOrder = pickOrder;
      mesh.renderOrder = pickOrder;
      material.polygonOffsetFactor = -1;
      material.polygonOffsetUnits = -1 - pickOrder * 0.1;
      material.color.set(cell.color);
      material.emissive.set(selectedKeys.has(cell.key) ? '#354738' : '#000000');
      present.add(key);
      pickOrder++;
    }
  }
  for (const [key, entry] of cache) {
    if (present.has(key)) continue;
    disposeMesh(content, entry);
    cache.delete(key);
  }
  return cache;
}

export function disposeCreationMeshes(content, cache) {
  for (const entry of cache.values()) disposeMesh(content, entry);
  cache.clear();
}
