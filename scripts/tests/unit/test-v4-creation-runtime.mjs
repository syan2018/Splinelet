import assert from 'node:assert/strict';
import { createDocument } from '../../../src/lib/document/schema.mjs';
import { createEditorSession } from '../../../src/lib/editing/dispatcher.mjs';
import { createAuthoringCommand } from '../../../src/lib/editing/commands/authoring.mjs';
import { createV4CreationRuntime } from '../../../src/lib/editor/creation-runtime.mjs';
import { evaluateDocument } from '../../../src/lib/evaluation/evaluate-document.mjs';

let serial = 0;
const idFactory = () => `runtime-${++serial}`;
const editor = createEditorSession(createDocument({ version: 4, idFactory }), {
  idFactory,
});
editor.dispatch(
  createAuthoringCommand({
    kind: 'draw-path',
    closed: true,
    points: [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ],
  }),
  { expectedRevision: 0 },
);
const runtime = createV4CreationRuntime({
  editorSession: editor,
  toDisplayProject: (state, view) => ({
    version: 4,
    creation: view.creation,
    template: state.document.manufacturing.slicerTemplate,
  }),
});
const project = runtime.project();
assert.equal(
  runtime.project(),
  project,
  'unchanged state must keep display identity stable across renders',
);
assert(Object.isFrozen(project.creation.objects));
const scene = await runtime.evaluate('creation', {}, project);
assert.equal(runtime.bindEvaluation(project, scene).project, project);
const context = { project, scene };
const cellKeys = [scene.cells[0].key];
const before = editor.state;
const plan = runtime.command('paint', { cellKeys, color: '#ffaa00' }, context);
assert.deepEqual(
  editor.state,
  before,
  'creating a plan must not write the document',
);
const paintedProject = plan.commit();
assert.equal(paintedProject.creation.swatches.length, 1);
assert.equal(editor.state.revision, before.revision + 1);
assert.throws(() => plan.commit(), /已提交/);
assert.throws(
  () => runtime.command('height', { cellKeys, heightMM: 2 }, context),
  /过期/,
);
assert.throws(
  () => runtime.readCreationDocument(structuredClone(paintedProject)),
  /外部/,
);

const paintedScene = await runtime.evaluate('creation', {}, paintedProject);
assert.equal(paintedScene.cells[0].painted, true);
const paintedContext = { project: paintedProject, scene: paintedScene };
const pending = await runtime.prepare(
  'height',
  { cellKeys, heightMM: 5 },
  paintedContext,
);
const preCommit = editor.state;
const proposed = await runtime.evaluate('creation', {}, pending.project);
assert.equal(proposed.cells[0].heightMM, 5);
assert.deepEqual(
  editor.state,
  preCommit,
  'evaluating prepared geometry cannot mutate committed state',
);
const committedProject = runtime.commitPrepared(pending, paintedContext);
const committedScene = await runtime.evaluate('creation', {}, committedProject);
assert.equal(committedScene.cells[0].heightMM, 5);
assert.throws(
  () =>
    runtime.commitPrepared(pending, {
      project: committedProject,
      scene: committedScene,
    }),
  /预备命令/,
);
editor.undo({ expectedRevision: editor.state.revision });
assert.deepEqual(
  editor.state.document,
  preCommit.document,
  'prepare and commit form one undo',
);

const current = runtime.project();
const currentScene = await runtime.evaluate('creation', {}, current);
assert.throws(
  () =>
    runtime.command(
      'height',
      { cellKeys, heightMM: 4 },
      { project: current, scene },
    ),
  /不属于/,
);
assert.throws(
  () =>
    runtime.commitPreparedDisplay(
      { ...current },
      { project: current, scene: currentScene },
    ),
  /底板/,
);
const templateProject = runtime.setSlicerTemplate(
  { name: 'profile' },
  { project: current, scene: currentScene },
);
assert.equal(templateProject.template.name, 'profile');
assert.equal(
  editor.state.document.manufacturing.slicerTemplate.name,
  'profile',
);

let release;
const delayed = createV4CreationRuntime({
  editorSession: editor,
  toDisplayProject: (state, view) => ({ creation: view.creation }),
  evaluate: async (document, options) => {
    await new Promise((resolve) => {
      release = resolve;
    });
    return evaluateDocument(document, options);
  },
});
const waiting = delayed.evaluate('creation', {}, delayed.project());
const rejected = assert.rejects(waiting, /工程已变化/);
editor.dispatch(
  createAuthoringCommand({ kind: 'create-shape', name: 'new revision' }),
  { expectedRevision: editor.state.revision },
);
release();
await rejected;
const previewState = editor.beginPreview({
  expectedRevision: editor.state.revision,
});
const previewBefore = runtime.project();
const firstNode = Object.keys(editor.state.document.nodes)[0];
editor.updatePreview(
  createAuthoringCommand({
    kind: 'set-node',
    nodeId: firstNode,
    value: { name: 'preview name' },
  }),
  {
    expectedRevision: editor.state.revision,
    previewId: previewState.previewId,
  },
);
const previewAfter = runtime.project();
assert.notEqual(
  previewBefore,
  previewAfter,
  'preview updates sharing a gesture ID need a new display',
);
assert.equal(
  previewAfter.creation.objects.find((item) => item.id === firstNode).name,
  'preview name',
);
assert.throws(
  () =>
    runtime.command('new_object', {}, { project: previewAfter, scene: null }),
  /完成当前拖动/,
);
editor.cancelPreview({
  expectedRevision: editor.state.revision,
  previewId: previewState.previewId,
});
delayed.dispose();
runtime.dispose();
assert.throws(() => runtime.project(), /已关闭/);
console.log(
  'PASS original creation runtime uses one V4 authority, prepared transactions, explicit template writes and stale-result rejection',
);
