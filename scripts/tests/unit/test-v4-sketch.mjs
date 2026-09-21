import assert from 'node:assert/strict';
import { createDocument } from '../../../src/lib/document/schema.mjs';
import { editSketch } from '../../../src/lib/geometry/sketch-edit.mjs';
import {
  resolveSketch,
  reversePathUses,
} from '../../../src/lib/geometry/sketch.mjs';
import {
  applySketchTransfer,
  planSketchTransfer,
} from '../../../src/lib/geometry/sketch-transfer.mjs';

let sequence = 0;
const nextId = () => `generated-${++sequence}`;
const document = createDocument({ idFactory: nextId });
for (const [nodeId, programId] of [
  ['shape-a', 'program-a'],
  ['shape-b', 'program-b'],
]) {
  document.nodes[nodeId] = {
    id: nodeId,
    kind: 'shape',
    name: nodeId,
    parentId: null,
    order: 0,
    pose: { translationMM: [0, 0], rotationRad: 0 },
    visible: true,
    locked: false,
    programId,
  };
  document.programs[programId] = {
    id: programId,
    ownerNodeId: nodeId,
    operators: {},
    outputs: {},
  };
}
document.sketches['sketch-a'] = {
  id: 'sketch-a',
  ownerNodeId: 'shape-a',
  vertices: {
    a: { id: 'a', position: { kind: 'free', value: [0, 0] } },
    b: { id: 'b', position: { kind: 'free', value: [3, 0] } },
    c: { id: 'c', position: { kind: 'free', value: [6, 2] } },
  },
  edges: {
    first: {
      id: 'first',
      startVertexId: 'a',
      endVertexId: 'b',
      startHandle: { kind: 'free', vector: [1, 0] },
      endHandle: { kind: 'free', vector: [-1, 0] },
    },
    disconnected: {
      id: 'disconnected',
      startVertexId: 'c',
      endVertexId: 'b',
      startHandle: { kind: 'free', vector: [-1, 0] },
      endHandle: { kind: 'free', vector: [1, 0] },
    },
  },
  paths: {
    path: {
      id: 'path',
      name: '母线',
      edges: [{ edgeId: 'first', reversed: false }],
      visible: true,
    },
  },
};
document.sketches['sketch-b'] = {
  id: 'sketch-b',
  ownerNodeId: 'shape-b',
  vertices: {},
  edges: {},
  paths: {},
};

const normal = resolveSketch(document, 'sketch-a');
assert.equal(normal.status, 'ready');
assert.deepEqual(normal.value.curves[0].edges[0].cubic, [
  [0, 0],
  [1, 0],
  [2, 0],
  [3, 0],
]);
assert.equal(normal.value.curves[0].closed, false);

const reversed = reversePathUses(document.sketches['sketch-a'].paths.path);
document.sketches['sketch-a'].paths.path = reversed;
assert.deepEqual(
  resolveSketch(document, 'sketch-a').value.curves[0].edges[0].cubic,
  [
    [3, 0],
    [2, 0],
    [1, 0],
    [0, 0],
  ],
);
document.sketches['sketch-a'].paths.path = reversePathUses(reversed);

const split = editSketch(document, {
  kind: 'split-edge',
  sketchId: 'sketch-a',
  edgeId: 'first',
  t: 0.5,
  vertexId: 'mid',
  secondEdgeId: 'second',
});
const splitCurve = resolveSketch(split.document, 'sketch-a');
assert.equal(splitCurve.status, 'ready');
assert.equal(split.document.sketches['sketch-a'].edges.first.id, 'first');
assert.equal(split.document.sketches['sketch-a'].paths.path.edges.length, 2);
assert.deepEqual(
  splitCurve.value.curves[0].edges.map((edge) => edge.cubic),
  [
    [
      [0, 0],
      [0.5, 0],
      [1, 0],
      [1.5, 0],
    ],
    [
      [1.5, 0],
      [2, 0],
      [2.5, 0],
      [3, 0],
    ],
  ],
);

const nonWelded = structuredClone(document);
nonWelded.sketches['sketch-a'].paths.path.edges.push({
  edgeId: 'disconnected',
  reversed: false,
});
const nonWeldedResult = resolveSketch(nonWelded, 'sketch-a');
assert.equal(nonWeldedResult.status, 'ready');
assert.ok(
  nonWeldedResult.diagnostics.some(
    (diagnostic) => diagnostic.kind === 'open-junction',
  ),
);

const missingEdge = structuredClone(document);
missingEdge.sketches['sketch-a'].paths.path.edges = [
  { edgeId: 'removed', reversed: false },
];
assert.equal(resolveSketch(missingEdge, 'sketch-a').status, 'blocked');

const relation = structuredClone(document);
relation.sketches['sketch-a'].vertices.a.position = {
  kind: 'relation',
  relationId: 'axis-relation',
};
assert.equal(resolveSketch(relation, 'sketch-a').status, 'blocked');
assert.deepEqual(
  resolveSketch(relation, 'sketch-a', {
    resolveRelation: () => ({
      status: 'ready',
      value: [7, 8],
      diagnostics: [],
      dependencies: ['relation:axis-relation'],
    }),
  }).value.curves[0].edges[0].cubic[0],
  [7, 8],
);

const transformed = editSketch(document, {
  kind: 'transform',
  sketchId: 'sketch-a',
  vertexIds: ['a'],
  matrix: [1, 0, 0, 1, 5, 0],
});
assert.deepEqual(
  transformed.document.sketches['sketch-a'].vertices.a.position.value,
  [5, 0],
);
assert.deepEqual(
  transformed.document.sketches['sketch-a'].edges.first.startHandle.vector,
  [1, 0],
);
assert.deepEqual(
  transformed.document.sketches['sketch-a'].edges.first.endHandle.vector,
  [-1, 0],
);

const transferPlan = planSketchTransfer(document, {
  sourceSketchId: 'sketch-a',
  targetSketchId: 'sketch-b',
  pathIds: ['path'],
  transform: [1, 0, 0, 1, 10, 0],
});
assert.deepEqual(transferPlan.externalReferences, []);
const transferred = applySketchTransfer(document, transferPlan, {
  idFactory: nextId,
});
assert.equal(
  Object.keys(transferred.document.sketches['sketch-a'].paths).length,
  0,
);
const transferredPathId = Object.keys(
  transferred.document.sketches['sketch-b'].paths,
)[0];
const transferredResult = resolveSketch(transferred.document, 'sketch-b');
assert.equal(transferredResult.status, 'ready');
assert.equal(transferredResult.value.curves[0].pathRef.id, transferredPathId);
assert.deepEqual(transferredResult.value.curves[0].edges[0].cubic[0], [10, 0]);

const sharedPath = structuredClone(document);
sharedPath.sketches['sketch-a'].paths.linked = {
  id: 'linked',
  name: '共享边路径',
  edges: [{ edgeId: 'first', reversed: true }],
  visible: true,
};
const sharedPlan = planSketchTransfer(sharedPath, {
  sourceSketchId: 'sketch-a',
  targetSketchId: 'sketch-b',
  pathIds: ['path'],
});
assert.deepEqual(sharedPlan.closure.pathIds, ['linked', 'path']);
assert.deepEqual(sharedPlan.closure.vertexIds, ['a', 'b']);

const sharedVertex = structuredClone(document);
sharedVertex.sketches['sketch-a'].paths.other = {
  id: 'other',
  name: '共享顶点路径',
  edges: [{ edgeId: 'disconnected', reversed: false }],
  visible: true,
};
const sharedVertexPlan = planSketchTransfer(sharedVertex, {
  sourceSketchId: 'sketch-a',
  targetSketchId: 'sketch-b',
  pathIds: ['path'],
});
assert.deepEqual(sharedVertexPlan.closure.pathIds, ['other', 'path']);
assert.deepEqual(sharedVertexPlan.closure.edgeIds, ['disconnected', 'first']);
assert.deepEqual(sharedVertexPlan.closure.vertexIds, ['a', 'b', 'c']);

const missingTransferEdge = structuredClone(document);
delete missingTransferEdge.sketches['sketch-a'].edges.first;
assert.throws(
  () =>
    planSketchTransfer(missingTransferEdge, {
      sourceSketchId: 'sketch-a',
      targetSketchId: 'sketch-b',
      pathIds: ['path'],
    }),
  /Path edgeId|不存在的 Edge/,
);

const externallyUsed = structuredClone(document);
externallyUsed.programs['program-a'].operators['source-op'] = {
  id: 'source-op',
  type: 'source',
  name: '源',
  enabled: true,
  inputs: {
    paths: [{ kind: 'sketch', sketchId: 'sketch-a', pathIds: ['path'] }],
  },
  params: {},
};
const guardedPlan = planSketchTransfer(externallyUsed, {
  sourceSketchId: 'sketch-a',
  targetSketchId: 'sketch-b',
  pathIds: ['path'],
});
assert.ok(
  guardedPlan.externalReferences.some(
    (impact) => impact.kind === 'program-input',
  ),
);
assert.throws(
  () =>
    applySketchTransfer(externallyUsed, {
      ...guardedPlan,
      externalReferences: [],
    }),
  /过期或被篡改/,
);

console.log(
  'PASS: V4 Sketch stable topology, cubic split/reversal, diagnostics, relation injection, and ownership transfer.',
);
