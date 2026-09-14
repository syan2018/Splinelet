import { resolveSurfaceGraph, pipelineError } from './surface-lineage.mjs';
import { evaluatePartition } from './partition-engine.mjs';
import {
  readGeometry,
  describe,
  regionContext,
  evaluateRegions,
  regionClosureConnections,
} from './region-engine.mjs';
import { creationDocument, creationTopologyKey } from './creation-schema.mjs';
import { emptyModel } from './model-schema.mjs';
import { matchCreationStyles } from './creation-styles.mjs';
import {
  printEvaluationProject,
  printCount,
  printMM,
  requestedPrintCount,
  syncPrintDimensions,
} from './print-stack.mjs';
import {
  evaluateSourceProgram,
  applyObjectModifiers,
} from './modifier-engine.mjs';
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
function evaluateCreationBase(project, options = {}) {
  const creation = creationDocument(project),
    model = project.model || emptyModel(),
    regions = evaluateRegions(project),
    sourceContext = regionContext(project),
    cells = [],
    errors = [],
    connections = [],
    closures = [],
    diagnostics = [],
    autoReplacedFeatureIds = {},
    featureGeometryOverrides = {},
    topologies = {},
    surfaceGraphs = {},
    surfaceGraphCandidates = {},
    pipelineStatus = [],
    sourceTrace = { statuses: [], contracts: {} };
  const colors = new Map(creation.swatches.map((s) => [s.id, s.color]));
  const legacyZ = new Map();
  function featureBottom(f, seen = new Set()) {
    if (legacyZ.has(f.id)) return legacyZ.get(f.id);
    if (seen.has(f.id)) throw Error('高度依附形成循环');
    seen.add(f.id);
    const parent = model.features.find((p) => p.id === f.attachId);
    if (f.attachId && (!parent || !parent.enabled))
      throw Error('依附体块已删除或停用，请修复高度来源');
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
          Math.max(
            parent.heightMM,
            ...parent.paints.map((p) => p.heightMM),
            ...(parent.surfaceGraph?.outputs || []).map(
              (o) => o.style?.heightMM || 0,
            ),
          )
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
      let r = regions.find((r) => r.id === f.regionId);
      if (o.sources?.[f.id]) {
        try {
          const geometry = evaluateSourceProgram(
            project,
            f,
            o,
            sourceContext,
            sourceTrace,
          );
          if (geometry.isEmpty() || geometry.getArea() < 1e-7) {
            featureGeometryOverrides[f.id] = null;
            continue;
          }
          r = { ...r, ...describe(geometry), error: undefined };
        } catch (e) {
          errors.push({
            objectId: o.id,
            id: f.id,
            kind: 'modifier',
            ...e.pipeline,
            sourceFeatureId: f.id,
            message: e.message,
          });
          continue;
        }
      }
      if (r?.error) {
        errors.push({
          objectId: o.id,
          id,
          kind: 'pipeline',
          stage: 'source',
          state: 'blocked',
          pathIds: o.pathIds,
          message: r.error,
        });
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
    // Role shortcuts compile to the same editable modifier stack. They must
    // never participate a second time in the legacy arrangement stage.
    for (const modifier of o.modifiers || [])
      if (modifier.type === 'split' && modifier.rolePathId)
        bandEdges.add(modifier.rolePathId);
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
        result = evaluatePartition(
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
          bandEdges,
          legacyByObject.get(o.id).map((cell) => cell.featureId),
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
        !o.surfaceGraph &&
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
      } else if (automaticLegacyPartition && legacy.length)
        throw Error('当前构造没有生成有效区域，请检查边界与分割线');
      const key = creationTopologyKey(project, o);
      topologies[o.id] = {
        key,
        count: result.cells.length,
        legacyPartition: !!automaticLegacyPartition,
      };
      const signatures = result.signatures || [];
      let graph;
      try {
        if (o.surfaceGraph) graph = resolveSurfaceGraph(o, signatures);
        else {
          // Compatibility only: resolve old footprint records once, then bind
          // styles to named contour outputs. Never repeat after source edits.
          const imported = matchCreationStyles(
            result.cells,
            result.boundaryPathIds || [],
            paints,
            o.topologyKey === key && o.topologyCount === result.cells.length,
          );
          const styles = imported.map((overlaps) => {
            const distinct = new Set(
              overlaps.map((h) =>
                [h.p.swatchId, h.p.heightMM, h.p.bottomMM ?? z].join(':'),
              ),
            );
            if (distinct.size > 1)
              throw pipelineError(
                'appearance',
                '旧工程的区域样式归属不唯一。请确认重建分区输出，再给新区域设置颜色与厚度',
              );
            const paint = overlaps[0]?.p;
            return paint
              ? {
                  swatchId: paint.swatchId,
                  heightMM: paint.heightMM,
                  zOffsetMM: (paint.bottomMM ?? z) - z,
                }
              : undefined;
          });
          if (
            paints.length &&
            result.cells.length &&
            !imported.some((h) => h.length)
          )
            throw pipelineError(
              'appearance',
              '旧工程的样式找不到来源轮廓，请修复或重建分区输出',
            );
          graph = resolveSurfaceGraph(o, signatures, styles);
        }
      } catch (error) {
        if (error.pipeline) {
          surfaceGraphCandidates[o.id] = resolveSurfaceGraph(
            {
              ...o,
              surfaceGraph: {
                version: 1,
                outputs: (o.surfaceGraph?.outputs || []).filter((output) =>
                  signatures.includes(output.signature),
                ),
              },
            },
            signatures,
          );
          error.pipeline.pathIds = o.pathIds.filter(
            (id) => o.roles[id] === 'divider',
          );
        }
        throw error;
      }
      surfaceGraphs[o.id] = graph;
      pipelineStatus.push({
        objectId: o.id,
        stage: 'partition',
        state: 'ready',
        outputs: graph.outputs.map((o) => o.key),
      });
      for (let i = 0; i < result.cells.length; i++) {
        const data = describe(result.cells[i]),
          output = graph.outputs.find((o) => o.signature === signatures[i]),
          style = output.style;
        const boundaryPathIds = result.boundaryPathIds?.[i] || [];
        const swatchId = style?.swatchId || o.swatchId;
        cells.push({
          ...data,
          key: output.key,
          objectId: o.id,
          contourSignature: output.signature,
          painted: !!style || !!o.fillAll,
          swatchId,
          color: colors.get(swatchId),
          heightMM: style?.heightMM ?? o.heightMM,
          zMM: style ? z + style.zOffsetMM : candidateBottom,
          sourceIds: o.pathIds,
          boundaryPathIds,
          name:
            boundaryPathIds.length === 1
              ? project.paths.find((path) => path.id === boundaryPathIds[0])
                  ?.name
              : undefined,
          conflict: false,
          normalizedGeometry: scaleGeometry(data.geometry, 1 / project.widthMM),
        });
      }
    } catch (e) {
      // Neither partial results nor old paint footprints are current surfaces.
      // Keep the source paths and style records for correction/undo, but expose
      // no selectable/exportable geometry for this failed object.
      cells.splice(objectCellStart);
      errors.push({ objectId: o.id, ...e.pipeline, message: e.message });
      pipelineStatus.push({
        objectId: o.id,
        stage: e.pipeline?.stage || 'source',
        state: 'blocked',
        message: e.message,
      });
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
    featureGeometryOverrides,
    topologies,
    surfaceGraphs,
    surfaceGraphCandidates,
    pipelineStatus,
    modifierStatus: sourceTrace.statuses,
    modifierContracts: sourceTrace.contracts,
    objectBottoms: Object.fromEntries(heights),
    regionBindings: Object.fromEntries(
      regions
        .filter((r) => r.contourSignature)
        .map((r) => [r.id, r.contourSignature]),
    ),
  };
}
export function evaluateCreation(project, options = {}) {
  project = printEvaluationProject(project);
  return applyObjectModifiers(project, evaluateCreationBase(project, options));
}
export function compileCreation(project) {
  if (!project.creation) return project;
  project = printEvaluationProject(project);
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
      scene.featureGeometryOverrides[f.attachId] === null ||
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
      if (
        (scene.creation.printStack || o.useObjectZ || removedSupport(f)) &&
        o.featureIds.includes(f.id)
      ) {
        const c = scene.cells.find((c) => c.featureId === f.id);
        if (c) {
          f.zMM = c.bottomMM;
          f.heightMM = c.heightMM;
          if (scene.creation.printStack) f.heightLayers = c.heightLayers;
          delete f.attachId;
        }
      }
    }
  // Override only the extrusion's compiled input. Original recipes can also
  // feed other objects and must not be changed by a local object's hole.
  for (const [featureId, geometry] of Object.entries(
    scene.featureGeometryOverrides,
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
    heightMM = p.creation.printStack
      ? printMM(
          requestedPrintCount(
            args.heightLayers !== undefined || args.heightMM !== undefined
              ? args
              : {
                  heightLayers: printCount(
                    2,
                    p.creation.printStack.layerHeightMM,
                  ),
                },
            p.creation.printStack.layerHeightMM,
          ),
          p.creation.printStack.layerHeightMM,
        )
      : (args.heightMM ?? 2);
  if (
    !Number.isFinite(offsetMM) ||
    offsetMM < 0 ||
    offsetMM > 20 ||
    !Number.isFinite(heightMM) ||
    heightMM <
      (p.creation.printStack ? p.creation.printStack.layerHeightMM : 0.1) ||
    heightMM > 1000
  )
    throw Error('底板边距或厚度无效');
  const id = crypto.randomUUID();
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
    sources: {},
    modifiers: [
      ...objects.map((object) => ({
        id: crypto.randomUUID(),
        name: '引用 ' + object.name,
        type: 'boolean',
        operation: 'union',
        enabled: true,
        targets: { kind: 'all' },
        input: { kind: 'object', id: object.id, projection: 'outline' },
      })),
      {
        id: crypto.randomUUID(),
        name: '底板边距',
        type: 'offset',
        distanceMM: offsetMM,
        enabled: true,
        targets: { kind: 'all' },
      },
    ],
    fillAll: true,
  };
  p.creation.objects.unshift(o);
  if (p.creation.printStack) {
    const layerId = crypto.randomUUID();
    p.creation.printStack.layers.unshift({ id: layerId, name: '底板层' });
    o.printLayerId = layerId;
    syncPrintDimensions(p);
  }
  let scene = evaluateCreation(p);
  const cells = scene.cells.filter((c) => c.objectId === id);
  if (!cells.length)
    throw Error(
      scene.errors.find((e) => e.objectId === id)?.message ||
        '底板没有有效面积',
    );
  if (args.stack !== false && !p.creation.printStack)
    for (const object of objects) {
      object.attachId = id;
      object.zMM = 0;
      object.useObjectZ = true;
    }
  scene = evaluateCreation(p);
  return { project: p, scene, objectId: id };
}
