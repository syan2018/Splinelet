import GeoJSONWriter from 'jsts/org/locationtech/jts/io/GeoJSONWriter.js';
import UnaryUnionOp from 'jsts/org/locationtech/jts/operation/union/UnaryUnionOp.js';
import DistanceOp from 'jsts/org/locationtech/jts/operation/distance/DistanceOp.js';
import {
  readGeometry,
  samplePath,
  describe,
  regionContext,
  evaluateRegions,
  regionClosureConnections,
  robustPolygonize,
} from './region-engine.mjs';
import {
  creationDocument,
  regionSources,
  creationTopologyKey,
  dividerGraphCohorts,
} from './creation-schema.mjs';
import { emptyModel } from './model-schema.mjs';
import { objectHoles, subtractHoles } from './creation-holes.mjs';
import { boundaryStyleMatches } from './creation-styles.mjs';
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
  if (!g.coordinates)
    return {
      ...g,
      geometries: g.geometries?.map((geometry) =>
        scaleGeometry(geometry, factor),
      ),
    };
  const coords = (a) =>
    typeof a[0] === 'number' ? a.map((v) => v * factor) : a.map(coords);
  return { ...g, coordinates: coords(g.coordinates) };
}
function candidates(
  project,
  o,
  joinMM = 0,
  legacyBases = [],
  holes = [],
  bandEdges = new Set(),
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
  base = subtractHoles(base, holes);
  if (base.isEmpty() || base.getArea() < 1e-7)
    return {
      cells: [],
      connections,
      diagnostics,
      hasPartitionRole,
      emptyByHoles: holes.length > 0,
    };
  lines.push(base.getBoundary());
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
    boundaryPathIds: cells.map((cell) =>
      boundaryAreas
        .filter(({ geometry }) => geometry.covers(cell.getInteriorPoint()))
        .map(({ id }) => id),
    ),
  };
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
    holeFeatureOverrides = {},
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
  for (const o of creation.objects) {
    const objectCellStart = cells.length;
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
      // Live recipe output is replaced only by successfully evaluated derived
      // cells. A failed construction reports an error instead of rendering a
      // saved paint footprint as though it were current geometry.
      if (!o.replacedFeatureIds?.includes(id)) cells.push(legacyCell);
    }
    legacyByObject.set(o.id, legacy);
    // A between recipe already owns these two edges. Reclassifying one of
    // them must not flatten every overlapping extrusion in the object into
    // a new paint graph. New, independent dividers still partition normally.
    const bandEdges = new Set(
      closures
        .filter(
          (c) =>
            c.objectId === o.id &&
            !c.disabled &&
            !c.error &&
            legacy.some((f) => f.featureId === c.featureId),
        )
        .flatMap((c) => c.pathIds),
    );
    for (const pathId of bandEdges) {
      if (o.roles[pathId] !== 'divider') continue;
      const closure = closures.find(
        (c) => c.objectId === o.id && c.pathIds.includes(pathId) && !c.disabled,
      );
      diagnostics.push({
        objectId: o.id,
        pathId,
        status: 'existing_boundary',
        featureId: closure.featureId,
        message: `这条线已是「${model.features.find((f) => f.id === closure.featureId)?.name || '带状面'}」的边界。封口在下方“构面封口”中调整。`,
      });
    }
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
      const holes = objectHoles(project, o),
        z = zFor(o),
        legacyPlanes = [...new Set(legacy.map((cell) => cell.bottomMM))],
        candidateBottom =
          !o.useObjectZ && !o.attachId && legacyPlanes.length === 1
            ? legacyPlanes[0]
            : z,
        automaticLegacyPartition =
          (project.paths.some(
            (path) =>
              o.pathIds.includes(path.id) &&
              path.curves.length &&
              o.roles[path.id] === 'divider' &&
              !bandEdges.has(path.id),
          ) ||
            o.legacyPartition === true) &&
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
          holes,
          bandEdges,
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
      if (
        automaticLegacyPartition &&
        (result.cells.length || result.emptyByHoles)
      ) {
        const legacyIds = new Set(
          legacyByObject.get(o.id).map((c) => c.featureId),
        );
        autoReplacedFeatureIds[o.id] = [...legacyIds];
        for (let index = cells.length - 1; index >= 0; index--)
          if (legacyIds.has(cells[index].featureId)) cells.splice(index, 1);
      } else if (automaticLegacyPartition && legacy.length)
        throw Error('当前构造没有生成有效区域，请检查边界与分割线');
      const key = creationTopologyKey(project, o);
      topologies[o.id] = {
        key,
        count: result.cells.length,
        legacyPartition: !!automaticLegacyPartition,
      };
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
      const sourceStyles = boundaryStyleMatches(
        result.boundaryPathIds || [],
        paints,
      );
      for (let i = 0; i < result.cells.length; i++) {
        const g = result.cells[i],
          data = describe(g),
          overlaps = sourceStyles.has(i)
            ? [{ p: sourceStyles.get(i), area: data.areaMM2 }]
            : stable
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
        const boundaryPathIds = result.boundaryPathIds?.[i] || [];
        cells.push({
          ...data,
          key,
          objectId: o.id,
          painted,
          swatchId,
          color: colors.get(swatchId),
          heightMM: inherited?.heightMM || o.heightMM,
          zMM: inherited?.bottomMM ?? candidateBottom,
          sourceIds: o.pathIds,
          boundaryPathIds,
          name:
            boundaryPathIds.length === 1
              ? project.paths.find((path) => path.id === boundaryPathIds[0])
                  ?.name
              : undefined,
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
        !result.emptyByHoles &&
        !cells.some((c) => c.objectId === o.id && !c.regionId && c.painted)
      )
        diagnostics.push({
          objectId: o.id,
          status: 'unmatched_style',
          message: '已保存的局部样式未匹配到当前区域；这些记录不生成面',
        });
      // Imported faces retain their own feature IDs, colours and heights. A
      // hole modifies each owned surface without converting/unioning them into
      // a new partition, which would couple independent local properties.
      const replacements = new Map(),
        overrides = {};
      for (const cell of cells.slice(objectCellStart)) {
        if (!holes.length || !cell.regionId) continue;
        const source = readGeometry(cell.geometry),
          cut = subtractHoles(source, holes);
        if (source.getArea() - cut.getArea() < 1e-7) continue;
        const data =
          cut.isEmpty() || cut.getArea() < 1e-7 ? null : describe(cut);
        replacements.set(cell.key, data ? { ...cell, ...data } : null);
        if (cell.featureId) overrides[cell.featureId] = data?.geometry || null;
      }
      for (let i = cells.length - 1; i >= objectCellStart; i--) {
        if (!replacements.has(cells[i].key)) continue;
        const replacement = replacements.get(cells[i].key);
        if (replacement) cells[i] = replacement;
        else cells.splice(i, 1);
      }
      Object.assign(holeFeatureOverrides, overrides);
    } catch (e) {
      // Neither partial results nor old paint footprints are current surfaces.
      // Keep the source paths and style records for correction/undo, but expose
      // no selectable/exportable geometry for this failed object.
      cells.splice(objectCellStart);
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
    holeFeatureOverrides,
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
    if (objects.get(e.objectId)?.printable)
      throw Error(
        '请先处理「' + objects.get(e.objectId).name + '」：' + e.message,
      );
  for (const o of scene.creation.objects)
    if (!o.printable)
      for (const f of p.model.features)
        if (o.featureIds.includes(f.id)) f.enabled = false;
  const removedSupport = (f, seen = new Set()) => {
    if (!f?.attachId || seen.has(f.id)) return false;
    seen.add(f.id);
    return (
      scene.holeFeatureOverrides[f.attachId] === null ||
      removedSupport(
        p.model.features.find((parent) => parent.id === f.attachId),
        seen,
      )
    );
  };
  for (const o of scene.creation.objects)
    for (const f of p.model.features) {
      if (
        o.replacedFeatureIds?.includes(f.id) ||
        o.disabledClosureFeatureIds?.includes(f.id) ||
        scene.autoReplacedFeatureIds[o.id]?.includes(f.id)
      )
        f.enabled = false;
      if ((o.useObjectZ || removedSupport(f)) && o.featureIds.includes(f.id)) {
        const c = scene.cells.find((c) => c.featureId === f.id);
        if (c) {
          f.zMM = c.bottomMM;
          delete f.attachId;
        }
      }
    }
  // Override only the extrusion's compiled input. Original recipes can also
  // feed other objects and must not be changed by a local object's hole.
  for (const [featureId, geometry] of Object.entries(
    scene.holeFeatureOverrides,
  )) {
    const f = p.model.features.find((f) => f.id === featureId);
    if (!f) continue;
    if (!geometry) {
      f.enabled = false;
      continue;
    }
    const id = 'creation-hole-' + featureId;
    p.creationGeometries[id] = geometry;
    p.model.regions.push({
      id,
      kind: 'creation',
      name: f.name,
      color: f.color,
    });
    f.regionId = id;
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
