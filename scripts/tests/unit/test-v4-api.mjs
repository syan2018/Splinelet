import assert from 'node:assert/strict';
import {
  createV4AgentAPI,
  V4AgentAPIError,
} from '../../../src/lib/agent/v4-api.mjs';
import {
  V4_AGENT_CORE_ACTIONS,
  V4_AGENT_OPTIONAL_ACTIONS,
  v4AgentActionNames,
  v4AgentCapabilityMetadata,
} from '../../../src/lib/agent/contract.mjs';
import { createDocument } from '../../../src/lib/document/schema.mjs';
import { createEditorSession } from '../../../src/lib/editing/dispatcher.mjs';
import { createAuthoringCommand } from '../../../src/lib/editing/commands/authoring.mjs';
import { createEvaluationSession } from '../../../src/lib/evaluation/session.mjs';
import { evaluateDocument } from '../../../src/lib/evaluation/evaluate-document.mjs';

const makeEditor = (prefix) => {
  let sequence = 0;
  const idFactory = () => `${prefix}-${++sequence}`;
  const document = createDocument({ version: 4, idFactory });
  document.appearances.swatches.red = {
    id: 'red',
    name: '红',
    color: '#ff0000',
  };
  return createEditorSession(document, { epoch: `${prefix}-epoch`, idFactory });
};
const draw = {
  kind: 'draw-path',
  name: 'API 方形',
  closed: true,
  points: [
    [0, 0],
    [10, 0],
    [10, 10],
    [0, 10],
  ],
};

const apiEditor = makeEditor('same');
const apiEvaluation = createEvaluationSession({
  capabilities: ['curves', 'regions'],
  idFactory: () => 'api-evaluation',
  evaluate: (request) =>
    evaluateDocument(request.document, { requestedDomains: request.domains }),
});
let exportCalls = 0;
const api = createV4AgentAPI({
  editorSession: apiEditor,
  evaluationSession: apiEvaluation,
  evaluationCapabilities: ['curves', 'regions'],
  exportFormats: [{ format: 'test-curves', stage: 'curves' }],
  exporter: async (snapshot, options) => {
    exportCalls += 1;
    return {
      format: options.format,
      identity: {
        epoch: snapshot.epoch,
        revision: snapshot.revision,
        previewId: snapshot.previewId,
      },
      hasPlanar: Boolean(snapshot.snapshot.planar),
    };
  },
});

assert.equal(api.version, '5.0');
const capabilities = await api.call('capabilities.get');
assert.equal(capabilities.documentVersion, 4);
assert.equal(api.capabilities.documentVersion, 4);
assert.deepEqual(capabilities.evaluationDomains, ['curves', 'regions']);
assert.equal(capabilities.legacy.write, false);
assert.equal(capabilities.preparedWrites, false);
assert.ok(capabilities.authoringActions.includes('draw-path'));
assert.ok(!capabilities.authoringActions.includes('partition'));
assert.deepEqual(
  capabilities.actions,
  v4AgentActionNames({
    evaluation: true,
    exportAvailable: true,
  }),
  'capability action names are derived from the public contract',
);
assert.ok(!capabilities.actions.includes(V4_AGENT_OPTIONAL_ACTIONS.selection));

const contractWithoutOptionalHosts = v4AgentCapabilityMetadata({
  authoringActions: ['draw-path'],
});
assert.deepEqual(contractWithoutOptionalHosts.actions, V4_AGENT_CORE_ACTIONS);
assert.equal(contractWithoutOptionalHosts.legacy.write, false);

const read = await api.call('document.get');
read.document.geometrySettings.curveToleranceMM = 99;
assert.equal(apiEditor.state.document.geometrySettings.curveToleranceMM, 0.015);
assert.equal(read.units, 'mm');

const guiEditor = makeEditor('same');
guiEditor.dispatch(createAuthoringCommand(draw), { expectedRevision: 0 });
const written = await api.call('authoring.run', {
  expectedRevision: 0,
  action: draw,
});
assert.deepEqual(
  written.document,
  guiEditor.state.document,
  'API and GUI dispatch the same authoring command',
);
assert.equal(written.revision, 1);

await assert.rejects(
  api.call('authoring.run', { action: { kind: 'create-shape' } }),
  (error) =>
    error instanceof V4AgentAPIError &&
    error.code === 'expected-revision-required',
);
await assert.rejects(
  api.call('authoring.run', {
    expectedRevision: 0,
    action: { kind: 'create-shape' },
  }),
  /陈旧 revision/,
);
await assert.rejects(
  api.call('authoring.run', {
    expectedRevision: 1,
    action: { kind: 'move-nodes', nodeIndexes: [0], deltaMM: [1, 0] },
  }),
  (error) => error.code === 'legacy-index-write',
);

const legacy = await api.call('legacy.read', {
  epoch: apiEditor.state.epoch,
  revision: 1,
});
assert.equal(legacy.compatibility.writeSupported, false);
assert.equal(legacy.nodes[0].ref.kind, 'node');
assert.equal(legacy.paths[0].ref.kind, 'path');
assert.equal('nodeIndex' in legacy.nodes[0], false);
await assert.rejects(
  api.call('legacy.write', { revision: 1 }),
  (error) => error.code === 'legacy-write-requires-migration',
);
await assert.rejects(
  api.call('legacy.read', { epoch: apiEditor.state.epoch, revision: 0 }),
  (error) => error.code === 'stale-snapshot',
);

const evaluated = await api.call('evaluation.request', {
  epoch: apiEditor.state.epoch,
  revision: 1,
  domains: ['regions', 'curves'],
});
assert.equal(evaluated.result.status, 'ready');
assert.equal(evaluated.result.snapshot.regions[0].status, 'ready');
await assert.rejects(
  api.call('evaluation.request', {
    epoch: apiEditor.state.epoch,
    revision: 1,
    domains: ['bodies'],
  }),
  (error) =>
    error.code === 'capability-unavailable' &&
    error.details.unavailableDomains[0] === 'bodies',
);

const preview = apiEditor.beginPreview({ expectedRevision: 1 });
await assert.rejects(
  api.call('export.run', {
    epoch: preview.epoch,
    revision: preview.revision,
    format: 'test-curves',
    stage: 'curves',
  }),
  (error) => error.code === 'preview-not-exportable',
);
assert.equal(exportCalls, 0);
apiEditor.cancelPreview({
  expectedRevision: preview.revision,
  previewId: preview.previewId,
});
const exported = await api.call('export.run', {
  epoch: apiEditor.state.epoch,
  revision: apiEditor.state.revision,
  format: 'test-curves',
  stage: 'curves',
});
assert.equal(exported.artifact.identity.previewId, null);
assert.equal(exported.artifact.identity.revision, 1);
assert.equal(exported.artifact.hasPlanar, true);
assert.equal(exportCalls, 1);

await api.call('undo', { expectedRevision: 1 });
assert.equal(apiEditor.state.revision, 2);
assert.equal(Object.keys(apiEditor.state.document.nodes).length, 0);
await assert.rejects(
  api.call('redo', { expectedRevision: 1 }),
  /陈旧 revision/,
);
await api.call('redo', { expectedRevision: 2 });
assert.equal(apiEditor.state.revision, 3);

const minimal = createV4AgentAPI({ editorSession: makeEditor('minimal') });
assert.equal(minimal.capabilities.selectionRead, false);
assert.deepEqual(minimal.capabilities.evaluationDomains, []);
assert.ok(!minimal.capabilities.actions.includes('export.run'));
assert.deepEqual(minimal.capabilities.actions, V4_AGENT_CORE_ACTIONS);
await assert.rejects(
  minimal.call('selection.get'),
  (error) => error.code === 'capability-unavailable',
);
await assert.rejects(
  minimal.call('editor.prepare', {}),
  (error) => error.code === 'unsupported-action',
);

console.log(
  'PASS: API 5.0 command parity, revision guards, stable legacy reads, capabilities, committed evaluation/export, and unavailable features.',
);
