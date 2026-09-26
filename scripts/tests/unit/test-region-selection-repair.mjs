import assert from 'node:assert/strict';
import { createDocument } from '../../../src/lib/document/schema.mjs';
import { createEditorSession } from '../../../src/lib/editing/dispatcher.mjs';
import { createAuthoringCommand } from '../../../src/lib/editing/commands/authoring.mjs';
import { createRebindRegionSelectionCommand } from '../../../src/lib/editing/commands/rebind-region-selection.mjs';
import { evaluateProgram } from '../../../src/lib/construction/document-evaluation.mjs';
import { evaluateDocument } from '../../../src/lib/evaluation/evaluate-document.mjs';
import {
  decodeDocument,
  encodeDocument,
} from '../../../src/lib/document/codec.mjs';
import { definitionRef } from '../../../src/lib/construction/region-definitions.mjs';
import { projectRegionSelectionRepairView } from '../../../src/lib/editor/region-selection-repair-view.mjs';

let serial = 0;
const idFactory = () => `region-selection-repair-${++serial}`;
const session = createEditorSession(createDocument({ version: 5, idFactory }), {
  idFactory,
});
const run = (action) =>
  session.dispatch(createAuthoringCommand(action), {
    expectedRevision: session.state.revision,
  });
const planar = async () =>
  (
    await evaluateDocument(session.state.document, {
      requestedDomains: ['regions'],
    })
  ).planar;

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
const ownerNodeId = Object.keys(session.state.document.nodes)[0];
const regions = () => {
  const stage = evaluateProgram(session.state.document, ownerNodeId).regions;
  assert.equal(stage.status, 'ready', JSON.stringify(stage.diagnostics));
  return stage.value.regions;
};

run({ kind: 'create-swatch', name: 'base', color: '#111111' });
run({ kind: 'create-swatch', name: 'left', color: '#cc2233' });
run({ kind: 'create-swatch', name: 'middle', color: '#2277cc' });
run({ kind: 'create-swatch', name: 'right', color: '#22aa66' });
const swatches = Object.values(session.state.document.appearances.swatches);
const initial = regions()[0].ref;
run({ kind: 'paint-region', target: initial, swatchId: swatches[0].id });
run({
  kind: 'set-thickness',
  target: regions()[0].ref,
  thickness: { kind: 'mm', value: 0.8 },
});

const knownSketches = new Set(Object.keys(session.state.document.sketches));
run({
  kind: 'start-path',
  role: 'divider',
  point: [-1, 2],
  ownerNodeId,
  targets: [regions()[0].ref],
});
const cutterSketch = Object.values(session.state.document.sketches).find(
  (sketch) => !knownSketches.has(sketch.id),
);
const cutterPathId = Object.keys(cutterSketch.paths)[0];
for (const [from, to] of [
  [
    [-1, 2],
    [13, 2],
  ],
  [
    [13, 2],
    [-1, 6],
  ],
  [
    [-1, 6],
    [13, 10],
  ],
])
  run({
    kind: 'extend-path',
    sketchId: cutterSketch.id,
    pathId: cutterPathId,
    cubic: [from, from, to, to],
  });
run({ kind: 'finish-path', sketchId: cutterSketch.id, pathId: cutterPathId });
assert.ok(regions().length >= 3, 'zigzag cutter creates several real regions');

regions()
  .slice()
  .sort((left, right) => left.ref.key.localeCompare(right.ref.key))
  .forEach((region, index) => {
    run({
      kind: 'paint-region',
      target: region.ref,
      swatchId: swatches[(index % 3) + 1].id,
    });
    run({
      kind: 'set-thickness',
      target: region.ref,
      thickness: { kind: 'mm', value: index + 1.25 },
    });
  });

const beforeTopologyChange = regions();
const producerId = beforeTopologyChange[0].ref.operatorId;
const savedAssignmentTargets = Object.fromEntries(
  Object.values(session.state.document.regionDefinitions)
    .filter((definition) => definition.context.operatorId === producerId)
    .map((definition) => [
      definition.id,
      {
        appearance: Object.values(
          session.state.document.appearances.overrides,
        ).find((item) => item.target.key === definition.id)?.target,
        relief: Object.values(
          session.state.document.reliefDefinitions.overrides,
        ).find((item) => item.target.key === definition.id)?.target,
      },
    ]),
);
assert.ok(
  Object.values(savedAssignmentTargets).every(
    (targets) => targets.appearance && targets.relief,
  ),
  'each bound definition owns downstream appearance and relief authority',
);

const path =
  session.state.document.sketches[cutterSketch.id].paths[cutterPathId];
const topologyVertexId =
  session.state.document.sketches[cutterSketch.id].edges[path.edges[1].edgeId]
    .startVertexId;
run({
  kind: 'set-vertex',
  sketchId: cutterSketch.id,
  vertexId: topologyVertexId,
  value: [-1, 2],
});
const changedPlanar = await planar();
let repairView = projectRegionSelectionRepairView(
  session.state.document,
  changedPlanar,
  ownerNodeId,
  producerId,
);
const missing = repairView.definitions.filter(
  (definition) => definition.status === 'missing',
);
assert.ok(
  missing.length >= 2,
  'real topology change leaves multiple definitions missing',
);
const target = missing[0];
assert.ok(
  savedAssignmentTargets[target.definitionId].appearance &&
    savedAssignmentTargets[target.definitionId].relief,
  'the stale definition owns downstream appearance and relief authority',
);
const oldCandidateRef = beforeTopologyChange.find(
  (region) => region.ref.key === target.definitionId,
)?.ref;
assert.ok(
  oldCandidateRef,
  'the missing definition had a previous exact candidate',
);
assert.throws(
  () =>
    createRebindRegionSelectionCommand(
      {
        definitionId: target.definitionId,
        candidateRef: oldCandidateRef,
        expectedContext: target.context,
      },
      { planar: changedPlanar },
    )(structuredClone(session.state.document)),
  /当前生产者的唯一候选/,
  'a prior candidate ref cannot select a topology-replaced face',
);

const donor = repairView.definitions.find(
  (definition) =>
    definition.definitionId !== target.definitionId &&
    definition.status === 'resolved',
);
assert.ok(
  donor,
  'a distinct resolved definition supplies a current unbound face',
);
const unboundDocument = structuredClone(session.state.document);
delete unboundDocument.regionDefinitions[donor.definitionId];
for (const records of [
  unboundDocument.appearances.overrides,
  unboundDocument.reliefDefinitions.overrides,
])
  for (const [id, assignment] of Object.entries(records))
    if (assignment.target.key === donor.definitionId) delete records[id];
delete savedAssignmentTargets[donor.definitionId];
session.replaceDocument(unboundDocument, {
  expectedRevision: session.state.revision,
});
const unboundPlanar = await planar();
repairView = projectRegionSelectionRepairView(
  session.state.document,
  unboundPlanar,
  ownerNodeId,
  producerId,
);
const currentTarget = repairView.definitions.find(
  (definition) => definition.definitionId === target.definitionId,
);
const available = currentTarget.candidates.find(
  (candidate) => !candidate.occupiedByDefinitionId,
);
assert.ok(
  available,
  'the user can explicitly select one current unoccupied face',
);
const beforeRebind = structuredClone(session.state.document);
session.dispatch(
  createRebindRegionSelectionCommand(
    {
      definitionId: target.definitionId,
      candidateRef: available.ref,
      expectedContext: currentTarget.context,
    },
    { planar: unboundPlanar },
  ),
  { expectedRevision: session.state.revision },
);
for (const [definitionId, targets] of Object.entries(savedAssignmentTargets)) {
  const definition = session.state.document.regionDefinitions[definitionId];
  assert.deepEqual(
    Object.values(session.state.document.appearances.overrides).find(
      (item) => item.target.key === definitionId,
    )?.target,
    targets.appearance,
    'rebind does not change downstream appearance authority',
  );
  assert.deepEqual(
    Object.values(session.state.document.reliefDefinitions.overrides).find(
      (item) => item.target.key === definitionId,
    )?.target,
    targets.relief,
    'rebind does not change downstream relief authority',
  );
  assert.deepEqual(definitionRef(definition).key, definitionId);
}
let reboundPlanar = await planar();
repairView = projectRegionSelectionRepairView(
  session.state.document,
  reboundPlanar,
  ownerNodeId,
  producerId,
);
assert.equal(
  repairView.definitions.find(
    (definition) => definition.definitionId === target.definitionId,
  ).status,
  'resolved',
  'manual selection binds the stable definition to the selected current face',
);

const conflicting = repairView.definitions.find(
  (definition) =>
    definition.definitionId !== target.definitionId &&
    definition.status === 'missing',
);
assert.ok(
  conflicting,
  'a second stale definition remains available for conflict testing',
);
const occupied = conflicting.candidates.find(
  (candidate) => candidate.occupiedByDefinitionId === target.definitionId,
);
assert.ok(
  occupied,
  'the selected face is shown as occupied rather than suggested',
);
assert.throws(
  () =>
    createRebindRegionSelectionCommand(
      {
        definitionId: conflicting.definitionId,
        candidateRef: occupied.ref,
        expectedContext: conflicting.context,
      },
      { planar: reboundPlanar },
    )(structuredClone(session.state.document)),
  /已被另一个区域定义占用/,
  'a conflicting explicit selection cannot merge or overwrite definitions',
);
assert.throws(
  () =>
    createRebindRegionSelectionCommand(
      {
        definitionId: target.definitionId,
        candidateRef: available.ref,
        expectedContext: { ...target.context, operatorId: 'stale-producer' },
      },
      { planar: reboundPlanar },
    )(structuredClone(session.state.document)),
  /生产者上下文已变化/,
  'the command rejects a stale producer context',
);
assert.throws(
  () =>
    createRebindRegionSelectionCommand(
      {
        definitionId: target.definitionId,
        candidateRef: available.ref,
        expectedContext: target.context,
        selector: available.selector,
      },
      { planar: reboundPlanar },
    )(structuredClone(session.state.document)),
  /不能携带 selector、geometry 或未知字段/,
  'the request cannot smuggle a selector or geometry past current-candidate validation',
);

session.undo({ expectedRevision: session.state.revision });
assert.deepEqual(
  session.state.document,
  beforeRebind,
  'undo restores the missing selector',
);
session.redo({ expectedRevision: session.state.revision });
reboundPlanar = await planar();
assert.equal(
  projectRegionSelectionRepairView(
    session.state.document,
    reboundPlanar,
    ownerNodeId,
    producerId,
  ).definitions.find(
    (definition) => definition.definitionId === target.definitionId,
  ).status,
  'resolved',
  'redo restores the explicitly selected binding',
);
const cold = decodeDocument(encodeDocument(session.state.document)).document;
const coldPlanar = (
  await evaluateDocument(cold, { requestedDomains: ['regions'] })
).planar;
assert.equal(
  projectRegionSelectionRepairView(
    cold,
    coldPlanar,
    ownerNodeId,
    producerId,
  ).definitions.find(
    (definition) => definition.definitionId === target.definitionId,
  ).status,
  'resolved',
  'the selection survives a native V5 save and cold reopen',
);

console.log(
  'PASS: V5 region selection repair only accepts exact current candidates and preserves downstream authority.',
);
