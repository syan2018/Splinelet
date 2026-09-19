import assert from 'node:assert/strict';
import {
  booleanOperator,
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
assert.equal(legacyRecipeCapabilities.partition.status, 'supported');
console.log(
  'PASS: V4 region core preserves selected scope, references, explicit operations and migration capability limits.',
);
