import { createAuthoringCommand } from '../editing/commands/authoring.mjs';
import { outputIdentity } from '../relief/appearance.mjs';

export const CREATION_INTENTS = Object.freeze([
  'paint',
  'height',
  'clear_paint',
  'swatch',
  'delete_swatch',
  'object',
  'new_object',
  'modifier_update',
  'print_settings',
  'print_layer_add',
  'print_layer_rename',
  'print_layer_move',
  'print_layer_remove',
]);

// The original workspace supplies intent + the revision of its displayed view.
// This adapter never accepts a mutated legacy Project or compiles old geometry.
export function createCreationIntent(action, args, displayed) {
  const request = structuredClone(args || {});
  const view = structuredClone(displayed);
  if (!CREATION_INTENTS.includes(action))
    throw Error(`创作动作尚未适配：${action}`);
  if (
    !view ||
    typeof view.epoch !== 'string' ||
    !Number.isInteger(view.revision)
  )
    throw Error('创作视图必须携带 epoch 和 revision');
  if (view.previewId !== undefined && view.previewId !== null)
    throw Error('预览视图不能用于提交正式创作命令');
  return (initialDocument, context) => {
    if (context.epoch !== view.epoch || context.revision !== view.revision)
      throw Error('创作视图已失效，请等待当前工程求值');
    let document = initialDocument;
    let selectionIntent;
    const changes = [];
    const run = (intent) => {
      const result = createAuthoringCommand(intent)(document, context);
      document = result.document;
      changes.push(...(result.changedRefs || []));
      selectionIntent = result.selectionIntent || selectionIntent;
    };
    const requirePrintStack = () => {
      if (!document.manufacturing.layerOrder.length)
        throw Error('请先启用打印分层');
    };
    const targets = () => {
      const byKey = new Map((view.cells || []).map((cell) => [cell.key, cell]));
      if (byKey.size !== (view.cells || []).length)
        throw Error('区域视图身份冲突');
      const ownerIds = new Set(request.objectIds || []);
      for (const id of ownerIds)
        if (document.nodes[id]?.kind !== 'shape') throw Error('请指定当前部件');
      const selected = ownerIds.size
        ? [...byKey.values()].filter((cell) => ownerIds.has(cell.objectId))
        : (request.cellKeys || []).map((key) => {
            const cell = byKey.get(key);
            if (!cell) throw Error('区域选区已失效');
            return cell;
          });
      if (
        view.errors?.some(
          (error) =>
            ownerIds.has(error.objectId) ||
            selected.some((cell) => cell.objectId === error.objectId),
        )
      )
        throw Error('选中部件求值失败，请先修复来源');
      const refs = selected.map((cell) => {
        if (
          cell.outputRef?.kind !== 'output' ||
          cell.outputRef.ownerNodeId !== cell.objectId
        )
          throw Error('区域视图缺少完整输出身份');
        return cell.outputRef;
      });
      return [
        ...new Map(refs.map((ref) => [outputIdentity(ref), ref])).values(),
      ];
    };
    if (action === 'paint') {
      const refs = targets();
      if (!refs.length && !request.objectIds?.length)
        throw Error('请先选择区域或部件');
      let swatchId = request.swatchId;
      if (request.color !== undefined) {
        const existing = Object.values(document.appearances.swatches).find(
          (swatch) =>
            swatch.color.toLowerCase() === request.color.toLowerCase(),
        );
        if (existing) swatchId = existing.id;
        else {
          const before = new Set(Object.keys(document.appearances.swatches));
          run({
            kind: 'create-swatch',
            name: request.name || request.color,
            color: request.color,
          });
          swatchId = Object.keys(document.appearances.swatches).find(
            (id) => !before.has(id),
          );
        }
      }
      for (const target of refs)
        run({ kind: 'paint-region', target, swatchId });
      for (const nodeId of request.objectIds || [])
        run({ kind: 'set-default-appearance', nodeId, swatchId });
    } else if (action === 'height') {
      const refs = targets();
      if (!refs.length) throw Error('请先选择可调整厚度的区域');
      const thickness =
        request.heightLayers !== undefined
          ? { kind: 'layers', count: request.heightLayers }
          : { kind: 'mm', value: request.heightMM };
      if (
        (thickness.kind === 'mm' &&
          (!Number.isFinite(thickness.value) || thickness.value <= 0)) ||
        (thickness.kind === 'layers' &&
          (!Number.isInteger(thickness.count) || thickness.count <= 0))
      )
        throw Error('厚度必须为正数；打印层数必须为正整数');
      for (const target of refs)
        run({
          kind: 'set-relief',
          target,
          value: { enabled: true, thickness },
        });
    } else if (action === 'clear_paint') {
      for (const target of targets())
        run({ kind: 'clear-region-paint', target });
    } else if (action === 'swatch') {
      run({ ...request, kind: request.id ? 'set-swatch' : 'create-swatch' });
    } else if (action === 'delete_swatch') {
      run({ ...request, kind: 'delete-swatch' });
    } else if (action === 'new_object') {
      run({ kind: 'create-shape', name: request.name || '新部件' });
    } else if (action === 'object') {
      const allowed = [
        'name',
        'visible',
        'locked',
        'swatchId',
        'printable',
        'partId',
      ];
      if (
        Object.keys(request.changes || {}).some((key) => !allowed.includes(key))
      )
        throw Error('此部件属性尚需通过对应制造命令适配');
      const { swatchId, printable, partId, ...value } = request.changes || {};
      if (Object.keys(value).length)
        run({ kind: 'set-node', nodeId: request.id, value });
      if (swatchId !== undefined)
        run({ kind: 'set-default-appearance', nodeId: request.id, swatchId });
      if (printable !== undefined) {
        if (typeof printable !== 'boolean')
          throw Error('参与成品导出必须是布尔值');
        run({
          kind: 'set-manufacturing-excluded',
          target: { kind: 'node', id: request.id },
          excluded: !printable,
        });
      }
      if (partId !== undefined)
        run({
          kind: 'set-manufacturing-part',
          target: { kind: 'node', id: request.id },
          partId,
        });
    } else if (action === 'modifier_update') {
      const changes = request.changes || {};
      if (
        request.sourceFeatureId !== undefined ||
        Object.keys(changes).some((key) => key !== 'enabled')
      )
        throw Error('此修改器属性尚无等价 V4 算子命令');
      if (typeof changes.enabled !== 'boolean')
        throw Error('修改器启用状态必须是布尔值');
      run({
        kind: 'set-operator',
        ownerNodeId: request.objectId,
        operatorId: request.modifierId,
        enabled: changes.enabled,
      });
    } else if (action === 'print_settings') {
      requirePrintStack();
      run({ kind: 'set-print-settings', layerHeightMM: request.layerHeightMM });
    } else if (action === 'print_layer_add') {
      requirePrintStack();
      run({
        kind: 'create-print-layer',
        name:
          request.name ||
          `堆叠层 ${document.manufacturing.layerOrder.length + 1}`,
      });
    } else if (action === 'print_layer_rename') {
      requirePrintStack();
      run({
        kind: 'rename-print-layer',
        id: request.layerId,
        name: request.name,
      });
    } else if (action === 'print_layer_move') {
      requirePrintStack();
      if (![1, -1].includes(request.direction))
        throw Error('层顺序调整方向无效');
      const order = [...document.manufacturing.layerOrder];
      const index = order.indexOf(request.layerId);
      if (index < 0) throw Error('打印层不存在');
      const next = index + request.direction;
      if (next >= 0 && next < order.length) {
        [order[index], order[next]] = [order[next], order[index]];
        run({ kind: 'set-print-settings', layerOrder: order });
      }
    } else if (action === 'print_layer_remove') {
      requirePrintStack();
      if (document.manufacturing.layerOrder.length <= 1)
        throw Error('至少保留一个堆叠层');
      run({ kind: 'delete-print-layer', id: request.layerId });
    }
    return {
      document,
      changedRefs: changes,
      ...(selectionIntent && { selectionIntent }),
    };
  };
}
