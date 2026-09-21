import assert from 'node:assert/strict';
import { repeatedRingDocument } from '../fixtures/v4-programs.mjs';
import {
  planPathDeletion,
  createPathDeletionCommand,
} from '../../../src/lib/editing/commands/path-deletion.mjs';
import { createEditorSession } from '../../../src/lib/editing/dispatcher.mjs';
import { evaluateProgram } from '../../../src/lib/construction/document-evaluation.mjs';
import {
  encodeDocument,
  decodeDocument,
} from '../../../src/lib/document/codec.mjs';

const ref = (id) => ({ kind: 'path', sketchId: 'sketch', id });
const document = repeatedRingDocument();
document.collections.lines = {
  id: 'lines',
  name: '线组',
  origin: 'user',
  members: [ref('outer-path'), ref('inner-path')],
};
const before = structuredClone(document);
const plan = planPathDeletion(document, [ref('outer-path'), ref('outer-path')]);
assert.deepEqual(document, before, 'impact inspection is readonly');
assert.equal(plan.document.sketches.sketch.paths['outer-path'], undefined);
assert.equal(plan.document.sketches.sketch.edges['outer-edge'], undefined);
assert.equal(plan.document.sketches.sketch.vertices['outer-a'], undefined);
assert.deepEqual(
  plan.document.sketches.sketch.paths['inner-path'],
  document.sketches.sketch.paths['inner-path'],
);
assert.deepEqual(
  plan.document.programs,
  document.programs,
  'consumers remain repairable, never rebound to surviving paths',
);
assert.deepEqual(plan.document.collections, document.collections);
assert.ok(
  plan.impacts.some((item) => item.message.includes('Collection Path')),
);
assert.ok(plan.impacts.some((item) => item.message.includes('pathId')));
assert.deepEqual(
  new Set(plan.affectedOperators.map((item) => item.operatorId)),
  new Set(Object.keys(document.programs.program.operators)),
  'impact expands through mirror, array, join and fill',
);
assert.equal(evaluateProgram(plan.document, 'shape').curves.status, 'blocked');
assert.equal(evaluateProgram(plan.document, 'shape').regions.status, 'blocked');
assert.deepEqual(
  decodeDocument(encodeDocument(plan.document)).document,
  plan.document,
);
const editor = createEditorSession(document);
editor.dispatch(
  createPathDeletionCommand({
    kind: 'delete-paths',
    pathRefs: [ref('outer-path')],
  }),
  { expectedRevision: 0 },
);
assert.deepEqual(editor.state.document, plan.document);
editor.undo({ expectedRevision: editor.state.revision });
assert.deepEqual(editor.state.document, document);
assert.throws(
  () =>
    editor.dispatch(
      createPathDeletionCommand({
        kind: 'delete-paths',
        pathRefs: [ref('outer-path'), ref('missing')],
      }),
      { expectedRevision: editor.state.revision },
    ),
  /不存在/,
);
assert.deepEqual(editor.state.document, document);
const shared = structuredClone(document);
shared.sketches.sketch.paths.alias = {
  ...structuredClone(shared.sketches.sketch.paths['outer-path']),
  id: 'alias',
};
const kept = planPathDeletion(shared, [ref('outer-path')]);
assert.deepEqual(
  kept.document.sketches.sketch.edges,
  shared.sketches.sketch.edges,
);
assert.deepEqual(
  kept.document.sketches.sketch.vertices,
  shared.sketches.sketch.vertices,
);
assert.deepEqual(kept.removedRefs, [ref('outer-path')]);
shared.sketches.sketch.paths.dot = {
  id: 'dot',
  name: '共享单点',
  visible: true,
  edges: [],
  startVertexId: 'outer-a',
};
const partial = planPathDeletion(shared, [ref('outer-path'), ref('alias')]);
assert.deepEqual(
  partial.document.sketches.sketch.vertices['outer-a'],
  shared.sketches.sketch.vertices['outer-a'],
);
assert.equal(partial.document.sketches.sketch.vertices['outer-b'], undefined);
const all = planPathDeletion(shared, [
  ref('outer-path'),
  ref('alias'),
  ref('dot'),
]);
assert.equal(all.document.sketches.sketch.vertices['outer-a'], undefined);
const locked = structuredClone(document);
locked.nodes.shape.locked = true;
assert.throws(() => planPathDeletion(locked, [ref('outer-path')]), /锁定/);
assert.deepEqual(planPathDeletion(document, []).document, document);
console.log(
  'PASS path deletion preserves shared topology and repairable consumers, reports impacts, roundtrips broken graphs and undoes atomically',
);
