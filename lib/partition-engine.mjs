import GeoJSONWriter from 'jsts/org/locationtech/jts/io/GeoJSONWriter.js';
import UnaryUnionOp from 'jsts/org/locationtech/jts/operation/union/UnaryUnionOp.js';
import DistanceOp from 'jsts/org/locationtech/jts/operation/distance/DistanceOp.js';
import {
  readGeometry,
  samplePath,
  regionContext,
  robustPolygonize,
} from './region-engine.mjs';
import { regionSources, dividerGraphCohorts } from './creation-schema.mjs';
import { contourSignatures } from './surface-lineage.mjs';
const writer = new GeoJSONWriter();
const line = (coordinates) => readGeometry({ type: 'LineString', coordinates });
const point = (coordinates) => readGeometry({ type: 'Point', coordinates });
const union = (list) =>
  UnaryUnionOp.union(
    readGeometry({
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
export function evaluatePartition(
  project,
  o,
  joinMM = 0,
  legacyBases = [],
  bandEdges = new Set(),
  legacyKeys = [],
) {
  const paths = project.paths.filter(
    (p) => o.pathIds.includes(p.id) && p.curves.length,
  );
  const used = new Set(
    [
      ...(project.model?.features || []).map((f) => f.id),
      ...(o.regionIds || []),
    ].flatMap((id) => {
      const f = project.model?.features.find((f) => f.id === id);
      return regionSources(project.model, f?.regionId || id);
    }),
  );
  // Imported recipes stay authoritative. Newly drawn boundaries can be added alongside them.
  // Dividers also partition imported feature surfaces. New source boundaries
  // can coexist with these bases without substituting un-clipped old paths.
  const hasPartitionRole = paths.some(
    (p) => o.roles[p.id] === 'divider' && !bandEdges.has(p.id),
  );
  const boundaries = paths.filter(
    (p) =>
      (o.roles[p.id] || (p.closed ? 'boundary' : 'guide')) === 'boundary' &&
      ((!legacyBases.length &&
        hasPartitionRole &&
        !o.replacedFeatureIds?.length) ||
        !used.has(p.id)),
  );
  const cutters = paths.filter(
    (p) => o.roles[p.id] === 'divider' && !bandEdges.has(p.id),
  );
  // Persisted paints describe an already accepted divider graph.  When a new
  // divider is added, its endpoints may attach to that graph, but the old
  // dividers must keep choosing among their original targets.  Otherwise a
  // new endpoint can pull an old endpoint away from the base boundary and
  // merge two previously painted regions.
  const dividerCohorts = dividerGraphCohorts(o),
    cohortFor = new Map();
  for (let index = 0; index < dividerCohorts.length; index++)
    for (const id of dividerCohorts[index]) cohortFor.set(id, index);
  if (
    !legacyBases.length &&
    !boundaries.length &&
    !o.baseRegionIds?.length &&
    !o.basePathIds?.length
  )
    return {
      cells: [],
      connections: [],
      diagnostics: cutters.length
        ? [{ status: 'no_base', message: '分割线没有可用的闭合边界' }]
        : [],
      hasPartitionRole,
    };
  const ctx = regionContext(project),
    lines = [],
    areas = [],
    boundaryAreas = [],
    connections = [],
    diagnostics = [];
  for (const g of legacyBases) {
    areas.push(g);
    lines.push(g.getBoundary());
  }
  for (const id of o.baseRegionIds || []) {
    const g = ctx.get(id);
    areas.push(g);
    lines.push(g.getBoundary());
  }
  for (const id of o.basePathIds || []) {
    const g = ctx.calculate({ kind: 'path', pathId: id }).cells[0];
    areas.push(g);
    lines.push(g.getBoundary());
  }
  for (const p of boundaries) {
    if (!p.closed) continue;
    const g = ctx.calculate({ kind: 'path', pathId: p.id }).cells[0];
    boundaryAreas.push({ id: p.id, geometry: g });
    areas.push(g);
    lines.push(g.getBoundary());
  }
  if (!areas.length)
    return { cells: [], connections: [], diagnostics, hasPartitionRole };
  let base = union(areas);
  for (const id of o.clipRegionIds || []) base = base.intersection(ctx.get(id));
  if (o.offsetMM) {
    base = base.buffer(o.offsetMM, 12);
    lines.length = 0;
  }
  if (base.isEmpty() || base.getArea() < 1e-7)
    return {
      cells: [],
      connections,
      diagnostics,
      hasPartitionRole,
    };
  lines.push(base.getBoundary());
  const provenance = [{ id: 'base', geometry: base.getBoundary() }];
  // Keep source names on the arrangement edges; output identity does not depend on area or list order.
  legacyBases.forEach((g, i) =>
    provenance.push({
      id: 'source:' + (legacyKeys[i] || o.featureIds[i]),
      geometry: g.getBoundary(),
    }),
  );
  boundaryAreas.forEach(({ id, geometry }) =>
    provenance.push({ id: 'path:' + id, geometry: geometry.getBoundary() }),
  );
  for (const id of o.baseRegionIds || [])
    provenance.push({
      id: 'region:' + id,
      geometry: ctx.get(id).getBoundary(),
    });
  for (const id of o.basePathIds || [])
    provenance.push({
      id: 'path:' + id,
      geometry: ctx
        .calculate({ kind: 'path', pathId: id })
        .cells[0].getBoundary(),
    });
  const open = cutters.map((p) => samplePath(project, p));
  for (let i = 0; i < open.length; i++) {
    const q = open[i].map((p) => p.slice()),
      targets = union([
        base.getBoundary(),
        ...open
          .filter(
            (_, j) =>
              i !== j &&
              (cohortFor.get(cutters[j].id) ?? Infinity) <=
                (cohortFor.get(cutters[i].id) ?? Infinity),
          )
          .map(line),
      ]);
    for (const end of [0, -1]) {
      const from = q.at(end),
        nearest = DistanceOp.nearestPoints(point(from), targets)[1],
        to = [nearest.x, nearest.y],
        gap = Math.hypot(from[0] - to[0], from[1] - to[1]);
      const endpoint = end === 0 ? 0 : 1,
        key = `${cutters[i].id}:${endpoint}`,
        disabled = !!o.connectionDisabled?.[key];
      if (gap > 1e-7 && gap <= joinMM && !disabled) {
        connections.push({
          pathId: cutters[i].id,
          endpoint,
          from,
          to,
          gapMM: gap,
        });
        diagnostics.push({
          pathId: cutters[i].id,
          endpoint,
          status: 'connected',
          from,
          to,
          gapMM: gap,
        });
        const extra = Math.min(0.005, joinMM / 100),
          extended = to.map((v, k) => v + ((to[k] - from[k]) / gap) * extra);
        if (end === 0) q.unshift(extended);
        else q.push(extended);
      } else if (gap > 1e-7) {
        diagnostics.push({
          pathId: cutters[i].id,
          endpoint,
          status: disabled ? 'disabled' : 'unconnected',
          from,
          to,
          gapMM: gap,
          joinMM,
        });
      }
    }
    lines.push(line(q));
    provenance.push({ id: 'cut:' + cutters[i].id, geometry: line(q) });
  }
  const cells = [];
  for (const g of robustPolygonize(lines)) {
    if (base.covers(g.getInteriorPoint()) && g.getArea() > 1e-7) cells.push(g);
  }
  cells.sort(
    (a, b) =>
      a.getInteriorPoint().getX() - b.getInteriorPoint().getX() ||
      a.getInteriorPoint().getY() - b.getInteriorPoint().getY(),
  );
  if (cutters.length && cells.length < 2)
    diagnostics.push({
      status: 'no_partition',
      message: '分割线未连接到边界，未形成分区',
    });
  return {
    cells,
    connections,
    diagnostics,
    hasPartitionRole,
    signatures: contourSignatures(cells, provenance),
    boundaryPathIds: cells.map((cell) =>
      boundaryAreas
        .filter(({ geometry }) => geometry.covers(cell.getInteriorPoint()))
        .map(({ id }) => id),
    ),
  };
}
