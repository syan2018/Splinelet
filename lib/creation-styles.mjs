// An unambiguous source boundary keeps its style even after being moved or
// reshaped beyond the old painted footprint. Subdivisions sharing a boundary
// still use overlap matching so distinct styles never silently merge.
export function boundaryStyleMatches(boundaries, paints) {
  const key = (ids) => (ids?.length ? JSON.stringify([...ids].sort()) : null);
  const cellsBySource = new Map(),
    paintsBySource = new Map();
  boundaries.forEach((ids, index) => {
    const k = key(ids);
    if (k) cellsBySource.set(k, [...(cellsBySource.get(k) || []), index]);
  });
  for (const paint of paints) {
    const k = key(paint.boundaryPathIds);
    if (k) paintsBySource.set(k, [...(paintsBySource.get(k) || []), paint]);
  }
  const matches = new Map();
  for (const [k, indices] of cellsBySource) {
    const choices = paintsBySource.get(k);
    if (indices.length === 1 && choices?.length === 1)
      matches.set(indices[0], choices[0]);
  }
  return matches;
}
