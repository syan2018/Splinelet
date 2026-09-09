import assert from 'node:assert/strict';
import {
  pathNodes,
  nodeSelection,
  selectedNode,
  removeNode,
} from '../public/node-edit.mjs';
import { evaluate } from '../public/geometry.mjs';
const pt = (x, y) => ({ x, y });
const line = (a, b) => [
  a,
  pt(a.x + (b.x - a.x) / 3, a.y + (b.y - a.y) / 3),
  pt(a.x + (2 * (b.x - a.x)) / 3, a.y + (2 * (b.y - a.y)) / 3),
  b,
];
const points = [pt(0, 0), pt(30, 30), pt(60, 0), pt(90, 30), pt(120, 0)];
const make = (closed = false) => ({
  id: 'test',
  start: points[0],
  curves: points
    .slice(1)
    .map((p, i) => line(points[i], p))
    .concat(closed ? [line(points.at(-1), points[0])] : []),
  closed,
  anchors: structuredClone(points),
  fitting: 'single',
});
let checks = 0;
function verify(path) {
  if (!path) return;
  assert.deepEqual(path.start, pathNodes(path)[0]);
  assert.deepEqual(path.anchors, pathNodes(path));
  for (let i = 1; i < path.curves.length; i++)
    assert.deepEqual(path.curves[i - 1][3], path.curves[i][0]);
  if (path.closed) assert.deepEqual(path.curves.at(-1)[3], path.start);
  for (const c of path.curves)
    assert.ok(c.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)));
  checks++;
}
for (const closed of [false, true])
  for (let i = 0; i < points.length; i++) {
    const original = make(closed),
      snapshot = structuredClone(original),
      r = removeNode(original, i);
    assert.deepEqual(original, snapshot, 'nonmutating');
    verify(r.path);
    assert.equal(pathNodes(r.path).length, 4);
    assert.equal(r.path.curves.length, closed ? 4 : 3);
    assert.deepEqual(
      pathNodes(r.path),
      points.filter((_, j) => j !== i),
    );
    for (let j = 0; j < 4; j++)
      assert.equal(selectedNode(r.path, nodeSelection(r.path, j)), j);
    if (!closed && i === 0)
      assert.deepEqual(r.path.curves, original.curves.slice(1));
    if (!closed && i === 4)
      assert.deepEqual(r.path.curves, original.curves.slice(0, -1));
    if (i === 2) {
      assert.deepEqual(r.path.curves[0], original.curves[0]);
      assert.deepEqual(r.path.curves[2], original.curves[3]);
    }
  }
for (const closed of [false, true]) {
  let path = make(closed);
  while (path) {
    const before = pathNodes(path).length;
    const r = removeNode(path, 0);
    if (r.path) {
      assert.equal(pathNodes(r.path).length, before - 1);
      verify(r.path);
    } else assert.equal(before, 1);
    path = r.path;
  }
}
assert.throws(() => removeNode(make(), -1));
assert.throws(() => removeNode(make(), 5));
assert.throws(() => removeNode(make(), 1.2));
assert.equal(selectedNode(make(true), { curve: 4, point: 3 }), 0);
assert.equal(selectedNode(make(), { curve: 0, point: 1 }), null);
// A removed point on a straight span should not bow the merged span.
const straight = make();
straight.curves = [line(pt(0, 0), pt(50, 0)), line(pt(50, 0), pt(100, 0))];
straight.start = pt(0, 0);
const joined = removeNode(straight, 1).path;
for (let i = 0; i <= 10; i++)
  assert.ok(Math.abs(evaluate(joined.curves[0], i / 10).y) < 1e-8);
console.log(
  'Node editing passed: ' +
    checks +
    ' topology checks; endpoints, seams, solitary nodes, exact surviving anchors, nonmutation, single-span merging.',
);
