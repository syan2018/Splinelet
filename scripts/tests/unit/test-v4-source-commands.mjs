import assert from 'node:assert/strict';
import { createDocument } from '../../../src/lib/document/schema.mjs';
import { createEditorSession } from '../../../src/lib/editing/dispatcher.mjs';
import { createAuthoringCommand } from '../../../src/lib/editing/commands/authoring.mjs';
import { resolveRelation } from '../../../src/lib/geometry/relations.mjs';
let serial = 0;
const editor = createEditorSession(createDocument(), {
  idFactory: () => `source-command-${++serial}`,
});
const run = (action) =>
  editor.dispatch(createAuthoringCommand(action), {
    expectedRevision: editor.state.revision,
  });
run({
  kind: 'draw-path',
  points: [
    [0, 0],
    [10, 0],
    [20, 10],
  ],
  closed: false,
});
const sketch = Object.values(editor.state.document.sketches)[0];
const [first, second] = Object.values(sketch.edges);
const source = {
  kind: 'edge-end',
  sketchId: sketch.id,
  edgeId: first.id,
  end: 'end',
};
const target = {
  kind: 'edge-end',
  sketchId: sketch.id,
  edgeId: second.id,
  end: 'start',
};
run({
  kind: 'set-handle',
  sketchId: sketch.id,
  edgeId: first.id,
  end: 'end',
  vector: [-3, 0],
});
run({ kind: 'set-continuity', source, target, mode: 'symmetric' });
let relation = Object.values(editor.state.document.relations)[0];
const resolve = () =>
  resolveRelation({
    document: editor.state.document,
    sketch: editor.state.document.sketches[sketch.id],
    target,
    relationId: relation.id,
  });
assert.deepEqual(
  resolve().value.map((value) => value + 0),
  [3, 0],
);
assert.throws(
  () =>
    run({
      kind: 'set-handle',
      sketchId: sketch.id,
      edgeId: second.id,
      end: 'start',
      vector: [1, 2],
    }),
  /Relation/,
);
run({
  kind: 'create-parameter',
  value: {
    name: '柄长',
    ownerNodeId: sketch.ownerNodeId,
    unit: 'mm',
    value: 4,
  },
});
const parameter = Object.values(editor.state.document.parameters)[0];
run({
  kind: 'set-continuity',
  source,
  target,
  mode: 'smooth',
  length: { kind: 'parameter', id: parameter.id },
});
relation = Object.values(editor.state.document.relations)[0];
assert.deepEqual(
  resolve().value.map((value) => value + 0),
  [4, 0],
);
run({
  kind: 'edit-relation',
  relationId: relation.id,
  field: 'length',
  value: 6,
});
assert.equal(editor.state.document.parameters[parameter.id].value, 6);
assert.deepEqual(
  resolve().value.map((value) => value + 0),
  [6, 0],
);
run({ kind: 'release-relation', relationId: relation.id });
assert.deepEqual(
  editor.state.document.sketches[sketch.id].edges[second.id].startHandle,
  { kind: 'free', vector: [6, -0] },
);
editor.undo({ expectedRevision: editor.state.revision });
assert.equal(editor.state.document.relations[relation.id].mode, 'smooth');
const before = editor.state.document;
assert.throws(() =>
  run({ kind: 'set-continuity', source: target, target, mode: 'symmetric' }),
);
assert.deepEqual(editor.state.document, before);
run({ kind: 'set-continuity', target, mode: 'corner' });
run({ kind: 'split-edge', sketchId: sketch.id, edgeId: first.id, t: 0.5 });
assert.ok(editor.state.document.sketches[sketch.id].edges[first.id]);
assert.equal(
  Object.keys(editor.state.document.sketches[sketch.id].edges).length,
  3,
);
run({ kind: 'set-node', nodeId: sketch.ownerNodeId, value: { locked: true } });
assert.throws(
  () => run({ kind: 'set-parameter', id: parameter.id, value: 9 }),
  /锁定/,
);
console.log(
  'V4 source commands: finite relations, shared parameter, release/undo, stable split and lock passed',
);
