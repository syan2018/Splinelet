import assert from 'node:assert/strict';
import { setContinuity, moveHandle } from '../../../public/continuity.mjs';
import { removeNode } from '../../../public/node-edit.mjs';
import { mergeSplines } from '../../../public/connect.mjs';
import { svg, blender, validateProject } from '../../../lib/project.ts';
import fs from 'node:fs';
const pt = (x, y) => ({ x, y });
const path = () => ({
  id: 'a',
  name: 'A',
  color: '#aabbcc',
  visible: true,
  quality: 1,
  closed: false,
  start: pt(0, 0),
  anchors: [pt(0, 0), pt(60, 40), pt(120, 0)],
  curves: [
    [pt(0, 0), pt(20, 0), pt(40, 20), pt(60, 40)],
    [pt(60, 40), pt(80, 40), pt(100, 0), pt(120, 0)],
  ],
});
const check = (p, i, symmetric = false) => {
  const n = p.curves.length,
    l = p.curves[(i - 1 + n) % n][2],
    r = p.curves[i % n][1],
    a = p.curves[i % n][0],
    lx = l.x - a.x,
    ly = l.y - a.y,
    rx = r.x - a.x,
    ry = r.y - a.y;
  assert.ok(Math.abs(lx * ry - ly * rx) < 1e-7);
  assert.ok(lx * rx + ly * ry <= 0);
  if (symmetric) {
    assert.ok(Math.abs(lx + rx) < 1e-8);
    assert.ok(Math.abs(ly + ry) < 1e-8);
  }
};
let p = path();
const length = Math.hypot(20, 20);
setContinuity(p, 1, 'smooth');
check(p, 1);
moveHandle(p, 1, 1, pt(90, 80));
check(p, 1);
assert.ok(
  Math.abs(Math.hypot(p.curves[0][2].x - 60, p.curves[0][2].y - 40) - length) <
    1e-8,
);
setContinuity(p, 1, 'symmetric');
check(p, 1, true);
moveHandle(p, 0, 2, pt(25, 80));
check(p, 1, true);
const before = structuredClone(p.curves[0][2]);
setContinuity(p, 1, 'corner');
moveHandle(p, 1, 1, pt(100, 20));
assert.deepEqual(p.curves[0][2], before);
assert.throws(() => setContinuity(p, 0, 'smooth'));
assert.throws(() => setContinuity(p, 9, 'corner'));
p = path();
p.closed = true;
p.curves.push([pt(120, 0), pt(100, -30), pt(20, -30), pt(0, 0)]);
setContinuity(p, 0, 'symmetric');
check(p, 0, true);
moveHandle(p, 2, 2, pt(-10, -20));
check(p, 0, true);
const removed = removeNode(p, 1).path;
assert.equal(removed.nodeModes.length, 2);
check(removed, 0, true);
const a = path(),
  b = path();
b.id = 'b';
b.name = 'B';
setContinuity(a, 1, 'symmetric');
const merged = mergeSplines(a, 'start', b, 'end').path;
assert.equal(merged.nodeModes.length, 6);
check(merged, 1, true);
const project = {
  version: 1,
  image: '/reference.png',
  imageName: 'test',
  width: 400,
  height: 400,
  widthMM: 100,
  depthMM: 2,
  groups: [{ id: 'hair', name: '头发 & Hair' }],
  paths: [{ ...a, groupId: 'hair' }],
};
validateProject(project);
assert.match(svg(project), /<g id="group-hair" data-name="头发 &amp; Hair">/);
assert.match(blender(project), /group_collections/);
assert.throws(() => validateProject({ ...project, groups: [] }));
fs.writeFileSync(
  '../test-groups-blender.py',
  blender(project) +
    "\nassert len(collection.children) == 1\nassert len(collection.children[0].objects) == 1\nprint('GROUP_EXPORT_PASS')\n",
);
console.log(
  'PASS: smooth lengths, symmetric C1 derivatives, bidirectional handles, corners, closed seam, delete/merge mode remapping, group serialization and SVG export.',
);
