import assert from 'node:assert/strict';
import {
  screenToDocument,
  zoomAt,
  framePathsView,
} from '../../../public/canvas-gestures.mjs';

const rect = { left: 100, top: 50 };
for (const view of [
  { x: 20, y: 30, s: 0.05 },
  { x: -150, y: 80, s: 0.5 },
  { x: 70, y: -40, s: 2 },
  { x: 10, y: 20, s: 12 },
]) {
  const documentPoint = { x: 123.5, y: 87.25 };
  const event = {
    clientX: rect.left + view.x + documentPoint.x * view.s,
    clientY: rect.top + view.y + documentPoint.y * view.s,
  };
  const restored = screenToDocument(event, rect, view);
  assert.ok(
    Math.abs(restored.x - documentPoint.x) < 1e-10 &&
      Math.abs(restored.y - documentPoint.y) < 1e-10,
  );
  const zoomed = zoomAt(view, 1.25, { x: 240, y: 180 });
  const before = screenToDocument(
    { clientX: rect.left + 240, clientY: rect.top + 180 },
    rect,
    view,
  );
  const after = screenToDocument(
    { clientX: rect.left + 240, clientY: rect.top + 180 },
    rect,
    zoomed,
  );
  assert.ok(
    Math.abs(before.x - after.x) < 1e-10 &&
      Math.abs(before.y - after.y) < 1e-10,
  );
}
assert.equal(
  screenToDocument({ clientX: 1, clientY: 1 }, rect, { x: 0, y: 0, s: 0 }),
  null,
);
const path = {
  start: { x: 100, y: 100 },
  anchors: [],
  curves: [
    [
      { x: 100, y: 100 },
      { x: 120, y: 120 },
      { x: 180, y: 180 },
      { x: 200, y: 200 },
    ],
  ],
};
assert.equal(
  framePathsView([path], { width: 800, height: 600 }, { x: 0, y: 0, s: 1 }),
  null,
  'mostly visible paths do not move the view',
);
const framed = framePathsView(
  [path],
  { width: 800, height: 600, x: 16, y: 92 },
  { x: -2000, y: -1000, s: 2 },
);
assert.ok(
  framed && framed.s > 0.05 && framed.s < 12,
  'offscreen paths receive a bounded view',
);
assert.equal(
  framePathsView([path], { width: 800, height: 600 }, framed),
  null,
  'an already framed path does not jitter',
);
assert.ok(
  framePathsView(
    [path],
    { width: 800, height: 600 },
    { x: 0, y: 0, s: 1 },
    { force: true },
  ),
  'explicit focus reframes a visible path',
);
console.log(
  'Canvas gesture math passed: zoom-invariant coordinates, cursor-anchored zoom, and stable path framing.',
);
