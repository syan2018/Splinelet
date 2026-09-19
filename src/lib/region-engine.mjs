import { contourSignatures } from './surface-lineage.mjs';
import { geometryContours } from './geometry-format.mjs';
export { geometryContours, regionSVGPath } from './geometry-format.mjs';
import 'jsts/org/locationtech/jts/monkey.js';
import GeoJSONReader from 'jsts/org/locationtech/jts/io/GeoJSONReader.js';
import GeoJSONWriter from 'jsts/org/locationtech/jts/io/GeoJSONWriter.js';
import UnaryUnionOp from 'jsts/org/locationtech/jts/operation/union/UnaryUnionOp.js';
import Polygonizer from 'jsts/org/locationtech/jts/operation/polygonize/Polygonizer.js';
import DistanceOp from 'jsts/org/locationtech/jts/operation/distance/DistanceOp.js';
import GeometryNoder from 'jsts/org/locationtech/jts/noding/snapround/GeometryNoder.js';
import PrecisionModel from 'jsts/org/locationtech/jts/geom/PrecisionModel.js';
import GeometryPrecisionReducer from 'jsts/org/locationtech/jts/precision/GeometryPrecisionReducer.js';
import ArrayList from 'jsts/java/util/ArrayList.js';
import { emptyModel } from './model-schema.mjs';
const reader = new GeoJSONReader(),
  writer = new GeoJSONWriter();
export const readGeometry = (g) => reader.read(g);
const line = (q) => reader.read({ type: 'LineString', coordinates: q });
const point = (q) => reader.read({ type: 'Point', coordinates: q });
const round = (v) => Math.round(v * 1e6) / 1e6;
const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const routeLength = (q) =>
  q.slice(1).reduce((n, p, i) => n + distance(q[i], p), 0);
function closestRingPoint(ring, p) {
  let best;
  for (let i = 0; i < ring.length - 1; i++) {
    const a = ring[i],
      b = ring[i + 1],
      dx = b[0] - a[0],
      dy = b[1] - a[1],
      length2 = dx * dx + dy * dy,
      t = length2
        ? Math.max(
            0,
            Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / length2),
          )
        : 0,
      q = [a[0] + dx * t, a[1] + dy * t],
      gap = distance(p, q);
    if (!best || gap < best.gapMM) best = { edge: i, t, point: q, gapMM: gap };
  }
  return best;
}
function forwardRingRoute(ring, from, to) {
  const q = [from.point];
  if (from.edge === to.edge && from.t <= to.t) q.push(to.point);
  else {
    let i = (from.edge + 1) % (ring.length - 1);
    while (true) {
      q.push(ring[i]);
      if (i === to.edge) break;
      i = (i + 1) % (ring.length - 1);
    }
    q.push(to.point);
  }
  return q;
}
function shortestRingRoute(ring, from, to) {
  const forward = forwardRingRoute(ring, from, to),
    backward = forwardRingRoute(ring, to, from).reverse();
  return routeLength(forward) <= routeLength(backward) ? forward : backward;
}
function flatten(c, tol, depth = 0) {
  const [a, b, d, e] = c,
    v = [e[0] - a[0], e[1] - a[1]],
    l = v[0] * v[0] + v[1] * v[1];
  const dist = (p) => {
    const t = l
      ? Math.max(
          0,
          Math.min(1, ((p[0] - a[0]) * v[0] + (p[1] - a[1]) * v[1]) / l),
        )
      : 0;
    return distance(p, [a[0] + t * v[0], a[1] + t * v[1]]);
  };
  if (Math.max(dist(b), dist(d)) <= tol || depth >= 22) return [a, e];
  const mid = (x, y) => [(x[0] + y[0]) / 2, (x[1] + y[1]) / 2];
  const ab = mid(a, b),
    bd = mid(b, d),
    de = mid(d, e),
    left = mid(ab, bd),
    right = mid(bd, de),
    m = mid(left, right);
  return [
    ...flatten([a, ab, left, m], tol, depth + 1).slice(0, -1),
    ...flatten([m, right, de, e], tol, depth + 1),
  ];
}
export function samplePath(
  project,
  path,
  toleranceMM = project.model?.toleranceMM || 0.015,
) {
  const scale = project.widthMM / project.width,
    coords = [];
  for (const c of path.curves) {
    const pts = flatten(
      c.map((p) => [
        (p.x - project.width / 2) * scale,
        (project.height / 2 - p.y) * scale,
      ]),
      toleranceMM,
    );
    if (coords.length && distance(coords.at(-1), pts[0]) > 1e-5)
      throw Error('源路径的相邻曲线存在断口，请先连接源节点');
    coords.push(...(coords.length ? pts.slice(1) : pts));
  }
  const unique = coords
    .map((p) => p.map(round))
    .filter((p, i, a) => !i || distance(p, a[i - 1]) > 1e-8);
  if (unique.length < 2) throw Error('路径至少需要两个不同的点');
  if (unique.length > 100000) throw Error('区域过于复杂，请减少路径或降低精度');
  return unique;
}
export function polygonParts(g) {
  if (g.getGeometryType() === 'Polygon') return g.isEmpty() ? [] : [g];
  const out = [];
  for (let i = 0; i < g.getNumGeometries(); i++) {
    const sub = g.getGeometryN(i);
    if (sub !== g) out.push(...polygonParts(sub));
  }
  return out;
}
function union(list) {
  if (!list.length) return reader.read({ type: 'Polygon', coordinates: [] });
  return UnaryUnionOp.union(
    reader.read({
      type: 'GeometryCollection',
      geometries: list.map((g) =>
        g.getGeometryType() === 'LinearRing'
          ? {
              type: 'LineString',
              coordinates: g.getCoordinates().map((p) => [p.x, p.y]),
            }
          : writer.write(g),
      ),
    }),
  );
}
// The source curves remain floating point, but planar graph construction needs
// one deterministic grid.  Snap-rounding also inserts a vertex on every
// intersection, preventing JSTS from later seeing a machine-epsilon edge as a
// non-noded crossing.  The 0.000000001 mm grid is far below the 0.015 mm
// curve sampling default, so it only resolves numerical noise in derived geometry.
const nodingPrecision = new PrecisionModel(1e9);
const nodingReducer = new GeometryPrecisionReducer(nodingPrecision);
nodingReducer.setPointwise(true);
nodingReducer.setChangePrecisionModel(true);
export function robustPolygonize(lines) {
  const inputs = new ArrayList();
  // Snap-rounding only rounds newly found intersections. Its input vertices
  // must already use the same grid, including vertices produced by earlier
  // clipping/boolean operations. Otherwise a junction can have two positions
  // differing by 1e-10 mm and fail the noding validator.
  for (const line of lines) {
    const rounded = nodingReducer.reduce(line);
    if (!rounded.isEmpty()) inputs.add(rounded);
  }
  if (!inputs.size()) return [];
  const noder = new GeometryNoder(nodingPrecision);
  noder.setValidate(true);
  const noded = noder.node(inputs);
  const dissolved = [];
  for (const it = noded.iterator(); it.hasNext();) dissolved.push(it.next());
  const p = new Polygonizer();
  // Dissolve identical noded edges (for example, a base boundary supplied
  // both as an input and as the final clipping boundary) only after all
  // crossings have been materialised on the fixed grid.
  p.add(union(dissolved));
  const out = [];
  for (const it = p.getPolygons().iterator(); it.hasNext();)
    out.push(it.next());
  return out;
}
function validateArea(g, repair = false, warnings = []) {
  if (!g.isValid()) {
    if (!repair)
      throw Error('边界存在自交或零宽相接，请检查来源，或启用“预览修复自交”');
    const before = g.getArea(),
      rings = geometryContours(writer.write(g));
    const inside = (p) => {
      let hit = false;
      for (const ring of rings)
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
          const a = ring[i],
            b = ring[j];
          if (
            a[1] > p.y !== b[1] > p.y &&
            p.x < ((b[0] - a[0]) * (p.y - a[1])) / (b[1] - a[1]) + a[0]
          )
            hit = !hit;
        }
      return hit;
    };
    g = union(
      robustPolygonize([g.getBoundary()]).filter((c) =>
        inside(c.getInteriorPoint().getCoordinate()),
      ),
    );
    if (!g.isValid()) g = g.buffer(0);
    warnings.push(
      `派生区域已修复自交（面积变化 ${Math.abs(g.getArea() - before).toFixed(4)} mm²），源样条保持原样`,
    );
  }
  if (g.isEmpty() || g.getArea() < 1e-7) throw Error('操作没有留下有效面积');
  return union(polygonParts(g));
}
export function describe(g) {
  const geometry = writer.write(g),
    parts = polygonParts(g),
    seed = g.getInteriorPoint().getCoordinate(),
    env = g.getEnvelopeInternal();
  return {
    geometry,
    areaMM2: g.getArea(),
    components: parts.length,
    holes: parts.reduce((n, p) => n + p.getNumInteriorRing(), 0),
    seed: [seed.x, seed.y],
    bounds: [env.getMinX(), env.getMinY(), env.getMaxX(), env.getMaxY()],
  };
}
export function regionContext(project) {
  const model = project.model || emptyModel(),
    cache = new Map(),
    visiting = new Set(),
    sampled = new Map(),
    splitCache = new Map();
  const source = (id) => {
    const p = project.paths.find((p) => p.id === id);
    if (!p) throw Error('来源样条已被删除，请重新指定来源');
    if (!sampled.has(id)) sampled.set(id, samplePath(project, p));
    return { p, coords: sampled.get(id) };
  };
  const calculate = (spec) => {
    if (
      spec.joinMM !== undefined &&
      (!Number.isFinite(spec.joinMM) || spec.joinMM < 0 || spec.joinMM > 5)
    )
      throw Error('接边距离必须在 0–5 mm');
    if (
      spec.kind === 'stroke' &&
      (!Number.isFinite(spec.widthMM) ||
        spec.widthMM < 0.01 ||
        spec.widthMM > 100)
    )
      throw Error('线宽必须在 0.01–100 mm');
    if (
      ['split', 'between'].includes(spec.kind) &&
      (!Array.isArray(spec.pathIds) ||
        !spec.pathIds.length ||
        spec.pathIds.length > 1000 ||
        spec.pathIds.some((id) => typeof id !== 'string'))
    )
      throw Error('请选择有效的来源路径列表');
    const warnings = [],
      connections = [];
    let g, cells;
    if (spec.kind === 'creation' && project.creationGeometries?.[spec.id]) {
      g = readGeometry(project.creationGeometries[spec.id]);
    } else if (spec.kind === 'path') {
      const { p, coords } = source(spec.pathId),
        q = coords.slice();
      if (!p.closed && !spec.close)
        throw Error('开放样条不能直接建面，请勾选“补齐首尾”并检查预览');
      const gap = distance(q[0], q.at(-1));
      if (gap > 1e-8) {
        q.push(q[0]);
        connections.push({ from: coords.at(-1), to: coords[0], gapMM: gap });
      }
      if (q.length < 4) throw Error('闭合边界至少需要三个不同的点');
      g = reader.read({ type: 'Polygon', coordinates: [q] });
    } else if (spec.kind === 'stroke') {
      if (!(spec.widthMM > 0)) throw Error('请输入大于 0 的线宽');
      g = line(source(spec.pathId).coords).buffer(spec.widthMM / 2, 8);
    } else if (spec.kind === 'between') {
      const a = source(spec.pathIds[0]).coords,
        b = source(spec.pathIds[1]).coords;
      if (spec.pathIds[0] === spec.pathIds[1])
        throw Error('请选择两条不同路径');
      const reverse =
        distance(a.at(-1), b.at(-1)) + distance(a[0], b[0]) <
        distance(a.at(-1), b[0]) + distance(a[0], b.at(-1));
      let q = [...a, ...(reverse ? b.slice().reverse() : b), a[0]];
      if (spec.boundaryRegionId) {
        const boundary = get(spec.boundaryRegionId),
          geometry = writer.write(boundary);
        if (geometry.type !== 'Polygon' || geometry.coordinates.length !== 1)
          throw Error('围面父边界必须是没有孔的单一闭合面');
        const ring = geometry.coordinates[0],
          joinMM = spec.boundaryJoinMM ?? spec.joinMM ?? 0,
          ends = [
            { from: a.at(-1), to: q[a.length] },
            { from: q.at(-2), to: a[0] },
          ].map(({ from, to }) => ({
            from,
            to,
            fromSnap: closestRingPoint(ring, from),
            toSnap: closestRingPoint(ring, to),
          }));
        for (const edge of ends)
          if (Math.max(edge.fromSnap.gapMM, edge.toSnap.gapMM) > joinMM)
            throw Error(
              `围面端点距父边界 ${Math.max(edge.fromSnap.gapMM, edge.toSnap.gapMM).toFixed(3)} mm，超过边界接合距离`,
            );
        const first = shortestRingRoute(ring, ends[0].fromSnap, ends[0].toSnap),
          second = shortestRingRoute(ring, ends[1].fromSnap, ends[1].toSnap);
        // Include both projected endpoints: the source end can be slightly
        // inside the parent ring, so skipping route[0] would reintroduce a
        // diagonal jump to the first ring vertex.
        q.splice(a.length, 0, ...first);
        q.splice(q.length - 1, 0, ...second);
        connections.push(
          ...ends.map((edge, index) => ({
            from: edge.from,
            to: edge.to,
            boundaryFrom: edge.fromSnap.point,
            boundaryTo: edge.toSnap.point,
            gapMM: Math.max(edge.fromSnap.gapMM, edge.toSnap.gapMM),
            boundaryArcMM: routeLength(index ? second : first),
            boundaryRegionId: spec.boundaryRegionId,
            coordinates: [edge.from, ...(index ? second : first), edge.to],
          })),
        );
      } else
        connections.push(
          {
            from: a.at(-1),
            to: q[a.length],
            gapMM: distance(a.at(-1), q[a.length]),
          },
          { from: q.at(-2), to: a[0], gapMM: distance(q.at(-2), a[0]) },
        );
      // Exact endpoint snaps deliberately appear in diagnostics, but a ring
      // cannot retain adjacent duplicates without becoming zero-width.
      q = q.filter((p, i) => !i || distance(p, q[i - 1]) > 1e-8);
      g = reader.read({ type: 'Polygon', coordinates: [q] });
    } else if (['union', 'difference', 'intersection'].includes(spec.kind)) {
      if (spec.a === spec.b) throw Error('目标和工具需要选择不同的面');
      const a = get(spec.a),
        b = get(spec.b);
      g =
        spec.kind === 'union'
          ? a.union(b)
          : spec.kind === 'difference'
            ? a.difference(b)
            : a.intersection(b);
    } else if (spec.kind === 'split') {
      const key = JSON.stringify([spec.baseId, spec.pathIds, spec.joinMM || 0]);
      if (splitCache.has(key)) return splitCache.get(key);
      const base = get(spec.baseId),
        bounds = base.getBoundary(),
        cutters = spec.pathIds.map((id) => {
          const s = source(id);
          if (s.p.closed)
            throw Error('切分工具请选择开放路径；闭合区域请用布尔操作');
          return s.coords;
        });
      const lines = [bounds];
      for (let i = 0; i < cutters.length; i++) {
        const q = cutters[i].slice(),
          targets = union([
            bounds,
            ...cutters.filter((_, j) => i !== j).map(line),
          ]);
        for (const end of [0, -1]) {
          const original = q.at(end),
            nearest = DistanceOp.nearestPoints(point(original), targets)[1],
            to = [nearest.x, nearest.y],
            gap = distance(original, to);
          if (gap > 1e-7 && gap <= (spec.joinMM || 0)) {
            // A tiny overrun ensures the new edge actually crosses the target.
            const extra = Math.min(
              0.005,
              Math.max(0.00001, (spec.joinMM || 0) / 100),
            );
            const beyond = to.map(
              (v, k) => v + ((v - original[k]) / gap) * extra,
            );
            if (end === 0) q.unshift(beyond);
            else q.push(beyond);
            connections.push({
              pathId: spec.pathIds[i],
              from: original,
              to,
              gapMM: gap,
            });
          } else if (gap > (spec.joinMM || 0))
            warnings.push(
              `「${source(spec.pathIds[i]).p.name}」端点距边界 ${gap.toFixed(3)} mm，超过接边距离`,
            );
        }
        lines.push(line(q));
      }
      cells = robustPolygonize(lines)
        .filter((p) => p.getArea() > 1e-7 && base.covers(p.getInteriorPoint()))
        .sort((a, b) => b.getArea() - a.getArea());
      const err = Math.abs(
        cells.reduce((n, p) => n + p.getArea(), 0) - base.getArea(),
      );
      if (err > Math.max(0.001, base.getArea() * 1e-7))
        throw Error('分区面积校验失败，请检查交叉和重合边');
      if (cells.length < 2)
        throw Error('没有形成新分区。请让切线连接到边界，或调整接边距离后重试');
      if (cells.some((c) => c.getArea() < 0.1))
        warnings.push('包含小于 0.1 mm² 的细碎区域，请放大检查后选择需要的面');
      const signatures = contourSignatures(
        cells,
        lines.map((geometry, i) => ({
          id: i ? 'cut:' + spec.pathIds[i - 1] : 'base',
          geometry,
        })),
      );
      const result = { cells, warnings, connections, signatures };
      splitCache.set(key, result);
      return result;
    } else throw Error('未知构面操作');
    g = validateArea(g, !!spec.repair, warnings);
    return { cells: [g], warnings, connections };
  };
  const get = (id) => {
    if (cache.has(id)) {
      const c = cache.get(id);
      if (c.error) throw Error(c.error);
      return c.g;
    }
    if (visiting.has(id)) throw Error('区域来源形成循环引用');
    const spec = model.regions.find((r) => r.id === id);
    if (!spec) throw Error('来源面已被删除');
    visiting.add(id);
    try {
      const result = calculate(spec);
      let g = result.cells[0];
      if (spec.kind === 'split') {
        if (result.cells.length !== spec.expectedCount)
          throw Error(
            `分区从 ${spec.expectedCount} 块变为 ${result.cells.length} 块，请重新选区`,
          );
        const seed = spec.seed.map(
          (v) =>
            v * (spec.seedWidthMM ? project.widthMM / spec.seedWidthMM : 1),
        );
        const hits = spec.contourSignature
          ? result.cells.filter(
              (_, i) => result.signatures[i] === spec.contourSignature,
            )
          : result.cells.filter((c) => c.contains(point(seed)));
        if (hits.length !== 1)
          throw Error(
            '分区输出的来源关系已失效，请修复分区线或重新选择输出；下游已暂停',
          );
        g = hits[0];
      }
      cache.set(id, {
        g,
        ...describe(g),
        warnings: result.warnings,
        ...(spec.kind === 'split'
          ? { contourSignature: result.signatures[result.cells.indexOf(g)] }
          : {}),
      });
      return g;
    } catch (e) {
      cache.set(id, { error: e.message || String(e) });
      throw e;
    } finally {
      visiting.delete(id);
    }
  };
  return { get, calculate, cache, model, source };
}
export function evaluateRegions(project) {
  const ctx = regionContext(project);
  return ctx.model.regions.map((r) => {
    try {
      ctx.get(r.id);
      const { g: _g, ...result } = ctx.cache.get(r.id);
      return { ...result, id: r.id, name: r.name, color: r.color };
    } catch (e) {
      return { id: r.id, name: r.name, color: r.color, error: e.message };
    }
  });
}
export function previewRegion(project, spec) {
  const result = regionContext(project).calculate(spec);
  return {
    candidates: result.cells.map((g, i) => ({
      ...describe(g),
      contourSignature: result.signatures?.[i],
    })),
    warnings: [...new Set(result.warnings)],
    connections: result.connections,
  };
}

// Boolean recipes intentionally return only their final geometry.  Creation
// needs provenance too: a `between` face contains two implicit straight
// closures, which are not editable source splines.  Keep this traversal
// read-only so legacy recipes remain authoritative.
export function regionClosureConnections(project, regionId) {
  const ctx = regionContext(project),
    seen = new Set(),
    closures = [];
  const visit = (id, boundaries = []) => {
    if (!id || seen.has(id)) return;
    seen.add(id);
    const spec = project.model?.regions.find((r) => r.id === id);
    if (!spec) return;
    if (spec.kind === 'between') {
      // A clipping operand is a possible closing contour, not an instruction
      // to snap to it. Expose the live distances so the caller can choose it.
      const boundaryOptions = [];
      for (const boundaryId of new Set(
        [spec.boundaryRegionId, ...boundaries].filter(Boolean),
      )) {
        try {
          const geometry = writer.write(ctx.get(boundaryId));
          if (geometry.type !== 'Polygon' || geometry.coordinates.length !== 1)
            continue;
          const ends = spec.pathIds.flatMap((pathId) => {
            const coords = samplePath(
              project,
              project.paths.find((p) => p.id === pathId),
            );
            return [coords[0], coords.at(-1)];
          });
          boundaryOptions.push({
            id: boundaryId,
            name:
              project.model.regions.find((r) => r.id === boundaryId)?.name ||
              boundaryId,
            gapMM: Math.max(
              ...ends.map(
                (end) => closestRingPoint(geometry.coordinates[0], end).gapMM,
              ),
            ),
          });
        } catch {
          /* An unavailable contour cannot be offered as a repair. */
        }
      }
      try {
        const result = ctx.calculate(spec);
        closures.push(
          ...result.connections.map((connection) => ({
            ...connection,
            kind: 'closure',
            regionId: id,
            pathIds: [...spec.pathIds],
            boundaryOptions,
          })),
        );
      } catch (error) {
        closures.push({
          kind: 'closure',
          regionId: id,
          pathIds: [...spec.pathIds],
          boundaryOptions,
          error: error.message,
        });
      }
    }
    visit(
      spec.a,
      spec.kind === 'intersection' ? [spec.b, ...boundaries] : boundaries,
    );
    visit(
      spec.b,
      spec.kind === 'intersection' ? [spec.a, ...boundaries] : boundaries,
    );
  };
  visit(regionId);
  return closures;
}
