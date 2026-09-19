import assert from 'node:assert/strict';
import { createDocument } from '../../../src/lib/document/schema.mjs';
import { createEditorSession } from '../../../src/lib/editing/dispatcher.mjs';
import { createAuthoringCommand } from '../../../src/lib/editing/commands/authoring.mjs';
import { evaluateProgram } from '../../../src/lib/construction/document-evaluation.mjs';
import { resolveRelief } from '../../../src/lib/relief/resolve.mjs';
import { createV4AgentAPI } from '../../../src/lib/agent/v4-api.mjs';

let sequence = 0;
const idFactory = () => `resources-${++sequence}`;
const session = createEditorSession(createDocument({ idFactory }), {
  idFactory,
});
const run = (action) =>
  session.dispatch(createAuthoringCommand(action), {
    expectedRevision: session.state.revision,
  });
const doc = () => session.state.document;
const create = (kind, table, args = {}) => {
  const before = Object.keys(table());
  run({ kind, ...args });
  return Object.keys(table()).find((id) => !before.includes(id));
};
const red = create('create-swatch', () => doc().appearances.swatches, {
  name: '红',
  color: '#FF0000',
});
const blue = create('create-swatch', () => doc().appearances.swatches, {
  name: '蓝',
  color: '#0000ff',
});
run({
  kind: 'draw-path',
  closed: true,
  points: [
    [0, 0],
    [10, 0],
    [10, 10],
    [0, 10],
  ],
});
const owner = Object.keys(doc().nodes)[0];
const regions = () => evaluateProgram(doc(), owner).regions;
const target = regions().value.regions[0].ref;
run({ kind: 'set-default-appearance', nodeId: owner, swatchId: red });
assert.equal(
  resolveRelief(doc(), regions()).status,
  'empty',
  'default colour does not enable product',
);
run({ kind: 'paint-region', target, swatchId: red });
run({ kind: 'set-thickness', target, thickness: { kind: 'mm', value: 3 } });
const geometryBefore = regions();
const beforeDelete = session.state;
assert.throws(() => run({ kind: 'delete-swatch', id: red }), /替代/);
assert.deepEqual(
  session.state,
  beforeDelete,
  'referenced deletion fails atomically',
);
run({ kind: 'delete-swatch', id: red, replacementId: blue });
assert.equal(doc().appearances.defaults[owner].swatchId, blue);
const relief = resolveRelief(doc(), regions()).value.reliefs[0];
assert.equal(relief.color, '#0000ff');
assert.equal(relief.thickness.value, 3);
assert.deepEqual(
  regions(),
  geometryBefore,
  'resource replacement cannot edit geometry',
);
session.undo({ expectedRevision: session.state.revision });
assert.deepEqual(
  doc(),
  beforeDelete.document,
  'one undo restores swatch and all references',
);
run({ kind: 'set-swatch', id: red, color: '#800000', name: '暗红' });
assert.equal(resolveRelief(doc(), regions()).value.reliefs[0].color, '#800000');
const valid = session.state;
assert.throws(
  () =>
    run({
      kind: 'set-swatch',
      id: red,
      color: 'bad',
      name: 'must not persist',
    }),
  /颜色/,
);
assert.deepEqual(session.state, valid);

const lower = create('create-print-layer', () => doc().manufacturing.layers, {
  name: '下层',
});
const upper = create('create-print-layer', () => doc().manufacturing.layers, {
  name: '上层',
});
run({
  kind: 'set-relief',
  target,
  value: { placement: { kind: 'layer', layerId: lower, offsetMM: 0.1 } },
});
assert.throws(() => run({ kind: 'delete-print-layer', id: lower }), /替代/);
const beforeLayer = doc();
run({ kind: 'delete-print-layer', id: lower, replacementId: upper });
assert.deepEqual(doc().manufacturing.layerOrder, [upper]);
assert.deepEqual(resolveRelief(doc(), regions()).value.reliefs[0].placement, {
  kind: 'layer',
  layerId: upper,
  offsetMM: 0.1,
});
session.undo({ expectedRevision: session.state.revision });
assert.deepEqual(doc(), beforeLayer);
run({ kind: 'rename-print-layer', id: lower, name: '改名' });
assert.equal(doc().manufacturing.layers[lower].name, '改名');

const originalPart = doc().manufacturing.defaultPartId;
const otherPart = create('create-part', () => doc().manufacturing.parts, {
  name: '外壳',
});
run({ kind: 'set-manufacturing-part', target, partId: originalPart });
const beforePart = doc();
assert.throws(() => run({ kind: 'delete-part', id: originalPart }), /替代/);
run({ kind: 'delete-part', id: originalPart, replacementId: otherPart });
assert.equal(doc().manufacturing.defaultPartId, otherPart);
assert(
  Object.values(doc().manufacturing.assignments).every(
    (item) => item.partId === otherPart,
  ),
);
session.undo({ expectedRevision: session.state.revision });
assert.deepEqual(doc(), beforePart);

const api = createV4AgentAPI({ editorSession: session });
assert(
  (await api.call('capabilities.get')).authoringActions.includes('set-swatch'),
);
await api.call('authoring.run', {
  expectedRevision: session.state.revision,
  action: {
    kind: 'set-slicer-template',
    template: { name: 'saved profile', settings: { layer: 0.2 } },
  },
});
assert.equal(doc().manufacturing.slicerTemplate.name, 'saved profile');
console.log(
  'PASS V4 resource commands preserve geometry, exact references and atomic undo through UI/API transactions',
);
