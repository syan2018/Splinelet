import assert from 'node:assert/strict';
import { createDocument } from '../../../src/lib/document/schema.mjs';
import { createEditorSession } from '../../../src/lib/editing/dispatcher.mjs';
import { createAuthoringCommand } from '../../../src/lib/editing/commands/authoring.mjs';
import { evaluateDocument } from '../../../src/lib/evaluation/evaluate-document.mjs';
import { projectCreationView } from '../../../src/lib/editor/creation-view.mjs';
import {
  aggregatePrintPlacements,
  printPlacementFor,
} from '../../../src/lib/editor/print-placement.mjs';

assert.deepEqual(
  aggregatePrintPlacements([
    { kind: 'layer', layerId: 'upper' },
    { kind: 'layer', layerId: 'upper' },
  ]),
  { kind: 'layer', layerId: 'upper' },
);
assert.deepEqual(
  aggregatePrintPlacements(
    [
      { kind: 'layer', layerId: 'upper' },
      { kind: 'layer', layerId: 'lower' },
      { kind: 'unassigned' },
    ],
    ['lower', 'upper'],
  ),
  { kind: 'mixed', layerIds: ['lower', 'upper'], includesUnassigned: true },
);
assert.deepEqual(
  aggregatePrintPlacements([
    { kind: 'mixed', layerIds: ['lower', 'upper'], includesUnassigned: false },
    { kind: 'layer', layerId: 'upper' },
  ]),
  { kind: 'mixed', layerIds: ['lower', 'upper'], includesUnassigned: false },
);
assert.deepEqual(aggregatePrintPlacements([{ kind: 'unassigned' }]), {
  kind: 'unassigned',
});
assert.deepEqual(aggregatePrintPlacements([]), { kind: 'unavailable' });
assert.deepEqual(printPlacementFor({ kind: 'free', zMM: 4 }), {
  kind: 'unassigned',
});

let serial = 0;
const idFactory = () => `print-placement-${++serial}`;
const session = createEditorSession(createDocument({ idFactory }), {
  idFactory,
});
const dispatch = (action) =>
  session.dispatch(createAuthoringCommand(action), {
    expectedRevision: session.state.revision,
  });
const square = (x) => [
  [x, 0],
  [x + 8, 0],
  [x + 8, 8],
  [x, 8],
];

dispatch({ kind: 'draw-path', closed: true, points: square(0) });
const shapeId = Object.values(session.state.document.nodes).find(
  (node) => node.kind === 'shape',
).id;
dispatch({
  kind: 'draw-path',
  ownerNodeId: shapeId,
  closed: true,
  points: square(12),
});
dispatch({ kind: 'create-print-layer', name: '底层' });
dispatch({ kind: 'create-print-layer', name: '顶层' });
const [lower, upper] = session.state.document.manufacturing.layerOrder;
const regions = (
  await evaluateDocument(session.state.document, {
    requestedDomains: ['regions'],
  })
).regions[0].value.regions;
assert.equal(regions.length, 2);
for (const [index, region] of regions.entries())
  dispatch({
    kind: 'set-relief',
    target: region.ref,
    value: {
      enabled: true,
      thickness: { kind: 'layers', count: 2 },
      mode: 'add',
      placement: { kind: 'layer', layerId: index ? upper : lower, offsetMM: 0 },
    },
  });

const snapshot = await evaluateDocument(session.state.document, {
  requestedDomains: ['regions', 'relief', 'placed-relief'],
});
const view = projectCreationView(session.state.document, snapshot);
const object = view.creation.objects.find((item) => item.id === shapeId);
assert.deepEqual(object.printPlacement, {
  kind: 'mixed',
  layerIds: [lower, upper],
  includesUnassigned: false,
});
assert.equal(
  object.printLayerId,
  '',
  'the compatibility scalar stays blank for mixed placements',
);
assert.deepEqual(
  view.cells
    .map((cell) => cell.printLayerId)
    .sort((left, right) => left.localeCompare(right)),
  [lower, upper].sort((left, right) => left.localeCompare(right)),
);

console.log(
  'PASS explicit print placement distinguishes a single Shape with mixed region layers',
);
