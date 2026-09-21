import assert from 'node:assert/strict';
import { repeatedRingDocument } from '../fixtures/v4-programs.mjs';
import {
  createDocument,
  validateDocument,
} from '../../../src/lib/document/schema.mjs';
import { createStudioSession } from '../../../src/lib/editor/studio-session.mjs';
import { createAuthoringCommand } from '../../../src/lib/editing/commands/authoring.mjs';
import { createEditorSession } from '../../../src/lib/editing/dispatcher.mjs';
import { evaluateDocument } from '../../../src/lib/evaluation/evaluate-document.mjs';
import { projectCreationView } from '../../../src/lib/editor/creation-view.mjs';
import { projectJoinEndpoints } from '../../../src/lib/editor/join-view.mjs';
import { validateJoinParams } from '../../../src/lib/document/join-params.mjs';

const domains = ['curves', 'regions', 'relief', 'placed-relief'];
const ring = repeatedRingDocument();
const evaluate = (document, requestedDomains = domains) =>
  evaluateDocument(document, { requestedDomains });
const cellState = async (document, requested) =>
  projectCreationView(document, await evaluate(document, requested)).cells[0];
assert.equal((await cellState(ring)).evaluation, 'disabled');
ring.reliefDefinitions.defaults.shape = {
  enabled: true,
  thickness: { kind: 'mm', value: 2 },
  mode: 'add',
  placement: { kind: 'free', zMM: 0 },
};
assert.equal(
  (await cellState(ring, ['curves', 'regions'])).evaluation,
  'unevaluated',
);
assert.equal((await cellState(ring)).evaluation, 'ready');
const excluded = structuredClone(ring);
excluded.manufacturing.excluded.push({ kind: 'node', id: 'shape' });
assert.equal((await cellState(excluded)).evaluation, 'excluded');
const blocked = structuredClone(ring);
blocked.reliefDefinitions.defaults.shape.placement = {
  kind: 'attached',
  target: { kind: 'node', id: 'shape' },
  offsetMM: 0,
};
assert.equal((await cellState(blocked)).evaluation, 'blocked');

// The host gives all current-document consumers the same broker. A candidate
// can share its base revision but must never enter that revision's cache.
const requests = [];
let delayed = null;
const host = createStudioSession({
  opened: { kind: 'v4', document: ring, assets: {}, target: null },
  presentation: {
    reference: null,
    frame: { width: 800, height: 600, widthMM: 100 },
    blenderExtrusionMM: 2,
    fileName: 'test.spl',
  },
  persistence: {
    writeFile: async () => {},
    drafts: { write: async () => {}, read: async () => null },
  },
  evaluate: async (document, options) => {
    requests.push({ options, document });
    if (delayed) await delayed;
    return evaluateDocument(document, options);
  },
});
let view = host.getSnapshot();
let state = await host.agentCall('document.get');
const apiEvaluate = (read = state, requested = domains) =>
  host.agentCall('evaluation.request', {
    epoch: read.epoch,
    revision: read.revision,
    domains: requested,
  });
const [scene] = await Promise.all([
  view.runtime.evaluate('creation', {}, view.project),
  apiEvaluate(),
  apiEvaluate(),
]);
assert.equal(
  requests.length,
  1,
  'concurrent GUI and Agent evaluation is one backend request',
);
await apiEvaluate();
await view.runtime.evaluate('model_workspace', {}, view.project);
assert.equal(requests.length, 1, 'completed current stages are reused');
const plan = await view.runtime.prepare(
  'height',
  { cellKeys: [scene.cells[0].key], heightMM: 5 },
  { project: view.project, scene },
);
const candidate = await view.runtime.evaluate('creation', {}, plan.project);
assert.equal(candidate.cells[0].heightMM, 5);
await apiEvaluate();
assert.equal(
  requests.length,
  2,
  'candidate evaluation is isolated from current cached data',
);
assert.equal(
  (await view.runtime.evaluate('creation', {}, view.project)).cells[0].heightMM,
  2,
);
await Promise.all([
  view.runtime.evaluate('solid', {}, view.project),
  apiEvaluate(state, ['bodies']),
]);
assert.equal(
  requests.length,
  3,
  'GUI and Agent also share complete BodySet work',
);

state = await host.agentCall('preview.begin', {
  expectedRevision: state.revision,
});
state = await host.agentCall('preview.update', {
  expectedRevision: state.revision,
  previewId: state.previewId,
  action: { kind: 'move-nodes', nodeIds: ['shape'], deltaMM: [1, 0] },
});
view = host.getSnapshot();
await Promise.all([
  view.runtime.evaluate('creation', {}, view.project),
  apiEvaluate(),
]);
assert.equal(requests.length, 4);
const priorFrame = view;
state = await host.agentCall('preview.update', {
  expectedRevision: state.revision,
  previewId: state.previewId,
  action: { kind: 'move-nodes', nodeIds: ['shape'], deltaMM: [2, 0] },
});
view = host.getSnapshot();
await Promise.all([
  view.runtime.evaluate('creation', {}, view.project),
  apiEvaluate(),
]);
assert.equal(
  requests.length,
  5,
  'same previewId with a new frame invalidates prior results',
);
await assert.rejects(
  priorFrame.runtime.evaluate('creation', {}, priorFrame.project),
  /过期|变化/,
);
assert.equal(
  requests[3].options.previewVersion + 1,
  requests[4].options.previewVersion,
);
state = await host.agentCall('preview.cancel', {
  expectedRevision: state.revision,
  previewId: state.previewId,
});
await apiEvaluate();
assert.equal(
  requests.length,
  6,
  'cancelled preview data is never reused for committed state',
);
let release;
delayed = new Promise((resolve) => {
  release = resolve;
});
state = await host.agentCall('authoring.run', {
  expectedRevision: state.revision,
  action: { kind: 'move-nodes', nodeIds: ['shape'], deltaMM: [3, 0] },
});
const pending = apiEvaluate();
const rejection = assert.rejects(pending, /作废|过期/);
await host.agentCall('authoring.run', {
  expectedRevision: state.revision,
  action: { kind: 'move-nodes', nodeIds: ['shape'], deltaMM: [4, 0] },
});
release();
await rejection;
host.dispose();

// Bad syntax is rejected by the transaction/schema, not blamed on a later Fill.
for (const corrupt of [
  (params) => {
    params.connections[0].a.edgeEnd.end = 'typo';
  },
  (params) => {
    params.connections[0].a.selector.index = -1;
  },
  (params) => {
    params.connections[0].a.selector.index = 'next';
  },
  (params) => {
    params.connections[0].b.selector.wrap = 'true';
  },
  (params) => {
    params.connections[0].a.instances.push(
      params.connections[0].a.instances[0],
    );
  },
]) {
  const document = repeatedRingDocument();
  const params = document.programs.program.operators.join.params;
  corrupt(params);
  assert.notEqual(validateJoinParams(params), true);
  assert.throws(() => validateDocument(document), /Join/);
  const editor = createEditorSession(repeatedRingDocument());
  const before = editor.state;
  assert.throws(
    () =>
      editor.dispatch(
        createAuthoringCommand({
          kind: 'set-operator',
          ownerNodeId: 'shape',
          operatorId: 'join',
          params,
        }),
        { expectedRevision: before.revision },
      ),
    /Join/,
  );
  assert.deepEqual(editor.state, before);
}
const incomplete = repeatedRingDocument();
incomplete.programs.program.operators.join.params.connections = [];
validateDocument(incomplete);
assert.equal(
  (await evaluate(incomplete)).regions[0].status,
  'blocked',
  'unfinished valid topology remains editable',
);

const editor = createEditorSession(createDocument());
editor.dispatch(
  createAuthoringCommand({
    kind: 'draw-path',
    name: '多段路径',
    closed: false,
    points: [
      [0, 0],
      [5, 0],
      [10, 0],
    ],
  }),
  { expectedRevision: 0 },
);
const curveStage = (await evaluate(editor.state.document, ['curves']))
  .curves[0];
const endpoints = projectJoinEndpoints(editor.state.document, curveStage);
assert.equal(endpoints.length, 4);
assert.equal(
  new Set(endpoints.map((option) => option.label)).size,
  4,
  'every source span endpoint has a distinct label',
);
assert.ok(endpoints.every((option) => option.cubic.length === 4));
console.log(
  'PASS cleanup: precise cell states, shared revision/preview evaluation, isolated candidates, strict Join schema and identifiable endpoints',
);
