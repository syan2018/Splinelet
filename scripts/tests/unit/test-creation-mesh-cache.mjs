import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  createCreationMeshCache,
  disposeCreationMeshes,
  syncCreationMeshes,
} from '../../../src/components/creation/creation-mesh-cache.mjs';
import { pickVisibleIntersection } from '../../../src/lib/creation-pick.mjs';

const polygon = (points) => ({ type: 'Polygon', coordinates: [points] });
const cell = (changes = {}) => ({
  key: 'cell-a',
  objectId: 'object-a',
  painted: true,
  geometry: polygon([
    [0, 0],
    [4, 0],
    [0, 4],
  ]),
  heightMM: 2,
  bottomMM: 3,
  color: '#102030',
  ...changes,
});
const scene = (cells) => ({
  cells,
  creation: { objects: [{ id: 'object-a', visible: true }] },
});

const content = new THREE.Group();
const cache = createCreationMeshCache();
syncCreationMeshes(content, cache, scene([cell()]), ['cell-a']);

const first = cache.values().next().value;
const mesh = first.mesh;
const geometry = mesh.geometry;
const material = mesh.material;
assert.equal(cache.size, 1);
assert.equal(
  geometry.parameters.options.depth,
  1,
  'preview geometry has unit depth',
);
assert.equal(mesh.scale.z, 2, 'height is applied through mesh scale');
assert.equal(mesh.position.z, 3, 'bottom plane remains fixed');
assert.equal(mesh.userData.key, 'cell-a');
assert.equal(mesh.userData.pickOrder, 0);
assert.equal(mesh.renderOrder, 0);
assert.equal(material.emissive.getHexString(), '354738');

// Structured-cloned coordinates must still reuse the XY extrusion.
syncCreationMeshes(
  content,
  cache,
  scene([cell({ heightMM: 5, bottomMM: 7, color: '#f0e010' })]),
  [],
);
const heightOnly = cache.values().next().value;
assert.strictEqual(heightOnly.mesh, mesh, 'height update reuses the mesh');
assert.strictEqual(
  heightOnly.mesh.geometry,
  geometry,
  'coordinate-equal clone reuses the extrusion',
);
assert.strictEqual(
  heightOnly.mesh.material,
  material,
  'colour update reuses material',
);
assert.equal(mesh.scale.z, 5);
assert.equal(mesh.position.z, 7);
assert.equal(material.color.getHexString(), 'f0e010');
assert.equal(material.emissive.getHexString(), '000000');

let oldGeometryDisposed = 0;
geometry.addEventListener('dispose', () => oldGeometryDisposed++);
syncCreationMeshes(
  content,
  cache,
  scene([
    cell({
      geometry: polygon([
        [0, 0],
        [8, 0],
        [0, 4],
      ]),
    }),
  ]),
  [],
);
assert.strictEqual(cache.values().next().value.mesh, mesh);
assert.notStrictEqual(mesh.geometry, geometry, 'XY change rebuilds geometry');
assert.equal(oldGeometryDisposed, 1, 'replaced geometry is released');

syncCreationMeshes(
  content,
  cache,
  scene([
    cell(),
    cell({
      key: 'cell-b',
      geometry: polygon([
        [5, 0],
        [9, 0],
        [5, 4],
      ]),
    }),
  ]),
  [],
);
const entries = [...cache.values()];
assert.equal(entries.length, 2);
assert.deepEqual(
  entries.map((entry) => [
    entry.mesh.userData.key,
    entry.mesh.userData.pickOrder,
    entry.mesh.renderOrder,
  ]),
  [
    ['cell-a', 0, 0],
    ['cell-b', 1, 1],
  ],
  'draw and pick order remain aligned',
);
assert.equal(
  pickVisibleIntersection(
    entries.map((entry) => ({ distance: 10, object: entry.mesh })),
  ).object.userData.key,
  'cell-b',
  'coplanar picking still resolves to the last rendered cell',
);
content.updateMatrixWorld(true);
const secondBox = new THREE.Box3().setFromObject(entries[1].mesh);
assert.equal(secondBox.min.z, 3, 'scaled mesh keeps its bottom plane');
assert.equal(secondBox.max.z, 5, 'scaled mesh puts its top at bottom + height');
const ray = new THREE.Raycaster(
  new THREE.Vector3(6, 1, 20),
  new THREE.Vector3(0, 0, -1),
);
const rayHit = pickVisibleIntersection(ray.intersectObjects(content.children));
assert.equal(
  rayHit.object.userData.key,
  'cell-b',
  'actual Three raycast picks the reused display mesh',
);
assert.equal(rayHit.point.z, 5, 'raycast hits the scaled top surface');

const deleted = entries.find((entry) => entry.mesh.userData.key === 'cell-a');
let deletedDisposed = 0;
deleted.mesh.geometry.addEventListener('dispose', () => deletedDisposed++);
syncCreationMeshes(content, cache, scene([cell({ key: 'cell-b' })]), []);
assert.equal(cache.size, 1);
assert.equal(content.children.includes(deleted.mesh), false);
assert.equal(deletedDisposed, 1, 'removed cells dispose their geometry');

syncCreationMeshes(
  content,
  cache,
  scene([
    cell({
      key: 'cell-hole',
      geometry: polygon([
        [0, 0],
        [8, 0],
        [8, 8],
        [0, 8],
      ]),
    }),
  ]),
  [],
);
// A hole remains part of the XY signature and is not filled by the unit-depth
// preview extrusion.
const holeCell = cell({
  key: 'cell-hole',
  geometry: {
    type: 'Polygon',
    coordinates: [
      [
        [0, 0],
        [8, 0],
        [8, 8],
        [0, 8],
      ],
      [
        [2, 2],
        [6, 2],
        [6, 6],
        [2, 6],
      ],
    ],
  },
});
syncCreationMeshes(content, cache, scene([holeCell]), []);
content.updateMatrixWorld(true);
assert.equal(
  new THREE.Raycaster(
    new THREE.Vector3(4, 4, 20),
    new THREE.Vector3(0, 0, -1),
  ).intersectObjects(content.children).length,
  0,
  'hole stays unpickable after XY rebuild',
);

const multiCell = cell({
  key: 'cell-multi',
  geometry: {
    type: 'MultiPolygon',
    coordinates: [
      [
        [
          [0, 0],
          [2, 0],
          [0, 2],
        ],
      ],
      [
        [
          [5, 0],
          [7, 0],
          [5, 2],
        ],
      ],
    ],
  },
});
syncCreationMeshes(content, cache, scene([multiCell]), []);
assert.equal(cache.size, 2, 'MultiPolygon creates one mesh for each polygon');
syncCreationMeshes(content, cache, scene([cell({ key: 'cell-multi' })]), []);
assert.equal(cache.size, 1, 'reduced polygon count removes stale mesh');

const remaining = cache.values().next().value;
let remainingDisposed = 0;
let remainingMaterialDisposed = 0;
remaining.mesh.geometry.addEventListener('dispose', () => remainingDisposed++);
remaining.mesh.material.addEventListener(
  'dispose',
  () => remainingMaterialDisposed++,
);
disposeCreationMeshes(content, cache);
assert.equal(cache.size, 0);
assert.equal(content.children.length, 0);
assert.equal(
  remainingDisposed,
  1,
  'unmount cleanup disposes remaining geometry',
);
assert.equal(remainingMaterialDisposed, 1, 'unmount cleanup disposes material');

console.log('creation 3D mesh cache: ok');
