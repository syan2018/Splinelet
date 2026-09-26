import assert from 'node:assert/strict';
import { createDocument } from '../../../src/lib/document/schema.mjs';
import { createEditorSession } from '../../../src/lib/editing/dispatcher.mjs';
import { createAuthoringCommand } from '../../../src/lib/editing/commands/authoring.mjs';
import { evaluateProgram } from '../../../src/lib/construction/document-evaluation.mjs';
import {
  createModelRegionDeletionCommand,
  finalizePreparedModelConstruction,
  previewModelConstruction,
} from '../../../src/lib/editor/model-construction.mjs';
import { createRegionContribution } from '../../../src/lib/editor/model-contributions.mjs';
import { readGeometry } from '../../../src/lib/region-engine.mjs';

let serial = 0;
const idFactory = () => `v5-model-consumer-${++serial}`;
const editor = createEditorSession(createDocument({ version: 5, idFactory }), {
  idFactory,
});
const run = (command) =>
  editor.dispatch(command, { expectedRevision: editor.state.revision });
const action = (request) => run(createAuthoringCommand(request));

action({
  kind: 'draw-path',
  closed: true,
  points: [
    [0, 0],
    [10, 0],
    [10, 10],
    [0, 10],
  ],
});
const ownerNodeId = Object.keys(editor.state.document.nodes)[0];
action({
  kind: 'draw-path',
  ownerNodeId,
  closed: true,
  points: [
    [20, 0],
    [30, 0],
    [30, 10],
    [20, 10],
  ],
});
const regions = (owner = ownerNodeId) => {
  const stage = evaluateProgram(editor.state.document, owner).regions;
  assert.equal(stage.status, 'ready', JSON.stringify(stage.diagnostics));
  return stage.value.regions;
};
const regionAt = (x, owner = ownerNodeId) =>
  regions(owner).find(
    (region) =>
      Math.abs(readGeometry(region.geometry).getCentroid().getX() - x) < 1e-8,
  );
const paint = (name, color, target, thickness, x) => {
  action({ kind: 'create-swatch', name, color });
  const swatchId = Object.keys(editor.state.document.appearances.swatches).at(
    -1,
  );
  action({ kind: 'paint-region', target, swatchId });
  const current = regionAt(x);
  action({
    kind: 'set-thickness',
    target: current.ref,
    thickness: { kind: 'mm', value: thickness },
  });
  return swatchId;
};
const left = regionAt(5);
const leftSwatch = paint('left', '#ff0000', left.ref, 1.25, 5);
const right = regionAt(25);
const rightSwatch = paint('right', '#0000ff', right.ref, 2.5, 25);
const retained = regionAt(25);
const removed = regionAt(5);
const retainedGeometry = readGeometry(retained.geometry);
const contribution = run((document, context) => {
  const result = createRegionContribution(
    document,
    retained.ref,
    { enabled: true, thickness: { kind: 'mm', value: 3.5 } },
    { partId: document.manufacturing.defaultPartId },
    context,
  );
  return { document: result.document, changedRefs: [result.target] };
});
const consumerRef = contribution.lastChange.changedRefs[0];
const consumerOwner = consumerRef.ownerNodeId;
const consumerProgram = () =>
  editor.state.document.programs[
    editor.state.document.nodes[consumerOwner].programId
  ];
const consumerOperator = () =>
  consumerProgram().operators[consumerProgram().outputs.regions.operatorId];
assert.deepEqual(consumerOperator().params.scope.refs, [retained.ref]);

run(
  createModelRegionDeletionCommand([removed.ref], { discardAssignments: true }),
);
assert.equal(regions().length, 1, 'deleting one V5 region retains its sibling');
const remaining = regionAt(25);
assert.ok(remaining, 'the right physical region remains published');
assert.equal(
  readGeometry(remaining.geometry).symDifference(retainedGeometry).getArea(),
  0,
  'deleting the left region does not distort the retained geometry',
);
const appearance = Object.values(
  editor.state.document.appearances.overrides,
).find((record) => record.target.key === remaining.ref.key);
const relief = Object.values(
  editor.state.document.reliefDefinitions.overrides,
).find((record) => record.target.key === remaining.ref.key);
assert.equal(appearance?.value.swatchId, rightSwatch);
assert.equal(relief?.value.thickness.value, 2.5);
assert.equal(
  Object.values(editor.state.document.appearances.overrides).some(
    (record) => record.value.swatchId === leftSwatch,
  ),
  false,
  'discarding the left region removes only its assignments',
);
assert.deepEqual(
  consumerOperator().params.scope.refs,
  [remaining.ref],
  'the independent V5 consumer scope follows the explicit retained reference',
);
const consumerStage = evaluateProgram(
  editor.state.document,
  consumerOwner,
).regions;
assert.equal(
  consumerStage.status,
  'ready',
  JSON.stringify(consumerStage.diagnostics),
);
assert.equal(consumerStage.value.regions.length, 1);
assert.equal(consumerStage.value.regions[0].ref.key, consumerRef.key);
const consumerRelief = Object.values(
  editor.state.document.reliefDefinitions.overrides,
).find((record) => record.target.key === consumerRef.key);
assert.equal(consumerRelief?.value.thickness.value, 3.5);

const subsetEditor = createEditorSession(
  createDocument({ version: 5, idFactory }),
  { idFactory },
);
const runSubset = (command) =>
  subsetEditor.dispatch(command, {
    expectedRevision: subsetEditor.state.revision,
  });
const subsetAction = (request) => runSubset(createAuthoringCommand(request));
subsetAction({
  kind: 'draw-path',
  closed: true,
  points: [
    [0, 0],
    [20, 0],
    [20, 20],
    [0, 20],
  ],
});
const subsetOwner = Object.keys(subsetEditor.state.document.nodes)[0];
const subsetRegions = (owner = subsetOwner) => {
  const stage = evaluateProgram(subsetEditor.state.document, owner).regions;
  assert.equal(stage.status, 'ready', JSON.stringify(stage.diagnostics));
  return stage.value.regions;
};
subsetAction({ kind: 'create-swatch', name: 'subset', color: '#00aa00' });
subsetAction({
  kind: 'paint-region',
  target: subsetRegions()[0].ref,
  swatchId: Object.keys(subsetEditor.state.document.appearances.swatches)[0],
});
subsetAction({
  kind: 'draw-path',
  ownerNodeId: subsetOwner,
  closed: false,
  points: [
    [10, 0],
    [10, 20],
  ],
});
const subsetDivider = Object.values(subsetEditor.state.document.sketches)
  .filter((sketch) => sketch.ownerNodeId === subsetOwner)
  .flatMap((sketch) =>
    Object.values(sketch.paths).map((path) => ({ sketch, path })),
  )
  .find(({ sketch, path }) => {
    const edge = sketch.edges[path.edges[0].edgeId];
    return sketch.vertices[edge.startVertexId].position.value[0] === 10;
  });
assert.ok(subsetDivider, 'the V5 preview has a divider path');
const subsetBase = subsetRegions()[0].ref;
let selectedCandidate;
runSubset((document, context) => {
  const preview = previewModelConstruction(
    document,
    {
      kind: 'split',
      baseRef: subsetBase,
      pathIds: [subsetDivider.path.id],
      joinMM: 0.15,
    },
    {
      paths: {
        [subsetDivider.path.id]: {
          kind: 'path',
          sketchId: subsetDivider.sketch.id,
          id: subsetDivider.path.id,
        },
      },
    },
    context,
  );
  assert.equal(preview.candidates.length, 2);
  selectedCandidate = readGeometry(preview.candidates[0].geometry);
  return finalizePreparedModelConstruction(
    preview,
    { indices: [0], name: 'V5 subset' },
    context,
  );
});
const subsetRef = subsetEditor.state.lastChange.changedRefs[0];
assert.equal(subsetRegions(subsetRef.ownerNodeId).length, 1);
assert.equal(
  readGeometry(subsetRegions(subsetRef.ownerNodeId)[0].geometry)
    .symDifference(selectedCandidate)
    .getArea(),
  0,
  'candidate subset publishes the selected physical face',
);
assert.equal(
  Object.values(subsetEditor.state.document.regionPresentations.overrides).find(
    (record) => record.target.key === subsetRef.key,
  )?.name,
  'V5 subset',
  'candidate subset binds its selected V5 reference without legacy key parsing',
);

console.log(
  'PASS: V5 region selection remaps retained assignments and explicit consumers without legacy identities',
);
