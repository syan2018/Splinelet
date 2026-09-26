import assert from 'node:assert/strict';
import { polygonParts, readGeometry } from '../../src/lib/region-engine.mjs';

const EPSILON = 1e-9;
const SAMPLE_COUNT = 48;
const point = (x, y) => [x, y];
const clone = (value) => structuredClone(value);
const equalPoint = (a, b, epsilon = EPSILON) =>
  Math.hypot(a[0] - b[0], a[1] - b[1]) <= epsilon;
const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
const nearlyEqual = (a, b, epsilon = EPSILON) => Math.abs(a - b) <= epsilon;

// This isolated model owns directed boundary curves and author regions. Every
// curve endpoint references a shared junction ID. Internal spline anchors only
// belong to segments inside their one curve; they are not graph connections.
const junctionPoint = (document, junctionId) =>
  document.junctions[junctionId].position;
const cubicForSegment = (document, curve, index) => {
  const segment = curve.segments[index];
  const start = junctionPoint(document, curve.junctionIds[index]);
  const end = junctionPoint(document, curve.junctionIds[index + 1]);
  return [start, segment.out || start, segment.in || end, end];
};
const cubicPoint = ([a, b, c, d], t) => {
  const s = 1 - t;
  return [
    s ** 3 * a[0] +
      3 * s ** 2 * t * b[0] +
      3 * s * t ** 2 * c[0] +
      t ** 3 * d[0],
    s ** 3 * a[1] +
      3 * s ** 2 * t * b[1] +
      3 * s * t ** 2 * c[1] +
      t ** 3 * d[1],
  ];
};
const sampleSegment = (cubic, count) =>
  Array.from({ length: count + 1 }, (_, index) =>
    cubicPoint(cubic, index / count),
  );
const sampleUse = (document, use) => {
  const curve = document.curves[use.curveId];
  const points = curve.segments.flatMap((segment, index) => {
    const sample = sampleSegment(
      cubicForSegment(document, curve, index),
      segment.sampleCount,
    );
    return index ? sample.slice(1) : sample;
  });
  return use.forward ? points : points.reverse();
};
const ringForLoop = (document, loop) => {
  const ring = [];
  for (const use of loop) {
    const sample = sampleUse(document, use);
    if (ring.length)
      assert.ok(
        equalPoint(ring.at(-1), sample[0]),
        `author loop disconnects at ${use.curveId}`,
      );
    ring.push(...(ring.length ? sample.slice(1) : sample));
  }
  assert.ok(equalPoint(ring[0], ring.at(-1)), 'author loop must close itself');
  return ring;
};

// Evaluation accepts only current author data. This bounded prototype supports
// one simple, closed loop per region; it does not implement general nonzero
// filling of self-intersections or holes. It never receives an earlier face.
const evaluateAuthorRegions = (document) =>
  Object.fromEntries(
    document.regions.map((region) => {
      assert.equal(
        region.loops.length,
        1,
        'prototype supports one simple loop',
      );
      assert.equal(
        region.fillRule,
        'nonzero',
        'fill rule is authored authority',
      );
      const geometry = {
        type: 'MultiPolygon',
        coordinates: region.loops.map((loop) => [ringForLoop(document, loop)]),
      };
      const evaluated = readGeometry(geometry);
      assert.ok(
        evaluated.isValid(),
        'prototype rejects non-simple fill inputs',
      );
      return [
        region.id,
        {
          geometry,
          areaMM2: evaluated.getArea(),
          components: polygonParts(evaluated).length,
        },
      ];
    }),
  );
const pureEvaluate = (document) => {
  const before = clone(document);
  const result = evaluateAuthorRegions(document);
  assert.deepEqual(
    document,
    before,
    'pure evaluation must not write author data',
  );
  return result;
};

const boundaryUses = (document) =>
  document.regions.flatMap((region) =>
    region.loops.flatMap((loop) =>
      loop.map((use) => ({ regionId: region.id, ...use })),
    ),
  );
const sharedEdges = (document) =>
  Object.entries(
    boundaryUses(document).reduce((byCurve, use) => {
      (byCurve[use.curveId] ||= new Set()).add(use.regionId);
      return byCurve;
    }, {}),
  )
    .filter(([, regionIds]) => regionIds.size > 1)
    .map(([curveId, regionIds]) => ({
      curveId,
      regions: [...regionIds].sort((a, b) => a.localeCompare(b)),
    }))
    .sort((a, b) => a.curveId.localeCompare(b.curveId));
const replaceUses = (document, curveId, replacement) => {
  for (const region of document.regions)
    region.loops = region.loops.map((loop) =>
      loop.flatMap((use) =>
        use.curveId === curveId ? replacement(use) : [use],
      ),
    );
};
const splitCubic = (cubic, t) => {
  const [a, b, c, d] = cubic;
  const ab = lerp(a, b, t);
  const bc = lerp(b, c, t);
  const cd = lerp(c, d, t);
  const abc = lerp(ab, bc, t);
  const bcd = lerp(bc, cd, t);
  return [
    [a, ab, abc, lerp(abc, bcd, t)],
    [lerp(abc, bcd, t), bcd, cd, d],
  ];
};

// An exact segment split changes the curve's internal anchor sequence only.
// Region loops retain the same shared curve ID and directed use.
const splitBezierSegment = (document, curveId, segmentIndex, t) => {
  assert.ok(t > 0 && t < 1, 'split parameter must be inside the segment');
  const curve = document.curves[curveId];
  assert.ok(curve, `unknown curve ${curveId}`);
  const original = cubicForSegment(document, curve, segmentIndex);
  const [left, right] = splitCubic(original, t);
  const knotId = `${curveId}:split-${segmentIndex}`;
  assert.ok(!document.junctions[knotId], `duplicate split knot ${knotId}`);
  document.junctions[knotId] = { position: clone(left[3]) };
  const sourceCount = curve.segments[segmentIndex].sampleCount;
  const leftCount = Math.round(sourceCount * t);
  curve.junctionIds.splice(segmentIndex + 1, 0, knotId);
  curve.segments.splice(
    segmentIndex,
    1,
    { out: clone(left[1]), in: clone(left[2]), sampleCount: leftCount },
    {
      out: clone(right[1]),
      in: clone(right[2]),
      sampleCount: sourceCount - leftCount,
    },
  );
  return { original, knotId, segmentIndex, t };
};

// This is an actual internal spline-anchor deletion. It rebuilds the two
// adjacent segments into one cubic using their surviving endpoint tangents;
// no region boundary reference is changed, because the whole curve remains.
const deleteInternalSplineAnchor = (document, curveId, junctionId) => {
  const curve = document.curves[curveId];
  const index = curve?.junctionIds.indexOf(junctionId) ?? -1;
  assert.ok(
    index > 0 && index < curve.junctionIds.length - 1,
    'delete requires an internal spline anchor',
  );
  const externalUses = Object.values(document.curves).flatMap((candidate) =>
    candidate.junctionIds.filter((id) => id === junctionId),
  );
  assert.equal(
    externalUses.length,
    1,
    'an internal spline anchor cannot silently delete a shared graph junction',
  );
  const left = curve.segments[index - 1];
  const right = curve.segments[index];
  curve.junctionIds.splice(index, 1);
  curve.segments.splice(index - 1, 2, {
    out: clone(left.out),
    in: clone(right.in),
    sampleCount: left.sampleCount + right.sampleCount,
  });
  delete document.junctions[junctionId];
};

// Representation reversal preserves directed geometry by reversing segment
// order and each cubic's handles, then toggling the direction of every use.
const reverseCurveRepresentation = (document, curveId) => {
  const curve = document.curves[curveId];
  assert.ok(curve, `unknown curve ${curveId}`);
  curve.junctionIds.reverse();
  curve.segments = curve.segments.reverse().map((segment) => ({
    out: clone(segment.in),
    in: clone(segment.out),
    sampleCount: segment.sampleCount,
  }));
  replaceUses(document, curveId, (use) => [{ curveId, forward: !use.forward }]);
};

// Region merge is a distinct, explicit author command. It must have a policy
// for conflicting attributes; this prototype refuses rather than guessing.
const mergeRegions = (document, firstId, secondId) => {
  const first = document.regions.find((region) => region.id === firstId);
  const second = document.regions.find((region) => region.id === secondId);
  assert.ok(first && second, 'explicit merge requires existing regions');
  assert.deepEqual(
    first.appearance,
    second.appearance,
    'explicit region merge requires an attribute-resolution policy',
  );
  throw Error('prototype intentionally has no same-style region merge');
};

const authored = () => ({
  junctions: {
    'red-left-bottom': { position: point(0, 0) },
    'bottom-mid': { position: point(5, 0) },
    'blue-right-bottom': { position: point(10, 0) },
    'red-left-top': { position: point(0, 10) },
    'shared-anchor': { position: point(5, 5) },
    'top-mid': { position: point(5, 10) },
    'blue-right-top': { position: point(10, 10) },
  },
  curves: {
    'red-bottom': {
      id: 'red-bottom',
      junctionIds: ['red-left-bottom', 'bottom-mid'],
      segments: [{ out: null, in: null, sampleCount: SAMPLE_COUNT }],
    },
    shared: {
      id: 'shared',
      junctionIds: ['bottom-mid', 'shared-anchor', 'top-mid'],
      segments: [
        { out: point(7, 1), in: point(7, 3.5), sampleCount: SAMPLE_COUNT / 2 },
        { out: point(3, 6.5), in: point(3, 9), sampleCount: SAMPLE_COUNT / 2 },
      ],
    },
    'red-top': {
      id: 'red-top',
      junctionIds: ['red-left-top', 'top-mid'],
      segments: [{ out: null, in: null, sampleCount: SAMPLE_COUNT }],
    },
    'red-left': {
      id: 'red-left',
      junctionIds: ['red-left-bottom', 'red-left-top'],
      segments: [{ out: null, in: null, sampleCount: SAMPLE_COUNT }],
    },
    'blue-bottom': {
      id: 'blue-bottom',
      junctionIds: ['bottom-mid', 'blue-right-bottom'],
      segments: [{ out: null, in: null, sampleCount: SAMPLE_COUNT }],
    },
    'blue-right': {
      id: 'blue-right',
      junctionIds: ['blue-right-bottom', 'blue-right-top'],
      segments: [{ out: null, in: null, sampleCount: SAMPLE_COUNT }],
    },
    'blue-top': {
      id: 'blue-top',
      junctionIds: ['top-mid', 'blue-right-top'],
      segments: [{ out: null, in: null, sampleCount: SAMPLE_COUNT }],
    },
  },
  regions: [
    {
      id: 'red',
      fillRule: 'nonzero',
      appearance: { color: '#d12b2b', thicknessMM: 1.2 },
      loops: [
        [
          { curveId: 'red-bottom', forward: true },
          { curveId: 'shared', forward: true },
          { curveId: 'red-top', forward: false },
          { curveId: 'red-left', forward: false },
        ],
      ],
    },
    {
      id: 'blue',
      fillRule: 'nonzero',
      appearance: { color: '#2457d6', thicknessMM: 2.8 },
      loops: [
        [
          { curveId: 'blue-bottom', forward: true },
          { curveId: 'blue-right', forward: true },
          { curveId: 'blue-top', forward: false },
          { curveId: 'shared', forward: false },
        ],
      ],
    },
  ],
});

const document = authored();
const styles = Object.fromEntries(
  document.regions.map((region) => [region.id, clone(region.appearance)]),
);
const report = [];
const verifyPhysicalPartition = (evaluated) => {
  const red = readGeometry(evaluated.red.geometry);
  const blue = readGeometry(evaluated.blue.geometry);
  const leftPoint = readGeometry({ type: 'Point', coordinates: [1, 5] });
  const rightPoint = readGeometry({ type: 'Point', coordinates: [9, 5] });
  assert.ok(red.covers(leftPoint) && !blue.covers(leftPoint));
  assert.ok(blue.covers(rightPoint) && !red.covers(rightPoint));
  assert.ok(nearlyEqual(red.intersection(blue).getArea(), 0));
  assert.ok(nearlyEqual(red.union(blue).getArea(), 100));
};
const observe = (name) => {
  const evaluated = pureEvaluate(document);
  verifyPhysicalPartition(evaluated);
  for (const region of document.regions)
    assert.deepEqual(
      region.appearance,
      styles[region.id],
      `${region.id} author style survives ${name}`,
    );
  report.push({
    name,
    authorRegions: document.regions.length,
    geometry: Object.fromEntries(
      Object.entries(evaluated).map(([id, value]) => [
        id,
        {
          areaMM2: Number(value.areaMM2.toFixed(6)),
          components: value.components,
          type: value.geometry.type,
        },
      ]),
    ),
    sharedEdges: sharedEdges(document),
  });
  return evaluated;
};

// Endpoint positions are authoritative junction records, not copied coordinate
// pairs. Moving one junction changes every incident edge and preserves joins.
assert.equal(document.curves.shared.junctionIds[0], 'bottom-mid');
assert.equal(document.curves['red-bottom'].junctionIds.at(-1), 'bottom-mid');
assert.equal(document.curves['blue-bottom'].junctionIds[0], 'bottom-mid');
document.junctions['bottom-mid'].position = point(5.25, 0);
for (const curveId of ['shared', 'red-bottom', 'blue-bottom'])
  assert.ok(
    equalPoint(
      curveId === 'shared'
        ? junctionPoint(document, document.curves[curveId].junctionIds[0])
        : curveId === 'red-bottom'
          ? junctionPoint(document, document.curves[curveId].junctionIds.at(-1))
          : junctionPoint(document, document.curves[curveId].junctionIds[0]),
      point(5.25, 0),
    ),
    'moving a junction preserves every incident curve endpoint',
  );
verifyPhysicalPartition(pureEvaluate(document));
document.junctions['bottom-mid'].position = point(5, 0);

const initial = observe('initial');
assert.deepEqual(sharedEdges(document), [
  { curveId: 'shared', regions: ['blue', 'red'] },
]);
assert.equal(initial.red.geometry.type, 'MultiPolygon');
assert.equal(initial.blue.geometry.type, 'MultiPolygon');
assert.equal(initial.red.components, 1);
assert.equal(initial.blue.components, 1);
assert.ok(initial.red.areaMM2 > 0 && initial.blue.areaMM2 > 0);

// A geometric crossing is observable but cannot create an author connection.
document.junctions['crossing-left'] = { position: point(2, 5) };
document.junctions['crossing-right'] = { position: point(8, 5) };
document.curves.crossing = {
  id: 'crossing',
  junctionIds: ['crossing-left', 'crossing-right'],
  segments: [{ out: null, in: null, sampleCount: SAMPLE_COUNT }],
};
assert.ok(
  sampleUse(document, { curveId: 'shared', forward: true }).some(
    (sample) => nearlyEqual(sample[1], 5) && sample[0] > 2 && sample[0] < 8,
  ),
  'the unattached curve crosses the shared curve geometrically',
);
assert.ok(
  !boundaryUses(document).some((use) => use.curveId === 'crossing'),
  'a crossing does not create an author boundary use',
);
const mergeConflictBefore = clone(document);
assert.throws(
  () => mergeRegions(document, 'red', 'blue'),
  /attribute-resolution policy/,
  'true region merge rejects conflicting red/blue author attributes',
);
assert.deepEqual(
  document,
  mergeConflictBefore,
  'a rejected explicit merge leaves author data untouched',
);

// Moving an internal Bezier control changes both current fills, but both
// regions retain their own author attributes and their one shared boundary.
document.curves.shared.segments[0].out = point(8, 1.2);
const moved = observe('moved shared internal control');
assert.ok(!nearlyEqual(initial.red.areaMM2, moved.red.areaMM2));
assert.ok(!nearlyEqual(initial.blue.areaMM2, moved.blue.areaMM2));
assert.deepEqual(sharedEdges(document), [
  { curveId: 'shared', regions: ['blue', 'red'] },
]);

const split = splitBezierSegment(document, 'shared', 0, 0.5);
for (const parameter of [0, 0.25, 0.75, 1]) {
  assert.ok(
    equalPoint(
      cubicPoint(split.original, split.t * parameter),
      cubicPoint(
        cubicForSegment(document, document.curves.shared, 0),
        parameter,
      ),
    ),
    'left split segment is an exact reparameterization',
  );
  assert.ok(
    equalPoint(
      cubicPoint(split.original, split.t + (1 - split.t) * parameter),
      cubicPoint(
        cubicForSegment(document, document.curves.shared, 1),
        parameter,
      ),
    ),
    'right split segment is an exact reparameterization',
  );
}
const splitEvaluated = observe('exact split inside shared curve');
for (const id of ['red', 'blue'])
  assert.ok(
    nearlyEqual(moved[id].areaMM2, splitEvaluated[id].areaMM2),
    `exact split preserves sampled ${id} fill geometry`,
  );
assert.deepEqual(sharedEdges(document), [
  { curveId: 'shared', regions: ['blue', 'red'] },
]);

// Delete the original internal spline anchor. This explicitly rebuilds the
// adjacent curve span while both author regions keep their `shared` use.
deleteInternalSplineAnchor(document, 'shared', 'shared-anchor');
const deleted = observe('deleted internal spline anchor and rebuilt curve');
assert.ok(!nearlyEqual(splitEvaluated.red.areaMM2, deleted.red.areaMM2));
assert.ok(!nearlyEqual(splitEvaluated.blue.areaMM2, deleted.blue.areaMM2));
assert.ok(!document.junctions['shared-anchor']);
assert.deepEqual(sharedEdges(document), [
  { curveId: 'shared', regions: ['blue', 'red'] },
]);

const beforeReverse = pureEvaluate(document);
reverseCurveRepresentation(document, 'shared');
const afterReverse = observe('reversed curve representation');
for (const id of ['red', 'blue'])
  assert.ok(
    nearlyEqual(beforeReverse[id].areaMM2, afterReverse[id].areaMM2),
    `representation reversal preserves ${id} geometry`,
  );

console.log(
  JSON.stringify(
    {
      prototype: 'author regions with directed shared curve loops',
      report,
      assertions: {
        noHistoricalFaceMatching: true,
        pureEvaluationDoesNotWriteAuthorData: true,
        sharedJunctionsKeepIncidentCurvesJoined: true,
        crossingDoesNotConnectAuthorTopology: true,
        conflictingRegionMergeRejectedWithoutMutation: true,
      },
      limits: [
        'This validates the author-data model only; it is not wired to the current UI, codec, migration, or export pipeline.',
        'The prototype samples cubic loops and reports JSTS area/components; production still needs robust fill, holes, intersection policy, and command UX.',
        'It does not claim to repair the Sandrone example or replace existing region evaluation.',
      ],
    },
    null,
    2,
  ),
);
console.log(
  'PASS: author regions retain directed shared boundaries without historical face matching.',
);
