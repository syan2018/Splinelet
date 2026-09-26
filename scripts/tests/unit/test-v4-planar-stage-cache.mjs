import assert from 'node:assert/strict';
import { createDocument } from '../../../src/lib/document/schema.mjs';
import { createEditorSession } from '../../../src/lib/editing/dispatcher.mjs';
import { createAuthoringCommand } from '../../../src/lib/editing/commands/authoring.mjs';
import { evaluateDocument } from '../../../src/lib/evaluation/evaluate-document.mjs';
import { createPlanarStageCache } from '../../../src/lib/evaluation/planar-stage-cache.mjs';
import { evaluateConstruction } from '../../../src/lib/construction/evaluate.mjs';
import { createOperatorRegistry } from '../../../src/lib/construction/registry.mjs';

let serial = 0;
const idFactory = () => `stage-cache-${++serial}`;
const editor = createEditorSession(createDocument({ version: 4, idFactory }), {
  idFactory,
});
for (let x = 0; x < 3; x++)
  editor.dispatch(
    createAuthoringCommand({
      kind: 'draw-path',
      points: [
        [x, 0],
        [x + 1, 0],
        [x + 1, 1],
      ],
      closed: true,
    }),
    { expectedRevision: editor.state.revision },
  );
const document = structuredClone(editor.state.document);
const [source, receiver, independent] = Object.values(document.nodes);
const sourceProgram = document.programs[source.programId];
const receiverProgram = document.programs[receiver.programId];
receiverProgram.operators = {
  reference: {
    id: 'reference',
    name: 'Reference',
    type: 'curve-reference',
    enabled: true,
    inputs: {
      input: [
        {
          ...sourceProgram.outputs.curves,
          space: 'world-result',
          transform: [1, 0, 0, 1, 0, 0],
        },
      ],
    },
    params: {},
  },
};
receiverProgram.outputs = {
  curves: {
    kind: 'port',
    ownerNodeId: receiver.id,
    operatorId: 'reference',
    port: 'curves',
    domain: 'curves',
  },
};
const requestedDomains = ['curves', 'regions', 'relief', 'placed-relief'];
const planarStageCache = createPlanarStageCache();
const evaluate = (doc, extra = {}) =>
  evaluateDocument(doc, { requestedDomains, planarStageCache, ...extra });
let previous = await evaluate(document);
assert.equal(
  previous.planar.published[`${receiver.id}:curves`].status,
  'ready',
);
const check = async (doc, extra = {}) => {
  const result = await evaluate(doc, extra);
  assert.deepEqual(
    result,
    await evaluateDocument(doc, { requestedDomains, ...extra }),
    'cached result equals complete cold evaluation',
  );
  previous = result;
  return result;
};
const moved = structuredClone(document);
moved.nodes[independent.id].pose.translationMM = [10, 20];
moved.nodes[independent.id].pose.rotationRad = 0.4;
await check(moved);
await check(document); // undo remains equivalent to a cold local result
const movedSource = structuredClone(document);
movedSource.nodes[source.id].pose.translationMM[0] = 5;
await check(movedSource);
const movedReceiver = structuredClone(movedSource);
movedReceiver.nodes[receiver.id].pose.translationMM[1] = 7;
await check(movedReceiver);
const grouped = structuredClone(movedReceiver);
grouped.nodes.group = {
  id: 'group',
  name: 'Group',
  kind: 'group',
  parentId: null,
  order: 5,
  pose: { translationMM: [0, 0], rotationRad: 0 },
  visible: true,
  locked: false,
};
grouped.nodes[source.id].parentId = 'group';
await check(grouped);
grouped.nodes.group.pose.translationMM[0] = 9;
await check(grouped); // ancestor changes the referenced world frame
const edited = structuredClone(grouped);
edited.geometrySettings.curveToleranceMM /= 2;
await check(edited);
await check(edited, { requestedDomains: ['curves'] });
const invalid = structuredClone(edited);
invalid.nodes[independent.id].pose.rotationRad = NaN;
await assert.rejects(evaluate(invalid), /无效|有限/);
const custom = { resolveScalar: ({ value }) => ({ status: 'ready', value }) };
await check(edited, custom);
await check(edited, custom);
const withDatum = structuredClone(edited);
withDatum.datums.axis = {
  id: 'axis',
  name: 'Axis',
  ownerNodeId: null,
  kind: 'axis',
  origin: [0, 0],
  angleRad: 0,
};
await check(withDatum);
await check(withDatum);
const unknown = structuredClone(edited);
unknown.programs[receiver.programId].operators.reference.type =
  'future-operator';
await check(unknown);
await check(unknown);
assert.deepEqual(document.nodes[independent.id].pose.translationMM, [0, 0]);

const calls = new Map();
const counterRegistry = createOperatorRegistry([
  {
    type: 'counter',
    inputPorts: { input: { domain: 'curves', min: 0, max: 1 } },
    outputPorts: { curves: { domain: 'curves' } },
    dependencies: ({ operator }) => [
      'settings:geometry',
      ...(operator.params.parameterId
        ? [`parameter:${operator.params.parameterId}`]
        : []),
      ...(operator.params.relationId
        ? [`relation:${operator.params.relationId}`]
        : []),
    ],
    evaluate: ({ operator, ownerNodeId }) => {
      calls.set(operator.id, (calls.get(operator.id) || 0) + 1);
      return {
        curves: {
          domain: 'curves',
          status: 'empty',
          diagnostics: [],
          dependencies: [],
          value: {
            frame: { kind: 'local', ownerNodeId },
            curves: [],
            junctions: [],
            provenance: [],
          },
        },
      };
    },
  },
]);
const counterNode = (id) => ({
  id,
  parentId: null,
  pose: { translationMM: [0, 0], rotationRad: 0 },
});
const counterProgram = (
  ownerNodeId,
  operatorId,
  inputs = {},
  params = { point: [0, 0] },
) => ({
  ownerNodeId,
  operators: {
    [operatorId]: {
      id: operatorId,
      name: operatorId,
      type: 'counter',
      enabled: true,
      inputs,
      params,
    },
  },
  outputs: {
    curves: {
      kind: 'port',
      ownerNodeId,
      operatorId,
      port: 'curves',
      domain: 'curves',
    },
  },
});
const counterDocument = () => ({
  id: 'same-document-id',
  version: 4,
  geometrySettings: { curveToleranceMM: 0.1 },
  nodes: { a: counterNode('a'), b: counterNode('b') },
  sketches: {},
  datums: {},
  relations: { joint: { value: 1 } },
  parameters: { distance: { value: 1 } },
  programs: {
    a: counterProgram('a', 'counter-a'),
    b: counterProgram(
      'b',
      'counter-b',
      {},
      {
        point: [0, 0],
        parameterId: 'distance',
        relationId: 'joint',
      },
    ),
  },
  manufacturing: {
    swatches: { blue: { id: 'blue', name: 'Blue', color: '#0000ff' } },
    parts: { part: { thickness: { kind: 'mm', value: 1 } } },
  },
});
const runCounter = (value, cache) =>
  evaluateConstruction(value, { registry: counterRegistry, cache });

const operatorCache = new Map();
const counted = counterDocument();
runCounter(counted, operatorCache);
assert.deepEqual(Object.fromEntries(calls), { 'counter-a': 1, 'counter-b': 1 });
const onePointEdited = structuredClone(counted);
onePointEdited.programs.a.operators['counter-a'].params.point[0] = 3;
runCounter(onePointEdited, operatorCache);
assert.deepEqual(
  Object.fromEntries(calls),
  { 'counter-a': 2, 'counter-b': 1 },
  'editing one shape does not rerun an independent shape kernel',
);
const styled = structuredClone(onePointEdited);
styled.manufacturing.swatches.blue.color = '#00ff00';
styled.manufacturing.parts.part.thickness.value = 2;
runCounter(styled, operatorCache);
assert.deepEqual(
  Object.fromEntries(calls),
  { 'counter-a': 2, 'counter-b': 1 },
  'color and manufacturing thickness do not invalidate planar kernels',
);
const parameterEdited = structuredClone(styled);
parameterEdited.parameters.distance.value = 2;
runCounter(parameterEdited, operatorCache);
assert.deepEqual(Object.fromEntries(calls), {
  'counter-a': 2,
  'counter-b': 2,
});
const relationEdited = structuredClone(parameterEdited);
relationEdited.relations.joint.value = 2;
runCounter(relationEdited, operatorCache);
assert.deepEqual(Object.fromEntries(calls), {
  'counter-a': 2,
  'counter-b': 3,
});
const toleranceEdited = structuredClone(relationEdited);
toleranceEdited.geometrySettings.curveToleranceMM = 0.05;
runCounter(toleranceEdited, operatorCache);
assert.deepEqual(Object.fromEntries(calls), {
  'counter-a': 3,
  'counter-b': 4,
});
const nextDefinitions = structuredClone(toleranceEdited);
nextDefinitions.regionDefinitions = { ruleVersion: 5 };
runCounter(nextDefinitions, operatorCache);
assert.deepEqual(Object.fromEntries(calls), {
  'counter-a': 4,
  'counter-b': 5,
});
const coldCounter = runCounter(nextDefinitions, new Map());
assert.deepEqual(
  runCounter(nextDefinitions, operatorCache),
  coldCounter,
  'per-operator cache results equal a cold construction evaluation',
);
const deleted = structuredClone(nextDefinitions);
delete deleted.programs.b.operators['counter-b'];
deleted.programs.b.outputs = {};
runCounter(deleted, operatorCache);
assert.equal(
  operatorCache.has('operator:counter-b'),
  false,
  'deleted operators release their retained entry',
);

calls.clear();
const worldCache = new Map();
const worldDocument = counterDocument();
worldDocument.programs.b = counterProgram(
  'b',
  'counter-b',
  {
    input: [
      {
        ...worldDocument.programs.a.outputs.curves,
        space: 'world-result',
        transform: [1, 0, 0, 1, 0, 0],
      },
    ],
  },
  { point: [0, 0], parameterId: 'distance', relationId: 'joint' },
);
runCounter(worldDocument, worldCache);
const movedWorldSource = structuredClone(worldDocument);
movedWorldSource.nodes.a.pose.translationMM[0] = 4;
runCounter(movedWorldSource, worldCache);
const movedWorldReceiver = structuredClone(movedWorldSource);
movedWorldReceiver.nodes.b.pose.translationMM[1] = 6;
runCounter(movedWorldReceiver, worldCache);
assert.deepEqual(
  Object.fromEntries(calls),
  { 'counter-a': 1, 'counter-b': 3 },
  'world-result consumers track both source and receiver world frames',
);
runCounter(movedWorldReceiver, new Map());
assert.deepEqual(
  Object.fromEntries(calls),
  { 'counter-a': 2, 'counter-b': 4 },
  'a new evaluation session does not share entries despite the same document id',
);
console.log(
  'PASS: per-operator planar entries track direct dependencies, world frames, settings and deletion while matching cold evaluation',
);
