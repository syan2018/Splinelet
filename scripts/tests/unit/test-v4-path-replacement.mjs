import assert from 'node:assert/strict';
import {
  createDocument,
  inspectDocumentReferences,
} from '../../../src/lib/document/schema.mjs';
import { createEditorSession } from '../../../src/lib/editing/dispatcher.mjs';
import { createAuthoringCommand } from '../../../src/lib/editing/commands/authoring.mjs';
import { createPathReplacementCommand } from '../../../src/lib/editing/commands/path-replacement.mjs';
import { createPathIntent } from '../../../src/lib/editor/path-intents.mjs';
import { resolveRelation } from '../../../src/lib/geometry/relations.mjs';
import {
  projectSourceView,
  sourceViewToWorld,
} from '../../../src/lib/editor/source-view.mjs';

let serial = 0;
const idFactory = () => `replace-${++serial}`;
const editor = createEditorSession(createDocument({ version: 4, idFactory }), {
  idFactory,
});
const dispatch = (command) =>
  editor.dispatch(command, { expectedRevision: editor.state.revision });
dispatch(
  createAuthoringCommand({
    kind: 'draw-path',
    points: [
      [0, 0],
      [8, 2],
      [12, 9],
    ],
    closed: false,
  }),
);
const sketchId = Object.keys(editor.state.document.sketches)[0];
const pathId = Object.keys(editor.state.document.sketches[sketchId].paths)[0];
const target = { kind: 'path', sketchId, id: pathId };
dispatch((document) => {
  document.nodes[document.sketches[sketchId].ownerNodeId].pose = {
    translationMM: [7.21, -2.97],
    rotationRad: 0.673,
  };
  return { document };
});
dispatch(createAuthoringCommand({ kind: 'reverse-path', sketchId, pathId }));
const before = editor.state.document;
const source = before.sketches[sketchId];
const frame = { width: 931, height: 673, widthMM: 123.4 };
const worldCurves = (document) => {
  const view = projectSourceView(document, frame);
  return view.paths[0].curves.map((c) =>
    c.map((p) => sourceViewToWorld(view.frame, p)),
  );
};
const cubics = worldCurves(before).map((c) =>
  c.map(([x, y], i) => [x + 4 + (i === 1 ? 2 : 0), y - 3]),
);
const action = {
  kind: 'replace-path-geometry',
  pathRef: target,
  expectedEdges: source.paths[pathId].edges,
  cubics,
  closed: false,
  handleModes: ['corner', 'smooth', 'corner'],
};
const close = (actual, expected) =>
  actual.forEach((c, i) =>
    c.forEach((p, j) =>
      p.forEach((v, k) => assert.ok(Math.abs(v - expected[i][j][k]) < 1e-9)),
    ),
  );
const revision = editor.state.revision;
dispatch(createAuthoringCommand(action));
assert.equal(editor.state.revision, revision + 1);
close(worldCurves(editor.state.document), cubics);
assert.deepEqual(
  Object.keys(editor.state.document.sketches[sketchId].vertices),
  Object.keys(source.vertices),
);
assert.deepEqual(
  editor.state.document.sketches[sketchId].paths[pathId].edges,
  source.paths[pathId].edges,
);
assert.deepEqual(editor.state.document.programs, before.programs);
assert.deepEqual(editor.state.document.nodes, before.nodes);
editor.undo({ expectedRevision: editor.state.revision });
assert.deepEqual(editor.state.document, before);

// Closing the existing open path keeps its published identity and all consumers,
// while replacing internal topology with fresh IDs.
const closedCubics = [
  ...cubics,
  [cubics.at(-1)[3], cubics.at(-1)[3], cubics[0][0], cubics[0][0]],
];
const closedAction = {
  ...action,
  cubics: closedCubics,
  closed: true,
  handleModes: ['corner', 'corner', 'corner'],
};
const replaced = createPathReplacementCommand(closedAction)(before, {
  idFactory,
});
const newSketch = replaced.document.sketches[sketchId];
assert.equal(newSketch.paths[pathId].id, pathId);
assert.equal(replaced.removedRefs.length, 5);
assert.ok(Object.keys(newSketch.vertices).every((id) => !source.vertices[id]));
assert.ok(Object.keys(newSketch.edges).every((id) => !source.edges[id]));
assert.deepEqual(replaced.document.programs, before.programs);
close(worldCurves(replaced.document), closedCubics);
dispatch(createAuthoringCommand(closedAction));
editor.undo({ expectedRevision: editor.state.revision });
assert.deepEqual(editor.state.document, before);

// A mixed batch is a single history transaction and rolls back entirely if any
// later command fails, including after the first path has changed topology.
assert.throws(
  () =>
    dispatch((document, context) => {
      const result = createPathReplacementCommand(closedAction)(
        document,
        context,
      );
      return createPathReplacementCommand(action)(result.document, context);
    }),
  /拓扑已变化/,
);
assert.deepEqual(editor.state.document, before);

const reject = (changed, request, pattern) => {
  const snapshot = structuredClone(changed);
  assert.throws(
    () => createPathReplacementCommand(request)(changed, { idFactory }),
    pattern,
  );
  assert.deepEqual(changed, snapshot);
};
reject(before, { ...action, expectedEdges: [] }, /拓扑/);
reject(before, { ...action, closed: true }, /接缝/);
reject(
  before,
  {
    ...action,
    cubics: [
      [
        [0, 0],
        [NaN, 0],
        [0, 0],
        [0, 0],
      ],
    ],
  },
  /有限/,
);
reject(before, { ...action, handleModes: [] }, /逐节点/);
reject(before, { ...action, unexpected: true }, /无效/);
const locked = structuredClone(before);
locked.nodes[source.ownerNodeId].locked = true;
reject(locked, action, /锁定/);
const driven = structuredClone(before);
driven.sketches[sketchId].vertices[Object.keys(source.vertices)[0]].position = {
  kind: 'relation',
  relationId: 'missing-relation',
};
reject(driven, action, /Relation/);
const shared = structuredClone(before);
shared.sketches[sketchId].paths.other = {
  ...structuredClone(source.paths[pathId]),
  id: 'other',
};
reject(shared, action, /共享/);
const snapshot = structuredClone(before);
assert.throws(
  () =>
    createPathReplacementCommand(closedAction)(before, {
      idFactory: () => pathId,
    }),
  /重复/,
);
assert.deepEqual(before, snapshot);

const captured = {
  ...editor.state,
  source: projectSourceView(editor.state.document, frame),
};
const displayed = captured.source.paths[0];
const pixels = displayed.curves.map((c) =>
  c.map((p) => ({ x: p.x + 5, y: p.y - 2 })),
);
const intent = createPathIntent(
  {
    kind: 'replace-path-geometry',
    pathId: displayed.id,
    pixelCubics: pixels,
    closed: false,
  },
  captured,
);
dispatch(intent);
const afterIntent = projectSourceView(editor.state.document, frame).paths[0];
afterIntent.curves.forEach((c, i) =>
  c.forEach((p, j) => {
    assert.ok(Math.abs(p.x - pixels[i][j].x) < 1e-8);
    assert.ok(Math.abs(p.y - pixels[i][j].y) < 1e-8);
  }),
);
assert.throws(() => dispatch(intent), /失效/);
editor.undo({ expectedRevision: editor.state.revision });
assert.deepEqual(editor.state.document, before);

const opened = createPathReplacementCommand({
  ...action,
  expectedEdges: newSketch.paths[pathId].edges,
  cubics: cubics.slice(0, 1),
  handleModes: ['corner', 'corner'],
})(replaced.document, { idFactory });
assert.equal(opened.document.sketches[sketchId].paths[pathId].edges.length, 1);
assert.equal(projectSourceView(opened.document, frame).paths[0].closed, false);
close(worldCurves(opened.document), cubics.slice(0, 1));

const single = structuredClone(before),
  singleSketch = single.sketches[sketchId];
singleSketch.paths[pathId].edges = [];
singleSketch.paths[pathId].startVertexId = Object.keys(
  singleSketch.vertices,
)[0];
singleSketch.edges = {};
const fromSingle = createPathReplacementCommand({
  ...action,
  expectedEdges: [],
})(single, { idFactory });
assert.equal(
  fromSingle.document.sketches[sketchId].paths[pathId].startVertexId,
  undefined,
);
close(worldCurves(fromSingle.document), cubics);

const consumers = structuredClone(before),
  consumerSketch = consumers.sketches[sketchId];
consumers.relations.dependency = {
  id: 'dependency',
  kind: 'coincident',
  target: { kind: 'vertex', sketchId, id: 'consumer' },
  source: { kind: 'vertex', sketchId, id: Object.keys(source.vertices)[0] },
  offset: [0, 0],
  frame: { space: 'owner-local', transform: [1, 0, 0, 1, 0, 0] },
};
consumerSketch.vertices.consumer = {
  id: 'consumer',
  position: { kind: 'relation', relationId: 'dependency' },
};
assert.equal(inspectDocumentReferences(consumers).length, 0);
const consumedReplacement = createPathReplacementCommand(closedAction)(
  consumers,
  { idFactory },
);
assert.deepEqual(consumedReplacement.document.relations, consumers.relations);
assert.equal(
  resolveRelation({
    document: consumedReplacement.document,
    sketch: consumedReplacement.document.sketches[sketchId],
    target: consumers.relations.dependency.target,
    relationId: 'dependency',
  }).status,
  'blocked',
);
assert.deepEqual(
  consumedReplacement.document.sketches[sketchId].vertices.consumer,
  consumerSketch.vertices.consumer,
);
const drivenHandle = structuredClone(before);
drivenHandle.sketches[sketchId].edges[
  source.paths[pathId].edges[0].edgeId
].startHandle = { kind: 'relation', relationId: 'missing-handle-relation' };
reject(drivenHandle, action, /Relation 驱动的 Handle/);
console.log(
  'PASS exact path replacement preserves world cubics, reversed identities, Path consumers and one undo; topology renewal and guarded failures are atomic',
);
