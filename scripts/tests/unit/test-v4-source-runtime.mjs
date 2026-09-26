import assert from 'node:assert/strict';
import { createDocument } from '../../../src/lib/document/schema.mjs';
import { createEditorSession } from '../../../src/lib/editing/dispatcher.mjs';
import { createAuthoringCommand } from '../../../src/lib/editing/commands/authoring.mjs';
import { createV4CreationRuntime } from '../../../src/lib/editor/creation-runtime.mjs';

function fixture() {
  let serial = 0;
  const idFactory = () => `source-runtime-${++serial}`;
  const editor = createEditorSession(
    createDocument({ version: 4, idFactory }),
    {
      idFactory,
    },
  );
  const dispatch = (request) =>
    editor.dispatch(createAuthoringCommand(request), {
      expectedRevision: editor.state.revision,
    });
  dispatch({
    kind: 'draw-path',
    points: [
      [1, 0],
      [3, 2],
    ],
    closed: false,
  });
  const owner = Object.values(editor.state.document.nodes)[0];
  dispatch({
    kind: 'mirror-curves',
    ownerNodeId: owner.id,
    center: [0, 0],
    angleRad: 0,
  });
  const mirror = Object.values(
    editor.state.document.programs[owner.programId].operators,
  ).find((operator) => operator.type === 'curve-mirror');
  const sourceFrame = { width: 800, height: 600, widthMM: 100 };
  const runtime = createV4CreationRuntime({
    editorSession: editor,
    sourceFrame,
    toDisplayProject: (_state, view) => ({
      version: 4,
      creation: view.creation,
    }),
  });
  return { editor, runtime, owner, mirror, sourceFrame };
}

const { editor, runtime, owner, mirror, sourceFrame } = fixture();
const initialProject = runtime.project();
const view = runtime.readSourceView(initialProject);
const path = view.source.paths[0];
assert.deepEqual(path.start, { x: 408, y: 300 });
assert.equal(view.epoch, editor.state.epoch);
assert.equal(view.revision, editor.state.revision);
assert.equal(view.previewId, null);
assert.ok(Object.isFrozen(view));
assert.ok(Object.isFrozen(path.identity.anchorIds));
assert.throws(() => {
  path.start.x = 0;
}, TypeError);
const ref = view.source.identities.byId[path.identity.anchorIds[0]];
assert.equal(ref.kind, 'vertex');
assert.deepEqual(
  editor.state.document.sketches[ref.sketchId].vertices[ref.id].position.value,
  [1, 0],
);
sourceFrame.width = 400;
const snapContext = runtime.readEndpointSnapContext(initialProject, path.id, 0);
assert.deepEqual(
  snapContext.origin,
  path.start,
  'snap projection shares the immutable source frame',
);
assert.ok(Object.isFrozen(snapContext));
assert.equal(
  snapContext.lines.length,
  0,
  'pending snapping uses current raw sources',
);
await runtime.evaluate('creation', {}, initialProject);
const evaluatedSnapContext = runtime.readEndpointSnapContext(
  initialProject,
  path.id,
  0,
);
assert.ok(
  evaluatedSnapContext.lines.length > 0,
  'accepted worker curves enable derived guides',
);
assert.notEqual(
  evaluatedSnapContext,
  snapContext,
  'accepting current evaluation invalidates pending guide cache',
);
assert.throws(
  () =>
    runtime.readEndpointSnapContext(
      structuredClone(initialProject),
      path.id,
      0,
    ),
  /外部|可写/,
);
assert.deepEqual(
  runtime.readSourceView(initialProject).source.paths[0].start,
  path.start,
  'caller mutations cannot change the captured compatibility frame',
);

const move = (index, pixelPoint) => ({
  kind: 'move-anchor',
  identityId: path.identity.anchorIds[index],
  pixelPoint,
});
const baseline = editor.state;
const originalCurves = runtime.readCurvePreviews(initialProject);
const gesture = runtime.beginSourceGesture(initialProject);
const first = gesture.update(move(0, { x: 424, y: 292 }));
assert.deepEqual(editor.state.document, baseline.document);
assert.equal(editor.state.revision, baseline.revision);
assert.deepEqual(runtime.readSourceView(first).source.paths[0].start, {
  x: 424,
  y: 292,
});
assert.notDeepEqual(
  runtime.readCurvePreviews(first),
  originalCurves,
  'derived mirror preview follows the same uncommitted source',
);
assert.throws(() => runtime.beginSourceGesture(first));
const repeated = gesture.update(move(0, { x: 424, y: 292 }));
assert.notEqual(
  repeated,
  first,
  'equal geometry still represents a new preview sample',
);
assert.equal(
  runtime.readSourceView(repeated).previewVersion,
  editor.state.preview.version,
);
assert.throws(() => runtime.readSourceView(first), /过期|失效/);
assert.throws(() => runtime.readCurvePreviews(first), /过期|失效/);
assert.throws(
  () => runtime.readEndpointSnapContext(first, path.id, 0),
  /过期|失效/,
);
assert.deepEqual(
  runtime.readEndpointSnapContext(repeated, path.id, 0),
  evaluatedSnapContext,
  'preview guides retain the committed source and immutable frame',
);
assert.deepEqual(
  runtime.readEndpointSnapContext(repeated, path.id, path.curves.length).origin,
  path.curves.at(-1)[3],
  'a guide first requested during preview also uses the committed frame',
);
assert.throws(() =>
  runtime.commandSource(move(0, path.start), { project: first }),
);
const second = gesture.update(move(1, { x: 440, y: 268 }));
const secondPath = runtime.readSourceView(second).source.paths[0];
assert.deepEqual(
  secondPath.start,
  path.start,
  'each gesture sample starts from the captured baseline, not the previous sample',
);
assert.deepEqual(secondPath.anchors[1], { x: 440, y: 268 });
assert.throws(() => runtime.readSourceView(first), /过期|失效/);
assert.throws(() => runtime.readCurvePreviews(first), /过期|失效/);
const cancelled = gesture.cancel();
assert.deepEqual(editor.state.document, baseline.document);
assert.equal(editor.state.revision, baseline.revision);
assert.equal(editor.state.canUndo, baseline.canUndo);
assert.equal(editor.state.canRedo, baseline.canRedo);
assert.deepEqual(runtime.readSourceView(cancelled).source.paths[0], path);
assert.deepEqual(runtime.readCurvePreviews(cancelled), originalCurves);
assert.throws(() => gesture.update(move(0, path.start)));
assert.throws(() => gesture.commit());
assert.throws(() => gesture.cancel());

const committedGesture = runtime.beginSourceGesture(cancelled);
committedGesture.update(move(0, { x: 416, y: 300 }));
committedGesture.update(move(0, { x: 432, y: 284 }));
const movedProject = committedGesture.commit();
assert.equal(editor.state.revision, baseline.revision + 1);
assert.deepEqual(runtime.readSourceView(movedProject).source.paths[0].start, {
  x: 432,
  y: 284,
});
assert.equal(runtime.readSourceView(movedProject).source.frame.width, 800);
assert.throws(() => committedGesture.commit());
editor.undo({ expectedRevision: editor.state.revision });
assert.deepEqual(
  editor.state.document,
  baseline.document,
  'one undo removes all drag samples',
);
assert.throws(() => runtime.readSourceView(movedProject), /过期|失效/);

let project = runtime.project();
const sourcePlan = runtime.commandSource(move(0, { x: 416, y: 300 }), {
  project,
});
assert.equal(sourcePlan.project, project);
assert.deepEqual(
  editor.state.document,
  baseline.document,
  'compiling an intent is inert',
);
project = sourcePlan.commit();
assert.deepEqual(runtime.readSourceView(project).source.paths[0].start, {
  x: 416,
  y: 300,
});
assert.throws(() => sourcePlan.commit());
editor.undo({ expectedRevision: editor.state.revision });
assert.deepEqual(editor.state.document, baseline.document);
project = runtime.project();
const renamePlan = runtime.commandPath(
  {
    kind: 'set-paths',
    pathIds: [path.identity.pathId],
    value: { name: '共享历史的线条' },
  },
  { project },
);
assert.equal(renamePlan.project, project);
project = renamePlan.commit();
const renamedDocument = editor.state.document;
assert.equal(
  runtime.readSourceView(project).source.paths[0].name,
  '共享历史的线条',
);
project = runtime
  .command(
    'modifier_update',
    {
      objectId: owner.id,
      modifierId: mirror.id,
      changes: { angleDeg: 45 },
    },
    { project },
  )
  .commit();
assert.notDeepEqual(editor.state.document, renamedDocument);
editor.undo({ expectedRevision: editor.state.revision });
assert.deepEqual(editor.state.document, renamedDocument);
editor.undo({ expectedRevision: editor.state.revision });
assert.deepEqual(
  editor.state.document,
  baseline.document,
  'source and construction controls use one editor history',
);
assert.throws(() =>
  runtime.commandPath(
    { kind: 'set-paths', pathIds: [], value: {} },
    { project },
  ),
);
assert.throws(
  () => runtime.readSourceView(structuredClone(runtime.project())),
  /外部/,
);
assert.throws(
  () => runtime.beginSourceGesture(structuredClone(runtime.project())),
  /外部/,
);

project = runtime.project();
const pendingSource = runtime.commandSource(move(0, { x: 440, y: 300 }), {
  project,
});
const pendingPath = runtime.commandPath(
  {
    kind: 'set-paths',
    pathIds: [path.identity.pathId],
    value: { name: '过时计划' },
  },
  { project },
);
runtime
  .command(
    'modifier_update',
    {
      objectId: owner.id,
      modifierId: mirror.id,
      changes: { enabled: false },
    },
    { project },
  )
  .commit();
const afterOtherEdit = editor.state;
assert.throws(() => pendingSource.commit(), /过期|失效/);
assert.throws(() => pendingPath.commit(), /过期|失效/);
assert.deepEqual(editor.state, afterOtherEdit);

for (const invalidate of ['undo', 'replace']) {
  const current = fixture();
  const shown = current.runtime.project();
  const currentPath = current.runtime.readSourceView(shown).source.paths[0];
  const intent = {
    kind: 'move-anchor',
    identityId: currentPath.identity.anchorIds[0],
    pixelPoint: { x: 416, y: 300 },
  };
  const staleGesture = current.runtime.beginSourceGesture(shown);
  staleGesture.update(intent);
  if (invalidate === 'undo')
    current.editor.undo({ expectedRevision: current.editor.state.revision });
  else
    current.editor.replaceDocument(current.editor.state.document, {
      expectedRevision: current.editor.state.revision,
    });
  const afterInvalidation = current.editor.state;
  assert.throws(() => staleGesture.update(intent));
  assert.throws(() => staleGesture.commit());
  assert.throws(() => staleGesture.cancel());
  assert.deepEqual(
    current.editor.state,
    afterInvalidation,
    `${invalidate} invalidates every gesture operation without further mutation`,
  );
}

console.log(
  'PASS shared V4 source runtime preserves pixel identities, baseline previews, derived curves, single undo, immutable frame and stale-handle guards',
);
