import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  emptyModel,
  validateModel,
  regionDependants,
} from '../lib/model-schema.mjs';
import { evaluateRegions, previewRegion } from '../lib/region-engine.mjs';
import { buildSolid, meshSTL, inspectMesh } from '../lib/solid-engine.mjs';
const path = (id, pts, closed = true) => ({
  id,
  name: id,
  closed,
  visible: true,
  curves: pts.slice(0, -1).map((a, i) => {
    const b = pts[i + 1];
    return [a, a, b, b].map(([x, y]) => ({ x, y }));
  }),
});
const p = {
  width: 100,
  height: 100,
  widthMM: 100,
  paths: [
    path('a', [
      [0, 0],
      [20, 0],
      [20, 20],
      [0, 20],
      [0, 0],
    ]),
    path('b', [
      [5, 5],
      [15, 5],
      [15, 15],
      [5, 15],
      [5, 5],
    ]),
    path(
      'c',
      [
        [-1, 10],
        [19.95, 10],
      ],
      false,
    ),
  ],
  model: emptyModel(),
};
const source = JSON.stringify(p.paths);
p.model.regions.push(
  { id: 'A', name: 'A', kind: 'path', pathId: 'a', color: '#ffffff' },
  { id: 'B', name: 'B', kind: 'path', pathId: 'b', color: '#ffffff' },
  { id: 'R', name: 'R', kind: 'difference', a: 'A', b: 'B', color: '#ffffff' },
);
assert.equal(evaluateRegions(p).find((x) => x.id === 'R').areaMM2, 300);
assert.equal(evaluateRegions(p).find((x) => x.id === 'R').holes, 1);
assert.equal(
  previewRegion(p, { kind: 'union', a: 'A', b: 'B' }).candidates[0].areaMM2,
  400,
);
assert.equal(
  previewRegion(p, { kind: 'intersection', a: 'A', b: 'B' }).candidates[0]
    .areaMM2,
  100,
);
// A parent-boundary between face closes its open source curves along the
// parent ring. The generated routes pass through the two corners; no source
// anchor is changed and no diagonal chord is introduced.
const bordered = {
  ...structuredClone(p),
  paths: [
    path('frame', [
      [0, 0],
      [100, 0],
      [100, 100],
      [0, 100],
      [0, 0],
    ]),
    path(
      'upper',
      [
        [0, 20],
        [100, 20],
      ],
      false,
    ),
    path(
      'lower',
      [
        [80, 0],
        [20, 0],
      ],
      false,
    ),
  ],
  model: emptyModel(),
};
bordered.model.regions.push({
  id: 'frame',
  name: 'frame',
  kind: 'path',
  pathId: 'frame',
  color: '#ffffff',
});
const borderedFace = {
  id: 'bordered',
  name: 'bordered',
  kind: 'between',
  pathIds: ['upper', 'lower'],
  boundaryRegionId: 'frame',
  boundaryJoinMM: 0,
  color: '#ffffff',
};
const borderedPreview = previewRegion(bordered, borderedFace);
assert.equal(borderedPreview.connections.length, 2);
assert(borderedPreview.connections.every((c) => c.boundaryArcMM === 40));
assert(
  borderedPreview.connections.every(
    (c) =>
      c.coordinates[0] === c.from &&
      c.coordinates.at(-1) === c.to &&
      c.coordinates.length >= 4,
  ),
  'closure diagnostics retain the full constructed boundary route',
);
assert.equal(borderedPreview.candidates[0].areaMM2, 2000);
bordered.model.regions.push(borderedFace);
assert.equal(
  evaluateRegions(bordered).find((r) => r.id === 'bordered').areaMM2,
  2000,
);
assert.deepEqual(
  new Set(regionDependants(bordered.model, ['frame'])),
  new Set(['frame', 'bordered']),
);
const movedBordered = structuredClone(bordered);
const movedUpper = movedBordered.paths.find((p) => p.id === 'upper').curves[0];
for (const point of movedUpper.slice(0, 2)) point.x += 0.04;
for (const point of movedUpper.slice(2)) point.x -= 0.04;
const movedPreview = previewRegion(movedBordered, {
  ...borderedFace,
  boundaryJoinMM: 0.1,
});
assert.notEqual(
  movedPreview.candidates[0].areaMM2,
  borderedPreview.candidates[0].areaMM2,
  'moving a source endpoint recomputes the bounded face',
);
assert(
  movedPreview.connections.some((c) => c.gapMM > 0),
  'the parent-boundary extension reports its real endpoint gap',
);
assert(
  movedPreview.connections.every((c) => c.coordinates[1] === c.boundaryFrom),
  'the extension from each source endpoint reaches its projected ring point',
);
assert.throws(
  () =>
    previewRegion(movedBordered, {
      ...borderedFace,
      boundaryJoinMM: 0.03,
    }),
  /超过边界接合距离/,
);
const translatedBordered = structuredClone(bordered);
for (const sourcePath of translatedBordered.paths)
  for (const curve of sourcePath.curves)
    for (const point of curve) {
      point.x += 5;
      point.y -= 7;
    }
const translatedPreview = previewRegion(translatedBordered, borderedFace);
assert.equal(
  translatedPreview.candidates[0].areaMM2,
  borderedPreview.candidates[0].areaMM2,
  'moving the full parent and source set preserves the bounded face area',
);
assert.throws(
  () => previewRegion(p, { kind: 'difference', a: 'B', b: 'A' }),
  /有效面积/,
);
const disconnectedPath = structuredClone(p);
disconnectedPath.paths[0].curves[1][0].x += 1;
assert.match(evaluateRegions(disconnectedPath)[0].error, /断口/);
assert.throws(
  () =>
    previewRegion(p, { kind: 'split', baseId: 'A', pathIds: ['c'], joinMM: 0 }),
  /没有形成/,
);
const split = previewRegion(p, {
  kind: 'split',
  baseId: 'A',
  pathIds: ['c'],
  joinMM: 0.15,
});
assert.equal(split.candidates.length, 2);
assert.equal(
  split.candidates.reduce((s, x) => s + x.areaMM2, 0),
  400,
);
p.model.regions.push({
  id: 'S',
  name: 'S',
  kind: 'split',
  baseId: 'A',
  pathIds: ['c'],
  joinMM: 0.15,
  seed: split.candidates[0].seed,
  expectedCount: 2,
  color: '#ffffff',
});
assert(!evaluateRegions(p).find((x) => x.id === 'S').error);
const resized = structuredClone(p);
resized.model.regions.at(-1).seedWidthMM = p.widthMM;
resized.widthMM = 50;
assert(
  Math.abs(evaluateRegions(resized).find((r) => r.id === 'S').areaMM2 - 50) <
    1e-5,
);
const changedTopology = structuredClone(p);
changedTopology.paths.push(
  path(
    'extra',
    [
      [10, -1],
      [10, 21],
    ],
    false,
  ),
);
changedTopology.model.regions.at(-1).pathIds.push('extra');
assert.match(
  evaluateRegions(changedTopology).find((r) => r.id === 'S').error,
  /请重新选区/,
);
assert.deepEqual(
  new Set(regionDependants(p.model, ['A'])),
  new Set(['A', 'R', 'S']),
);
p.model.features.push(
  {
    id: 'base',
    name: 'base',
    mode: 'add',
    partId: 'main',
    regionId: 'A',
    zMM: 0,
    heightMM: 2,
    color: '#ffffff',
    enabled: true,
  },
  {
    id: 'relief',
    name: 'relief',
    mode: 'add',
    partId: 'main',
    regionId: 'B',
    zMM: 0,
    attachId: 'base',
    heightMM: 1,
    color: '#ffffff',
    enabled: true,
  },
);
validateModel(p.model);
const cycle = structuredClone(p);
cycle.model.features[0].attachId = 'relief';
await assert.rejects(() => buildSolid(cycle), /循环/);
const disabledParent = structuredClone(p);
disabledParent.model.features[0].enabled = false;
await assert.rejects(() => buildSolid(disabledParent), /停用/);
const disconnected = structuredClone(p);
disconnected.model.features[1].attachId = '';
disconnected.model.features[1].zMM = 5;
const islands = await buildSolid(disconnected);
assert.equal(islands.report.components, 2);
assert.throws(() => meshSTL(islands.mesh), /相连/);
let solid = await buildSolid(p);
assert(solid.report.valid);
assert.equal(solid.report.components, 1);
assert(Math.abs(solid.report.volumeMM3 - 900) < 1e-5);
p.model.features[0].heightMM = 3;
solid = await buildSolid(p);
assert(Math.abs(solid.report.volumeMM3 - 1300) < 1e-5);
assert.equal(solid.features.find((f) => f.id === 'relief').top, 4);
p.model.features.push({
  id: 'hole',
  name: 'hole',
  mode: 'through',
  partId: 'main',
  regionId: 'B',
  zMM: 0,
  heightMM: 1,
  color: '#ffffff',
  enabled: true,
});
solid = await buildSolid(p);
assert(Math.abs(solid.report.volumeMM3 - 900) < 1e-5);
const stl = meshSTL(solid.mesh),
  view = new DataView(stl),
  positions = [],
  triangles = [];
for (let i = 0; i < view.getUint32(80, true); i++)
  for (let j = 0; j < 3; j++) {
    triangles.push(positions.length / 3);
    positions.push(
      ...[0, 1, 2].map((k) =>
        view.getFloat32(84 + i * 50 + 12 + j * 12 + k * 4, true),
      ),
    );
  }
// Round-trip STL welding is independent of its original index buffer.
const ids = new Map(),
  v = [],
  remap = [];
for (let i = 0; i < positions.length; i += 3) {
  const a = positions.slice(i, i + 3),
    key = a.join();
  if (!ids.has(key)) {
    ids.set(key, v.length / 3);
    v.push(...a);
  }
  remap.push(ids.get(key));
}
assert(inspectMesh({ positions: v, triangles: remap }).valid);
assert.equal(JSON.stringify(p.paths), source);
p.paths = p.paths.filter((x) => x.id !== 'a');
assert.match(evaluateRegions(p).find((x) => x.id === 'S').error, /删除/);
await assert.rejects(() => buildSolid(p), /删除/);
const sourceFile = new URL(
  '../../sandrone-relief-experiment/Sandrone.source.bezier.json',
  import.meta.url,
);
if (fs.existsSync(sourceFile)) {
  const q = JSON.parse(fs.readFileSync(sourceFile));
  q.model = emptyModel();
  q.model.regions = [
    {
      id: 'hair',
      name: 'hair',
      kind: 'path',
      pathId: q.paths[11].id,
      color: '#ffffff',
    },
  ];
  const s = previewRegion(q, {
    kind: 'split',
    baseId: 'hair',
    pathIds: q.paths.slice(16, 23).map((p) => p.id),
    joinMM: 0.7,
  });
  assert.equal(s.candidates.length, 11);
  console.log('Sandrone: 7 cutters / 11 regions, source cubics untouched');
  const face = previewRegion(q, {
    kind: 'path',
    pathId: q.paths[37].id,
    repair: true,
  });
  assert.equal(face.candidates[0].holes, 1);
  console.log('Sandrone face: self-intersection repair preserves eye hole');
}
console.log(
  'PASS: holes, cut preview, source dependencies, attachment heights, booleans, mesh and STL round-trip',
);
