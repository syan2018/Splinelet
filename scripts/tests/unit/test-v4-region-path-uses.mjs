import assert from 'node:assert/strict';
import { createDocument } from '../../../src/lib/document/schema.mjs';
import { createAuthoringCommand } from '../../../src/lib/editing/commands/authoring.mjs';
import {
  regionPathUses,
  findRegionDrawing,
} from '../../../src/lib/editing/region-drawing.mjs';
import { evaluateProgram } from '../../../src/lib/construction/document-evaluation.mjs';
import { projectCreationView } from '../../../src/lib/editor/creation-view.mjs';
import { sourcePathId } from '../../../src/lib/editor/source-view.mjs';

let serial = 0;
const idFactory = () => `roles-${++serial}`;
let document = createDocument({ idFactory });
const run = (action) => {
  const result = createAuthoringCommand(action)(document, { idFactory });
  document = result.document;
  return result.changedRefs.find((ref) => ref.kind === 'path');
};
const outer = run({
  kind: 'draw-path',
  closed: true,
  points: [
    [0, 0],
    [20, 0],
    [20, 20],
    [0, 20],
  ],
});
const owner = document.sketches[outer.sketchId].ownerNodeId;
const inner = run({
  kind: 'draw-path',
  ownerNodeId: owner,
  closed: true,
  points: [
    [5, 5],
    [15, 5],
    [15, 15],
    [5, 15],
  ],
});
const roles = (ref) =>
  regionPathUses(document, ref)
    .map((use) => use.role)
    .sort();
assert.deepEqual(roles(outer), ['boundary']);
assert.deepEqual(roles(inner), ['boundary']);
assert.equal(findRegionDrawing(document, outer), null);
const program = document.programs[document.nodes[owner].programId];
const fill = program.operators[program.outputs.regions.operatorId];
const source = program.operators[fill.inputs.input[0].operatorId];
delete source.inputs.paths[0].pathIds;
assert.deepEqual(roles(outer), ['boundary']);
const before = structuredClone(document);
const view = projectCreationView(document, {});
const object = view.creation.objects.find((item) => item.id === owner);
assert.equal(object.roles[sourcePathId(outer.sketchId, outer.id)], 'boundary');
assert.equal(object.roles[sourcePathId(inner.sketchId, inner.id)], 'boundary');
assert.deepEqual(document, before);

const hole = run({
  kind: 'draw-hole',
  closed: true,
  targets: evaluateProgram(document, owner).regions.value.regions.map(
    (region) => region.ref,
  ),
  points: [
    [1, 1],
    [3, 1],
    [3, 3],
    [1, 3],
  ],
});
assert.deepEqual(roles(hole), ['hole']);
assert.deepEqual(roles(outer), ['boundary']);
assert.equal(findRegionDrawing(document, hole), null);
const holeUse = regionPathUses(document, hole)[0];
const holeOperator = program.operators[holeUse.operatorId];
const holeFill = program.operators[holeOperator.inputs.operand[0].operatorId];
const published = program.outputs.regions;
program.outputs.regions = { ...published, operatorId: holeFill.id };
assert.deepEqual(roles(hole), ['boundary', 'hole']);
assert.equal(
  projectCreationView(document, {}).creation.objects.find(
    (item) => item.id === owner,
  ).roles[sourcePathId(hole.sketchId, hole.id)],
  undefined,
);
program.outputs.regions = published;
assert.deepEqual(roles(hole), ['hole']);

const guide = run({
  kind: 'draw-guide',
  closed: true,
  ownerNodeId: owner,
  points: [
    [30, 30],
    [35, 30],
    [35, 35],
    [30, 35],
  ],
});
assert.deepEqual(roles(guide), []);
assert.equal(findRegionDrawing(document, guide), null);
const pending = run({
  kind: 'start-path',
  ownerNodeId: owner,
  point: [40, 40],
});
const drawing = findRegionDrawing(document, pending);
assert.equal(drawing.role, 'boundary');
const pendingProgram = document.programs[document.nodes[owner].programId];
const pendingFill = pendingProgram.operators[drawing.operatorId];
const pendingSource =
  pendingProgram.operators[pendingFill.inputs.input[0].operatorId];
pendingSource.inputs.paths[0].pathIds.push(pending.id);
assert.equal(findRegionDrawing(document, pending), null);
console.log(
  'PASS published boundaries, shared Source lists, hole operands and genuine multi-role uses project accurately without altering drawing state or source data',
);
