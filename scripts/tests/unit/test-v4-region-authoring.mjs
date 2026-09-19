import assert from 'node:assert/strict';
import {
  evaluatePlanar,
  evaluateProgram,
} from '../../../src/lib/construction/document-evaluation.mjs';
import {
  outputIdentity,
  proposeAssignmentInheritance,
} from '../../../src/lib/construction/provenance.mjs';
import { createDocument } from '../../../src/lib/document/schema.mjs';
import { createAuthoringCommand } from '../../../src/lib/editing/commands/authoring.mjs';
import { createRegionCommand } from '../../../src/lib/editing/commands/regions.mjs';
import { createEditorSession } from '../../../src/lib/editing/dispatcher.mjs';
import { readGeometry } from '../../../src/lib/region-engine.mjs';

let serial = 0;
const idFactory = () => `region-author-${++serial}`;
const identity = () => [1, 0, 0, 1, 0, 0];
const dispatch = (session, command) =>
  session.dispatch(command, { expectedRevision: session.state.revision });
const author = (session, action) =>
  dispatch(session, createAuthoringCommand(action));
const square = (x, y, size) => [
  [x, y],
  [x + size, y],
  [x + size, y + size],
  [x, y + size],
];
const regionStage = (document, ownerNodeId) => {
  const stage = evaluatePlanar(document).published[`${ownerNodeId}:regions`];
  assert.equal(stage.status, 'ready', JSON.stringify(stage.diagnostics));
  return stage;
};
const byMinimumX = (regions) =>
  regions
    .slice()
    .sort(
      (left, right) =>
        readGeometry(left.geometry).getEnvelopeInternal().getMinX() -
        readGeometry(right.geometry).getEnvelopeInternal().getMinX(),
    );
const configuredDocument = () => {
  const document = createDocument({ idFactory });
  document.appearances.swatches.red = {
    id: 'red',
    name: '红色',
    color: '#ff0000',
  };
  return document;
};
const drawTwoRegions = (session) => {
  author(session, {
    kind: 'draw-path',
    points: square(0, 0, 10),
    closed: true,
  });
  const ownerNodeId = Object.keys(session.state.document.nodes)[0];
  author(session, {
    kind: 'draw-path',
    ownerNodeId,
    points: square(20, 0, 10),
    closed: true,
  });
  return ownerNodeId;
};
const paintAndThicken = (session, target) => {
  author(session, { kind: 'paint-region', target, swatchId: 'red' });
  author(session, {
    kind: 'set-thickness',
    target,
    thickness: { kind: 'mm', value: 3 },
  });
};

const partitionSession = createEditorSession(configuredDocument(), {
  idFactory,
});
const partitionShape = drawTwoRegions(partitionSession);
const initialPartitionRegions = byMinimumX(
  regionStage(partitionSession.state.document, partitionShape).value.regions,
);
let partitionTarget = initialPartitionRegions[0];
const retainedTarget = initialPartitionRegions[1];
paintAndThicken(partitionSession, partitionTarget.ref);
dispatch(partitionSession, (document, { idFactory: makeId }) => {
  const id = makeId();
  document.manufacturing.assignments[id] = {
    id,
    target: structuredClone(partitionTarget.ref),
    partId: document.manufacturing.defaultPartId,
  };
  document.manufacturing.excluded.push(structuredClone(partitionTarget.ref));
  return { document, changedRefs: [partitionTarget.ref] };
});
const sketchesBeforeCutter = new Set(
  Object.keys(partitionSession.state.document.sketches),
);
author(partitionSession, {
  kind: 'draw-path',
  ownerNodeId: partitionShape,
  points: [
    [5, -2],
    [5, 12],
  ],
  closed: false,
});
const partitionSketchId = Object.keys(
  partitionSession.state.document.sketches,
).find((id) => !sketchesBeforeCutter.has(id));
const partitionPathId = Object.keys(
  partitionSession.state.document.sketches[partitionSketchId].paths,
)[0];
partitionTarget = byMinimumX(
  regionStage(partitionSession.state.document, partitionShape).value.regions,
)[0];
const beforePartition = structuredClone(partitionSession.state.document);
const beforePartitionRevision = partitionSession.state.revision;
dispatch(
  partitionSession,
  createRegionCommand({
    kind: 'partition-regions',
    targets: [partitionTarget.ref],
    cutter: {
      kind: 'sketch',
      sketchId: partitionSketchId,
      pathIds: [partitionPathId],
    },
  }),
);
assert.equal(partitionSession.state.revision, beforePartitionRevision + 1);
const partitionDocument = partitionSession.state.document;
const partitionProgram =
  partitionDocument.programs[partitionDocument.nodes[partitionShape].programId];
const partitionOperator =
  partitionProgram.operators[partitionProgram.outputs.regions.operatorId];
assert.equal(partitionOperator.type, 'partition');
assert.ok(partitionOperator.outputContract?.members.length === 2);
const partitionRegions = regionStage(partitionDocument, partitionShape).value
  .regions;
assert.equal(partitionRegions.length, 3);
assert.ok(
  partitionRegions.some(
    (region) =>
      outputIdentity(region.ref) === outputIdentity(retainedTarget.ref),
  ),
  'the unselected published region keeps its exact OutputRef',
);
const partitionChildren = partitionRegions.filter(
  (region) => region.ref.operatorId === partitionOperator.id,
);
assert.deepEqual(
  partitionChildren
    .map((region) => readGeometry(region.geometry).getArea())
    .sort((a, b) => a - b),
  [50, 50],
);
const appearances = Object.values(partitionDocument.appearances.overrides);
const relief = Object.values(partitionDocument.reliefDefinitions.overrides);
const parts = Object.values(partitionDocument.manufacturing.assignments);
assert.equal(appearances.length, 2);
assert.equal(relief.length, 2);
assert.equal(parts.length, 2);
assert.equal(partitionDocument.manufacturing.excluded.length, 2);
for (const child of partitionChildren) {
  assert.ok(
    appearances.some(
      (item) => outputIdentity(item.target) === outputIdentity(child.ref),
    ),
  );
  assert.equal(
    relief.find(
      (item) => outputIdentity(item.target) === outputIdentity(child.ref),
    ).value.thickness.value,
    3,
  );
  assert.ok(
    parts.some(
      (item) => outputIdentity(item.target) === outputIdentity(child.ref),
    ),
  );
}
partitionSession.undo({ expectedRevision: partitionSession.state.revision });
assert.deepEqual(partitionSession.state.document, beforePartition);
const noOpRevision = partitionSession.state.revision;
dispatch(
  partitionSession,
  createRegionCommand({
    kind: 'partition-regions',
    targets: [],
    cutter: { kind: 'invalid-on-purpose' },
  }),
);
assert.equal(partitionSession.state.revision, noOpRevision);

const cutSession = createEditorSession(configuredDocument(), { idFactory });
const cutShape = drawTwoRegions(cutSession);
const [cutTarget, cutRetained] = byMinimumX(
  regionStage(cutSession.state.document, cutShape).value.regions,
);
paintAndThicken(cutSession, cutTarget.ref);
author(cutSession, {
  kind: 'draw-path',
  points: square(2, 2, 4),
  closed: true,
  name: '孔刀具',
});
const cutterShape = Object.values(cutSession.state.document.nodes).find(
  (node) => node.kind === 'shape' && node.id !== cutShape,
).id;
const cutterProgram =
  cutSession.state.document.programs[
    cutSession.state.document.nodes[cutterShape].programId
  ];
const cutterPort = {
  ...cutterProgram.outputs.curves,
  space: 'world-result',
  transform: identity(),
};
const beforeCut = structuredClone(cutSession.state.document);
const beforeCutRevision = cutSession.state.revision;
dispatch(
  cutSession,
  createRegionCommand({
    kind: 'cut-hole',
    targets: [cutTarget.ref],
    cutter: cutterPort,
  }),
);
assert.equal(cutSession.state.revision, beforeCutRevision + 1);
const cutDocument = cutSession.state.document;
const cutProgram = cutDocument.programs[cutDocument.nodes[cutShape].programId];
const booleanOperator =
  cutProgram.operators[cutProgram.outputs.regions.operatorId];
assert.equal(booleanOperator.type, 'boolean');
assert.equal(
  cutProgram.operators[booleanOperator.inputs.operand[0].operatorId].type,
  'fill',
);
const cutRegions = regionStage(cutDocument, cutShape).value.regions;
assert.equal(cutRegions.length, 2);
assert.ok(
  cutRegions.some(
    (region) => outputIdentity(region.ref) === outputIdentity(cutRetained.ref),
  ),
);
const cutResult = cutRegions.find(
  (region) => region.ref.operatorId === booleanOperator.id,
);
const cutGeometry = readGeometry(cutResult.geometry);
assert.equal(cutGeometry.getArea(), 84);
assert.equal(cutGeometry.getNumInteriorRing(), 1);
assert.equal(Object.values(cutDocument.appearances.overrides).length, 1);
assert.equal(
  Object.values(cutDocument.reliefDefinitions.overrides)[0].value.thickness
    .value,
  3,
);
cutSession.undo({ expectedRevision: cutSession.state.revision });
assert.deepEqual(cutSession.state.document, beforeCut);

author(cutSession, {
  kind: 'draw-path',
  points: [
    [1, 1],
    [4, 4],
  ],
  closed: false,
  name: '开放刀具',
});
const openCutterShape = Object.values(cutSession.state.document.nodes).find(
  (node) =>
    node.kind === 'shape' && node.id !== cutShape && node.id !== cutterShape,
).id;
const openCutterProgram =
  cutSession.state.document.programs[
    cutSession.state.document.nodes[openCutterShape].programId
  ];
const beforeFailure = structuredClone(cutSession.state.document);
const failureRevision = cutSession.state.revision;
assert.throws(
  () =>
    dispatch(
      cutSession,
      createRegionCommand({
        kind: 'cut-hole',
        targets: [cutTarget.ref],
        cutter: {
          ...openCutterProgram.outputs.curves,
          space: 'world-result',
          transform: identity(),
        },
      }),
    ),
  /无法生成有效结果|构面线条未闭合/,
);
assert.equal(cutSession.state.revision, failureRevision);
assert.deepEqual(cutSession.state.document, beforeFailure);

const unrelatedOwner = proposeAssignmentInheritance(
  [
    {
      ref: {
        ...partitionChildren[0].ref,
        ownerNodeId: 'another-shape',
      },
    },
  ],
  [{ id: 'paint', target: partitionTarget.ref, value: { swatchId: 'red' } }],
);
assert.equal(unrelatedOwner.proposals.length, 0);
assert.equal(unrelatedOwner.unresolved.length, 1);
const unrelatedInstance = proposeAssignmentInheritance(
  [
    {
      ref: {
        ...partitionChildren[0].ref,
        instances: [{ operatorId: 'array', index: 1 }],
      },
    },
  ],
  [{ id: 'paint', target: partitionTarget.ref, value: { swatchId: 'red' } }],
);
assert.equal(unrelatedInstance.proposals.length, 0);
assert.equal(unrelatedInstance.unresolved.length, 1);

assert.equal(
  evaluateProgram(cutSession.state.document, cutShape).regions.status,
  'ready',
);
console.log(
  'PASS: V4 region commands partition/cut exact targets, bind identities, migrate assignments atomically, and undo once.',
);
