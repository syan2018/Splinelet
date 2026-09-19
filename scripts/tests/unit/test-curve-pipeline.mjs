import assert from 'node:assert/strict';
import { emblemSplines } from '../../examples/draw-cup-emblem.mjs';
import { editSplines } from '../../../src/lib/source-editor/spline-edit.mjs';
import {
  sourceCurves,
  transformCurves,
  fillCurves,
  evaluateCurveProgram,
} from '../../../src/lib/curve-modifiers.mjs';
import { creationCommand } from '../../../src/lib/creation-commands.mjs';
import { moveCreationPaths } from '../../../src/lib/creation-path-transfer.mjs';
import { evaluateCreation } from '../../../src/lib/creation-engine.mjs';
import { readGeometry, describe } from '../../../src/lib/region-engine.mjs';
import { liveSurfaces, surfaceObject } from '../fixtures/live-surfaces.mjs';
let project = liveSurfaces();
project.creation.objects.push(surfaceObject('emblem', []));
project = editSplines(project, {
  objectId: 'emblem',
  units: 'model',
  splines: emblemSplines,
}).project;
const original = structuredClone(project.paths);
// The two shoulders are smooth; the decorative notches and petal tips
// deliberately remain corners. Equal opposing handles give C1 joins.
for (const node of [emblemSplines[0].nodes[1], emblemSplines[2].nodes[2]]) {
  for (const axis of ['x', 'y'])
    assert(
      Math.abs(
        node.handleLeft[axis] + node.handleRight[axis] - 2 * node.co[axis],
      ) < 1e-10,
    );
}
const source = sourceCurves(
  project,
  project.creation.objects.find((o) => o.id === 'emblem'),
);
assert.equal(source.length, 7);
assert.throws(() => fillCurves(source), /未闭合/);
const mirror = { type: 'curve_mirror', angleDeg: 90, centerMM: { x: 0, y: 0 } };
const array = {
  type: 'curve_array',
  count: 4,
  angleDeg: 90,
  centerMM: { x: 0, y: 0 },
};
const mirrored = transformCurves(source, mirror);
assert.throws(() => fillCurves(mirrored), /未闭合/); // A mirrored petal still needs its neighbours.
const repeated = transformCurves(mirrored, array);
// Each diagonal end joins the SAME boundary of another sector, never its own
// inner/outer counterpart. BOTH boundary joins must keep their acute corner.
for (const [index, curve] of repeated.entries()) {
  if (![1, 6].includes(index % source.length)) continue;
  const end = curve[3];
  const matches = repeated.flatMap((other, otherIndex) =>
    Math.hypot(other[3].x - end.x, other[3].y - end.y) < 1e-9
      ? [{ curve: other, index: otherIndex }]
      : [],
  );
  assert.equal(matches.length, 2);
  const neighbour = matches.find((m) => m.index !== index);
  assert.notEqual(
    Math.floor(neighbour.index / source.length),
    Math.floor(index / source.length),
  );
  assert.equal(neighbour.index % source.length, index % source.length);
  const a = { x: curve[2].x - end.x, y: curve[2].y - end.y };
  const b = {
    x: neighbour.curve[2].x - end.x,
    y: neighbour.curve[2].y - end.y,
  };
  const cosine =
    (a.x * b.x + a.y * b.y) / (Math.hypot(a.x, a.y) * Math.hypot(b.x, b.y));
  assert(
    cosine > 0 && cosine < 0.95,
    'sector joins must be acute corners, not smooth or cusped',
  );
}
const { geometry, loopCount, segmentCount } = fillCurves(repeated);
assert.equal(loopCount, 6); // Outer boundary, shared central opening and four diamonds.
assert.equal(segmentCount, 56);
const shape = describe(geometry).geometry;
assert.equal(shape.type, 'Polygon');
assert.equal(shape.coordinates.length, 6);
assert(!geometry.covers(readGeometry({ type: 'Point', coordinates: [0, 0] })));
const mapCoordinates = (coords, transform) =>
  typeof coords[0] === 'number'
    ? transform(coords)
    : coords.map((c) => mapCoordinates(c, transform));
for (const transform of [([x, y]) => [-x, y], ([x, y]) => [-y, x]]) {
  const other = readGeometry({
    ...shape,
    coordinates: mapCoordinates(shape.coordinates, transform),
  });
  const difference = geometry.symDifference(other).getArea();
  assert(difference < 1e-4, `symmetry area difference ${difference}`);
}
const command = (action, args) => {
  project = creationCommand(
    project,
    action,
    { objectId: 'emblem', ...args },
    evaluateCreation(project),
  );
};
for (const args of [mirror, array]) command('modifier_add', args);
let scene = evaluateCreation(project);
assert.equal(scene.cells.filter((c) => c.objectId === 'emblem').length, 0);
assert.deepEqual(
  scene.modifierStatus
    .filter((s) => s.objectId === 'emblem')
    .map((s) => s.outputCurveCount),
  [14, 56],
);
command('modifier_add', { type: 'fill', joinMM: 0.001 });
scene = evaluateCreation(project);
assert.deepEqual(scene.errors, []);
assert.equal(scene.modifierStatus.at(-1).closedLoops, 6);
assert.deepEqual(project.paths, original);
assert.equal(
  scene.pipelines.emblem.find((s) => s.name === '闭合构面').output,
  'surfaces',
);
const complete = structuredClone(project);
const previews = scene.curvePreviews.filter((s) => s.objectId === 'emblem');
assert.deepEqual(
  previews.map((s) => s.curves.length),
  [7, 14, 56, 56],
);
assert.equal(previews.at(-1).junctions.length, 0);
assert.deepEqual(
  evaluateCurveProgram(
    project,
    project.creation.objects.find((o) => o.id === 'emblem'),
  ).stages,
  previews,
);
// Breaking a source seam must retain current transformed cubics and identify
// the gap even though there is no surface. No successful geometry is cached.
const broken = structuredClone(project);
const mother = broken.paths.find((p) => p.id === original.at(-3).id);
mother.curves.at(-1)[3].x += 2;
const brokenScene = evaluateCreation(broken);
const brokenPreview = brokenScene.curvePreviews
  .filter((s) => s.objectId === 'emblem')
  .at(-1);
assert.equal(
  brokenScene.cells.filter((c) => c.objectId === 'emblem').length,
  0,
);
assert.equal(brokenPreview.curves.length, 56);
assert(brokenPreview.junctions.length > 0);
assert.notDeepEqual(brokenPreview.curves, previews.at(-1).curves);
assert.deepEqual(project.paths, original);
assert.throws(
  () =>
    moveCreationPaths(project, structuredClone(project.creation), {
      objectId: 'owner',
      pathIds: [original.at(-1).id],
    }),
  /参与.*修改器构造/,
);
const arrayId = project.creation.objects.find((o) => o.id === 'emblem')
  .modifiers[1].id;
command('modifier_update', { modifierId: arrayId, changes: { count: 3 } });
scene = evaluateCreation(project);
assert(
  scene.errors.some((e) => e.objectId === 'emblem' && /未闭合/.test(e.message)),
);
assert.equal(scene.cells.filter((c) => c.objectId === 'emblem').length, 0);
assert.equal(scene.curvePreviews.at(-1).curves.length, 42);
assert(scene.curvePreviews.at(-1).junctions.length > 0);
assert(scene.cells.some((c) => c.objectId === 'owner')); // Unrelated existing work survives.
command('modifier_update', { modifierId: arrayId, changes: { count: 4 } });
assert.deepEqual(evaluateCreation(project).errors, []);
project = complete;
command('modifier_move', { modifierId: arrayId, beforeId: null });
assert(evaluateCreation(project).errors.length > 0);
assert.deepEqual(project.paths, original);
console.log(
  'PASS: open eighth-sector -> mirror -> quarter-turns -> fill; D4 symmetry, connected outline, open centre, six loops, no prefill surfaces, typed ordering, failure isolation and recovery',
);
