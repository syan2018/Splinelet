import {
  creationDocument,
  validateCreation,
  creationTopologyKey,
  regionSources,
  acceptDividerGraph,
} from './creation-schema.mjs';
import { emptyModel } from './model-schema.mjs';
import { removeSwatch } from './creation-colors.mjs';
import { regionClosureConnections, regionContext } from './region-engine.mjs';
import { modifierCommand } from './modifier-commands.mjs';
import { syncHoleModifiers } from './modifier-schema.mjs';
const uid = () => crypto.randomUUID();
export function creationCommand(project, action, a = {}, scene) {
  const p = structuredClone(project),
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
          Math.max(parent.heightMM, ...parent.paints.map((p) => p.heightMM))
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
  if (action.startsWith('modifier_')) {
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
    if (action === 'height') number(a.heightMM, 0.01, 1000);
    const targets = a.objectIds?.length
      ? scene.cells.filter((cell) => a.objectIds.includes(cell.objectId))
      : cells;
    if (!targets.length && !a.objectIds?.length)
      throw Error('请先选中一个对象或区域');
    for (const id of a.objectIds || []) {
      const o = object(id);
      if (action === 'paint') o.swatchId = a.swatchId;
      else o.heightMM = a.heightMM;
    }
    const keys = new Set(targets.map((c) => c.key)),
      touched = new Set(targets.map((c) => c.objectId));
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
        else style.heightMM = a.heightMM;
      } else if (cell.featureId) {
        const f = p.model.features.find((f) => f.id === cell.featureId);
        if (action === 'paint') {
          o.featureSwatches[f.id] = a.swatchId;
          f.color = c.swatches.find((s) => s.id === a.swatchId).color;
        } else f.heightMM = a.heightMM;
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
    for (const id of touched) {
      const o = object(id);
      if (
        targets
          .filter((cell) => cell.objectId === id)
          .every((cell) => cell.modifierResult)
      )
        continue;
      const key = scene.topologies[id]?.key;
      if (key) {
        acceptDividerGraph(o);
        o.topologyKey = key;
      }
      if (scene.topologies[id]?.legacyPartition) o.legacyPartition = true;
      o.topologyCount = scene.topologies[id]?.count;
      o.paints = (scene.modifierBaseCells || scene.cells)
        .filter(
          (cell) =>
            cell.objectId === id &&
            !cell.regionId &&
            (cell.painted || keys.has(cell.key)),
        )
        .flatMap((cell) => {
          if (cell.conflict && !keys.has(cell.key)) return cell.conflictPaints;
          return [
            {
              id: uid(),
              geometry: cell.normalizedGeometry,
              boundaryPathIds: cell.boundaryPathIds || [],
              swatchId:
                keys.has(cell.key) && action === 'paint'
                  ? a.swatchId
                  : cell.swatchId,
              heightMM:
                keys.has(cell.key) &&
                (action === 'height' || a.heightMM !== undefined)
                  ? a.heightMM
                  : cell.heightMM,
              zOffsetMM: cell.zMM - objectBottom(o),
            },
          ];
        });
    }
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
    const o = object(a.objectId),
      all = p.model.features.filter((f) => o.featureIds.includes(f.id)),
      split = all.filter((f) => splitRecipe(p.model, f.regionId)),
      features = split.length ? split : all;
    const converted = features.map((f) => f.id);
    if (!features.length) throw Error('这个对象已可直接分区');
    if (
      p.model.features.some(
        (f) => !converted.includes(f.id) && converted.includes(f.attachId),
      )
    )
      throw Error('有其他体块依附这里，请先在高级构造中调整依附关系');
    if (features.some((f) => f.mode !== 'add'))
      throw Error('切削对象请保留在高级构造中编辑');
    const old = scene.cells.filter((c) => converted.includes(c.featureId)),
      bottoms = new Set(old.map((c) => +c.bottomMM.toFixed(5)));
    if (old.length !== features.length || bottoms.size !== 1)
      throw Error('区域失效或起始高度不同，请先在高级构造中处理');
    o.zMM = old[0].bottomMM;
    o.heightMM = old[0].heightMM;
    o.paints = old.map((c) => ({
      id: uid(),
      geometry: normalize(c.geometry, p.widthMM),
      swatchId: c.swatchId,
      heightMM: c.heightMM,
      zOffsetMM: c.bottomMM - o.zMM,
    }));
    o.baseRegionIds = [];
    for (const id of o.pathIds) o.roles[id] = 'guide';
    for (const f of features) {
      const r = p.model.regions.find((r) => r.id === f.regionId),
        family = splitRecipe(p.model, r.id);
      if (family) {
        o.baseRegionIds.push(family.split.baseId);
        o.clipRegionIds = [
          ...new Set([...(o.clipRegionIds || []), ...family.clips]),
        ];
        for (const id of family.split.pathIds) {
          o.roles[id] = 'divider';
        }
        o.joinMM = Math.max(o.joinMM || 0, family.split.joinMM || 0);
      } else o.baseRegionIds.push(r.id);
    }
    o.baseRegionIds = [...new Set(o.baseRegionIds)];
    o.replacedFeatureIds = [...(o.replacedFeatureIds || []), ...converted];
    o.featureIds = o.featureIds.filter((id) => !converted.includes(id));
    o.regionIds = [];
    o.topologyKey = creationTopologyKey(p, o);
    o.topologyCount = old.length;
  } else if (action === 'combine_objects') {
    const selected = c.objects.filter((o) => a.objectIds.includes(o.id));
    if (selected.length < 2) throw Error('请多选两个部件');
    if (selected.some((o) => o.modifiers?.length))
      throw Error('含修改器的部件请保留独立，使用“合并”修改器引用其结果');
    if (
      selected.some(
        (o) => o.paints.length || o.baseRegionIds?.length || o.attachId,
      )
    )
      throw Error('已有局部填色或叠放关系，请保留独立部件；线条可拖入目标对象');
    const target = selected[0];
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
    const target = object(a.objectId),
      ids = new Set(a.pathIds),
      donors = new Set();
    acceptDividerGraph(target);
    for (const id of ids)
      if (!p.paths.some((p) => p.id === id)) throw Error('线条已不存在');
    for (const o of c.objects) {
      if (o.id !== target.id) {
        const moved = o.pathIds.filter((id) => ids.has(id));
        if (moved.length && o.modifiers?.length)
          throw Error(
            '这个部件有修改器；请保留其来源归属，可用对象引用进行组合',
          );
        if (moved.length) donors.add(o.id);
        if (moved.length && o.paints.length) {
          if (moved.length !== o.pathIds.length || o.baseRegionIds?.length)
            throw Error(
              '这个对象已有局部填色，请整体整理部件；分区线的位置可在画布中直接编辑',
            );
          if (
            o.attachId ||
            target.attachId ||
            o.zMM !== target.zMM ||
            c.objects.some((other) => other.attachId === o.id)
          )
            throw Error('这些部件的高度基准或叠放关系不同，请保留独立部件');
          target.paints.push(...o.paints);
          o.paints = [];
        }
        const ownsInput = (id) => {
          const own = regionSources(p.model, id).filter((id) =>
            o.pathIds.includes(id),
          );
          return own.length && own.every((id) => ids.has(id));
        };
        const movedFeatures = o.featureIds.filter((id) =>
          ownsInput(p.model.features.find((f) => f.id === id)?.regionId),
        );
        for (const id of movedFeatures) {
          target.featureIds.push(id);
          target.featureSwatches[id] = o.featureSwatches[id];
          delete o.featureSwatches[id];
          if (o.sources?.[id]) {
            target.sources[id] = o.sources[id];
            delete o.sources[id];
          }
        }
        o.featureIds = o.featureIds.filter((id) => !movedFeatures.includes(id));
        const movedRegions = o.regionIds.filter(ownsInput);
        target.regionIds.push(...movedRegions);
        o.regionIds = o.regionIds.filter((id) => !movedRegions.includes(id));
      }
      for (const id of ids)
        if (o.pathIds.includes(id) && o.roles[id])
          target.roles[id] = o.roles[id];
      o.pathIds = o.pathIds.filter((id) => !ids.has(id));
    }
    target.pathIds.push(...ids);
    c.objects = c.objects.filter(
      (o) =>
        !donors.has(o.id) ||
        o.pathIds.length ||
        o.featureIds.length ||
        o.regionIds.length ||
        o.paints.length ||
        o.baseRegionIds?.length ||
        o.basePathIds?.length,
    );
  } else if (action === 'roles') {
    const o = object(a.objectId);
    acceptDividerGraph(o);
    for (const id of a.pathIds) {
      if (!o.pathIds.includes(id)) throw Error('请选择当前对象内部的线条');
      o.roles[id] = a.role;
    }
    if (a.role === 'divider') acceptDividerGraph(o);
    syncHoleModifiers(p, o);
  } else if (action === 'join') {
    object(a.objectId).joinMM = number(a.joinMM, 0, 5);
  } else if (action === 'connection') {
    const o = object(a.objectId);
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
    for (const id of a.objectIds || []) object(id).paints = [];
  } else throw Error('未知创作操作');
  if (action === 'continue_partition') syncHoleModifiers(p, object(a.objectId));
  validateCreation(c);
  return p;
}
function normalize(geometry, width) {
  const scale = (a) =>
    typeof a[0] === 'number' ? a.map((v) => v / width) : a.map(scale);
  return { ...geometry, coordinates: scale(geometry.coordinates) };
}
function splitRecipe(model, id, seen = new Set()) {
  if (seen.has(id)) return null;
  seen.add(id);
  const r = model.regions.find((r) => r.id === id);
  if (r?.kind === 'split') return { split: r, clips: [] };
  if (r?.kind === 'intersection') {
    const a = splitRecipe(model, r.a, seen);
    if (a) return { ...a, clips: [...a.clips, r.b] };
    const b = splitRecipe(model, r.b, seen);
    if (b) return { ...b, clips: [...b.clips, r.a] };
  }
  return null;
}
