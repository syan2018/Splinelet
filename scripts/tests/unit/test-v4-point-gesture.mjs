import assert from 'node:assert/strict';
import { createDocument } from '../../../src/lib/document/schema.mjs';
import { createAuthoringCommand } from '../../../src/lib/editing/commands/authoring.mjs';
import { createEditorSession } from '../../../src/lib/editing/dispatcher.mjs';
import { createStudioSession } from '../../../src/lib/editor/studio-session.mjs';
import { beginV4PointGesture } from '../../../src/lib/source-editor/point-gesture.mjs';
import { beginV4PathGesture } from '../../../src/lib/source-editor/path-gesture.mjs';

let serial = 0;
const idFactory = () => `point-gesture-${++serial}`;
const frame = {
  width: 960,
  height: 720,
  widthMM: 120,
};
const presentation = () => ({
  reference: null,
  frame,
  blenderExtrusionMM: 2,
  fileName: 'point-gesture.spl',
});
const near = (actual, expected, message) =>
  assert.ok(
    Math.abs(actual - expected) < 1e-8,
    message || `${actual} != ${expected}`,
  );
const offset = (point, delta) => ({
  x: point.x + delta.x,
  y: point.y + delta.y,
});

function authoredDocument({
  closed = false,
  rotated = false,
  shared = false,
} = {}) {
  const editor = createEditorSession(createDocument({ idFactory }), {
    idFactory,
  });
  editor.dispatch(
    createAuthoringCommand({
      kind: 'draw-path',
      closed,
      points: closed
        ? [
            [-8, -4],
            [12, -2],
            [3, 11],
          ]
        : [
            [-8, -4],
            [12, -2],
            [3, 11],
          ],
      cubics: closed
        ? [
            [
              [-8, -4],
              [-4, -9],
              [7, -7],
              [12, -2],
            ],
            [
              [12, -2],
              [17, 4],
              [8, 9],
              [3, 11],
            ],
            [
              [3, 11],
              [-5, 13],
              [-11, 3],
              [-8, -4],
            ],
          ]
        : [
            [
              [-8, -4],
              [-4, -9],
              [7, -7],
              [12, -2],
            ],
            [
              [12, -2],
              [17, 4],
              [8, 9],
              [3, 11],
            ],
          ],
    }),
    { expectedRevision: editor.state.revision },
  );
  const document = structuredClone(editor.state.document);
  if (shared) {
    const sketch = Object.values(document.sketches)[0];
    const path = Object.values(sketch.paths)[0];
    const id = idFactory();
    sketch.paths[id] = { ...structuredClone(path), id, name: 'Shared path' };
  }
  if (rotated) {
    const owner = Object.values(document.nodes)[0];
    owner.pose = {
      translationMM: [17, -9],
      rotationRad: Math.PI / 5,
    };
  }
  return document;
}

function makeSession(options) {
  return createStudioSession({
    opened: {
      kind: 'v4',
      document: authoredDocument(options),
      assets: {},
      target: 'point-gesture.spl',
    },
    presentation: presentation(),
    persistence: {
      writeFile: async () => {},
      drafts: { write: async () => {}, read: async () => null },
    },
    idFactory,
  });
}

const shownPath = (session) => {
  const snapshot = session.getSnapshot();
  return {
    snapshot,
    path: snapshot.runtime.readSourceView(snapshot.project).source.paths[0],
  };
};
const begin = (session, path, curve, point, nodes) =>
  beginV4PointGesture({
    runtime: session.getSnapshot().runtime,
    project: session.getSnapshot().project,
    pathId: path.id,
    curve,
    point,
    nodes,
  });

// The operation starts with source identities and repeatedly applies pointer-down
// deltas to the captured anchors, never to a previous preview sample.
{
  const session = makeSession();
  const { snapshot: original, path } = shownPath(session);
  const origins = structuredClone(path.anchors);
  const gesture = begin(session, path, 0, 0, [0, 1]);
  assert.equal(gesture.kind, 'nodes');
  assert.deepEqual(gesture.selection, { curve: 0, point: 0 });
  gesture.update({ x: 16, y: -12 });
  const repeated = gesture.update({ x: 40, y: 24 });
  const preview = session.getSnapshot().runtime.readSourceView(repeated).source
    .paths[0];
  assert.deepEqual(preview.anchors[0], offset(origins[0], { x: 40, y: 24 }));
  assert.deepEqual(preview.anchors[1], offset(origins[1], { x: 40, y: 24 }));
  assert.deepEqual(preview.anchors[2], origins[2]);
  gesture.cancel();
  assert.deepEqual(
    session.getSnapshot().editorState.document,
    original.editorState.document,
    'cancelling a sampled gesture creates no history entry',
  );
  assert.equal(
    session.getSnapshot().editorState.canUndo,
    original.editorState.canUndo,
  );

  const clickOnly = begin(session, shownPath(session).path, 0, 0, [1, 2]);
  clickOnly.update({ x: -20, y: 8 });
  const clickedPreview = session
    .getSnapshot()
    .runtime.readSourceView(session.getSnapshot().project).source.paths[0];
  assert.deepEqual(
    clickedPreview.anchors[0],
    offset(origins[0], { x: -20, y: 8 }),
  );
  assert.deepEqual(clickedPreview.anchors[1], origins[1]);
  assert.deepEqual(clickedPreview.anchors[2], origins[2]);
  clickOnly.cancel();

  const commit = begin(session, shownPath(session).path, 0, 0, [0, 1]);
  commit.update({ x: 20, y: -16 });
  commit.commit();
  assert.equal(
    session.getSnapshot().editorState.revision,
    original.editorState.revision + 1,
  );
  session.undo();
  assert.deepEqual(
    session.getSnapshot().editorState.document,
    original.editorState.document,
    'one undo restores every anchor in the committed batch',
  );
  session.dispose();
}

// A closed curve's terminal point is its first stable vertex, rather than a
// duplicate seam node with an unstable array index.
{
  const session = makeSession({ closed: true });
  const { path } = shownPath(session);
  const seamId = path.identity.anchorIds[0];
  const terminalCurve = path.curves.length - 1;
  const gesture = begin(session, path, terminalCurve, 3);
  assert.equal(gesture.kind, 'nodes');
  assert.deepEqual(gesture.selection, { curve: 0, point: 0 });
  gesture.update({ x: 14, y: -10 });
  const preview = session
    .getSnapshot()
    .runtime.readSourceView(session.getSnapshot().project).source.paths[0];
  assert.equal(preview.identity.anchorIds[0], seamId);
  assert.deepEqual(preview.curves.at(-1)[3], preview.curves[0][0]);
  gesture.commit();
  assert.equal(shownPath(session).path.identity.anchorIds[0], seamId);
  session.dispose();
}

// A real handle move remains in the shifted/rotated owner's local geometry and
// lets the normal symmetric continuity rule update its neighbour.
{
  const session = makeSession({ rotated: true });
  const { snapshot, path: initialPath } = shownPath(session);
  let path = initialPath;
  const sketchId = snapshot.runtime.readSourceView(snapshot.project).source
    .identities.byId[path.identity.pathId].sketchId;
  const vertexId = snapshot.runtime.readSourceView(snapshot.project).source
    .identities.byId[path.identity.anchorIds[1]].id;
  session.dispatch(
    createAuthoringCommand({
      kind: 'set-path-handle-mode',
      sketchId,
      pathId: snapshot.runtime.readSourceView(snapshot.project).source
        .identities.byId[path.identity.pathId].id,
      vertexId,
      mode: 'symmetric',
    }),
  );
  ({ path } = shownPath(session));
  const anchor = path.anchors[1];
  const gesture = begin(session, path, 0, 2);
  assert.equal(gesture.kind, 'handle');
  gesture.update({ x: 31, y: -19 });
  const preview = session
    .getSnapshot()
    .runtime.readSourceView(session.getSnapshot().project).source.paths[0];
  assert.equal(preview.nodeModes[1], 'symmetric');
  const moved = preview.curves[0][2];
  const neighbour = preview.curves[1][1];
  near(moved.x - anchor.x, -(neighbour.x - anchor.x));
  near(moved.y - anchor.y, -(neighbour.y - anchor.y));
  const expected = offset(path.curves[0][2], { x: 31, y: -19 });
  near(moved.x, expected.x);
  near(moved.y, expected.y);
  gesture.cancel();
  session.dispose();
}

// Reject malformed hits before opening a preview and malformed deltas without
// changing its captured preview sample.
{
  const session = makeSession();
  const { path } = shownPath(session);
  const beforeHit = session.getSnapshot().editorState;
  assert.throws(() => begin(session, path, 99, 0), /失效/);
  assert.deepEqual(session.getSnapshot().editorState, beforeHit);
  const gesture = begin(session, path, 0, 0);
  const beforeDelta = session.getSnapshot().editorState;
  assert.throws(() => gesture.update({ x: Number.NaN, y: 0 }), /有限/);
  assert.deepEqual(session.getSnapshot().editorState, beforeDelta);
  gesture.cancel();
  session.dispose();
}

// Effective locks and display visibility reject the gesture before it reaches
// preview authority, and replacing a project invalidates captured gestures.
{
  const session = makeSession();
  let { path } = shownPath(session);
  const ownerId = path.ownerNodeId;
  session.dispatch(
    createAuthoringCommand({
      kind: 'set-node',
      nodeId: ownerId,
      value: { visible: false },
    }),
  );
  ({ path } = shownPath(session));
  assert.throws(() => begin(session, path, 0, 0), /不可编辑/);
  session.dispatch(
    createAuthoringCommand({
      kind: 'set-node',
      nodeId: ownerId,
      value: { visible: true, locked: true },
    }),
  );
  ({ path } = shownPath(session));
  assert.throws(() => begin(session, path, 0, 0), /不可编辑/);

  session.open(
    {
      kind: 'v4',
      document: authoredDocument(),
      assets: {},
      target: 'replacement.spl',
    },
    presentation(),
  );
  ({ path } = shownPath(session));
  const stale = begin(session, path, 0, 0);
  stale.update({ x: 8, y: 6 });
  session.open(
    {
      kind: 'v4',
      document: authoredDocument(),
      assets: {},
      target: 'replacement-2.spl',
    },
    presentation(),
  );
  const afterOpen = session.getSnapshot().editorState;
  assert.throws(() => stale.update({ x: 9, y: 7 }), /关闭|结束或失效/);
  assert.throws(() => stale.commit(), /关闭|结束或失效/);
  assert.throws(() => stale.cancel(), /关闭|结束或失效/);
  assert.deepEqual(session.getSnapshot().editorState, afterOpen);
  session.dispose();
}

// Whole-path movement preserves curve shape (including all control handles),
// source identities and owner poses. Shared path uses never double the delta.
for (const closed of [false, true]) {
  const session = makeSession({ closed, rotated: true, shared: true });
  const original = session.getSnapshot();
  const paths = original.runtime.readSourceView(original.project).source.paths;
  assert.equal(paths.length, 2);
  const gesture = beginV4PathGesture({
    runtime: original.runtime,
    project: original.project,
    pathIds: [paths[0].id, paths[1].id, paths[0].id],
  });
  gesture.update({ x: 8, y: 16 });
  gesture.update({ x: 40, y: -24 });
  const preview = session.getSnapshot();
  const moved = preview.runtime.readSourceView(preview.project).source.paths;
  paths.forEach((path, index) => {
    assert.deepEqual(moved[index].identity, path.identity);
    path.curves.forEach((curve, ci) =>
      curve.forEach((point, pi) => {
        near(moved[index].curves[ci][pi].x, point.x + 40);
        near(moved[index].curves[ci][pi].y, point.y - 24);
      }),
    );
  });
  assert.deepEqual(preview.editorState.document, original.editorState.document);
  gesture.commit();
  const committed = session.getSnapshot();
  assert.equal(
    committed.editorState.revision,
    original.editorState.revision + 1,
  );
  assert.deepEqual(
    committed.editorState.document.nodes,
    original.editorState.document.nodes,
  );
  session.undo();
  assert.deepEqual(
    session.getSnapshot().editorState.document,
    original.editorState.document,
  );
  const current = session.getSnapshot();
  assert.throws(
    () =>
      beginV4PathGesture({
        runtime: current.runtime,
        project: current.project,
        pathIds: [paths[0].id, 'missing'],
      }),
    /不可编辑/,
  );
  assert.equal(session.getSnapshot().editorState.previewId, null);
  const cancel = beginV4PathGesture({
    runtime: current.runtime,
    project: current.project,
    pathIds: [paths[0].id],
  });
  cancel.update({ x: 14, y: 5 });
  cancel.cancel();
  assert.deepEqual(
    session.getSnapshot().editorState.document,
    original.editorState.document,
  );
  session.dispose();
}

console.log(
  'PASS V4 point gestures preserve captured source identities, baseline deltas, continuity geometry, history and stale-session guards',
);
