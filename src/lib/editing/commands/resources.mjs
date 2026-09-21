import { effectiveNodeState } from '../../scene/hierarchy.mjs';

export const RESOURCE_ACTIONS = Object.freeze([
  'create-swatch',
  'set-swatch',
  'delete-swatch',
  'set-default-appearance',
  'create-print-layer',
  'rename-print-layer',
  'delete-print-layer',
  'create-part',
  'rename-part',
  'delete-part',
  'set-slicer-template',
]);

const requireItem = (table, id, label) => {
  if (!Object.hasOwn(table, id)) throw Error(`${label}不存在：${id}`);
  return table[id];
};
const name = (value) => {
  if (typeof value !== 'string' || !value.trim()) throw Error('名称不能为空');
  return value.trim();
};
const color = (value) => {
  if (typeof value !== 'string' || !/^#[0-9a-f]{6}$/i.test(value))
    throw Error('颜色必须为六位十六进制色值');
  return value.toLowerCase();
};
const newId = (table, idFactory) => {
  const id = idFactory();
  if (typeof id !== 'string' || !id || Object.hasOwn(table, id))
    throw Error('资源 ID 无效或重复');
  return id;
};
const replacement = (table, action, used, label) => {
  if (action.replacementId !== undefined) {
    if (action.replacementId === action.id) throw Error('替代资源不能是自身');
    requireItem(table, action.replacementId, label);
  } else if (used) throw Error(`${label}仍被使用，请指定替代资源`);
};

// Resource edits enter the same transaction as geometry edits. Deleting a
// referenced resource never guesses a replacement from table order.
export function createResourceCommand(input) {
  const action = structuredClone(input);
  return (document, { idFactory }) => {
    const swatches = document.appearances.swatches;
    const manufacturing = document.manufacturing;
    let changedRefs = [];
    if (action.kind === 'create-swatch') {
      const id = newId(swatches, idFactory);
      swatches[id] = {
        id,
        name: name(action.name),
        color: color(action.color),
      };
    } else if (action.kind === 'set-swatch') {
      const swatch = requireItem(swatches, action.id, '色卡');
      if (action.name !== undefined) swatch.name = name(action.name);
      if (action.color !== undefined) swatch.color = color(action.color);
    } else if (action.kind === 'delete-swatch') {
      requireItem(swatches, action.id, '色卡');
      const values = [
        ...Object.values(document.appearances.defaults),
        ...Object.values(document.appearances.overrides).map(
          (item) => item.value,
        ),
      ].filter((value) => value.swatchId === action.id);
      replacement(swatches, action, values.length > 0, '色卡');
      for (const value of values) value.swatchId = action.replacementId;
      delete swatches[action.id];
    } else if (action.kind === 'set-default-appearance') {
      const node = requireItem(document.nodes, action.nodeId, '部件');
      if (node.kind !== 'shape') throw Error('只能设置部件默认颜色');
      if (effectiveNodeState(document, node.id).locked)
        throw Error('部件已锁定');
      if (action.swatchId === null)
        delete document.appearances.defaults[node.id];
      else {
        requireItem(swatches, action.swatchId, '色卡');
        document.appearances.defaults[node.id] = { swatchId: action.swatchId };
      }
      changedRefs = [{ kind: 'node', id: node.id }];
    } else if (action.kind === 'set-slicer-template') {
      if (
        action.template !== null &&
        (!action.template ||
          typeof action.template !== 'object' ||
          Array.isArray(action.template))
      )
        throw Error('切片模板必须是对象或 null');
      manufacturing.slicerTemplate = structuredClone(action.template);
    } else if (['create-print-layer', 'create-part'].includes(action.kind)) {
      const layer = action.kind === 'create-print-layer';
      const table = layer ? manufacturing.layers : manufacturing.parts;
      const id = newId(table, idFactory);
      table[id] = {
        id,
        name: name(action.name ?? (layer ? '打印层' : '制造零件')),
      };
      if (layer) manufacturing.layerOrder.push(id);
    } else if (['rename-print-layer', 'rename-part'].includes(action.kind)) {
      const table =
        action.kind === 'rename-part'
          ? manufacturing.parts
          : manufacturing.layers;
      requireItem(table, action.id, '资源').name = name(action.name);
    } else if (action.kind === 'delete-print-layer') {
      requireItem(manufacturing.layers, action.id, '打印层');
      const placements = [
        ...Object.values(document.reliefDefinitions.defaults),
        ...Object.values(document.reliefDefinitions.overrides).map(
          (item) => item.value,
        ),
      ]
        .map((value) => value.placement)
        .filter(
          (placement) =>
            placement?.kind === 'layer' && placement.layerId === action.id,
        );
      replacement(
        manufacturing.layers,
        action,
        placements.length > 0,
        '打印层',
      );
      for (const placement of placements)
        placement.layerId = action.replacementId;
      delete manufacturing.layers[action.id];
      manufacturing.layerOrder = manufacturing.layerOrder.filter(
        (id) => id !== action.id,
      );
    } else if (action.kind === 'delete-part') {
      requireItem(manufacturing.parts, action.id, '零件');
      const assignments = Object.values(manufacturing.assignments).filter(
        (item) => item.partId === action.id,
      );
      const isDefault = manufacturing.defaultPartId === action.id;
      replacement(
        manufacturing.parts,
        action,
        isDefault || assignments.length > 0,
        '零件',
      );
      for (const assignment of assignments)
        assignment.partId = action.replacementId;
      if (isDefault) manufacturing.defaultPartId = action.replacementId;
      delete manufacturing.parts[action.id];
    } else throw Error(`不支持的资源动作：${action.kind}`);
    return { document, changedRefs };
  };
}
