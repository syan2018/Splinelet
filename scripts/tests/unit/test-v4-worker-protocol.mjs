import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import { createDocument } from '../../../src/lib/document/schema.mjs';
import {
  createEvaluationSession,
  createWorkerClient,
} from '../../../src/lib/evaluation/session.mjs';

const deferred = () => {
  let resolve;
  let reject;
  return {
    promise: new Promise((nextResolve, nextReject) => {
      resolve = nextResolve;
      reject = nextReject;
    }),
    resolve,
    reject,
  };
};
const editorState = (epoch, revision, previewId = null) => ({
  epoch,
  revision,
  previewId,
  document: { id: `document-${epoch}-${revision}`, revision },
  ...(previewId
    ? {
        preview: {
          id: previewId,
          document: { id: `preview-${String(previewId)}` },
        },
      }
    : {}),
});
const snapshot = (name) => ({
  name,
  components: {},
  published: {},
  diagnostics: [],
});

// A gesture keeps one previewId while each pointer frame changes its draft.
const frameGates = [];
const frameSession = createEvaluationSession({
  capabilities: ['curves'],
  evaluate: (request) => {
    const gate = deferred();
    frameGates.push({ request, ...gate });
    return gate.promise;
  },
});
const firstFrame = editorState('gesture', 0, 'same-preview');
firstFrame.preview.document.x = 1;
frameSession.update(firstFrame);
const firstResult = frameSession.request({ domains: ['curves'] });
const rejectedFrame = assert.rejects(firstResult, /作废|过期/);
const secondFrame = structuredClone(firstFrame);
secondFrame.preview.document.x = 2;
frameSession.update(secondFrame);
const secondResult = frameSession.request({ domains: ['curves'] });
assert.equal(frameGates[1].request.document.x, 2);
frameGates[1].resolve(snapshot('second-frame'));
await secondResult;
frameGates[0].resolve(snapshot('stale-first-frame'));
await rejectedFrame;
assert.equal(
  Object.values(frameSession.state.results)[0].snapshot.name,
  'second-frame',
);
frameSession.dispose();

const late = deferred();
const currentGate = deferred();
const delayedSession = createEvaluationSession({
  evaluate: (request) =>
    request.revision === 1 ? late.promise : currentGate.promise,
  capabilities: ['curves'],
  idFactory: () => 'request',
});
delayedSession.update(editorState('open-a', 1));
const staleRequest = delayedSession.request({ domains: ['curves'] });
delayedSession.update(editorState('open-a', 2));
const currentRequest = delayedSession.request({ domains: ['curves'] });
currentGate.resolve(snapshot('current'));
await currentRequest;
late.resolve(snapshot('old'));
await assert.rejects(staleRequest, /作废|过期/);
assert.equal(
  Object.values(delayedSession.state.results)[0].snapshot.name,
  'current',
  'late results from an old committed revision cannot overwrite current stages',
);

const replaceGate = deferred();
const replacementSession = createEvaluationSession({
  evaluate: () => replaceGate.promise,
  capabilities: ['curves'],
  idFactory: () => 'replace',
});
replacementSession.update(editorState('old-project', 0));
const oldProject = replacementSession.request({ domains: ['curves'] });
replacementSession.update(editorState('new-project', 0));
replaceGate.resolve(snapshot('wrong-project'));
await assert.rejects(oldProject, /作废/);
assert.equal(replacementSession.state.current.epoch, 'new-project');

const previewRequests = [];
const previewGates = [];
const previewSession = createEvaluationSession({
  evaluate: (request) => {
    previewRequests.push(request);
    const gate = deferred();
    previewGates.push(gate);
    return gate.promise;
  },
  capabilities: ['curves'],
  idFactory: () => 'stable',
});
previewSession.update(editorState('open-b', 3, 'preview-1'));
const cancelled = previewSession.request({ domains: ['curves'] });
previewSession.update(editorState('open-b', 3));
await assert.rejects(cancelled, /作废/);
previewSession.update(editorState('open-b', 3, 'preview-2'));
const replacementPreview = previewSession.request({ domains: ['curves'] });
assert.notEqual(
  previewRequests[0].requestId,
  previewRequests[1].requestId,
  'cancelled previews never reuse a request identity',
);
previewGates[0].resolve(snapshot('cancelled-preview'));
previewGates[1].resolve(snapshot('new-preview'));
await replacementPreview;
assert.equal(
  Object.values(previewSession.state.results)[0].snapshot.name,
  'new-preview',
);

const perDomain = new Map();
const domainSession = createEvaluationSession({
  evaluate: (request) => {
    const gate = deferred();
    perDomain.set(request.domains.join(','), gate);
    return gate.promise;
  },
  capabilities: ['curves', 'regions'],
  idFactory: () => 'domain',
});
domainSession.update(editorState('open-c', 4));
const curves = domainSession.request({ domains: ['curves'] });
const regions = domainSession.request({ domains: ['regions'] });
perDomain.get('regions').resolve(snapshot('regions'));
await regions;
perDomain.get('curves').resolve(snapshot('curves'));
await curves;
assert.deepEqual(
  Object.values(domainSession.state.results)
    .map((entry) => entry.snapshot.name)
    .sort((a, b) => a.localeCompare(b)),
  ['curves', 'regions'],
  'same revision results are isolated by their requested domain set',
);

let failureMode = false;
const failureSession = createEvaluationSession({
  evaluate: () => {
    if (failureMode) throw Error('service offline');
    return snapshot('last-valid');
  },
  capabilities: ['curves'],
  idFactory: () => 'failure',
});
failureSession.update(editorState('open-d', 5));
await failureSession.request({ domains: ['curves'] });
failureMode = true;
await failureSession.request({ domains: ['curves'] });
assert.equal(
  Object.values(failureSession.state.results)[0].snapshot.name,
  'last-valid',
  'same revision reuses its completed stage without calling the backend',
);
failureSession.update(editorState('open-d', 6));
await assert.rejects(
  failureSession.request({ domains: ['curves'] }),
  /service offline/,
);
assert.deepEqual(
  Object.values(failureSession.state.results),
  [],
  'a new revision cannot retain the previous valid result after a service failure',
);
assert.equal(
  Object.values(failureSession.state.failures)[0].error,
  'service offline',
);
failureMode = false;
await failureSession.request({ domains: ['curves'] });
assert.deepEqual(
  Object.values(failureSession.state.failures),
  [],
  'failed requests can be retried',
);

let unavailableCalls = 0;
const unavailableSession = createEvaluationSession({
  evaluate: () => {
    unavailableCalls += 1;
    return snapshot('must-not-run');
  },
  capabilities: ['curves'],
  idFactory: () => 'unavailable',
});
unavailableSession.update(editorState('open-e', 6));
await unavailableSession.request({ domains: ['bodies'] });
assert.equal(unavailableCalls, 0);
assert.equal(
  Object.values(unavailableSession.state.results)[0].status,
  'unavailable',
);

const forgedSession = createEvaluationSession({
  evaluate: (request) => ({
    ...request,
    kind: 'result',
    requestId: 'forged-request',
    snapshot: snapshot('forged'),
  }),
  capabilities: ['curves'],
  idFactory: () => 'forged',
});
forgedSession.update(editorState('open-forged', 1));
await assert.rejects(
  forgedSession.request({ domains: ['curves'] }),
  /requestId.*不匹配/,
);

const exportGate = deferred();
const exportSession = createEvaluationSession({
  evaluate: () => exportGate.promise,
  capabilities: ['curves'],
  idFactory: () => 'export',
});
exportSession.update(editorState('open-f', 7));
const exportRequest = exportSession.request({ domains: ['curves'] });
const awaiting = exportSession.awaitCommittedSnapshot({
  epoch: 'open-f',
  revision: 7,
  domains: ['curves'],
});
exportGate.resolve(snapshot('exportable'));
await exportRequest;
const captured = await awaiting;
assert.equal(captured.snapshot.name, 'exportable');
assert.doesNotThrow(() => structuredClone(captured));
assert.throws(
  () =>
    exportSession.capture({
      epoch: 'open-f',
      revision: 6,
      domains: ['curves'],
    }),
  /过期/,
);

const evaluateUrl = new URL(
  '../../../src/lib/construction/evaluate.mjs',
  import.meta.url,
).href;
const registryUrl = new URL(
  '../../../src/lib/construction/registry.mjs',
  import.meta.url,
).href;
const worker = new Worker(
  `
    const { parentPort, workerData } = require('node:worker_threads');
    parentPort.on('message', async (request) => {
      try {
        const { evaluateConstruction } = await import(workerData.evaluateUrl);
        const { createOperatorRegistry } = await import(workerData.registryUrl);
        const registry = createOperatorRegistry([{
          type: 'test-empty', inputPorts: {}, outputPorts: { curves: { domain: 'curves' } },
          evaluate: ({ ownerNodeId }) => ({ curves: {
            domain: 'curves', status: 'empty', diagnostics: [], dependencies: [],
            value: { frame: { kind: 'local', ownerNodeId }, curves: [], junctions: [], provenance: [] }
          }})
        }]);
        const snapshot = evaluateConstruction(request.document, { registry, requestedDomains: request.domains });
        parentPort.postMessage({ ...request, kind: 'result', snapshot });
      } catch (error) {
        parentPort.postMessage({ ...request, kind: 'error', error: String(error.message || error) });
      }
    });
  `,
  { eval: true, workerData: { evaluateUrl, registryUrl } },
);
let workerIds = 0;
const document = createDocument({
  idFactory: () => `worker-id-${++workerIds}`,
});
document.nodes.shape = {
  id: 'shape',
  name: 'Shape',
  kind: 'shape',
  parentId: null,
  order: 0,
  pose: { translationMM: [0, 0], rotationRad: 0 },
  visible: true,
  locked: false,
  programId: 'program',
};
document.programs.program = {
  id: 'program',
  ownerNodeId: 'shape',
  operators: {
    empty: {
      id: 'empty',
      type: 'test-empty',
      name: 'Empty',
      enabled: true,
      inputs: {},
      params: {},
    },
  },
  outputs: {
    curves: {
      kind: 'port',
      ownerNodeId: 'shape',
      operatorId: 'empty',
      port: 'curves',
      domain: 'curves',
    },
  },
};
const workerSession = createEvaluationSession({
  workerClient: createWorkerClient(worker),
  capabilities: ['curves'],
  idFactory: () => 'worker-request',
});
workerSession.update({
  epoch: 'worker-open',
  revision: 0,
  previewId: null,
  document,
});
await workerSession.request({ domains: ['curves'] });
const workerCapture = workerSession.capture({
  epoch: 'worker-open',
  revision: 0,
  domains: ['curves'],
});
assert.equal(workerCapture.snapshot.published['shape:curves'].status, 'empty');
await worker.terminate();

console.log(
  'PASS: V4 worker protocol rejects stale identities, isolates domains, preserves valid stages, and transports a pure evaluator snapshot through worker_threads',
);
