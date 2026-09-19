import assert from 'node:assert/strict';
import { createDocument } from '../../../src/lib/document/schema.mjs';
import { createEditorSession } from '../../../src/lib/editing/dispatcher.mjs';
import { createAuthoringCommand } from '../../../src/lib/editing/commands/authoring.mjs';
import { evaluateDocument } from '../../../src/lib/evaluation/evaluate-document.mjs';
import {
  worldMatrix,
  transformPoint,
} from '../../../src/lib/scene/transforms.mjs';
import {
  creationCellKey,
  projectCreationView,
} from '../../../src/lib/editor/creation-view.mjs';
import { sourcePathId } from '../../../src/lib/editor/source-view.mjs';

let serial = 0;
const idFactory = () => `creation-view-${++serial}`;
const session = createEditorSession(createDocument({ idFactory }), {
  idFactory,
});
const run = (action) =>
  session.dispatch(createAuthoringCommand(action), {
    expectedRevision: session.state.revision,
  });
const evaluate = () =>
  evaluateDocument(session.state.document, {
    requestedDomains: ['regions', 'relief', 'placed-relief'],
  });

run({
  kind: 'draw-path',
  name: '徽章',
  closed: true,
  points: [
    [0, 0],
    [8, 0],
    [8, 6],
    [0, 6],
  ],
});
const shapeId = Object.values(session.state.document.nodes).find(
  (node) => node.kind === 'shape',
).id;
let snapshot = await evaluate();
let view = projectCreationView(session.state.document, snapshot);
assert.equal(view.creation.objects[0].id, shapeId, 'object ID is the NodeID');
assert.equal(view.cells.length, 1);
assert.equal(view.cells[0].painted, false);
assert.equal(view.cells[0].enabled, false);
assert.equal(view.cells[0].heightMM, null, 'candidate has no guessed height');
assert.equal(view.cells[0].bottomMM, null, 'candidate has no guessed Z');
assert.equal(
  view.creation.objects[0].printable,
  true,
  'an unpainted candidate is printable unless its Shape is explicitly excluded',
);
assert.equal(
  view.creation.objects[0].partId,
  session.state.document.manufacturing.defaultPartId,
  'object Part falls back to the explicit manufacturing default',
);
assert.equal(
  view.creation.printStack,
  undefined,
  'no print layers keeps the simple workspace mode',
);
const firstSketch = Object.values(session.state.document.sketches)[0];
const firstPathId = Object.keys(firstSketch.paths)[0];
const encodedPathId = sourcePathId(firstSketch.id, firstPathId);
assert.deepEqual(view.creation.objects[0].pathIds, [encodedPathId]);
assert.deepEqual(view.identities.paths[encodedPathId], {
  kind: 'path',
  sketchId: firstSketch.id,
  id: firstPathId,
});
assert.notEqual(
  sourcePathId('sketch', 'path:part'),
  sourcePathId('sketch:path', 'part'),
  'length-prefixed path identity cannot collide across sketch boundaries',
);
assert.deepEqual(
  view.cells[0].outputRef,
  snapshot.regions[0].value.regions[0].ref,
);
assert.equal(view.cells[0].key, creationCellKey(view.cells[0].outputRef));
assert.deepEqual(
  view.identities.cells[view.cells[0].key],
  view.cells[0].outputRef,
);
assert.equal(
  view.modifierStatus.length,
  0,
  'implicit Source and Fill are not shown as modifier directories',
);

const target = structuredClone(view.cells[0].outputRef);
run({ kind: 'create-swatch', name: '红色', color: '#d12b2b' });
const redId = Object.values(session.state.document.appearances.swatches)[0].id;
run({ kind: 'paint-region', target, swatchId: redId });
run({
  kind: 'set-relief',
  target,
  value: {
    thickness: { kind: 'mm', value: 2.5 },
    placement: { kind: 'free', zMM: 3 },
  },
});
run({ kind: 'group-nodes', nodeIds: [shapeId], name: '父组' });
const groupId = Object.values(session.state.document.nodes).find(
  (node) => node.kind === 'group',
).id;
run({ kind: 'move-nodes', nodeIds: [groupId], deltaMM: [20, 5] });
run({
  kind: 'rotate-nodes',
  nodeIds: [groupId],
  centerMM: [0, 0],
  angleRad: Math.PI / 2,
});

snapshot = await evaluate();
view = projectCreationView(session.state.document, snapshot);
assert.equal(view.cells.length, 1);
const enabled = view.cells[0];
assert.equal(enabled.painted, true, 'enabled relief participates in product');
assert.equal(enabled.enabled, true);
assert.equal(enabled.color, '#d12b2b');
assert.equal(enabled.heightMM, 2.5);
assert.equal(enabled.bottomMM, 3);
assert.equal(enabled.topMM, 5.5);
assert.deepEqual(enabled.thickness, { kind: 'mm', value: 2.5 });
assert.deepEqual(enabled.placement, { kind: 'free', zMM: 3 });
assert.equal(view.creation.objects[0].printable, true);
assert.equal(view.creation.objects[0].heightMM, 2.5);
assert.equal(view.creation.objects[0].zMM, 3);
assert.equal(view.tree[0].id, groupId);
assert.equal(view.tree[0].children[0].id, shapeId);

const localRegion = snapshot.regions[0].value.regions[0];
const localFirst = localRegion.geometry.coordinates[0][0];
const expectedWorld = transformPoint(
  worldMatrix(session.state.document, shapeId),
  localFirst,
);
assert.deepEqual(
  enabled.geometry.coordinates[0][0],
  expectedWorld,
  'cell geometry includes the parent pose exactly once',
);
assert.notDeepEqual(enabled.geometry.coordinates[0][0], localFirst);
assert.throws(() => {
  view.cells[0].painted = false;
}, TypeError);

// Missing or blocked placed-relief is an evaluation state, not evidence that
// manufacturing explicitly excluded the output.
const reliefOnlySnapshot = await evaluateDocument(session.state.document, {
  requestedDomains: ['regions', 'relief'],
});
let placementView = projectCreationView(
  session.state.document,
  reliefOnlySnapshot,
);
assert.equal(placementView.cells[0].excluded, false);
assert.equal(placementView.cells[0].heightMM, null);
const blockedPlacement = structuredClone(reliefOnlySnapshot);
blockedPlacement.placedRelief = {
  domain: 'placed-relief',
  status: 'blocked',
  diagnostics: [{ kind: 'test-blocked', message: '放置求值失败' }],
  dependencies: [],
};
placementView = projectCreationView(session.state.document, blockedPlacement);
assert.equal(
  placementView.cells[0].excluded,
  false,
  'blocked placement does not invent an exclusion',
);

// Full OutputRef identity must keep equal operator keys from colliding when
// their instance paths differ. Current built-in region operators generally
// include the index in key as well, so fork the current evaluated DTO only at
// this identity boundary rather than inventing a second document model.
const collidingSnapshot = structuredClone(snapshot);
const publishedKey = `${shapeId}:regions`;
const baseRegion =
  collidingSnapshot.planar.published[publishedKey].value.regions[0];
const first = structuredClone(baseRegion);
const second = structuredClone(baseRegion);
first.ref.key = 'shared-key';
second.ref.key = 'shared-key';
first.ref.instances = [{ operatorId: 'instance-op', index: 0 }];
second.ref.instances = [{ operatorId: 'instance-op', index: 1 }];
first.ref.lineage = ['shared-source'];
second.ref.lineage = ['shared-source'];
collidingSnapshot.planar.published[publishedKey].value.regions = [
  first,
  second,
];
const collisionView = projectCreationView(
  session.state.document,
  collidingSnapshot,
);
assert.equal(collisionView.cells.length, 2);
assert.equal(new Set(collisionView.cells.map((cell) => cell.key)).size, 2);
assert.notEqual(collisionView.cells[0].key, collisionView.cells[1].key);
assert.deepEqual(collisionView.cells[0].outputRef.instances, [
  { operatorId: 'instance-op', index: 0 },
]);
assert.deepEqual(collisionView.cells[1].outputRef.instances, [
  { operatorId: 'instance-op', index: 1 },
]);

// Once an identity is ambiguous, later duplicates cannot reintroduce it.
const ambiguousSnapshot = structuredClone(snapshot);
for (const stageName of ['relief', 'placedRelief']) {
  const member = ambiguousSnapshot[stageName].value.reliefs[0];
  ambiguousSnapshot[stageName].value.reliefs = [
    structuredClone(member),
    structuredClone(member),
    structuredClone(member),
  ];
}
const ambiguousView = projectCreationView(
  session.state.document,
  ambiguousSnapshot,
);
assert.equal(ambiguousView.cells[0].painted, false);
assert.equal(ambiguousView.cells[0].heightMM, null);
assert.equal(
  ambiguousView.diagnostics.filter(
    (item) => item.kind === 'ambiguous-output' && item.source === 'relief',
  ).length,
  1,
  'one conflicting identity stays rejected after a third duplicate',
);

// The planar published result is authoritative. A blocked or empty current
// output must not reuse the still-ready aggregate arrays from another field.
for (const status of ['blocked', 'empty']) {
  const unavailable = structuredClone(snapshot);
  unavailable.planar.published[publishedKey] = {
    domain: 'regions',
    status,
    ...(status === 'empty'
      ? {
          value: {
            frame: { kind: 'local', ownerNodeId: shapeId },
            regions: [],
            provenance: [],
          },
        }
      : {}),
    diagnostics:
      status === 'blocked'
        ? [{ code: 'test-blocked', message: '当前输出不可用' }]
        : [],
    dependencies: [],
  };
  const unavailableView = projectCreationView(
    session.state.document,
    unavailable,
  );
  assert.equal(unavailableView.cells.length, 0, `${status} has no stale cells`);
  assert.equal(
    unavailableView.creation.objects[0].id,
    shapeId,
    `${status} retains the node tree object`,
  );
  assert.equal(unavailableView.tree[0].children[0].id, shapeId);
  assert.equal(unavailableView.creation.objects[0].evaluation.regions, status);
  assert.equal(
    unavailableView.creation.objects[0].printable,
    true,
    `${status} does not invent a Shape exclusion`,
  );
  if (status === 'blocked')
    assert.ok(
      unavailableView.errors.some(
        (error) =>
          error.objectId === shapeId && error.message === '当前输出不可用',
      ),
    );
}

const siblingExcludedDocument = structuredClone(session.state.document);
siblingExcludedDocument.manufacturing.excluded = [
  {
    ...structuredClone(target),
    instances: [{ operatorId: 'different-instance', index: 0 }],
  },
];
assert.equal(
  projectCreationView(siblingExcludedDocument, reliefOnlySnapshot).cells[0]
    .excluded,
  false,
  'same key with a different instance path is not an exact exclusion target',
);

run({ kind: 'set-manufacturing-excluded', target, excluded: true });
const explicitlyExcludedSnapshot = await evaluateDocument(
  session.state.document,
  { requestedDomains: ['regions', 'relief'] },
);
const explicitlyExcludedView = projectCreationView(
  session.state.document,
  explicitlyExcludedSnapshot,
);
assert.equal(
  explicitlyExcludedView.cells[0].excluded,
  true,
  'excluded comes from an exact manufacturing target without placed-relief',
);
assert.equal(
  explicitlyExcludedView.creation.objects[0].printable,
  true,
  'an output exclusion does not disable its whole Shape',
);
run({ kind: 'set-manufacturing-excluded', target, excluded: false });
run({
  kind: 'set-manufacturing-excluded',
  target: { kind: 'node', id: shapeId },
  excluded: true,
});
let shapeManufacturingView = projectCreationView(
  session.state.document,
  await evaluate(),
);
assert.equal(shapeManufacturingView.creation.objects[0].printable, false);
assert.equal(
  shapeManufacturingView.cells[0].excluded,
  true,
  'Shape exclusion also applies to each cell through manufacturing semantics',
);
run({
  kind: 'set-manufacturing-excluded',
  target: { kind: 'node', id: shapeId },
  excluded: false,
});
shapeManufacturingView = projectCreationView(
  session.state.document,
  await evaluate(),
);
assert.equal(shapeManufacturingView.creation.objects[0].printable, true);

run({ kind: 'create-part', name: '展示零件' });
const explicitPartId = Object.keys(
  session.state.document.manufacturing.parts,
).find((id) => id !== session.state.document.manufacturing.defaultPartId);
run({
  kind: 'set-manufacturing-part',
  target: { kind: 'node', id: shapeId },
  partId: explicitPartId,
});
let partView = projectCreationView(session.state.document, await evaluate());
assert.equal(partView.creation.objects[0].partId, explicitPartId);
run({
  kind: 'set-manufacturing-part',
  target: { kind: 'node', id: shapeId },
  partId: null,
});
partView = projectCreationView(session.state.document, await evaluate());
assert.equal(
  partView.creation.objects[0].partId,
  session.state.document.manufacturing.defaultPartId,
);

run({ kind: 'create-print-layer', name: '表面层' });
const layeredView = projectCreationView(
  session.state.document,
  await evaluate(),
);
assert.equal(layeredView.creation.printStack.layers.length, 1);
assert.equal(layeredView.creation.printStack.layers[0].name, '表面层');

console.log(
  'PASS: V4 creation view preserves exact identities, current evaluation participation and world geometry.',
);
