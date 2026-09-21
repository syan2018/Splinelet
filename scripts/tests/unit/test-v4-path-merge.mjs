import assert from 'node:assert/strict';
import { mergeSplines } from '../../../src/lib/source-editor/connect.mjs';
import { resolveSketch } from '../../../src/lib/geometry/sketch.mjs';
import { createDocument } from '../../../src/lib/document/schema.mjs';
import { createEditorSession } from '../../../src/lib/editing/dispatcher.mjs';
import {
  createPathMergeCommand,
  PATH_MERGE_ACTIONS,
} from '../../../src/lib/editing/commands/path-merge.mjs';

const point = (x, y) => ({ x, y });
const legacyA = {
  id: 'a',
  name: 'A',
  closed: false,
  visible: true,
  quality: 1,
  start: point(10, 10),
  curves: [
    [point(10, 10), point(15, 30), point(40, 20), point(50, 50)],
    [point(50, 50), point(55, 60), point(65, 60), point(70, 40)],
  ],
};
const legacyB = {
  id: 'b',
  name: 'B',
  closed: false,
  visible: false,
  quality: 0.8,
  start: point(90, 90),
  curves: [
    [point(90, 90), point(100, 130), point(140, 130), point(160, 100)],
    [point(160, 100), point(170, 80), point(180, 70), point(190, 60)],
  ],
};

const toArray = ({ x, y }) => [x, y];
const pathRef = (id, sketchId = 'sketch') => ({
  kind: 'path',
  sketchId,
  id,
});
const action = (firstEnd = 'end', secondEnd = 'start', overrides = {}) => ({
  kind: 'merge-paths',
  firstPathRef: pathRef('a'),
  firstEnd,
  secondPathRef: pathRef('b'),
  secondEnd,
  ...overrides,
});
const source = (id, inputs) => ({
  id,
  type: 'source',
  name: id,
  enabled: true,
  inputs: { paths: inputs },
  params: {},
});
const sketchInput = (pathIds) => ({
  kind: 'sketch',
  sketchId: 'sketch',
  ...(pathIds ? { pathIds } : {}),
});

const addLegacyPath = (sketch, legacy) => {
  const vertexIds = [];
  for (let index = 0; index <= legacy.curves.length; index++) {
    const id = `${legacy.id}-v${index}`;
    vertexIds.push(id);
    sketch.vertices[id] = {
      id,
      position: {
        kind: 'free',
        value: toArray(
          index === 0 ? legacy.curves[0][0] : legacy.curves[index - 1][3],
        ),
      },
    };
  }
  const uses = legacy.curves.map((cubic, index) => {
    const id = `${legacy.id}-e${index}`;
    const start = toArray(cubic[0]);
    const end = toArray(cubic[3]);
    sketch.edges[id] = {
      id,
      startVertexId: vertexIds[index],
      endVertexId: vertexIds[index + 1],
      startHandle: {
        kind: 'free',
        vector: toArray(cubic[1]).map((n, axis) => n - start[axis]),
      },
      endHandle: {
        kind: 'free',
        vector: toArray(cubic[2]).map((n, axis) => n - end[axis]),
      },
    };
    return { edgeId: id, reversed: false };
  });
  sketch.paths[legacy.id] = {
    id: legacy.id,
    name: legacy.name,
    edges: uses,
    handleModes: Object.fromEntries(vertexIds.map((id) => [id, 'smooth'])),
    visible: legacy.visible,
  };
};

const fixture = ({ welded = false } = {}) => {
  const document = createDocument({
    id: 'merge-document',
    idFactory: () => 'merge-initial-part',
  });
  document.nodes.owner = {
    id: 'owner',
    kind: 'shape',
    name: '合并来源',
    parentId: null,
    order: 0,
    pose: { translationMM: [0, 0], rotationRad: 0 },
    visible: true,
    locked: false,
    programId: 'program',
  };
  document.sketches.sketch = {
    id: 'sketch',
    ownerNodeId: 'owner',
    vertices: {},
    edges: {},
    paths: {},
  };
  addLegacyPath(document.sketches.sketch, legacyA);
  addLegacyPath(document.sketches.sketch, legacyB);
  if (welded) {
    document.sketches.sketch.vertices['b-v0'].position.value = [70, 40];
    document.sketches.sketch.edges['b-e0'].startHandle.vector = [10, 40];
  }
  document.programs.program = {
    id: 'program',
    ownerNodeId: 'owner',
    operators: {
      together: source('together', [sketchInput(['a']), sketchInput(['b'])]),
      'second-only': source('second-only', [sketchInput(['b'])]),
      wildcard: source('wildcard', [sketchInput()]),
    },
    outputs: {},
  };
  document.collections.second = {
    id: 'second',
    name: '第二条路径仍是失效软引用',
    origin: 'user',
    members: [pathRef('b')],
  };
  return document;
};

const cubics = (document) => {
  const result = resolveSketch(document, 'sketch');
  assert.equal(result.status, 'ready');
  const curve = result.value.curves.find((item) => item.pathRef.id === 'a');
  return curve.edges.map((edge) => edge.cubic);
};
const expectedCubics = (firstEnd, secondEnd, b = legacyB) =>
  mergeSplines(legacyA, firstEnd, b, secondEnd).path.curves.map((cubic) =>
    cubic.map(toArray),
  );
const execute = (document, request = action(), edgeId = 'bridge') =>
  createPathMergeCommand(request)(structuredClone(document), {
    idFactory: () => edgeId,
  });

assert.deepEqual(PATH_MERGE_ACTIONS, ['merge-paths']);

let orientations = 0;
for (const firstEnd of ['start', 'end'])
  for (const secondEnd of ['start', 'end']) {
    const document = fixture();
    const originalEdges = structuredClone(document.sketches.sketch.edges);
    const result = execute(document, action(firstEnd, secondEnd));
    const sketch = result.document.sketches.sketch;
    assert.deepEqual(
      cubics(result.document),
      expectedCubics(firstEnd, secondEnd),
    );
    assert.equal(sketch.paths.a.id, 'a');
    assert.equal(sketch.paths.a.name, 'A + B');
    assert.equal(sketch.paths.a.visible, true);
    assert.equal(sketch.paths.b, undefined);
    for (const [id, edge] of Object.entries(originalEdges))
      assert.deepEqual(sketch.edges[id], edge, `original Edge ${id} changed`);
    assert.deepEqual(sketch.edges.bridge, {
      id: 'bridge',
      startVertexId:
        firstEnd === 'start' ? 'a-v0' : `a-v${legacyA.curves.length}`,
      endVertexId: secondEnd === 'end' ? `b-v${legacyB.curves.length}` : 'b-v0',
      startHandle: {
        kind: 'free',
        vector: expectedCubics(firstEnd, secondEnd)[2][1].map(
          (n, axis) => n - expectedCubics(firstEnd, secondEnd)[2][0][axis],
        ),
      },
      endHandle: {
        kind: 'free',
        vector: expectedCubics(firstEnd, secondEnd)[2][2].map(
          (n, axis) => n - expectedCubics(firstEnd, secondEnd)[2][3][axis],
        ),
      },
    });
    const expectedFirstUses =
      firstEnd === 'start'
        ? [
            { edgeId: 'a-e1', reversed: true },
            { edgeId: 'a-e0', reversed: true },
          ]
        : [
            { edgeId: 'a-e0', reversed: false },
            { edgeId: 'a-e1', reversed: false },
          ];
    const expectedSecondUses =
      secondEnd === 'end'
        ? [
            { edgeId: 'b-e1', reversed: true },
            { edgeId: 'b-e0', reversed: true },
          ]
        : [
            { edgeId: 'b-e0', reversed: false },
            { edgeId: 'b-e1', reversed: false },
          ];
    assert.deepEqual(sketch.paths.a.edges, [
      ...expectedFirstUses,
      { edgeId: 'bridge', reversed: false },
      ...expectedSecondUses,
    ]);
    assert.equal(
      sketch.paths.a.handleModes[sketch.edges.bridge.startVertexId],
      undefined,
    );
    assert.equal(
      sketch.paths.a.handleModes[sketch.edges.bridge.endVertexId],
      undefined,
    );
    assert.deepEqual(result.changedRefs, [
      pathRef('a'),
      { kind: 'edge', sketchId: 'sketch', id: 'bridge' },
      { kind: 'program', id: 'program' },
    ]);
    assert.deepEqual(result.removedRefs, [pathRef('b')]);
    orientations++;
  }

const weldedLegacyB = structuredClone(legacyB);
weldedLegacyB.start = point(70, 40);
weldedLegacyB.curves[0][0] = point(70, 40);
weldedLegacyB.curves[0][1] = point(80, 80);
const welded = execute(fixture({ welded: true }));
const weldedSketch = welded.document.sketches.sketch;
assert.deepEqual(
  cubics(welded.document),
  expectedCubics('end', 'start', weldedLegacyB),
);
assert.equal(weldedSketch.edges.bridge, undefined);
assert.equal(weldedSketch.edges['b-e0'].startVertexId, 'a-v2');
assert.equal(weldedSketch.vertices['b-v0'], undefined);
assert.deepEqual(welded.removedRefs, [
  pathRef('b'),
  { kind: 'vertex', sketchId: 'sketch', id: 'b-v0' },
]);
assert.deepEqual(welded.changedRefs, [
  pathRef('a'),
  { kind: 'edge', sketchId: 'sketch', id: 'b-e0' },
  { kind: 'program', id: 'program' },
]);

const membership = welded.document.programs.program.operators;
assert.deepEqual(membership.together.inputs.paths, [sketchInput(['a'])]);
assert.deepEqual(
  membership['second-only'].inputs.paths,
  [sketchInput(['b'])],
  'a source that consumed only the removed path remains a repairable reference',
);
assert.deepEqual(membership.wildcard.inputs.paths, [sketchInput()]);
assert.deepEqual(
  welded.document.collections.second.members,
  [pathRef('b')],
  'collections are not rebound to a different path',
);

const undoDocument = fixture();
const editor = createEditorSession(undoDocument, {
  idFactory: () => 'undo-bridge',
});
editor.dispatch(createPathMergeCommand(action()), { expectedRevision: 0 });
assert.equal(editor.state.revision, 1);
assert.equal(editor.state.document.sketches.sketch.paths.b, undefined);
editor.undo({ expectedRevision: 1 });
assert.deepEqual(editor.state.document, undoDocument);

const rejectAtomically = (document, request, pattern) => {
  const session = createEditorSession(document, { idFactory: () => 'unsafe' });
  const before = session.state.document;
  assert.throws(
    () =>
      session.dispatch(createPathMergeCommand(request), {
        expectedRevision: 0,
      }),
    pattern,
  );
  assert.equal(session.state.revision, 0);
  assert.deepEqual(session.state.document, before);
};

const sharedEdge = fixture();
sharedEdge.sketches.sketch.paths.alias = {
  id: 'alias',
  name: '共享',
  edges: [{ edgeId: 'a-e0', reversed: false }],
  visible: true,
};
rejectAtomically(sharedEdge, action(), /被其他 Path alias 共享/);

const externallyUsedWeld = fixture({ welded: true });
externallyUsedWeld.sketches.sketch.vertices.external = {
  id: 'external',
  position: { kind: 'free', value: [100, 40] },
};
externallyUsedWeld.sketches.sketch.edges['external-edge'] = {
  id: 'external-edge',
  startVertexId: 'b-v0',
  endVertexId: 'external',
  startHandle: { kind: 'free', vector: [10, 0] },
  endHandle: { kind: 'free', vector: [-10, 0] },
};
rejectAtomically(
  externallyUsedWeld,
  action(),
  /被其他 Edge external-edge 使用/,
);

const relatedWeld = fixture({ welded: true });
relatedWeld.sketches.sketch.vertices.target = {
  id: 'target',
  position: { kind: 'relation', relationId: 'coincident' },
};
relatedWeld.relations.coincident = {
  id: 'coincident',
  kind: 'coincident',
  target: { kind: 'vertex', sketchId: 'sketch', id: 'target' },
  source: { kind: 'vertex', sketchId: 'sketch', id: 'b-v0' },
  offset: [0, 0],
  frame: { space: 'owner-local', transform: [1, 0, 0, 1, 0, 0] },
};
rejectAtomically(relatedWeld, action(), /被 Relation coincident 使用/);

const driven = fixture();
driven.datums.axis = {
  id: 'axis',
  name: '轴',
  ownerNodeId: 'owner',
  kind: 'axis',
  origin: [0, 0],
  angleRad: 0,
};
driven.relations.driven = {
  id: 'driven',
  kind: 'point-on-axis',
  target: { kind: 'vertex', sketchId: 'sketch', id: 'b-v0' },
  axisId: 'axis',
  distance: 90,
  frame: { space: 'owner-local', transform: [1, 0, 0, 1, 0, 0] },
};
driven.sketches.sketch.vertices['b-v0'].position = {
  kind: 'relation',
  relationId: 'driven',
};
rejectAtomically(driven, action(), /Relation 驱动的 Vertex/);

const locked = fixture();
locked.nodes.owner.locked = true;
rejectAtomically(locked, action(), /锁定/);

const crossSketch = fixture();
crossSketch.sketches.other = {
  id: 'other',
  ownerNodeId: 'owner',
  vertices: {},
  edges: {},
  paths: {},
};
for (const [table, ids] of Object.entries({
  vertices: ['b-v0', 'b-v1', 'b-v2'],
  edges: ['b-e0', 'b-e1'],
  paths: ['b'],
}))
  for (const id of ids) {
    crossSketch.sketches.other[table][id] =
      crossSketch.sketches.sketch[table][id];
    delete crossSketch.sketches.sketch[table][id];
  }
crossSketch.programs.program.operators.together.inputs.paths = [
  sketchInput(['a']),
  { kind: 'sketch', sketchId: 'other', pathIds: ['b'] },
];
crossSketch.programs.program.operators['second-only'].inputs.paths = [
  { kind: 'sketch', sketchId: 'other', pathIds: ['b'] },
];
rejectAtomically(
  crossSketch,
  action('end', 'start', { secondPathRef: pathRef('b', 'other') }),
  /跨 Sketch.*转移源路径/,
);

const crossOwner = structuredClone(crossSketch);
crossOwner.nodes.otherOwner = {
  id: 'otherOwner',
  kind: 'shape',
  name: '另一所有者',
  parentId: null,
  order: 1,
  pose: { translationMM: [0, 0], rotationRad: 0 },
  visible: true,
  locked: false,
  programId: 'otherProgram',
};
crossOwner.programs.otherProgram = {
  id: 'otherProgram',
  ownerNodeId: 'otherOwner',
  operators: {
    otherSource: source('otherSource', [
      { kind: 'sketch', sketchId: 'other', pathIds: ['b'] },
    ]),
  },
  outputs: {},
};
crossOwner.sketches.other.ownerNodeId = 'otherOwner';
crossOwner.programs.program.operators.together.inputs.paths = [
  sketchInput(['a']),
];
crossOwner.programs.program.operators['second-only'].inputs.paths = [];
rejectAtomically(
  crossOwner,
  action('end', 'start', { secondPathRef: pathRef('b', 'other') }),
  /跨 owner.*转移源路径/,
);

const closed = fixture();
closed.sketches.sketch.edges['a-e1'].endVertexId = 'a-v0';
rejectAtomically(closed, action(), /已闭合/);
const empty = fixture();
empty.sketches.sketch.paths.a.edges = [];
empty.sketches.sketch.paths.a.startVertexId = 'a-v0';
delete empty.sketches.sketch.paths.a.handleModes['a-v1'];
delete empty.sketches.sketch.paths.a.handleModes['a-v2'];
rejectAtomically(empty, action(), /至少含一条 Edge/);

assert.throws(
  () => execute(fixture(), action('end', 'start', { extra: true })),
  /未声明字段/,
);
assert.throws(() => execute(fixture(), action('middle', 'start')), /firstEnd/);
assert.throws(
  () => execute(fixture(), action('end', 'start'), 'a-e0'),
  /未占用/,
);

console.log(
  `PASS merge-paths matches legacy cubics for ${orientations} endpoint orientations, welds safely, preserves soft consumers, rejects unsafe topology atomically, and undoes once`,
);
