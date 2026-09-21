/** Use evaluated silhouettes (including modifiers), with source curves as the
 * fallback for guide-only objects. Coordinates returned are world millimetres. */
export function objectTransformCenter(nodeIds, paths, cells, frame) {
  const selected = new Set(nodeIds);
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  const add = (x, y) => {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  };
  const visit = (coordinates) => {
    if (typeof coordinates?.[0] === 'number')
      add(coordinates[0], coordinates[1]);
    else for (const item of coordinates || []) visit(item);
  };
  const covered = new Set();
  for (const cell of cells || [])
    if (selected.has(cell.objectId)) {
      visit(cell.geometry?.coordinates);
      covered.add(cell.objectId);
    }
  const mm = frame.widthMM / frame.width;
  for (const path of paths)
    if (selected.has(path.ownerNodeId) && !covered.has(path.ownerNodeId))
      for (const curve of path.curves)
        for (const p of curve)
          add((p.x - frame.width / 2) * mm, (frame.height / 2 - p.y) * mm);
  return Number.isFinite(minX)
    ? [(minX + maxX) / 2, (minY + maxY) / 2]
    : [0, 0];
}
