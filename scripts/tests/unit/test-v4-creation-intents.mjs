import assert from 'node:assert/strict';
import { createDocument } from '../../../src/lib/document/schema.mjs';
import { createEditorSession } from '../../../src/lib/editing/dispatcher.mjs';
import { createAuthoringCommand } from '../../../src/lib/editing/commands/authoring.mjs';
import { createCreationIntent } from '../../../src/lib/editor/creation-intents.mjs';
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
