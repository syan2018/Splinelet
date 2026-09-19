import assert from 'node:assert/strict';
import { createPathMetadataCommand } from '../../../src/lib/editing/commands/path-metadata.mjs';
import { createEditorSession } from '../../../src/lib/editing/dispatcher.mjs';
import { repeatedRingDocument } from '../fixtures/v4-programs.mjs';

const refs = [
  { kind: 'path', sketchId: 'sketch', id: 'outer-path' },
  { kind: 'path', sketchId: 'sketch', id: 'inner-path' },
];
const structure = (document) => ({
  nodes: document.nodes,
  programs: document.programs,
  sketchOwner: document.sketches.sketch.ownerNodeId,
  vertices: document.sketches.sketch.vertices,
  edges: document.sketches.sketch.edges,
  pathTopology: Object.fromEntries(
    Object.entries(document.sketches.sketch.paths).map(([id, path]) => [
      id,
      { edges: path.edges, handleModes: path.handleModes },
    ]),
  ),
});
const initial = repeatedRingDocument(),
  initialStructure = structure(initial),
  editor = createEditorSession(initial),
  beforeRevision = editor.state.revision;

editor.dispatch(
  createPathMetadataCommand({
    kind: 'set-paths',
    pathRefs: [refs[0], refs[1], refs[0]],
    value: { name: '同名轮廓', visible: false },
  }),
  { expectedRevision: beforeRevision },
);

assert.equal(editor.state.revision, beforeRevision + 1);
assert.deepEqual(editor.state.lastChange.changedRefs, refs);
for (const ref of refs) {
  const path = editor.state.document.sketches[ref.sketchId].paths[ref.id];
  assert.equal(path.name, '同名轮廓');
  assert.equal(path.visible, false);
}
assert.deepEqual(structure(editor.state.document), initialStructure);

editor.undo({ expectedRevision: editor.state.revision });
assert.deepEqual(editor.state.document, initial);
editor.redo({ expectedRevision: editor.state.revision });
for (const ref of refs)
  assert.equal(
    editor.state.document.sketches[ref.sketchId].paths[ref.id].name,
    '同名轮廓',
  );

const beforeEmpty = editor.state;
editor.dispatch(
  createPathMetadataCommand({
    kind: 'set-paths',
    pathRefs: [],
    value: { name: '不能扩散到全局' },
  }),
  { expectedRevision: beforeEmpty.revision },
);
assert.equal(editor.state.revision, beforeEmpty.revision);
assert.deepEqual(editor.state.document, beforeEmpty.document);

for (const request of [
  { kind: 'set-paths', pathRefs: refs, value: { locked: true } },
  { kind: 'set-paths', pathRefs: refs, value: { name: 1 } },
  { kind: 'set-paths', pathRefs: refs, value: { visible: 'yes' } },
  { kind: 'set-paths', pathRefs: null, value: { visible: true } },
  {
    kind: 'set-paths',
    pathRefs: [{ kind: 'node', id: 'shape' }],
    value: { visible: true },
  },
]) {
  const revision = editor.state.revision,
    document = editor.state.document;
  assert.throws(() =>
    editor.dispatch(createPathMetadataCommand(request), {
      expectedRevision: revision,
    }),
  );
  assert.equal(editor.state.revision, revision);
  assert.deepEqual(editor.state.document, document);
}

const atomic = createEditorSession(initial),
  atomicBefore = atomic.state.document;
assert.throws(
  () =>
    atomic.dispatch(
      createPathMetadataCommand({
        kind: 'set-paths',
        pathRefs: [refs[0], { kind: 'path', sketchId: 'sketch', id: 'gone' }],
        value: { name: '不能部分写入' },
      }),
      { expectedRevision: 0 },
    ),
  /路径不存在/,
);
assert.equal(atomic.state.revision, 0);
assert.deepEqual(atomic.state.document, atomicBefore);

const lockedDocument = repeatedRingDocument();
lockedDocument.nodes.shape.locked = true;
const locked = createEditorSession(lockedDocument);
assert.throws(
  () =>
    locked.dispatch(
      createPathMetadataCommand({
        kind: 'set-paths',
        pathRefs: [refs[0]],
        value: { visible: false },
      }),
      { expectedRevision: 0 },
    ),
  /锁定/,
);
assert.equal(locked.state.revision, 0);

console.log(
  'PASS: set-paths atomically edits explicit Path metadata with dedupe, lock validation, and one-step undo.',
);
