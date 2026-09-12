import GeoJSONWriter from 'jsts/org/locationtech/jts/io/GeoJSONWriter.js';
import Polygonizer from 'jsts/org/locationtech/jts/operation/polygonize/Polygonizer.js';
import UnaryUnionOp from 'jsts/org/locationtech/jts/operation/union/UnaryUnionOp.js';
import DistanceOp from 'jsts/org/locationtech/jts/operation/distance/DistanceOp.js';
import {
  readGeometry,
  samplePath,
  describe,
  regionContext,
  evaluateRegions,
  regionClosureConnections,
} from './region-engine.mjs';
import {
  creationDocument,
  regionSources,
  creationTopologyKey,
} from './creation-schema.mjs';
import { emptyModel } from './model-schema.mjs';
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
export function scaleGeometry(g, factor) {
  const coords = (a) =>
    typeof a[0] === 'number' ? a.map((v) => v * factor) : a.map(coords);
  return { ...g, coordinates: coords(g.coordinates) };
}
function candidates(project, o, joinMM = 0, legacyBases = []) {
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
  const hasPartitionRole = paths.some((p) => o.roles[p.id] === 'divider');
  const boundaries = paths.filter(
    (p) =>
      (o.roles[p.id] || (p.closed ? 'boundary' : 'guide')) === 'boundary' &&
      ((!legacyBases.length &&
        hasPartitionRole &&
        !o.replacedFeatureIds?.length) ||
        !used.has(p.id)),
  );
  const cutters = paths.filter((p) => o.roles[p.id] === 'divider');
  const holes = paths.filter((p) => o.roles[p.id] === 'hole');
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
  for (const p of holes) {
    if (!p.closed) continue;
    base = base.difference(
      ctx.calculate({ kind: 'path', pathId: p.id }).cells[0],
    );
  }
  lines.push(base.getBoundary());
  const open = cutters.map((p) => samplePath(project, p));
  for (let i = 0; i < open.length; i++) {
    const q = open[i].map((p) => p.slice()),
      targets = union([
        base.getBoundary(),
        ...open.filter((_, j) => i !== j).map(line),
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
  }
  const polygonizer = new Polygonizer();
  polygonizer.add(union(lines));
  const cells = [];
  for (const it = polygonizer.getPolygons().iterator(); it.hasNext();) {
    const g = it.next();
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
  return { cells, connections, diagnostics, hasPartitionRole };
}
export function evaluateCreation(project, options = {}) {
  const creation = creationDocument(project),
    model = project.model || emptyModel(),
    regions = evaluateRegions(project),
    cells = [],
    errors = [],
    connections = [],
    closures = [],
    diagnostics = [],
    autoReplacedFeatureIds = {},
    topologies = {};
  const colors = new Map(creation.swatches.map((s) => [s.id, s.color]));
  const legacyZ = new Map();
  function featureBottom(f, seen = new Set()) {
    if (legacyZ.has(f.id)) return legacyZ.get(f.id);
    if (seen.has(f.id)) throw Error('高度依附形成循环');
    seen.add(f.id);
    const parent = model.features.find((p) => p.id === f.attachId);
    const bottom =
      f.zMM + (parent ? featureBottom(parent, seen) + parent.heightMM : 0);
    legacyZ.set(f.id, bottom);
    return bottom;
  }
  const heights = new Map(),
    visiting = new Set();
  function zFor(o) {
    if (heights.has(o.id)) return heights.get(o.id);
    if (visiting.has(o.id)) throw Error('对象高度依附形成循环');
    visiting.add(o.id);
    const parent = creation.objects.find((p) => p.id === o.attachId);
    const z =
      o.zMM +
      (parent
        ? zFor(parent) +
          Math.max(parent.heightMM, ...parent.paints.map((p) => p.heightMM))
        : 0);
    heights.set(o.id, z);
    visiting.delete(o.id);
    return z;
  }
  const legacyByObject = new Map();
  const hasPartitionRole = (o) =>
    o.pathIds.some((id) => o.roles[id] === 'divider');
  for (const o of creation.objects) {
    const legacy = [];
    for (const id of o.featureIds) {
      const f = model.features.find((f) => f.id === id);
      if (!f || !f.enabled) continue;
      const closureDisabled = !!o.disabledClosureFeatureIds?.includes(f.id);
      const featureClosures = regionClosureConnections(project, f.regionId).map(
        (closure) => ({
          ...closure,
          objectId: o.id,
          featureId: f.id,
          disabled: closureDisabled,
        }),
      );
      closures.push(...featureClosures);
      for (const closure of featureClosures)
        if (closure.error)
          errors.push({ objectId: o.id, id: f.id, message: closure.error });
      if (closureDisabled) continue;
      const r = regions.find((r) => r.id === f.regionId);
      if (r?.error) {
        errors.push({ objectId: o.id, id, message: r.error });
        continue;
      }
      if (!r) continue;
      let bottomMM = f.zMM;
      try {
        bottomMM = o.useObjectZ ? zFor(o) : featureBottom(f);
      } catch (e) {
        errors.push({ objectId: o.id, id, message: e.message });
      }
      const legacyCell = {
        ...r,
        key: 'feature:' + id,
        objectId: o.id,
        featureId: id,
        regionId: f.regionId,
        painted: true,
        swatchId: o.featureSwatches[id],
        color: colors.get(o.featureSwatches[id]) || f.color,
        heightMM: f.heightMM,
        zMM: f.zMM,
        bottomMM,
        mode: f.mode,
        enabled: f.enabled,
      };
      legacy.push(legacyCell);
      // Keep legacy output until a role-triggered candidate successfully
      // evaluates.  A malformed divider must never make old art disappear.
      if (!o.replacedFeatureIds?.includes(id)) cells.push(legacyCell);
    }
    legacyByObject.set(o.id, legacy);
    for (const id of o.regionIds || []) {
      if (model.features.some((f) => f.regionId === id)) continue;
      const r = regions.find((r) => r.id === id);
      if (r?.geometry)
        cells.push({
          ...r,
          key: 'region:' + id,
          flatOnly: true,
          objectId: o.id,
          regionId: id,
          painted: true,
          swatchId: o.swatchId,
          color: r.color,
          heightMM: o.heightMM,
          zMM: o.zMM,
        });
      else if (r?.error) errors.push({ objectId: o.id, id, message: r.error });
    }
    try {
      const z = zFor(o),
        automaticLegacyPartition =
          (hasPartitionRole(o) ||
            (o.paints.length && legacyByObject.get(o.id).length)) &&
          !o.replacedFeatureIds?.length,
        result = candidates(
          project,
          o,
          options.objectId === o.id
            ? (options.joinMM ?? o.joinMM ?? 0)
            : o.joinMM || 0,
          automaticLegacyPartition
            ? legacyByObject
                .get(o.id)
                .map((cell) => readGeometry(cell.geometry))
            : [],
        );
      diagnostics.push(
        ...result.diagnostics.map((d) => ({ ...d, objectId: o.id })),
      );
      connections.push(
        ...result.connections.map((c) => ({ ...c, objectId: o.id })),
      );
      // Explicit conversion already stored paints.  Legacy role activation has
      // none, so derive temporary inheritance from the old feature surfaces.
      const implicitPaints =
        result.hasPartitionRole &&
        !o.paints.length &&
        !o.replacedFeatureIds?.length
          ? legacyByObject.get(o.id).map((cell) => ({
              id: `legacy:${cell.featureId}`,
              geometry: cell.geometry,
              swatchId: cell.swatchId,
              heightMM: cell.heightMM,
              bottomMM: cell.bottomMM,
            }))
          : [];
      const paints = o.paints.map((p) => ({
        ...p,
        bottomMM: z + (p.zOffsetMM || 0),
        g: readGeometry(scaleGeometry(p.geometry, project.widthMM)),
      }));
      // Legacy region descriptions are already in millimetres; persisted
      // creation paints are normalized.  Do not apply project scale twice.
      paints.push(
        ...implicitPaints.map((p) => ({ ...p, g: readGeometry(p.geometry) })),
      );
      if (automaticLegacyPartition && result.cells.length) {
        const legacyIds = new Set(
          legacyByObject.get(o.id).map((c) => c.featureId),
        );
        autoReplacedFeatureIds[o.id] = [...legacyIds];
        for (let index = cells.length - 1; index >= 0; index--)
          if (legacyIds.has(cells[index].featureId)) cells.splice(index, 1);
      } else if (automaticLegacyPartition) {
        diagnostics.push({
          objectId: o.id,
          status: 'legacy_fallback',
          message: '分割线无法形成有效分区，已保留原有构面',
        });
      }
      const key = creationTopologyKey(project, o);
      topologies[o.id] = { key, count: result.cells.length };
      let stable = null;
      if (
        o.topologyKey === key &&
        o.topologyCount === result.cells.length &&
        paints.length
      ) {
        stable = new Map();
        for (const paint of paints) {
          const scores = result.cells
            .map((g, index) => ({
              index,
              area: g.intersection(paint.g).getArea(),
            }))
            .sort((a, b) => b.area - a.area);
          if (
            !scores[0] ||
            scores[0].area < 1e-7 ||
            stable.has(scores[0].index) ||
            (scores[1]?.area || 0) > scores[0].area * 0.9
          ) {
            stable = null;
            break;
          }
          stable.set(scores[0].index, paint);
        }
      }
      for (let i = 0; i < result.cells.length; i++) {
        const g = result.cells[i],
          data = describe(g),
          overlaps = stable
            ? stable.has(i)
              ? [{ p: stable.get(i), area: data.areaMM2 }]
              : []
            : paints
                .map((p) => ({ p, area: g.intersection(p.g).getArea() }))
                .filter((h) => h.area > 1e-7);
        overlaps.sort((a, b) => b.area - a.area);
        const signatures = new Set(
          overlaps.map(
            (h) =>
              h.p.swatchId + ':' + h.p.heightMM + ':' + (h.p.bottomMM ?? z),
          ),
        );
        // Splits inherit. Different styles merging require a local explicit resolution.
        const conflict = signatures.size > 1;
        const inherited = overlaps[0]?.p,
          painted = !!inherited || !!o.fillAll,
          swatchId = inherited?.swatchId || o.swatchId;
        const key = o.id + ':cell:' + i;
        cells.push({
          ...data,
          key,
          objectId: o.id,
          painted,
          swatchId,
          color: colors.get(swatchId),
          heightMM: inherited?.heightMM || o.heightMM,
          zMM: inherited?.bottomMM ?? z,
          sourceIds: o.pathIds,
          conflict,
          choices: [...new Set(overlaps.map((h) => h.p.swatchId))],
          conflictPaints: conflict
            ? overlaps.map((h) => ({
                id: h.p.id,
                swatchId: h.p.swatchId,
                heightMM: h.p.heightMM,
                zOffsetMM: (h.p.bottomMM ?? z) - z,
                geometry: scaleGeometry(
                  describe(g.intersection(h.p.g)).geometry,
                  1 / project.widthMM,
                ),
              }))
            : [],
          normalizedGeometry: scaleGeometry(data.geometry, 1 / project.widthMM),
        });
      }
      if (
        paints.length &&
        !cells.some((c) => c.objectId === o.id && !c.regionId && c.painted)
      )
        errors.push({
          objectId: o.id,
          message: '原来的填色已无法对应到当前轮廓，请选中新的区域重新填色',
        });
    } catch (e) {
      errors.push({ objectId: o.id, message: e.message });
    }
  }
  return {
    creation,
    cells,
    errors,
    connections,
    closures,
    diagnostics,
    autoReplacedFeatureIds,
    topologies,
  };
}
export function compileCreation(project) {
  if (!project.creation) return project;
  const scene = evaluateCreation(project),
    p = { ...project, model: structuredClone(project.model || emptyModel()) };
  p.creationGeometries = {};
  const objects = new Map(scene.creation.objects.map((o) => [o.id, o]));
  for (const e of scene.errors)
    if (
      objects.get(e.objectId)?.printable &&
      objects.get(e.objectId)?.paints.length
    )
      throw Error(
        '请先处理「' + objects.get(e.objectId).name + '」：' + e.message,
      );
  for (const o of scene.creation.objects)
    if (!o.printable)
      for (const f of p.model.features)
        if (o.featureIds.includes(f.id)) f.enabled = false;
  for (const o of scene.creation.objects)
    for (const f of p.model.features) {
      if (
        o.replacedFeatureIds?.includes(f.id) ||
        o.disabledClosureFeatureIds?.includes(f.id) ||
        scene.autoReplacedFeatureIds[o.id]?.includes(f.id)
      )
        f.enabled = false;
      if (o.useObjectZ && o.featureIds.includes(f.id)) {
        const c = scene.cells.find((c) => c.featureId === f.id);
        if (c) {
          f.zMM = c.bottomMM;
          delete f.attachId;
        }
      }
    }
  for (const c of scene.cells.filter(
    (c) => !c.featureId && !c.regionId && c.painted,
  )) {
    const o = objects.get(c.objectId);
    if (!o.printable) continue;
    if (c.conflict)
      throw Error(
        '「' +
          o.name +
          '」有合并后的颜色 / 高度冲突，请点击标记区域选择保留的样式',
      );
    const id = 'creation-' + c.key;
    p.creationGeometries[id] = c.geometry;
    p.model.regions.push({
      id,
      name: o.name,
      kind: 'creation',
      color: c.color,
    });
    p.model.features.push({
      id: id + '-body',
      name: o.name,
      regionId: id,
      partId: o.partId || p.model.parts[0].id,
      mode: 'add',
      zMM: c.zMM,
      heightMM: c.heightMM,
      color: c.color,
      enabled: true,
    });
  }
  return p;
}
export function previewCreationBase(project, args) {
  const p = structuredClone(project);
  p.version = 3;
  p.creation = creationDocument(p);
  const objects = p.creation.objects.filter((o) =>
    args.objectIds.includes(o.id),
  );
  if (!objects.length) throw Error('先选择需要底板的部件');
  const offsetMM = args.offsetMM ?? 1,
    heightMM = args.heightMM ?? 2;
  if (
    !Number.isFinite(offsetMM) ||
    offsetMM < 0 ||
    offsetMM > 20 ||
    !Number.isFinite(heightMM) ||
    heightMM < 0.1 ||
    heightMM > 1000
  )
    throw Error('底板边距或厚度无效');
  const id = crypto.randomUUID(),
    model = p.model || emptyModel();
  const baseRegionIds = [
    ...new Set(
      objects
        .flatMap((o) => [
          ...(o.baseRegionIds || []),
          ...o.featureIds.map(
            (id) => model.features.find((f) => f.id === id)?.regionId,
          ),
          ...(o.regionIds || []),
        ])
        .filter(Boolean),
    ),
  ];
  const basePathIds = [
    ...new Set(
      objects.flatMap((o) => [
        ...(o.basePathIds || []),
        ...o.pathIds.filter((id) =>
          p.paths.some((p) => p.id === id && p.closed),
        ),
      ]),
    ),
  ];
  if (!baseRegionIds.length && !basePathIds.length)
    throw Error('所选部件尚未形成闭合轮廓');
  const o = {
    id,
    name: '底板',
    pathIds: [],
    roles: {},
    featureIds: [],
    regionIds: [],
    featureSwatches: {},
    swatchId: args.swatchId || p.creation.swatches[0].id,
    heightMM,
    zMM: 0,
    visible: true,
    printable: true,
    paints: [],
    baseRegionIds,
    basePathIds,
    offsetMM,
    fillAll: true,
  };
  p.creation.objects.unshift(o);
  let scene = evaluateCreation(p),
    cells = scene.cells.filter((c) => c.objectId === id);
  if (!cells.length)
    throw Error(
      scene.errors.find((e) => e.objectId === id)?.message ||
        '底板没有有效面积',
    );
  o.paints = cells.map((c) => ({
    id: crypto.randomUUID(),
    geometry: c.normalizedGeometry,
    swatchId: o.swatchId,
    heightMM,
  }));
  if (args.stack !== false)
    for (const object of objects) {
      object.attachId = id;
      object.zMM = 0;
      object.useObjectZ = true;
    }
  scene = evaluateCreation(p);
  return { project: p, scene, objectId: id };
}
