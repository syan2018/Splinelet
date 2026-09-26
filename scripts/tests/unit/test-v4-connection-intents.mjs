import assert from 'node:assert/strict';
import { createDocument } from '../../../src/lib/document/schema.mjs';
import { createAuthoringCommand } from '../../../src/lib/editing/commands/authoring.mjs';
import { createEditorSession } from '../../../src/lib/editing/dispatcher.mjs';
import { evaluateProgram } from '../../../src/lib/construction/document-evaluation.mjs';
import { evaluateDocument } from '../../../src/lib/evaluation/evaluate-document.mjs';
import { previewModelConstruction } from '../../../src/lib/editor/model-construction.mjs';
import { createConnectionIntent } from '../../../src/lib/editor/connection-intents.mjs';
import { projectCreationView } from '../../../src/lib/editor/creation-view.mjs';
import { sourcePathId } from '../../../src/lib/editor/source-view.mjs';

let serial = 0;
const idFactory = () => `connection-${++serial}`;
let document = createDocument({ version: 4, idFactory });
for (const [closed, points] of [
  [
    true,
    [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ],
  ],
  [
    false,
    [
      [0.1, 5],
      [9.9, 5],
    ],
  ],
])
  document = createAuthoringCommand({ kind: 'draw-path', closed, points })(
    document,
    { idFactory },
  ).document;
const [base, cutter] = Object.values(document.nodes);
const target = evaluateProgram(document, base.id).regions.value.regions[0].ref;
const sketch = Object.values(document.sketches).find(
  (item) => item.ownerNodeId === cutter.id,
);
const path = Object.values(sketch.paths)[0];
const prepared = previewModelConstruction(
  document,
  {
    kind: 'split',
    baseRef: target,
    pathRefs: [{ kind: 'path', sketchId: sketch.id, id: path.id }],
    joinMM: 0.15,
  },
  {},
  { idFactory },
);
const owner = prepared.ownerNodeId;
const editor = createEditorSession(prepared.document, { idFactory });
const before = editor.state.document;
const apply = (action, args) =>
  editor.dispatch(createConnectionIntent(action, args, editor.state), {
    expectedRevision: editor.state.revision,
  });
const view = async () =>
  projectCreationView(
    editor.state.document,
    await evaluateDocument(editor.state.document),
  );
let projected = await view();
assert.equal(
  projected.connections.filter((item) => item.objectId === owner).length,
  2,
);
assert.equal(
  projected.creation.objects.find((item) => item.id === owner).joinMM,
  0.15,
);
assert.ok(
  projected.connections.every(
    (item) => item.pathId === sourcePathId(sketch.id, path.id),
  ),
);
apply('join', { objectId: owner, joinMM: 0 });
projected = await view();
assert.equal(
  projected.connections.filter((item) => item.objectId === owner).length,
  0,
);
assert.equal(
  projected.diagnostics.filter(
    (item) => item.objectId === owner && item.status === 'unconnected',
  ).length,
  2,
);
assert.deepEqual(editor.state.document.sketches, before.sketches);
editor.undo({ expectedRevision: editor.state.revision });
assert.deepEqual(editor.state.document, before);
apply('connection', {
  objectId: owner,
  pathId: sourcePathId(sketch.id, path.id),
  endpoint: 0,
  disabled: true,
});
projected = await view();
assert.equal(
  projected.connections.filter((item) => item.objectId === owner).length,
  1,
);
assert.equal(
  projected.diagnostics.filter(
    (item) => item.objectId === owner && item.status === 'disabled',
  ).length,
  1,
);
assert.deepEqual(editor.state.document.sketches, before.sketches);
const disabled = editor.state.document;
assert.throws(() => apply('join', { objectId: owner, joinMM: -1 }), /距离/);
assert.deepEqual(editor.state.document, disabled);
editor.undo({ expectedRevision: editor.state.revision });
assert.deepEqual(editor.state.document, before);
console.log(
  'PASS partition connection edits and current world-space overlays preserve sources and undo atomically',
);
