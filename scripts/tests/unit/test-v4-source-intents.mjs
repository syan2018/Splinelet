import assert from 'node:assert/strict';
import { createDocument } from '../../../src/lib/document/schema.mjs';
import { createEditorSession } from '../../../src/lib/editing/dispatcher.mjs';
import { createAuthoringCommand } from '../../../src/lib/editing/commands/authoring.mjs';
import { createSourceCommand } from '../../../src/lib/editing/commands/source.mjs';
import { projectSourceView } from '../../../src/lib/editor/source-view.mjs';
import { createSourceIntent } from '../../../src/lib/editor/source-intents.mjs';

let sequence = 0;
const idFactory = () => `source-intent-${++sequence}`;
const editor = createEditorSession(createDocument({ idFactory }), {
  idFactory,
});
const dispatch = (command) =>
  editor.dispatch(command, { expectedRevision: editor.state.revision });
dispatch(
  createAuthoringCommand({
    kind: 'draw-path',
    closed: true,
    points: [
      [0, 0],
      [8, 0],
      [8, 6],
      [0, 6],
    ],
  }),
);
const nodeId = Object.keys(editor.state.document.nodes)[0];
dispatch((document) => {
  document.nodes[nodeId].pose = {
    translationMM: [11, 7],
    rotationRad: Math.PI / 2,
  };
  return { document };
});
const frame = { width: 800, height: 600, widthMM: 100 };
const view = () => ({
  ...editor.state,
  source: projectSourceView(editor.state.document, frame),
});
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);
const original = editor.state.document;
const captured = view(),
  path = captured.source.paths[0];
const gesture = editor.beginPreview({ expectedRevision: captured.revision });
for (const offset of [16, 40]) {
  editor.updatePreview(
    createSourceIntent(
      {
        kind: 'move-anchor',
        identityId: path.identity.anchorIds[0],
        pixelPoint: { x: path.start.x + offset, y: path.start.y },
      },
      captured,
    ),
    { expectedRevision: captured.revision, previewId: gesture.previewId },
  );
}
assert.deepEqual(
  editor.state.document,
  original,
  'drag samples never write the committed source',
);
editor.commitPreview({
  expectedRevision: captured.revision,
  previewId: gesture.previewId,
});
let current = view();
close(current.source.paths[0].start.x, path.start.x + 40);
close(current.source.paths[0].start.y, path.start.y);
const anchorRef = captured.source.identities.byId[path.identity.anchorIds[0]];
const moved =
  editor.state.document.sketches[anchorRef.sketchId].vertices[anchorRef.id]
    .position.value;
close(moved[0], 0);
close(moved[1], -5);
assert.throws(
  () =>
    dispatch(
      createSourceIntent(
        {
          kind: 'move-anchor',
          identityId: path.identity.anchorIds[0],
          pixelPoint: path.start,
        },
        captured,
      ),
    ),
  /已失效/,
);
editor.undo({ expectedRevision: editor.state.revision });
assert.deepEqual(
  editor.state.document,
  original,
  'one undo restores the complete drag',
);

current = view();
let shown = current.source.paths[0];
const control = { x: shown.curves[0][1].x + 24, y: shown.curves[0][1].y - 16 };
dispatch(
  createSourceIntent(
    {
      kind: 'move-handle',
      identityId: shown.identity.handleIds[0][0],
      pixelPoint: control,
    },
    current,
  ),
);
current = view();
close(current.source.paths[0].curves[0][1].x, control.x);
close(current.source.paths[0].curves[0][1].y, control.y);
assert.deepEqual(
  current.source.paths[0].anchors,
  shown.anchors,
  'handle move leaves anchors unchanged',
);

const pathRef = current.source.identities.byId[shown.identity.pathId];
shown = current.source.paths[0];
dispatch(
  createSourceIntent(
    {
      kind: 'move-handle',
      pathId: shown.id,
      identityId: shown.identity.handleIds[0][1],
      pixelPoint: { x: shown.anchors[1].x - 16, y: shown.anchors[1].y + 8 },
    },
    current,
  ),
);
current = view();
dispatch(
  createSourceIntent(
    {
      kind: 'set-handle-mode',
      pathId: shown.id,
      identityId: shown.identity.anchorIds[1],
      mode: 'smooth',
    },
    current,
  ),
);
current = view();
shown = current.source.paths[0];
assert.equal(shown.nodeModes[1], 'smooth');
for (const [curveIndex, pointIndex, oppositeCurve, oppositePoint] of [
  [1, 1, 0, 2],
  [0, 2, 1, 1],
]) {
  current = view();
  shown = current.source.paths[0];
  const anchor = shown.anchors[1],
    previousOpposite = shown.curves[oppositeCurve][oppositePoint];
  const length = Math.hypot(
    previousOpposite.x - anchor.x,
    previousOpposite.y - anchor.y,
  );
  const pixelPoint = { x: anchor.x + 19, y: anchor.y + 31 };
  dispatch(
    createSourceIntent(
      {
        kind: 'move-handle',
        pathId: shown.id,
        identityId: shown.identity.handleIds[curveIndex][pointIndex - 1],
        pixelPoint,
      },
      current,
    ),
  );
  const after = view().source.paths[0];
  const opposite = after.curves[oppositeCurve][oppositePoint];
  close(Math.hypot(opposite.x - anchor.x, opposite.y - anchor.y), length);
  close((opposite.x - anchor.x) * 31 - (opposite.y - anchor.y) * 19, 0);
  assert.ok((opposite.x - anchor.x) * 19 + (opposite.y - anchor.y) * 31 < 0);
}
dispatch(
  createSourceCommand({
    kind: 'reverse-path',
    sketchId: pathRef.sketchId,
    pathId: pathRef.id,
  }),
);
current = view();
shown = current.source.paths[0];
const cubic = shown.curves[0];
const t = 0.25,
  u = 1 - t;
const expected = ['x', 'y'].map(
  (axis) =>
    u ** 3 * cubic[0][axis] +
    3 * u ** 2 * t * cubic[1][axis] +
    3 * u * t ** 2 * cubic[2][axis] +
    t ** 3 * cubic[3][axis],
);
dispatch(
  createSourceIntent(
    {
      kind: 'split-span',
      pathId: shown.id,
      identityId: shown.identity.edgeIds[0],
      t,
    },
    current,
  ),
);
const split = view().source.paths[0];
assert.equal(split.curves.length, shown.curves.length + 1);
close(split.curves[0][3].x, expected[0]);
close(split.curves[0][3].y, expected[1]);
assert.equal(split.identity.anchorIds[0], shown.identity.anchorIds[0]);
current = view();
assert.throws(
  () =>
    createSourceIntent(
      { kind: 'move-anchor', identityId: 'unknown', pixelPoint: control },
      current,
    ),
  /失效/,
);
dispatch(
  createAuthoringCommand({ kind: 'set-node', nodeId, value: { locked: true } }),
);
const locked = view();
assert.throws(
  () =>
    dispatch(
      createSourceIntent(
        {
          kind: 'move-anchor',
          identityId: locked.source.paths[0].identity.anchorIds[0],
          pixelPoint: control,
        },
        locked,
      ),
    ),
  /锁定/,
);
console.log(
  'PASS original source intents preserve pixel/world/local frames, stable reversed spans, preview history and locks',
);
