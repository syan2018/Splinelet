import assert from 'node:assert/strict';
import GeoJSONReader from 'jsts/org/locationtech/jts/io/GeoJSONReader.js';
import Polygonizer from 'jsts/org/locationtech/jts/operation/polygonize/Polygonizer.js';
import IsValidOp from 'jsts/org/locationtech/jts/operation/valid/IsValidOp.js';
import {
  buildTaggedArrangement,
  extractTaggedBoundary,
} from '../../../src/lib/geometry/tagged-arrangement.mjs';

const source = (useId) => ({ useId, kind: 'fixture-source' });
const segment = (useId, from, to, sourceParameter = [0, 1]) => ({
  coordinates: [from, to],
  source: source(useId),
  sourceParameter,
});
const edge = (arrangement, from, to) =>
  arrangement.atomicEdges.find(
    (item) =>
      JSON.stringify(item.coordinates) === JSON.stringify([from, to]) ||
      JSON.stringify(item.coordinates) === JSON.stringify([to, from]),
  );
const sourceIds = (item) =>
  item.sources
    .map((entry) => entry.source.useId)
    .sort((left, right) => left.localeCompare(right));
const reader = new GeoJSONReader();
const coverage = (arrangement) =>
  arrangement.faces.reduce(
    (area, face) => area + reader.read(face.geometry).getArea(),
    0,
  );
const polygonizerCoverage = (arrangement) => {
  const polygonizer = new Polygonizer();
  for (const item of arrangement.atomicEdges)
    polygonizer.add(
      reader.read({ type: 'LineString', coordinates: item.coordinates }),
    );
  let area = 0;
  for (
    const iterator = polygonizer.getPolygons().iterator();
    iterator.hasNext();
  )
    area += iterator.next().getArea();
  return area;
};
const assertPolygonizerAgreement = (arrangement) => {
  assert.ok(
    arrangement.faces.every((face) =>
      IsValidOp.isValid(reader.read(face.geometry)),
    ),
    'arrangement faces must be JSTS-valid',
  );
  assert.ok(
    Math.abs(coverage(arrangement) - polygonizerCoverage(arrangement)) < 1e-12,
    'arrangement coverage must agree with Polygonizer on the same noded edges',
  );
};

const crossing = buildTaggedArrangement({
  segments: [
    segment('horizontal', [0, 0], [10, 0]),
    segment('vertical', [5, -5], [5, 5]),
  ],
});
assert.equal(crossing.atomicEdges.length, 4);
assert.deepEqual(sourceIds(edge(crossing, [0, 0], [5, 0])), ['horizontal']);
assert.deepEqual(sourceIds(edge(crossing, [5, -5], [5, 0])), ['vertical']);
assert.deepEqual(
  edge(crossing, [0, 0], [5, 0]).sources[0].sourceParameter,
  [0, 0.5],
);
assert.equal(crossing.faces.length, 0);
assert.equal(crossing.dangles.length, 4);

const overlap = buildTaggedArrangement({
  segments: [
    segment('long:+', [0, 0], [10, 0]),
    segment('overlap:-', [7, 0], [3, 0], [1, 0]),
  ],
});
const middle = edge(overlap, [3, 0], [7, 0]);
assert.equal(overlap.atomicEdges.length, 3);
assert.deepEqual(sourceIds(middle), ['long:+', 'overlap:-']);
assert.deepEqual(middle.sources.map((item) => item.direction).sort(), [
  '+',
  '-',
]);
assert.deepEqual(
  middle.sources.find((item) => item.source.useId === 'overlap:-')
    .sourceParameter,
  [0, 1],
);

const square = buildTaggedArrangement({
  segments: [
    segment('bottom', [0, 0], [10, 0]),
    segment('right', [10, 0], [10, 10]),
    segment('top', [10, 10], [0, 10]),
    segment('left', [0, 10], [0, 0]),
  ],
});
assert.equal(square.faces.length, 1);
assert.equal(square.faces[0].boundary.outer.length, 4);
assert.deepEqual(
  square.faces[0].boundary.outer.flatMap((item) => sourceIds(item)).sort(),
  ['bottom', 'left', 'right', 'top'],
);
assert.equal(square.dangles.length, 0);
assertPolygonizerAgreement(square);

const tJunction = buildTaggedArrangement({
  segments: [
    segment('bottom', [0, 0], [10, 0]),
    segment('right', [10, 0], [10, 10]),
    segment('top', [10, 10], [0, 10]),
    segment('left', [0, 10], [0, 0]),
    segment('t-branch', [5, 0], [5, 5]),
  ],
});
assert.equal(tJunction.faces.length, 1);
assert.ok(
  tJunction.dangles.some((id) =>
    tJunction.atomicEdges
      .find((item) => item.id === id)
      .sources.some((item) => item.source.useId === 't-branch'),
  ),
);
const holes = buildTaggedArrangement({
  segments: [
    segment('outer-bottom', [0, 0], [10, 0]),
    segment('outer-right', [10, 0], [10, 10]),
    segment('outer-top', [10, 10], [0, 10]),
    segment('outer-left', [0, 10], [0, 0]),
    segment('inner-bottom', [3, 3], [7, 3]),
    segment('inner-right', [7, 3], [7, 7]),
    segment('inner-top', [7, 7], [3, 7]),
    segment('inner-left', [3, 7], [3, 3]),
  ],
});
assert.equal(holes.faces.length, 2);
const annulus = holes.faces.find((face) => face.boundary.holes.length === 1);
assert.ok(annulus);
assert.equal(annulus.geometry.coordinates.length, 2);
assert.deepEqual(
  annulus.boundary.holes[0]
    .flatMap((item) => sourceIds(item))
    .sort((left, right) => left.localeCompare(right)),
  ['inner-bottom', 'inner-left', 'inner-right', 'inner-top'],
);
const annulusBoundary = extractTaggedBoundary(holes, [annulus.id]);
assert.equal(annulusBoundary.exterior.length, 1);
assert.equal(annulusBoundary.holes.length, 1);
assert.deepEqual(
  annulusBoundary.holes[0].edges
    .flatMap((item) => sourceIds(item))
    .sort((left, right) => left.localeCompare(right)),
  ['inner-bottom', 'inner-left', 'inner-right', 'inner-top'],
);
assertPolygonizerAgreement(holes);

const divided = buildTaggedArrangement({
  segments: [
    segment('bottom', [0, 0], [20, 0]),
    segment('right', [20, 0], [20, 10]),
    segment('top', [20, 10], [0, 10]),
    segment('left', [0, 10], [0, 0]),
    segment('divider', [10, 0], [10, 10]),
  ],
});
assert.equal(divided.faces.length, 2);
const combinedBoundary = extractTaggedBoundary(
  divided,
  divided.faces.map((face) => face.id),
);
assert.equal(combinedBoundary.exterior.length, 1);
assert.equal(combinedBoundary.holes.length, 0);
assert.equal(combinedBoundary.exterior[0].edges.length, 6);
assert.ok(
  !combinedBoundary.exterior[0].edges
    .flatMap((item) => sourceIds(item))
    .includes('divider'),
  'shared selected face boundary is cancelled without a union',
);
assert.ok(
  combinedBoundary.exterior[0].edges.every((item) =>
    item.sources.every((entry) => ['+', '-'].includes(entry.direction)),
  ),
);

const selfCrossing = buildTaggedArrangement({
  segments: [
    segment('bow-a', [0, 0], [4, 4]),
    segment('bow-b', [4, 4], [0, 4]),
    segment('bow-c', [0, 4], [4, 0]),
    segment('bow-d', [4, 0], [0, 0]),
  ],
});
assert.equal(selfCrossing.faces.length, 2);
assert.ok(
  selfCrossing.faces.every((face) =>
    face.boundary.outer.every((item) => item.sources.length),
  ),
);
assertPolygonizerAgreement(selfCrossing);

const nested = buildTaggedArrangement({
  segments: [
    segment('outer-bottom', [0, 0], [30, 0]),
    segment('outer-right', [30, 0], [30, 30]),
    segment('outer-top', [30, 30], [0, 30]),
    segment('outer-left', [0, 30], [0, 0]),
    segment('middle-bottom', [5, 5], [25, 5]),
    segment('middle-right', [25, 5], [25, 25]),
    segment('middle-top', [25, 25], [5, 25]),
    segment('middle-left', [5, 25], [5, 5]),
    segment('inner-bottom', [10, 10], [20, 10]),
    segment('inner-right', [20, 10], [20, 20]),
    segment('inner-top', [20, 20], [10, 20]),
    segment('inner-left', [10, 20], [10, 10]),
  ],
});
assert.equal(nested.faces.length, 3);
assert.deepEqual(
  nested.faces
    .map((face) => face.boundary.holes.length)
    .sort((left, right) => left - right),
  [0, 1, 1],
);
assertPolygonizerAgreement(nested);

const sharedVertex = buildTaggedArrangement({
  segments: [
    segment('a-bottom', [0, 0], [2, 0]),
    segment('a-right', [2, 0], [2, 2]),
    segment('a-top', [2, 2], [0, 2]),
    segment('a-left', [0, 2], [0, 0]),
    segment('b-bottom', [2, 2], [4, 2]),
    segment('b-right', [4, 2], [4, 4]),
    segment('b-top', [4, 4], [2, 4]),
    segment('b-left', [2, 4], [2, 2]),
  ],
});
assert.equal(sharedVertex.faces.length, 2);
assertPolygonizerAgreement(sharedVertex);

const bridge = buildTaggedArrangement({
  segments: [
    segment('outer-bottom', [0, 0], [20, 0]),
    segment('outer-right', [20, 0], [20, 20]),
    segment('outer-top', [20, 20], [0, 20]),
    segment('outer-left', [0, 20], [0, 0]),
    segment('inner-bottom', [5, 5], [15, 5]),
    segment('inner-right', [15, 5], [15, 15]),
    segment('inner-top', [15, 15], [5, 15]),
    segment('inner-left', [5, 15], [5, 5]),
    segment('bridge', [0, 10], [5, 10]),
  ],
});
assert.equal(bridge.faces.length, 2);
assert.ok(
  bridge.dangles.some((id) =>
    bridge.atomicEdges
      .find((item) => item.id === id)
      .sources.some((item) => item.source.useId === 'bridge'),
  ),
  'a bridge between two degree-2 rings is pruned as a cut edge',
);
assert.ok(bridge.diagnostics.some((item) => item.code === 'cut-edge-pruned'));
assertPolygonizerAgreement(bridge);

const tangentNested = buildTaggedArrangement({
  segments: [
    segment('outer-bottom', [0, 0], [10, 0]),
    segment('outer-right', [10, 0], [10, 10]),
    segment('outer-top', [10, 10], [0, 10]),
    segment('outer-left', [0, 10], [0, 0]),
    segment('touch-a', [0, 5], [3, 3]),
    segment('touch-b', [3, 3], [5, 5]),
    segment('touch-c', [5, 5], [3, 7]),
    segment('touch-d', [3, 7], [0, 5]),
  ],
});
assert.equal(tangentNested.faces.length, 2);
assert.deepEqual(
  tangentNested.faces
    .map((face) => reader.read(face.geometry).getArea())
    .sort(),
  [10, 90],
);
assertPolygonizerAgreement(tangentNested);
for (const face of tangentNested.faces)
  for (const edge of [...face.boundary.outer, ...face.boundary.holes.flat()])
    assert.equal(
      tangentNested.halfEdges.find(
        (halfEdge) => halfEdge.id === edge.halfEdgeId,
      ).faceId,
      face.id,
      'every bounded half-edge retains its left face after cycle splitting',
    );
const tangentOuter = tangentNested.faces.find(
  (face) => reader.read(face.geometry).getArea() === 90,
);
const tangentOuterBoundary = extractTaggedBoundary(tangentNested, [
  tangentOuter.id,
]);
assert.equal(tangentOuterBoundary.exterior.length, 1);
assert.equal(tangentOuterBoundary.holes.length, 1);
const tangentOuterGeometry = reader.read({
  type: 'Polygon',
  coordinates: [
    tangentOuterBoundary.exterior[0].coordinates,
    tangentOuterBoundary.holes[0].coordinates,
  ],
});
assert.ok(IsValidOp.isValid(tangentOuterGeometry));
assert.equal(tangentOuterGeometry.getArea(), 90);
const tangentUnionBoundary = extractTaggedBoundary(
  tangentNested,
  tangentNested.faces.map((face) => face.id),
);
assert.equal(tangentUnionBoundary.exterior.length, 1);
assert.equal(tangentUnionBoundary.holes.length, 0);
assert.equal(
  reader
    .read({
      type: 'Polygon',
      coordinates: [tangentUnionBoundary.exterior[0].coordinates],
    })
    .getArea(),
  coverage(tangentNested),
  'union boundary covers exactly the selected face area',
);

const narrowGap = buildTaggedArrangement({
  segments: [
    segment('outer-bottom', [0, 0], [1, 0]),
    segment('outer-right', [1, 0], [1, 1]),
    segment('outer-top', [1, 1], [0, 1]),
    segment('outer-left', [0, 1], [0, 0]),
    segment('inner-bottom', [1e-9, 1e-9], [1 - 1e-9, 1e-9]),
    segment('inner-right', [1 - 1e-9, 1e-9], [1 - 1e-9, 1 - 1e-9]),
    segment('inner-top', [1 - 1e-9, 1 - 1e-9], [1e-9, 1 - 1e-9]),
    segment('inner-left', [1e-9, 1 - 1e-9], [1e-9, 1e-9]),
  ],
});
assert.equal(narrowGap.faces.length, 2);
assert.ok(coverage(narrowGap) > 0.999999999);
assertPolygonizerAgreement(narrowGap);

const collapsed = buildTaggedArrangement({
  segments: [
    segment('zero', [1, 1], [1, 1]),
    segment('snap-zero', [1e-10, 0], [2e-10, 0]),
    segment('survivor', [0, 0], [1, 0]),
  ],
});
assert.equal(collapsed.atomicEdges.length, 1);
assert.deepEqual(
  collapsed.diagnostics
    .map((item) => item.code)
    .sort((left, right) => left.localeCompare(right)),
  ['snap-collapsed-segment', 'zero-length-segment'],
);

console.log('tagged arrangement tests passed');
