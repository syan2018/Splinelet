import assert from 'node:assert/strict';
import { createDocument } from '../../../src/lib/document/schema.mjs';
import { createEditorSession } from '../../../src/lib/editing/dispatcher.mjs';
import { createAuthoringCommand } from '../../../src/lib/editing/commands/authoring.mjs';
import { evaluateDocument } from '../../../src/lib/evaluation/evaluate-document.mjs';
import { createPlanarStageCache } from '../../../src/lib/evaluation/planar-stage-cache.mjs';

let serial = 0;
const idFactory = () => `stage-cache-${++serial}`;
const editor = createEditorSession(createDocument({ idFactory }), {
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
const check = async (doc, reused, extra = {}) => {
  const result = await evaluate(doc, extra);
  assert.equal(result.planar === previous.planar, reused);
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
await check(moved, true);
await check(document, true); // undo uses the same local result
const movedSource = structuredClone(document);
movedSource.nodes[source.id].pose.translationMM[0] = 5;
await check(movedSource, false);
const movedReceiver = structuredClone(movedSource);
movedReceiver.nodes[receiver.id].pose.translationMM[1] = 7;
await check(movedReceiver, false);
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
await check(grouped, false);
grouped.nodes.group.pose.translationMM[0] = 9;
await check(grouped, false); // ancestor changes the referenced world frame
const edited = structuredClone(grouped);
edited.geometrySettings.curveToleranceMM /= 2;
await check(edited, false);
await check(edited, false, { requestedDomains: ['curves'] });
const invalid = structuredClone(edited);
invalid.nodes[independent.id].pose.rotationRad = NaN;
await assert.rejects(evaluate(invalid), /无效|有限/);
const custom = { resolveScalar: ({ value }) => ({ status: 'ready', value }) };
await check(edited, false, custom);
await check(edited, false, custom);
const withDatum = structuredClone(edited);
withDatum.datums.axis = {
  id: 'axis',
  name: 'Axis',
  ownerNodeId: null,
  kind: 'axis',
  origin: [0, 0],
  angleRad: 0,
};
await check(withDatum, false);
await check(withDatum, false);
const unknown = structuredClone(edited);
unknown.programs[receiver.programId].operators.reference.type =
  'future-operator';
await check(unknown, false);
await check(unknown, false);
assert.deepEqual(document.nodes[independent.id].pose.translationMM, [0, 0]);
console.log(
  'PASS: local stages reuse unrelated poses; world frames, ancestors, domains, settings, validation and custom resolvers remain authoritative',
);
