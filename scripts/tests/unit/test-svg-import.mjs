import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  CubicBezierCurve,
  EllipseCurve,
  LineCurve,
  QuadraticBezierCurve,
  ShapePath,
  Vector2,
} from 'three';

if (!process.execArgv.includes('--experimental-strip-types')) {
  const result = spawnSync(
    process.execPath,
    ['--experimental-strip-types', fileURLToPath(import.meta.url)],
    { stdio: 'inherit' },
  );
  if (result.error) throw result.error;
  process.exit(result.status ?? 1);
}
const { curvesToSplineNodes, convertSvgPaths, parseSvgImport } =
  await import('../../../src/lib/import/svg-import.ts');
const v = (x, y) => new Vector2(x, y);
const cubic = new CubicBezierCurve(v(0, 0), v(4, 9), v(8, -3), v(12, 2));
const nodes = curvesToSplineNodes([cubic], false);
assert.deepEqual(nodes[0], {
  co: { x: 0, y: 0 },
  handleLeft: { x: 0, y: 0 },
  handleRight: { x: 4, y: 9 },
});
assert.deepEqual(nodes[1].handleLeft, { x: 8, y: -3 });
const q = curvesToSplineNodes(
  [new QuadraticBezierCurve(v(0, 0), v(3, 6), v(9, 0))],
  false,
);
assert.deepEqual(q[0].handleRight, { x: 2, y: 4 });
assert.deepEqual(q[1].handleLeft, { x: 5, y: 4 });

for (const clockwise of [false, true]) {
  const ellipse = new EllipseCurve(2, 3, 10, 4, 0, Math.PI * 2, clockwise, 0.3);
  const circleNodes = curvesToSplineNodes([ellipse], true);
  assert.equal(circleNodes.length, 8, 'closed seam is represented once');
  for (let i = 0; i < circleNodes.length; i++) {
    const a = circleNodes[i],
      b = circleNodes[(i + 1) % circleNodes.length];
    const converted = new CubicBezierCurve(
      v(a.co.x, a.co.y),
      v(a.handleRight.x, a.handleRight.y),
      v(b.handleLeft.x, b.handleLeft.y),
      v(b.co.x, b.co.y),
    );
    assert.ok(
      converted.getPoint(0.5).distanceTo(ellipse.getPoint((i + 0.5) / 8)) <
        0.0001,
    );
  }
}
const loop = curvesToSplineNodes(
  [new CubicBezierCurve(v(0, 0), v(10, 10), v(-10, 10), v(0, 0))],
  true,
);
assert.equal(loop.length, 3, 'single-cubic loop receives exact subdivisions');
assert.throws(
  () => curvesToSplineNodes([cubic, new LineCurve(v(99, 0), v(100, 0))], false),
  /不连续/,
);
assert.throws(() =>
  curvesToSplineNodes([new LineCurve(v(NaN, 0), v(1, 1))], false),
);

const signature = new ShapePath();
signature.moveTo(0, 0).bezierCurveTo(10, -5, 20, 15, 30, 0);
signature.userData = {
  style: {
    fill: 'none',
    stroke: '#c9a35c',
    strokeWidth: 2,
    strokeLineCap: 'round',
    strokeLineJoin: 'round',
  },
};
const imported = convertSvgPaths([signature]);
assert.equal(imported.splines[0].role, 'guide');
assert.equal(imported.splines[0].closed, false);
assert.equal(imported.splines[0].strokeWidth, 2);
assert.equal(imported.splines[0].stroke, '#c9a35c');
assert.deepEqual(imported.bounds, { minX: -1, minY: -6, maxX: 31, maxY: 16 });
assert.deepEqual(imported.warnings, []);

const ring = new ShapePath();
ring.moveTo(0, 0).lineTo(40, 0).lineTo(40, 40).lineTo(0, 40).lineTo(0, 0);
ring.moveTo(10, 10).lineTo(30, 10).lineTo(30, 30).lineTo(10, 30).lineTo(10, 10);
ring.userData = {
  style: { fill: '#222222', fillRule: 'evenodd', stroke: 'none' },
};
const filled = convertSvgPaths([ring]);
assert.deepEqual(
  filled.splines.map((s) => s.role),
  ['boundary', 'hole'],
);
assert.equal(filled.splines[0].fillGroup, filled.splines[1].fillGroup);
assert.ok(filled.splines.every((s) => s.closed && s.nodes.length === 4));
ring.userData.style.stroke = 'red';
ring.userData.style.strokeWidth = 3;
assert.equal(
  convertSvgPaths([ring]).splines.length,
  4,
  'fill and outline remain separate',
);
ring.userData.style.fill = 'url(#gradient)';
assert.throws(() => convertSvgPaths([ring]), /渐变/);
assert.throws(() => convertSvgPaths([]), /没有可导入/);
assert.throws(() => parseSvgImport('<!DOCTYPE svg><svg/>'), /外部实体/);
assert.throws(() => parseSvgImport(' '.repeat(5 * 1024 * 1024 + 1)), /5 MB/);
console.log(
  'PASS: SVG cubic fidelity, ellipse approximation, closed seams, fill holes, editable strokes, and rejection guards.',
);
