// An unambiguous source boundary keeps its style even after being moved or
// reshaped beyond the old painted footprint. Subdivisions sharing a boundary
// still use overlap matching so distinct styles never silently merge.
function boundaryStyleMatches(boundaries, paints) {
  const key = (ids) =>
    ids?.length
      ? JSON.stringify([...ids].sort((a, b) => a.localeCompare(b)))
      : null;
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

// Polygon overlays may include coincident lines/points in a GeometryCollection.
// Those have no printable area and are never valid persisted paint records.
export function polygonalGeometry(geometry) {
  const polygons = [];
  const visit = (g) => {
    if (g?.type === 'Polygon') polygons.push(g.coordinates);
    else if (g?.type === 'MultiPolygon') polygons.push(...g.coordinates);
    else if (g?.type === 'GeometryCollection') g.geometries.forEach(visit);
  };
  visit(geometry);
  return polygons.length === 1
    ? { type: 'Polygon', coordinates: polygons[0] }
    : polygons.length
      ? { type: 'MultiPolygon', coordinates: polygons }
      : null;
}

// Maximum-weight one-to-one correspondence. Zero overlap is not a candidate.
// A small face cannot steal the only destination of its neighbour merely
// because both individually overlap that face most strongly.
function assignment(scores, forbidden) {
  const n = scores.length,
    u = Array(n + 1).fill(0),
    v = Array(n + 1).fill(0),
    p = Array(n + 1).fill(0),
    way = Array(n + 1).fill(0);
  const cost = (i, j) =>
    scores[i][j] > 0 && !(forbidden?.[0] === i && forbidden?.[1] === j)
      ? 1 - scores[i][j]
      : 1e6;
  for (let i = 1; i <= n; i++) {
    p[0] = i;
    let j0 = 0;
    const minv = Array(n + 1).fill(Infinity),
      used = Array(n + 1).fill(false);
    do {
      used[j0] = true;
      const i0 = p[j0];
      let delta = Infinity,
        j1 = 0;
      for (let j = 1; j <= n; j++)
        if (!used[j]) {
          const cur = cost(i0 - 1, j - 1) - u[i0] - v[j];
          if (cur < minv[j]) {
            minv[j] = cur;
            way[j] = j0;
          }
          if (minv[j] < delta) {
            delta = minv[j];
            j1 = j;
          }
        }
      for (let j = 0; j <= n; j++)
        if (used[j]) {
          u[p[j]] += delta;
          v[j] -= delta;
        } else minv[j] -= delta;
      j0 = j1;
    } while (p[j0] !== 0);
    do {
      const j1 = way[j0];
      p[j0] = p[j1];
      j0 = j1;
    } while (j0 !== 0);
  }
  const columns = Array(n);
  for (let j = 1; j <= n; j++) columns[p[j] - 1] = j - 1;
  if (columns.some((j, i) => cost(i, j) >= 1e6)) return null;
  return {
    columns,
    score: columns.reduce((sum, j, i) => sum + scores[i][j], 0),
  };
}

export function matchCreationStyles(cells, boundaries, paints, stableTopology) {
  const matches = boundaryStyleMatches(boundaries, paints);
  const claimed = new Set(matches.values());
  const overlaps = cells.map((g) =>
    paints
      .map((p) => ({ p, area: g.intersection(p.g).getArea() }))
      .filter((h) => h.area > 1e-7),
  );
  if (stableTopology) {
    const remaining = paints.filter((p) => !claimed.has(p));
    const available = new Set(
      cells.map((_, i) => i).filter((i) => !matches.has(i)),
    );
    const edges = new Map(
      remaining.map((p) => [
        p,
        [...available].filter((i) => overlaps[i].some((h) => h.p === p)),
      ]),
    );
    const visited = new Set();
    for (const seed of remaining) {
      if (visited.has(seed)) continue;
      const ps = [],
        cs = new Set(),
        queue = [seed];
      visited.add(seed);
      while (queue.length) {
        const p = queue.pop();
        ps.push(p);
        for (const i of edges.get(p)) {
          if (cs.has(i)) continue;
          cs.add(i);
          for (const h of overlaps[i])
            if (edges.has(h.p) && !visited.has(h.p)) {
              visited.add(h.p);
              queue.push(h.p);
            }
        }
      }
      // Unequal populations represent a real split/merge, or a lost source.
      // Keep its local overlap inheritance; other components remain matched.
      if (ps.length !== cs.size) continue;
      const indices = [...cs];
      const scores = ps.map((p) =>
        indices.map(
          (i) =>
            (overlaps[i].find((h) => h.p === p)?.area || 0) /
            Math.max(p.g.getArea(), 1e-7),
        ),
      );
      const best = assignment(scores);
      if (!best) continue;
      const ambiguous = new Set();
      for (let r = 0; r < ps.length; r++) {
        if (scores[r].filter((s) => s > 0).length < 2) continue;
        const alternative = assignment(scores, [r, best.columns[r]]);
        if (alternative && best.score - alternative.score < 1e-6)
          alternative.columns.forEach((column, row) => {
            if (column !== best.columns[row]) ambiguous.add(row);
          });
      }
      best.columns.forEach((column, row) => {
        if (ambiguous.has(row)) return;
        matches.set(indices[column], ps[row]);
        claimed.add(ps[row]);
      });
    }
  }
  return cells.map((g, i) =>
    matches.has(i)
      ? [{ p: matches.get(i), area: g.getArea() }]
      : overlaps[i].filter((h) => !claimed.has(h.p)),
  );
}
