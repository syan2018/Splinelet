import assert from 'node:assert/strict';
import { fillCurves } from '../../../src/lib/construction/operators/regions/fill.mjs';
import { readGeometry } from '../../../src/lib/region-engine.mjs';

const ring = (id, points) => ({
  key: id,
  pathRef: { kind: 'path', sketchId: 'sketch', id },
  closed: true,
  edges: points.map((start, index) => {
    const end = points[(index + 1) % points.length];
    return {
      key: `${id}-edge-${index}`,
      cubic: [start, start, end, end].map((point) => point.slice()),
      startKey: `${id}-vertex-${index}`,
      endKey: `${id}-vertex-${(index + 1) % points.length}`,
      source: { kind: 'edge', sketchId: 'sketch', id: `${id}-source-${index}` },
      instances: [],
      transform: [1, 0, 0, 1, 0, 0],
    };
  }),
});
const set = (curves, junctions = []) => ({
  frame: { kind: 'local', ownerNodeId: 'shape' },
  curves,
  junctions,
  provenance: [],
});
const outer = ring('outer', [
  [0, 0],
  [10, 0],
  [10, 10],
  [0, 10],
]);
const inner = ring('inner', [
  [2, 2],
  [8, 2],
  [8, 8],
  [2, 8],
]);
const options = { operatorId: 'fill' };
const input = set([outer, inner]),
  before = structuredClone(input);
const hole = fillCurves(input, options);
assert.equal(hole.status, 'ready', JSON.stringify(hole.diagnostics));
assert.equal(readGeometry(hole.value.regions[0].geometry).getArea(), 64);
assert.equal(
  readGeometry(hole.value.regions[0].geometry).getNumInteriorRing(),
  1,
);
const filled = fillCurves(input, { ...options, rule: 'non-zero' });
assert.equal(readGeometry(filled.value.regions[0].geometry).getArea(), 100);
assert.deepEqual(input, before);
assert.equal(fillCurves(set([]), options).status, 'empty');
const open = structuredClone(outer);
open.edges.pop();
assert.equal(fillCurves(set([open]), options).status, 'blocked');
// Same numeric coordinates alone must never close a source topological gap.
const unwelded = structuredClone(outer);
unwelded.edges[3].endKey = 'different-vertex-at-origin';
assert.equal(fillCurves(set([unwelded]), options).status, 'blocked');
const joined = set(
  [unwelded],
  [
    {
      id: 'seam',
      endpoints: [
        { edgeKey: unwelded.edges[3].key, end: 'end' },
        { edgeKey: unwelded.edges[0].key, end: 'start' },
      ],
    },
  ],
);
assert.equal(fillCurves(joined, options).status, 'ready');
const gap = structuredClone(joined);
gap.curves[0].edges[3].cubic[3] = [0.1, 0];
assert.equal(fillCurves(gap, options).status, 'blocked');
const moved = structuredClone(input);
for (const curve of moved.curves)
  for (const edge of curve.edges)
    edge.cubic = edge.cubic.map(([x, y]) => [x + 34, y - 17]);
assert.deepEqual(
  fillCurves(moved, options).value.regions[0].ref,
  hole.value.regions[0].ref,
);
const bow = ring('bow', [
  [0, 0],
  [10, 10],
  [0, 10],
  [10, 0],
]);
const bowFilled = fillCurves(set([bow]), options);
assert.equal(bowFilled.status, 'ready');
assert.equal(
  bowFilled.value.regions.reduce(
    (sum, region) => sum + readGeometry(region.geometry).getArea(),
    0,
  ),
  50,
);
assert.equal(bowFilled.value.regions.length, 2);
console.log(
  'PASS: V4 Fill uses explicit topology, winding rules, holes, self-crossings and stable source identity',
);
