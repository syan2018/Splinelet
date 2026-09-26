import assert from 'node:assert/strict';
import { createDocument } from '../../../src/lib/document/schema.mjs';
import {
  createPathNodeDeletionCommand,
  PATH_NODE_DELETION_ACTIONS,
} from '../../../src/lib/editing/commands/path-node-deletion.mjs';
import { createEditorSession } from '../../../src/lib/editing/dispatcher.mjs';
import { resolveSketch } from '../../../src/lib/geometry/sketch.mjs';
import { removeNode } from '../../../src/lib/source-editor/node-edit.mjs';
import { deleteNodes } from '../../../src/lib/source-editor/selection.mjs';

const points = [
  [0, 0],
  [3, 1],
  [6, -1],
  [9, 2],
  [12, 0],
];
const control = (start, end, index) => [
  start,
  [start[0] + 0.8, start[1] + 1 + index * 0.1],
  [end[0] - 0.7, end[1] - 0.6 + index * 0.2],
  end,
];
const subtract = (left, right) => [left[0] - right[0], left[1] - right[1]];
const toPoint = ([x, y]) => ({ x, y });
const toArray = ({ x, y }) => [x, y];

function fixture({ count = 5, closed = false, handleModes } = {}) {
  const document = createDocument({
    version: 4,
    id: 'path-node-delete-document',
    idFactory: () => 'path-node-delete-part',
  });
  document.nodes.owner = {
    id: 'owner',
    kind: 'shape',
    name: '节点删除',
    parentId: null,
    order: 0,
    pose: { translationMM: [0, 0], rotationRad: 0 },
    visible: true,
    locked: false,
    programId: 'program',
  };
  document.programs.program = {
    id: 'program',
    ownerNodeId: 'owner',
    operators: {},
    outputs: {},
  };
  const vertices = Object.fromEntries(
    points
      .slice(0, count)
      .map((value, index) => [
        `v${index}`,
        { id: `v${index}`, position: { kind: 'free', value: [...value] } },
      ]),
  );
  const directed = [];
  for (let index = 0; index < count - 1; index++)
    directed.push({
      startId: `v${index}`,
      endId: `v${index + 1}`,
      cubic: control(points[index], points[index + 1], index),
      reversed: index % 2 === 0,
    });
  if (closed)
    directed.push({
      startId: `v${count - 1}`,
      endId: 'v0',
      cubic: control(points[count - 1], points[0], count - 1),
      reversed: false,
    });
  const edges = {};
  const uses = directed.map((item, index) => {
    const id = `edge-${index}`;
    const source = item.reversed ? [...item.cubic].reverse() : item.cubic;
    edges[id] = {
      id,
      startVertexId: item.reversed ? item.endId : item.startId,
      endVertexId: item.reversed ? item.startId : item.endId,
      startHandle: {
        kind: 'free',
        vector: subtract(source[1], source[0]),
      },
      endHandle: {
        kind: 'free',
        vector: subtract(source[2], source[3]),
      },
    };
    return { edgeId: id, reversed: item.reversed };
  });
  document.sketches.sketch = {
    id: 'sketch',
    ownerNodeId: 'owner',
    vertices,
    edges,
    paths: {
      path: {
        id: 'path',
        name: closed ? '闭合路径' : '开放路径',
        edges: uses,
        ...(handleModes ? { handleModes: { ...handleModes } } : {}),
        visible: true,
      },
    },
  };
  return document;
}

const pathRef = { kind: 'path', sketchId: 'sketch', id: 'path' };
const action = (document, vertexIds, toleranceMM = 0.25) => ({
  kind: 'delete-path-vertices',
  pathRef,
  vertexIds,
  expectedEdges: structuredClone(document.sketches.sketch.paths.path.edges),
  toleranceMM,
});
const editorFor = (document) => {
  let sequence = 0;
  return createEditorSession(document, {
    idFactory: () => `merged-${++sequence}`,
  });
};
const dispatch = (editor, request) =>
  editor.dispatch(createPathNodeDeletionCommand(request), {
    expectedRevision: editor.state.revision,
  });
const resolved = (document) => {
  const result = resolveSketch(document, 'sketch');
  assert.equal(result.status, 'ready');
  return result.value.curves.find((curve) => curve.pathRef.id === 'path');
};
const legacy = (document) => {
  const path = document.sketches.sketch.paths.path;
  const curve = resolved(document);
  const nodeIds = curve.closed
    ? curve.edges.map((edge) => edge.startKey)
    : [curve.edges[0].startKey, ...curve.edges.map((edge) => edge.endKey)];
  return {
    start: toPoint(curve.edges[0].cubic[0]),
    curves: curve.edges.map((edge) => edge.cubic.map(toPoint)),
    closed: curve.closed,
    ...(path.handleModes
      ? {
          nodeModes: nodeIds.map(
            (vertexId) => path.handleModes[vertexId] || 'corner',
          ),
        }
      : {}),
  };
};
const curveArrays = (document) =>
  resolved(document).edges.map((edge) => edge.cubic);
const nearCubics = (actual, expected) => {
  assert.equal(actual.length, expected.length);
  for (let index = 0; index < actual.length; index++)
    for (let pointIndex = 0; pointIndex < 4; pointIndex++)
      for (let axis = 0; axis < 2; axis++)
        assert.ok(
          Math.abs(
            actual[index][pointIndex][axis] -
              toArray(expected[index][pointIndex])[axis],
          ) < 1e-10,
        );
};

assert.deepEqual(PATH_NODE_DELETION_ACTIONS, ['delete-path-vertices']);

const interiorDocument = fixture();
interiorDocument.collections.deletedTopology = {
  id: 'deletedTopology',
  name: '保留失效引用',
  origin: 'user',
  members: [
    { kind: 'vertex', sketchId: 'sketch', id: 'v2' },
    { kind: 'edge', sketchId: 'sketch', id: 'edge-1' },
  ],
};
const interiorExpected = removeNode(legacy(interiorDocument), 2, 0.25).path;
const interiorEditor = editorFor(interiorDocument);
dispatch(interiorEditor, action(interiorDocument, ['v2']));
const interior = interiorEditor.state.document.sketches.sketch;
assert.deepEqual(interior.paths.path.edges, [
  { edgeId: 'edge-0', reversed: true },
  { edgeId: 'merged-2', reversed: false },
  { edgeId: 'edge-3', reversed: false },
]);
assert.equal(interior.vertices.v2, undefined);
assert.equal(interior.edges['edge-1'], undefined);
assert.equal(interior.edges['edge-2'], undefined);
assert.ok(interior.edges['merged-2']);
assert.deepEqual(
  interiorEditor.state.document.collections.deletedTopology,
  interiorDocument.collections.deletedTopology,
  'downstream refs remain repairable and are never rebound to the merged Edge',
);
nearCubics(curveArrays(interiorEditor.state.document), interiorExpected.curves);
assert.equal(interiorEditor.state.revision, 1);
interiorEditor.undo({ expectedRevision: interiorEditor.state.revision });
assert.deepEqual(interiorEditor.state.document, interiorDocument);

const endpointDocument = fixture();
const endpointEditor = editorFor(endpointDocument);
dispatch(endpointEditor, action(endpointDocument, ['v0']));
assert.deepEqual(
  endpointEditor.state.document.sketches.sketch.paths.path.edges,
  endpointDocument.sketches.sketch.paths.path.edges.slice(1),
);
assert.equal(
  endpointEditor.state.document.sketches.sketch.edges['edge-0'],
  undefined,
);
assert.equal(
  endpointEditor.state.document.sketches.sketch.vertices.v0,
  undefined,
);

const closedDocument = fixture({ closed: true });
const closedExpected = removeNode(legacy(closedDocument), 0, 0.25).path;
const closedEditor = editorFor(closedDocument);
dispatch(closedEditor, action(closedDocument, ['v0']));
assert.deepEqual(closedEditor.state.document.sketches.sketch.paths.path.edges, [
  { edgeId: 'edge-1', reversed: false },
  { edgeId: 'edge-2', reversed: true },
  { edgeId: 'edge-3', reversed: false },
  { edgeId: 'merged-2', reversed: false },
]);
nearCubics(curveArrays(closedEditor.state.document), closedExpected.curves);

const multipleDocument = fixture();
const multipleExpected = deleteNodes(legacy(multipleDocument), [1, 3], 0.25);
const multipleEditor = editorFor(multipleDocument);
dispatch(multipleEditor, action(multipleDocument, ['v1', 'v3']));
assert.deepEqual(
  multipleEditor.state.document.sketches.sketch.paths.path.edges,
  [
    { edgeId: 'merged-2', reversed: false },
    { edgeId: 'merged-3', reversed: false },
  ],
);
nearCubics(curveArrays(multipleEditor.state.document), multipleExpected.curves);

const twoDocument = fixture({ count: 2 });
const twoEditor = editorFor(twoDocument);
dispatch(twoEditor, action(twoDocument, ['v0']));
assert.deepEqual(twoEditor.state.document.sketches.sketch.paths.path, {
  id: 'path',
  name: '开放路径',
  edges: [],
  startVertexId: 'v1',
  visible: true,
});
assert.equal(twoEditor.state.document.sketches.sketch.vertices.v0, undefined);
assert.ok(twoEditor.state.document.sketches.sketch.vertices.v1);
const onePoint = twoEditor.state.document;
dispatch(twoEditor, action(onePoint, ['v1']));
assert.equal(twoEditor.state.document.sketches.sketch.paths.path, undefined);
assert.equal(twoEditor.state.document.sketches.sketch.vertices.v1, undefined);
twoEditor.undo({ expectedRevision: twoEditor.state.revision });
assert.deepEqual(twoEditor.state.document, onePoint);

const allDocument = fixture({ count: 3, closed: true });
const allEditor = editorFor(allDocument);
dispatch(allEditor, action(allDocument, ['v0', 'v1', 'v2']));
assert.equal(allEditor.state.document.sketches.sketch.paths.path, undefined);
assert.deepEqual(allEditor.state.document.sketches.sketch.edges, {});
assert.deepEqual(allEditor.state.document.sketches.sketch.vertices, {});
allEditor.undo({ expectedRevision: allEditor.state.revision });
assert.deepEqual(allEditor.state.document, allDocument);

const shared = fixture();
shared.sketches.sketch.paths.shared = {
  id: 'shared',
  name: '共享受影响边',
  edges: [{ edgeId: 'edge-1', reversed: false }],
  visible: true,
};
const sharedEditor = editorFor(shared);
const sharedBefore = sharedEditor.state.document;
assert.throws(
  () => dispatch(sharedEditor, action(shared, ['v2'])),
  /被其他 Path 共享/,
);
assert.deepEqual(sharedEditor.state.document, sharedBefore);

const vertexShared = fixture();
vertexShared.sketches.sketch.vertices['external-v'] = {
  id: 'external-v',
  position: { kind: 'free', value: [8, -4] },
};
vertexShared.sketches.sketch.edges.external = {
  id: 'external',
  startVertexId: 'v2',
  endVertexId: 'external-v',
  startHandle: { kind: 'free', vector: [0, 0] },
  endHandle: { kind: 'free', vector: [0, 0] },
};
const vertexSharedEditor = editorFor(vertexShared);
assert.throws(
  () => dispatch(vertexSharedEditor, action(vertexShared, ['v2'])),
  /被其他 Edge 使用/,
);

const relatedHandle = fixture();
relatedHandle.relations.handleRelation = {
  id: 'handleRelation',
  kind: 'handle-continuity',
  target: {
    kind: 'edge-end',
    sketchId: 'sketch',
    edgeId: 'edge-1',
    end: 'end',
  },
  source: {
    kind: 'edge-end',
    sketchId: 'sketch',
    edgeId: 'edge-2',
    end: 'end',
  },
  mode: 'symmetric',
};
relatedHandle.sketches.sketch.edges['edge-1'].endHandle = {
  kind: 'relation',
  relationId: 'handleRelation',
};
const relatedHandleEditor = editorFor(relatedHandle);
assert.throws(
  () => dispatch(relatedHandleEditor, action(relatedHandle, ['v2'])),
  /Relation 驱动的 Handle/,
);

const relatedVertex = fixture();
relatedVertex.relations.vertexRelation = {
  id: 'vertexRelation',
  kind: 'coincident',
  target: { kind: 'vertex', sketchId: 'sketch', id: 'v2' },
  source: { kind: 'vertex', sketchId: 'sketch', id: 'v1' },
  offset: [3, -2],
  frame: { space: 'owner-local', transform: [1, 0, 0, 1, 0, 0] },
};
relatedVertex.sketches.sketch.vertices.v2.position = {
  kind: 'relation',
  relationId: 'vertexRelation',
};
const relatedVertexEditor = editorFor(relatedVertex);
assert.throws(
  () => dispatch(relatedVertexEditor, action(relatedVertex, ['v2'])),
  /Relation 驱动的 Vertex/,
);

const continuityShared = fixture({
  closed: true,
  handleModes: { v2: 'smooth' },
});
continuityShared.sketches.sketch.paths.shared = {
  id: 'shared',
  name: '共享连续性会改写的边',
  edges: [{ edgeId: 'edge-1', reversed: false }],
  visible: true,
};
const continuityEditor = editorFor(continuityShared);
assert.throws(
  () => dispatch(continuityEditor, action(continuityShared, ['v0'])),
  /被其他 Path 共享/,
);

const locked = fixture();
locked.nodes.owner.locked = true;
const lockedEditor = editorFor(locked);
assert.throws(() => dispatch(lockedEditor, action(locked, ['v2'])), /锁定/);

const stale = fixture();
const staleEditor = editorFor(stale);
assert.throws(
  () =>
    dispatch(staleEditor, {
      ...action(stale, ['v2']),
      expectedEdges: stale.sketches.sketch.paths.path.edges.slice().reverse(),
    }),
  /拓扑已变化/,
);
assert.throws(
  () => dispatch(staleEditor, action(stale, ['v2'], 0)),
  /正有限数/,
);
assert.deepEqual(staleEditor.state.document, stale);

const collision = fixture();
const collided = collision.sketches.sketch.edges['edge-3'];
delete collision.sketches.sketch.edges['edge-3'];
collided.id = '__new_edge_1';
collision.sketches.sketch.edges['__new_edge_1'] = collided;
collision.sketches.sketch.paths.path.edges[3].edgeId = '__new_edge_1';
const collisionEditor = editorFor(collision);
dispatch(collisionEditor, action(collision, ['v1']));
assert.ok(collisionEditor.state.document.sketches.sketch.edges['__new_edge_1']);
assert.ok(
  collisionEditor.state.document.sketches.sketch.paths.path.edges.some(
    (use) => use.edgeId === '__new_edge_1',
  ),
  'a surviving real Edge whose ID resembles an internal token is preserved',
);
assert.ok(collisionEditor.state.document.sketches.sketch.edges['merged-2']);

console.log(
  'PASS stable Path vertex deletion matches legacy fitting, preserves unaffected identities, rotates closed seams, handles multi-delete and single points, rejects unsafe topology atomically, and undoes once',
);
