import {
  readGeometry,
  regionContext,
  samplePath,
  describe,
  robustPolygonize,
} from './region-engine.mjs';
import DistanceOp from 'jsts/org/locationtech/jts/operation/distance/DistanceOp.js';
import GeometryFactory from 'jsts/org/locationtech/jts/geom/GeometryFactory.js';
import { targetForCell } from './modifier-schema.mjs';
import { contourSignatures, pipelineError } from './surface-lineage.mjs';
import { polygonalGeometry } from './creation-styles.mjs';
import { resolvePrintStack } from './print-stack.mjs';
import {
  modifierStages,
  usesCurvePipeline,
  objectPipeline,
} from './modifier-stages.mjs';
import { evaluateCurveProgram, fillCurves } from './curve-modifiers.mjs';

const point = (coordinates) => readGeometry({ type: 'Point', coordinates });
const line = (coordinates) => readGeometry({ type: 'LineString', coordinates });
const empty = () => new GeometryFactory().createPolygon();
const combine = (geometries) =>
  geometries.reduce((a, b) => a.union(b), empty());
// Rotate evaluated polygons, including their holes. Editable source cubics are
// never duplicated or sampled back into the project. Each input keeps its style.
function radialArray(geometry, modifier) {
  const source = describe(geometry).geometry;
  const { x, y } = modifier.centerMM;
  const copies = Array.from({ length: modifier.count }, (_, i) => {
    if (!i) return geometry;
    const angle = (i * modifier.angleDeg * Math.PI) / 180;
    const cos = Math.cos(angle),
      sin = Math.sin(angle);
    const rotate = (coordinates) =>
      typeof coordinates[0] === 'number'
        ? [
            x + cos * (coordinates[0] - x) - sin * (coordinates[1] - y),
            y + sin * (coordinates[0] - x) + cos * (coordinates[1] - y),
          ]
        : coordinates.map(rotate);
    return readGeometry({ ...source, coordinates: rotate(source.coordinates) });
  });
  return combine(copies);
}
const normalize = (geometry, width) => ({
  ...geometry,
  coordinates: (function scale(a) {
    return typeof a[0] === 'number' ? a.map((v) => v / width) : a.map(scale);
  })(geometry.coordinates),
});
const area = (cells) => cells.reduce((n, c) => n + c.areaMM2, 0);
const shapeSignature = (g) =>
  JSON.stringify(
    (g.type === 'Polygon' ? [g.coordinates] : g.coordinates)
      .map((p) => p.length - 1)
      .sort((a, b) => a - b),
  );
const valid = (g) => {
  if (!g.isValid()) throw Error('运算产生了无效边界，请调整来源曲线');
  if (g.isEmpty() || g.getArea() < 1e-7) return null;
  const polygon = polygonalGeometry(describe(g).geometry);
  return polygon ? readGeometry(polygon) : null;
};
function regionInput(project, input, ctx) {
  if (input.kind === 'region') return ctx.get(input.id);
  const path = project.paths.find((p) => p.id === input.id);
  if (!path) throw Error('来源样条已删除');
  if (!path.closed)
    throw Error(`「${path.name}」尚未闭合，布尔运算需要闭合轮廓`);
  return ctx.calculate({ kind: 'path', pathId: path.id }).cells[0];
}
export function evaluateSourceProgram(
  project,
  feature,
  object,
  ctx,
  trace = { statuses: [], contracts: {} },
) {
  const source = object.sources?.[feature.id];
  let g = ctx.get(source?.regionId || feature.regionId);
  for (const m of source?.modifiers || []) {
    const status = {
      objectId: object.id,
      modifierId: m.id,
      sourceFeatureId: feature.id,
      inputOptions: [],
      state: m.enabled ? 'ready' : 'disabled',
    };
    trace.statuses.push(status);
    if (!m.enabled) continue;
    try {
      g = valid(g[m.operation](regionInput(project, m.input, ctx))) || empty();
      const contract = g.isEmpty()
        ? []
        : [
            {
              key: 'feature:' + feature.id,
              signature: shapeSignature(describe(g).geometry),
            },
          ];
      if (
        m.outputContract &&
        JSON.stringify(m.outputContract) !== JSON.stringify(contract)
      )
        throw Error('来源修改器的输出关系已改变，请修复此步或解除后重建');
      trace.contracts[m.id] = contract;
    } catch (e) {
      status.error = e.message;
      status.state = 'blocked';
      const index = source.modifiers.indexOf(m);
      for (const later of source.modifiers.slice(index + 1))
        trace.statuses.push({
          objectId: object.id,
          modifierId: later.id,
          sourceFeatureId: feature.id,
          state: 'waiting',
          inputOptions: [],
          note: '等待来源步骤修复',
        });
      throw pipelineError('source', `来源「${m.name}」：${e.message}`, {
        modifierId: m.id,
        sourceFeatureId: feature.id,
      });
    }
  }
  return g;
}

function splitGeometry(project, geometry, modifier) {
  const path = project.paths.find((p) => p.id === modifier.input.id);
  if (!path) throw Error('分区样条已删除');
  if (path.closed) throw Error('分区修改器需要开放样条；闭合轮廓请用布尔运算');
  if (geometry.getGeometryType() !== 'Polygon')
    throw Error('请先选择单个连通面，再用样条分区');
  const coords = samplePath(project, path).map((p) => p.slice());
  if (!line(coords).isSimple()) throw Error('分区线不能自相交，请拆成多步分区');
  for (const endpoint of [0, coords.length - 1]) {
    const from = coords[endpoint],
      nearest = DistanceOp.nearestPoints(
        point(from),
        geometry.getBoundary(),
      )[1];
    const gap = Math.hypot(nearest.x - from[0], nearest.y - from[1]);
    if (gap > 1e-8 && gap <= (modifier.joinMM || 0)) {
      const extra = Math.min(0.005, (modifier.joinMM || 0) / 100);
      const to = [
        nearest.x + ((nearest.x - from[0]) / gap) * extra,
        nearest.y + ((nearest.y - from[1]) / gap) * extra,
      ];
      coords[endpoint] = to;
    }
  }
  const pieces = robustPolygonize([
    geometry.getBoundary(),
    line(coords),
  ]).filter((g) => g.getArea() > 1e-7 && geometry.covers(g.getInteriorPoint()));
  if (pieces.length === 1)
    throw Error(
      '分区线已不能贯穿目标轮廓；分区及下游产出已暂停，请修复线条或移除此步',
    );
  if (pieces.length !== 2)
    throw Error('这条线一次产生了多个分区，请拆成每次贯穿一个面的操作');
  // Left/right is tied to the directed source curve, not polygon list order.
  // Moving both source and cutter preserves downstream references and styles.
  const side = (g) => {
    const p = g.getInteriorPoint().getCoordinate();
    let best = Infinity,
      value = 0;
    for (let i = 1; i < coords.length; i++) {
      const a = coords[i - 1],
        b = coords[i],
        dx = b[0] - a[0],
        dy = b[1] - a[1],
        len = dx * dx + dy * dy;
      if (!len) continue;
      const t = Math.max(
        0,
        Math.min(1, ((p.x - a[0]) * dx + (p.y - a[1]) * dy) / len),
      );
      const dist = (p.x - a[0] - dx * t) ** 2 + (p.y - a[1] - dy * t) ** 2;
      if (dist < best) {
        best = dist;
        value = dx * (p.y - a[1]) - dy * (p.x - a[0]);
      }
    }
    return value > 0 ? 'left' : 'right';
  };
  const signatures = contourSignatures(pieces, [
    { id: 'base', geometry: geometry.getBoundary() },
    { id: 'cut:' + path.id, geometry: line(coords) },
  ]);
  const result = pieces.map((g, i) => ({
    g,
    side: side(g),
    signature: signatures[i],
  }));
  if (result[0].side === result[1].side)
    throw Error('分区方向不明确，请将这条线拆成更简单的两步');
  return result;
}

export function applyObjectModifiers(project, scene) {
  const curvePrograms = new Map(
    scene.creation.objects.map((o) => [o.id, evaluateCurveProgram(project, o)]),
  );
  const modifierContracts = { ...scene.modifierContracts };
  const modifierBindings = {};
  const objects = new Map(scene.creation.objects.map((o) => [o.id, o]));
  const base = new Map(
    scene.creation.objects.map((o) => [
      o.id,
      scene.cells
        .filter((c) => c.objectId === o.id)
        .map((c) => ({
          ...c,
          ...(!c.featureId && !c.regionId
            ? {
                targetTopology:
                  scene.topologies[o.id]?.key +
                  ':' +
                  scene.topologies[o.id]?.count,
              }
            : {}),
        })),
    ]),
  );
  const done = new Map(),
    visiting = new Set(),
    statuses = [...(scene.modifierStatus || [])],
    errors = [...scene.errors],
    ctx = regionContext(project);
  const colors = new Map(scene.creation.swatches.map((s) => [s.id, s.color]));
  const compute = (id) => {
    if (done.has(id)) return done.get(id);
    const object = objects.get(id);
    if (!object) throw Error('引用的对象已删除');
    if (visiting.has(id)) throw Error(`对象引用形成循环：${object.name}`);
    if (scene.errors.some((e) => e.objectId === id))
      throw Error(`「${object.name}」的基础构造需要修复`);
    visiting.add(id);
    let cells = base.get(id),
      curves = null,
      filled = false;
    let domain = usesCurvePipeline(object) ? 'curves' : 'surfaces';
    try {
      for (const modifier of object.modifiers || []) {
        const inputOptions = cells.map((c) => ({
          ref: targetForCell(c),
          name: c.name || '区域',
        }));
        const status = {
          objectId: id,
          modifierId: modifier.id,
          inputOptions,
          enabled: modifier.enabled,
          beforeArea: area(cells),
          affected: 0,
        };
        statuses.push(status);
        if (!modifier.enabled) {
          status.afterArea = status.beforeArea;
          continue;
        }
        try {
          const stage = modifierStages[modifier.type];
          if (stage.input !== domain)
            throw Error(
              `${stage.name}需要${stage.input === 'curves' ? '曲线' : '面'}输入；请调整顺序，构面前仅使用曲线操作`,
            );
          if (['curve_mirror', 'curve_array', 'fill'].includes(modifier.type)) {
            if (filled || cells.length)
              throw Error(
                '曲线步骤必须位于构面之前，并使用仅含参考源线的独立部件',
              );
            const program = curvePrograms.get(id);
            const curveStage = program.stages.find(
              (s) => s.stageId === modifier.id,
            );
            if (!curveStage)
              throw Error(program.error?.message || '上游曲线阶段不可用');
            curves ||= program.stages[0].curves;
            status.inputCurveCount = curves.length;
            curves = curveStage.curves;
            if (modifier.type !== 'fill') {
              status.outputCurveCount = curves.length;
              status.afterArea = 0;
              status.note = `${curves.length} 段派生贝塞尔，尚未构面`;
              continue;
            }
            const result = fillCurves(
              curves,
              modifier.joinMM,
              project.model?.toleranceMM,
            );
            const geometry = describe(result.geometry).geometry;
            const key = `${id}:modifier:${modifier.id}:fill`;
            const contract = [{ key, signature: shapeSignature(geometry) }];
            if (
              modifier.outputContract &&
              JSON.stringify(modifier.outputContract) !==
                JSON.stringify(contract)
            )
              throw Error('构面轮廓关系已改变，请修复上游曲线或重建构面步骤');
            modifierContracts[modifier.id] = contract;
            const style = modifier.styles?.find((s) => s.key === key);
            const swatchId = style?.swatchId || object.swatchId;
            cells = [
              {
                ...describe(result.geometry),
                key,
                objectId: id,
                name: object.name,
                painted: true,
                swatchId,
                color: colors.get(swatchId),
                heightMM: style?.heightMM ?? object.heightMM,
                ...(style?.heightLayers !== undefined
                  ? { heightLayers: style.heightLayers }
                  : object.heightLayers !== undefined
                    ? { heightLayers: object.heightLayers }
                    : {}),
                zMM: scene.objectBottoms?.[id] ?? object.zMM,
                modifierResult: { id: modifier.id },
                sourceIds: object.pathIds,
                normalizedGeometry: normalize(geometry, project.widthMM),
              },
            ];
            filled = true;
            domain = 'surfaces';
            status.closedLoops = result.loopCount;
            status.affected = 1;
            status.afterArea = area(cells);
            status.note = `${result.segmentCount} 段曲线闭合为 ${result.loopCount} 个环（奇偶填充）`;
            continue;
          }
          if (curves && !filled)
            throw Error('面修改器之前需要先添加闭合构面步骤');
          const refs = modifier.targets.refs || [];
          const matches = (c, r) =>
            (targetForCell(c).key === r.key ||
              (!modifier.outputContract &&
                c.boundaryPathIds?.length &&
                r.key ===
                  'paths:' + c.boundaryPathIds.slice().sort().join('|'))) &&
            (!r.topology || c.targetTopology === r.topology);
          for (const ref of refs)
            if (cells.filter((c) => matches(c, ref)).length !== 1)
              throw Error(
                `作用面「${ref.name}」已变化或不存在，请重新选择范围`,
              );
          if (!modifier.outputContract && modifier.targets.kind === 'selected')
            modifierBindings[modifier.id] = {
              kind: 'selected',
              refs: refs.map((ref) =>
                targetForCell(cells.find((c) => matches(c, ref))),
              ),
            };
          let chosen = cells.filter(
            (c) =>
              modifier.targets.kind === 'all' ||
              refs.some((r) => matches(c, r)),
          );
          if (modifier.type === 'split' && modifier.targets.kind === 'all') {
            const cutter = project.paths.find(
              (p) => p.id === modifier.input.id,
            );
            if (!cutter) throw Error('分区样条已删除');
            if (cutter.closed)
              throw Error('分区需要开放样条；闭合轮廓请使用布尔运算');
            let reach = line(samplePath(project, cutter));
            if (modifier.joinMM) reach = reach.buffer(modifier.joinMM);
            chosen = chosen.filter((c) =>
              readGeometry(c.geometry).intersects(reach),
            );
            if (!chosen.length)
              throw Error(
                '分区线未接触任何目标轮廓；请调整源线或重新选择作用面',
              );
          }
          status.affected = chosen.length;
          if (
            !chosen.length &&
            !(
              modifier.type === 'boolean' &&
              modifier.operation === 'union' &&
              modifier.targets.kind === 'all'
            )
          ) {
            status.afterArea = status.beforeArea;
            continue;
          }
          let operand;
          if (modifier.type === 'boolean') {
            operand =
              modifier.input.kind === 'object'
                ? combine(
                    compute(modifier.input.id).map((c) =>
                      readGeometry(c.geometry),
                    ),
                  )
                : regionInput(project, modifier.input, ctx);
            if (modifier.input.projection === 'outline') {
              const polygons = [];
              const visit = (g) => {
                if (g.getGeometryType() === 'Polygon')
                  polygons.push(
                    g.getFactory().createPolygon(g.getExteriorRing()),
                  );
                else
                  for (let i = 0; i < g.getNumGeometries(); i++)
                    visit(g.getGeometryN(i));
              };
              if (!operand.isEmpty()) visit(operand);
              operand = combine(polygons);
            }
          }
          const replacements = new Map();
          if (
            !chosen.length &&
            modifier.type === 'boolean' &&
            modifier.operation === 'union'
          ) {
            const g = valid(operand);
            if (g)
              cells.push({
                ...describe(g),
                key: `${id}:modifier:${modifier.id}:union`,
                name: object.name,
                objectId: id,
                painted: true,
                swatchId: object.swatchId,
                color: colors.get(object.swatchId),
                heightMM: object.heightMM,
                zMM: scene.objectBottoms?.[id] ?? object.zMM,
                modifierResult: { id: modifier.id },
                sourceIds: [],
                normalizedGeometry: normalize(
                  describe(g).geometry,
                  project.widthMM,
                ),
              });
          }
          if (
            modifier.type === 'boolean' &&
            modifier.operation === 'union' &&
            chosen.length > 1
          ) {
            const styles = new Set(
              chosen.map(
                (c) => `${c.color}:${c.heightMM}:${c.bottomMM ?? c.zMM}`,
              ),
            );
            if (styles.size > 1)
              throw Error('合并多个面时请先统一颜色和高度，或只选择一个目标面');
            const g = combine(
              chosen.map((c) => readGeometry(c.geometry)),
            ).union(operand);
            replacements.set(chosen[0].key, [
              {
                ...chosen[0],
                ...describe(g),
                key: `${id}:modifier:${modifier.id}:union`,
                featureId: undefined,
                regionId: undefined,
                zMM: chosen[0].bottomMM ?? chosen[0].zMM,
                modifierResult: { id: modifier.id },
                sourceFeatureIds: chosen.flatMap(
                  (c) =>
                    c.sourceFeatureIds ||
                    [c.featureId || c.sourceFeatureId].filter(Boolean),
                ),
                normalizedGeometry: normalize(
                  describe(g).geometry,
                  project.widthMM,
                ),
              },
            ]);
            for (const cell of chosen.slice(1)) replacements.set(cell.key, []);
          } else
            for (const cell of chosen) {
              const geometry = readGeometry(cell.geometry);
              if (modifier.type === 'split') {
                const pieces = splitGeometry(project, geometry, modifier);
                replacements.set(
                  cell.key,
                  pieces.map(({ g, side, signature }) => {
                    const key =
                      cell.key + ':modifier:' + modifier.id + ':' + side;
                    return {
                      ...cell,
                      ...describe(g),
                      key,
                      name:
                        (cell.name || '区域') +
                        (side === 'left' ? ' · 左区' : ' · 右区'),
                      featureId: undefined,
                      regionId: undefined,
                      zMM: cell.bottomMM ?? cell.zMM,
                      modifierResult: { id: modifier.id, sourceKey: cell.key },
                      contourSignature: signature,
                      sourceFeatureId: cell.featureId || cell.sourceFeatureId,
                      sourceIds:
                        cell.sourceIds ||
                        project.model?.regions.find(
                          (r) => r.id === cell.regionId,
                        )?.pathIds ||
                        object.pathIds,
                      normalizedGeometry: normalize(
                        describe(g).geometry,
                        project.widthMM,
                      ),
                    };
                  }),
                );
              } else {
                const g = valid(
                  modifier.type === 'offset'
                    ? geometry.buffer(modifier.distanceMM, 12)
                    : modifier.type === 'radial_array'
                      ? radialArray(geometry, modifier)
                      : geometry[modifier.operation](operand),
                );
                replacements.set(
                  cell.key,
                  g
                    ? [
                        {
                          ...cell,
                          ...describe(g),
                          normalizedGeometry: normalize(
                            describe(g).geometry,
                            project.widthMM,
                          ),
                        },
                      ]
                    : [],
                );
              }
            }
          cells = cells.flatMap((c) => replacements.get(c.key) || [c]);
          const outputs = cells
            .filter(
              (c) =>
                chosen.some((input) => input.key === c.key) ||
                c.modifierResult?.id === modifier.id,
            )
            .map((c) => ({
              key: c.key,
              signature:
                modifier.type === 'split'
                  ? c.contourSignature || c.key
                  : shapeSignature(c.geometry),
            }))
            .sort((a, b) => a.key.localeCompare(b.key));
          if (
            modifier.outputContract &&
            JSON.stringify(modifier.outputContract) !== JSON.stringify(outputs)
          )
            throw Error(
              '此步的输出轮廓关系已变化；下游暂停。请修复来源，或移除此步及下游后重新构建',
            );
          modifierContracts[modifier.id] = outputs;
          cells = cells.map((c) => {
            const style = modifier.styles?.find((s) => s.key === c.key);
            return style
              ? {
                  ...c,
                  ...(style.swatchId
                    ? {
                        swatchId: style.swatchId,
                        color: colors.get(style.swatchId),
                      }
                    : {}),
                  ...(style.heightMM !== undefined
                    ? { heightMM: style.heightMM }
                    : {}),
                  painted: true,
                }
              : c;
          });
          status.afterArea = area(cells);
        } catch (e) {
          status.error = e.message;
          status.state = 'blocked';
          throw pipelineError(
            'modifier',
            `修改器「${modifier.name}」：${e.message}`,
            {
              modifierId: modifier.id,
              pathIds:
                modifier.input?.kind === 'path'
                  ? [modifier.input.id]
                  : object.pathIds,
            },
          );
        }
      }
      done.set(id, cells);
      return cells;
    } finally {
      visiting.delete(id);
    }
  };
  let output = [];
  for (const o of scene.creation.objects) {
    try {
      output.push(...compute(o.id));
    } catch (e) {
      if (!errors.some((error) => error.objectId === o.id))
        errors.push({
          objectId: o.id,
          kind: 'modifier',
          ...e.pipeline,
          message: e.message,
        });
    }
  }
  for (const o of scene.creation.objects) {
    const failure = errors.find((e) => e.objectId === o.id);
    for (const m of o.modifiers || []) {
      const status = statuses.find(
        (s) => s.objectId === o.id && s.modifierId === m.id,
      );
      if (status) status.state ||= m.enabled ? 'ready' : 'disabled';
      else
        statuses.push({
          objectId: o.id,
          modifierId: m.id,
          enabled: m.enabled,
          state: m.enabled ? 'waiting' : 'disabled',
          inputOptions: [],
          note: m.enabled
            ? `等待上游修复：${failure?.message || '来源未完成'}`
            : '已停用',
        });
    }
  }
  // Resolve vertical stacking after the surface program has produced its local
  // thicknesses. Geometry references stay 2D and do not create height cycles.
  let printLevels;
  if (scene.creation.printStack) {
    const placed = resolvePrintStack(scene.creation, output, errors);
    output = placed.cells;
    errors.splice(0, errors.length, ...placed.errors);
    printLevels = placed.printLevels;
  } else {
    const levels = new Map();
    const levelFor = (id, visiting = new Set()) => {
      if (levels.has(id)) return levels.get(id);
      const o = objects.get(id);
      if (!o || visiting.has(id)) throw Error('对象高度依附无效或形成循环');
      if (errors.some((e) => e.objectId === id))
        throw Error(`「${o.name}」的上游构造已暂停`);
      visiting.add(id);
      const oldBottom = scene.objectBottoms[id] ?? o.zMM;
      const bottom = o.attachId
        ? levelFor(o.attachId, visiting).top + o.zMM
        : oldBottom;
      const delta = o.attachId ? bottom - oldBottom : 0;
      const own = output.filter((c) => c.objectId === id);
      if (
        !own.length &&
        scene.creation.objects.some((other) => other.attachId === id)
      )
        throw Error(`「${o.name}」没有可承接叠放的有效输出`);
      const top = own.length
        ? Math.max(
            ...own.map((c) => (c.bottomMM ?? c.zMM) + c.heightMM + delta),
          )
        : bottom + o.heightMM;
      const result = { bottom, top, delta };
      levels.set(id, result);
      visiting.delete(id);
      return result;
    };
    for (const o of scene.creation.objects) {
      try {
        levelFor(o.id);
      } catch (e) {
        if (!errors.some((error) => error.objectId === o.id))
          errors.push({ objectId: o.id, message: e.message });
      }
    }
    output = output
      .filter((c) => !errors.some((e) => e.objectId === c.objectId))
      .map((c) => {
        const delta = levels.get(c.objectId)?.delta || 0;
        return !delta
          ? c
          : {
              ...c,
              ...(c.bottomMM !== undefined
                ? { bottomMM: c.bottomMM + delta }
                : {}),
              ...(c.zMM !== undefined ? { zMM: c.zMM + delta } : {}),
            };
      });
  }
  const overrides = { ...scene.featureGeometryOverrides };
  const replaced = { ...scene.autoReplacedFeatureIds };
  for (const o of scene.creation.objects) {
    if (errors.some((e) => e.objectId === o.id)) continue;
    const own = output.filter((c) => c.objectId === o.id);
    for (const before of base.get(o.id).filter((c) => c.featureId)) {
      const after = own.find((c) => c.featureId === before.featureId);
      if (!after) overrides[before.featureId] = null;
      else {
        const feature = project.model.features.find(
          (f) => f.id === before.featureId,
        );
        let identical = false;
        try {
          identical = readGeometry(after.geometry).equalsExact(
            ctx.get(feature.regionId),
            1e-9,
          );
        } catch {
          /* A repaired source can replace an invalid legacy recipe. */
        }
        if (identical) delete overrides[before.featureId];
        else overrides[before.featureId] = after.geometry;
      }
      if (
        own.some(
          (c) =>
            c.sourceFeatureId === before.featureId ||
            c.sourceFeatureIds?.includes(before.featureId),
        )
      )
        replaced[o.id] = [
          ...new Set([...(replaced[o.id] || []), before.featureId]),
        ];
    }
  }
  return {
    ...scene,
    cells: output,
    printLevels,
    errors,
    modifierStatus: statuses,
    curvePreviews: [...curvePrograms.values()].flatMap((p) => p.stages),
    modifierContracts,
    modifierBindings,
    modifierBaseCells: [...base.values()].flat(),
    pipelines: Object.fromEntries(
      scene.creation.objects.map((o) => [o.id, objectPipeline(o)]),
    ),
    featureGeometryOverrides: overrides,
    autoReplacedFeatureIds: replaced,
  };
}
