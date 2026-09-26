import assert from 'node:assert/strict';
import ArrayList from 'jsts/java/util/ArrayList.js';
import Coordinate from 'jsts/org/locationtech/jts/geom/Coordinate.js';
import PrecisionModel from 'jsts/org/locationtech/jts/geom/PrecisionModel.js';
import NodedSegmentString from 'jsts/org/locationtech/jts/noding/NodedSegmentString.js';
import NodingValidator from 'jsts/org/locationtech/jts/noding/NodingValidator.js';
import MCIndexSnapRounder from 'jsts/org/locationtech/jts/noding/snapround/MCIndexSnapRounder.js';

// Feasibility probe only: all input is generated, results go to stdout.
// These straight-line intersections lie exactly on the precision grid. This
// does not establish parameter recovery for general Beziers or snapped points.
const precision = new PrecisionModel(1e9);
const coordinate = ([x, y]) => new Coordinate(x, y);
const point = (value) => [value.x, value.y];

// `sourceParameter` describes the source-edge t at the two *directed* ends
// of this CurveUse. This is illustrative adapter metadata, not product schema.
const createTaggedUse = ({
  useId,
  coordinates,
  basisDirection,
  sourceParameter,
}) => {
  const metadata = {
    useId,
    basisDirection,
    sourceParameter,
    basis: { from: coordinates[0], to: coordinates.at(-1) },
  };
  return {
    metadata,
    segment: new NodedSegmentString(coordinates.map(coordinate), metadata),
  };
};
const node = (uses) => {
  const inputs = new ArrayList();
  uses.forEach((item) => inputs.add(item.segment));
  const noder = new MCIndexSnapRounder(precision);
  noder.computeNodes(inputs);
  const noded = noder.getNodedSubstrings();
  new NodingValidator(noded).checkValid();
  const out = [];
  for (const iterator = noded.iterator(); iterator.hasNext();)
    out.push(iterator.next());
  return out;
};
const sourceParameterAt = (metadata, [x, y]) => {
  const [fromX, fromY] = metadata.basis.from;
  const [toX, toY] = metadata.basis.to;
  const dx = toX - fromX;
  const dy = toY - fromY;
  const fraction = ((x - fromX) * dx + (y - fromY) * dy) / (dx * dx + dy * dy);
  return (
    metadata.sourceParameter[0] +
    fraction * (metadata.sourceParameter[1] - metadata.sourceParameter[0])
  );
};
const describe = (noded, inputs) =>
  noded.map((substring) => {
    const metadata = substring.getData();
    const coordinates = substring.getCoordinates().map(point);
    return {
      useId: metadata.useId,
      basisDirection: metadata.basisDirection,
      inputMetadataObjectRetained: inputs.some(
        (input) => input.metadata === metadata,
      ),
      coordinates,
      orientedSourceParameterInterval: [
        sourceParameterAt(metadata, coordinates[0]),
        sourceParameterAt(metadata, coordinates.at(-1)),
      ],
    };
  });
const byUse = (items, useId) => items.filter((item) => item.useId === useId);
const sameCoordinates = (left, right) =>
  JSON.stringify(left) === JSON.stringify(right);

const crossingInputs = [
  createTaggedUse({
    useId: 'horizontal:+',
    coordinates: [
      [0, 0],
      [10, 0],
    ],
    basisDirection: '+',
    sourceParameter: [0, 1],
  }),
  createTaggedUse({
    useId: 'vertical:+',
    coordinates: [
      [5, -5],
      [5, 5],
    ],
    basisDirection: '+',
    sourceParameter: [0, 1],
  }),
];
const crossing = describe(node(crossingInputs), crossingInputs);
assert.equal(byUse(crossing, 'horizontal:+').length, 2);
assert.equal(byUse(crossing, 'vertical:+').length, 2);
assert.ok(crossing.every((item) => item.inputMetadataObjectRetained));

const overlapInputs = [
  createTaggedUse({
    useId: 'long:+',
    coordinates: [
      [0, 0],
      [10, 0],
    ],
    basisDirection: '+',
    sourceParameter: [0, 1],
  }),
  createTaggedUse({
    useId: 'overlap:-',
    coordinates: [
      [7, 0],
      [3, 0],
    ],
    basisDirection: '-',
    sourceParameter: [1, 0],
  }),
];
const overlap = describe(node(overlapInputs), overlapInputs);
const longMiddle = byUse(overlap, 'long:+').find((item) =>
  sameCoordinates(item.coordinates, [
    [3, 0],
    [7, 0],
  ]),
);
const reverseMiddle = byUse(overlap, 'overlap:-').find((item) =>
  sameCoordinates(item.coordinates, [
    [7, 0],
    [3, 0],
  ]),
);
assert.ok(longMiddle, 'long source retains its noded overlap substring');
assert.ok(reverseMiddle, 'opposite directed source retains its own substring');
assert.equal(longMiddle.basisDirection, '+');
assert.equal(reverseMiddle.basisDirection, '-');
assert.deepEqual(reverseMiddle.orientedSourceParameterInterval, [1, 0]);

const reversedCrossingInputs = [
  createTaggedUse({
    useId: 'horizontal:-',
    coordinates: [
      [10, 2],
      [0, 2],
    ],
    basisDirection: '-',
    sourceParameter: [1, 0],
  }),
  createTaggedUse({
    useId: 'vertical-at-five:+',
    coordinates: [
      [5, 0],
      [5, 4],
    ],
    basisDirection: '+',
    sourceParameter: [0, 1],
  }),
];
const reversedCrossing = describe(
  node(reversedCrossingInputs),
  reversedCrossingInputs,
);
const reversedParts = byUse(reversedCrossing, 'horizontal:-');
assert.deepEqual(
  reversedParts.map((item) => item.orientedSourceParameterInterval),
  [
    [1, 0.5],
    [0.5, 0],
  ],
);

const report = {
  scope:
    'Direct JSTS MCIndexSnapRounder + NodedSegmentString(data) probe. Metadata is an adapter sketch only; no product operator or DCEL is changed.',
  precisionGridMM: 1e-9,
  crossing,
  collinearOverlap: overlap,
  reversedCrossing,
  conclusion: {
    crossingSubstringsRetainInputMetadata: crossing.every(
      (item) => item.inputMetadataObjectRetained,
    ),
    overlapKeepsBothOriginalUsesBeforeAnyDissolve: Boolean(
      longMiddle && reverseMiddle,
    ),
    reversedUseKeepsSignedDirectionAndOrientedParameterIntervals:
      reversedParts.every((item) => item.basisDirection === '-'),
    proves:
      'The JSTS snap-rounder can return noded substrings with caller-owned CurveUse metadata intact when called below GeometryNoder.',
    doesNotProve:
      'No general Bezier parameter recovery, off-grid snap displacement, half-edge/DCEL face walk, overlap ownership rule, hole handling, production RegionSet integration, or selector migration is implemented or validated.',
  },
};
console.log(JSON.stringify(report, null, 2));
