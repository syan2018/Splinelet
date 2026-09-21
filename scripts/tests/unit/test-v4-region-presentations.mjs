import assert from 'node:assert/strict';
import {
  decodeDocument,
  encodeDocument,
} from '../../../src/lib/document/codec.mjs';
import {
  createDocument,
  validateDocument,
} from '../../../src/lib/document/schema.mjs';
import { evaluateProgram } from '../../../src/lib/construction/document-evaluation.mjs';
import { createAdvancedCommand } from '../../../src/lib/editing/commands/advanced.mjs';
import { createAuthoringCommand } from '../../../src/lib/editing/commands/authoring.mjs';
import { createRegionPresentationCommand } from '../../../src/lib/editing/commands/region-presentations.mjs';
import { createEditorSession } from '../../../src/lib/editing/dispatcher.mjs';

let serial = 0;
const idFactory = () => `presentation-${++serial}`;
const commandContext = () => ({ idFactory });
const draw = (document, action) =>
  createAuthoringCommand(action)(document, commandContext()).document;

const empty = createDocument({ idFactory });
assert.equal(
  empty.regionPresentations,
  undefined,
  'new and old V4 documents may omit presentations',
);

let document = draw(empty, {
  kind: 'draw-path',
  name: '两块区域',
  closed: true,
  points: [
    [0, 0],
    [10, 0],
    [10, 10],
    [0, 10],
  ],
});
const ownerNodeId = Object.values(document.nodes).find(
  (node) => node.name === '两块区域',
).id;
document = draw(document, {
  kind: 'draw-path',
  ownerNodeId,
  name: '第二轮廓',
  closed: true,
  points: [
    [20, 0],
    [30, 0],
    [30, 10],
    [20, 10],
  ],
});
const regions = evaluateProgram(document, ownerNodeId).regions.value.regions;
assert.equal(regions.length, 2);

const session = createEditorSession(document, {
  idFactory,
  epoch: 'presentation-open',
});
session.dispatch(
  createRegionPresentationCommand({
    kind: 'set-region-presentation',
    target: regions[0].ref,
    value: { name: '左面', visible: false },
  }),
  { expectedRevision: 0 },
);
session.dispatch(
  createRegionPresentationCommand({
    kind: 'set-region-presentation',
    target: regions[1].ref,
    value: { name: '右面', visible: true },
  }),
  { expectedRevision: 1 },
);
let records = Object.values(
  session.state.document.regionPresentations.overrides,
);
assert.equal(
  records.length,
  2,
  'siblings receive independent OutputRef records',
);
assert.deepEqual(
  records
    .map((record) => [record.name, record.visible])
    .sort(([left], [right]) => left.localeCompare(right)),
  [
    ['右面', true],
    ['左面', false],
  ],
);
assert.equal(
  session.state.document.reliefDefinitions.overrides &&
    Object.keys(session.state.document.reliefDefinitions.overrides).length,
  0,
);

session.undo({ expectedRevision: 2 });
records = Object.values(session.state.document.regionPresentations.overrides);
assert.equal(records.length, 1);
assert.equal(
  records[0].name,
  '左面',
  'undo only rolls back the later sibling edit',
);
session.redo({ expectedRevision: 3 });

const reopened = decodeDocument(
  encodeDocument(session.state.document),
).document;
assert.deepEqual(
  reopened.regionPresentations,
  session.state.document.regionPresentations,
);

assert.throws(
  () =>
    createRegionPresentationCommand({
      kind: 'set-region-presentation',
      target: regions[0].ref,
      value: { visible: 'no' },
    })(session.state.document, commandContext()),
  /visible 必须是布尔值/,
);
assert.throws(
  () =>
    createRegionPresentationCommand({
      kind: 'set-region-presentation',
      target: { ...regions[0].ref, key: 'stale' },
      value: { name: '错误绑定' },
    })(session.state.document, commandContext()),
  /区域已失效/,
);

const copied = createAdvancedCommand({
  kind: 'copy-nodes',
  nodeIds: [ownerNodeId],
})(reopened, commandContext());
const copiedOwnerId = copied.selectionIntent.activeRef.id;
const copiedRecords = Object.values(
  copied.document.regionPresentations.overrides,
).filter((record) => record.target.ownerNodeId === copiedOwnerId);
assert.equal(copiedRecords.length, 2, 'copy remaps each owned presentation');
assert.deepEqual(
  copiedRecords
    .map((record) => [record.name, record.visible])
    .sort(([left], [right]) => left.localeCompare(right)),
  [
    ['右面', true],
    ['左面', false],
  ],
);
const copiedRegions = evaluateProgram(copied.document, copiedOwnerId).regions
  .value.regions;
for (const record of copiedRecords)
  assert(copiedRegions.some((region) => region.ref.key === record.target.key));

const suppressed = structuredClone(session.state.document);
suppressed.reliefDefinitions.overrides.suppressed = {
  id: 'suppressed',
  target: regions[0].ref,
  value: { enabled: false },
  suppressed: true,
  name: '左面体块',
};
validateDocument(suppressed);
assert.deepEqual(
  decodeDocument(encodeDocument(suppressed)).document.reliefDefinitions
    .overrides.suppressed,
  suppressed.reliefDefinitions.overrides.suppressed,
  'relief definition labels survive the V4 container roundtrip',
);
const invalidSuppression = structuredClone(suppressed);
invalidSuppression.reliefDefinitions.overrides.suppressed.value.enabled = true;
assert.throws(
  () => validateDocument(invalidSuppression),
  /suppressed 需要显式/,
);
const invalidLabel = structuredClone(suppressed);
invalidLabel.reliefDefinitions.overrides.suppressed.name = '  ';
assert.throws(() => validateDocument(invalidLabel), /name 不能为空/);

console.log(
  'PASS region presentations are per-output, undoable, persistent, and copy-safe',
);
