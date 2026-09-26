import assert from 'node:assert/strict';
import { createDocument } from '../../../src/lib/document/schema.mjs';
import { createEditorSession } from '../../../src/lib/editing/dispatcher.mjs';
import { createAuthoringCommand } from '../../../src/lib/editing/commands/authoring.mjs';
import { evaluateProgram } from '../../../src/lib/construction/document-evaluation.mjs';
import { readGeometry } from '../../../src/lib/region-engine.mjs';
import {
  encodeDocument,
  decodeDocument,
} from '../../../src/lib/document/codec.mjs';

let serial = 0;
const idFactory = () => `region-v5-${++serial}`;
const session = createEditorSession(createDocument({ version: 5, idFactory }), {
  idFactory,
});
const run = (request) =>
  session.dispatch(createAuthoringCommand(request), {
    expectedRevision: session.state.revision,
  });
run({
  kind: 'draw-path',
  points: [
    [0, 0],
    [10, 0],
    [10, 10],
    [0, 10],
  ],
  closed: true,
});
const ownerNodeId = Object.keys(session.state.document.nodes)[0];
const regions = () => {
  const stage = evaluateProgram(session.state.document, ownerNodeId).regions;
  assert.equal(stage.status, 'ready', JSON.stringify(stage.diagnostics));
  return stage.value.regions;
};
run({ kind: 'create-swatch', name: 'red', color: '#ff0000' });
const swatchId = Object.keys(session.state.document.appearances.swatches)[0];
run({ kind: 'paint-region', target: regions()[0].ref, swatchId });
run({
  kind: 'set-thickness',
  target: regions()[0].ref,
  thickness: { kind: 'mm', value: 1.25 },
});
const base = regions()[0].ref;
assert.ok(session.state.document.regionDefinitions[base.key]);
const known = new Set(Object.keys(session.state.document.sketches));
run({
  kind: 'start-path',
  role: 'divider',
  point: [-1, 5],
  ownerNodeId,
  targets: [base],
});
const sketch = Object.values(session.state.document.sketches).find(
  (item) => !known.has(item.id),
);
const pathId = Object.keys(sketch.paths)[0];
for (const [from, to] of [
  [
    [-1, 5],
    [5, 5],
  ],
  [
    [5, 5],
    [11, 5],
  ],
])
  run({
    kind: 'extend-path',
    sketchId: sketch.id,
    pathId,
    cubic: [from, from, to, to],
  });
run({ kind: 'finish-path', sketchId: sketch.id, pathId });
assert.equal(regions().length, 2);
run({ kind: 'create-swatch', name: 'blue', color: '#0000ff' });
const blue = Object.keys(session.state.document.appearances.swatches).at(-1);
const upper = () =>
  regions().find(
    (region) => readGeometry(region.geometry).getCentroid().getY() > 5,
  );
run({ kind: 'paint-region', target: upper().ref, swatchId: blue });
run({
  kind: 'set-thickness',
  target: upper().ref,
  thickness: { kind: 'mm', value: 2.5 },
});
const before = new Map(
  regions().map((region) => [region.ref.key, region.geometry]),
);
const assertPhysicalAssignments = () => {
  for (const region of regions()) {
    const isUpper = readGeometry(region.geometry).getCentroid().getY() > 5;
    const appearance = Object.values(
      session.state.document.appearances.overrides,
    ).find((item) => item.target.key === region.ref.key);
    const relief = Object.values(
      session.state.document.reliefDefinitions.overrides,
    ).find((item) => item.target.key === region.ref.key);
    assert.equal(appearance.value.swatchId, isUpper ? blue : swatchId);
    assert.equal(relief.value.thickness.value, isUpper ? 2.5 : 1.25);
  }
};
const documentBefore = session.state.document;
run({ kind: 'reverse-path', sketchId: sketch.id, pathId });
for (const region of regions()) {
  assert.ok(before.has(region.ref.key));
  assert.equal(
    readGeometry(region.geometry)
      .symDifference(readGeometry(before.get(region.ref.key)))
      .getArea(),
    0,
  );
}
assertPhysicalAssignments();
const reversed = session.state.document;
const currentPath = reversed.sketches[sketch.id].paths[pathId];
const middle = Object.values(reversed.sketches[sketch.id].vertices).find(
  (vertex) => vertex.position.value[0] === 5,
);
run({
  kind: 'delete-path-vertices',
  pathRef: { kind: 'path', sketchId: sketch.id, id: pathId },
  expectedEdges: currentPath.edges,
  vertexIds: [middle.id],
  toleranceMM: 0.01,
});
for (const region of regions()) {
  assert.ok(before.has(region.ref.key));
  assert.equal(
    readGeometry(region.geometry)
      .symDifference(readGeometry(before.get(region.ref.key)))
      .getArea(),
    0,
  );
}
assertPhysicalAssignments();
assert.equal(Object.keys(session.state.document.regionDefinitions).length, 3);
assert.deepEqual(
  decodeDocument(encodeDocument(session.state.document)).document,
  session.state.document,
);
session.undo({ expectedRevision: session.state.revision });
session.undo({ expectedRevision: session.state.revision });
assert.deepEqual(session.state.document, documentBefore);
console.log(
  'PASS V5 declarative regions retain physical faces through reversal, deletion, save and undo',
);
