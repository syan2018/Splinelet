import assert from 'node:assert/strict';
import {
  booleanOperator,
  betweenOperator,
  legacyRecipeCapabilities,
  offsetOperator,
  partitionOperator,
  regionArrayOperator,
  regionReferenceOperator,
  strokeOperator,
} from '../../../src/lib/construction/operators/regions/index.mjs';
import { makeOutputRef } from '../../../src/lib/construction/provenance.mjs';
import { readGeometry } from '../../../src/lib/region-engine.mjs';

const region = (key, geometry, lineage = [key]) => ({
  ref: makeOutputRef('shape-a', 'fill', 'regions', key, lineage),
  geometry,
});
const square = (x, y, size) => ({
  type: 'Polygon',
  coordinates: [
    [
      [x, y],
      [x + size, y],
      [x + size, y + size],
      [x, y + size],
      [x, y],
    ],
  ],
});
const source = {
  domain: 'regions',
  status: 'ready',
  diagnostics: [],
  dependencies: ['source'],
  value: {
    frame: { kind: 'local', ownerNodeId: 'shape-a' },
    regions: [region('a', square(0, 0, 10)), region('b', square(20, 0, 5))],
    provenance: [],
  },
};
const selectedA = { kind: 'selected', refs: [source.value.regions[0].ref] };
const invoke = (spec, operator, inputs, context = {}) =>
  spec.evaluate({
    document: { geometrySettings: { curveToleranceMM: 0.015 } },
    ownerNodeId: 'shape-b',
    operator,
    inputs,
    context,
  }).regions;

const reference = invoke(
  regionReferenceOperator,
  { id: 'reference', params: {} },
  { input: [source] },
);
assert.equal(reference.status, 'ready');
assert.equal(reference.value.frame.ownerNodeId, 'shape-b');
assert.notEqual(
  reference.value.regions[0].ref.ownerNodeId,
  source.value.regions[0].ref.ownerNodeId,
);

const offset = invoke(
  offsetOperator,
  { id: 'offset', params: { scope: selectedA, distanceMM: -10 } },
  { input: [source] },
);
assert.equal(offset.status, 'ready');
assert.equal(offset.value.regions.length, 1);
assert.equal(offset.value.regions[0].ref.key, source.value.regions[1].ref.key);
assert.equal(
  invoke(
    offsetOperator,
    {
      id: 'empty',
      params: { scope: { kind: 'selected', refs: [] }, distanceMM: 1 },
    },
    { input: [source] },
  ).value.regions.length,
  2,
);
assert.equal(
  invoke(
    offsetOperator,
    {
      id: 'missing',
      params: {
        scope: {
          kind: 'selected',
          refs: [makeOutputRef('x', 'y', 'regions', 'missing', [])],
        },
        distanceMM: 1,
      },
    },
    { input: [source] },
  ).status,
  'blocked',
);

const operand = {
  ...source,
  value: {
    ...source.value,
    regions: [region('cut', square(4, 0, 10), ['cut'])],
  },
};
const cut = invoke(
  booleanOperator,
  { id: 'cut', params: { operation: 'difference', scope: selectedA } },
  { input: [source], operand: [operand] },
);
assert.equal(cut.status, 'ready');
assert.equal(cut.value.regions.length, 2);
assert.equal(
  readGeometry(
    cut.value.regions.find((item) => item.ref.key !== 'b').geometry,
  ).getArea(),
  40,
);

const repeated = invoke(
  regionArrayOperator,
  {
    id: 'array',
    params: { scope: selectedA, center: [0, 0], angleRad: Math.PI, count: 2 },
  },
  { input: [source] },
);
assert.equal(repeated.value.regions.length, 3);
assert.equal(
  repeated.value.regions.filter(
    (item) => item.ref.instances[0]?.operatorId === 'array',
  ).length,
  2,
);

const curves = {
  domain: 'curves',
  status: 'ready',
  diagnostics: [],
  dependencies: [],
  value: {
    frame: { kind: 'local', ownerNodeId: 'shape-a' },
    curves: [
      {
        key: 'line',
        edges: [
          {
            cubic: [
              [0, 0],
              [0, 0],
              [10, 0],
              [10, 0],
            ],
            source: { sketchId: 'sketch', id: 'edge' },
            instances: [],
          },
        ],
      },
    ],
    junctions: [],
    provenance: [],
  },
};
const stroke = invoke(
  strokeOperator,
  { id: 'stroke', params: { widthMM: 2 } },
  { input: [curves] },
);
assert.equal(stroke.status, 'ready');
assert.ok(readGeometry(stroke.value.regions[0].geometry).getArea() > 20);

const cutter = {
  domain: 'curves',
  status: 'ready',
  diagnostics: [],
  dependencies: [],
  value: {
    frame: { kind: 'local', ownerNodeId: 'shape-a' },
    curves: [
      {
        key: 'cutter',
        edges: [
          {
            cubic: [
              [5, -2],
              [5, -2],
              [5, 12],
              [5, 12],
            ],
            source: { sketchId: 'sketch', id: 'cutter' },
            instances: [],
          },
        ],
      },
    ],
    junctions: [],
    provenance: [],
  },
};
const partitioned = invoke(
  partitionOperator,
  { id: 'partition', params: { scope: selectedA } },
  { input: [source], cutter: [cutter] },
);
assert.equal(
  partitioned.status,
  'ready',
  JSON.stringify(partitioned.diagnostics),
);
assert.equal(partitioned.value.regions.length, 3);
assert.equal(partitioned.value.provenance[0].kind, 'output-contract-proposal');

assert.equal(legacyRecipeCapabilities.path.status, 'supported');
const crossCurves = structuredClone(curves);
crossCurves.value.curves = [
  {
    key: 'left',
    edges: [
      {
        cubic: [
          [0, 0],
          [0, 0],
          [10, 10],
          [10, 10],
        ],
        source: { sketchId: 'sketch', id: 'left-edge' },
        instances: [],
      },
    ],
  },
  {
    key: 'right',
    edges: [
      {
        cubic: [
          [0, 10],
          [0, 10],
          [10, 0],
          [10, 0],
        ],
        source: { sketchId: 'sketch', id: 'right-edge' },
        instances: [],
      },
    ],
  },
];
const crossing = (repair, source = crossCurves) =>
  invoke(
    betweenOperator,
    { id: 'crossing-band', params: { curveKeys: ['left', 'right'], repair } },
    { input: [source] },
  );
assert.equal(crossing(false).status, 'blocked');
const repairedBand = crossing(true);
assert.equal(repairedBand.status, 'ready');
assert.equal(repairedBand.value.regions.length, 1);
assert.equal(repairedBand.value.regions[0].geometry.type, 'MultiPolygon');
assert.equal(
  readGeometry(repairedBand.value.regions[0].geometry).getArea(),
  50,
);
assert(
  repairedBand.diagnostics.some(
    (item) => item.code === 'repaired-self-intersection',
  ),
);
const movedCrossing = structuredClone(crossCurves);
movedCrossing.value.curves[0].edges[0].cubic[2][1] = 12;
movedCrossing.value.curves[0].edges[0].cubic[3][1] = 12;
const movedBand = crossing(true, movedCrossing);
assert.equal(movedBand.status, 'ready');
assert.deepEqual(
  movedBand.value.regions[0].ref,
  repairedBand.value.regions[0].ref,
);
assert(
  readGeometry(movedBand.value.regions[0].geometry)
    .symDifference(readGeometry(repairedBand.value.regions[0].geometry))
    .getArea() > 0,
);
const strip = {
  ...operand,
  value: {
    ...operand.value,
    regions: [
      region('strip', {
        type: 'Polygon',
        coordinates: [
          [
            [4, -1],
            [6, -1],
            [6, 11],
            [4, 11],
            [4, -1],
          ],
        ],
      }),
    ],
  },
};
const splitBoolean = (other) =>
  invoke(
    booleanOperator,
    {
      id: 'split-boolean',
      params: { scope: selectedA, operation: 'difference' },
    },
    { input: [source], operand: [other] },
  );
const separated = splitBoolean(strip);
assert.equal(separated.status, 'ready');
const separateOutput = separated.value.regions.find(
  (item) => item.ref.operatorId === 'split-boolean',
);
assert.equal(separateOutput.geometry.type, 'MultiPolygon');
assert.equal(separateOutput.geometry.coordinates.length, 2);
assert.equal(readGeometry(separateOutput.geometry).getArea(), 80);
assert.equal(
  separated.value.regions.length,
  2,
  'two islands are one semantic region plus untouched sibling',
);
const shiftedStrip = structuredClone(strip);
shiftedStrip.value.regions[0].geometry.coordinates[0].forEach((point) => {
  point[0] += 1;
});
const shiftedOutput = splitBoolean(shiftedStrip).value.regions.find(
  (item) => item.ref.operatorId === 'split-boolean',
);
assert.deepEqual(
  shiftedOutput.ref,
  separateOutput.ref,
  'disconnected boolean output identity survives upstream geometry edits',
);
assert(
  readGeometry(shiftedOutput.geometry)
    .symDifference(readGeometry(separateOutput.geometry))
    .getArea() > 0,
);
const emptyOperand = {
  ...operand,
  status: 'empty',
  value: { ...operand.value, regions: [] },
};
for (const operation of ['union', 'difference', 'intersection']) {
  const evaluated = invoke(
    booleanOperator,
    { id: 'empty-operand', params: { scope: selectedA, operation } },
    { input: [source], operand: [emptyOperand] },
  );
  assert.equal(evaluated.status, 'ready');
  assert.equal(
    evaluated.value.regions.length,
    operation === 'intersection' ? 1 : 2,
  );
}
const narrowNeck = {
  ...source,
  value: {
    ...source.value,
    regions: [
      region('neck', {
        type: 'Polygon',
        coordinates: [
          [
            [0, 0],
            [4, 0],
            [4, 1.75],
            [8, 1.75],
            [8, 0],
            [12, 0],
            [12, 4],
            [8, 4],
            [8, 2.25],
            [4, 2.25],
            [4, 4],
            [0, 4],
            [0, 0],
          ],
        ],
      }),
    ],
  },
};
const inset = (distanceMM) =>
  invoke(
    offsetOperator,
    { id: 'inset', params: { scope: { kind: 'all' }, distanceMM } },
    { input: [narrowNeck] },
  );
const connectedInset = inset(-0.1);
const disconnectedInset = inset(-0.4);
assert.equal(disconnectedInset.status, 'ready');
assert.equal(disconnectedInset.value.regions.length, 1);
assert.equal(disconnectedInset.value.regions[0].geometry.type, 'MultiPolygon');
assert.deepEqual(
  disconnectedInset.value.regions[0].ref,
  connectedInset.value.regions[0].ref,
);
assert.equal(legacyRecipeCapabilities.partition.status, 'supported');
console.log(
  'PASS: V4 region core preserves selected scope, references, explicit operations and migration capability limits.',
);
