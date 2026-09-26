import assert from 'node:assert/strict';
import { createDocument } from '../../../src/lib/document/schema.mjs';
import { createEditorSession } from '../../../src/lib/editing/dispatcher.mjs';
import { createAuthoringCommand } from '../../../src/lib/editing/commands/authoring.mjs';
import { createPathIntent } from '../../../src/lib/editor/path-intents.mjs';
import { createSourceIntent } from '../../../src/lib/editor/source-intents.mjs';
import { projectSourceView } from '../../../src/lib/editor/source-view.mjs';
import { evaluateProgram } from '../../../src/lib/construction/document-evaluation.mjs';
import {
  encodeDocument,
  decodeDocument,
} from '../../../src/lib/document/codec.mjs';

let serial = 0;
const idFactory = () => `start-${++serial}`;
const frame = { width: 800, height: 600, widthMM: 100 };
for (const end of ['start', 'end']) {
  const editor = createEditorSession(
    createDocument({ version: 4, idFactory }),
    {
      idFactory,
    },
  );
  const dispatch = (command) =>
    editor.dispatch(command, { expectedRevision: editor.state.revision });
  const view = () => ({
    ...editor.state,
    source: projectSourceView(editor.state.document, frame),
  });
  dispatch(createAuthoringCommand({ kind: 'create-shape' }));
  const ownerNodeId = Object.keys(editor.state.document.nodes)[0];
  dispatch((document) => {
    document.nodes[ownerNodeId].pose = {
      translationMM: [9, 5],
      rotationRad: Math.PI / 3,
    };
    return { document };
  });
  const before = editor.state.document;
  dispatch(
    createPathIntent(
      {
        kind: 'start-path',
        ownerNodeId,
        name: '新线',
        pixelPoint: { x: 441, y: 312 },
      },
      view(),
    ),
  );
  const first = editor.state.document;
  let projected = view().source.paths[0];
  const stablePathId = projected.id,
    stableAnchorId = projected.identity.anchorIds[0];
  assert.equal(projected.closed, false);
  assert.equal(projected.curves.length, 0);
  assert.equal(projected.anchors.length, 1);
  assert.equal(projected.name, '新线');
  assert.ok(Math.abs(projected.start.x - 441) < 1e-8);
  assert.ok(Math.abs(projected.start.y - 312) < 1e-8);
  const sketchId = projected.sketchId;
  const sketch = () => editor.state.document.sketches[sketchId];
  assert.equal(Object.keys(sketch().vertices).length, 1);
  assert.equal(Object.keys(sketch().edges).length, 0);
  assert.equal(
    evaluateProgram(editor.state.document, ownerNodeId).curves.status,
    'empty',
  );
  assert.deepEqual(decodeDocument(encodeDocument(first)).document, first);
  editor.undo({ expectedRevision: editor.state.revision });
  assert.deepEqual(
    editor.state.document,
    before,
    'first click is independently undoable',
  );
  editor.redo({ expectedRevision: editor.state.revision });
  assert.deepEqual(editor.state.document, first);
  dispatch(
    createSourceIntent(
      {
        kind: 'move-anchor',
        identityId: stableAnchorId,
        pixelPoint: { x: 450, y: 320 },
      },
      view(),
    ),
  );
  projected = view().source.paths[0];
  const singlePoint = editor.state.document;
  dispatch(
    createSourceIntent(
      {
        kind: 'set-handle-mode',
        pathId: stablePathId,
        identityId: stableAnchorId,
        mode: 'corner',
      },
      view(),
    ),
  );
  assert.deepEqual(editor.state.document, singlePoint);
  assert.throws(
    () =>
      dispatch(
        createSourceIntent(
          {
            kind: 'set-handle-mode',
            pathId: stablePathId,
            identityId: stableAnchorId,
            mode: 'smooth',
          },
          view(),
        ),
      ),
    /两侧/,
  );
  assert.throws(
    () =>
      dispatch(
        createPathIntent({ kind: 'close-path', pathId: stablePathId }, view()),
      ),
    /为空/,
  );
  assert.deepEqual(editor.state.document, singlePoint);
  const cubic = [
    projected.start,
    { x: 460, y: 300 },
    { x: 490, y: 300 },
    { x: 500, y: 320 },
  ];
  dispatch(
    createPathIntent(
      { kind: 'extend-path', pathId: stablePathId, end, pixelCubic: cubic },
      view(),
    ),
  );
  projected = view().source.paths[0];
  assert.equal(projected.id, stablePathId);
  assert.ok(projected.identity.anchorIds.includes(stableAnchorId));
  assert.equal(projected.curves.length, 1);
  assert.equal(
    Object.hasOwn(Object.values(sketch().paths)[0], 'startVertexId'),
    false,
    'first edge becomes sole topology authority',
  );
  assert.equal(Object.keys(sketch().vertices).length, 2);
  const expected = end === 'start' ? cubic.slice().reverse() : cubic;
  projected.curves[0].forEach((p, i) => {
    assert.ok(Math.abs(p.x - expected[i].x) < 1e-8);
    assert.ok(Math.abs(p.y - expected[i].y) < 1e-8);
  });
  editor.undo({ expectedRevision: editor.state.revision });
  assert.deepEqual(
    editor.state.document,
    singlePoint,
    'second click restores original single vertex on undo',
  );
}
console.log(
  'PASS first click persists one referenced vertex, projects in the original frame, moves, roundtrips and extends with stable identity and one undo per click',
);
