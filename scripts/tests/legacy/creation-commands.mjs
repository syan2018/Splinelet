import { bindSurfaceGraphs } from '../../../src/lib/surface-lineage.mjs';
import {
  creationDocument,
  validateCreation,
  acceptDividerGraph,
} from '../../../src/lib/creation-schema.mjs';
import { emptyModel } from '../../../src/lib/model-schema.mjs';
import { removeSwatch } from './creation-colors.mjs';
import {
  regionClosureConnections,
  regionContext,
} from '../../../src/lib/region-engine.mjs';
import { modifierCommand } from './modifier-commands.mjs';
import { syncHoleModifiers } from '../../../src/lib/modifier-schema.mjs';
import { moveCreationPaths } from './creation-path-transfer.mjs';
import {
  printCommand,
  requestedPrintCount,
  printMM,
  syncPrintDimensions,
} from '../../../src/lib/print-stack.mjs';
const uid = () => crypto.randomUUID();
export function creationCommand(project, action, a = {}, scene) {
  const p = structuredClone(bindSurfaceGraphs(project, scene || {})),
    c = creationDocument(p);
  p.version = 3;
  p.creation = c;
  p.model ||= emptyModel();
  const object = (id) => {
    const o = c.objects.find((o) => o.id === id);
    if (!o) throw Error('对象已不存在');
    return o;
  };
  const objectBottom = (o, seen = new Set()) => {
    if (seen.has(o.id)) throw Error('高度依附形成循环');
    seen.add(o.id);
    const parent = o.attachId ? object(o.attachId) : null;
    return (
      o.zMM +
      (parent
        ? objectBottom(parent, seen) +
          Math.max(
            parent.heightMM,
            ...parent.paints.map((p) => p.heightMM),
            ...(parent.surfaceGraph?.outputs || []).map(
              (o) => o.style?.heightMM || 0,
            ),
          )
        : 0)
    );
  };
  const number = (v, min, max) => {
    if (!Number.isFinite(v) || v < min || v > max)
      throw Error(`数值应在 ${min}–${max} 之间`);
    return v;
  };
  const cells = (a.cellKeys || []).map((key) => {
    const cell = scene?.cells.find((c) => c.key === key);
    if (!cell) throw Error('选区已变化，请重新选择');
    return cell;
  });
  if (action.startsWith('print_')) {
    printCommand(p, c, action, a);
  } else if (action.startsWith('modifier_')) {
    modifierCommand(p, c, action, a, scene);
  } else if (action === 'paint' || action === 'height') {
    const targetIds = new Set([
      ...(a.objectIds || []),
      ...cells.map((cell) => cell.objectId),
    ]);
    const failed = scene?.errors.find((error) => targetIds.has(error.objectId));
    if (failed)
      throw Error(
        `请先修复「${object(failed.objectId).name}」的分区；已保存的颜色与高度未改动`,
      );
    // A local custom colour creates/reuses a swatch in this same history entry.
    // Never edit a shared swatch when changing the colour of a selection.
    if (action === 'paint' && a.color !== undefined) {
      if (!/^#[a-f0-9]{6}$/i.test(a.color)) throw Error('色值无效');
      const color = a.color.toLowerCase();
      let swatch = c.swatches.find((s) => s.color.toLowerCase() === color);
      if (!swatch) {
        swatch = {
          id: uid(),
          name: a.name?.trim() || color.toUpperCase(),
          color,
        };
        c.swatches.push(swatch);
      }
      a = { ...a, swatchId: swatch.id };
    }
    if (action === 'paint' && !c.swatches.some((s) => s.id === a.swatchId))
      throw Error('请选择项目色');
    if (action === 'height') {
      if (c.printStack) {
        const h = c.printStack.layerHeightMM;
        const count = requestedPrintCount(a, h);
        a = {
          ...a,
          heightLayers: count,
          heightMM: printMM(count, h),
        };
      }
      number(a.heightMM, 0.01, 1000);
    }
    const setHeight = (record) => {
      record.heightMM = a.heightMM;
      if (c.printStack) record.heightLayers = a.heightLayers;
    };
    const targets = a.objectIds?.length
      ? scene.cells.filter((cell) => a.objectIds.includes(cell.objectId))
      : cells;
    if (!targets.length && !a.objectIds?.length)
      throw Error('请先选中一个对象或区域');
    for (const id of a.objectIds || []) {
      const o = object(id);
      if (action === 'paint') o.swatchId = a.swatchId;
      else setHeight(o);
    }
    const touched = new Set(targets.map((c) => c.objectId));
    for (const cell of targets) {
      const o = object(cell.objectId);
      if (cell.modifierResult) {
        const modifier = o.modifiers.find(
          (m) => m.id === cell.modifierResult.id,
        );
        if (!modifier) throw Error('来源修改器已不存在');
        modifier.styles ||= [];
        let style = modifier.styles.find((s) => s.key === cell.key);
        if (!style) {
          style = { key: cell.key };
          modifier.styles.push(style);
        }
        if (action === 'paint') style.swatchId = a.swatchId;
        else setHeight(style);
      } else if (cell.featureId) {
        const f = p.model.features.find((f) => f.id === cell.featureId);
        if (action === 'paint') {
          o.featureSwatches[f.id] = a.swatchId;
          f.color = c.swatches.find((s) => s.id === a.swatchId).color;
        } else setHeight(f);
      } else if (cell.regionId) {
        if (action === 'paint')
          p.model.regions.find((r) => r.id === cell.regionId).color =
            c.swatches.find((s) => s.id === a.swatchId).color;
        {
          const id = uid();
          p.model.features.push({
            id,
            name: cell.name,
            regionId: cell.regionId,
            partId: p.model.parts[0].id,
            mode: 'add',
            zMM: o.zMM,
            heightMM: action === 'height' ? a.heightMM : cell.heightMM,
            ...(c.printStack
              ? {
                  heightLayers:
                    action === 'height' ? a.heightLayers : cell.heightLayers,
                }
              : {}),
            color:
              action === 'paint'
                ? c.swatches.find((s) => s.id === a.swatchId).color
                : cell.color,
            enabled: true,
          });
          o.featureIds.push(id);
          for (const modifier of o.modifiers || [])
            for (const ref of modifier.targets.refs || [])
              if (ref.key === 'region:' + cell.regionId)
                ref.key = 'feature:' + id;
          o.featureSwatches[id] =
            action === 'paint' ? a.swatchId : cell.swatchId;
        }
      }
    }
    // Appearance is a downstream property of a contour output. A local edit
    // never intersects polygons or rewrites sibling output records.
    for (const id of touched) {
      const o = object(id);
      const native = targets.filter(
        (cell) =>
          cell.objectId === id &&
          !cell.modifierResult &&
          !cell.featureId &&
          !cell.regionId,
      );
      if (!native.length) continue;
      for (const cell of native) {
        const output = o.surfaceGraph?.outputs.find((o) => o.key === cell.key);
        if (!output) throw Error('面片来源已失效，请先修复构造链');
        const before = output.style || {
          swatchId: cell.swatchId,
          heightMM: cell.heightMM,
          zOffsetMM: c.printStack ? 0 : cell.zMM - objectBottom(o),
        };
        output.style = {
          ...before,
          ...(action === 'paint'
            ? { swatchId: a.swatchId }
            : {
                heightMM: a.heightMM,
                ...(c.printStack ? { heightLayers: a.heightLayers } : {}),
              }),
        };
      }
    }
  } else if (action === 'rebuild_surfaces') {
    const o = object(a.objectId),
      proposal = scene?.surfaceGraphCandidates?.[o.id];
    if (!proposal) throw Error('当前没有可重建的分区输出，请先修复源线');
    if (a.confirm !== true)
      throw Error('重建会解除失效输出的颜色与厚度，请确认后执行');
    o.surfaceGraph = structuredClone(proposal);
    o.paints = [];
    acceptDividerGraph(o);
  } else if (action === 'swatch') {
    if (!/^#[a-f0-9]{6}$/i.test(a.color)) throw Error('色值无效');
    let s = c.swatches.find((s) => s.id === a.id);
    if (!s) {
      s = { id: uid(), name: a.name || '新颜色', color: a.color };
      c.swatches.push(s);
    } else {
      s.color = a.color;
      if (a.name?.trim()) s.name = a.name.trim();
    }
    for (const o of c.objects)
      for (const [id, swatch] of Object.entries(o.featureSwatches))
        if (swatch === s.id) {
          const f = p.model.features.find((f) => f.id === id);
          if (f) f.color = s.color;
        }
  } else if (action === 'delete_swatch') {
    removeSwatch(p, c, a.id, a.replacementId);
  } else if (action === 'object') {
    if (
      c.printStack &&
      ['heightMM', 'zMM', 'attachId'].some((k) => k in (a.changes || {}))
    )
      throw Error('打印分层已接管高度：使用所属堆叠层和整数打印层数调整');
    const o = object(a.id),
      allowed = [
        'name',
        'visible',
        'printable',
        'swatchId',
        'heightMM',
        'zMM',
        'attachId',
        'partId',
      ];
    if (Object.keys(a.changes || {}).some((k) => !allowed.includes(k)))
      throw Error('未知对象属性');
    Object.assign(o, a.changes);
    if (a.changes?.zMM !== undefined) o.useObjectZ = true;
    if (a.changes?.attachId !== undefined && o.featureIds.length) {
      if (a.changes.attachId) object(a.changes.attachId);
      o.useObjectZ = true;
    }
  } else if (action === 'new_object') {
    const id = uid();
    c.objects.push({
      id,
      name: a.name?.trim() || '新部件',
      pathIds: [],
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
    });
  } else if (action === 'continue_partition') {
    throw Error('旧面无需转换。请在修改器中添加分区，并选择需要拆分的面');
  } else if (action === 'combine_objects') {
    const selected = c.objects.filter((o) => a.objectIds.includes(o.id));
    if (selected.length < 2) throw Error('请多选两个部件');
    if (selected.some((o) => o.modifiers?.length))
      throw Error('含修改器的部件请保留独立，使用“合并”修改器引用其结果');
    if (
      selected.some(
        (o) =>
          o.paints.length ||
          o.surfaceGraph?.outputs.some((o) => o.style) ||
          o.baseRegionIds?.length ||
          o.attachId,
      )
    )
      throw Error('已有局部填色或叠放关系，请保留独立部件；线条可拖入目标对象');
    const target = selected[0];
    if (
      c.printStack &&
      selected.some((o) => o.printLayerId !== target.printLayerId)
    )
      throw Error('部件属于不同堆叠层；请先统一所属层，再合并集合');
    for (const o of selected.slice(1)) {
      target.pathIds.push(...o.pathIds);
      target.featureIds.push(...o.featureIds);
      target.regionIds.push(...o.regionIds);
      Object.assign(target.roles, o.roles);
      Object.assign(target.featureSwatches, o.featureSwatches);
      Object.assign(target.sources, o.sources);
    }
    c.objects = c.objects.filter((o) => !selected.includes(o) || o === target);
  } else if (action === 'move_paths') {
    moveCreationPaths(p, c, a);
  } else if (action === 'roles') {
    const o = object(a.objectId);
    acceptDividerGraph(o);
    for (const id of a.pathIds) {
      if (!o.pathIds.includes(id)) throw Error('请选择当前对象内部的线条');
      const previous = o.roles[id];
      o.roles[id] = a.role;
      if (
        a.role === 'divider' &&
        previous !== 'divider' &&
        !o.modifiers.some((m) => m.rolePathId === id)
      )
        o.modifiers.push({
          id: uid(),
          name:
            (p.paths.find((path) => path.id === id)?.name || '线条') +
            ' · 分区',
          type: 'split',
          enabled: true,
          targets: { kind: 'all' },
          input: { kind: 'path', id },
          joinMM: o.joinMM || 0,
          rolePathId: id,
        });
    }
    if (a.role === 'divider') acceptDividerGraph(o);
    syncHoleModifiers(p, o);
  } else if (action === 'join') {
    const o = object(a.objectId);
    const managed = new Set(
      (o.modifiers || [])
        .filter((m) => m.type === 'split' && m.rolePathId)
        .map((m) => m.rolePathId),
    );
    if (
      managed.size &&
      !o.pathIds.some((id) => o.roles[id] === 'divider' && !managed.has(id))
    )
      throw Error('此部件的连接由分区修改器管理，请在相应步骤调整端点接合范围');
    o.joinMM = number(a.joinMM, 0, 5);
  } else if (action === 'connection') {
    const o = object(a.objectId);
    if (
      o.modifiers?.some((m) => m.type === 'split' && m.rolePathId === a.pathId)
    )
      throw Error(
        '此线的连接由分区修改器管理，请调整该步骤的端点接合范围（0 表示不自动接合）',
      );
    if (!o.pathIds.includes(a.pathId) || ![0, 1].includes(a.endpoint))
      throw Error('请选择当前对象的一条补边端点');
    if (typeof a.disabled !== 'boolean') throw Error('补边开关无效');
    const key = `${a.pathId}:${a.endpoint}`;
    o.connectionDisabled ||= {};
    if (a.disabled) o.connectionDisabled[key] = true;
    else delete o.connectionDisabled[key];
    if (!Object.keys(o.connectionDisabled).length) delete o.connectionDisabled;
  } else if (action === 'closure_boundary') {
    const o = object(a.objectId),
      feature = p.model.features.find((f) => f.id === a.featureId);
    if (!feature || !o.featureIds.includes(feature.id))
      throw Error('构面不属于当前对象');
    const closure = regionClosureConnections(p, feature.regionId).find(
      (c) => c.regionId === a.regionId,
    );
    if (!closure) throw Error('请选择当前构面的封口');
    const recipe = p.model.regions.find((r) => r.id === a.regionId);
    if (a.boundaryRegionId === null) {
      delete recipe.boundaryRegionId;
      delete recipe.boundaryJoinMM;
    } else {
      if (!closure.boundaryOptions.some((b) => b.id === a.boundaryRegionId))
        throw Error('请选择该带状面已有的裁切轮廓');
      recipe.boundaryRegionId = a.boundaryRegionId;
      recipe.boundaryJoinMM = number(a.joinMM ?? 0.15, 0, 5);
    }
    // Validate the complete clipped face before returning a history entry.
    // A failed route never becomes a saved, partially applied construction.
    regionContext(p).get(feature.regionId);
  } else if (action === 'remove_connection') {
    const o = object(a.objectId);
    if (!Array.isArray(a.featureIds) || !a.featureIds.length)
      throw Error('请选择要撤销封口的构面');
    const closable = new Set(
      scene?.closures
        .filter(
          (closure) => closure.objectId === o.id && closure.kind === 'closure',
        )
        .map((closure) => closure.featureId),
    );
    for (const id of a.featureIds) {
      if (!o.featureIds.includes(id)) throw Error('构面不属于当前对象');
      if (!closable.has(id)) throw Error('该构面没有可撤销的封口');
    }
    const disabled = new Set(o.disabledClosureFeatureIds || []);
    for (const id of a.featureIds)
      if (a.disabled === false) disabled.delete(id);
      else disabled.add(id);
    if (disabled.size) o.disabledClosureFeatureIds = [...disabled];
    else delete o.disabledClosureFeatureIds;
  } else if (action === 'reorder') {
    const selected = new Set(a.objectIds),
      moving = c.objects.filter((o) => selected.has(o.id));
    const rest = c.objects.filter((o) => !selected.has(o.id)),
      at = rest.findIndex((o) => o.id === a.beforeId);
    rest.splice(at < 0 ? rest.length : at, 0, ...moving);
    c.objects = rest;
  } else if (action === 'rename_path') {
    const path = p.paths.find((p) => p.id === a.id);
    if (!path) throw Error('线条已不存在');
    path.name = a.name.trim();
  } else if (action === 'clear_paint') {
    for (const id of a.objectIds || []) {
      const o = object(id);
      o.paints = [];
      for (const output of o.surfaceGraph?.outputs || []) delete output.style;
    }
  } else throw Error('未知创作操作');
  syncPrintDimensions(p, c);
  validateCreation(c);
  return p;
}
