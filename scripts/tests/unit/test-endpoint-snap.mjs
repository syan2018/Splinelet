import assert from 'node:assert/strict';
import {
  endpointSnapContext,
  snapEndpoint,
} from '../../../src/lib/source-editor/endpoint-snap.mjs';
import {
  modifierTransforms,
  composeTransforms,
  transformPoint,
  fixedSet,
} from '../../../src/lib/curve-transforms.mjs';
import { translateNodes } from '../../../src/lib/source-editor/selection.mjs';
import { editSplines } from '../../../src/lib/source-editor/spline-edit.mjs';
import { creationCommand } from '../legacy/creation-commands.mjs';
import { evaluateCreation } from '../../../src/lib/creation-engine.mjs';
import { liveSurfaces, surfaceObject } from '../fixtures/live-surfaces.mjs';
import { emblemSplines } from '../../examples/draw-cup-emblem.mjs';

let p = liveSurfaces();
p.creation.objects.push(surfaceObject('emblem', []));
p = editSplines(p, {
  objectId: 'emblem',
  units: 'model',
  splines: emblemSplines,
}).project;
for (const args of [
  { type: 'curve_mirror', angleDeg: 90, centerMM: { x: 0, y: 0 } },
  { type: 'curve_array', count: 4, angleDeg: 90, centerMM: { x: 0, y: 0 } },
  { type: 'fill', joinMM: 0.001 },
])
  p = creationCommand(
    p,
    'modifier_add',
    { objectId: 'emblem', ...args },
    evaluateCreation(p),
  );
const original = structuredClone(p);
const mother = p.paths.at(-3);
const ctx = endpointSnapContext(p, mother.id, 2);
assert(ctx.lockedId, 'the source end belongs to a composed mirror/array seam');
const locked = snapEndpoint(
  ctx,
  { x: ctx.origin.x + 18, y: ctx.origin.y + 16 },
  { scale: 4 },
);
assert(locked.locked, 'existing seam stays constrained beyond magnetic radius');
translateNodes(
  mother,
  [2],
  locked.position.x - ctx.origin.x,
  locked.position.y - ctx.origin.y,
);
assert.deepEqual(
  evaluateCreation(p).errors,
  [],
  'sliding along the seam keeps the full outline closed',
);
assert.equal(
  mother.curves[1][2].x - original.paths.at(-3).curves[1][2].x,
  mother.curves[1][3].x - original.paths.at(-3).curves[1][3].x,
);
assert.deepEqual(p.paths.slice(0, -3), original.paths.slice(0, -3));

// Break the seam, then repair by moving NEAR it, not onto exact coordinates.
p = structuredClone(original);
translateNodes(p.paths.at(-3), [2], 0.3, 0);
assert(evaluateCreation(p).errors.some((e) => e.objectId === 'emblem'));
const repairCtx = endpointSnapContext(p, mother.id, 2);
assert(!repairCtx.lockedId);
const repair = snapEndpoint(repairCtx, repairCtx.origin, { scale: 2 });
assert(repair && !repair.locked);
translateNodes(
  p.paths.at(-3),
  [2],
  repair.position.x - repairCtx.origin.x,
  repair.position.y - repairCtx.origin.y,
);
assert.deepEqual(evaluateCreation(p).errors, []);
assert(
  !endpointSnapContext(p, mother.id, 1),
  'interior nodes do not acquire endpoint constraints',
);

const isolated = {
  origin: { x: 0, y: 0 },
  lines: [],
  points: [
    { id: 'target', kind: 'point', point: { x: 40, y: 20 }, label: 'endpoint' },
  ],
};
for (const scale of [0.25, 1, 4, 12]) {
  assert(snapEndpoint(isolated, { x: 40 + 9 / scale, y: 20 }, { scale }));
  assert(!snapEndpoint(isolated, { x: 40 + 11 / scale, y: 20 }, { scale }));
  assert(
    snapEndpoint(
      isolated,
      { x: 40 + 15 / scale, y: 20 },
      { scale, previousId: 'target' },
    ),
  );
  assert(
    !snapEndpoint(
      isolated,
      { x: 40 + 17 / scale, y: 20 },
      { scale, previousId: 'target' },
    ),
  );
}

// A rotated reflection with a non-origin centre has an exact seam as well.
const mirror = modifierTransforms({
  type: 'curve_mirror',
  angleDeg: 31,
  centerMM: { x: 8, y: -17 },
})[1];
const rotation = modifierTransforms({
  type: 'curve_array',
  count: 4,
  angleDeg: 90,
  centerMM: { x: 8, y: -17 },
})[1];
const t = composeTransforms(rotation, mirror),
  seam = fixedSet(t);
assert.equal(seam.kind, 'line');
const on = {
  x: seam.point.x + seam.direction.x * 13,
  y: seam.point.y + seam.direction.y * 13,
};
const mapped = transformPoint(t, on);
assert(Math.hypot(mapped.x - on.x, mapped.y - on.y) < 1e-10);
assert.equal(fixedSet([1, 0, 0, 1, 8, 0]), null);
assert.equal(
  fixedSet([1, 0, 0, -1, 8, 0]),
  null,
  'glide reflection is not a seam',
);

const disabled = structuredClone(original);
disabled.creation.objects.find((o) => o.id === 'emblem').modifiers[0].enabled =
  false;
assert.equal(endpointSnapContext(disabled, mother.id, 2).lines.length, 0);
const contextBefore = JSON.stringify(original);
endpointSnapContext(original, mother.id, 2);
assert.equal(
  JSON.stringify(original),
  contextBefore,
  'building aids cannot rewrite the project',
);
assert.equal(
  ctx.points.length,
  0,
  'already joined inner and outer tips must not become branch-producing targets',
);
const free = structuredClone(original);
free.creation.objects.find((o) => o.id === 'emblem').modifiers = [];
const freeContext = endpointSnapContext(free, mother.id, 2);
const target = freeContext.points.find((s) =>
  s.label.includes(free.paths.at(-1).name),
);
assert(target, 'free source endpoints are magnetic targets');
assert.deepEqual(
  snapEndpoint(
    freeContext,
    { x: target.point.x + 0.1, y: target.point.y },
    { scale: 3 },
  ).position,
  target.point,
);
free.paths.at(-1).visible = false;
assert(
  !endpointSnapContext(free, mother.id, 2).points.some((s) =>
    s.label.includes(free.paths.at(-1).name),
  ),
  'hidden paths are not snap targets',
);
console.log(
  'PASS: exact composed seams, closure-preserving slide, near-seam repair, handle translation, screen-space radius/hysteresis, non-origin axes, disabled stages and source immutability',
);
