// Model-space affine transforms shared by the evaluator and editing aids.
export const identityTransform = () => [1, 0, 0, 1, 0, 0];
export const transformPoint = ([a, b, c, d, e, f], p) => ({
  x: a * p.x + c * p.y + e,
  y: b * p.x + d * p.y + f,
});
export const composeTransforms = (a, b) => [
  a[0] * b[0] + a[2] * b[1],
  a[1] * b[0] + a[3] * b[1],
  a[0] * b[2] + a[2] * b[3],
  a[1] * b[2] + a[3] * b[3],
  a[0] * b[4] + a[2] * b[5] + a[4],
  a[1] * b[4] + a[3] * b[5] + a[5],
];
export function modifierTransforms(modifier) {
  const mirror = modifier.type === 'curve_mirror';
  const { x, y } = modifier.centerMM;
  return Array.from({ length: mirror ? 2 : modifier.count }, (_, i) => {
    if (!i) return identityTransform();
    const angle = ((modifier.angleDeg * Math.PI) / 180) * (mirror ? 2 : i);
    const a = Math.cos(angle),
      b = Math.sin(angle),
      c = mirror ? b : -b,
      d = mirror ? -a : a;
    return [a, b, c, d, x - a * x - c * y, y - b * x - d * y];
  });
}

// Fixed points of p = T(p). Reflections yield a line, rotations a point;
// translations and glide reflections have no fixed points.
export function fixedSet(t) {
  const a = 1 - t[0],
    b = -t[2],
    c = -t[1],
    d = 1 - t[3];
  const det = a * d - b * c;
  if (Math.abs(det) > 1e-10)
    return {
      kind: 'point',
      point: { x: (t[4] * d - b * t[5]) / det, y: (a * t[5] - t[4] * c) / det },
    };
  const row = a * a + b * b >= c * c + d * d ? [a, b, t[4]] : [c, d, t[5]];
  const norm = Math.hypot(row[0], row[1]);
  if (norm < 1e-10) return null;
  const normal = { x: row[0] / norm, y: row[1] / norm };
  const point = {
    x: (normal.x * row[2]) / norm,
    y: (normal.y * row[2]) / norm,
  };
  const moved = transformPoint(t, point);
  if (Math.hypot(moved.x - point.x, moved.y - point.y) > 1e-7) return null;
  return { kind: 'line', point, direction: { x: -normal.y, y: normal.x } };
}
