import assert from 'node:assert/strict';
import {
  createDocument,
  inspectDocumentReferences,
  validateDocument,
} from '../../../src/lib/document/schema.mjs';
import { inspectSourceTransfer } from '../../../src/lib/editing/commands/source-transfer.mjs';
import { createSourceTransferCommand } from '../../../src/lib/editing/commands/source-transfer.mjs';
import { copyNodes } from '../../../src/lib/scene/ownership.mjs';
import {
  transformPoint,
  worldMatrix,
} from '../../../src/lib/scene/transforms.mjs';

const document = createDocument({
  id: 'single-path-document',
  idFactory: () => 'single-path-part',
});
for (const [nodeId, programId, translationMM] of [
  ['source-node', 'source-program', [10, 5]],
  ['target-node', 'target-program', [-2, 1]],
]) {
  document.nodes[nodeId] = {
    id: nodeId,
    kind: 'shape',
    name: nodeId,
    parentId: null,
    order: 0,
    pose: { translationMM, rotationRad: 0 },
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
document.sketches.source = {
  id: 'source',
  ownerNodeId: 'source-node',
  vertices: {
    point: { id: 'point', position: { kind: 'free', value: [1, 2] } },
    end: { id: 'end', position: { kind: 'free', value: [4, 2] } },
    unused: { id: 'unused', position: { kind: 'free', value: [9, 9] } },
  },
  edges: {
    shared: {
      id: 'shared',
      startVertexId: 'point',
      endVertexId: 'end',
      startHandle: { kind: 'free', vector: [1, 0] },
      endHandle: { kind: 'free', vector: [-1, 0] },
    },
  },
  paths: {
    'point-path': {
      id: 'point-path',
      name: '单节点',
      edges: [],
      startVertexId: 'point',
      handleModes: { point: 'corner' },
      visible: true,
    },
    'alias-path': {
      id: 'alias-path',
      name: '共享单节点',
      edges: [],
      startVertexId: 'point',
      visible: true,
    },
    'line-path': {
      id: 'line-path',
      name: '共享顶点线段',
      edges: [{ edgeId: 'shared', reversed: false }],
      visible: true,
    },
    'empty-path': {
      id: 'empty-path',
      name: '合法空路径',
      edges: [],
      visible: true,
    },
  },
};
document.sketches.target = {
  id: 'target',
  ownerNodeId: 'target-node',
  vertices: {},
  edges: {},
  paths: {},
};
validateDocument(document);
assert.deepEqual(inspectDocumentReferences(document), []);

const edgedStart = structuredClone(document);
edgedStart.sketches.source.paths['line-path'].startVertexId = 'point';
assert.throws(
  () => validateDocument(edgedStart),
  /startVertexId 只允许用于零边 Path/,
);

const dangling = structuredClone(document);
dangling.sketches.source.paths['point-path'].startVertexId = 'missing-point';
dangling.sketches.source.paths['point-path'].handleModes = {
  'missing-point': 'smooth',
};
validateDocument(dangling);
const danglingDiagnostics = inspectDocumentReferences(dangling);
assert.ok(
  danglingDiagnostics.some(
    (item) =>
      item.kind === 'unresolved-reference' &&
      item.message === 'Path startVertexId 不存在',
  ),
);
assert.ok(
  danglingDiagnostics.some(
    (item) =>
      item.kind === 'unresolved-reference' &&
      item.message.includes('missing-point'),
  ),
);
assert.ok(
  !danglingDiagnostics.some(
    (item) =>
      item.kind === 'invalid-reference' &&
      item.message.includes('missing-point'),
  ),
  'startVertexId participates in Path handle-mode membership even while dangling',
);

const noMembership = structuredClone(document);
noMembership.sketches.source.paths['empty-path'].handleModes = {
  unused: 'smooth',
};
validateDocument(noMembership);
assert.ok(
  inspectDocumentReferences(noMembership).some(
    (item) =>
      item.kind === 'invalid-reference' && item.message.includes('unused'),
  ),
);

let copySequence = 0;
const copied = copyNodes(document, ['source-node'], {
  idFactory: () => `single-copy-${++copySequence}`,
});
const copiedSketch = copied.document.sketches[copied.idMap.source];
const copiedPointPath = copiedSketch.paths[copied.idMap['point-path']];
assert.equal(copiedPointPath.startVertexId, copied.idMap.point);
assert.deepEqual(copiedPointPath.handleModes, {
  [copied.idMap.point]: 'corner',
});
assert.equal(
  Object.hasOwn(copiedSketch.paths[copied.idMap['line-path']], 'startVertexId'),
  false,
);
assert.deepEqual(
  document.sketches.source.paths['point-path'].startVertexId,
  'point',
);

const request = {
  kind: 'transfer-source',
  sourceSketchId: 'source',
  targetSketchId: 'target',
  pathIds: ['point-path'],
  keepWorld: true,
};
const inspection = inspectSourceTransfer(document, request);
assert.equal(inspection.status, 'ready');
assert.deepEqual(inspection.closure.pathIds, [
  'alias-path',
  'line-path',
  'point-path',
]);
assert.deepEqual(inspection.closure.edgeIds, ['shared']);
assert.deepEqual(inspection.closure.vertexIds, ['end', 'point']);
const beforeWorld = transformPoint(
  worldMatrix(document, 'source-node'),
  document.sketches.source.vertices.point.position.value,
);
let transferSequence = 0;
const transferred = createSourceTransferCommand(request)(
  structuredClone(document),
  { idFactory: () => `single-transfer-${++transferSequence}` },
).document;
assert.deepEqual(Object.keys(transferred.sketches.source.paths), [
  'empty-path',
]);
assert.deepEqual(Object.keys(transferred.sketches.target.paths).sort(), [
  'alias-path',
  'line-path',
  'point-path',
]);
assert.equal(
  transferred.sketches.target.paths['point-path'].startVertexId,
  'point',
);
assert.equal(
  transferred.sketches.target.paths['alias-path'].startVertexId,
  'point',
);
assert.equal(
  Object.hasOwn(
    transferred.sketches.target.paths['line-path'],
    'startVertexId',
  ),
  false,
);
const afterWorld = transformPoint(
  worldMatrix(transferred, 'target-node'),
  transferred.sketches.target.vertices.point.position.value,
);
assert.deepEqual(afterWorld, beforeWorld);
assert.equal(transferred.sketches.source.vertices.point, undefined);
assert.equal(transferred.sketches.source.edges.shared, undefined);
validateDocument(transferred);

console.log(
  'PASS single-vertex Paths validate softly, copy stable Vertex IDs, and transfer shared topology while preserving world position',
);
