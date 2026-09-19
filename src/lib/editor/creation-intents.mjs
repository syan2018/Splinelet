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
        run({ kind: 'set-thickness', target, thickness });
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
      const allowed = ['name', 'visible', 'locked', 'swatchId'];
      if (
        Object.keys(request.changes || {}).some((key) => !allowed.includes(key))
      )
        throw Error('此部件属性尚需通过对应制造命令适配');
      const { swatchId, ...value } = request.changes || {};
      if (Object.keys(value).length)
        run({ kind: 'set-node', nodeId: request.id, value });
      if (swatchId !== undefined)
        run({ kind: 'set-default-appearance', nodeId: request.id, swatchId });
    }
    return {
      document,
      changedRefs: changes,
      ...(selectionIntent && { selectionIntent }),
    };
  };
}
