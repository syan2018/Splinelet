import assert from 'node:assert/strict';
import { createDocument } from '../../../src/lib/document/schema.mjs';
import {
  encodeDocument,
  decodeDocument,
} from '../../../src/lib/document/codec.mjs';
import { createEditorSession } from '../../../src/lib/editing/dispatcher.mjs';
import { createAuthoringCommand } from '../../../src/lib/editing/commands/authoring.mjs';
import { createBakeRegionSnapshotCommand } from '../../../src/lib/editing/commands/bake-region-snapshot.mjs';
import { createV4CreationRuntime } from '../../../src/lib/editor/creation-runtime.mjs';
import { evaluatePlanar } from '../../../src/lib/construction/document-evaluation.mjs';
import { regionSnapshotSourceOperator } from '../../../src/lib/construction/operators/regions/snapshot-source.mjs';
import {
  transformPoint,
  worldMatrix,
} from '../../../src/lib/scene/transforms.mjs';

let serial = 0;
const idFactory = () => `snapshot-${++serial}`;
const editor = createEditorSession(createDocument({ version: 5, idFactory }), {
  idFactory,
});
const dispatch = (command) =>
  editor.dispatch(command, { expectedRevision: editor.state.revision });

dispatch(
  createAuthoringCommand({
    kind: 'draw-path',
    closed: true,
    points: [
      [0, 0],
      [12, 0],
      [12, 8],
      [0, 8],
    ],
  }),
);
const owner = Object.values(editor.state.document.nodes)[0];
const program = () => editor.state.document.programs[owner.programId];
const fillId = program().outputs.regions.operatorId;
const runtime = createV4CreationRuntime({
  editorSession: editor,
  toDisplayProject: (_state, view) => ({ creation: view.creation }),
});
let project = runtime.project();
await runtime.evaluate('creation', {}, project);
const initial = runtime.readModifierSnapshot(project, fillId, 'regions');
assert.equal(initial.current.status, 'ready');
const sourceRevision = initial.lastSuccessful.revision;
const originalStage = structuredClone(initial.lastSuccessful.stage);
const originalWorld = structuredClone(initial.lastSuccessful.worldMatrix);
assert.deepEqual(originalWorld, worldMatrix(editor.state.document, owner.id));

const staleProject = project;
dispatch((document) => {
  document.nodes[owner.id].pose.translationMM = [20, -7];
  return { document };
});
dispatch((document) => {
  document.programs[owner.programId].operators[
    fillId
  ].inputs.input[0].operatorId = 'removed-producer';
  return { document };
});
project = runtime.project();
assert.throws(
  () => runtime.bakeModifierSnapshot(staleProject, owner.id, fillId),
  /过期|变化/,
  'a stale display project cannot turn history into a current transaction',
);
const brokenBeforeBake = structuredClone(editor.state.document);
runtime.bakeModifierSnapshot(project, owner.id, fillId);
const bakedDocument = editor.state.document;
const bakedOperator = Object.values(program().operators).find(
  (operator) => operator.type === 'region-snapshot-source',
);
assert(bakedOperator, 'Bake adds an explicit author source');
assert.equal(bakedOperator.params.sourceRevision, sourceRevision);
assert.equal(
  program().outputs.regions.operatorId,
  fillId,
  'Bake never publishes',
);
assert.equal(
  program().operators[fillId].inputs.input[0].operatorId,
  'removed-producer',
  'Bake never reconnects a broken modifier input',
);
assert.deepEqual(
  Object.keys(bakedDocument.regionDefinitions)
    .map((id) => bakedDocument.regionDefinitions[id].context.operatorId)
    .filter((id) => id === bakedOperator.id),
  [bakedOperator.id],
  'each baked region receives an explicit un-published definition',
);

const bakedPlanar = evaluatePlanar(bakedDocument, {
  requestedDomains: ['regions'],
});
assert.equal(
  bakedPlanar.components[`operator:${bakedOperator.id}`].ports.regions.status,
  'ready',
  'the baked source evaluates after its original Fill input is removed',
);
assert.equal(
  bakedPlanar.components[`operator:${fillId}`].ports.regions.status,
  'blocked',
  'the original broken chain remains visible rather than being replaced',
);

const currentWorld = worldMatrix(bakedDocument, owner.id);
const firstBakedPoint =
  bakedOperator.params.regions[0].geometry.coordinates[0][0];
const firstOriginalPoint =
  originalStage.value.regions[0].geometry.coordinates[0][0];
assert.deepEqual(
  transformPoint(currentWorld, firstBakedPoint),
  transformPoint(originalWorld, firstOriginalPoint),
  'a historical local snapshot preserves its original world position after owner movement',
);

const reopened = decodeDocument(encodeDocument(bakedDocument)).document;
assert.deepEqual(
  reopened,
  bakedDocument,
  'a baked source survives save and reopen',
);
assert.equal(
  evaluatePlanar(reopened, { requestedDomains: ['regions'] }).components[
    `operator:${bakedOperator.id}`
  ].ports.regions.status,
  'ready',
  'reopened baked source has no dependency on the removed producer',
);

editor.undo({ expectedRevision: editor.state.revision });
assert.deepEqual(
  editor.state.document,
  brokenBeforeBake,
  'one undo restores the exact broken author graph',
);

const sourceOperator = {
  id: 'snapshot-source',
  type: 'region-snapshot-source',
  params: {
    sourceRevision: 3,
    regions: [
      {
        id: 'region-a',
        geometry: {
          type: 'Polygon',
          coordinates: [
            [
              [1, 2],
              [4, 2],
              [4, 5],
              [1, 2],
            ],
          ],
        },
      },
    ],
  },
};
const originalOperator = structuredClone(sourceOperator);
const rebased = regionSnapshotSourceOperator.rebase(sourceOperator, {
  transform: [1, 0, 0, 1, 7, -3],
});
assert.deepEqual(
  sourceOperator,
  originalOperator,
  'rebase never mutates author values',
);
assert.deepEqual(rebased.params.regions[0].geometry.coordinates[0][0], [8, -1]);
assert.notEqual(rebased, sourceOperator);

const localEditor = createEditorSession(
  createDocument({ version: 5, idFactory }),
  {
    idFactory,
  },
);
const dispatchLocal = (command) =>
  localEditor.dispatch(command, {
    expectedRevision: localEditor.state.revision,
  });
dispatchLocal(
  createAuthoringCommand({
    kind: 'draw-path',
    closed: true,
    points: [
      [30, 0],
      [34, 0],
      [34, 4],
      [30, 4],
    ],
  }),
);
const localOwner = Object.values(localEditor.state.document.nodes)[0];
const localStage = evaluatePlanar(localEditor.state.document, {
  requestedDomains: ['regions'],
}).published[`${localOwner.id}:regions`];
const localBefore = structuredClone(localStage.value.regions[0].geometry);
const localCommand = createBakeRegionSnapshotCommand(
  { ownerNodeId: localOwner.id, sourceRevision: 0 },
  localStage,
);
localEditor.dispatch(localCommand, {
  expectedRevision: localEditor.state.revision,
});
const localBaked = Object.values(
  localEditor.state.document.programs[localOwner.programId].operators,
).find((operator) => operator.type === 'region-snapshot-source');
assert.deepEqual(
  localBaked.params.regions[0].geometry,
  localBefore,
  'without a historical frame Bake retains the supplied local coordinates',
);

runtime.dispose();
console.log(
  'PASS: region snapshot Bake stays disconnected, preserves historical world placement, survives reopen, and is undoable.',
);
