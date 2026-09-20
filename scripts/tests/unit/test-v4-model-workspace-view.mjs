import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createDocument } from '../../../src/lib/document/schema.mjs';
import { createEditorSession } from '../../../src/lib/editing/dispatcher.mjs';
import { createAuthoringCommand } from '../../../src/lib/editing/commands/authoring.mjs';
import { createCreationIntent } from '../../../src/lib/editor/creation-intents.mjs';
import { evaluateDocument } from '../../../src/lib/evaluation/evaluate-document.mjs';
import { projectModelWorkspaceView } from '../../../src/lib/editor/model-workspace-view.mjs';
import { createV4CreationRuntime } from '../../../src/lib/editor/creation-runtime.mjs';
import { openProject } from '../../../src/lib/persistence/open-project.mjs';

const domains = ['curves', 'regions', 'relief', 'placed-relief'];
const frame = { width: 100, height: 100, widthMM: 100 };
let serial = 0;
const idFactory = () => `model-view-${++serial}`;
const editor = createEditorSession(createDocument({ idFactory }), {
  idFactory,
});
const dispatch = (action) =>
  editor.dispatch(createAuthoringCommand(action), {
    expectedRevision: editor.state.revision,
  });
dispatch({
  kind: 'draw-path',
  closed: true,
  points: [
    [0, 0],
    [20, 0],
    [20, 20],
    [0, 20],
  ],
});
const owner = Object.values(editor.state.document.sketches)[0].ownerNodeId;
dispatch({
  kind: 'draw-path',
  ownerNodeId: owner,
  closed: true,
  points: [
    [5, 5],
    [15, 5],
    [15, 15],
    [5, 15],
  ],
});
const capture = async (state) => ({
  epoch: state.epoch,
  revision: state.revision,
  previewId: state.previewId,
  previewVersion: state.preview?.version ?? null,
  domains,
  snapshot: await evaluateDocument(
    state.previewId ? state.preview.document : state.document,
    { requestedDomains: domains },
  ),
});
const read = async () =>
  projectModelWorkspaceView(editor.state, await capture(editor.state), frame);
const initial = editor.state;
const evaluated = await capture(initial);
const view = projectModelWorkspaceView(initial, evaluated, frame);
assert.equal(view.regions.length, 1);
const region = view.regions[0];
assert.equal(region.areaMM2, 300);
assert.equal(region.components, 1);
assert.equal(region.holes, 1);
assert.equal(region.authoredRelief.value.enabled, false);
assert.equal(region.part.id, initial.document.manufacturing.defaultPartId);
assert.equal(
  region.heightMM,
  null,
  'no manufactured height is invented for disabled relief',
);
assert.equal(region.id, region.key);
assert.equal(view.cleanupRadiusMM, 0);
assert.deepEqual(region.outputRef, view.creation.identities.cells[region.id]);
assert.ok(Object.isFrozen(region.authoredRelief.value.placement));
assert.throws(() => {
  region.authoredRelief.value.placement.zMM = 99;
}, TypeError);
assert.deepEqual(
  editor.state,
  initial,
  'projection cannot alter source or assignments',
);
assert.throws(
  () =>
    projectModelWorkspaceView(initial, { ...evaluated, revision: 0 }, frame),
  /不属于/,
);
assert.throws(
  () =>
    projectModelWorkspaceView(
      initial,
      { ...evaluated, domains: ['regions'] },
      frame,
    ),
  /缺少/,
);
editor.dispatch(
  createCreationIntent(
    'paint',
    { cellKeys: [region.id], color: '#ff6600' },
    view.creation,
  ),
  { expectedRevision: editor.state.revision },
);
dispatch({
  kind: 'set-relief',
  target: region.outputRef,
  value: {
    enabled: true,
    thickness: { kind: 'mm', value: 3 },
    mode: 'cut',
    placement: { kind: 'free', zMM: 5 },
  },
});
const enabled = await read();
assert.equal(enabled.regions[0].authoredRelief.value.mode, 'cut');
assert.equal(enabled.regions[0].heightMM, 3);
assert.equal(enabled.regions[0].bottomMM, 5);
dispatch({
  kind: 'set-relief',
  target: region.outputRef,
  value: {
    enabled: false,
    thickness: { kind: 'mm', value: 3 },
    mode: 'cut',
    placement: { kind: 'free', zMM: 5 },
  },
});
const disabled = await read();
assert.equal(disabled.regions[0].heightMM, null);
assert.equal(disabled.regions[0].authoredRelief.value.placement.zMM, 5);
assert.equal(disabled.regions[0].authoredRelief.value.mode, 'cut');
assert.equal(disabled.regions[0].color, '#ff6600');
assert.deepEqual(disabled.source.paths, view.source.paths);

// A broken placement must not erase the editable authored definition.
dispatch({
  kind: 'set-relief',
  target: region.outputRef,
  value: {
    enabled: true,
    thickness: { kind: 'mm', value: 3 },
    mode: 'add',
    placement: { kind: 'layer', layerId: 'missing-layer', offsetMM: 0 },
  },
});
const broken = await read();
assert.equal(
  broken.regions[0].authoredRelief.value.placement.layerId,
  'missing-layer',
);
assert.equal(broken.regions[0].heightMM, null);
assert.ok(broken.creation.errors.length);

const runtime = createV4CreationRuntime({
  editorSession: editor,
  sourceFrame: frame,
  toDisplayProject: (state) => ({ revision: state.revision }),
});
const project = runtime.project();
const runtimeView = await runtime.evaluate('model_workspace', {}, project);
assert.deepEqual(runtimeView, broken);
assert.equal(
  runtime.bindEvaluation(project, runtimeView.creation).project,
  project,
);
await assert.rejects(
  runtime.evaluate('model_workspace', { mutatedModel: {} }, project),
  /参数/,
);
let complete;
const delayed = createV4CreationRuntime({
  editorSession: editor,
  sourceFrame: frame,
  toDisplayProject: (state) => ({ revision: state.revision }),
  evaluate: () =>
    new Promise((resolve) => {
      complete = resolve;
    }),
});
const oldState = editor.state;
const pending = delayed.evaluate('model_workspace', {}, delayed.project());
editor.undo({ expectedRevision: editor.state.revision });
complete((await capture(oldState)).snapshot);
await assert.rejects(pending, /已变化/);
runtime.dispose();
delayed.dispose();

const missingOutput = structuredClone(editor.state.document);
const missingProgram =
  missingOutput.programs[missingOutput.nodes[owner].programId];
delete missingProgram.operators[missingProgram.outputs.regions.operatorId];
editor.dispatch(() => ({ document: missingOutput, changedRefs: [] }), {
  expectedRevision: editor.state.revision,
});
const missingView = await read();
assert.equal(missingView.regions.length, 0);
assert.ok(missingView.creation.errors.length);
assert.equal(missingView.unresolved.relief.length, 1);
assert.equal(missingView.unresolved.appearance.length, 1);
assert.deepEqual(missingView.unresolved.relief[0].target, region.outputRef);

const opened = openProject({
  bytes: new Uint8Array(fs.readFileSync('public/sandrone-example.spl')),
});
const sampleEditor = createEditorSession(opened.document);
const sampleView = projectModelWorkspaceView(
  sampleEditor.state,
  await capture(sampleEditor.state),
  opened.document.sourceFrame,
);
assert.equal(sampleView.regions.length, 69);
assert.equal(sampleView.source.paths.length, 76);
assert.equal(
  sampleView.regions.filter((item) => item.authoredRelief.value.enabled).length,
  69,
);
assert.equal(sampleView.creation.errors.length, 0);
assert.deepEqual(sampleView.unresolved, {
  appearance: [],
  relief: [],
  presentation: [],
});
assert.deepEqual(sampleEditor.state.document, opened.document);
console.log(
  'PASS advanced model view preserves stable outputs, disabled/failed authored relief and canonical evaluation identity',
);
