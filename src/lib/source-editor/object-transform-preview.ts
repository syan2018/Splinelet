export type ObjectTransformDelta = {
  x: number;
  y: number;
  matrix?: number[];
  angleRad?: number;
  factor?: number;
};
export const objectTransformAttribute = (delta: ObjectTransformDelta) =>
  delta.matrix
    ? `matrix(${delta.matrix.join(' ')})`
    : `translate(${delta.x} ${delta.y})`;

export function pointerObjectTransform(
  mode: 'translate' | 'rotate' | 'scale',
  origin: { x: number; y: number },
  point: { x: number; y: number },
  center: { x: number; y: number },
  snap: boolean,
): ObjectTransformDelta {
  let x = point.x - origin.x,
    y = point.y - origin.y;
  if (mode === 'translate') {
    if (snap) {
      if (Math.abs(x) > Math.abs(y)) y = 0;
      else x = 0;
    }
    return { x, y };
  }
  let angle = 0,
    factor = 1;
  if (mode === 'rotate') {
    angle =
      Math.atan2(point.y - center.y, point.x - center.x) -
      Math.atan2(origin.y - center.y, origin.x - center.x);
    if (snap) angle = (Math.round(angle / (Math.PI / 12)) * Math.PI) / 12;
  } else {
    const radius = Math.hypot(origin.x - center.x, origin.y - center.y);
    factor =
      radius < 1
        ? Math.exp((x - y) / 100)
        : Math.hypot(point.x - center.x, point.y - center.y) / radius;
    if (snap) factor = Math.round(factor * 10) / 10;
    factor = Math.max(0.01, Math.min(100, factor));
  }
  const a = Math.cos(angle) * factor,
    b = Math.sin(angle) * factor;
  return {
    x: 0,
    y: 0,
    angleRad: -angle,
    factor,
    matrix: [
      a,
      b,
      -b,
      a,
      center.x - a * center.x + b * center.y,
      center.y - b * center.x - a * center.y,
    ],
  };
}
