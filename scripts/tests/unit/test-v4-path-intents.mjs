import assert from 'node:assert/strict';
import { createDocument } from '../../../src/lib/document/schema.mjs';
import { createEditorSession } from '../../../src/lib/editing/dispatcher.mjs';
import { createAuthoringCommand } from '../../../src/lib/editing/commands/authoring.mjs';
import { createPathIntent } from '../../../src/lib/editor/path-intents.mjs';
import { projectSourceView } from '../../../src/lib/editor/source-view.mjs';
import { straightCubic } from '../../../src/lib/source-editor/connect.mjs';

let serial = 0;
const idFactory = () => `path-intent-${++serial}`;
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
dispatch((document) => {
  document.nodes[document.sketches[sketchId].ownerNodeId].pose = {
    translationMM: [7.21, -2.97],
    rotationRad: 0.673,
  };
  return { document };
});
dispatch(createAuthoringCommand({ kind: 'reverse-path', sketchId, pathId }));
const frame = { width: 931, height: 673, widthMM: 123.4 };
const view = () => ({
  ...editor.state,
  source: projectSourceView(editor.state.document, frame),
});
let captured = view();
const path = captured.source.paths[0];
const pixelCubics = structuredClone(path.curves);
for (const cubic of pixelCubics) {
  cubic[1].y -= 13.2;
  cubic[2].x += 7.8;
}
const before = editor.state.document;
const refit = createPathIntent(
  { kind: 'refit-path', pathId: path.id, pixelCubics },
  captured,
);
dispatch(refit);
view().source.paths[0].curves.forEach((cubic, i) =>
  cubic.forEach((point, j) => {
    assert.ok(Math.abs(point.x - pixelCubics[i][j].x) < 1e-8);
    assert.ok(Math.abs(point.y - pixelCubics[i][j].y) < 1e-8);
  }),
);
assert.deepEqual(
  editor.state.document.sketches[sketchId].vertices,
  before.sketches[sketchId].vertices,
);
assert.throws(() => dispatch(refit), /失效/);
const fitted = editor.state.document;
captured = view();
dispatch(
  createPathIntent(
    {
      kind: 'straighten-edge',
      pathId: path.id,
      edgeIdentityId: path.identity.edgeIds[0],
    },
    captured,
  ),
);
const straight = view().source.paths[0].curves[0];
const legacyStraight = straightCubic(straight[0], straight[3]);
straight.forEach((point, i) => {
  assert.ok(Math.abs(point.x - legacyStraight[i].x) < 1e-8);
  assert.ok(Math.abs(point.y - legacyStraight[i].y) < 1e-8);
});
editor.undo({ expectedRevision: editor.state.revision });
assert.deepEqual(editor.state.document, fitted);
dispatch((document) => {
  delete document.sketches[sketchId].edges[
    document.sketches[sketchId].paths[pathId].edges[0].edgeId
  ];
  return { document };
});
assert.equal(view().source.paths.length, 0);
assert.equal(view().source.unavailablePaths[0].id, path.id);
dispatch(
  createPathIntent(
    { kind: 'set-paths', pathIds: [path.id], value: { name: '待修复' } },
    view(),
  ),
);
const broken = editor.state.document;
dispatch(
  createPathIntent({ kind: 'delete-paths', pathIds: [path.id] }, view()),
);
assert.equal(editor.state.document.sketches[sketchId].paths[pathId], undefined);
editor.undo({ expectedRevision: editor.state.revision });
assert.deepEqual(editor.state.document, broken);
console.log(
  'PASS original path intents preserve reversed pixel refit, immutable anchors, single undo, stale fitting rejection and repair/delete access to unavailable paths',
);
