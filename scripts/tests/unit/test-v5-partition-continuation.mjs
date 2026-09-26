import assert from 'node:assert/strict';
import { createDocument } from '../../../src/lib/document/schema.mjs';
import { createEditorSession } from '../../../src/lib/editing/dispatcher.mjs';
import { createAuthoringCommand } from '../../../src/lib/editing/commands/authoring.mjs';
import { createAdvancedCommand } from '../../../src/lib/editing/commands/advanced.mjs';
import { evaluateProgram } from '../../../src/lib/construction/document-evaluation.mjs';
import { readGeometry } from '../../../src/lib/region-engine.mjs';

let serial = 0;
const idFactory = () => `continuation-${++serial}`;
const editor = createEditorSession(createDocument({ version: 5, idFactory }), {
  idFactory,
});
const dispatch = (command) =>
  editor.dispatch(command, { expectedRevision: editor.state.revision });
const run = (action) => dispatch(createAuthoringCommand(action));
run({
  kind: 'draw-path',
  closed: true,
  points: [
    [0, 0],
    [10, 0],
    [10, 10],
    [0, 10],
  ],
});
const owner = Object.keys(editor.state.document.nodes)[0];
const stage = () => evaluateProgram(editor.state.document, owner).regions;
run({ kind: 'create-swatch', name: 'red', color: '#ff0000' });
const swatchId = Object.keys(editor.state.document.appearances.swatches)[0];
run({ kind: 'paint-region', target: stage().value.regions[0].ref, swatchId });
run({
  kind: 'set-thickness',
  target: stage().value.regions[0].ref,
  thickness: { kind: 'mm', value: 1.5 },
});
const known = new Set(Object.keys(editor.state.document.sketches));
run({
  kind: 'start-path',
  role: 'divider',
  ownerNodeId: owner,
  targets: [stage().value.regions[0].ref],
  point: [-1, 5],
});
const sketch = Object.values(editor.state.document.sketches).find(
  (item) => !known.has(item.id),
);
const pathId = Object.keys(sketch.paths)[0];
run({
  kind: 'extend-path',
  sketchId: sketch.id,
  pathId,
  cubic: [
    [-1, 5],
    [-1, 5],
    [11, 5],
    [11, 5],
  ],
});
run({ kind: 'finish-path', sketchId: sketch.id, pathId });
const partition = Object.values(
  editor.state.document.programs[editor.state.document.nodes[owner].programId]
    .operators,
).find((item) => item.type === 'partition');
dispatch(
  createAdvancedCommand({
    kind: 'set-operator',
    ownerNodeId: owner,
    operatorId: partition.id,
    params: {
      ...partition.params,
      endpointJoin: { toleranceMM: 0.5, cohorts: [[pathId]] },
    },
  }),
);
assert.equal(stage().value.regions.length, 2);
const before = stage().value.regions;
const vertex = Object.values(
  editor.state.document.sketches[sketch.id].vertices,
).find((item) => item.position.value[0] === 11);
for (const x of [9.8, 11]) {
  run({
    kind: 'set-vertex',
    sketchId: sketch.id,
    vertexId: vertex.id,
    value: [x, 5],
  });
  const after = stage();
  assert.equal(after.status, 'ready');
  assert.ok(!after.diagnostics.some((item) => item.severity === 'error'));
  for (const region of after.value.regions) {
    const old = before.find((item) => item.ref.key === region.ref.key);
    assert.ok(
      old,
      'crossing the raw endpoint must preserve the complete cutting-use definition',
    );
    assert.ok(
      readGeometry(old.geometry)
        .symDifference(readGeometry(region.geometry))
        .getArea() < 1e-8,
    );
    assert.equal(
      Object.values(editor.state.document.appearances.overrides).find(
        (item) => item.target.key === region.ref.key,
      ).value.swatchId,
      swatchId,
    );
    assert.equal(
      Object.values(editor.state.document.reliefDefinitions.overrides).find(
        (item) => item.target.key === region.ref.key,
      ).value.thickness.value,
      1.5,
    );
  }
}
console.log(
  'PASS endpoint-connected partition identity survives a generated continuation appearing or disappearing',
);
