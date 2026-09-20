import assert from 'node:assert/strict';
import { repeatedRingDocument } from '../fixtures/v4-programs.mjs';
import { createAuthoringCommand } from '../../../src/lib/editing/commands/authoring.mjs';
import { createEditorSession } from '../../../src/lib/editing/dispatcher.mjs';
import { evaluateDocument } from '../../../src/lib/evaluation/evaluate-document.mjs';
import { projectCreationView } from '../../../src/lib/editor/creation-view.mjs';
import { createCreationIntent } from '../../../src/lib/editor/creation-intents.mjs';
import { readyReliefMembers } from '../../../src/lib/evaluation/branch-stages.mjs';
import { buildBodies } from '../../../src/lib/solid/bodies.mjs';
import {
  encodeDocument,
  decodeDocument,
} from '../../../src/lib/document/codec.mjs';
import { worldMatrix } from '../../../src/lib/scene/transforms.mjs';
import { sceneTreeRows } from '../../../src/lib/editor/scene-tree.mjs';
import { agentJSONValue } from '../../../src/lib/agent/transport.mjs';

// JSON bridges preserve binary export bytes, including a typed-array subview.
const bytes = new Uint8Array([99, 1, 2, 254, 88]);
const transported = JSON.parse(
  JSON.stringify(
    agentJSONValue({
      artifacts: [bytes.buffer, bytes.subarray(1, 4)],
    }),
  ),
);
assert.deepEqual(
  [...Buffer.from(transported.artifacts[0].base64, 'base64')],
  [...bytes],
);
assert.deepEqual(
  [...Buffer.from(transported.artifacts[1].base64, 'base64')],
  [1, 2, 254],
);
assert.equal(transported.artifacts[1].byteLength, 3);
assert.equal(transported.artifacts[0].type, 'ArrayBuffer');

let serial = 0;
const idFactory = () => `repair-${++serial}`;
const fixture = createEditorSession(repeatedRingDocument(), { idFactory });
const command = (editor, action) =>
  editor.dispatch(createAuthoringCommand(action), {
    expectedRevision: editor.state.revision,
  });
const ids = ['shape'];
for (const x of [25, 45, 65]) {
  command(fixture, {
    kind: 'draw-path',
    closed: true,
    points: [
      [x, 0],
      [x + 10, 0],
      [x + 10, 10],
      [x, 10],
    ],
  });
  ids.push(fixture.state.lastChange.selectionIntent.activeRef.id);
}
const [ring, square, attached, upper] = ids;
const base = structuredClone(fixture.state.document);
for (const id of ids)
  base.reliefDefinitions.defaults[id] = {
    enabled: true,
    thickness: { kind: 'mm', value: 2 },
    mode: 'add',
    placement: { kind: 'free', zMM: 0 },
  };
base.reliefDefinitions.defaults[attached].placement = {
  kind: 'attached',
  target: { kind: 'node', id: ring },
  offsetMM: 1,
};
base.manufacturing.layers.low = { id: 'low', name: '下层' };
base.manufacturing.layers.high = { id: 'high', name: '上层' };
base.manufacturing.layerOrder = ['low', 'high'];
base.reliefDefinitions.defaults[ring].placement = {
  kind: 'layer',
  layerId: 'low',
  offsetMM: 0,
};
base.reliefDefinitions.defaults[upper].placement = {
  kind: 'layer',
  layerId: 'high',
  offsetMM: 0,
};
const evaluate = (document) =>
  evaluateDocument(document, {
    requestedDomains: ['curves', 'regions', 'relief', 'placed-relief'],
  });
const healthy = await evaluate(base);
assert.equal(healthy.placedRelief.status, 'ready');
const broken = structuredClone(base);
broken.programs.program.operators.join.params.connections = [];
const failed = await evaluate(broken);
assert.equal(failed.relief.status, 'blocked');
assert.equal(
  failed.placedRelief.value,
  undefined,
  'aggregate cannot masquerade as a complete model',
);
assert.deepEqual(
  readyReliefMembers(failed.placedRelief).map((item) => item.ref.ownerNodeId),
  [square],
);
const view = projectCreationView(broken, failed);
assert.equal(view.cells.find((cell) => cell.objectId === square).painted, true);
assert.equal(
  view.cells.find((cell) => cell.objectId === square).flatOnly,
  false,
);
assert.equal(
  view.cells.find((cell) => cell.objectId === attached).enabled,
  true,
  'authored enable survives dependency failure',
);
assert.equal(
  view.cells.find((cell) => cell.objectId === attached).flatOnly,
  true,
);
assert.equal((await buildBodies(failed.placedRelief)).status, 'blocked');
const hidden = structuredClone(broken);
hidden.nodes[ring].visible = false;
assert.equal(
  (await evaluate(hidden)).placedRelief.status,
  'blocked',
  'hiding is not manufacturing exclusion',
);
const excluded = structuredClone(broken);
excluded.manufacturing.excluded.push(
  { kind: 'node', id: ring },
  { kind: 'node', id: attached },
);
const excludedResult = await evaluate(excluded);
assert.equal(excludedResult.placedRelief.status, 'ready');
assert.equal(
  readyReliefMembers(excludedResult.placedRelief).find(
    (item) => item.ref.ownerNodeId === upper,
  ).zBase,
  0,
);
const stale = structuredClone(base);
const ringRef = healthy.regions.find((stage) => stage.ownerNodeId === ring)
  .value.regions[0].ref;
stale.reliefDefinitions.overrides.stale = {
  id: 'stale',
  target: { ...ringRef, key: 'gone' },
  value: { enabled: true },
};
assert.deepEqual(
  readyReliefMembers((await evaluate(stale)).placedRelief).map(
    (item) => item.ref.ownerNodeId,
  ),
  [square],
);

// Z edits preserve inherited placement and explicit offsets, through history and storage.
const zDocument = structuredClone(base);
zDocument.manufacturing.layers = {};
zDocument.manufacturing.layerOrder = [];
zDocument.reliefDefinitions.defaults[ring].placement = { kind: 'free', zMM: 0 };
zDocument.reliefDefinitions.defaults[upper].placement = {
  kind: 'free',
  zMM: 0,
};
const squareRef = healthy.regions.find((stage) => stage.ownerNodeId === square)
  .value.regions[0].ref;
zDocument.reliefDefinitions.defaults[square].placement = {
  kind: 'free',
  zMM: 1,
};
zDocument.reliefDefinitions.overrides.thick = {
  id: 'thick',
  target: squareRef,
  value: { thickness: { kind: 'mm', value: 3 } },
};
const zEditor = createEditorSession(zDocument, { idFactory });
const intent = async (editor, action, args) => {
  const displayed = {
    epoch: editor.state.epoch,
    revision: editor.state.revision,
    ...projectCreationView(
      editor.state.document,
      await evaluate(editor.state.document),
    ),
  };
  return editor.dispatch(createCreationIntent(action, args, displayed), {
    expectedRevision: editor.state.revision,
  });
};
const zBase = async (editor) =>
  readyReliefMembers((await evaluate(editor.state.document)).placedRelief).find(
    (item) => item.ref.ownerNodeId === square,
  ).zBase;
await intent(zEditor, 'object', { id: square, changes: { zMM: 2 } });
assert.equal(await zBase(zEditor), 2);
assert.equal(
  zEditor.state.document.reliefDefinitions.overrides.thick.value.placement,
  undefined,
);
assert.deepEqual(
  decodeDocument(encodeDocument(zEditor.state.document)).document,
  zEditor.state.document,
);
zEditor.undo({ expectedRevision: zEditor.state.revision });
assert.equal(await zBase(zEditor), 1);
await intent(zEditor, 'object', {
  id: square,
  changes: { zMM: -2, attachId: ring },
});
assert.equal(
  await zBase(zEditor),
  0,
  'attached offset -2 relative to ring top 2',
);
assert.equal(
  zEditor.state.document.reliefDefinitions.overrides.thick.value.placement,
  undefined,
);
await intent(zEditor, 'object', { id: square, changes: { attachId: '' } });
assert.equal(await zBase(zEditor), -2);

// Scene grouping and keepWorld reparenting preserve all local sources.
const sceneEditor = createEditorSession(base, { idFactory });
await intent(sceneEditor, 'scene_group', {
  nodeIds: [square, attached],
  name: '内组',
});
const inner = sceneEditor.state.lastChange.changedRefs[0].id;
await intent(sceneEditor, 'scene_group', {
  nodeIds: [inner, upper],
  name: '外组',
});
const outer = sceneEditor.state.lastChange.changedRefs[0].id;
const beforeMove = sceneEditor.state.document;
const worldBefore = worldMatrix(beforeMove, square);
command(sceneEditor, {
  kind: 'move-nodes',
  nodeIds: [outer, inner, square],
  deltaMM: [5, 7],
});
assert.deepEqual(sceneEditor.state.document.sketches, beforeMove.sketches);
const moved = worldMatrix(sceneEditor.state.document, square);
assert.equal(
  moved[4] - worldBefore[4],
  5,
  'ancestor/descendant selection moves once',
);
assert.equal(moved[5] - worldBefore[5], 7);
await intent(sceneEditor, 'scene_node', {
  id: outer,
  changes: { visible: false, locked: true },
});
const rows = sceneTreeRows(
  projectCreationView(sceneEditor.state.document, {}).tree,
  projectCreationView(sceneEditor.state.document, {}).creation.objects,
);
assert.equal(rows.find((row) => row.id === square).visible, false);
assert.equal(rows.find((row) => row.id === square).ownVisible, true);
assert.deepEqual(rows.find((row) => row.id === square).lockedBy, [outer]);
await intent(sceneEditor, 'scene_node', {
  id: outer,
  changes: { visible: true, locked: false },
});
await intent(sceneEditor, 'scene_reparent', {
  nodeIds: [square],
  parentId: null,
});
assert.deepEqual(worldMatrix(sceneEditor.state.document, square), moved);
await intent(sceneEditor, 'scene_ungroup', { nodeIds: [outer] });
assert.equal(sceneEditor.state.document.nodes[outer], undefined);
sceneEditor.undo({ expectedRevision: sceneEditor.state.revision });
assert.ok(sceneEditor.state.document.nodes[outer]);
assert.deepEqual(
  decodeDocument(encodeDocument(sceneEditor.state.document)).document,
  sceneEditor.state.document,
);
console.log(
  'PASS review repairs: independent preview, strict export, dependency placement, inherited Z, nested Group edits and storage',
);
