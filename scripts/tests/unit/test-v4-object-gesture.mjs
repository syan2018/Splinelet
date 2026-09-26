import assert from 'node:assert/strict';
import { createDocument } from '../../../src/lib/document/schema.mjs';
import { createEditorSession } from '../../../src/lib/editing/dispatcher.mjs';
import { createAuthoringCommand } from '../../../src/lib/editing/commands/authoring.mjs';
import { createStudioSession } from '../../../src/lib/editor/studio-session.mjs';

let serial = 0;
const idFactory = () => `object-gesture-${++serial}`;
const editor = createEditorSession(createDocument({ version: 4, idFactory }), {
  idFactory,
});
const dispatch = (request) =>
  editor.dispatch(createAuthoringCommand(request), {
    expectedRevision: editor.state.revision,
  });
dispatch({
  kind: 'draw-path',
  points: [
    [0, 0],
    [6, 4],
  ],
  closed: false,
});
const owner = Object.values(editor.state.document.nodes)[0];
dispatch({
  kind: 'mirror-curves',
  ownerNodeId: owner.id,
  center: [1, 2],
  angleRad: Math.PI / 4,
});
dispatch({ kind: 'group-nodes', nodeIds: [owner.id], name: '旋转组' });
const group = Object.values(editor.state.document.nodes).find(
  (node) => node.kind === 'group',
);
editor.dispatch(
  (document) => {
    document.nodes[group.id].pose = {
      translationMM: [14, -8],
      rotationRad: Math.PI / 3,
    };
    return { document };
  },
  { expectedRevision: editor.state.revision },
);
const session = createStudioSession({
  opened: { kind: 'v4', document: editor.state.document, assets: {} },
  presentation: {
    reference: null,
    frame: { width: 200, height: 100, widthMM: 100 },
    blenderExtrusionMM: 2,
    fileName: null,
  },
  persistence: { writeFile: async () => {} },
  idFactory,
});
const snapshot = () => session.getSnapshot();
const curves = () =>
  snapshot()
    .runtime.readCurvePreviews(snapshot().project)
    .find((item) => item.stageId === 'final').curves;
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);
const original = snapshot();
const beforeCurves = curves();
for (const ids of [[owner.id], [group.id, owner.id, group.id]]) {
  const before = snapshot();
  const gesture = before.runtime.beginObjectGesture(before.project, ids);
  gesture.update({ x: 4, y: 2 });
  gesture.update({ x: 12, y: 8 });
  assert.deepEqual(
    snapshot().editorState.document,
    original.editorState.document,
  );
  curves().forEach((curve, ci) =>
    curve.forEach((point, pi) => {
      near(point.x, beforeCurves[ci][pi].x + 6);
      near(point.y, beforeCurves[ci][pi].y - 4);
    }),
  );
  gesture.commit();
  const committed = snapshot();
  assert.equal(committed.editorState.revision, before.editorState.revision + 1);
  for (const key of Object.keys(original.editorState.document).filter(
    (key) => key !== 'nodes',
  ))
    assert.deepEqual(
      committed.editorState.document[key],
      original.editorState.document[key],
      `object movement leaves ${key} unchanged`,
    );
  if (ids.includes(group.id))
    assert.deepEqual(
      committed.editorState.document.nodes[owner.id],
      original.editorState.document.nodes[owner.id],
      'parent and child selection moves only the selected root',
    );
  session.undo();
  assert.deepEqual(
    snapshot().editorState.document,
    original.editorState.document,
  );
}
// UI-only movement reserves no model preview and publishes only the final command.
const displayBase = snapshot();
let publications = 0;
const detach = session.subscribe(() => publications++);
const displayMove = displayBase.runtime.beginObjectGesture(
  displayBase.project,
  [owner.id],
  { displayOnly: true },
);
displayMove.update({ x: 4, y: 3 });
displayMove.update({ x: 12, y: 8 });
assert.equal(snapshot(), displayBase);
assert.equal(publications, 0);
displayMove.commit();
assert.equal(publications, 1);
assert.equal(
  snapshot().editorState.revision,
  displayBase.editorState.revision + 1,
);
assert.deepEqual(
  snapshot().editorState.document.sketches,
  displayBase.editorState.document.sketches,
);
session.undo();
assert.deepEqual(
  snapshot().editorState.document,
  displayBase.editorState.document,
);
const cancelBase = snapshot();
const displayCancel = cancelBase.runtime.beginObjectGesture(
  cancelBase.project,
  [owner.id],
  { displayOnly: true },
);
displayCancel.update({ x: 20, y: 30 });
displayCancel.cancel();
assert.equal(snapshot(), cancelBase);
assert.throws(() => displayCancel.commit(), /失效/);
const invalidated = cancelBase.runtime.beginObjectGesture(
  cancelBase.project,
  [owner.id],
  { displayOnly: true },
);
session.dispatch(
  createAuthoringCommand({
    kind: 'move-nodes',
    nodeIds: [owner.id],
    deltaMM: [1, 0],
  }),
);
assert.throws(() => invalidated.commit(), /过期|提交/);
invalidated.cancel();
session.undo();
detach();
const begin = (ids) =>
  snapshot().runtime.beginObjectGesture(snapshot().project, ids);
assert.throws(() => begin([]), /非空/);
assert.throws(() => begin([owner.id, 'missing']), /不存在/);
assert.equal(snapshot().editorState.previewId, null);
const cancelled = begin([owner.id]);
cancelled.update({ x: 12, y: 8 });
assert.throws(() => cancelled.update({ x: NaN, y: 0 }), /有限/);
cancelled.cancel();
assert.deepEqual(
  snapshot().editorState.document,
  original.editorState.document,
);
assert.throws(() => cancelled.commit(), /失效/);
session.dispatch(
  createAuthoringCommand({
    kind: 'set-node',
    nodeId: group.id,
    value: { locked: true },
  }),
);
assert.throws(() => begin([owner.id]), /锁定/);
session.undo();
const stale = begin([owner.id]);
session.open(
  { kind: 'v4', document: original.editorState.document, assets: {} },
  original.presentation,
);
assert.throws(() => stale.update({ x: 2, y: 1 }), /关闭|失效/);
session.dispose();
console.log(
  'PASS V4 object gestures move world poses and derived curves, preserve raw definitions, dedupe selected ancestors, cancel and undo once',
);
