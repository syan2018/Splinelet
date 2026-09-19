import assert from 'node:assert/strict';
import { createDocument } from '../../../src/lib/document/schema.mjs';
import { createEditorSession } from '../../../src/lib/editing/dispatcher.mjs';
import { createAuthoringCommand } from '../../../src/lib/editing/commands/authoring.mjs';
import {
  CREATION_INTENTS,
  createCreationIntent,
} from '../../../src/lib/editor/creation-intents.mjs';
import { evaluateProgram } from '../../../src/lib/construction/document-evaluation.mjs';
import { outputIdentity } from '../../../src/lib/relief/appearance.mjs';
import { resolveRelief } from '../../../src/lib/relief/resolve.mjs';

let serial = 0;
const idFactory = () => `intent-${++serial}`;
const editor = createEditorSession(createDocument({ idFactory }), {
  idFactory,
});
const dispatch = (command) =>
  editor.dispatch(command, { expectedRevision: editor.state.revision });
for (const x of [0, 20])
  dispatch(
    createAuthoringCommand({
      kind: 'draw-path',
      closed: true,
      points: [
        [x, 0],
        [x + 10, 0],
        [x + 10, 10],
        [x, 10],
      ],
    }),
  );
const view = () => ({
  epoch: editor.state.epoch,
  revision: editor.state.revision,
  cells: Object.values(editor.state.document.nodes).flatMap((node) =>
    evaluateProgram(editor.state.document, node.id).regions.value.regions.map(
      (region) => ({
        key: `output:${outputIdentity(region.ref)}`,
        objectId: node.id,
        outputRef: region.ref,
      }),
    ),
  ),
  errors: [],
});
const intent = (action, args, displayed = view()) =>
  dispatch(createCreationIntent(action, args, displayed));
const before = editor.state.document;
const cells = view().cells;
assert.equal(cells.length, 2);
intent('height', { cellKeys: [cells[1].key], heightMM: 1.75 });
const enabledByThickness = Object.values(
  editor.state.document.reliefDefinitions.overrides,
).find(
  (item) => outputIdentity(item.target) === outputIdentity(cells[1].outputRef),
);
assert.equal(enabledByThickness.value.enabled, true);
assert.deepEqual(enabledByThickness.value.thickness, {
  kind: 'mm',
  value: 1.75,
});
editor.undo({ expectedRevision: editor.state.revision });
assert.deepEqual(
  editor.state.document,
  before,
  'setting candidate thickness enables it in one undoable command',
);
intent('paint', { cellKeys: cells.map((cell) => cell.key), color: '#ff0080' });
assert.equal(Object.keys(editor.state.document.appearances.swatches).length, 1);
assert.equal(
  Object.keys(editor.state.document.appearances.overrides).length,
  2,
);
editor.undo({ expectedRevision: editor.state.revision });
assert.deepEqual(
  editor.state.document,
  before,
  'multi-region first paint and swatch creation are one undo',
);
intent('paint', { cellKeys: [cells[0].key], color: '#ff0080' });
intent('height', { cellKeys: [cells[0].key], heightLayers: 8 });
const relief = () =>
  resolveRelief(editor.state.document, {
    domain: 'regions',
    status: 'ready',
    diagnostics: [],
    dependencies: [],
    value: {
      regions: Object.keys(editor.state.document.nodes).flatMap(
        (id) =>
          evaluateProgram(editor.state.document, id).regions.value.regions,
      ),
    },
  });
assert.deepEqual(relief().value.reliefs[0].thickness, {
  kind: 'layers',
  count: 8,
});
assert.equal(
  relief().value.reliefs.some(
    (item) => item.ref.ownerNodeId === cells[1].objectId,
  ),
  false,
);
intent('clear_paint', { cellKeys: [cells[0].key] });
assert.equal(relief().status, 'empty');
intent('paint', { cellKeys: [cells[0].key], color: '#ff0080' });
assert.deepEqual(
  relief().value.reliefs[0].thickness,
  { kind: 'layers', count: 8 },
  'clear/repaint retains previous thickness',
);

const objectId = cells[0].objectId;
const beforeObjectManufacturing = editor.state.document;
intent('object', {
  id: objectId,
  changes: { name: '临时部件名', printable: false },
});
assert.equal(editor.state.document.nodes[objectId].name, '临时部件名');
assert.deepEqual(editor.state.document.manufacturing.excluded, [
  { kind: 'node', id: objectId },
]);
editor.undo({ expectedRevision: editor.state.revision });
assert.deepEqual(
  editor.state.document,
  beforeObjectManufacturing,
  'node and manufacturing changes share one transaction',
);

dispatch(createAuthoringCommand({ kind: 'create-part', name: '独立零件' }));
const assignedPartId = Object.keys(
  editor.state.document.manufacturing.parts,
).find((id) => id !== editor.state.document.manufacturing.defaultPartId);
intent('object', { id: objectId, changes: { partId: assignedPartId } });
assert.deepEqual(
  Object.values(editor.state.document.manufacturing.assignments).map(
    ({ target, partId }) => ({ target, partId }),
  ),
  [{ target: { kind: 'node', id: objectId }, partId: assignedPartId }],
);

dispatch(
  createAuthoringCommand({
    kind: 'mirror-curves',
    ownerNodeId: objectId,
    center: [0, 0],
    angleRad: Math.PI / 2,
  }),
);
const mirrorId = Object.values(
  editor.state.document.programs[
    editor.state.document.nodes[objectId].programId
  ].operators,
).find((operator) => operator.type === 'curve-mirror').id;
intent('modifier_update', {
  objectId,
  modifierId: mirrorId,
  changes: { enabled: false },
});
assert.equal(
  editor.state.document.programs[
    editor.state.document.nodes[objectId].programId
  ].operators[mirrorId].enabled,
  false,
);

const beforePrintLayering = editor.state;
assert.throws(() => intent('print_layer_add', {}), /请先启用打印分层/);
assert.deepEqual(editor.state, beforePrintLayering);
dispatch(
  createAuthoringCommand({ kind: 'create-print-layer', name: '堆叠层 1' }),
);
intent('print_layer_add', { name: '顶层' });
let layerOrder = editor.state.document.manufacturing.layerOrder;
assert.equal(
  editor.state.document.manufacturing.layers[layerOrder[0]].name,
  '堆叠层 1',
);
assert.equal(
  editor.state.document.manufacturing.layers[layerOrder[1]].name,
  '顶层',
);
const firstLayerId = layerOrder[0];
const secondLayerId = layerOrder[1];
intent('print_layer_rename', { layerId: secondLayerId, name: '表面层' });
intent('print_layer_move', { layerId: secondLayerId, direction: -1 });
intent('print_settings', { layerHeightMM: 0.12 });
layerOrder = editor.state.document.manufacturing.layerOrder;
assert.deepEqual(layerOrder, [secondLayerId, firstLayerId]);
assert.equal(
  editor.state.document.manufacturing.layers[secondLayerId].name,
  '表面层',
);
assert.equal(editor.state.document.manufacturing.layerHeightMM, 0.12);
intent('print_layer_remove', { layerId: firstLayerId });
assert.deepEqual(editor.state.document.manufacturing.layerOrder, [
  secondLayerId,
]);

const unsupported = editor.state;
assert.throws(
  () =>
    intent('object', {
      id: objectId,
      changes: { zMM: 2 },
    }),
  /对应制造命令/,
);
assert.throws(
  () =>
    intent('object', {
      id: objectId,
      changes: { attachId: cells[1].objectId },
    }),
  /对应制造命令/,
);
assert.throws(
  () =>
    intent('modifier_update', {
      objectId,
      modifierId: mirrorId,
      changes: { count: 5 },
    }),
  /curve-mirror 不支持修改字段：count/,
);
assert.throws(
  () => intent('print_layer_remove', { layerId: secondLayerId }),
  /至少保留/,
);
assert.throws(
  () =>
    createCreationIntent(
      'print_assign',
      { objectIds: [objectId], layerId: secondLayerId },
      view(),
    ),
  /尚未适配/,
);
assert.deepEqual(editor.state, unsupported);
for (const action of [
  'modifier_update',
  'print_settings',
  'print_layer_add',
  'print_layer_rename',
  'print_layer_move',
  'print_layer_remove',
])
  assert.ok(CREATION_INTENTS.includes(action));

const stale = view();
intent('object', { id: cells[0].objectId, changes: { name: '杯身' } });
const unchanged = editor.state;
assert.throws(
  () => intent('height', { cellKeys: [cells[0].key], heightMM: 2 }, stale),
  /视图已失效/,
);
assert.deepEqual(editor.state, unchanged);
const otherEpoch = { ...view(), epoch: 'previous document epoch' };
assert.throws(
  () =>
    intent('paint', { cellKeys: [cells[0].key], color: '#000000' }, otherEpoch),
  /视图已失效/,
);
assert.throws(
  () =>
    intent('paint', { cellKeys: [cells[0].key, 'missing'], color: '#000000' }),
  /失效/,
);
assert.deepEqual(
  editor.state,
  unchanged,
  'failed batch cannot create a swatch or partially paint',
);
const failed = {
  ...view(),
  errors: [{ objectId: cells[0].objectId, message: 'broken fill' }],
};
assert.throws(
  () =>
    intent('height', { objectIds: [cells[0].objectId], heightMM: 2 }, failed),
  /求值失败/,
);
intent('object', { id: cells[0].objectId, changes: { locked: true } });
const locked = editor.state;
assert.throws(
  () => intent('paint', { cellKeys: [cells[0].key], color: '#000000' }),
  /锁定/,
);
assert.deepEqual(editor.state, locked);
console.log(
  'PASS original creation intents use current stable targets, atomic V4 transactions, isolated colour/thickness and revision guards',
);
