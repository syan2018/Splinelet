import assert from 'node:assert/strict';
import { createDocument } from '../../../src/lib/document/schema.mjs';
import { createEditorSession } from '../../../src/lib/editing/dispatcher.mjs';
import { createAuthoringCommand } from '../../../src/lib/editing/commands/authoring.mjs';
import { evaluateProgram } from '../../../src/lib/construction/document-evaluation.mjs';
import { resolveRelief } from '../../../src/lib/relief/resolve.mjs';
import { repeatedRingDocument } from '../fixtures/v4-programs.mjs';
let serial = 0;
const idFactory = () => `author-${++serial}`;
const document = createDocument({ idFactory });
document.appearances.swatches.red = {
  id: 'red',
  name: '红色',
  color: '#ff0000',
};
document.appearances.swatches.blue = {
  id: 'blue',
  name: '蓝色',
  color: '#0000ff',
};
const session = createEditorSession(document, { idFactory });
const run = (action) =>
  session.dispatch(createAuthoringCommand(action), {
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
  closed: false,
});
const shape = Object.keys(session.state.document.nodes)[0];
let result = evaluateProgram(session.state.document, shape);
assert.equal(result.curves.status, 'ready');
assert.equal(result.regions.status, 'absent');
const sketch = Object.values(session.state.document.sketches)[0];
run({
  kind: 'close-path',
  sketchId: sketch.id,
  pathId: Object.keys(sketch.paths)[0],
});
result = evaluateProgram(session.state.document, shape);
assert.equal(result.regions.status, 'ready');
assert.equal(
  resolveRelief(session.state.document, result.regions).status,
  'empty',
);
const target = result.regions.value.regions[0].ref;
run({ kind: 'paint-region', target, swatchId: 'red' });
let relief = resolveRelief(session.state.document, result.regions);
assert.equal(relief.status, 'ready');
assert.equal(relief.value.reliefs[0].thickness.value, 1);
run({ kind: 'set-thickness', target, thickness: { kind: 'mm', value: 3 } });
run({ kind: 'paint-region', target, swatchId: 'blue' });
relief = resolveRelief(session.state.document, result.regions);
assert.equal(
  relief.value.reliefs[0].thickness.value,
  3,
  'recolor retains thickness',
);
assert.equal(relief.value.reliefs[0].color, '#0000ff');
session.undo({ expectedRevision: session.state.revision });
relief = resolveRelief(session.state.document, result.regions);
assert.equal(relief.value.reliefs[0].color, '#ff0000');
assert.equal(relief.value.reliefs[0].thickness.value, 3);
const raw = structuredClone(session.state.document.sketches);
run({ kind: 'move-nodes', nodeIds: [shape], deltaMM: [20, -8] });
assert.deepEqual(
  session.state.document.sketches,
  raw,
  'move changes pose only',
);
const before = session.state.revision;
assert.throws(
  () =>
    run({
      kind: 'paint-region',
      target: { ...target, key: 'gone' },
      swatchId: 'red',
    }),
  /失效/,
);
assert.equal(session.state.revision, before);
const advanced = createEditorSession(repeatedRingDocument(), { idFactory });
assert.throws(
  () =>
    advanced.dispatch(
      createAuthoringCommand({
        kind: 'draw-path',
        ownerNodeId: 'shape',
        points: [
          [0, 0],
          [1, 1],
        ],
      }),
      { expectedRevision: 0 },
    ),
  /高级构造/,
);
assert.equal(advanced.state.revision, 0);
// Closed drawing is one atomic history entry, including its implicit Source/Fill.
const simple = createEditorSession(createDocument({ idFactory }), {
  idFactory,
});
simple.dispatch(
  createAuthoringCommand({
    kind: 'draw-path',
    closed: true,
    points: [
      [0, 0],
      [3, 0],
      [0, 3],
    ],
  }),
  { expectedRevision: 0 },
);
assert.equal(simple.state.revision, 1);
simple.undo({ expectedRevision: 1 });
assert.equal(Object.keys(simple.state.document.nodes).length, 0);
simple.dispatch(
  createAuthoringCommand({
    kind: 'draw-path',
    closed: true,
    points: [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ],
  }),
  { expectedRevision: simple.state.revision },
);
const shapeId = Object.keys(simple.state.document.nodes)[0];
const initialRegion = evaluateProgram(simple.state.document, shapeId).regions
  .value.regions[0];
simple.dispatch(
  createAuthoringCommand({
    kind: 'draw-path',
    ownerNodeId: shapeId,
    closed: false,
    points: [
      [20, 20],
      [30, 30],
    ],
  }),
  { expectedRevision: simple.state.revision },
);
assert.equal(
  evaluateProgram(simple.state.document, shapeId).regions.status,
  'ready',
  'open auxiliary drawing does not break closed Fill',
);
assert.deepEqual(
  evaluateProgram(simple.state.document, shapeId).regions.value.regions[0].ref,
  initialRegion.ref,
);
const holeBaseline = structuredClone(simple.state.document);
simple.dispatch(
  createAuthoringCommand({
    kind: 'draw-hole',
    targets: [initialRegion.ref],
    closed: true,
    points: [
      [2, 2],
      [4, 2],
      [4, 4],
      [2, 4],
    ],
  }),
  { expectedRevision: simple.state.revision },
);
assert.equal(
  evaluateProgram(simple.state.document, shapeId).regions.value.regions[0]
    .geometry.coordinates.length,
  2,
);
simple.undo({ expectedRevision: simple.state.revision });
assert.deepEqual(
  simple.state.document,
  holeBaseline,
  'hole gesture adds source and boolean in one transaction',
);
console.log(
  'PASS: ordinary authoring shares atomic transactions, explicit topology and current output assignments.',
);
