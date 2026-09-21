import assert from 'node:assert/strict';
import {
  editSplines,
  inspectSplines,
} from '../../../src/lib/source-editor/spline-edit.mjs';
import { liveSurfaces } from '../fixtures/live-surfaces.mjs';
import { prepareSplineEdits } from '../../../src/lib/source-editor/spline-proposal.mjs';
import { creationDocument } from '../../../src/lib/creation-schema.mjs';

const p = liveSurfaces();
const before = structuredClone(p);
const nodes = [
  { co: { x: -3, y: 2 }, handleRight: { x: -7, y: 8 } },
  { co: { x: 4, y: 5 }, handleLeft: { x: 8, y: 9 } },
  { co: { x: 1, y: -2 } },
];
const result = editSplines(p, {
  objectId: 'owner',
  units: 'model',
  splines: [{ name: '精确曲线', closed: true, nodes }],
});
assert.deepEqual(p, before);
const id = result.pathIds[0];
const inspected = inspectSplines(result.project, {
  pathIds: [id],
  units: 'model',
}).splines[0];
assert.equal(inspected.nodes.length, 3);
assert.deepEqual(inspected.nodes[0].co, nodes[0].co);
assert.deepEqual(inspected.nodes[0].handleRight, nodes[0].handleRight);
assert.deepEqual(result.project.paths.slice(0, p.paths.length), p.paths);
assert(
  result.project.creation.objects
    .find((o) => o.id === 'owner')
    .pathIds.includes(id),
);
const moved = editSplines(result.project, {
  units: 'model',
  splines: [{ id, matrix: [0, 1, -1, 0, 2, 3] }],
});
const rotated = inspectSplines(moved.project, { pathIds: [id], units: 'model' })
  .splines[0];
assert.deepEqual(rotated.nodes[0].co, { x: 0, y: 0 });
assert.deepEqual(rotated.nodes[0].handleRight, { x: -6, y: -4 });
assert.equal(moved.project.paths.at(-1).id, id);
const changed = structuredClone(inspected.nodes);
changed[1].co.x += 1;
const replaced = editSplines(result.project, {
  units: 'model',
  splines: [{ id, nodes: changed }],
});
assert.equal(
  inspectSplines(replaced.project, { pathIds: [id], units: 'model' }).splines[0]
    .nodes[1].co.x,
  5,
);
assert.throws(
  () =>
    editSplines(p, {
      splines: [
        { closed: true, nodes },
        { id: 'missing', nodes },
      ],
    }),
  /不存在/,
);
assert.deepEqual(p, before);
assert.throws(
  () => editSplines(p, { splines: [{ nodes, matrix: [0, 0, 0, 0, 0, 0] }] }),
  /非退化/,
);
assert.throws(
  () =>
    editSplines(p, {
      splines: [{ nodes: [{ co: { x: NaN, y: 0 } }, nodes[1]] }],
    }),
  /有限/,
);
assert.throws(
  () => editSplines(result.project, { splines: [{ id }, { id }] }),
  /重复/,
);
// Source-authoring handles are allowed beyond the image, unlike image tracing.
const outside = editSplines(p, {
  splines: [
    {
      nodes: [
        { co: { x: 1, y: 1 }, handleRight: { x: -40, y: -50 } },
        { co: { x: 20, y: 20 } },
      ],
    },
  ],
});
assert.deepEqual(outside.project.paths.at(-1).curves[0][1], { x: -40, y: -50 });

// The shared parser works on readonly geometry/ownership only, without a legacy
// creation document, ID allocation or a writable projected project.
const freeze = (value) => {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
};
const source = freeze({
  frame: { width: p.width, height: p.height, widthMM: p.widthMM },
  paths: structuredClone(result.project.paths),
  objects: creationDocument(result.project).objects.map(({ id, pathIds }) => ({
    id,
    pathIds,
  })),
});
const sourceBefore = structuredClone(source);
const request = freeze({
  units: 'model',
  splines: [{ id, matrix: [0, 1, -1, 0, 2, 3] }],
});
const [proposal] = prepareSplineEdits(source, request);
assert.equal(proposal.pathId, id);
assert.equal(proposal.ownerId, null);
assert.deepEqual(proposal.curves, moved.project.paths.at(-1).curves);
assert.deepEqual(proposal.nodeModes, result.project.paths.at(-1).nodeModes);
proposal.curves[0][0].x += 100;
proposal.nodeModes[0] = 'symmetric';
assert.deepEqual(source, sourceBefore);

const preparedNew = prepareSplineEdits(source, {
  units: 'model',
  objectId: 'owner',
  splines: [
    { closed: true, nodes, role: 'hole' },
    { nodes: nodes.slice(0, 2) },
  ],
});
assert.deepEqual(
  preparedNew.map(({ pathId, ownerId, role }) => ({ pathId, ownerId, role })),
  [
    { pathId: null, ownerId: 'owner', role: 'hole' },
    { pathId: null, ownerId: 'owner', role: 'guide' },
  ],
);
assert.throws(
  () =>
    prepareSplineEdits(source, {
      splines: [{ nodes: nodes.slice(0, 2) }, { id: 'missing' }],
    }),
  /不存在/,
);
assert.deepEqual(source, sourceBefore);
assert.throws(
  () =>
    prepareSplineEdits(source, {
      splines: [{ nodes, closed: true, role: 'hole' }],
    }),
  /objectId/,
);
console.log(
  'PASS: exact handles, model-space roundtrip, affine transforms, ID/owner preservation, atomic failure and out-of-image controls',
);
