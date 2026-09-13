// Creation metadata is additive: legacy source curves and model recipes retain IDs.
import {
  migrateModifiers,
  syncHoleModifiers,
  validateModifiers,
} from './modifier-schema.mjs';
import { validateSurfaceGraph } from './surface-lineage.mjs';
export const defaultSwatches = () => [
  { id: 'cream', name: '奶油白', color: '#f3ead7' },
  { id: 'brown', name: '灰棕', color: '#a59883' },
  { id: 'gold', name: '金色', color: '#d2b777' },
  { id: 'skin', name: '肤色', color: '#f3cbb5' },
  { id: 'red', name: '酒红', color: '#9c3043' },
  { id: 'ink', name: '深墨', color: '#292c35' },
];
export function regionSources(model, id, seen = new Set()) {
  if (seen.has(id)) return [];
  seen.add(id);
  const r = model?.regions.find((r) => r.id === id);
  if (!r) return [];
  return [
    ...new Set([
      ...(r.pathId ? [r.pathId] : []),
      ...(r.pathIds || []),
      ...[r.a, r.b, r.baseId, r.boundaryRegionId]
        .filter(Boolean)
        .flatMap((id) => regionSources(model, id, seen)),
    ]),
  ];
}
export function creationTopologyKey(project, o) {
  return JSON.stringify([
    o.baseRegionIds || [],
    o.basePathIds || [],
    o.clipRegionIds || [],
    o.joinMM || 0,
    Object.entries(o.connectionDisabled || {}).sort((a, b) =>
      a[0].localeCompare(b[0]),
    ),
    o.disabledClosureFeatureIds || [],
    project.paths
      .filter((p) => o.pathIds.includes(p.id) && p.curves.length)
      .map((p) => [
        p.id,
        o.roles[p.id] || (p.closed ? 'boundary' : 'guide'),
        p.closed,
      ])
      .filter((p) => p[1] !== 'guide')
      .sort((a, b) => a[0].localeCompare(b[0])),
  ]);
}
export function dividerIdsFromTopology(topologyKey) {
  try {
    const roles = JSON.parse(topologyKey).at(-1);
    if (Array.isArray(roles))
      return new Set(
        roles.filter(([id, role]) => role === 'divider').map(([id]) => id),
      );
  } catch {}
  return new Set();
}
export function dividerGraphCohorts(o) {
  if (Array.isArray(o.dividerGraphCohorts))
    return o.dividerGraphCohorts.map((ids) => new Set(ids));
  const ids = dividerIdsFromTopology(o.topologyKey);
  return ids.size ? [ids] : [];
}
// Freeze every divider currently present in an object before a caller adds a
// new path or changes another role.  A later divider is placed in a later
// cohort, so it can join earlier graphs without moving their endpoints.
export function acceptDividerGraph(o) {
  const cohorts = dividerGraphCohorts(o).map((ids) => [...ids]),
    known = new Set(cohorts.flat()),
    current = (o.pathIds || []).filter((id) => o.roles?.[id] === 'divider'),
    additions = current.filter((id) => !known.has(id));
  if (additions.length) cohorts.push(additions);
  if (cohorts.length) o.dividerGraphCohorts = cohorts;
  return cohorts;
}
export function creationDocument(project) {
  const c = structuredClone(
    project.creation || {
      version: 1,
      swatches: defaultSwatches(),
      objects: [],
    },
  );
  const livePaths = new Set(project.paths.map((p) => p.id));
  for (const o of c.objects) {
    o.pathIds = o.pathIds.filter((id) => livePaths.has(id));
    o.roles = Object.fromEntries(
      Object.entries(o.roles).filter(([id]) => o.pathIds.includes(id)),
    );
  }
  const assigned = new Set(c.objects.flatMap((o) => o.pathIds));
  // A saved divider operation may outlive its current source role. Ordinary
  // colour/height paints on a new boundary are never a construction operation.
  for (const o of c.objects)
    if (
      o.legacyPartition === undefined &&
      o.paints?.length &&
      o.featureIds?.length &&
      !o.replacedFeatureIds?.length &&
      dividerIdsFromTopology(o.topologyKey).size
    )
      o.legacyPartition = true;
  const add = (id, name, pathIds, groupId) => {
    let o = c.objects.find((o) => o.id === id);
    if (o) o.pathIds.push(...pathIds.filter((id) => !o.pathIds.includes(id)));
    else {
      o = {
        id,
        name,
        pathIds,
        groupId,
        roles: {},
        featureIds: [],
        regionIds: [],
        featureSwatches: {},
        swatchId: c.swatches[0].id,
        heightMM: 1,
        zMM: 0,
        visible: true,
        printable: true,
        paints: [],
      };
      c.objects.push(o);
    }
    return o;
  };
  for (const g of project.groups || []) {
    const ids = project.paths
      .filter((p) => p.groupId === g.id && !assigned.has(p.id))
      .map((p) => p.id);
    if (ids.length) add('object-group-' + g.id, g.name, ids, g.id);
  }
  for (const p of project.paths.filter(
    (p) => !p.groupId && !assigned.has(p.id),
  ))
    add('object-path-' + p.id, p.name, [p.id]);
  const ownedFeatures = new Set(
    c.objects.flatMap((o) => [
      ...o.featureIds,
      ...(o.replacedFeatureIds || []),
    ]),
  );
  const frequency = new Map();
  for (const f of project.model?.features || [])
    for (const id of regionSources(project.model, f.regionId))
      frequency.set(id, (frequency.get(id) || 0) + 1);
  for (const f of project.model?.features || []) {
    if (ownedFeatures.has(f.id)) continue;
    const r = project.model.regions.find((r) => r.id === f.regionId);
    // Direct cutters identify the semantic owner better than shared base outlines.
    const sources =
      r?.kind === 'split'
        ? r.pathIds
        : regionSources(project.model, f.regionId);
    let owner = c.objects
      .map((o) => ({
        o,
        n: sources
          .filter((id) => o.pathIds.includes(id))
          .reduce((n, id) => n + 1 / (frequency.get(id) || 1), 0),
      }))
      .sort((a, b) => b.n - a.n)[0];
    const o = owner?.n ? owner.o : add('object-feature-' + f.id, f.name, []);
    o.featureIds.push(f.id);
    if (o.featureIds.length === 1) {
      o.heightMM = f.heightMM;
      o.zMM = f.zMM;
    }
    // Existing model colours are art colours. Source label colours never become swatches.
    const swatchId = 'legacy-' + f.color.slice(1).toLowerCase();
    if (!c.swatches.some((s) => s.id === swatchId))
      c.swatches.push({
        id: swatchId,
        name: '原色 ' + (c.swatches.length - 5),
        color: f.color,
      });
    o.featureSwatches[f.id] = swatchId;
  }
  // Terminal faces without an extrusion also remain accessible in the same object.
  const inputs = new Set(
    (project.model?.regions || []).flatMap((r) =>
      [r.a, r.b, r.baseId, r.boundaryRegionId].filter(Boolean),
    ),
  );
  const ownedRegions = new Set(c.objects.flatMap((o) => o.regionIds || []));
  const featureRegions = new Set(
    (project.model?.features || []).map((f) => f.regionId),
  );
  for (const r of project.model?.regions || []) {
    if (inputs.has(r.id) || featureRegions.has(r.id) || ownedRegions.has(r.id))
      continue;
    const sources = regionSources(project.model, r.id);
    const owner = c.objects
      .map((o) => ({
        o,
        n: sources.filter((id) => o.pathIds.includes(id)).length,
      }))
      .sort((a, b) => b.n - a.n)[0];
    if (owner?.n) (owner.o.regionIds ||= []).push(r.id);
  }
  for (const object of c.objects) {
    migrateModifiers(project, object);
    syncHoleModifiers(project, object);
  }
  return c;
}
export function validateCreation(c) {
  if (
    !c ||
    c.version !== 1 ||
    !Array.isArray(c.objects) ||
    c.objects.length > 1000 ||
    !Array.isArray(c.swatches) ||
    !c.swatches.length ||
    c.swatches.length > 1000
  )
    throw Error('创作对象数据无效');
  const ids = new Set(),
    names = (v) => typeof v === 'string' && !!v.trim() && v.length <= 200;
  for (const s of c.swatches) {
    if (
      !names(s.id) ||
      ids.has(s.id) ||
      !names(s.name) ||
      !/^#[a-f0-9]{6}$/i.test(s.color)
    )
      throw Error('项目色卡无效');
    ids.add(s.id);
  }
  const objectIds = new Set(),
    pathIds = new Set(),
    featureIds = new Set();
  for (const o of c.objects) {
    validateModifiers(o, ids);
    validateSurfaceGraph(o.surfaceGraph, ids);
    if (
      !names(o.id) ||
      objectIds.has(o.id) ||
      !names(o.name) ||
      !ids.has(o.swatchId) ||
      !Array.isArray(o.pathIds) ||
      !Array.isArray(o.featureIds) ||
      !Array.isArray(o.regionIds) ||
      !o.roles ||
      typeof o.roles !== 'object' ||
      Array.isArray(o.roles) ||
      !o.featureSwatches ||
      typeof o.featureSwatches !== 'object' ||
      Array.isArray(o.featureSwatches) ||
      !Array.isArray(o.paints) ||
      o.paints.length > 2000 ||
      !Number.isFinite(o.heightMM) ||
      o.heightMM < 0.01 ||
      o.heightMM > 1000 ||
      !Number.isFinite(o.zMM) ||
      o.zMM < 0 ||
      o.zMM > 1000 ||
      typeof o.visible !== 'boolean' ||
      typeof o.printable !== 'boolean'
    )
      throw Error('创作对象属性无效');
    objectIds.add(o.id);
    for (const id of o.pathIds) {
      if (typeof id !== 'string' || pathIds.has(id))
        throw Error('线条不能同时属于两个创作对象');
      pathIds.add(id);
    }
    for (const id of o.featureIds) {
      if (typeof id !== 'string' || featureIds.has(id))
        throw Error('体块不能同时属于两个创作对象');
      featureIds.add(id);
    }
    for (const role of Object.values(o.roles || {}))
      if (!['boundary', 'divider', 'hole', 'guide'].includes(role))
        throw Error('线条用途无效');
    for (const key of [
      'baseRegionIds',
      'clipRegionIds',
      'basePathIds',
      'replacedFeatureIds',
      'disabledClosureFeatureIds',
      'regionIds',
    ])
      if (
        o[key] !== undefined &&
        (!Array.isArray(o[key]) ||
          o[key].length > 1000 ||
          o[key].some((id) => typeof id !== 'string'))
      )
        throw Error('创作来源引用无效');
    if (
      o.dividerGraphCohorts !== undefined &&
      (!Array.isArray(o.dividerGraphCohorts) ||
        o.dividerGraphCohorts.length > 1000 ||
        o.dividerGraphCohorts.some(
          (ids) =>
            !Array.isArray(ids) ||
            ids.length > 1000 ||
            ids.some((id) => typeof id !== 'string'),
        ))
    )
      throw Error('分割图分组无效');
    if (
      o.legacyPartition !== undefined &&
      typeof o.legacyPartition !== 'boolean'
    )
      throw Error('分区构造状态无效');
    if (
      o.offsetMM !== undefined &&
      (!Number.isFinite(o.offsetMM) || o.offsetMM < 0 || o.offsetMM > 20)
    )
      throw Error('底板边距无效');
    if (
      o.joinMM !== undefined &&
      (!Number.isFinite(o.joinMM) || o.joinMM < 0 || o.joinMM > 5)
    )
      throw Error('补边距离无效');
    if (
      o.connectionDisabled !== undefined &&
      (!o.connectionDisabled ||
        typeof o.connectionDisabled !== 'object' ||
        Array.isArray(o.connectionDisabled) ||
        Object.entries(o.connectionDisabled).some(
          ([key, value]) =>
            !/^[^:]+:[01]$/.test(key) || typeof value !== 'boolean',
        ))
    )
      throw Error('补边开关无效');
    for (const id of Object.values(o.featureSwatches || {}))
      if (!ids.has(id)) throw Error('局部区域的项目色不存在');
    for (const paint of o.paints) {
      if (
        paint.boundaryPathIds !== undefined &&
        (!Array.isArray(paint.boundaryPathIds) ||
          paint.boundaryPathIds.length > 1000 ||
          paint.boundaryPathIds.some((id) => typeof id !== 'string'))
      )
        throw Error('局部样式的边界引用无效');
      if (
        !names(paint.id) ||
        !ids.has(paint.swatchId) ||
        !Number.isFinite(paint.heightMM) ||
        paint.heightMM < 0.01 ||
        paint.heightMM > 1000 ||
        !paint.geometry ||
        !['Polygon', 'MultiPolygon'].includes(paint.geometry.type)
      )
        throw Error('局部填色无效');
      if (
        paint.zOffsetMM !== undefined &&
        (!Number.isFinite(paint.zOffsetMM) || Math.abs(paint.zOffsetMM) > 1000)
      )
        throw Error('局部填色高度偏移无效');
      let points = 0;
      const finiteCoords = (a) =>
        Array.isArray(a) &&
        a.length > 0 &&
        (typeof a[0] === 'number'
          ? ++points < 200000 &&
            a.length === 2 &&
            a.every((v) => Number.isFinite(v) && Math.abs(v) < 1e6)
          : a.every(finiteCoords));
      if (!finiteCoords(paint.geometry.coordinates))
        throw Error('填色范围无效');
    }
  }
  for (const o of c.objects)
    if (o.attachId && (!objectIds.has(o.attachId) || o.attachId === o.id))
      throw Error('高度基准对象无效');
  for (const o of c.objects) {
    const seen = new Set([o.id]);
    let id = o.attachId;
    while (id) {
      if (seen.has(id)) throw Error('高度依附不能形成循环');
      seen.add(id);
      id = c.objects.find((o) => o.id === id)?.attachId;
    }
  }
  return c;
}
