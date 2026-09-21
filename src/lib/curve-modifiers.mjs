import { readGeometry, samplePath } from './region-engine.mjs';
import { modifierStages, usesCurvePipeline } from './modifier-stages.mjs';
import { modifierTransforms, transformPoint } from './curve-transforms.mjs';

const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
export function sourceCurves(project, object) {
  const s = project.widthMM / project.width;
  const paths = object.pathIds.map((id) =>
    project.paths.find((p) => p.id === id),
  );
  if (!paths.length || paths.some((p) => !p || !p.curves.length))
    throw Error('曲线构造需要有效的源样条');
  if (paths.some((p) => object.roles[p.id] !== 'guide'))
    throw Error('显式曲线构造的源线用途须为 guide，避免隐式构面');
  return paths.flatMap((p) =>
    p.curves.map((c) =>
      c.map((v) => ({
        x: (v.x - project.width / 2) * s,
        y: (project.height / 2 - v.y) * s,
      })),
    ),
  );
}

export function transformCurves(curves, modifier) {
  const copies = modifier.type === 'curve_mirror' ? 2 : modifier.count;
  if (curves.length * copies > 20000)
    throw Error('派生曲线超过 20000 段，请减少阵列数量');
  return modifierTransforms(modifier).flatMap((t) =>
    curves.map((c) => c.map((p) => transformPoint(t, p))),
  );
}

function curveGraph(curves, joinMM) {
  // Weld derived endpoints only. Never close a dangling path by inventing an
  // edge, and never move any source node. Mirrored axis segments deduplicate.
  const key = (c) =>
    JSON.stringify(
      c.map((p) => [Math.round(p.x * 1e8), Math.round(p.y * 1e8)]),
    );
  const unique = new Map();
  for (const c of curves) {
    const a = key(c),
      b = key(c.slice().reverse());
    unique.set(a < b ? a : b, c);
  }
  const vertices = [],
    buckets = new Map();
  const radius = Math.max(joinMM, 1e-8);
  const vertex = (p) => {
    const x = Math.floor(p.x / radius),
      y = Math.floor(p.y / radius);
    const matches = [];
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (const i of buckets.get(`${x + dx},${y + dy}`) || [])
          if (distance(vertices[i].point, p) <= radius) matches.push(i);
    if (matches.length > 1) throw Error('构面端点接合有歧义，请减小接合距离');
    if (matches.length) return matches[0];
    vertices.push({ point: { ...p }, edges: [] });
    const bucket = `${x},${y}`;
    if (!buckets.has(bucket)) buckets.set(bucket, []);
    buckets.get(bucket).push(vertices.length - 1);
    return vertices.length - 1;
  };
  const edges = [...unique.values()].map((c, index) => {
    const a = vertex(c[0]),
      b = vertex(c[3]);
    vertices[a].edges.push(index);
    vertices[b].edges.push(index);
    return { c, a, b };
  });
  return { vertices, edges };
}

// The same exact curve program feeds interactive helpers and surface evaluation.
// No fill, triangulation or old successful mesh is needed to inspect a broken join.
export function evaluateCurveProgram(project, object) {
  const stages = [];
  if (!usesCurvePipeline(object)) return { stages };
  const fillJoin =
    object.modifiers.find((m) => m.enabled && m.type === 'fill')?.joinMM ??
    0.001;
  let at = 'source';
  const append = (curves, stageId, name, joinMM = fillJoin) => {
    let junctions = [],
      diagnostic;
    try {
      junctions = curveGraph(curves, joinMM)
        .vertices.filter((v) => v.edges.length !== 2)
        .map((v) => ({ point: v.point, degree: v.edges.length }));
    } catch (e) {
      diagnostic = e.message;
    }
    stages.push({
      objectId: object.id,
      stageId,
      name,
      curves,
      junctions,
      ...(diagnostic ? { diagnostic } : {}),
    });
  };
  try {
    let curves = sourceCurves(project, object);
    append(curves, at, '源样条');
    for (const m of object.modifiers || []) {
      if (!m.enabled) continue;
      at = m.id;
      if (modifierStages[m.type]?.input !== 'curves') break;
      if (m.type === 'fill') {
        append(curves, m.id, `${m.name} · 输入曲线`, m.joinMM);
        break;
      }
      curves = transformCurves(curves, m);
      append(curves, m.id, m.name);
    }
    return { stages };
  } catch (e) {
    return { stages, error: { stageId: at, message: e.message } };
  }
}

export function fillCurves(curves, joinMM = 0.001, toleranceMM = 0.015) {
  const { vertices, edges } = curveGraph(curves, joinMM);
  const invalid = vertices.find((v) => v.edges.length !== 2);
  if (invalid)
    throw Error(
      `曲线尚未闭合或存在分叉：(${invalid.point.x.toFixed(3)}, ${invalid.point.y.toFixed(3)}) mm 有 ${invalid.edges.length} 条连接；请修复镜像/阵列或源端点`,
    );
  const visited = new Set(),
    polygons = [];
  for (let start = 0; start < edges.length; start++) {
    if (visited.has(start)) continue;
    let index = start,
      from = edges[start].a;
    const loop = [];
    while (!visited.has(index)) {
      visited.add(index);
      const edge = edges[index],
        forward = edge.a === from,
        to = forward ? edge.b : edge.a;
      const c = (forward ? edge.c : edge.c.slice().reverse()).map((p) => ({
        ...p,
      }));
      c[0] = { ...vertices[from].point };
      c[3] = { ...vertices[to].point };
      loop.push(c.map((p) => ({ x: p.x + 0.5, y: 0.5 - p.y })));
      const next = vertices[to].edges.find((i) => !visited.has(i));
      if (next === undefined) break;
      index = next;
      from = to;
    }
    const coordinates = samplePath(
      { width: 1, height: 1, widthMM: 1 },
      { curves: loop },
      toleranceMM,
    );
    coordinates[coordinates.length - 1] = coordinates[0].slice();
    const polygon = readGeometry({
      type: 'Polygon',
      coordinates: [coordinates],
    });
    if (!polygon.isValid() || polygon.getArea() < 1e-7)
      throw Error('闭合曲线存在自交或零面积，请修复源样条');
    if (polygons.some((p) => p.getBoundary().intersects(polygon.getBoundary())))
      throw Error('构面轮廓交叉或相切，请修复来源；内孔必须完全位于外环内');
    polygons.push(polygon);
  }
  if (!polygons.length) throw Error('没有可构面的闭合曲线');
  const geometry = polygons.reduce(
    (a, b) => (a ? a.symDifference(b) : b),
    null,
  );
  return { geometry, loopCount: polygons.length, segmentCount: edges.length };
}
