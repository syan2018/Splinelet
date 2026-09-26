import assert from 'node:assert/strict';
import { createDocument } from '../../../src/lib/document/schema.mjs';
import { createEditorSession } from '../../../src/lib/editing/dispatcher.mjs';
import { createAuthoringCommand } from '../../../src/lib/editing/commands/authoring.mjs';
import { createAdvancedCommand } from '../../../src/lib/editing/commands/advanced.mjs';
import { evaluatePlanar } from '../../../src/lib/construction/document-evaluation.mjs';
import { createPlanarStageCache } from '../../../src/lib/evaluation/planar-stage-cache.mjs';
import { definitionRef } from '../../../src/lib/construction/region-definitions.mjs';
import { readGeometry } from '../../../src/lib/region-engine.mjs';
import {
  encodeDocument,
  decodeDocument,
} from '../../../src/lib/document/codec.mjs';
import {
  transformPoint,
  worldMatrix,
} from '../../../src/lib/scene/transforms.mjs';

let serial = 0;
const idFactory = () => `select-test-${++serial}`;
const editor = createEditorSession(createDocument({ version: 5, idFactory }), {
  idFactory,
});
const run = (action) =>
  editor.dispatch(createAuthoringCommand(action), {
    expectedRevision: editor.state.revision,
  });
run({
  kind: 'draw-path',
  points: [
    [0, 0],
    [12, 0],
    [12, 12],
    [0, 12],
  ],
  closed: true,
});
const owner = Object.keys(editor.state.document.nodes)[0];
const initial = evaluatePlanar(editor.state.document).published[
  `${owner}:regions`
].value.regions[0].ref;
run({
  kind: 'start-path',
  role: 'divider',
  point: [6, -1],
  ownerNodeId: owner,
  targets: [initial],
});
const cutter = Object.values(editor.state.document.sketches).at(-1);
const pathId = Object.keys(cutter.paths)[0];
run({
  kind: 'extend-path',
  sketchId: cutter.id,
  pathId,
  cubic: [
    [6, -1],
    [6, -1],
    [6, 13],
    [6, 13],
  ],
});
run({ kind: 'finish-path', sketchId: cutter.id, pathId });
const base = structuredClone(editor.state.document);
const program = base.programs[base.nodes[owner].programId];
const partition = Object.values(program.operators).find(
  (op) => op.type === 'partition',
);
assert.equal(
  evaluatePlanar(base).components[`operator:${partition.id}`].ports.regions
    .value.regions.length,
  2,
);
const port = (id) => ({
  kind: 'port',
  ownerNodeId: owner,
  operatorId: id,
  port: 'regions',
  domain: 'regions',
  space: 'local-result',
  transform: [1, 0, 0, 1, 0, 0],
});
const publishedPort = (id) => {
  const { space: _space, transform: _transform, ...ref } = port(id);
  return ref;
};
const addSelection = (id, anchors) => {
  program.operators[id] = {
    id,
    name: id,
    type: 'region-select',
    enabled: true,
    inputs: { input: [port(partition.id)] },
    params: { anchors, merge: 'union', coverage: 'one-per-anchor' },
  };
  const definition = {
    id: `${id}-result`,
    context: {
      ownerNodeId: owner,
      operatorId: id,
      port: 'regions',
      instances: [],
    },
    selector: { kind: 'result', role: 'selection' },
  };
  base.regionDefinitions[definition.id] = definition;
  return definitionRef(definition);
};
const selected = addSelection('all-selected', [
  [2, 2],
  [10, 2],
]);
program.outputs.regions = publishedPort('all-selected');
const cache = createPlanarStageCache();
const before = cache.evaluate(base);
const selectedStage = (snapshot, id = 'all-selected') =>
  snapshot.components[`operator:${id}`].ports.regions;
assert.equal(selectedStage(before).status, 'ready');
assert.deepEqual(selectedStage(before).value.regions[0].ref, selected);
assert.ok(
  Math.abs(
    readGeometry(selectedStage(before).value.regions[0].geometry).getArea() -
      144,
  ) < 1e-8,
);
const afterDoc = structuredClone(base);
for (const vertex of Object.values(afterDoc.sketches[cutter.id].vertices))
  vertex.position.value[0] += 14;
const after = cache.evaluate(afterDoc);
assert.equal(
  after.components[`operator:${partition.id}`].ports.regions.value.regions
    .length,
  1,
);
assert.equal(selectedStage(after).status, 'ready');
assert.deepEqual(
  selectedStage(after).value.regions[0].ref,
  selected,
  'named selection result survives declared same-group merge',
);
assert.equal(
  selectedStage(after).value.regions[0].selectionClaims.length,
  1,
  'duplicate hits are explicitly deduplicated',
);
assert.deepEqual(
  after,
  evaluatePlanar(afterDoc),
  'warm and cold outputs agree',
);
const reopened = decodeDocument(encodeDocument(afterDoc)).document;
assert.deepEqual(
  selectedStage(evaluatePlanar(reopened)).value,
  selectedStage(evaluatePlanar(afterDoc)).value,
);
assert.deepEqual(selectedStage(evaluatePlanar(reopened)).diagnostics, []);
const missing = structuredClone(afterDoc);
missing.programs[program.id].operators['all-selected'].params.anchors = [
  [30, 30],
];
assert.equal(
  selectedStage(evaluatePlanar(missing)).diagnostics[0].code,
  'selection-anchor-missing',
);
const boundary = structuredClone(afterDoc);
boundary.programs[program.id].operators['all-selected'].params.anchors = [
  [0, 0],
];
assert.equal(
  selectedStage(evaluatePlanar(boundary)).status,
  'blocked',
  'boundary point never snaps to a neighbouring cell',
);
addSelection('left-selected', [[2, 2]]);
addSelection('right-selected', [[10, 2]]);
program.operators['groups'] = {
  id: 'groups',
  name: 'groups',
  type: 'region-collect',
  enabled: true,
  inputs: { input: [port('left-selected'), port('right-selected')] },
  params: { disjointSelections: true },
};
program.outputs.regions = publishedPort('groups');
assert.equal(
  evaluatePlanar(base).published[`${owner}:regions`].status,
  'ready',
);
const conflict = structuredClone(base);
conflict.sketches[cutter.id] = afterDoc.sketches[cutter.id];
assert.equal(
  evaluatePlanar(conflict).published[`${owner}:regions`].diagnostics[0].code,
  'selection-groups-overlap',
  'different authored groups cannot silently merge',
);
console.log(
  'Explicit region selection, topology merge, conflict and persistence passed',
);

// Copy and rebase must use the V5 registry for both declarative-only steps.
// This is deliberately an authored program, then real dispatcher transactions:
// no fixture-level ID substitution can disguise an old V4 registry fallback.
let transactionSerial = 0;
const transactionId = () => `select-transaction-${++transactionSerial}`;
let transaction = createEditorSession(
  createDocument({ version: 5, idFactory: transactionId }),
  { idFactory: transactionId },
);
const authorTransaction = (action) =>
  transaction.dispatch(createAuthoringCommand(action), {
    expectedRevision: transaction.state.revision,
  });
const advancedTransaction = (action) =>
  transaction.dispatch(createAdvancedCommand(action), {
    expectedRevision: transaction.state.revision,
  });
authorTransaction({
  kind: 'draw-path',
  closed: true,
  points: [
    [0, 0],
    [12, 0],
    [12, 12],
    [0, 12],
  ],
});
const transactionDocument = structuredClone(transaction.state.document);
const transactionOwnerId = Object.keys(transactionDocument.nodes)[0];
const transactionProgram =
  transactionDocument.programs[
    transactionDocument.nodes[transactionOwnerId].programId
  ];
const sourceOperatorId = transactionProgram.outputs.curves.operatorId;
const boundaryOperatorId = transactionProgram.outputs.regions.operatorId;
const transactionSketch = Object.values(transactionDocument.sketches)[0];
const sourcePathId = Object.keys(transactionSketch.paths)[0];
const localPort = (operatorId, port, domain) => ({
  kind: 'port',
  ownerNodeId: transactionOwnerId,
  operatorId,
  port,
  domain,
  space: 'local-result',
  transform: [1, 0, 0, 1, 0, 0],
});
const attachId = transactionId();
const attachFillId = transactionId();
const selectId = transactionId();
const selectionDefinitionId = transactionId();
transactionProgram.operators[attachId] = {
  id: attachId,
  name: 'explicit endpoint attach',
  type: 'curve-endpoint-attach',
  enabled: true,
  inputs: {
    input: [localPort(sourceOperatorId, 'curves', 'curves')],
    boundary: [localPort(boundaryOperatorId, 'regions', 'regions')],
  },
  params: {
    endpointJoin: {
      toleranceMM: 0.25,
      cohorts: [[sourcePathId]],
      disabled: [{ pathId: sourcePathId, endpoint: 0 }],
    },
  },
};
transactionProgram.operators[attachFillId] = {
  id: attachFillId,
  name: 'attached fill',
  type: 'fill',
  enabled: true,
  inputs: { input: [localPort(attachId, 'curves', 'curves')] },
  params: { rule: 'even-odd' },
};
transactionProgram.operators[selectId] = {
  id: selectId,
  name: 'explicit selection',
  type: 'region-select',
  enabled: true,
  inputs: { input: [localPort(attachFillId, 'regions', 'regions')] },
  params: { anchors: [[3, 3]], merge: 'union', coverage: 'one-per-anchor' },
};
transactionDocument.regionDefinitions[selectionDefinitionId] = {
  id: selectionDefinitionId,
  context: {
    ownerNodeId: transactionOwnerId,
    operatorId: selectId,
    port: 'regions',
    instances: [],
  },
  selector: { kind: 'result', role: 'selection' },
};
transactionProgram.outputs = {
  curves: {
    kind: 'port',
    ownerNodeId: transactionOwnerId,
    operatorId: attachId,
    port: 'curves',
    domain: 'curves',
  },
  regions: {
    kind: 'port',
    ownerNodeId: transactionOwnerId,
    operatorId: selectId,
    port: 'regions',
    domain: 'regions',
  },
};
transaction = createEditorSession(transactionDocument, {
  idFactory: transactionId,
});
const transactionStage = (document, port) => {
  const stage =
    evaluatePlanar(document).published[`${transactionOwnerId}:${port}`];
  assert.equal(stage.status, 'ready', JSON.stringify(stage.diagnostics));
  return stage;
};
const nearPoint = (actual, expected, message) =>
  assert.ok(
    actual.every((value, index) => Math.abs(value - expected[index]) < 1e-8),
    `${message}: ${JSON.stringify(actual)} !== ${JSON.stringify(expected)}`,
  );
const beforeRebase = structuredClone(transaction.state.document);
const beforeAnchor = structuredClone(
  beforeRebase.programs[transactionProgram.id].operators[selectId].params
    .anchors[0],
);
const beforeAnchorWorld = transformPoint(
  worldMatrix(beforeRebase, transactionOwnerId),
  beforeAnchor,
);
const beforeCurveWorld = transformPoint(
  worldMatrix(beforeRebase, transactionOwnerId),
  transactionStage(beforeRebase, 'curves').value.curves[0].edges[0].cubic[0],
);
advancedTransaction({
  kind: 'rebase-node',
  nodeId: transactionOwnerId,
  pose: { translationMM: [4, -3], rotationRad: 0.35 },
});
const rebased = transaction.state.document;
const rebasedOperator =
  rebased.programs[transactionProgram.id].operators[selectId];
assert.notDeepEqual(
  rebasedOperator.params.anchors[0],
  beforeAnchor,
  'region-select rebase must express anchors in the new local frame',
);
nearPoint(
  transformPoint(
    worldMatrix(rebased, transactionOwnerId),
    rebasedOperator.params.anchors[0],
  ),
  beforeAnchorWorld,
  'region-select anchor retains its world target through rebase',
);
nearPoint(
  transformPoint(
    worldMatrix(rebased, transactionOwnerId),
    transactionStage(rebased, 'curves').value.curves[0].edges[0].cubic[0],
  ),
  beforeCurveWorld,
  'endpoint attach chain retains world curve geometry through rebase',
);

advancedTransaction({ kind: 'copy-nodes', nodeIds: [transactionOwnerId] });
const copiedOwnerId = transaction.state.lastChange.selectionIntent.activeRef.id;
assert.notEqual(copiedOwnerId, transactionOwnerId);
const copiedProgram =
  transaction.state.document.programs[
    transaction.state.document.nodes[copiedOwnerId].programId
  ];
const copiedAttach = Object.values(copiedProgram.operators).find(
  (operator) => operator.type === 'curve-endpoint-attach',
);
const copiedSelect = Object.values(copiedProgram.operators).find(
  (operator) => operator.type === 'region-select',
);
assert.ok(copiedAttach, 'V5 copy preserves the endpoint attach operator');
assert.ok(copiedSelect, 'V5 copy preserves the declarative select operator');
const copiedSource =
  copiedProgram.operators[copiedAttach.inputs.input[0].operatorId];
const copiedPathId = copiedSource.inputs.paths[0].pathIds[0];
assert.notEqual(copiedPathId, sourcePathId);
assert.equal(copiedAttach.inputs.input[0].ownerNodeId, copiedOwnerId);
assert.notEqual(copiedAttach.inputs.input[0].operatorId, sourceOperatorId);
assert.deepEqual(copiedAttach.params.endpointJoin.cohorts, [[copiedPathId]]);
assert.deepEqual(copiedAttach.params.endpointJoin.disabled, [
  { pathId: copiedPathId, endpoint: 0 },
]);
assert.equal(copiedSelect.inputs.input[0].ownerNodeId, copiedOwnerId);
assert.notEqual(copiedSelect.inputs.input[0].operatorId, attachFillId);
assert.ok(
  Object.values(transaction.state.document.regionDefinitions).some(
    (definition) =>
      definition.context.ownerNodeId === copiedOwnerId &&
      definition.context.operatorId === copiedSelect.id,
  ),
  'copied select has a copied V5 result definition instead of an old owner reference',
);
assert.equal(
  evaluatePlanar(transaction.state.document).published[
    `${copiedOwnerId}:regions`
  ].status,
  'ready',
  'the copied explicit Select/Attach chain is evaluable without old references',
);

console.log(
  'PASS V5 copy/rebase remap explicit Select and endpoint attach paths without world drift',
);
