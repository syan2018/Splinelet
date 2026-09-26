import assert from 'node:assert/strict';
import { createDocument } from '../../../src/lib/document/schema.mjs';
import {
  createPathGeometryCommand,
  PATH_GEOMETRY_ACTIONS,
} from '../../../src/lib/editing/commands/path-geometry.mjs';
import { createEditorSession } from '../../../src/lib/editing/dispatcher.mjs';
import {
  transformPoint,
  worldMatrix,
} from '../../../src/lib/scene/transforms.mjs';

const ref = { kind: 'path', sketchId: 'sketch', id: 'path' };
const expectedEdges = [
  { edgeId: 'edge-a', reversed: true },
  { edgeId: 'edge-b', reversed: false },
  { edgeId: 'edge-c', reversed: false },
];
const localCubics = [
  [
    [0, 0],
    [1, 1],
    [3, 1],
    [4, 0],
  ],
  [
    [4, 0],
    [5, 0],
    [6, 2],
    [6, 3],
  ],
  [
    [6, 3],
    [4, 4],
    [1, 2],
    [0, 0],
  ],
];

const fixture = () => {
  const document = createDocument({
    version: 4,
    id: 'path-geometry-document',
    idFactory: () => 'path-geometry-part',
  });
  document.nodes.owner = {
    id: 'owner',
    kind: 'shape',
    name: '旋转来源',
    parentId: null,
    order: 0,
    pose: { translationMM: [12, -7], rotationRad: Math.PI / 3 },
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
  document.sketches.sketch = {
    id: 'sketch',
    ownerNodeId: 'owner',
    vertices: {
      v0: { id: 'v0', position: { kind: 'free', value: [0, 0] } },
      v1: { id: 'v1', position: { kind: 'free', value: [4, 0] } },
      v2: { id: 'v2', position: { kind: 'free', value: [6, 3] } },
    },
    edges: {
      'edge-a': {
        id: 'edge-a',
        startVertexId: 'v1',
        endVertexId: 'v0',
        startHandle: { kind: 'free', vector: [-0.5, 0] },
        endHandle: { kind: 'free', vector: [0.5, 0] },
      },
      'edge-b': {
        id: 'edge-b',
        startVertexId: 'v1',
        endVertexId: 'v2',
        startHandle: { kind: 'free', vector: [0.5, 0.5] },
        endHandle: { kind: 'free', vector: [-0.5, -0.5] },
      },
      'edge-c': {
        id: 'edge-c',
        startVertexId: 'v2',
        endVertexId: 'v0',
        startHandle: { kind: 'free', vector: [-0.25, 0.75] },
        endHandle: { kind: 'free', vector: [0.25, 0.75] },
      },
    },
    paths: {
      path: {
        id: 'path',
        name: '闭合反向路径',
        edges: structuredClone(expectedEdges),
        handleModes: {
          v0: 'smooth',
          v1: 'symmetric',
          v2: 'smooth',
        },
        visible: true,
      },
    },
  };
  return document;
};

const worldCubics = (document) => {
  const matrix = worldMatrix(document, 'owner');
  return localCubics.map((cubic) =>
    cubic.map((point) => transformPoint(matrix, point)),
  );
};
const near = (actual, expected) => {
  assert.equal(actual.length, expected.length);
  actual.forEach((value, index) =>
    assert.ok(
      Math.abs(value - expected[index]) < 1e-10,
      `${actual} != ${expected}`,
    ),
  );
};
const dispatch = (editor, action) =>
  editor.dispatch(createPathGeometryCommand(action), {
    expectedRevision: editor.state.revision,
  });
const refit = (document, overrides = {}) => ({
  kind: 'refit-path',
  pathRef: ref,
  expectedEdges: structuredClone(expectedEdges),
  cubics: worldCubics(document),
  ...overrides,
});

assert.deepEqual(PATH_GEOMETRY_ACTIONS, ['refit-path', 'straighten-edge']);

const original = fixture();
const originalVertices = structuredClone(original.sketches.sketch.vertices);
const originalTopology = structuredClone(
  original.sketches.sketch.paths.path.edges,
);
const originalEdges = structuredClone(original.sketches.sketch.edges);
const editor = createEditorSession(original, { idFactory: () => 'unused' });
dispatch(editor, refit(original));
const fitted = editor.state.document.sketches.sketch;
assert.deepEqual(fitted.vertices, originalVertices);
assert.deepEqual(fitted.paths.path.edges, originalTopology);
assert.equal(fitted.paths.path.handleModes, undefined);
near(fitted.edges['edge-a'].startHandle.vector, [-1, 1]);
near(fitted.edges['edge-a'].endHandle.vector, [1, 1]);
near(fitted.edges['edge-b'].startHandle.vector, [1, 0]);
near(fitted.edges['edge-b'].endHandle.vector, [0, -1]);
near(fitted.edges['edge-c'].startHandle.vector, [-2, 1]);
near(fitted.edges['edge-c'].endHandle.vector, [1, 2]);
assert.equal(editor.state.revision, 1);
editor.undo({ expectedRevision: editor.state.revision });
assert.deepEqual(editor.state.document.sketches.sketch.edges, originalEdges);
assert.deepEqual(editor.state.document.sketches.sketch.paths.path.handleModes, {
  v0: 'smooth',
  v1: 'symmetric',
  v2: 'smooth',
});

const atomicDocument = fixture();
const atomicEditor = createEditorSession(atomicDocument);
const invalidCubics = worldCubics(atomicDocument);
invalidCubics[2][3] = [invalidCubics[2][3][0] + 1, invalidCubics[2][3][1]];
const atomicBefore = atomicEditor.state.document;
assert.throws(
  () =>
    dispatch(atomicEditor, refit(atomicDocument, { cubics: invalidCubics })),
  /第 3 段.*端点/,
);
assert.equal(atomicEditor.state.revision, 0);
assert.deepEqual(atomicEditor.state.document, atomicBefore);
assert.throws(
  () =>
    dispatch(
      atomicEditor,
      refit(atomicDocument, {
        expectedEdges: expectedEdges.map((use, index) =>
          index === 0 ? { ...use, reversed: false } : use,
        ),
      }),
    ),
  /拓扑已变化/,
);

const straightEditor = createEditorSession(fixture());
const straightBefore = straightEditor.state.document.sketches.sketch;
const untouchedA = structuredClone(straightBefore.edges['edge-a']);
const untouchedC = structuredClone(straightBefore.edges['edge-c']);
dispatch(straightEditor, {
  kind: 'straighten-edge',
  pathRef: ref,
  edgeId: 'edge-b',
});
const straight = straightEditor.state.document.sketches.sketch;
const straightStart =
  straight.vertices[straight.edges['edge-b'].startVertexId].position.value;
const straightEnd =
  straight.vertices[straight.edges['edge-b'].endVertexId].position.value;
assert.deepEqual(
  straight.edges['edge-b'].startHandle.vector,
  straightEnd.map((n, i) => (n - straightStart[i]) / 3),
);
assert.deepEqual(
  straight.edges['edge-b'].endHandle.vector,
  straightStart.map((n, i) => (n - straightEnd[i]) / 3),
);
assert.deepEqual(straight.paths.path.handleModes, { v0: 'smooth' });
assert.deepEqual(straight.edges['edge-a'], untouchedA);
assert.deepEqual(straight.edges['edge-c'], untouchedC);
straightEditor.undo({ expectedRevision: straightEditor.state.revision });
assert.deepEqual(
  straightEditor.state.document.sketches.sketch,
  straightBefore,
  'one undo restores both handles and Path modes',
);

const shared = fixture();
shared.sketches.sketch.paths.shared = {
  id: 'shared',
  name: '共享 Edge',
  edges: [{ edgeId: 'edge-b', reversed: true }],
  visible: true,
};
for (const action of [
  refit(shared),
  { kind: 'straighten-edge', pathRef: ref, edgeId: 'edge-b' },
]) {
  const sharedEditor = createEditorSession(shared);
  const before = sharedEditor.state.document;
  assert.throws(() => dispatch(sharedEditor, action), /被其他 Path.*共享/);
  assert.deepEqual(sharedEditor.state.document, before);
}

const related = fixture();
related.relations.relation = {
  id: 'relation',
  kind: 'handle-continuity',
  target: {
    kind: 'edge-end',
    sketchId: 'sketch',
    edgeId: 'edge-b',
    end: 'start',
  },
  source: {
    kind: 'edge-end',
    sketchId: 'sketch',
    edgeId: 'edge-a',
    end: 'start',
  },
  mode: 'symmetric',
};
related.sketches.sketch.edges['edge-b'].startHandle = {
  kind: 'relation',
  relationId: 'relation',
};
for (const action of [
  refit(related),
  { kind: 'straighten-edge', pathRef: ref, edgeId: 'edge-b' },
]) {
  const relationEditor = createEditorSession(related);
  const before = relationEditor.state.document;
  assert.throws(() => dispatch(relationEditor, action), /Relation/);
  assert.deepEqual(relationEditor.state.document, before);
}

const locked = fixture();
locked.nodes.owner.locked = true;
const lockedEditor = createEditorSession(locked);
assert.throws(() => dispatch(lockedEditor, refit(locked)), /锁定/);
assert.throws(
  () =>
    dispatch(lockedEditor, {
      kind: 'straighten-edge',
      pathRef: ref,
      edgeId: 'edge-b',
    }),
  /锁定/,
);

console.log(
  'PASS path refit and straighten preserve topology, convert reversed world cubics, reject unsafe sources, roll back atomically, and undo once',
);
