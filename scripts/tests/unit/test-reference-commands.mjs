import assert from 'node:assert/strict';
import {
  createDocument,
  validateDocument,
} from '../../../src/lib/document/schema.mjs';
import { createEditorSession } from '../../../src/lib/editing/dispatcher.mjs';
import {
  baseReference,
  createReferenceCommand,
  orderedReferences,
} from '../../../src/lib/editing/commands/references.mjs';

const descriptor = (id) => ({
  id,
  path: `assets/${id}.png`,
  mediaType: 'image/png',
  size: 0,
  sha256: '0'.repeat(64),
});
const reference = (id, assetId, patch = {}) => ({
  id,
  assetId,
  name: id,
  pixelWidth: 100,
  pixelHeight: 100,
  pixelToWorld: [0.2, 0, 0, -0.2, -10, 10],
  visible: true,
  locked: false,
  opacity: 1,
  ...patch,
});
const document = createDocument();
document.sourceFrame = { width: 100, height: 100, widthMM: 20 };
document.assets.baseAsset = descriptor('baseAsset');
document.references.base = reference('base', 'baseAsset', {
  role: 'base',
  locked: true,
});
validateDocument(document);
const editor = createEditorSession(document);
const run = (action) =>
  editor.dispatch(createReferenceCommand(action), {
    expectedRevision: editor.state.revision,
  });
const doc = () => editor.state.document;

run({
  kind: 'reference-add',
  assets: [descriptor('detailAsset'), descriptor('colorAsset')],
  references: [
    reference('detail', 'detailAsset'),
    reference('color', 'colorAsset', { locked: true }),
  ],
});
assert.deepEqual(
  orderedReferences(doc()).map((item) => item.id),
  ['base', 'detail', 'color'],
  'new references are topmost in batch order',
);
assert.equal(baseReference(doc()).id, 'base');
assert.equal(doc().references.detail.role, 'overlay');
assert.equal(doc().references.detail.order, 1);

run({
  kind: 'reference-update',
  id: 'detail',
  patch: { pixelToWorld: [0.2, 0, 0, -0.2, -4, 3] },
});
assert.equal(doc().references.detail.pixelToWorld[4], -4);
assert.throws(() =>
  run({
    kind: 'reference-update',
    id: 'color',
    patch: { pixelToWorld: [0.2, 0, 0, -0.2, 1, 2] },
  }),
);
run({
  kind: 'reference-update',
  id: 'color',
  patch: { visible: false, opacity: 0.3 },
});
assert.equal(doc().references.color.opacity, 0.3);
assert.throws(() => run({ kind: 'reference-delete', id: 'base' }));
assert.throws(() =>
  run({
    kind: 'reference-update',
    id: 'base',
    patch: { pixelToWorld: [0.2, 0, 0, -0.2, 1, 2] },
  }),
);
run({ kind: 'reference-update', id: 'base', patch: { opacity: 0.5 } });
assert.equal(doc().references.base.opacity, 0.5);

run({ kind: 'reference-duplicate', id: 'detail', newId: 'detail-copy' });
assert.equal(doc().references['detail-copy'].assetId, 'detailAsset');
assert.equal(orderedReferences(doc()).at(-1).id, 'detail-copy');
run({ kind: 'reference-reorder', id: 'detail-copy', direction: 'down' });
assert.deepEqual(
  orderedReferences(doc()).map((item) => item.id),
  ['base', 'detail', 'detail-copy', 'color'],
);
assert.throws(() =>
  run({ kind: 'reference-reorder', id: 'base', direction: 'up' }),
);

const beforeInvalid = editor.state;
assert.throws(() =>
  run({
    kind: 'reference-add',
    assets: [descriptor('atomic')],
    references: [
      reference('valid-in-batch', 'atomic'),
      reference('broken', 'missing'),
    ],
  }),
);
assert.deepEqual(editor.state, beforeInvalid, 'invalid additions are atomic');
run({ kind: 'reference-delete', id: 'detail' });
assert.ok(doc().assets.detailAsset, 'shared duplicate retains its descriptor');
run({ kind: 'reference-delete', id: 'detail-copy' });
assert.equal(
  doc().assets.detailAsset,
  undefined,
  'unused descriptor is removed',
);
editor.undo({ expectedRevision: editor.state.revision });
assert.ok(
  doc().references['detail-copy'],
  'one history entry restores deletion',
);
assert.ok(doc().assets.detailAsset);

const legacy = createDocument();
legacy.sourceFrame = { width: 100, height: 100, widthMM: 20 };
legacy.assets.legacy = descriptor('legacy');
legacy.references.legacy = reference('legacy', 'legacy');
assert.equal(
  baseReference(legacy).id,
  'legacy',
  'legacy calibrated reference remains base',
);
legacy.references.legacy.role = 'overlay';
assert.equal(baseReference(legacy), undefined, 'overlay never becomes a base');
assert.throws(() =>
  validateDocument({
    ...legacy,
    references: { broken: reference('broken', 'missing') },
  }),
);
console.log(
  'PASS reference commands protect calibration, preserve assets and stay atomic',
);
