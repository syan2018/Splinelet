import assert from 'node:assert/strict';
import { evaluateProgram } from '../../../src/lib/construction/document-evaluation.mjs';
import { createDocument } from '../../../src/lib/document/schema.mjs';
import { createAdvancedCommand } from '../../../src/lib/editing/commands/advanced.mjs';
import { createAuthoringCommand } from '../../../src/lib/editing/commands/authoring.mjs';
import {
  createPathDeletionCommand,
  planPathDeletion,
} from '../../../src/lib/editing/commands/path-deletion.mjs';
import { createEditorSession } from '../../../src/lib/editing/dispatcher.mjs';
import { findRegionDrawing } from '../../../src/lib/editing/region-drawing.mjs';

let serial = 0;
const idFactory = () => `region-drawing-copy-${++serial}`;
const create = () =>
  createEditorSession(createDocument({ idFactory }), { idFactory });
const dispatch = (session, command) =>
  session.dispatch(command, { expectedRevision: session.state.revision });
const author = (session, action) =>
  dispatch(session, createAuthoringCommand(action));
const advanced = (session, action) =>
  dispatch(session, createAdvancedCommand(action));
const pathRef = (sketchId, id) => ({ kind: 'path', sketchId, id });
const programFor = (document, ownerNodeId) =>
  document.programs[document.nodes[ownerNodeId].programId];
const pendingTerminalFor = (document, ownerNodeId) => {
  const terminal = Object.values(
    programFor(document, ownerNodeId).operators,
  ).find(
    (item) =>
      ['partition', 'boolean'].includes(item.type) &&
      item.authoring?.phase === 'drawing',
  );
  assert.ok(terminal, 'owner must have a pending region terminal');
  return terminal;
};
const pendingPathFor = (document, ownerNodeId) => {
  const program = programFor(document, ownerNodeId);
  const terminal = pendingTerminalFor(document, ownerNodeId);
  const fill =
    terminal.type === 'boolean'
      ? program.operators[terminal.inputs.operand[0].operatorId]
      : null;
  const sourcePort = fill ? fill.inputs.input[0] : terminal.inputs.cutter[0];
  const source = program.operators[sourcePort.operatorId];
  assert.equal(source.type, 'source');
  const input = source.inputs.paths[0];
  const sketch = document.sketches[input.sketchId];
  assert.ok(sketch, 'pending source must use an auxiliary Sketch');
  const path = sketch.paths[input.pathIds[0]];
  assert.ok(path, 'pending source must use its raw path');
  return { sketch, path };
};
const sourceForDrawing = (document, branch) => {
  const program = programFor(document, branch.ownerNodeId);
  const terminal = program.operators[branch.operatorId];
  const fill =
    terminal.type === 'boolean'
      ? program.operators[terminal.inputs.operand[0].operatorId]
      : null;
  const sourcePort = fill ? fill.inputs.input[0] : terminal.inputs.cutter[0];
  return {
    terminal,
    fill,
    source: program.operators[sourcePort.operatorId],
  };
};

const session = create();
author(session, {
  kind: 'draw-path',
  points: [
    [0, 0],
    [20, 0],
    [20, 20],
    [0, 20],
  ],
  closed: true,
});
const ownerNodeId = Object.keys(session.state.document.nodes)[0];
const target = evaluateProgram(session.state.document, ownerNodeId).regions
  .value.regions[0].ref;

author(session, {
  kind: 'start-path',
  role: 'divider',
  point: [10, -1],
  ownerNodeId,
  targets: [target],
});
const originalRaw = pendingPathFor(session.state.document, ownerNodeId);
const originalRef = pathRef(originalRaw.sketch.id, originalRaw.path.id);
const originalBranch = findRegionDrawing(session.state.document, originalRef);
assert.ok(originalBranch, 'starting a divider creates a pending branch');
const originalSource = sourceForDrawing(session.state.document, originalBranch);
const pendingOriginal = structuredClone(session.state.document);

advanced(session, { kind: 'copy-nodes', nodeIds: [ownerNodeId] });
const copiedOwnerNodeId = session.state.lastChange.selectionIntent.activeRef.id;
const copiedRaw = pendingPathFor(session.state.document, copiedOwnerNodeId);
const copiedRef = pathRef(copiedRaw.sketch.id, copiedRaw.path.id);
const copiedBranch = findRegionDrawing(session.state.document, copiedRef);
assert.ok(copiedBranch, 'copy retains the pending drawing marker');
assert.notEqual(copiedBranch.ownerNodeId, originalBranch.ownerNodeId);
assert.notEqual(copiedBranch.operatorId, originalBranch.operatorId);

const copiedSource = sourceForDrawing(session.state.document, copiedBranch);
assert.deepEqual(copiedSource.terminal.authoring, { phase: 'drawing' });
assert.equal(copiedSource.terminal.enabled, false);
assert.equal(
  copiedSource.source.inputs.paths[0].sketchId,
  copiedRaw.sketch.id,
  'pending source must use the copied Sketch',
);
assert.deepEqual(copiedSource.source.inputs.paths[0].pathIds, [
  copiedRaw.path.id,
]);
assert.equal(
  copiedSource.terminal.inputs.cutter[0].ownerNodeId,
  copiedOwnerNodeId,
  'pending cutter PortRef must use the copied owner',
);
assert.equal(
  copiedSource.terminal.inputs.cutter[0].operatorId,
  copiedSource.source.id,
  'pending cutter PortRef must use the copied source operator',
);
assert.equal(
  copiedSource.terminal.inputs.input[0].ownerNodeId,
  copiedOwnerNodeId,
  'pending upstream PortRef must use the copied owner',
);
assert.notEqual(
  copiedSource.terminal.inputs.input[0].operatorId,
  originalSource.terminal.inputs.input[0].operatorId,
  'pending upstream PortRef must use the copied published operator',
);
assert.equal(
  copiedSource.terminal.params.scope.refs[0].ownerNodeId,
  copiedOwnerNodeId,
  'pending selected scope must use the copied owner',
);
assert.notEqual(
  copiedSource.terminal.params.scope.refs[0].operatorId,
  originalSource.terminal.params.scope.refs[0].operatorId,
  'pending selected scope must use the copied upstream output',
);

assert.deepEqual(
  session.state.document.nodes[ownerNodeId],
  pendingOriginal.nodes[ownerNodeId],
  'copy leaves the original owner unchanged',
);
assert.deepEqual(
  programFor(session.state.document, ownerNodeId),
  programFor(pendingOriginal, ownerNodeId),
  'copy leaves the original pending program unchanged',
);
assert.deepEqual(
  session.state.document.sketches[originalRaw.sketch.id],
  pendingOriginal.sketches[originalRaw.sketch.id],
  'copy leaves the original pending raw path unchanged',
);

author(session, {
  kind: 'extend-path',
  sketchId: copiedRaw.sketch.id,
  pathId: copiedRaw.path.id,
  cubic: [
    [10, -1],
    [10, -1],
    [10, 21],
    [10, 21],
  ],
});
author(session, {
  kind: 'finish-path',
  sketchId: copiedRaw.sketch.id,
  pathId: copiedRaw.path.id,
});
assert.equal(findRegionDrawing(session.state.document, copiedRef), null);
assert.equal(
  evaluateProgram(session.state.document, copiedOwnerNodeId).regions.value
    .regions.length,
  2,
  'copied pending divider can continue and publish its split regions',
);
assert.deepEqual(
  session.state.document.nodes[ownerNodeId],
  pendingOriginal.nodes[ownerNodeId],
  'finishing the copy leaves the original owner unchanged',
);
assert.deepEqual(
  programFor(session.state.document, ownerNodeId),
  programFor(pendingOriginal, ownerNodeId),
  'finishing the copy keeps the original branch pending',
);
assert.deepEqual(
  findRegionDrawing(session.state.document, originalRef),
  originalBranch,
);

const holeSession = create();
author(holeSession, {
  kind: 'draw-path',
  points: [
    [0, 0],
    [20, 0],
    [20, 20],
    [0, 20],
  ],
  closed: true,
});
const holeOwnerNodeId = Object.keys(holeSession.state.document.nodes)[0];
const holeTarget = evaluateProgram(holeSession.state.document, holeOwnerNodeId)
  .regions.value.regions[0].ref;
author(holeSession, {
  kind: 'start-path',
  role: 'hole',
  point: [5, 5],
  ownerNodeId: holeOwnerNodeId,
  targets: [holeTarget],
});
const originalHoleRaw = pendingPathFor(
  holeSession.state.document,
  holeOwnerNodeId,
);
const originalHoleRef = pathRef(
  originalHoleRaw.sketch.id,
  originalHoleRaw.path.id,
);
const originalHoleBranch = findRegionDrawing(
  holeSession.state.document,
  originalHoleRef,
);
assert.ok(originalHoleBranch);
const originalHoleChain = sourceForDrawing(
  holeSession.state.document,
  originalHoleBranch,
);
assert.equal(originalHoleChain.terminal.type, 'boolean');
assert.equal(originalHoleChain.fill.type, 'fill');
const pendingOriginalHole = structuredClone(holeSession.state.document);

advanced(holeSession, { kind: 'copy-nodes', nodeIds: [holeOwnerNodeId] });
const copiedHoleOwnerNodeId =
  holeSession.state.lastChange.selectionIntent.activeRef.id;
const copiedHoleRaw = pendingPathFor(
  holeSession.state.document,
  copiedHoleOwnerNodeId,
);
const copiedHoleRef = pathRef(copiedHoleRaw.sketch.id, copiedHoleRaw.path.id);
const copiedHoleBranch = findRegionDrawing(
  holeSession.state.document,
  copiedHoleRef,
);
assert.ok(copiedHoleBranch, 'copy retains the pending hole marker');
const copiedHoleChain = sourceForDrawing(
  holeSession.state.document,
  copiedHoleBranch,
);
assert.equal(copiedHoleChain.terminal.type, 'boolean');
assert.equal(copiedHoleChain.fill.type, 'fill');
assert.deepEqual(copiedHoleChain.terminal.authoring, { phase: 'drawing' });
assert.equal(copiedHoleChain.terminal.enabled, false);
assert.equal(
  copiedHoleChain.source.inputs.paths[0].sketchId,
  copiedHoleRaw.sketch.id,
  'copied hole source must use the copied raw Sketch',
);
assert.deepEqual(copiedHoleChain.source.inputs.paths[0].pathIds, [
  copiedHoleRaw.path.id,
]);
assert.equal(
  copiedHoleChain.fill.inputs.input[0].ownerNodeId,
  copiedHoleOwnerNodeId,
  'copied hole Fill PortRef must use the copied owner',
);
assert.equal(
  copiedHoleChain.fill.inputs.input[0].operatorId,
  copiedHoleChain.source.id,
  'copied hole Fill PortRef must use the copied source',
);
assert.equal(
  copiedHoleChain.terminal.inputs.operand[0].ownerNodeId,
  copiedHoleOwnerNodeId,
  'copied hole Boolean operand must use the copied owner',
);
assert.equal(
  copiedHoleChain.terminal.inputs.operand[0].operatorId,
  copiedHoleChain.fill.id,
  'copied hole Boolean operand must use the copied Fill',
);
assert.equal(
  copiedHoleChain.terminal.inputs.input[0].ownerNodeId,
  copiedHoleOwnerNodeId,
  'copied hole upstream PortRef must use the copied owner',
);
assert.notEqual(
  copiedHoleChain.terminal.inputs.input[0].operatorId,
  originalHoleChain.terminal.inputs.input[0].operatorId,
  'copied hole upstream PortRef must use the copied published operator',
);
assert.equal(
  copiedHoleChain.terminal.params.scope.refs[0].ownerNodeId,
  copiedHoleOwnerNodeId,
  'copied hole selected scope must use the copied owner',
);
assert.notEqual(
  copiedHoleChain.terminal.params.scope.refs[0].operatorId,
  originalHoleChain.terminal.params.scope.refs[0].operatorId,
  'copied hole selected scope must use the copied upstream output',
);

for (const [from, to] of [
  [
    [5, 5],
    [15, 5],
  ],
  [
    [15, 5],
    [15, 15],
  ],
  [
    [15, 15],
    [5, 15],
  ],
])
  author(holeSession, {
    kind: 'extend-path',
    sketchId: copiedHoleRaw.sketch.id,
    pathId: copiedHoleRaw.path.id,
    cubic: [from, from, to, to],
  });
author(holeSession, {
  kind: 'close-path',
  sketchId: copiedHoleRaw.sketch.id,
  pathId: copiedHoleRaw.path.id,
});
assert.equal(
  findRegionDrawing(holeSession.state.document, copiedHoleRef),
  null,
);
const completedHole = evaluateProgram(
  holeSession.state.document,
  copiedHoleOwnerNodeId,
).regions;
assert.equal(completedHole.status, 'ready');
assert.equal(completedHole.value.regions.length, 1);
assert.equal(
  completedHole.value.regions[0].geometry.coordinates.length,
  2,
  'closing the copied hole publishes a cut inner ring',
);
assert.deepEqual(
  holeSession.state.document.nodes[holeOwnerNodeId],
  pendingOriginalHole.nodes[holeOwnerNodeId],
  'finishing the copied hole leaves the original owner unchanged',
);
assert.deepEqual(
  programFor(holeSession.state.document, holeOwnerNodeId),
  programFor(pendingOriginalHole, holeOwnerNodeId),
  'finishing the copied hole keeps the original Source → Fill → Boolean branch pending',
);
assert.deepEqual(
  holeSession.state.document.sketches[originalHoleRaw.sketch.id],
  pendingOriginalHole.sketches[originalHoleRaw.sketch.id],
);
assert.deepEqual(
  findRegionDrawing(holeSession.state.document, originalHoleRef),
  originalHoleBranch,
);

const deletionSession = create();
author(deletionSession, {
  kind: 'draw-path',
  points: [
    [0, 0],
    [20, 0],
    [20, 20],
    [0, 20],
  ],
  closed: true,
});
const deletionOwner = Object.keys(deletionSession.state.document.nodes)[0];
const deletionTarget = evaluateProgram(
  deletionSession.state.document,
  deletionOwner,
).regions.value.regions[0].ref;
author(deletionSession, {
  kind: 'start-path',
  role: 'divider',
  point: [10, -1],
  ownerNodeId: deletionOwner,
  targets: [deletionTarget],
});
const deletionRaw = pendingPathFor(
  deletionSession.state.document,
  deletionOwner,
);
const deletionRef = pathRef(deletionRaw.sketch.id, deletionRaw.path.id);
const deletionBranch = findRegionDrawing(
  deletionSession.state.document,
  deletionRef,
);
const deletionProgram = programFor(
  deletionSession.state.document,
  deletionOwner,
);
const publishedBeforeDeletion = structuredClone(
  deletionProgram.outputs.regions,
);
const pendingBeforeDeletion = structuredClone(
  deletionProgram.operators[deletionBranch.operatorId],
);
const beforeDeletion = structuredClone(deletionSession.state.document);
const removal = planPathDeletion(deletionSession.state.document, [deletionRef]);
assert.deepEqual(
  deletionSession.state.document,
  beforeDeletion,
  'planning pending raw-path deletion must not mutate the document',
);
dispatch(
  deletionSession,
  createPathDeletionCommand({ kind: 'delete-paths', pathRefs: [deletionRef] }),
);
const deletedProgram = programFor(
  deletionSession.state.document,
  deletionOwner,
);
assert.equal(
  deletionSession.state.document.sketches[deletionRaw.sketch.id].paths[
    deletionRaw.path.id
  ],
  undefined,
);
assert.deepEqual(
  deletedProgram.outputs.regions,
  publishedBeforeDeletion,
  'deleting pending raw geometry never publishes its disabled terminal',
);
assert.deepEqual(
  deletedProgram.operators[deletionBranch.operatorId],
  pendingBeforeDeletion,
  'deletion preserves the pending terminal as a repairable definition',
);
assert.equal(
  findRegionDrawing(deletionSession.state.document, deletionRef),
  null,
  'a missing raw path cannot masquerade as an active drawing',
);
assert.ok(
  removal.impacts.some((item) => item.message.includes('pathId')),
  'deletion reports the dangling source path reference',
);
assert.ok(
  removal.affectedOperators.some(
    (item) => item.operatorId === deletionBranch.operatorId,
  ),
);
assert.equal(
  evaluateProgram(deletionSession.state.document, deletionOwner).regions.status,
  'ready',
  'the old published result stays available while the repairable branch is broken',
);

console.log(
  'PASS pending region-drawing copies remap internal references, finish independently, and keep deleted raw-path branches repairable without publishing',
);
