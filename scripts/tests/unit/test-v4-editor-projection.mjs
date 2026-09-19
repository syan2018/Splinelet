import assert from 'node:assert/strict';
import { repeatedRingDocument } from '../fixtures/v4-programs.mjs';
import { evaluatePlanar } from '../../../src/lib/construction/document-evaluation.mjs';
import { transformNodes } from '../../../src/lib/scene/hierarchy.mjs';
import { projectEditor } from '../../../src/lib/editor/projection.mjs';
import { deriveEditableHandle } from '../../../src/lib/editor/picking.mjs';
import { selectionContains } from '../../../src/lib/editor/selection.mjs';
const doc = repeatedRingDocument();
doc.nodes.empty = {
  id: 'empty',
  name: '空部件',
  kind: 'shape',
  parentId: null,
  order: 1,
  pose: { translationMM: [0, 0], rotationRad: 0 },
  visible: true,
  locked: false,
  programId: 'empty-program',
};
doc.programs['empty-program'] = {
  id: 'empty-program',
  ownerNodeId: 'empty',
  operators: {},
  outputs: {},
};
const snapshot = evaluatePlanar(doc),
  selected = {
    scope: 'regions',
    entityRefs: [
      {
        kind: 'output',
        ownerNodeId: 'gone',
        operatorId: 'fill',
        port: 'regions',
        key: 'lost',
        instances: [],
        lineage: [],
      },
    ],
  };
const view = projectEditor(doc, snapshot, { selection: selected });
assert.equal(
  view.canvas.curves.length,
  snapshot.published['shape:curves'].value.curves.length,
);
assert.equal(view.canvas.candidates.length, 1);
assert.ok(view.tree.some((node) => node.id === 'empty'));
assert.deepEqual(view.selection.entityRefs, selected.entityRefs);
const moved = transformNodes(doc, ['shape'], [1, 0, 0, 1, 20, -4]);
const movedBounds = projectEditor(moved, evaluatePlanar(moved)).canvas.bounds
  .regions;
assert.deepEqual(
  movedBounds.map((v, i) => v - view.canvas.bounds.regions[i]),
  [20, -4, 20, -4],
);
const hidden = structuredClone(doc);
hidden.nodes.shape.visible = false;
assert.equal(
  projectEditor(hidden, evaluatePlanar(hidden)).canvas.candidates.length,
  0,
);
const failed = structuredClone(doc);
failed.sketches.sketch.vertices['outer-b'].position.value[0] += 0.1;
const bad = projectEditor(failed, evaluatePlanar(failed));
assert.ok(bad.canvas.curves.length > 0);
assert.equal(bad.canvas.candidates.length, 0);
assert.equal(bad.tree.find((node) => node.id === 'shape').state, 'blocked');
assert.equal(
  selectionContains(
    { entityRefs: [{ kind: 'node', id: 'ab' }] },
    { kind: 'node', id: 'a' },
  ),
  false,
);
assert.equal(
  deriveEditableHandle({
    source: {
      kind: 'edge-end',
      sketchId: 'sketch',
      edgeId: 'edge',
      end: 'start',
    },
    transform: [1, 0, 0, 1, 0, 0],
    instances: [{ operatorId: 'array', index: 0 }],
  }).editable,
  true,
);
assert.equal(
  deriveEditableHandle({
    source: { kind: 'edge-end', sketchId: 's', edgeId: 'e', end: 'start' },
    instances: [],
  }).editable,
  false,
);
console.log(
  'PASS: V4 editor published-only projection, stable selection and guarded derived handles.',
);
