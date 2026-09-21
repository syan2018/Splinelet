import assert from 'node:assert/strict';
import { partitionOperator } from '../../../src/lib/construction/operators/regions/index.mjs';
import { makeOutputRef } from '../../../src/lib/construction/provenance.mjs';
import { readGeometry } from '../../../src/lib/region-engine.mjs';

const region = (geometry) => ({
  ref: makeOutputRef('shape', 'base', 'regions', 'base', ['base']),
  geometry,
});
const square = (low, high) => ({
  type: 'Polygon',
  coordinates: [
    [
      [low, low],
      [high, low],
      [high, high],
      [low, high],
      [low, low],
    ],
  ],
});
const baseStage = (low = 0, high = 10) => ({
  domain: 'regions',
  status: 'ready',
  diagnostics: [],
  dependencies: ['base'],
  value: {
    frame: { kind: 'local', ownerNodeId: 'shape' },
    regions: [region(square(low, high))],
    provenance: [],
  },
});
const cutterStage = (y = 5, start = 0.2, end = 9.8, pathId = 'divider') => ({
  domain: 'curves',
  status: 'ready',
  diagnostics: [],
  dependencies: ['divider'],
  value: {
    frame: { kind: 'local', ownerNodeId: 'shape' },
    curves: [
      {
        key: pathId,
        pathRef: { kind: 'path', sketchId: 'sketch', id: pathId },
        edges: [
          {
            key: `${pathId}:edge`,
            cubic: [
              [start, y],
              [start, y],
              [end, y],
              [end, y],
            ],
            source: { kind: 'edge', sketchId: 'sketch', id: 'edge' },
            instances: [],
          },
        ],
      },
    ],
    junctions: [],
    provenance: [],
  },
});
const endpointJoin = {
  toleranceMM: 0.5,
  disabled: [],
  cohorts: [['divider']],
};
const evaluate = ({
  base = baseStage(),
  cutter = cutterStage(),
  join = endpointJoin,
  outputContract,
} = {}) =>
  partitionOperator.evaluate({
    document: { geometrySettings: { curveToleranceMM: 0.015 } },
    ownerNodeId: 'shape',
    operator: {
      id: 'partition',
      params: {
        scope: { kind: 'all' },
        ...(join ? { endpointJoin: join } : {}),
      },
      ...(outputContract ? { outputContract } : {}),
    },
    inputs: { input: [base], cutter: [cutter] },
  }).regions;
const proposal = (stage) =>
  stage.value.provenance.find(
    (item) => item.kind === 'output-contract-proposal',
  ).members;
const joins = (stage) =>
  stage.value.provenance.find((item) => item.kind === 'partition-endpoint-join')
    .connections;
const area = (stage) =>
  stage.value.regions.reduce(
    (sum, item) => sum + readGeometry(item.geometry).getArea(),
    0,
  );

const initial = evaluate();
assert.equal(initial.status, 'ready', JSON.stringify(initial.diagnostics));
assert.equal(initial.value.regions.length, 2);
assert.equal(joins(initial).length, 2);
assert.deepEqual(
  joins(initial).map((item) => item.pathId),
  ['divider', 'divider'],
);
assert.ok(joins(initial)[0].extended[0] < 0);
assert.ok(joins(initial)[1].extended[0] > 10);
assert.equal(area(initial), 100);

const outputContract = { version: 1, members: proposal(initial) };
const movedDivider = evaluate({
  cutter: cutterStage(6, 0.3, 9.7),
  outputContract,
});
assert.equal(
  movedDivider.status,
  'ready',
  JSON.stringify(movedDivider.diagnostics),
);
assert.deepEqual(proposal(movedDivider), outputContract.members);
assert.deepEqual(
  movedDivider.value.regions.map((item) => item.ref),
  initial.value.regions.map((item) => item.ref),
);
assert.notDeepEqual(
  movedDivider.value.regions.map((item) => item.geometry),
  initial.value.regions.map((item) => item.geometry),
);
assert.ok(
  joins(movedDivider).every((item) => item.from[1] === 6),
  'moving divider endpoints recomputes transient connections',
);

const movedBase = evaluate({
  base: baseStage(0.1, 9.9),
  cutter: cutterStage(5, 0.2, 9.8),
  outputContract,
});
assert.equal(movedBase.status, 'ready', JSON.stringify(movedBase.diagnostics));
assert.deepEqual(proposal(movedBase), outputContract.members);
assert.ok(
  joins(movedBase).some((item) => item.to[0] === 0.1),
  'moving the base boundary recomputes the nearest target',
);
assert.ok(Math.abs(area(movedBase) - 9.8 ** 2) < 1e-8);

const staticGap = evaluate({ join: null });
assert.equal(staticGap.status, 'ready');
assert.equal(staticGap.value.regions.length, 1);
assert.equal(
  staticGap.value.provenance.some(
    (item) => item.kind === 'partition-endpoint-join',
  ),
  false,
  'partition without endpointJoin keeps the prior behavior',
);
const disabled = evaluate({
  join: {
    ...endpointJoin,
    disabled: [{ pathId: 'divider', endpoint: 0 }],
  },
});
assert.equal(disabled.status, 'ready');
assert.equal(disabled.value.regions.length, 1);
assert.equal(joins(disabled).length, 1);

const missingIdentity = cutterStage();
delete missingIdentity.value.curves[0].pathRef;
assert.equal(evaluate({ cutter: missingIdentity }).status, 'blocked');
const duplicateIdentity = cutterStage();
duplicateIdentity.value.curves.push(
  structuredClone(duplicateIdentity.value.curves[0]),
);
assert.equal(evaluate({ cutter: duplicateIdentity }).status, 'blocked');
const emptyBase = baseStage();
emptyBase.status = 'empty';
emptyBase.value.regions = [];
const noBase = evaluate({ base: emptyBase });
assert.equal(noBase.status, 'empty');
assert.deepEqual(noBase.value.regions, []);
const emptySelection = partitionOperator.evaluate({
  document: { geometrySettings: { curveToleranceMM: 0.015 } },
  ownerNodeId: 'shape',
  operator: {
    id: 'partition',
    params: {
      scope: { kind: 'selected', refs: [] },
      endpointJoin,
    },
  },
  inputs: { input: [baseStage()], cutter: [cutterStage()] },
}).regions;
assert.equal(emptySelection.status, 'ready');
assert.deepEqual(emptySelection.value.regions, baseStage().value.regions);
const emptyCutter = cutterStage();
emptyCutter.status = 'empty';
emptyCutter.value.curves = [];
const noCutter = evaluate({
  cutter: emptyCutter,
  join: { ...endpointJoin, cohorts: [] },
});
assert.equal(noCutter.status, 'ready');
assert.equal(noCutter.value.regions.length, 1);
assert.equal(
  partitionOperator.validateParams({
    scope: { kind: 'all' },
    endpointJoin: { ...endpointJoin, cohorts: [['divider'], ['divider']] },
  }),
  'partition endpointJoin.cohorts 包含重复 Path ID',
);

console.log(
  'PASS partition endpointJoin stays dynamic for divider/base edits, preserves source identity contracts, and never requires materialized connector Paths',
);
