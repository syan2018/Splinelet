import assert from 'node:assert/strict';
import {
  createDocument,
  validateDocument,
} from '../../../src/lib/document/schema.mjs';
import { createEditorSession } from '../../../src/lib/editing/dispatcher.mjs';
import { createAuthoringCommand } from '../../../src/lib/editing/commands/authoring.mjs';
import { createEvaluationSession } from '../../../src/lib/evaluation/session.mjs';
import { evaluateDocument } from '../../../src/lib/evaluation/evaluate-document.mjs';
import { projectWorkspaceView } from '../../../src/lib/editor/workspace-view.mjs';
import { projectStudioDisplay } from '../../../src/lib/editor/studio-display.mjs';

let sequence = 0;
const idFactory = () => `studio-display-${++sequence}`;
const document = createDocument({ idFactory });
const frame = { width: 800, height: 600, widthMM: 100 };
const pixelToWorld = [0.125, 0, 0, -0.125, -50, 37.5];
document.assets['reference-asset'] = {
  id: 'reference-asset',
  path: 'assets/reference.png',
  mediaType: 'image/png',
  size: 4,
  sha256: '0'.repeat(64),
};
document.references['reference-image'] = {
  id: 'reference-image',
  assetId: 'reference-asset',
  name: '参考图.png',
  pixelWidth: frame.width,
  pixelHeight: frame.height,
  pixelToWorld,
  visible: true,
  locked: true,
  opacity: 0.72,
};
validateDocument(document);

const editor = createEditorSession(document, { idFactory });
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
await evaluation.request({ domains });
const evaluated = evaluation.capture({
  epoch: editor.state.epoch,
  revision: editor.state.revision,
  domains,
});
const workspace = projectWorkspaceView(editor.state, evaluated, frame);
const documentBeforeProjection = structuredClone(editor.state.document);
const presentation = {
  reference: {
    ...editor.state.document.references['reference-image'],
    url: 'blob:v4-reference-image',
  },
  frame,
  session: {
    newReliefDepthMM: 2.4,
    fileName: 'sample.spl',
    storageStatus: '有修改未保存',
    dirty: true,
  },
};

const display = projectStudioDisplay(workspace, presentation);
assert.equal(display.kind, 'v4-studio-display');
assert.deepEqual(display.identity, {
  epoch: editor.state.epoch,
  revision: editor.state.revision,
  previewId: null,
});
assert.equal(display.project.version, 4);
assert.equal(display.project.image, 'blob:v4-reference-image');
assert.equal(display.project.imageName, '参考图.png');
assert.equal(display.project.width, 800);
assert.equal(display.project.height, 600);
assert.equal(display.project.widthMM, 100);
assert.equal(display.project.depthMM, 2.4);
assert.equal(Object.hasOwn(display.project, 'model'), false);
assert.equal(Object.hasOwn(display.project, 'groups'), false);
assert.deepEqual(display.project.paths, workspace.source.paths);
assert.deepEqual(display.project.creation, workspace.creation.creation);
assert.deepEqual(display.reference.pixelToWorld, pixelToWorld);
assert.deepEqual(display.frame, frame);

const path = display.project.paths[0];
const sourceSketch = Object.values(editor.state.document.sketches)[0];
const sourcePath = Object.values(sourceSketch.paths)[0];
assert.deepEqual(path.curves[0][0], { x: 400, y: 300 });
assert.deepEqual(path.curves[0][3], { x: 480, y: 300 });
assert.equal(path.closed, true);
assert.deepEqual(
  display.source.identities.paths[path.id],
  { kind: 'path', sketchId: sourceSketch.id, id: sourcePath.id },
  'the Studio display retains the V4 source identity lookup',
);

assert(Object.isFrozen(display));
assert(Object.isFrozen(display.project));
assert(Object.isFrozen(display.project.paths[0].curves[0][0]));
assert(Object.isFrozen(display.project.creation.objects[0]));
assert(Object.isFrozen(display.reference));
assert(Object.isFrozen(display.session));
assert.throws(() => {
  display.project.width = 1;
}, TypeError);
assert.throws(() => {
  display.project.paths[0].name = '被修改';
}, TypeError);
assert.deepEqual(
  editor.state.document,
  documentBeforeProjection,
  'display projection cannot write reference URLs or view coordinates into V4',
);
assert.equal(Object.isFrozen(presentation), false);
presentation.session.newReliefDepthMM = 9;
assert.equal(display.project.depthMM, 2.4, 'presentation input is cloned');

assert.throws(
  () =>
    projectStudioDisplay(workspace, { frame, session: presentation.session }),
  /reference 必须显式提供/,
);
assert.throws(
  () =>
    projectStudioDisplay(workspace, {
      ...presentation,
      frame: { ...frame, width: 801 },
    }),
  /像素尺寸/,
);
assert.throws(
  () =>
    projectStudioDisplay(workspace, {
      ...presentation,
      reference: {
        ...presentation.reference,
        pixelToWorld: [0.125, 0, 0, -0.125, -49, 37.5],
      },
    }),
  /仿射/,
);
assert.throws(
  () =>
    projectStudioDisplay(workspace, {
      ...presentation,
      session: { ...presentation.session, newReliefDepthMM: undefined },
    }),
  /默认厚度/,
);
assert.throws(
  () =>
    projectStudioDisplay({ ...workspace, creation: undefined }, presentation),
  /完整的 V4 workspace view/,
);

const noReferenceEditor = createEditorSession(createDocument({ idFactory }), {
  idFactory,
});
noReferenceEditor.dispatch(
  createAuthoringCommand({
    kind: 'draw-path',
    closed: false,
    points: [
      [-5, 0],
      [5, 0],
    ],
  }),
  { expectedRevision: 0 },
);
const noReferenceEvaluation = createEvaluationSession({
  capabilities: domains,
  evaluate: (request) =>
    evaluateDocument(request.document, { requestedDomains: request.domains }),
});
const detachNoReference = noReferenceEvaluation.attach(noReferenceEditor);
await noReferenceEvaluation.request({ domains });
const noReferenceWorkspace = projectWorkspaceView(
  noReferenceEditor.state,
  noReferenceEvaluation.capture({
    epoch: noReferenceEditor.state.epoch,
    revision: noReferenceEditor.state.revision,
    domains,
  }),
  frame,
);
const noReferenceDocumentBefore = structuredClone(
  noReferenceEditor.state.document,
);
const noReferenceDisplay = projectStudioDisplay(noReferenceWorkspace, {
  reference: null,
  frame,
  session: {
    newReliefDepthMM: 1.6,
    fileName: null,
    storageStatus: '',
    dirty: false,
  },
});
assert.equal(noReferenceDisplay.reference, null);
assert.equal(noReferenceDisplay.project.image, '');
assert.equal(noReferenceDisplay.project.imageName, '');
assert.deepEqual(
  noReferenceDisplay.project.paths,
  noReferenceWorkspace.source.paths,
);
assert.deepEqual(
  noReferenceDisplay.project.creation,
  noReferenceWorkspace.creation.creation,
);
assert.deepEqual(noReferenceEditor.state.document.references, {});
assert.deepEqual(noReferenceEditor.state.document, noReferenceDocumentBefore);
assert(Object.isFrozen(noReferenceDisplay.project.paths));

detachNoReference();
noReferenceEvaluation.dispose();

detach();
evaluation.dispose();
console.log(
  'PASS V4 Studio display is an explicit frozen render facade over source and creation views',
);
