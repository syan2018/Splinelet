import assert from 'node:assert/strict';
import { regionOutlineOperator } from '../../../src/lib/construction/operators/regions/index.mjs';
import { makeOutputRef } from '../../../src/lib/construction/provenance.mjs';
import { readGeometry } from '../../../src/lib/region-engine.mjs';
import { createDocument } from '../../../src/lib/document/schema.mjs';
import { createAuthoringCommand } from '../../../src/lib/editing/commands/authoring.mjs';
import { evaluateProgram } from '../../../src/lib/construction/document-evaluation.mjs';

const ring = (x0, y0, x1, y1) => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
  [x0, y0],
];
const region = (id, rings) => ({
  ref: makeOutputRef('source', 'fill', 'regions', id, [`path:${id}`]),
  geometry: { type: 'Polygon', coordinates: rings },
});
const operator = {
  id: 'outline',
  type: 'region-outline',
  name: '外形',
  inputs: {},
  params: {},
  enabled: true,
};
const run = (regions, overrides = {}) =>
  regionOutlineOperator.evaluate({
    ownerNodeId: 'support',
    operator,
    inputs: {
      input: [
        {
          status: regions.length ? 'ready' : 'empty',
          domain: 'regions',
          value: {
            frame: { kind: 'local', ownerNodeId: 'source' },
            regions,
            provenance: [],
          },
          diagnostics: [],
          dependencies: ['source'],
          ...overrides,
        },
      ],
    },
  }).regions;
const donut = [
  region('donut', [ring(0, 0, 10, 10), ring(2, 2, 8, 8).reverse()]),
];
const before = structuredClone(donut);
assert.equal(readGeometry(donut[0].geometry).getArea(), 64);
const outlined = run(donut);
assert.equal(outlined.status, 'ready');
assert.equal(readGeometry(outlined.value.regions[0].geometry).getArea(), 100);
assert.deepEqual(donut, before);
assert.deepEqual(outlined.dependencies, ['source']);

// No individual partition has a hole; their union does. The result must still
// be the full exterior, matching the existing support construction pipeline.
const partitions = [
  region('bottom', [ring(0, 0, 10, 2)]),
  region('top', [ring(0, 8, 10, 10)]),
  region('left', [ring(0, 2, 2, 8)]),
  region('right', [ring(8, 2, 10, 8)]),
];
assert.equal(
  readGeometry(run(partitions).value.regions[0].geometry).getArea(),
  100,
);
assert.deepEqual(run(partitions), run([...partitions].reverse()));
const islands = run([...donut, region('island', [ring(20, 0, 25, 5)])]);
assert.equal(islands.value.regions.length, 1);
assert.equal(islands.value.regions[0].geometry.type, 'MultiPolygon');
assert.equal(readGeometry(islands.value.regions[0].geometry).getArea(), 125);
assert.equal(run([]).status, 'empty');
assert.equal(run([], { status: 'blocked' }).status, 'blocked');
assert.equal(regionOutlineOperator.validateParams({}), true);
assert.equal(
  typeof regionOutlineOperator.validateParams({ distanceMM: 1 }),
  'string',
);
assert.deepEqual(regionOutlineOperator.rebase(operator), operator);
assert.notEqual(regionOutlineOperator.copy(operator), operator);

// Resolve through the registered document graph, then edit the actual source.
let serial = 0;
const idFactory = () => `outline-${++serial}`;
let document = createDocument({ idFactory });
const drawn = createAuthoringCommand({
  kind: 'draw-path',
  closed: true,
  points: [
    [0, 0],
    [10, 0],
    [10, 10],
    [0, 10],
  ],
})(document, { idFactory });
document = drawn.document;
const pathRef = drawn.changedRefs.find((ref) => ref.kind === 'path');
const owner = document.sketches[pathRef.sketchId].ownerNodeId;
const program = document.programs[document.nodes[owner].programId];
program.operators.outline = {
  ...operator,
  inputs: {
    input: [
      {
        ...program.outputs.regions,
        space: 'local-result',
        transform: [1, 0, 0, 1, 0, 0],
      },
    ],
  },
};
program.outputs.regions = {
  kind: 'port',
  ownerNodeId: owner,
  operatorId: 'outline',
  port: 'regions',
  domain: 'regions',
};
const first = evaluateProgram(document, owner).regions;
assert.equal(first.status, 'ready');
assert.equal(readGeometry(first.value.regions[0].geometry).getArea(), 100);
for (const vertex of Object.values(
  document.sketches[pathRef.sketchId].vertices,
))
  vertex.position.value[0] *= 2;
const second = evaluateProgram(document, owner).regions;
assert.equal(readGeometry(second.value.regions[0].geometry).getArea(), 200);
assert.deepEqual(second.value.regions[0].ref, first.value.regions[0].ref);
console.log(
  'PASS canonical support outlines merge partitions before removing holes, preserve islands and input data, propagate blocked states and reevaluate from source',
);
