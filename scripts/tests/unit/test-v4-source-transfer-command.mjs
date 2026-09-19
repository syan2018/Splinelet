import assert from 'node:assert/strict';
import {
  createDocument,
  validateDocument,
} from '../../../src/lib/document/schema.mjs';
import { createEditorSession } from '../../../src/lib/editing/dispatcher.mjs';
import {
  createSourceTransferCommand,
  inspectSourceTransfer,
} from '../../../src/lib/editing/commands/source-transfer.mjs';
import { evaluateProgram } from '../../../src/lib/construction/document-evaluation.mjs';
import { resolveRelation } from '../../../src/lib/geometry/relations.mjs';
import { resolveSketch } from '../../../src/lib/geometry/sketch.mjs';
import {
  transformPoint,
  worldMatrix,
} from '../../../src/lib/scene/transforms.mjs';

let documentId = 0;
const fixture = () => {
  const document = createDocument({ idFactory: () => `base-${++documentId}` });
  document.nodes['owner-a'] = {
    id: 'owner-a',
    kind: 'shape',
    programId: 'program-a',
    name: '来源部件',
    parentId: null,
    order: 0,
    pose: { translationMM: [12, -3], rotationRad: Math.PI / 6 },
    visible: true,
    locked: false,
  };
  document.nodes['owner-b'] = {
    id: 'owner-b',
    kind: 'shape',
    programId: 'program-b',
    name: '目标部件',
    parentId: null,
    order: 1,
    pose: { translationMM: [-7, 9], rotationRad: -Math.PI / 4 },
    visible: true,
    locked: false,
  };
  document.programs['program-a'] = {
    id: 'program-a',
    ownerNodeId: 'owner-a',
    operators: {
      'source-a': {
        id: 'source-a',
        type: 'source',
        name: '主线来源',
        enabled: true,
        inputs: {
          paths: [
            { kind: 'sketch', sketchId: 'sketch-a', pathIds: ['path-main'] },
          ],
        },
        params: {},
      },
    },
    outputs: {
      curves: {
        kind: 'port',
        ownerNodeId: 'owner-a',
        operatorId: 'source-a',
        port: 'curves',
        domain: 'curves',
      },
    },
  };
  document.programs['program-b'] = {
    id: 'program-b',
    ownerNodeId: 'owner-b',
    operators: {},
    outputs: {},
  };
  document.sketches['sketch-a'] = {
    id: 'sketch-a',
    ownerNodeId: 'owner-a',
    vertices: {
      v0: { id: 'v0', position: { kind: 'free', value: [0, 0] } },
      v1: { id: 'v1', position: { kind: 'free', value: [8, 0] } },
      v2: { id: 'v2', position: { kind: 'free', value: [16, 4] } },
      v3: { id: 'v3', position: { kind: 'free', value: [8, -7] } },
    },
    edges: {
      e0: {
        id: 'e0',
        startVertexId: 'v0',
        endVertexId: 'v1',
        startHandle: { kind: 'free', vector: [2, 0] },
        endHandle: { kind: 'free', vector: [-2, 0] },
      },
      e1: {
        id: 'e1',
        startVertexId: 'v1',
        endVertexId: 'v2',
        startHandle: { kind: 'relation', relationId: 'continuity' },
        endHandle: { kind: 'free', vector: [-2, -1] },
      },
      e2: {
        id: 'e2',
        startVertexId: 'v1',
        endVertexId: 'v3',
        startHandle: { kind: 'free', vector: [0, -2] },
        endHandle: { kind: 'free', vector: [0, 2] },
      },
    },
    paths: {
      'path-main': {
        id: 'path-main',
        name: '主线',
        edges: [
          { edgeId: 'e0', reversed: false },
          { edgeId: 'e1', reversed: false },
        ],
        visible: true,
      },
      'path-branch': {
        id: 'path-branch',
        name: '共享端点支线',
        edges: [{ edgeId: 'e2', reversed: false }],
        visible: true,
      },
    },
  };
  document.sketches['sketch-b'] = {
    id: 'sketch-b',
    ownerNodeId: 'owner-b',
    vertices: {},
    edges: {},
    paths: {},
  };
  document.relations.continuity = {
    id: 'continuity',
    kind: 'handle-continuity',
    target: {
      kind: 'edge-end',
      sketchId: 'sketch-a',
      edgeId: 'e1',
      end: 'start',
    },
    source: {
      kind: 'edge-end',
      sketchId: 'sketch-a',
      edgeId: 'e0',
      end: 'end',
    },
    mode: 'symmetric',
  };
  document.collections.transfer = {
    id: 'transfer',
    name: '源编辑集合',
    origin: 'user',
    members: [
      { kind: 'path', sketchId: 'sketch-a', id: 'path-main' },
      { kind: 'vertex', sketchId: 'sketch-a', id: 'v1' },
    ],
  };
  return validateDocument(document);
};

const action = {
  kind: 'transfer-source',
  sourceSketchId: 'sketch-a',
  targetSketchId: 'sketch-b',
  pathIds: ['path-main'],
  keepWorld: true,
};
const near = (actual, expected, label = 'point') => {
  assert.equal(actual.length, expected.length, `${label} length`);
  actual.forEach((value, index) =>
    assert.ok(
      Math.abs(value - expected[index]) < 1e-8,
      `${label}[${index}] ${value} != ${expected[index]}`,
    ),
  );
};
const resolvedWorld = (document, sketchId) => {
  const sketch = document.sketches[sketchId];
  const result = resolveSketch(document, sketchId, {
    resolveRelation: (request) => resolveRelation({ ...request, document }),
  });
  assert.equal(result.status, 'ready');
  const matrix = worldMatrix(document, sketch.ownerNodeId);
  return Object.fromEntries(
    result.value.curves.map((curve) => [
      curve.pathRef.id,
      curve.edges.map((edge) =>
        edge.cubic.map((point) => transformPoint(matrix, point)),
      ),
    ]),
  );
};
const compareCurves = (actual, expected) => {
  assert.deepEqual(Object.keys(actual).sort(), Object.keys(expected).sort());
  for (const pathId of Object.keys(expected))
    expected[pathId].forEach((edge, edgeIndex) =>
      edge.forEach((point, pointIndex) =>
        near(actual[pathId][edgeIndex][pointIndex], point, `${pathId} cubic`),
      ),
    );
};

const original = fixture();
const beforeWorld = resolvedWorld(original, 'sketch-a');
const beforePublished = evaluateProgram(original, 'owner-a').curves;
assert.equal(beforePublished.status, 'ready');
const inspection = inspectSourceTransfer(original, action);
assert.equal(inspection.status, 'ready');
assert.deepEqual(inspection.closure.pathIds, ['path-branch', 'path-main']);
assert.deepEqual(inspection.closure.edgeIds, ['e0', 'e1', 'e2']);
assert.deepEqual(inspection.closure.vertexIds, ['v0', 'v1', 'v2', 'v3']);
assert.deepEqual(inspection.closure.relationIds, ['continuity']);
assert.equal(inspection.migrations.length, 1);
assert(inspection.dependencies.includes('relation:continuity'));
assert(inspection.dependencies.includes('operator:source-a'));
assert(inspection.dependencies.includes('collection:transfer'));

let sequence = 0;
const editor = createEditorSession(original, {
  idFactory: () => `transfer-operator-${++sequence}`,
});
editor.dispatch(createSourceTransferCommand(action), {
  expectedRevision: editor.state.revision,
});
assert.equal(editor.state.revision, 1);
assert.equal(editor.state.canUndo, true);
const moved = editor.state.document;
assert.deepEqual(Object.keys(moved.sketches['sketch-a'].paths), []);
assert.deepEqual(Object.keys(moved.sketches['sketch-b'].paths).sort(), [
  'path-branch',
  'path-main',
]);
for (const id of ['v0', 'v1', 'v2', 'v3'])
  assert.equal(moved.sketches['sketch-b'].vertices[id].id, id);
for (const id of ['e0', 'e1', 'e2'])
  assert.equal(moved.sketches['sketch-b'].edges[id].id, id);
assert.equal(moved.relations.continuity.target.sketchId, 'sketch-b');
assert.equal(moved.relations.continuity.source.sketchId, 'sketch-b');
assert.equal(
  moved.sketches['sketch-b'].edges.e1.startHandle.relationId,
  'continuity',
);
assert.equal(
  resolveRelation({
    document: moved,
    sketch: moved.sketches['sketch-b'],
    target: moved.relations.continuity.target,
    relationId: 'continuity',
  }).status,
  'ready',
);
assert(
  moved.collections.transfer.members.every(
    (member) => member.sketchId === 'sketch-b',
  ),
);
compareCurves(resolvedWorld(moved, 'sketch-b'), beforeWorld);

const migratedInput =
  moved.programs['program-a'].operators['source-a'].inputs.paths[0];
assert.equal(migratedInput.kind, 'port');
assert.equal(migratedInput.ownerNodeId, 'owner-b');
assert.equal(migratedInput.space, 'world-result');
const bridge = moved.programs['program-b'].operators[migratedInput.operatorId];
assert.equal(bridge.type, 'source');
assert.deepEqual(bridge.inputs.paths, [
  { kind: 'sketch', sketchId: 'sketch-b', pathIds: ['path-main'] },
]);
const afterPublished = evaluateProgram(moved, 'owner-a').curves;
assert.equal(afterPublished.status, 'ready');
assert.equal(afterPublished.value.curves.length, 1);
beforePublished.value.curves[0].edges.forEach((edge, edgeIndex) =>
  edge.cubic.forEach((point, pointIndex) =>
    near(
      afterPublished.value.curves[0].edges[edgeIndex].cubic[pointIndex],
      point,
      'consumer-local cubic',
    ),
  ),
);

editor.undo({ expectedRevision: editor.state.revision });
assert.deepEqual(editor.state.document, original);
assert.equal(editor.state.canUndo, false);
editor.redo({ expectedRevision: editor.state.revision });
assert.deepEqual(editor.state.document, moved);

const unsupportedConsumer = fixture();
unsupportedConsumer.programs['program-a'].operators.direct = {
  id: 'direct',
  type: 'curve-transform',
  name: '非 Source 直接消费者',
  enabled: true,
  inputs: {
    input: [{ kind: 'sketch', sketchId: 'sketch-a', pathIds: ['path-main'] }],
  },
  params: { transform: [1, 0, 0, 1, 0, 0] },
};
validateDocument(unsupportedConsumer);
const unsupportedInspection = inspectSourceTransfer(
  unsupportedConsumer,
  action,
);
assert.equal(unsupportedInspection.status, 'blocked');
assert(
  unsupportedInspection.blockers.some(
    (item) => item.key === 'program:program-a/operator:direct/input[0]',
  ),
);
const rejected = createEditorSession(unsupportedConsumer, {
  idFactory: () => `unused-${++sequence}`,
});
const rejectedBefore = rejected.state.document;
assert.throws(
  () =>
    rejected.dispatch(createSourceTransferCommand(action), {
      expectedRevision: rejected.state.revision,
    }),
  /program:program-a\/operator:direct\/input\[0\]/,
);
assert.equal(rejected.state.revision, 0);
assert.deepEqual(rejected.state.document, rejectedBefore);

const mixed = fixture();
mixed.sketches['sketch-a'].vertices.v4 = {
  id: 'v4',
  position: { kind: 'free', value: [30, 0] },
};
mixed.sketches['sketch-a'].vertices.v5 = {
  id: 'v5',
  position: { kind: 'free', value: [35, 0] },
};
mixed.sketches['sketch-a'].edges.e3 = {
  id: 'e3',
  startVertexId: 'v4',
  endVertexId: 'v5',
  startHandle: { kind: 'free', vector: [0, 0] },
  endHandle: { kind: 'free', vector: [0, 0] },
};
mixed.sketches['sketch-a'].paths['path-isolated'] = {
  id: 'path-isolated',
  name: '保留路径',
  edges: [{ edgeId: 'e3', reversed: false }],
  visible: true,
};
delete mixed.programs['program-a'].operators['source-a'].inputs.paths[0]
  .pathIds;
validateDocument(mixed);
const mixedInspection = inspectSourceTransfer(mixed, action);
assert.equal(mixedInspection.status, 'blocked');
assert(
  mixedInspection.blockers.some((item) => item.kind === 'mixed-source-input'),
);

const unsupportedRelation = fixture();
unsupportedRelation.datums.axis = {
  id: 'axis',
  name: '外部轴',
  ownerNodeId: 'owner-a',
  kind: 'axis',
  origin: [0, 0],
  angleRad: 0,
};
unsupportedRelation.sketches['sketch-a'].vertices.v0.position = {
  kind: 'relation',
  relationId: 'axis-relation',
};
unsupportedRelation.relations['axis-relation'] = {
  id: 'axis-relation',
  kind: 'point-on-axis',
  target: { kind: 'vertex', sketchId: 'sketch-a', id: 'v0' },
  axisId: 'axis',
  distance: 0,
  frame: { space: 'owner-local', transform: [1, 0, 0, 1, 0, 0] },
};
validateDocument(unsupportedRelation);
const relationInspection = inspectSourceTransfer(unsupportedRelation, action);
assert.equal(relationInspection.status, 'blocked');
assert(
  relationInspection.blockers.some(
    (item) => item.key === 'relation:axis-relation',
  ),
);
assert.throws(
  () => inspectSourceTransfer(original, { ...action, keepWorld: false }),
  /keepWorld: true/,
);

console.log(
  'PASS: V4 source transfer closure, keepWorld, finite relation, Source migration, named rejection, and one undo',
);
