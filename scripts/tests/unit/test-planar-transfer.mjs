import assert from 'node:assert/strict';
import { createDocument } from '../../../src/lib/document/schema.mjs';
import { createEditorSession } from '../../../src/lib/editing/dispatcher.mjs';
import { createAuthoringCommand } from '../../../src/lib/editing/commands/authoring.mjs';
import { evaluateDocument } from '../../../src/lib/evaluation/evaluate-document.mjs';
import { createPlanarStageCache } from '../../../src/lib/evaluation/planar-stage-cache.mjs';
import {
  createPlanarTransferEncoder,
  createPlanarTransferDecoder,
} from '../../../src/lib/evaluation/planar-transfer.mjs';

let serial = 0;
const idFactory = () => `transfer-${++serial}`;
const editor = createEditorSession(createDocument({ version: 5, idFactory }), {
  idFactory,
});
editor.dispatch(
  createAuthoringCommand({
    kind: 'draw-path',
    points: [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ],
    closed: true,
  }),
  { expectedRevision: 0 },
);
const document = editor.state.document;
const owner = Object.keys(document.nodes)[0];
const domains = ['curves', 'regions', 'relief', 'placed-relief'];
const planarStageCache = createPlanarStageCache();
const evaluate = (doc, requestedDomains = domains) =>
  evaluateDocument(doc, { requestedDomains, planarStageCache });
const encoder = createPlanarTransferEncoder();
const decoder = createPlanarTransferDecoder();
const request = (extra = {}) => ({
  kind: 'evaluate',
  requestId: idFactory(),
  epoch: 'open-a',
  revision: 1,
  previewId: null,
  domains,
  planarTransfer: true,
  ...extra,
});
const transmit = (input, snapshot, captured = decoder.capture(input)) => {
  const frame = encoder.encode(
    { ...input, ...(captured && { planarBase: captured.token }) },
    snapshot,
  );
  const response = structuredClone({ ...input, kind: 'result', ...frame });
  return {
    frame,
    response,
    captured,
    value: decoder.decode(response, captured),
  };
};

const initial = await evaluate(document);
const first = transmit(request(), initial);
assert.ok(first.frame.planarToken);
assert.deepEqual(first.value, initial);
assert.notEqual(
  first.value.planar,
  initial.planar,
  'a full frame crosses Worker clone',
);

const changed = structuredClone(document);
changed.reliefDefinitions.defaults[owner] = {
  enabled: true,
  thickness: { kind: 'mm', value: 3 },
  mode: 'add',
  placement: { kind: 'free', zMM: 0 },
};
changed.appearances.swatches.red = { id: 'red', name: 'Red', color: '#ff0000' };
changed.appearances.defaults[owner] = { swatchId: 'red' };
const secondSnapshot = await evaluate(changed);
assert.equal(secondSnapshot.planar, initial.planar);
const second = transmit(request({ revision: 2 }), secondSnapshot);
assert.equal(second.frame.planarBase, first.frame.planarToken);
assert.equal(Object.hasOwn(second.frame.snapshot, 'planar'), false);
assert.equal(second.value.planar, first.value.planar);
assert.equal(second.value.curves, first.value.curves);
assert.equal(second.value.regions, first.value.regions);
assert.deepEqual(
  second.value,
  secondSnapshot,
  'incremental transport equals the full evaluator',
);
assert.equal(second.value.worldRegions.value.regions[0].color, '#ff0000');
assert.throws(() => {
  second.value.regions[0].value.regions.length = 0;
}, TypeError);

assert.throws(() => decoder.decode(second.response, null), /基准/);
assert.throws(
  () =>
    decoder.decode(
      { ...second.response, planarBase: 'unknown' },
      second.captured,
    ),
  /基准/,
);
assert.throws(
  () => decoder.decode({ ...second.response, epoch: 'other' }, second.captured),
  /基准/,
);
assert.throws(
  () =>
    decoder.decode(
      { ...second.response, domains: ['curves'] },
      second.captured,
    ),
  /基准/,
);
assert.throws(
  () =>
    decoder.decode(
      {
        ...second.response,
        snapshot: { ...second.response.snapshot, planar: {} },
      },
      second.captured,
    ),
  /基准/,
);
const missed = encoder.encode(
  request({ revision: 3, planarBase: 'lost-token' }),
  secondSnapshot,
);
assert.ok(
  missed.planarToken,
  'an unacknowledged base always gets a full result',
);

// Responses may arrive in a different order. Each request keeps its own base.
const third = transmit(request({ revision: 3 }), secondSnapshot);
const pendingRequest = request({ revision: 4 });
const pendingBase = decoder.capture(pendingRequest);
const pendingFrame = encoder.encode(
  { ...pendingRequest, planarBase: pendingBase.token },
  secondSnapshot,
);
assert.ok(pendingFrame.planarBase);
const moved = structuredClone(changed);
moved.nodes[owner].pose.translationMM[0] = 10;
const movedSnapshot = await evaluate(moved);
const movedResult = transmit(request({ revision: 5 }), movedSnapshot);
assert.ok(movedResult.frame.planarToken);
assert.notEqual(movedResult.frame.planarToken, third.frame.planarToken);
const pendingValue = decoder.decode(
  structuredClone({ ...pendingRequest, kind: 'result', ...pendingFrame }),
  pendingBase,
);
assert.deepEqual(pendingValue, secondSnapshot);
assert.equal(pendingValue.planar, third.value.planar);
assert.notEqual(pendingValue.planar, movedResult.value.planar);

const curvesOnly = await evaluate(moved, ['curves']);
const partial = transmit(
  request({ revision: 5, domains: ['curves'] }),
  curvesOnly,
);
assert.ok(partial.frame.planarToken, 'changed domain sets get a full frame');
assert.deepEqual(partial.value, curvesOnly);
assert.deepEqual(partial.value.regions, []);
const reopened = transmit(
  request({ epoch: 'open-b', revision: 0, domains: ['curves'] }),
  curvesOnly,
);
assert.ok(
  reopened.frame.planarToken,
  'new epochs get a full frame even with the same object',
);

const preview = transmit(
  request({
    epoch: 'open-b',
    revision: 0,
    previewId: 'drag',
    previewVersion: 1,
    domains: ['curves'],
  }),
  curvesOnly,
);
assert.equal(preview.frame.planarBase, reopened.frame.planarToken);
assert.equal(preview.value.planar, reopened.value.planar);
const legacy = encoder.encode(request({ planarTransfer: false }), initial);
assert.deepEqual(Object.keys(legacy), ['snapshot']);
const freshWorker = createPlanarTransferEncoder();
const restart = freshWorker.encode(
  request({ planarBase: first.frame.planarToken }),
  initial,
);
assert.ok(restart.planarToken);
assert.notEqual(restart.planarToken, first.frame.planarToken);

// Mesh buffers are never made shareable by the planar transfer optimization.
const buffers = {
  ...initial,
  bodies: { positions: new Float32Array([1, 2, 3]) },
};
const typed = transmit(request(), buffers);
typed.response.snapshot.bodies.positions[0] = 99;
assert.equal(typed.value.bodies.positions[0], 1);
assert.throws(() => decoder.decode({ ...request(), snapshot: {} }), /不完整/);

console.log(
  'PASS: planar Worker frames reuse acknowledged immutable geometry and preserve current downstream data, domains, concurrency and buffers',
);
