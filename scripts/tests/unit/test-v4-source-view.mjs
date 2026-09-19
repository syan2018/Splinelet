import assert from 'node:assert/strict';
import {
  createDocument,
  validateDocument,
} from '../../../src/lib/document/schema.mjs';
import {
  createSourceViewFrame,
  projectSourceView,
  sourceIdentityId,
  sourcePathId,
  sourceViewToPixel,
  sourceViewToWorld,
} from '../../../src/lib/editor/source-view.mjs';
import { editSketch } from '../../../src/lib/geometry/sketch-edit.mjs';

const document = createDocument({
  id: 'source-view-document',
  idFactory: () => 'default-part',
});
document.nodes.parent = {
  id: 'parent',
  kind: 'group',
  name: '隐藏锁定父组',
  parentId: null,
  order: 0,
  pose: { translationMM: [20, 30], rotationRad: Math.PI / 2 },
  visible: false,
  locked: true,
};
document.nodes.shape = {
  id: 'shape',
  kind: 'shape',
  name: '源部件',
  parentId: 'parent',
  order: 0,
  pose: { translationMM: [5, 0], rotationRad: 0 },
  visible: true,
  locked: false,
  programId: 'program',
};
document.programs.program = {
  id: 'program',
  ownerNodeId: 'shape',
  operators: {},
  outputs: {},
};
document.sketches['sketch:one'] = {
  id: 'sketch:one',
  ownerNodeId: 'shape',
  vertices: {
    a: { id: 'a', position: { kind: 'free', value: [0, 0] } },
    b: { id: 'b', position: { kind: 'free', value: [10, 0] } },
    c: { id: 'c', position: { kind: 'free', value: [0, 10] } },
  },
  edges: {
    ab: {
      id: 'ab',
      startVertexId: 'a',
      endVertexId: 'b',
      startHandle: { kind: 'free', vector: [1, 2] },
      endHandle: { kind: 'free', vector: [-2, 0] },
    },
    cb: {
      id: 'cb',
      startVertexId: 'c',
      endVertexId: 'b',
      startHandle: { kind: 'free', vector: [0, -2] },
      endHandle: { kind: 'relation', relationId: 'continuity' },
    },
    ca: {
      id: 'ca',
      startVertexId: 'c',
      endVertexId: 'a',
      startHandle: { kind: 'free', vector: [0, 0] },
      endHandle: { kind: 'free', vector: [0, 0] },
    },
  },
  paths: {
    'path:closed': {
      id: 'path:closed',
      name: '闭合反向路径',
      visible: true,
      edges: [
        { edgeId: 'ab', reversed: false },
        { edgeId: 'cb', reversed: true },
        { edgeId: 'ca', reversed: false },
      ],
    },
  },
};
document.relations.continuity = {
  id: 'continuity',
  kind: 'handle-continuity',
  target: {
    kind: 'edge-end',
    sketchId: 'sketch:one',
    edgeId: 'cb',
    end: 'end',
  },
  source: {
    kind: 'edge-end',
    sketchId: 'sketch:one',
    edgeId: 'ab',
    end: 'end',
  },
  mode: 'symmetric',
};
validateDocument(document);

const original = structuredClone(document);
const frame = { width: 1000, height: 500, widthMM: 100 };
const projected = projectSourceView(document, frame);
assert.equal(projected.paths.length, 1);
assert.deepEqual(projected.diagnostics, []);
assert.deepEqual(projected.unavailablePaths, []);
const path = projected.paths[0];
const pathId = sourcePathId('sketch:one', 'path:closed');
assert.equal(path.id, pathId);
assert.match(path.id, /sketch:one/);
assert.match(path.id, /path:closed/);
assert.notEqual(sourcePathId('a', 'b:c'), sourcePathId('a:b', 'c'));

assert.deepEqual(projected.frame.worldToPixel, [10, 0, 0, -10, 500, 250]);
assert.deepEqual(projected.frame.pixelToWorld, [0.1, 0, 0, -0.1, -50, 25]);
assert.deepEqual(sourceViewToPixel(frame, [0, 0]), { x: 500, y: 250 });
assert.deepEqual(sourceViewToWorld(frame, { x: 680, y: -110 }), [18, 36]);

assert.equal(path.name, '闭合反向路径');
assert.equal(path.ownerNodeId, 'shape');
assert.deepEqual(path.ownerRef, { kind: 'node', id: 'shape' });
assert.equal(path.parentNodeId, 'parent');
assert.deepEqual(path.parentRef, { kind: 'node', id: 'parent' });
assert.match(path.color, /^#[a-f0-9]{6}$/i);
assert.equal(path.closed, true);
assert.equal(path.visible, false, 'hidden parent must hide its Sketch paths');
assert.equal(path.locked, true, 'locked parent must lock its Sketch paths');
assert.equal(path.quality, 1);
assert.equal(path.curves.length, 3);
assert.equal(
  path.anchors.length,
  3,
  'closed seam is one anchor, not a duplicate',
);
assert.deepEqual(path.start, path.anchors[0]);
assert.deepEqual(path.nodeModes, ['corner', 'symmetric', 'corner']);

assert.deepEqual(path.curves[0], [
  { x: 700, y: -100 },
  { x: 680, y: -110 },
  { x: 700, y: -180 },
  { x: 700, y: -200 },
]);
assert.deepEqual(
  path.curves[1],
  [
    { x: 700, y: -200 },
    { x: 700, y: -220 },
    { x: 620, y: -100 },
    { x: 600, y: -100 },
  ],
  'reversed use must reverse cubic direction while retaining the resolved relation handle',
);
assert.deepEqual(path.curves[2][3], path.curves[0][0]);

assert.deepEqual(projected.identities.paths[path.id], {
  kind: 'path',
  sketchId: 'sketch:one',
  id: 'path:closed',
});
assert.deepEqual(
  path.identity.anchorIds.map((id) => projected.identities.anchors[id]),
  [
    { kind: 'vertex', sketchId: 'sketch:one', id: 'a' },
    { kind: 'vertex', sketchId: 'sketch:one', id: 'b' },
    { kind: 'vertex', sketchId: 'sketch:one', id: 'c' },
  ],
);
assert.deepEqual(
  path.identity.edgeIds.map((id) => projected.identities.edges[id]),
  [
    { kind: 'edge', sketchId: 'sketch:one', id: 'ab' },
    { kind: 'edge', sketchId: 'sketch:one', id: 'cb' },
    { kind: 'edge', sketchId: 'sketch:one', id: 'ca' },
  ],
);
const reversedStartHandleId = path.identity.handleIds[1][0];
const reversedEndHandleId = path.identity.handleIds[1][1];
assert.deepEqual(projected.identities.handles[reversedStartHandleId], {
  kind: 'edge-end',
  sketchId: 'sketch:one',
  edgeId: 'cb',
  end: 'end',
});
assert.deepEqual(projected.identities.handles[reversedEndHandleId], {
  kind: 'edge-end',
  sketchId: 'sketch:one',
  edgeId: 'cb',
  end: 'start',
});
assert.deepEqual(
  projected.identities.byId[reversedStartHandleId],
  projected.identities.handles[reversedStartHandleId],
);

const stableIds = [
  path.id,
  ...path.identity.anchorIds,
  ...path.identity.edgeIds,
  ...path.identity.handleIds.flat(),
];
const splitDocument = editSketch(document, {
  kind: 'split-edge',
  sketchId: 'sketch:one',
  edgeId: 'ca',
  t: 0.5,
  vertexId: 'split-vertex',
  secondEdgeId: 'split-edge',
}).document;
const afterSplit = projectSourceView(splitDocument, frame);
for (const id of stableIds)
  assert.deepEqual(
    afterSplit.identities.byId[id],
    projected.identities.byId[id],
    `split must not redirect existing identity ${id}`,
  );
const splitPath = afterSplit.paths[0];
assert.equal(splitPath.curves.length, 4);
assert(
  splitPath.identity.edgeIds.includes(
    sourceIdentityId({
      kind: 'edge',
      sketchId: 'sketch:one',
      id: 'split-edge',
    }),
  ),
);

const reversedDocument = editSketch(splitDocument, {
  kind: 'reverse-path',
  sketchId: 'sketch:one',
  pathId: 'path:closed',
}).document;
const afterReverse = projectSourceView(reversedDocument, frame);
for (const id of stableIds)
  assert.deepEqual(
    afterReverse.identities.byId[id],
    projected.identities.byId[id],
    `reverse must not redirect existing identity ${id}`,
  );
const canonicalCa = sourceIdentityId({
  kind: 'edge',
  sketchId: 'sketch:one',
  id: 'ca',
});
assert.notEqual(
  afterReverse.paths[0].identity.edgeIds.indexOf(canonicalCa),
  splitPath.identity.edgeIds.indexOf(canonicalCa),
  'display order may change while the canonical Edge identity stays fixed',
);

const degraded = structuredClone(document);
degraded.sketches['sketch:one'].paths['path:good'] = {
  id: 'path:good',
  name: '仍可显示',
  visible: true,
  edges: [{ edgeId: 'ca', reversed: false }],
};
degraded.sketches['sketch:one'].paths['path:empty'] = {
  id: 'path:empty',
  name: '合法空路径',
  visible: true,
  edges: [],
};
degraded.relations.continuity.source = structuredClone(
  degraded.relations.continuity.target,
);
validateDocument(degraded);
const partial = projectSourceView(degraded, frame);
assert.deepEqual(
  partial.paths.map((item) => item.name),
  ['仍可显示'],
  'one blocked relation path must not hide independent source paths',
);
assert.equal(partial.diagnostics.length, 1);
assert.deepEqual(partial.diagnostics[0].ref, {
  kind: 'path',
  sketchId: 'sketch:one',
  id: 'path:closed',
});
assert.match(partial.diagnostics[0].message, /循环|无法解算/);
const failed = partial.unavailablePaths.find(
  (item) => item.ref.id === 'path:closed',
);
assert.deepEqual(failed.ownerRef, { kind: 'node', id: 'shape' });
assert.equal(failed.ownerNodeId, 'shape');
assert.deepEqual(failed.parentRef, { kind: 'node', id: 'parent' });
assert.equal(failed.parentNodeId, 'parent');
assert.equal(failed.reason, 'projection-error');
const empty = partial.unavailablePaths.find(
  (item) => item.ref.id === 'path:empty',
);
assert.equal(empty.reason, 'empty');
assert(
  !partial.diagnostics.some((item) => item.ref.id === 'path:empty'),
  'an empty Path is unavailable to the old viewer but is not an error',
);
for (const pathName of ['path:closed', 'path:good', 'path:empty']) {
  const id = sourcePathId('sketch:one', pathName);
  assert.deepEqual(partial.identities.paths[id], {
    kind: 'path',
    sketchId: 'sketch:one',
    id: pathName,
  });
}
assert.equal(
  Object.keys(partial.identities.edges).length,
  1,
  'failed paths must not leak partial edge identities',
);

for (const field of [
  'id',
  'name',
  'color',
  'curves',
  'start',
  'closed',
  'visible',
  'quality',
  'anchors',
])
  assert(
    Object.hasOwn(path, field),
    `legacy viewer field is required: ${field}`,
  );
assert(Object.isFrozen(projected));
assert(Object.isFrozen(projected.paths));
assert(Object.isFrozen(path.curves[1][1]));
assert(Object.isFrozen(projected.identities.handles[reversedStartHandleId]));
assert.deepEqual(
  document,
  original,
  'source projection must not mutate V4 data',
);

assert.throws(
  () => createSourceViewFrame({ width: 0, height: 500, widthMM: 100 }),
  /正有限/,
);

console.log(
  'V4 source view: exact world cubics, explicit pixel frame, reverse seam, relation handles, hierarchy state, immutable source identities passed',
);
