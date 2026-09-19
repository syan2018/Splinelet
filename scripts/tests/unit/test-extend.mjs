import assert from 'node:assert/strict';
import {
  extendSpline,
  splineEndpoint,
} from '../../../lib/source-editor/extend.mjs';
import { straightCubic } from '../../../lib/source-editor/connect.mjs';
import { pathNodes } from '../../../lib/source-editor/node-edit.mjs';

const point = (x, y) => ({ x, y });
const base = {
  id: 'original',
  name: '手动样条',
  groupId: 'detail',
  color: '#a59883',
  visible: true,
  closed: false,
  quality: 0.9,
  fitError: 0.4,
  start: point(200, 200),
  curves: [
    [point(200, 200), point(220, 175), point(240, 175), point(260, 200)],
    [point(260, 200), point(280, 225), point(300, 160), point(330, 180)],
  ],
  nodeModes: ['corner', 'smooth', 'corner'],
};
base.anchors = pathNodes(base);
const pristine = structuredClone(base);
for (const end of ['start', 'end']) {
  const to = end === 'start' ? point(150, 240) : point(390, 240);
  const result = {
    curves: [straightCubic(splineEndpoint(base, end), to)],
    quality: 1,
    fitError: 0,
  };
  const extended = extendSpline(base, end, result);
  assert.equal(extended.curves.length, base.curves.length + 1);
  assert.deepEqual(
    end === 'start' ? extended.curves.slice(1) : extended.curves.slice(0, -1),
    base.curves,
  );
  assert.deepEqual(extended.anchors, pathNodes(extended));
  assert.deepEqual(
    extended.nodeModes,
    end === 'start'
      ? ['corner', ...base.nodeModes]
      : [...base.nodeModes, 'corner'],
  );
  assert.deepEqual(splineEndpoint(extended, end), to);
  assert.equal(extended.id, base.id);
  assert.equal(extended.groupId, base.groupId);
  assert.equal(extended.quality, base.quality);
  const closing = {
    curves: [
      straightCubic(
        splineEndpoint(extended, end),
        splineEndpoint(extended, end === 'start' ? 'end' : 'start'),
      ),
    ],
    quality: 1,
    fitError: 0,
  };
  const closed = extendSpline(extended, end, closing, true);
  assert.deepEqual(closed.curves.slice(0, -1), extended.curves);
  assert.deepEqual(closed.curves.at(-1)[0], extended.curves.at(-1)[3]);
  assert.deepEqual(closed.curves.at(-1)[3], extended.start);
  assert.equal(closed.anchors.length, closed.curves.length);
  assert.equal(closed.nodeModes.length, closed.anchors.length);
  assert.throws(() => extendSpline(closed, end, result), /开放样条/);
  assert.deepEqual(base, pristine);
}
const one = {
  ...base,
  curves: [],
  nodeModes: ['corner'],
  anchors: [base.start],
};
for (const end of ['start', 'end']) {
  const extended = extendSpline(one, end, {
    curves: [straightCubic(one.start, point(100, 300))],
    quality: 1,
    fitError: 0,
  });
  assert.equal(extended.curves.length, 1);
  assert.equal(extended.anchors.length, 2);
  assert.equal(extended.nodeModes.length, 2);
}
assert.throws(() => splineEndpoint(base, 'middle'), /头或尾/);
assert.throws(
  () => extendSpline(base, 'start', { curves: base.curves }),
  /一段/,
);
console.log(
  'PASS: head/tail extension, one-node paths, closure, exact old geometry/modes/identity preservation and rejected invalid operations',
);
