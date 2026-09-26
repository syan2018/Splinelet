import assert from 'node:assert/strict';
import { createDocument } from '../../../src/lib/document/schema.mjs';
import { createEditorSession } from '../../../src/lib/editing/dispatcher.mjs';
import { createAuthoringCommand } from '../../../src/lib/editing/commands/authoring.mjs';
import { createPathIntent } from '../../../src/lib/editor/path-intents.mjs';
import { projectSourceView } from '../../../src/lib/editor/source-view.mjs';
import { deleteNodes } from '../../../src/lib/source-editor/selection.mjs';
import { mergeSplines } from '../../../src/lib/source-editor/connect.mjs';
import { evaluateProgram } from '../../../src/lib/construction/document-evaluation.mjs';

let serial = 0;
const idFactory = () => `node-merge-${++serial}`;
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
      [8, 5],
      [12, 9],
    ],
    cubics: [
      [
        [0, 0],
        [1, 4],
        [4, 7],
        [8, 5],
      ],
      [
        [8, 5],
        [9, 4],
        [13, 7],
        [12, 9],
      ],
    ],
    closed: false,
  }),
);
const sketchId = Object.keys(editor.state.document.sketches)[0];
const pathId = Object.keys(editor.state.document.sketches[sketchId].paths)[0];
dispatch((document) => {
  document.nodes[document.sketches[sketchId].ownerNodeId].pose = {
    translationMM: [2.5, -4],
    rotationRad: 0.376,
  };
  return { document };
});
const frame = { width: 900, height: 600, widthMM: 120 };
const view = () => ({
  ...editor.state,
  source: projectSourceView(editor.state.document, frame),
});
const compareCurves = (actual, expected) => {
  assert.equal(actual.length, expected.length);
  actual.forEach((cubic, i) =>
    cubic.forEach((point, j) => {
      assert.ok(
        Math.abs(point.x - expected[i][j].x) < 1e-5,
        `${point.x} != ${expected[i][j].x}`,
      );
      assert.ok(Math.abs(point.y - expected[i][j].y) < 1e-5);
    }),
  );
};
let captured = view();
const shown = captured.source.paths[0],
  before = editor.state.document;
const expected = deleteNodes(shown, [1], 1.5);
const deletion = createPathIntent(
  {
    kind: 'delete-path-vertices',
    pathId: shown.id,
    anchorIdentityIds: [shown.identity.anchorIds[1]],
    tolerancePixels: 1.5,
  },
  captured,
);
dispatch(deletion);
compareCurves(view().source.paths[0].curves, expected.curves);
assert.deepEqual(view().source.paths[0].identity.anchorIds, [
  shown.identity.anchorIds[0],
  shown.identity.anchorIds[2],
]);
assert.throws(() => dispatch(deletion), /失效/);
editor.undo({ expectedRevision: editor.state.revision });
assert.deepEqual(editor.state.document, before);
dispatch((document) => {
  const sketch = document.sketches[sketchId];
  sketch.vertices['second-a'] = {
    id: 'second-a',
    position: { kind: 'free', value: [20, 9] },
  };
  sketch.vertices['second-b'] = {
    id: 'second-b',
    position: { kind: 'free', value: [25, 12] },
  };
  sketch.edges['second-edge'] = {
    id: 'second-edge',
    startVertexId: 'second-a',
    endVertexId: 'second-b',
    startHandle: { kind: 'free', vector: [2, 1] },
    endHandle: { kind: 'free', vector: [-1, 2] },
  };
  sketch.paths.second = {
    id: 'second',
    name: '第二条',
    visible: true,
    edges: [{ edgeId: 'second-edge', reversed: false }],
  };
  const program =
    document.programs[document.nodes[sketch.ownerNodeId].programId];
  program.operators[
    program.outputs.curves.operatorId
  ].inputs.paths[0].pathIds.push('second');
  return { document };
});
captured = view();
const first = captured.source.paths.find(
  (p) => captured.source.identities.byId[p.id].id === pathId,
);
const second = captured.source.paths.find(
  (p) => captured.source.identities.byId[p.id].id === 'second',
);
const expectedMerge = mergeSplines(first, 'end', second, 'start');
const beforeMerge = editor.state.document;
dispatch(
  createPathIntent(
    {
      kind: 'merge-paths',
      firstPathId: first.id,
      firstEnd: 'end',
      secondPathId: second.id,
      secondEnd: 'start',
    },
    captured,
  ),
);
assert.equal(view().source.paths.length, 1);
assert.equal(view().source.paths[0].id, first.id);
assert.equal(view().source.paths[0].name, expectedMerge.path.name);
compareCurves(view().source.paths[0].curves, expectedMerge.path.curves);
editor.undo({ expectedRevision: editor.state.revision });
assert.deepEqual(editor.state.document, beforeMerge);
const drawing = createEditorSession(createDocument({ version: 4, idFactory }), {
  idFactory,
});
const run = (action) =>
  drawing.dispatch(createAuthoringCommand(action), {
    expectedRevision: drawing.state.revision,
  });
run({
  kind: 'draw-path',
  name: '第一条',
  points: [
    [0, 0],
    [5, 0],
  ],
  closed: false,
});
const ownerNodeId = Object.keys(drawing.state.document.nodes)[0];
run({
  kind: 'draw-path',
  ownerNodeId,
  name: '第二条',
  points: [
    [6, 0],
    [10, 3],
  ],
  closed: false,
});
const drawingView = {
  ...drawing.state,
  source: projectSourceView(drawing.state.document, frame),
};
const firstDrawn = drawingView.source.paths.find((p) => p.name === '第一条');
const secondDrawn = drawingView.source.paths.find((p) => p.name === '第二条');
assert.notEqual(firstDrawn.sketchId, secondDrawn.sketchId);
const drawingBefore = drawing.state.document;
drawing.dispatch(
  createPathIntent(
    {
      kind: 'merge-paths',
      firstPathId: firstDrawn.id,
      secondPathId: secondDrawn.id,
      firstEnd: 'end',
      secondEnd: 'start',
    },
    drawingView,
  ),
  { expectedRevision: drawing.state.revision },
);
const drawn = projectSourceView(drawing.state.document, frame);
assert.equal(drawn.paths.length, 1);
assert.equal(drawn.paths[0].id, firstDrawn.id);
compareCurves(
  drawn.paths[0].curves,
  mergeSplines(firstDrawn, 'end', secondDrawn, 'start').path.curves,
);
assert.equal(
  evaluateProgram(drawing.state.document, ownerNodeId).curves.status,
  'ready',
);
drawing.undo({ expectedRevision: drawing.state.revision });
assert.deepEqual(
  drawing.state.document,
  drawingBefore,
  'cross-Sketch source transfer and merge are one undo',
);
console.log(
  'PASS pixel node deletion and path merge intents match original geometry, preserve source identities, reject stale views and undo once',
);
