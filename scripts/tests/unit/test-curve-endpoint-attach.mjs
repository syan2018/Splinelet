import assert from 'node:assert/strict';
import { curveEndpointAttachOperator } from '../../../src/lib/construction/operators/curves/endpoint-attach.mjs';

const edge = {
  key: 'edge',
  startKey: 'start',
  endKey: 'end',
  cubic: [
    [1, 5],
    [1, 5],
    [9, 5],
    [9, 5],
  ],
  logicalSource: { sketchId: 's', pathId: 'p' },
  basisSpan: [0, 1],
  transform: [1, 0, 0, 1, 0, 0],
  instances: [],
};
const input = {
  domain: 'curves',
  status: 'ready',
  dependencies: ['sketch:s'],
  value: {
    frame: { kind: 'local', ownerNodeId: 'shape' },
    curves: [{ key: 'curve', pathRef: { id: 'p' }, edges: [edge] }],
    junctions: [],
    provenance: [],
  },
};
const boundary = {
  domain: 'regions',
  status: 'ready',
  dependencies: ['base'],
  value: {
    regions: [
      {
        geometry: {
          type: 'Polygon',
          coordinates: [
            [
              [0, 0],
              [10, 0],
              [10, 10],
              [0, 10],
              [0, 0],
            ],
          ],
        },
      },
    ],
  },
};
const args = {
  document: { geometrySettings: { curveToleranceMM: 0.1 } },
  operator: {
    id: 'attach',
    params: { endpointJoin: { toleranceMM: 2, cohorts: [['p']] } },
    inputs: {},
  },
  inputs: { input: [input], boundary: [boundary] },
};
const result = curveEndpointAttachOperator.evaluate(args).curves;
assert.equal(result.status, 'ready');
assert.equal(result.value.curves[0].edges.length, 3);
assert.deepEqual(
  input.value.curves[0].edges,
  [edge],
  'input DTO stays unchanged',
);
for (const generated of [
  result.value.curves[0].edges[0],
  result.value.curves[0].edges.at(-1),
]) {
  assert.equal(generated.generatedAttachment.operatorId, 'attach');
  assert.ok(generated.key.includes('endpoint-attach'));
  assert.ok(Math.abs(generated.basisSpan[1] - generated.basisSpan[0]) === 1);
}
const disabled = curveEndpointAttachOperator.evaluate({
  ...args,
  operator: {
    ...args.operator,
    params: {
      endpointJoin: {
        toleranceMM: 2,
        cohorts: [['p']],
        disabled: [
          { pathId: 'p', endpoint: 0 },
          { pathId: 'p', endpoint: 1 },
        ],
      },
    },
  },
}).curves;
assert.equal(disabled.value.curves[0].edges.length, 1);
assert.ok(
  disabled.diagnostics.some(
    (item) => item.code === 'partition-endpoint-disabled',
  ),
);
const empty = curveEndpointAttachOperator.evaluate({
  ...args,
  inputs: {
    ...args.inputs,
    input: [
      { ...input, status: 'empty', value: { ...input.value, curves: [] } },
    ],
  },
}).curves;
assert.equal(empty.status, 'empty');
const noBoundary = curveEndpointAttachOperator.evaluate({
  ...args,
  inputs: {
    ...args.inputs,
    boundary: [{ ...boundary, status: 'empty', value: { regions: [] } }],
  },
}).curves;
assert.equal(noBoundary.status, 'blocked', 'empty boundary blocks');
console.log(
  'PASS: endpoint attach is explicit, transient, and preserves source DTOs.',
);
