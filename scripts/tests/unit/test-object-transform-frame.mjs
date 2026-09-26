import assert from 'node:assert/strict';
import {
  objectTransformFrame,
  objectTransformDelta,
  transformFrame,
  framePoint,
} from '../../../src/lib/source-editor/object-transform-frame.mjs';
import { transformPoint } from '../../../src/lib/scene/transforms.mjs';

const close = (actual, expected) => {
  assert.equal(actual.length, expected.length);
  actual.forEach((n, i) =>
    assert(Math.abs(n - expected[i]) < 1e-8, `${actual} != ${expected}`),
  );
};
const position = (p) => [p.x, p.y];
const frame = { width: 400, height: 200, widthMM: 100 };
const rows = [
  {
    id: 'group',
    kind: 'group',
    ancestors: [],
    pathIds: ['path'],
    pose: { rotationRad: Math.PI / 6 },
  },
  {
    id: 'shape',
    kind: 'shape',
    ancestors: ['group'],
    pathIds: ['path'],
    pose: { rotationRad: Math.PI / 3 },
  },
];
// World-space silhouette: 20 x 40 pixels, rotated -90 degrees from local axes.
const cells = [
  {
    objectId: 'shape',
    geometry: {
      coordinates: [
        [
          [0, 0],
          [5, 0],
          [5, 10],
          [0, 10],
          [0, 0],
        ],
      ],
    },
  },
];
const box = objectTransformFrame(['shape'], rows, [], cells, frame);
close([box.width, box.height], [40, 20]);
close(box.matrix.slice(0, 4), [0, -1, 1, 0]);
close(position(framePoint(box)), [210, 80]);

const groupBox = objectTransformFrame(
  ['group', 'shape'],
  rows,
  [],
  cells,
  frame,
);
close(groupBox.matrix.slice(0, 4), [
  Math.cos(Math.PI / 6),
  -0.5,
  0.5,
  Math.cos(Math.PI / 6),
]);
assert.equal(objectTransformFrame([], rows, [], cells, frame), null);
assert.equal(
  objectTransformFrame(
    ['shape'],
    rows.map((r) => ({ ...r, visible: false })),
    [],
    cells,
    frame,
  ),
  null,
);

// Source fallback handles guide-only and degenerate objects without singular boxes.
const guide = [
  {
    id: 'path',
    curves: [
      [
        { x: 10, y: 20 },
        { x: 10, y: 20 },
        { x: 10, y: 50 },
        { x: 10, y: 50 },
      ],
    ],
  },
];
const guideBox = objectTransformFrame(
  ['shape'],
  [{ ...rows[1], ancestors: [], pose: { rotationRad: 0 } }],
  guide,
  [],
  frame,
);
close([guideBox.width, guideBox.height], [0.01, 30]);
close(position(framePoint(guideBox)), [10, 35]);

// Scaling around a rotated opposite corner must leave that world point fixed.
const anchor = framePoint(box, [-1, -1]);
const scaled = transformFrame(box, objectTransformDelta('scale', anchor, 1.75));
close(position(framePoint(scaled, [-1, -1])), position(anchor));
close(
  position(framePoint(scaled, [1, 1])),
  position(framePoint(box, [1, 1])).map(
    (n, i) => position(anchor)[i] + 1.75 * (n - position(anchor)[i]),
  ),
);
const center = framePoint(box);
const rotated = objectTransformDelta('rotate', center, 90);
assert.equal(
  rotated.angleRad,
  -Math.PI / 2,
  'screen Y down converts to model Y up',
);
close(transformPoint(rotated.matrix, position(center)), position(center));
close(position(framePoint(transformFrame(box, rotated))), position(center));
const moved = transformFrame(
  box,
  objectTransformDelta('translate', center, [30, -10]),
);
close(position(framePoint(moved)), [center.x + 30, center.y - 10]);
console.log(
  'PASS: oriented gizmo frames, nested rotations, source fallback and transform anchors',
);
