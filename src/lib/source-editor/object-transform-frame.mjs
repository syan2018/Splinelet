import { multiplyTransforms, transformPoint } from '../scene/transforms.mjs';

/** A rigid, oriented box in source pixels. Evaluated silhouettes include
 * modifiers; guide-only objects fall back to their source control hulls. */
export function objectTransformFrame(nodeIds, rows, paths, cells, frame) {
  const ids = new Set(
    nodeIds.filter(
      (id) => rows.find((row) => row.id === id)?.visible !== false,
    ),
  );
  const roots = rows.filter(
    (row) => ids.has(row.id) && !row.ancestors.some((id) => ids.has(id)),
  );
  const rotation =
    roots.length === 1
      ? -[...roots[0].ancestors, roots[0].id].reduce(
          (sum, id) =>
            sum + (rows.find((row) => row.id === id)?.pose?.rotationRad || 0),
          0,
        )
      : 0;
  const cos = Math.cos(rotation),
    sin = Math.sin(rotation);
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  const add = (px, py) => {
    const x = cos * px + sin * py,
      y = -sin * px + cos * py;
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  };
  const covered = new Set();
  const visit = (coordinates) => {
    if (typeof coordinates?.[0] === 'number')
      add(
        frame.width / 2 + (coordinates[0] * frame.width) / frame.widthMM,
        frame.height / 2 - (coordinates[1] * frame.width) / frame.widthMM,
      );
    else for (const item of coordinates || []) visit(item);
  };
  for (const cell of cells || []) {
    if (!ids.has(cell.objectId)) continue;
    visit(cell.geometry?.coordinates);
    covered.add(cell.objectId);
  }
  for (const row of rows) {
    if (!ids.has(row.id) || covered.has(row.id) || row.kind === 'group')
      continue;
    for (const path of paths) {
      if (!row.pathIds.includes(path.id)) continue;
      for (const curve of path.curves) for (const p of curve) add(p.x, p.y);
      if (!path.curves.length && path.start) add(path.start.x, path.start.y);
    }
  }
  if (!Number.isFinite(minX)) return null;
  // A line or a point still needs a non-singular DOM box for the control library.
  const width = Math.max(maxX - minX, 0.01),
    height = Math.max(maxY - minY, 0.01);
  const x = (minX + maxX - width) / 2,
    y = (minY + maxY - height) / 2;
  return {
    width,
    height,
    matrix: [cos, sin, -sin, cos, cos * x - sin * y, sin * x + cos * y],
  };
}

export function transformFrame(frame, delta) {
  const matrix = delta.matrix || [1, 0, 0, 1, delta.x, delta.y];
  return { ...frame, matrix: multiplyTransforms(matrix, frame.matrix) };
}

export function framePoint(frame, direction = [0, 0]) {
  const [x, y] = transformPoint(frame.matrix, [
    (frame.width * (direction[0] + 1)) / 2,
    (frame.height * (direction[1] + 1)) / 2,
  ]);
  return { x, y };
}

/** Adapt a library-reported similarity transform to the existing command DTO. */
export function objectTransformDelta(mode, center, value) {
  if (mode === 'translate') return { x: value[0], y: value[1] };
  const angle = mode === 'rotate' ? (value * Math.PI) / 180 : 0;
  const factor = mode === 'scale' ? value : 1;
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
