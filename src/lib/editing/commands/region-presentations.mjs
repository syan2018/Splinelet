import { evaluateProgram } from '../../construction/document-evaluation.mjs';
import { sameOutputRef } from '../../relief/appearance.mjs';
import { effectiveNodeState } from '../../scene/hierarchy.mjs';

const clone = (value) => structuredClone(value);

export const REGION_PRESENTATION_ACTIONS = Object.freeze([
  'set-region-presentation',
  'clear-region-presentation',
]);

const requireTarget = (document, target) => {
  if (
    target?.kind !== 'output' ||
    typeof target.ownerNodeId !== 'string' ||
    typeof target.operatorId !== 'string' ||
    typeof target.key !== 'string'
  )
    throw Error('区域展示操作需要稳定 OutputRef');
  const node = document.nodes[target.ownerNodeId];
  if (!node || node.kind !== 'shape') throw Error('区域所属部件不存在');
  if (effectiveNodeState(document, node.id).locked) throw Error('部件已锁定');
  const stage = evaluateProgram(document, node.id).regions;
  if (
    stage.status !== 'ready' ||
    !stage.value.regions.some((region) => sameOutputRef(region.ref, target))
  )
    throw Error('区域已失效，请重新求值');
  return clone(target);
};

const records = (document) => {
  document.regionPresentations ||= { overrides: {} };
  return document.regionPresentations.overrides;
};

const match = (table, target) =>
  Object.values(table).filter((item) => sameOutputRef(item.target, target));

const id = (table, idFactory) => {
  const value = idFactory();
  if (typeof value !== 'string' || !value || Object.hasOwn(table, value))
    throw Error('区域展示记录 ID 无效或重复');
  return value;
};

const patch = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw Error('区域展示值必须是对象');
  if (Object.keys(value).some((key) => !['name', 'visible'].includes(key)))
    throw Error('区域展示值包含不支持字段');
  if (!Object.keys(value).length) throw Error('区域展示值不能为空');
  if (value.name !== undefined) {
    if (typeof value.name !== 'string' || !value.name.trim())
      throw Error('区域名称不能为空');
    value.name = value.name.trim();
  }
  if (value.visible !== undefined && typeof value.visible !== 'boolean')
    throw Error('区域 visible 必须是布尔值');
  return value;
};

/**
 * Region presentation is exact OutputRef metadata for the editor only. It is
 * deliberately separate from appearance/relief/manufacturing, so renaming or
 * hiding one region cannot enable it, alter its geometry, or affect siblings.
 */
export function createRegionPresentationCommand(input) {
  const action = clone(input);
  return (document, { idFactory }) => {
    if (!REGION_PRESENTATION_ACTIONS.includes(action?.kind))
      throw Error(`不支持的区域展示动作：${action?.kind}`);
    const target = requireTarget(document, action.target);
    const table = records(document);
    const matches = match(table, target);
    if (matches.length > 1) throw Error('区域存在冲突展示记录');
    const existing = matches[0];
    if (action.kind === 'set-region-presentation') {
      const value = patch(clone(action.value));
      const recordId = existing?.id || id(table, idFactory);
      table[recordId] = {
        id: recordId,
        target,
        ...(existing?.name === undefined && value.name === undefined
          ? {}
          : { name: value.name ?? existing.name }),
        ...(existing?.visible === undefined && value.visible === undefined
          ? {}
          : { visible: value.visible ?? existing.visible }),
      };
      return { document, changedRefs: [target] };
    }
    if (action.fields !== undefined) {
      if (
        !Array.isArray(action.fields) ||
        !action.fields.length ||
        action.fields.some((field) => !['name', 'visible'].includes(field)) ||
        new Set(action.fields).size !== action.fields.length
      )
        throw Error('要清除的区域展示字段无效');
    }
    if (!existing) return { document, changedRefs: [] };
    const fields = action.fields || ['name', 'visible'];
    const next = { ...existing };
    for (const field of fields) delete next[field];
    if (next.name === undefined && next.visible === undefined)
      delete table[existing.id];
    else table[existing.id] = next;
    return { document, changedRefs: [target] };
  };
}
