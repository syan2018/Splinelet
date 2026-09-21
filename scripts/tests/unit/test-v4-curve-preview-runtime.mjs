import assert from 'node:assert/strict';
import { createDocument } from '../../../src/lib/document/schema.mjs';
import { createEditorSession } from '../../../src/lib/editing/dispatcher.mjs';
import { createAuthoringCommand } from '../../../src/lib/editing/commands/authoring.mjs';
import { createV4CreationRuntime } from '../../../src/lib/editor/creation-runtime.mjs';

let serial = 0;
const idFactory = () => `preview-ui-${++serial}`;
const editor = createEditorSession(createDocument({ idFactory }), {
  idFactory,
});
const dispatch = (action) =>
  editor.dispatch(createAuthoringCommand(action), {
    expectedRevision: editor.state.revision,
  });
dispatch({
  kind: 'draw-path',
  points: [
    [0, 0],
    [4, 3],
  ],
  closed: false,
});
const owner = Object.values(editor.state.document.nodes)[0];
dispatch({
  kind: 'mirror-curves',
  ownerNodeId: owner.id,
  center: [0, 0],
  angleRad: Math.PI / 2,
});
const mirror = Object.values(
  editor.state.document.programs[owner.programId].operators,
).find((operator) => operator.type === 'curve-mirror');
const runtime = createV4CreationRuntime({
  editorSession: editor,
  toDisplayProject: () => ({ version: 4 }),
  evaluate: () => {
    throw Error('curve preview must not wait for full evaluation');
  },
});
const project = runtime.project();
const before = editor.state;
const original = runtime.readCurvePreviews(project);
assert.equal(original.at(-1).stageId, 'final');
assert.equal(original.at(-1).curves.length, 2);
assert.equal(
  runtime.readCurvePreviews(project),
  original,
  'same display caches immutable preview',
);
assert.deepEqual(
  editor.state,
  before,
  'read does not commit or create history',
);
assert.ok(Object.isFrozen(original));
assert.throws(() => runtime.readCurvePreviews({ version: 4 }), /外部|可写/);

const active = editor.beginPreview({ expectedRevision: before.revision });
const update = (angleRad) =>
  editor.updatePreview(
    createAuthoringCommand({
      kind: 'set-operator',
      ownerNodeId: owner.id,
      operatorId: mirror.id,
      params: { center: [0, 0], angleRad },
    }),
    { expectedRevision: active.revision, previewId: active.previewId },
  );
assert.throws(() => runtime.readCurvePreviews(project), /过期/);
update(0);
const firstHandle = runtime.project();
const firstPreview = runtime.readCurvePreviews(firstHandle);
assert.notDeepEqual(firstPreview.at(-1).curves, original.at(-1).curves);
assert.deepEqual(
  editor.state.document,
  before.document,
  'preview never replaces committed document',
);
update(Math.PI / 4);
const secondHandle = runtime.project();
assert.notEqual(
  firstHandle,
  secondHandle,
  'same preview ID with changed data issues a new handle',
);
assert.throws(() => runtime.readCurvePreviews(firstHandle), /过期/);
assert.notDeepEqual(
  runtime.readCurvePreviews(secondHandle).at(-1).curves,
  firstPreview.at(-1).curves,
);
editor.cancelPreview({
  expectedRevision: active.revision,
  previewId: active.previewId,
});
assert.throws(() => runtime.readCurvePreviews(secondHandle), /过期/);
assert.deepEqual(runtime.readCurvePreviews(runtime.project()), original);
assert.deepEqual(editor.state.document, before.document);
assert.equal(editor.state.revision, before.revision);
runtime.dispose();
assert.throws(() => runtime.readCurvePreviews(runtime.project()), /关闭/);
console.log(
  'PASS current V4 curve previews are synchronous, immutable, cached by display identity, preview-aware and never backed by stale or foreign projects',
);
