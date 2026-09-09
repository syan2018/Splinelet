import assert from 'node:assert/strict';
import {
  mergeSplines,
  connectionSettings,
  straightCubic,
} from '../public/connect.mjs';
import { evaluate } from '../public/geometry.mjs';
const P = (x, y) => ({ x, y });
const a = {
  id: 'a',
  name: 'A',
  closed: false,
  visible: true,
  quality: 1,
  start: P(10, 10),
  curves: [[P(10, 10), P(15, 30), P(40, 20), P(50, 50)]],
};
const b = {
  id: 'b',
  name: 'B',
  closed: false,
  visible: true,
  quality: 0.8,
  start: P(90, 90),
  curves: [[P(90, 90), P(100, 130), P(140, 130), P(160, 100)]],
};
let cases = 0;
for (const ae of ['start', 'end'])
  for (const be of ['start', 'end']) {
    const snapshot = JSON.stringify([a, b]);
    const { path, bridge } = mergeSplines(a, ae, b, be);
    assert.equal(bridge, true);
    assert.equal(path.curves.length, 3);
    assert.equal(path.anchors.length, 4);
    assert.equal(path.id, a.id);
    for (let i = 1; i < 3; i++)
      assert.deepEqual(path.curves[i - 1][3], path.curves[i][0]);
    for (let k = 0; k <= 10; k++) {
      const p = evaluate(path.curves[0], k / 10),
        q = evaluate(a.curves[0], ae === 'start' ? 1 - k / 10 : k / 10);
      const r = evaluate(path.curves[2], k / 10),
        s = evaluate(b.curves[0], be === 'end' ? 1 - k / 10 : k / 10);
      assert.ok(Math.hypot(p.x - q.x, p.y - q.y) < 1e-9);
      assert.ok(Math.hypot(r.x - s.x, r.y - s.y) < 1e-9);
    }
    assert.equal(JSON.stringify([a, b]), snapshot);
    cases++;
  }
const c = structuredClone(b);
c.start = P(50, 50);
c.curves[0][0] = P(50, 50);
const welded = mergeSplines(a, 'end', c, 'start');
assert.equal(welded.bridge, false);
assert.equal(welded.path.curves.length, 2);
assert.equal(welded.path.anchors.length, 3);
assert.throws(() => mergeSplines(a, 'end', a, 'start'));
assert.throws(() => mergeSplines(a, 'end', { ...b, closed: true }, 'start'));
assert.throws(() => mergeSplines(a, 'wrong', b, 'start'));
const settings = { mode: 'ink', snap: true, tolerance: 1.5 };
assert.deepEqual(connectionSettings(settings, { shiftKey: true }), {
  ...settings,
  snap: false,
});
assert.deepEqual(connectionSettings(settings, { altKey: true }), {
  ...settings,
  snap: false,
  mode: 'manual',
});
assert.deepEqual(connectionSettings(settings, {}), settings);
assert.deepEqual(settings, { mode: 'ink', snap: true, tolerance: 1.5 });
assert.deepEqual(straightCubic(P(0, 0), P(90, 30)), [
  P(0, 0),
  P(30, 10),
  P(60, 20),
  P(90, 30),
]);
console.log(
  JSON.stringify({
    orientations: cases,
    preservedShapes: true,
    continuous: true,
    coincidentEndpointWeld: true,
    noExtraNodes: true,
    invalidInputsRejected: true,
    modifierIsolation: true,
  }),
);
