import assert from 'node:assert/strict';
import { createDocument } from '../../../src/lib/document/schema.mjs';
import { createEditorSession } from '../../../src/lib/editing/dispatcher.mjs';
import { createAuthoringCommand } from '../../../src/lib/editing/commands/authoring.mjs';
import { evaluatePlanar } from '../../../src/lib/construction/document-evaluation.mjs';
import {
  projectCurvePreviews,
  curvePreviewStageId,
} from '../../../src/lib/editor/curve-preview.mjs';
import { componentId } from '../../../src/lib/construction/dependencies.mjs';
import { evaluateDocument } from '../../../src/lib/evaluation/evaluate-document.mjs';

let serial = 0;
const idFactory = () => `preview-${++serial}`;
const editor = createEditorSession(createDocument({ idFactory }), {
  idFactory,
});
const run = (action) =>
  editor.dispatch(createAuthoringCommand(action), {
    expectedRevision: editor.state.revision,
  });
run({
  kind: 'draw-path',
  points: [
    [1, 0],
    [3, 2],
  ],
  closed: false,
});
const owner = Object.values(editor.state.document.nodes)[0];
assert.deepEqual(
  projectCurvePreviews(
    editor.state.document,
    evaluatePlanar(editor.state.document),
  ),
  [],
);
run({
  kind: 'mirror-curves',
  ownerNodeId: owner.id,
  center: [0, 0],
  angleRad: 0,
});
run({
  kind: 'repeat-curves',
  ownerNodeId: owner.id,
  center: [0, 0],
  angleRad: Math.PI / 2,
  count: 3,
});
const document = structuredClone(editor.state.document);
document.nodes[owner.id].pose = {
  translationMM: [20, 30],
  rotationRad: Math.PI / 2,
};
const snapshot = evaluatePlanar(document);
const before = structuredClone({ document, snapshot });
const previews = projectCurvePreviews(document, snapshot);
assert.equal(previews.length, 3);
assert.deepEqual(
  projectCurvePreviews(document, { planar: snapshot }),
  previews,
);
assert.deepEqual(
  projectCurvePreviews(
    document,
    await evaluateDocument(document, {
      requestedDomains: ['curves', 'regions'],
    }),
  ),
  previews,
);
const final = previews.at(-1);
assert.equal(final.stageId, 'final');
assert.equal(final.curves.length, 6);
assert.deepEqual(final.curves[0][0], { x: 20, y: 31 });
assert.deepEqual(final.curves[0][3], { x: 18, y: 33 });
assert.equal(
  final.junctions.length,
  12,
  'coincident mirror endpoints are separate instances',
);
assert.ok(final.junctions.every((junction) => junction.degree === 1));
assert.throws(() => {
  final.curves[0][0].x = 999;
}, TypeError);
assert.deepEqual({ document, snapshot }, before);

const collision = structuredClone(document);
const collisionProgram = collision.programs[owner.programId];
collisionProgram.operators.final = {
  ...structuredClone(
    Object.values(collisionProgram.operators).find(
      (operator) => operator.type === 'curve-array',
    ),
  ),
  id: 'final',
};
const collisionViews = projectCurvePreviews(
  collision,
  evaluatePlanar(collision),
);
assert.equal(
  collisionViews.filter((stage) => stage.stageId === 'final').length,
  1,
);
assert.ok(
  collisionViews.some(
    (stage) => stage.stageId === curvePreviewStageId('final'),
  ),
);
assert.notEqual(
  curvePreviewStageId('a:b', 'c'),
  curvePreviewStageId('a', 'b:c'),
);

// A later unrelated stage must not replace the explicitly published source.
const branch = structuredClone(document);
const program = branch.programs[owner.programId];
const source = Object.values(program.operators).find(
  (operator) => operator.type === 'source',
);
program.outputs.curves = { ...program.outputs.curves, operatorId: source.id };
const branchPreview = projectCurvePreviews(branch, evaluatePlanar(branch));
assert.equal(branchPreview.at(-2).curves.length, 6);
assert.equal(branchPreview.at(-1).curves.length, 1);

// Fill may consume a different curve branch than the published curve view.
run({ kind: 'fill-curves', ownerNodeId: owner.id });
const fillBranch = structuredClone(editor.state.document);
const fillProgram = fillBranch.programs[owner.programId];
fillProgram.outputs.curves = {
  ...fillProgram.outputs.curves,
  operatorId: source.id,
};
const fill = Object.values(fillProgram.operators).find(
  (operator) => operator.type === 'fill',
);
assert.ok(fill);
assert.notEqual(fill.inputs.input[0].operatorId, source.id);
assert.equal(
  projectCurvePreviews(fillBranch, evaluatePlanar(fillBranch)).at(-1).curves
    .length,
  1,
);

// Final status is authoritative, even when an earlier curve stage is ready.
for (const status of ['blocked', 'empty', 'absent']) {
  const changed = structuredClone(snapshot);
  changed.published[`${owner.id}:curves`] = {
    domain: 'curves',
    status,
    diagnostics:
      status === 'blocked' ? [{ message: 'missing dependency' }] : [],
  };
  const projected = projectCurvePreviews(document, changed);
  assert.equal(projected.at(-2).curves.length, 6);
  assert.equal(projected.at(-1).curves.length, 0);
  if (status === 'blocked')
    assert.match(projected.at(-1).diagnostic, /missing dependency/);
}

const hidden = structuredClone(document);
hidden.nodes[owner.id].visible = false;
assert.deepEqual(projectCurvePreviews(hidden, snapshot), []);
run({ kind: 'group-nodes', nodeIds: [owner.id], name: 'parent' });
const parentHidden = structuredClone(editor.state.document);
parentHidden.nodes[parentHidden.nodes[owner.id].parentId].visible = false;
assert.deepEqual(
  projectCurvePreviews(parentHidden, evaluatePlanar(parentHidden)),
  [],
);

// Explicit shared vertex/Join connectivity supplies degree; distance does not.
const topology = structuredClone(snapshot);
const value = topology.published[`${owner.id}:curves`].value;
const edges = value.curves.flatMap((curve) => curve.edges);
edges[1].startKey = edges[0].startKey;
value.junctions = [
  {
    id: 'explicit',
    endpoints: [
      { edgeKey: edges[0].key, end: 'start' },
      { edgeKey: edges[2].key, end: 'start' },
    ],
  },
];
const junctions = projectCurvePreviews(document, topology).at(-1).junctions;
assert.equal(junctions.filter((junction) => junction.degree === 3).length, 1);
assert.equal(junctions.length, 10);
const invalid = structuredClone(topology);
invalid.published[
  `${owner.id}:curves`
].value.junctions[0].endpoints[0].edgeKey = 'missing';
assert.equal(projectCurvePreviews(document, invalid).at(-1).curves.length, 0);
assert.match(
  projectCurvePreviews(document, invalid).at(-1).diagnostic,
  /不存在/,
);
assert.ok(snapshot.components[componentId(source.id)]);
assert.throws(() => projectCurvePreviews(document, {}), /完整当前/);
console.log('V4 curve preview projection passed');

// Ordinary source guides must not acquire derived-preview warnings solely from
// the identity collector used to keep their Fill membership separate.
const guideResult = createAuthoringCommand({
  kind: 'draw-guide',
  closed: false,
  points: [
    [0, 0],
    [8, 4],
  ],
})(createDocument({ idFactory }), { idFactory });
const guideDocument = guideResult.document;
assert.deepEqual(
  projectCurvePreviews(guideDocument, evaluatePlanar(guideDocument)),
  [],
);
const guideProgram = Object.values(guideDocument.programs)[0];
const collector = Object.values(guideProgram.operators).find(
  (op) => op.type === 'curve-collect',
);
collector.inputs.input[0].transform[4] = 2;
assert.ok(
  projectCurvePreviews(guideDocument, evaluatePlanar(guideDocument)).length > 0,
);
