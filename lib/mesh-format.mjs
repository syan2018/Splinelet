export function inspectMesh(mesh) {
  const { positions: v, triangles: t } = mesh,
    edges = new Map(),
    parents = Array.from({ length: v.length / 3 }, (_, i) => i);
  let zeroArea = 0,
    volume = 0;
  const root = (x) => {
    while (parents[x] !== x) {
      parents[x] = parents[parents[x]];
      x = parents[x];
    }
    return x;
  };
  for (let i = 0; i < t.length; i += 3) {
    const ids = t.slice(i, i + 3),
      p = ids.map((j) => v.slice(j * 3, j * 3 + 3));
    const a = p[1].map((x, k) => x - p[0][k]),
      b = p[2].map((x, k) => x - p[0][k]),
      cross = [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
      ];
    if (Math.hypot(...cross) < 1e-14) zeroArea++;
    volume +=
      (p[0][0] * (p[1][1] * p[2][2] - p[1][2] * p[2][1]) +
        p[0][1] * (p[1][2] * p[2][0] - p[1][0] * p[2][2]) +
        p[0][2] * (p[1][0] * p[2][1] - p[1][1] * p[2][0])) /
      6;
    for (let j = 0; j < 3; j++) {
      const a = ids[j],
        b = ids[(j + 1) % 3],
        key = Math.min(a, b) + ',' + Math.max(a, b),
        e = edges.get(key) || [0, 0];
      e[0]++;
      e[1] += a < b ? 1 : -1;
      edges.set(key, e);
      parents[root(a)] = root(b);
    }
  }
  let invalidEdges = 0;
  for (const [count, orientation] of edges.values())
    if (count !== 2 || orientation !== 0) invalidEdges++;
  const components = new Set(t.map(root)).size,
    min = [Infinity, Infinity, Infinity],
    max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < v.length; i++) {
    const k = i % 3;
    min[k] = Math.min(min[k], v[i]);
    max[k] = Math.max(max[k], v[i]);
  }
  return {
    triangles: t.length / 3,
    vertices: v.length / 3,
    invalidEdges,
    zeroArea,
    components,
    volumeMM3: volume,
    sizeMM: max.map((x, k) => x - min[k]),
    bounds: [min, max],
    valid: !!t.length && !invalidEdges && !zeroArea && volume > 0,
  };
}
export function meshSTL(mesh) {
  const report = inspectMesh(mesh);
  if (!report.valid || report.components !== 1)
    throw Error('零件必须是一个相连的有效闭合实体后才能导出 STL');
  const count = mesh.triangles.length / 3,
    buffer = new ArrayBuffer(84 + count * 50),
    v = new DataView(buffer),
    header = new TextEncoder().encode(
      'Bezier Studio / millimeters / validated connected mesh',
    );
  new Uint8Array(buffer).set(header);
  v.setUint32(80, count, true);
  for (let i = 0; i < count; i++) {
    const p = mesh.triangles
        .slice(i * 3, i * 3 + 3)
        .map((id) => mesh.positions.slice(id * 3, id * 3 + 3)),
      a = p[1].map((x, k) => x - p[0][k]),
      b = p[2].map((x, k) => x - p[0][k]),
      n = [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
      ],
      len = Math.hypot(...n);
    [...n.map((x) => x / len), ...p.flat()].forEach((x, k) =>
      v.setFloat32(84 + i * 50 + k * 4, x, true),
    );
  }
  return buffer;
}
