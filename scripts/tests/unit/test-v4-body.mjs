import assert from 'node:assert/strict';
import { buildBodies } from '../../../src/lib/solid/bodies.mjs';

const ref = (key, ownerNodeId = 'shape') => ({
  kind: 'output',
  ownerNodeId,
  operatorId: 'fill',
  port: 'regions',
  key,
  lineage: [key],
  instances: [],
});
const rectangle = (x0, y0, x1, y1) => ({
  type: 'Polygon',
  coordinates: [
    [
      [x0, y0],
      [x1, y0],
      [x1, y1],
      [x0, y1],
      [x0, y0],
    ],
  ],
});
const relief = (key, geometry, mode, color, zBase, zTop, partId = 'main') => ({
  ref: ref(key),
  geometry,
  mode,
  color,
  swatchId: color,
  enabled: true,
  thickness: { kind: 'mm', value: zTop - zBase },
  placement: { kind: 'free', zMM: zBase },
  partId,
  mm: zTop - zBase,
  layers: null,
  zBase,
  zTop,
});
const placed = {
  domain: 'placed-relief',
  status: 'ready',
  diagnostics: [],
  dependencies: ['manufacturing:main'],
  value: {
    reliefs: [
      relief('red-base', rectangle(0, 0, 4, 4), 'add', '#FF0000', 0, 2),
      relief('blue-top', rectangle(5, 0, 6, 1), 'add', '#0000FF', 0, 1),
      relief('cut', rectangle(1, 1, 2, 2), 'cut', '#000000', 0, 2),
      relief('through', rectangle(3, 2, 4, 4), 'through', '#000000', 0, 1),
      relief('other', rectangle(10, 0, 11, 1), 'add', '#00FF00', 2, 3, 'other'),
    ],
    provenance: [],
  },
};
const result = await buildBodies(placed);
assert.equal(result.status, 'ready', JSON.stringify(result.diagnostics));
assert.equal(
  result.value.bodies.length,
  2,
  'Parts remain separate manufacturing bodies',
);
const main = result.value.bodies.find((body) => body.partId === 'main');
assert(main.report.valid);
assert(
  main.report.volumeMM3 < 32,
  'cut and through remove material from the target Part',
);
assert.equal(
  main.materialParts.length,
  2,
  'same Part retains separate material volumes',
);
assert(
  Math.abs(
    main.materialParts.reduce((sum, item) => sum + item.volumeMM3, 0) -
      main.report.volumeMM3,
  ) < 0.001,
);
assert(
  Math.abs(
    result.value.bodies.find((body) => body.partId === 'other').report
      .volumeMM3 - 1,
  ) < 1e-9,
);
assert.equal(
  (await buildBodies({ ...placed, status: 'empty', value: undefined })).status,
  'empty',
);
const invalid = structuredClone(placed);
invalid.value.reliefs[0].zTop = invalid.value.reliefs[0].zBase;
const failed = await buildBodies(invalid);
assert.equal(failed.status, 'blocked');
assert.equal(
  'value' in failed,
  false,
  'failure never falls back to an old mesh',
);

const notchedGeometry = {
  type: 'Polygon',
  coordinates: [
    [
      [0, 0],
      [4, 0],
      [4, 4],
      [2.1, 4],
      [2.1, 1],
      [1.9, 1],
      [1.9, 4],
      [0, 4],
      [0, 0],
    ],
  ],
};
const cleanupInput = {
  ...placed,
  value: {
    reliefs: [relief('notched', notchedGeometry, 'add', '#FF0000', 0, 1)],
    provenance: [],
  },
};
const originalCleanupInput = structuredClone(cleanupInput);
const uncleaned = await buildBodies(cleanupInput);
const cleaned = await buildBodies(cleanupInput, undefined, 0.005, 0.2);
assert.equal(cleaned.status, 'ready', JSON.stringify(cleaned.diagnostics));
assert.ok(
  cleaned.value.bodies[0].report.volumeMM3 >
    uncleaned.value.bodies[0].report.volumeMM3,
  'closing cleanup changes only the derived manufacturing cross-section',
);
assert.deepEqual(cleanupInput, originalCleanupInput);
assert.ok(
  Math.abs(
    cleaned.value.bodies[0].materialParts.reduce(
      (sum, item) => sum + item.volumeMM3,
      0,
    ) - cleaned.value.bodies[0].report.volumeMM3,
  ) < 0.001,
  'body CSG and material partition reuse the same cleaned cross-section',
);
assert.equal(
  (await buildBodies(cleanupInput, undefined, 0.005, -1)).status,
  'blocked',
);
console.log(
  'PASS: V4 BodySet uses placed world contours, per-Part CSG and material volumes.',
);
