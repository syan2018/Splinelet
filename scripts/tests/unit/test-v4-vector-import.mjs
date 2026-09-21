import assert from 'node:assert/strict';
import {
  createDocument,
  validateDocument,
} from '../../../src/lib/document/schema.mjs';
import { createVectorImportCommand } from '../../../src/lib/editing/commands/vector-import.mjs';
import { createEditorSession } from '../../../src/lib/editing/dispatcher.mjs';
import { evaluateProgram } from '../../../src/lib/construction/document-evaluation.mjs';
import { createAuthoringCommand } from '../../../src/lib/editing/commands/authoring.mjs';
import { evaluateDocument } from '../../../src/lib/evaluation/evaluate-document.mjs';

let serial = 0;
const idFactory = () => `vector-import-${++serial}`;
const original = createDocument({ idFactory });
original.appearances.swatches.gold = {
  id: 'gold',
  name: '金色',
  color: '#c9a35c',
};
const rect = (points, role) => ({
  name: role,
  nodes: points.map(([x, y]) => ({ co: { x, y } })),
  closed: true,
  role,
  fillGroup: 'ring',
  elementId: 'ring',
  fill: '#c9a35c',
  stroke: null,
  strokeWidth: 0,
});
const stroke = {
  name: 'signature',
  nodes: [
    { co: { x: 0, y: 50 }, handleRight: { x: 20, y: 25 } },
    { co: { x: 100, y: 50 }, handleLeft: { x: 70, y: 75 } },
  ],
  closed: false,
  role: 'guide',
  fillGroup: 'signature',
  elementId: 'signature',
  fill: null,
  stroke: '#c9a35c',
  strokeWidth: 4,
};
const input = {
  name: 'Signature and ring',
  splines: [
    rect(
      [
        [0, 0],
        [100, 0],
        [100, 100],
        [0, 100],
      ],
      'boundary',
    ),
    rect(
      [
        [20, 20],
        [80, 20],
        [80, 80],
        [20, 80],
      ],
      'hole',
    ),
    stroke,
  ],
  bounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
  widthMM: 50,
  centerMM: [10, 15],
  thicknessMM: 0.8,
};
const before = structuredClone(original);
const result = createVectorImportCommand(input)(original, { idFactory });
assert.deepEqual(original, before, 'direct command does not mutate its input');
validateDocument(result.document);
const groupId = result.selectionIntent.activeRef.id;
assert.equal(result.document.nodes[groupId].kind, 'group');
assert.equal(result.selectionIntent.scope, 'objects');
const shapes = Object.values(result.document.nodes).filter(
  (node) => node.kind === 'shape',
);
assert.equal(shapes.length, 2);
assert.ok(shapes.every((node) => node.parentId === groupId));
assert.equal(
  Object.keys(result.document.appearances.swatches).length,
  1,
  'reuse existing color',
);
for (const shape of shapes) {
  const evaluation = evaluateProgram(result.document, shape.id);
  assert.equal(evaluation.curves.status, 'ready');
  assert.equal(evaluation.regions.status, 'ready');
  assert.equal(result.document.appearances.defaults[shape.id].swatchId, 'gold');
  assert.deepEqual(
    result.document.reliefDefinitions.defaults[shape.id].thickness,
    { kind: 'mm', value: 0.8 },
  );
}
const ring = shapes.find((shape) => shape.name === 'boundary');
const geometry = evaluateProgram(result.document, ring.id).regions.value
  .regions[0].geometry;
assert.equal(geometry.type, 'Polygon');
assert.equal(
  geometry.coordinates.length,
  2,
  'hole survives even-odd construction',
);
const signature = shapes.find((shape) => shape.name === 'signature');
const program = result.document.programs[signature.programId];
assert.equal(
  program.operators[program.outputs.regions.operatorId].params.widthMM,
  2,
);
const signatureSketch = Object.values(result.document.sketches).find(
  (sketch) => sketch.ownerNodeId === signature.id,
);
const edge = Object.values(signatureSketch.edges)[0];
assert.deepEqual(
  signatureSketch.vertices[edge.startVertexId].position.value,
  [-15, 15],
);
assert.deepEqual(edge.startHandle.vector, [10, 12.5]);
assert.deepEqual(edge.endHandle.vector, [-15, -12.5]);

const attached = createVectorImportCommand({
  ...input,
  centerMM: [-12, 15],
  attachId: ring.id,
})(result.document, { idFactory });
assert.deepEqual(
  attached.document.nodes[ring.id],
  result.document.nodes[ring.id],
);
assert.ok(
  Object.values(attached.document.reliefDefinitions.defaults).some(
    (value) =>
      value.placement.kind === 'attached' &&
      value.placement.target.kind === 'output' &&
      value.placement.target.ownerNodeId === ring.id,
  ),
);
assert.throws(
  () =>
    createVectorImportCommand({ ...input, attachId: ring.id })(
      result.document,
      { idFactory },
    ),
  /区域内部/,
  'a center in a hole cannot silently attach to the highest surface',
);
// A multi-height support attaches at the chosen panel, never the object's rim.
let support = createAuthoringCommand({
  kind: 'draw-path',
  closed: true,
  points: [
    [0, 0],
    [10, 0],
    [10, 10],
    [0, 10],
  ],
})(structuredClone(original), { idFactory }).document;
const supportId = Object.keys(support.nodes)[0];
support = createAuthoringCommand({
  kind: 'draw-path',
  ownerNodeId: supportId,
  closed: true,
  points: [
    [20, 0],
    [30, 0],
    [30, 10],
    [20, 10],
  ],
})(support, { idFactory }).document;
support.appearances.defaults[supportId] = { swatchId: 'gold' };
support.reliefDefinitions.defaults[supportId] = {
  enabled: true,
  mode: 'add',
  thickness: { kind: 'mm', value: 1 },
  placement: { kind: 'free', zMM: 0 },
};
const supportRegions = evaluateProgram(support, supportId).regions.value
  .regions;
const rim = supportRegions.find((region) =>
  region.geometry.coordinates[0].some((point) => point[0] > 15),
);
const overrideId = idFactory();
support.reliefDefinitions.overrides[overrideId] = {
  id: overrideId,
  target: rim.ref,
  value: { thickness: { kind: 'mm', value: 3 } },
};
const onPanel = createVectorImportCommand({
  ...input,
  splines: [stroke],
  widthMM: 4,
  centerMM: [5, 5],
  attachId: supportId,
})(support, { idFactory }).document;
const placed = await evaluateDocument(onPanel, {
  requestedDomains: ['placed-relief'],
});
assert.equal(placed.placedRelief.status, 'ready');
const newReliefs = placed.placedRelief.value.reliefs.filter(
  (item) => item.ref.ownerNodeId !== supportId,
);
assert(newReliefs.length);
for (const relief of newReliefs)
  assert.equal(
    relief.zBase,
    1,
    'panel is 1 mm, while the other region is 3 mm',
  );
const session = createEditorSession(original, { idFactory });
session.dispatch(createVectorImportCommand(input), {
  expectedRevision: session.state.revision,
});
assert.equal(Object.keys(session.state.document.nodes).length, 3);
session.undo({ expectedRevision: session.state.revision });
assert.deepEqual(
  session.state.document,
  original,
  'one undo removes the complete import',
);
session.redo({ expectedRevision: session.state.revision });
assert.equal(Object.keys(session.state.document.nodes).length, 3);

for (const bad of [
  { widthMM: 0 },
  { widthMM: Infinity },
  { centerMM: [NaN, 0] },
  { thicknessMM: -1 },
  { attachId: 'missing' },
  { splines: [input.splines[1]] },
  { splines: [{ ...stroke, strokeWidth: -1 }] },
  {
    splines: [
      { ...stroke, nodes: [{ co: { x: 0, y: 0 } }, { co: { x: NaN, y: 0 } }] },
    ],
  },
]) {
  assert.throws(() =>
    createVectorImportCommand({ ...input, ...bad })(original, { idFactory }),
  );
  assert.deepEqual(
    original,
    before,
    'invalid batch preserves original document',
  );
}
assert.throws(
  () =>
    createVectorImportCommand(input)(original, {
      idFactory: () => 'duplicate',
    }),
  /ID/,
);
assert.deepEqual(original, before);
console.log(
  'PASS: atomic vector import preserves cubics, holes, color reuse, grouping, scale, relief attachment, and undo/redo.',
);
