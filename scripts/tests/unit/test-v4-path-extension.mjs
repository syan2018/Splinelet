import assert from 'node:assert/strict';
import { createDocument } from '../../../src/lib/document/schema.mjs';
import { createEditorSession } from '../../../src/lib/editing/dispatcher.mjs';
import { createAuthoringCommand } from '../../../src/lib/editing/commands/authoring.mjs';
import { resolveSketch } from '../../../src/lib/geometry/sketch.mjs';
import {
  transformPoint,
  worldMatrix,
} from '../../../src/lib/scene/transforms.mjs';
import { evaluateProgram } from '../../../src/lib/construction/document-evaluation.mjs';
import { projectSourceView } from '../../../src/lib/editor/source-view.mjs';
import { createPathIntent } from '../../../src/lib/editor/path-intents.mjs';

let sequence = 0;
const idFactory = () => `extension-${++sequence}`;
for (const reverse of [false, true]) {
  const editor = createEditorSession(createDocument({ idFactory }), {
    idFactory,
  });
  const run = (action) =>
    editor.dispatch(createAuthoringCommand(action), {
      expectedRevision: editor.state.revision,
    });
  run({
    kind: 'draw-path',
    points: [
      [0, 0],
      [10, 0],
      [10, 10],
    ],
    closed: false,
  });
  const sketchId = Object.keys(editor.state.document.sketches)[0];
  const sketch = () => editor.state.document.sketches[sketchId];
  const pathId = Object.keys(sketch().paths)[0];
  const owner = sketch().ownerNodeId;
  editor.dispatch(
    (document) => {
      document.nodes[owner].pose = {
        translationMM: [15, -8],
        rotationRad: Math.PI / 3,
      };
      return { document };
    },
    { expectedRevision: editor.state.revision },
  );
  if (reverse) run({ kind: 'reverse-path', sketchId, pathId });
  const world = (local) =>
    transformPoint(worldMatrix(editor.state.document, owner), local);
  const curve = () =>
    resolveSketch(editor.state.document, sketchId).value.curves[0];
  const closeEnough = (actual, expected) =>
    actual.forEach((point, i) =>
      point.forEach((n, j) => assert.ok(Math.abs(n - expected[i][j]) < 1e-8)),
    );
  for (const end of ['start', 'end']) {
    const before = editor.state.document;
    const beforeEdges = structuredClone(sketch().edges);
    const current = curve();
    const from =
      end === 'start'
        ? current.edges[0].cubic[0]
        : current.edges.at(-1).cubic[3];
    const local = [
      from,
      [from[0] + 2, from[1] + 3],
      [from[0] + 4, from[1] + 3],
      [from[0] + 6, from[1] + 1],
    ];
    run({
      kind: 'extend-path',
      sketchId,
      pathId,
      end,
      cubic: local.map(world),
    });
    const next = curve();
    assert.equal(next.edges.length, current.edges.length + 1);
    for (const [id, edge] of Object.entries(beforeEdges))
      assert.deepEqual(sketch().edges[id], edge);
    closeEnough(
      (end === 'start' ? next.edges[0] : next.edges.at(-1)).cubic,
      end === 'start' ? local.slice().reverse() : local,
    );
    editor.undo({ expectedRevision: editor.state.revision });
    assert.deepEqual(
      editor.state.document,
      before,
      'one extension is one undo',
    );
  }
  for (const end of ['start', 'end']) {
    const before = editor.state.document;
    const current = curve();
    const start = current.edges[0].cubic[0],
      last = current.edges.at(-1).cubic[3];
    const from = end === 'start' ? start : last,
      to = end === 'start' ? last : start;
    const local = [
      from,
      [from[0] - 3, from[1] + 2],
      [to[0] - 2, to[1] + 1],
      to,
    ];
    run({ kind: 'close-path', sketchId, pathId, end, cubic: local.map(world) });
    assert.equal(curve().closed, true);
    closeEnough(
      curve().edges.at(-1).cubic,
      end === 'start' ? local.slice().reverse() : local,
    );
    assert.equal(
      evaluateProgram(editor.state.document, owner).regions.status,
      'ready',
    );
    editor.undo({ expectedRevision: editor.state.revision });
    assert.deepEqual(
      editor.state.document,
      before,
      'closure and Fill membership undo together',
    );
  }
  const beforeFailure = editor.state.document;
  assert.throws(
    () =>
      run({
        kind: 'extend-path',
        sketchId,
        pathId,
        cubic: [
          [999, 999],
          [0, 0],
          [1, 1],
          [2, 2],
        ],
      }),
    /端点/,
  );
  assert.deepEqual(editor.state.document, beforeFailure);
  run({ kind: 'set-node', nodeId: owner, value: { locked: true } });
  const locked = editor.state.document;
  assert.throws(
    () =>
      run({
        kind: 'extend-path',
        sketchId,
        pathId,
        cubic: [
          [0, 0],
          [0, 0],
          [1, 1],
          [1, 1],
        ],
      }),
    /锁定/,
  );
  assert.deepEqual(editor.state.document, locked);
}
const editor = createEditorSession(createDocument({ idFactory }), {
  idFactory,
});
const dispatch = (command) =>
  editor.dispatch(command, { expectedRevision: editor.state.revision });
dispatch(
  createAuthoringCommand({
    kind: 'draw-path',
    points: [
      [0, 0],
      [10, 0],
    ],
    closed: false,
  }),
);
const frame = { width: 800, height: 600, widthMM: 100 };
const view = () => ({
  ...editor.state,
  source: projectSourceView(editor.state.document, frame),
});
let captured = view();
const displayedPath = captured.source.paths[0];
const endpoint = displayedPath.curves.at(-1)[3];
const pixelCubic = [
  endpoint,
  { x: endpoint.x + 10, y: endpoint.y - 20 },
  { x: endpoint.x + 20, y: endpoint.y - 20 },
  { x: endpoint.x + 30, y: endpoint.y },
];
const extension = createPathIntent(
  { kind: 'extend-path', pathId: displayedPath.id, end: 'end', pixelCubic },
  captured,
);
dispatch(extension);
view()
  .source.paths[0].curves.at(-1)
  .forEach((point, i) => {
    assert.ok(Math.abs(point.x - pixelCubic[i].x) < 1e-8);
    assert.ok(Math.abs(point.y - pixelCubic[i].y) < 1e-8);
  });
assert.throws(
  () => dispatch(extension),
  /失效/,
  'late fitting cannot overwrite a newer edit',
);
captured = view();
dispatch(
  createPathIntent(
    {
      kind: 'set-paths',
      pathIds: [displayedPath.id],
      value: { name: '续画线', visible: false },
    },
    captured,
  ),
);
assert.equal(view().source.paths[0].name, '续画线');
assert.equal(view().source.paths[0].visible, false);
editor.undo({ expectedRevision: editor.state.revision });
assert.equal(view().source.paths[0].visible, true);
assert.throws(
  () => createPathIntent({ kind: 'extend-path', pathId: 'missing' }, view()),
  /失效/,
);
console.log(
  'PASS exact head/tail extension and fitted closure preserve old edges, reversed uses, world frames, atomic history and locks',
);
