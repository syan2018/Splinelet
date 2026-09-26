import assert from 'node:assert/strict';
import { createDocument } from '../../../src/lib/document/schema.mjs';
import { createEditorSession } from '../../../src/lib/editing/dispatcher.mjs';
import { createAuthoringCommand } from '../../../src/lib/editing/commands/authoring.mjs';
import { createEvaluationSession } from '../../../src/lib/evaluation/session.mjs';
import { evaluateDocument } from '../../../src/lib/evaluation/evaluate-document.mjs';
import { projectWorkspaceView } from '../../../src/lib/editor/workspace-view.mjs';
import { createCreationIntent } from '../../../src/lib/editor/creation-intents.mjs';

let sequence = 0;
const idFactory = () => `workspace-${++sequence}`;
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
const domains = ['curves', 'regions', 'relief', 'placed-relief'];
const evaluation = createEvaluationSession({
  capabilities: domains,
  evaluate: (request) =>
    evaluateDocument(request.document, { requestedDomains: request.domains }),
});
const detach = evaluation.attach(editor);
const frame = { width: 800, height: 600, widthMM: 100 };
const capture = async () => {
  await evaluation.request({ domains });
  return evaluation.capture({
    epoch: editor.state.epoch,
    revision: editor.state.revision,
    domains,
  });
};
const evaluated = await capture();
const before = editor.state;
const view = projectWorkspaceView(before, evaluated, frame);
assert.throws(
  () =>
    projectWorkspaceView(before, { ...evaluated, domains: ['curves'] }, frame),
  /缺少工作区所需阶段/,
);
assert(Object.isFrozen(view.creation.cells[0].outputRef));
assert.deepEqual(
  view.creation.creation.objects[0].pathIds,
  view.source.paths.map((path) => path.id),
);
assert.deepEqual(
  editor.state,
  before,
  'view construction cannot write source or evaluation into the document',
);
editor.dispatch(
  createCreationIntent(
    'paint',
    { cellKeys: [view.creation.cells[0].key], color: '#ff0000' },
    view.creation,
  ),
  { expectedRevision: before.revision },
);
assert.throws(
  () => projectWorkspaceView(editor.state, evaluated, frame),
  /不属于/,
);
const painted = projectWorkspaceView(editor.state, await capture(), frame);
assert.equal(painted.creation.cells[0].painted, true);
assert.equal(painted.creation.cells[0].color, '#ff0000');
assert.deepEqual(
  painted.source.paths,
  view.source.paths,
  'painting cannot rewrite source geometry',
);
assert.throws(
  () =>
    createCreationIntent(
      'height',
      {},
      { ...painted.creation, previewId: 'drag-preview' },
    ),
  /预览/,
);
assert.throws(
  () =>
    projectWorkspaceView(
      { ...editor.state, epoch: 'other-document' },
      evaluated,
      frame,
    ),
  /不属于/,
);
const gesture = editor.beginPreview({
  expectedRevision: editor.state.revision,
});
await evaluation.request({ domains });
const oldPreview = Object.values(evaluation.state.results)[0];
projectWorkspaceView(editor.state, oldPreview, frame);
const nodeId = Object.keys(editor.state.document.nodes)[0];
const move = createAuthoringCommand({
  kind: 'set-node',
  nodeId,
  value: { name: 'drag preview' },
});
const updatePreview = () =>
  editor.updatePreview(move, {
    expectedRevision: editor.state.revision,
    previewId: gesture.previewId,
  });
updatePreview();
assert.equal(editor.state.previewId, gesture.previewId);
assert.throws(
  () => projectWorkspaceView(editor.state, oldPreview, frame),
  /不属于/,
  'an earlier result within the same gesture cannot become the current display',
);
await evaluation.request({ domains });
const freshPreview = Object.values(evaluation.state.results)[0];
const freshView = projectWorkspaceView(editor.state, freshPreview, frame);
assert.equal(
  freshView.creation.creation.objects.find((item) => item.id === nodeId).name,
  'drag preview',
);
updatePreview();
assert.throws(
  () => projectWorkspaceView(editor.state, freshPreview, frame),
  /不属于/,
  'repeated preview coordinates still use the current sample identity',
);
await evaluation.request({ domains });
projectWorkspaceView(
  editor.state,
  Object.values(evaluation.state.results)[0],
  frame,
);
editor.cancelPreview({
  expectedRevision: editor.state.revision,
  previewId: gesture.previewId,
});
detach();
evaluation.dispose();
console.log(
  'PASS workspace projection connects current V4 source/evaluation to original creation intents without a second writable model',
);
