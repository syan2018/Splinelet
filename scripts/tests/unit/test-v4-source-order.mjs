import assert from 'node:assert/strict';
import {
  v1Project,
  closedPath,
} from '../fixtures/v4-migration/legacy-projects.mjs';
import { importLegacy } from '../../../src/lib/document/import/legacy-import.mjs';
import { validateDocument } from '../../../src/lib/document/schema.mjs';
import {
  encodeDocument,
  decodeDocument,
} from '../../../src/lib/document/codec.mjs';
import {
  projectSourceView,
  sourcePathId,
} from '../../../src/lib/editor/source-view.mjs';
import { createEditorSession } from '../../../src/lib/editing/dispatcher.mjs';
import { createAuthoringCommand } from '../../../src/lib/editing/commands/authoring.mjs';
import { createPathIntent } from '../../../src/lib/editor/path-intents.mjs';

const legacy = v1Project();
legacy.groups = [
  { id: 'z-group', name: '先显示' },
  { id: 'a-group', name: '后显示' },
];
legacy.paths = [
  closedPath('z', 'z-group'),
  closedPath('a', 'a-group'),
  closedPath('m', 'z-group'),
];
const imported = importLegacy(legacy);
const frame = {
  width: legacy.width,
  height: legacy.height,
  widthMM: legacy.widthMM,
};
const expected = legacy.paths.map((path) => {
  const ref = imported.idMap[`path:${path.id}`];
  return sourcePathId(ref.sketchId, ref.id);
});
const view = projectSourceView(imported.document, frame);
assert.deepEqual(
  view.paths.map((path) => path.id),
  expected,
);
assert.deepEqual(view.orderedPathIds, expected);
assert.deepEqual(
  view.collections.map((item) => item.name),
  ['先显示', '后显示'],
);
assert.deepEqual(
  view.collections[0].members.map((member) => member.pathId),
  [expected[0], expected[2]],
);
const reopened = decodeDocument(
  encodeDocument(imported.document, { assets: imported.assets }),
).document;
assert.deepEqual(
  projectSourceView(reopened, frame),
  view,
  'canonical serialization must not reorder source paths or collections',
);

let serial = 0;
const editor = createEditorSession(reopened, {
  idFactory: () => `new-${++serial}`,
});
editor.dispatch(
  createAuthoringCommand({ kind: 'start-path', point: [0, 0], name: '新线条' }),
  { expectedRevision: editor.state.revision },
);
const after = projectSourceView(editor.state.document, frame);
assert.deepEqual(
  after.paths.slice(0, -1).map((path) => path.id),
  expected,
);
assert.equal(after.paths.at(-1).name, '新线条');
editor.undo({ expectedRevision: editor.state.revision });
assert.deepEqual(projectSourceView(editor.state.document, frame), view);

const captured = { ...editor.state, source: view };
const reordered = [...expected].reverse();
const reorder = createPathIntent(
  { kind: 'reorder-source-paths', pathIds: reordered },
  captured,
);
editor.dispatch(reorder, { expectedRevision: editor.state.revision });
assert.deepEqual(
  projectSourceView(editor.state.document, frame).orderedPathIds,
  reordered,
);
assert.deepEqual(
  editor.state.document.programs,
  reopened.programs,
  'display order must not change construction input order',
);
assert.deepEqual(
  editor.state.document.nodes,
  reopened.nodes,
  'source sorting must not reorder owners',
);
assert.throws(
  () => editor.dispatch(reorder, { expectedRevision: editor.state.revision }),
  /失效/,
);
editor.undo({ expectedRevision: editor.state.revision });
const create = createPathIntent(
  {
    kind: 'create-path-collection',
    name: '另一个整理引用',
    pathIds: [expected[0]],
  },
  { ...editor.state, source: view },
);
editor.dispatch(create, { expectedRevision: editor.state.revision });
const grouped = projectSourceView(editor.state.document, frame);
assert.deepEqual(
  grouped.collections.slice(0, 2),
  view.collections,
  'creating a collection must not steal membership from existing groups',
);
assert.equal(grouped.collections.at(-1).members[0].pathId, expected[0]);
const collectionId = grouped.collections.at(-1).id;
editor.dispatch(
  createPathIntent(
    { kind: 'delete-collection', collectionId },
    { ...editor.state, source: grouped },
  ),
  { expectedRevision: editor.state.revision },
);
assert.deepEqual(
  projectSourceView(editor.state.document, frame),
  view,
  'deleting organization metadata keeps all source geometry',
);

const broken = structuredClone(reopened);
const first = imported.idMap['path:z'];
delete broken.sketches[first.sketchId].paths[first.id];
validateDocument(broken);
const missing = projectSourceView(broken, frame).collections[0].members[0];
assert.equal(missing.pathId, expected[0]);
assert.equal(
  missing.exists,
  false,
  'deleted member keeps its original repairable identity',
);
assert.ok(Object.isFrozen(view.collections[0].members));

const unordered = structuredClone(reopened);
for (const sketch of Object.values(unordered.sketches))
  for (const path of Object.values(sketch.paths)) delete path.order;
for (const collection of Object.values(unordered.collections))
  delete collection.order;
validateDocument(unordered);
const shuffled = structuredClone(unordered);
shuffled.sketches = Object.fromEntries(
  Object.entries(shuffled.sketches).reverse(),
);
for (const sketch of Object.values(shuffled.sketches))
  sketch.paths = Object.fromEntries(Object.entries(sketch.paths).reverse());
assert.deepEqual(
  projectSourceView(shuffled, frame),
  projectSourceView(unordered, frame),
  'older V4 documents have deterministic fallback independent of object key order',
);
unordered.sketches[first.sketchId].paths[first.id].order = Infinity;
assert.throws(() => validateDocument(unordered), /不是 JSON/);
unordered.sketches[first.sketchId].paths[first.id].order = 'first';
assert.throws(() => validateDocument(unordered), /Path.order/);
console.log(
  'PASS source display order and collection membership survive import, canonical save, append, undo and missing references',
);
