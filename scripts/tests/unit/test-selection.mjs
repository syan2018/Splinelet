import assert from 'node:assert/strict';
import {
  pickSelection,
  movePaths,
  translatePaths,
  translateNodes,
  deleteNodes,
  pathHitsBox,
} from '../../../src/lib/source-editor/selection.mjs';
import { setContinuity } from '../../../src/lib/source-editor/continuity.mjs';
import { pathNodes } from '../../../src/lib/source-editor/node-edit.mjs';
import { straightCubic } from '../../../src/lib/source-editor/connect.mjs';
const points = [
  { x: 10, y: 10 },
  { x: 50, y: 20 },
  { x: 90, y: 10 },
  { x: 90, y: 80 },
];
const path = {
  id: 'a',
  name: 'A',
  start: points[0],
  curves: points.slice(1).map((p, i) => straightCubic(points[i], p)),
  anchors: points,
  closed: false,
  visible: true,
  fitting: 'single',
};
assert.deepEqual(
  pickSelection(['a'], 'd', ['a', 'b', 'c', 'd'], { range: true, anchor: 'a' }),
  ['a', 'b', 'c', 'd'],
);
assert.deepEqual(pickSelection(['a', 'b'], 'a', [], { toggle: true }), ['b']);
const doc = {
  groups: [{ id: 'g' }],
  paths: [
    structuredClone(path),
    { ...structuredClone(path), id: 'b', groupId: 'g' },
    { ...structuredClone(path), id: 'c' },
    { ...structuredClone(path), id: 'd' },
  ],
};
movePaths(doc, ['a', 'c'], '', 'd', true);
assert.deepEqual(
  doc.paths.map((p) => p.id),
  ['b', 'd', 'a', 'c'],
);
assert.equal(movePaths(doc, ['a', 'c'], '', 'a'), false);
const old = structuredClone(doc);
translatePaths(doc, ['a', 'c'], 13, -7);
for (const id of ['a', 'c']) {
  const p = doc.paths.find((p) => p.id === id);
  assert.equal(p.start.x, path.start.x + 13);
  assert.equal(p.curves[0][1].y, path.curves[0][1].y - 7);
}
assert.deepEqual(doc.paths[0], old.paths[0]);
const nodePath = structuredClone(path);
setContinuity(nodePath, 1, 'symmetric');
setContinuity(nodePath, 2, 'smooth');
const before = structuredClone(nodePath);
translateNodes(nodePath, [1, 2], 15, 8);
assert.deepEqual(nodePath.curves[0][3], nodePath.curves[1][0]);
assert.deepEqual(nodePath.curves[1][3], nodePath.curves[2][0]);
assert.deepEqual(nodePath.start, before.start);
for (const i of [1, 2]) {
  const a = nodePath.curves[i][0],
    l = nodePath.curves[i - 1][2],
    r = nodePath.curves[i][1];
  assert.ok(
    Math.abs((l.x - a.x) * (r.y - a.y) - (l.y - a.y) * (r.x - a.x)) < 1e-6,
  );
  if (i === 1)
    assert.ok(
      Math.abs(
        Math.hypot(l.x - a.x, l.y - a.y) - Math.hypot(r.x - a.x, r.y - a.y),
      ) < 1e-6,
    );
}
const closed = {
  ...structuredClone(path),
  closed: true,
  curves: [...path.curves, straightCubic(points.at(-1), points[0])],
};
translateNodes(closed, [0, 3], 5, 10);
assert.deepEqual(closed.curves[0][0], closed.curves.at(-1)[3]);
assert.deepEqual(closed.start, closed.curves[0][0]);
assert.equal(pathNodes(deleteNodes(closed, [0, 2], 1.5)).length, 2);
assert.equal(deleteNodes(path, [0, 1, 2, 3], 1.5), null);
assert.ok(pathHitsBox(path, { x: 29, y: 12, width: 2, height: 5 }));
assert.ok(!pathHitsBox(path, { x: 200, y: 200, width: 10, height: 10 }));
console.log(
  'PASS selection order, stable batch reordering, object translation, multiple node continuity, closed seam, batch deletion, rectangle intersection',
);
