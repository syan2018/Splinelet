import { validateDocument } from '../document/schema.mjs';
import { createCommandIdAllocator } from '../editing/command-ids.mjs';
import { createAuthoringCommand } from '../editing/commands/authoring.mjs';
import { resolveThicknessMM } from '../manufacturing/dimensions.mjs';
import { childrenOf, effectiveNodeState } from '../scene/hierarchy.mjs';

export const CREATION_BASIC_INTENTS = Object.freeze([
  'rename_path',
  'move_paths',
  'reorder',
  'combine_objects',
  'print_enable',
  'print_assign',
]);

const clone = (value) => structuredClone(value);
const nodeRef = (id) => ({ kind: 'node', id });
const fallbackRelief = () => ({
  enabled: false,
  thickness: { kind: 'mm', value: 1 },
  mode: 'add',
  placement: { kind: 'free', zMM: 0 },
});

const writableShape = (document, id) => {
  const node = document.nodes[id];
  if (node?.kind !== 'shape') throw Error('部件已不存在');
  if (effectiveNodeState(document, id).locked) throw Error('部件已锁定');
  return node;
};

const scalarPlacement = (placement) => {
  if (placement?.kind === 'free') return placement.zMM;
  if (placement?.kind === 'attached' || placement?.kind === 'layer')
    return placement.offsetMM;
  return 0;
};

const ownerOverrides = (document, ownerNodeId) =>
  Object.values(document.reliefDefinitions.overrides).filter(
    (item) => item.target.ownerNodeId === ownerNodeId,
  );

const ensureDefault = (document, ownerNodeId) => {
  document.reliefDefinitions.defaults[ownerNodeId] ||= fallbackRelief();
  return document.reliefDefinitions.defaults[ownerNodeId];
};

const attachmentTargets = (document, ownerNodeId) => {
  const values = [
    document.reliefDefinitions.defaults[ownerNodeId],
    ...ownerOverrides(document, ownerNodeId).map((item) => item.value),
  ];
  return values.flatMap((value) =>
    value?.placement?.kind === 'attached' &&
    value.placement.target.kind === 'node'
      ? [value.placement.target.id]
      : [],
  );
};

const assertNoAttachmentCycle = (document, ownerNodeId) => {
  const pending = [...attachmentTargets(document, ownerNodeId)];
  const seen = new Set();
  while (pending.length) {
    const id = pending.pop();
    if (id === ownerNodeId) throw Error('部件依附会形成循环');
    if (seen.has(id)) continue;
    seen.add(id);
    pending.push(...attachmentTargets(document, id));
  }
};

const convertThickness = (thickness, layerHeightMM) => {
  const { mm } = resolveThicknessMM(thickness, layerHeightMM);
  return {
    kind: 'layers',
    count: Math.max(1, Math.round(mm / layerHeightMM)),
  };
};

const setObjectPlacement = (document, request) => {
  const node = writableShape(document, request.id);
  if (document.manufacturing.layerOrder.length)
    throw Error('打印分层已接管高度：请调整所属堆叠层');
  const changes = request.changes || {};
  const keys = Object.keys(changes).filter((key) =>
    ['zMM', 'attachId'].includes(key),
  );
  if (!keys.length) return { document, changedRefs: [] };
  if (keys.length !== Object.keys(changes).length)
    throw Error('部件放置只能修改 zMM 或 attachId');
  if (changes.zMM !== undefined && !Number.isFinite(changes.zMM))
    throw Error('部件起始高度必须是有限数');
  if (
    changes.attachId !== undefined &&
    (typeof changes.attachId !== 'string' || changes.attachId === node.id)
  )
    throw Error('依附对象无效');
  if (changes.attachId) writableShape(document, changes.attachId);

  const fallback = ensureDefault(document, node.id);
  const records = [
    fallback,
    ...ownerOverrides(document, node.id).map((x) => x.value),
  ];
  if (changes.zMM !== undefined) {
    const current = request.currentZMM ?? scalarPlacement(fallback.placement);
    if (!Number.isFinite(current)) throw Error('当前部件高度无法唯一确定');
    const delta = changes.zMM - current;
    for (const value of records) {
      const placement = value.placement || fallback.placement;
      if (placement.kind === 'attached')
        value.placement = {
          ...placement,
          offsetMM: placement.offsetMM + delta,
        };
      else
        value.placement = {
          kind: 'free',
          zMM: scalarPlacement(placement) + delta,
        };
    }
  }
  if (changes.attachId !== undefined)
    for (const value of records) {
      const offset = scalarPlacement(value.placement || fallback.placement);
      value.placement = changes.attachId
        ? {
            kind: 'attached',
            target: nodeRef(changes.attachId),
            offsetMM: offset,
          }
        : { kind: 'free', zMM: offset };
    }
  assertNoAttachmentCycle(document, node.id);
  validateDocument(document);
  return {
    document,
    changedRefs: [
      nodeRef(node.id),
      ...ownerOverrides(document, node.id).map((item) => clone(item.target)),
    ],
  };
};

const enablePrintStack = (document, request, context) => {
  if (document.manufacturing.layerOrder.length)
    throw Error('工程已启用打印分层');
  if (request.confirm !== true) throw Error('转换旧高度与依附关系前需要确认');
  const layerHeightMM = request.layerHeightMM ?? 0.2;
  if (!Number.isFinite(layerHeightMM) || layerHeightMM <= 0)
    throw Error('打印层高必须是正数');
  createAuthoringCommand({ kind: 'set-print-settings', layerHeightMM })(
    document,
    context,
  );
  const before = new Set(Object.keys(document.manufacturing.layers));
  createAuthoringCommand({ kind: 'create-print-layer', name: '堆叠层 1' })(
    document,
    context,
  );
  const layerId = Object.keys(document.manufacturing.layers).find(
    (id) => !before.has(id),
  );
  if (!layerId) throw Error('打印层创建失败');
  const changedRefs = [];
  for (const node of Object.values(document.nodes)) {
    if (node.kind !== 'shape') continue;
    writableShape(document, node.id);
    const fallback = ensureDefault(document, node.id);
    fallback.thickness = convertThickness(fallback.thickness, layerHeightMM);
    fallback.placement = { kind: 'layer', layerId, offsetMM: 0 };
    for (const item of ownerOverrides(document, node.id)) {
      item.value.thickness = convertThickness(
        item.value.thickness || fallback.thickness,
        layerHeightMM,
      );
      item.value.placement = { kind: 'layer', layerId, offsetMM: 0 };
      changedRefs.push(clone(item.target));
    }
    changedRefs.push(nodeRef(node.id));
  }
  validateDocument(document);
  return { document, changedRefs };
};

const assignPrintLayer = (document, request) => {
  if (!document.manufacturing.layerOrder.length)
    throw Error('请先启用打印分层');
  if (!document.manufacturing.layers[request.layerId])
    throw Error('堆叠层不存在');
  if (!Array.isArray(request.objectIds) || !request.objectIds.length)
    throw Error('请先选择部件');
  const changedRefs = [];
  for (const id of new Set(request.objectIds)) {
    writableShape(document, id);
    const fallback = ensureDefault(document, id);
    fallback.placement = {
      kind: 'layer',
      layerId: request.layerId,
      offsetMM: 0,
    };
    for (const item of ownerOverrides(document, id)) {
      item.value.placement = {
        kind: 'layer',
        layerId: request.layerId,
        offsetMM: 0,
      };
      changedRefs.push(clone(item.target));
    }
    changedRefs.push(nodeRef(id));
  }
  validateDocument(document);
  return { document, changedRefs };
};

/** Compile established CreationWorkspace payloads into one canonical edit. */
export function createCreationBasicIntent(action, args, displayed) {
  const request = clone(args || {});
  const view = clone(displayed);
  if (!CREATION_BASIC_INTENTS.includes(action))
    throw Error(`未知 Creation 基本动作：${action}`);
  return (initialDocument, context) => {
    if (context.epoch !== view.epoch || context.revision !== view.revision)
      throw Error('创作视图已失效，请等待当前工程求值');
    let document = initialDocument;
    const run = (intent) => {
      const result = createAuthoringCommand(intent)(document, context);
      document = result.document;
      return result;
    };
    if (action === 'rename_path') {
      const ref = view.identities?.paths?.[request.id];
      if (ref?.kind !== 'path') throw Error('线条已不存在');
      if (typeof request.name !== 'string' || !request.name.trim())
        throw Error('线条名称不能为空');
      return run({
        kind: 'set-paths',
        pathRefs: [ref],
        value: { name: request.name.trim() },
      });
    }
    if (action === 'move_paths') {
      writableShape(document, request.objectId);
      if (!Array.isArray(request.pathIds) || !request.pathIds.length)
        throw Error('请先选择要移动的线条');
      const refs = [...new Set(request.pathIds)].map((id) => {
        const ref = view.identities?.paths?.[id];
        if (ref?.kind !== 'path') throw Error('线条选区已失效');
        return ref;
      });
      let targetSketch = Object.values(document.sketches)
        .filter((sketch) => sketch.ownerNodeId === request.objectId)
        .sort((left, right) => left.id.localeCompare(right.id))[0];
      if (!targetSketch) {
        const id = createCommandIdAllocator(document, context.idFactory)();
        targetSketch = {
          id,
          ownerNodeId: request.objectId,
          vertices: {},
          edges: {},
          paths: {},
        };
        document.sketches[id] = targetSketch;
      }
      const grouped = Map.groupBy(refs, (ref) => ref.sketchId);
      const changedRefs = [];
      let selectionIntent;
      for (const [sourceSketchId, items] of grouped) {
        if (sourceSketchId === targetSketch.id) continue;
        const result = run({
          kind: 'transfer-source',
          sourceSketchId,
          targetSketchId: targetSketch.id,
          pathIds: items.map((item) => item.id),
          keepWorld: true,
        });
        changedRefs.push(...(result.changedRefs || []));
        selectionIntent = result.selectionIntent || selectionIntent;
      }
      return {
        document,
        changedRefs,
        ...(selectionIntent && { selectionIntent }),
      };
    }
    if (action === 'reorder') {
      if (!Array.isArray(request.objectIds) || !request.objectIds.length)
        throw Error('请选择要排序的部件');
      const ids = [...new Set(request.objectIds)];
      const nodes = ids.map((id) => writableShape(document, id));
      const parentId = nodes[0].parentId;
      if (nodes.some((node) => node.parentId !== parentId))
        throw Error('只能在同一组内调整部件顺序');
      const siblings = childrenOf(document, parentId).filter(
        (node) => !ids.includes(node.id),
      );
      const index = request.beforeId
        ? siblings.findIndex((node) => node.id === request.beforeId)
        : siblings.length;
      if (request.beforeId && index < 0)
        throw Error('排序目标不在同一组或已失效');
      return run({
        kind: 'reparent-nodes',
        nodeIds: ids,
        parentId,
        index,
        keepWorld: true,
      });
    }
    if (action === 'combine_objects') {
      if (!Array.isArray(request.objectIds) || request.objectIds.length < 2)
        throw Error('请多选两个部件');
      const selected = new Set(request.objectIds);
      const ordered = (view.creation?.objects || []).filter((item) =>
        selected.has(item.id),
      );
      if (ordered.length !== selected.size) throw Error('部件选区已失效');
      ordered.forEach((item) => writableShape(document, item.id));
      const target = ordered[0];
      const sources = ordered.slice(1);
      if (document.manufacturing.layerOrder.length)
        throw Error('打印分层部件需先统一并解除逐层放置后再合并');
      let targetSketch = Object.values(document.sketches)
        .filter((sketch) => sketch.ownerNodeId === target.id)
        .sort((left, right) => left.id.localeCompare(right.id))[0];
      if (!targetSketch) {
        const id = createCommandIdAllocator(document, context.idFactory)();
        targetSketch = {
          id,
          ownerNodeId: target.id,
          vertices: {},
          edges: {},
          paths: {},
        };
        document.sketches[id] = targetSketch;
      }
      for (const item of ordered) {
        if (item.attachId) throw Error('已有依附关系的部件不能直接合并');
        const program = document.programs[document.nodes[item.id].programId];
        if (
          Object.values(program.operators).some(
            (operator) =>
              !['source', 'fill', 'curve-collect'].includes(operator.type),
          )
        )
          throw Error('含修改器或派生构造的部件不能直接整理为一个部件');
        if (
          (view.cells || []).some(
            (cell) => cell.objectId === item.id && cell.painted,
          ) ||
          Object.values(document.appearances.overrides).some(
            (entry) => entry.target.ownerNodeId === item.id,
          ) ||
          Object.values(document.reliefDefinitions.overrides).some(
            (entry) => entry.target.ownerNodeId === item.id,
          )
        )
          throw Error('已有局部颜色或厚度的部件不能直接合并');
        if (
          item.pathIds.some(
            (id) => !['boundary', 'guide'].includes(item.roles[id]),
          )
        )
          throw Error('只有普通边界或参考线部件可直接整理为一个部件');
      }
      const changedRefs = [];
      const movedRefs = new Map([
        ['boundary', []],
        ['guide', []],
      ]);
      for (const item of sources) {
        const rolesByPathId = new Map(
          item.pathIds.map((id) => [
            view.identities.paths[id]?.id,
            item.roles[id] || 'guide',
          ]),
        );
        const grouped = Map.groupBy(
          item.pathIds.map((id) => {
            const ref = view.identities.paths[id];
            if (ref?.kind !== 'path') throw Error('线条选区已失效');
            return ref;
          }),
          (ref) => ref.sketchId,
        );
        for (const [sourceSketchId, refs] of grouped) {
          const result = run({
            kind: 'transfer-source',
            sourceSketchId,
            targetSketchId: targetSketch.id,
            pathIds: refs.map((ref) => ref.id),
            keepWorld: true,
          });
          changedRefs.push(...(result.changedRefs || []));
          for (const ref of refs)
            movedRefs.get(rolesByPathId.get(ref.id)).push({
              kind: 'path',
              sketchId: targetSketch.id,
              id: ref.id,
            });
        }
      }
      const removed = run({
        kind: 'delete-nodes',
        nodeIds: sources.map((item) => item.id),
      });
      changedRefs.push(...(removed.changedRefs || []));
      for (const [role, pathRefs] of movedRefs)
        if (pathRefs.length) {
          const roles = run({ kind: 'set-path-roles', pathRefs, role });
          changedRefs.push(...(roles.changedRefs || []));
        }
      return {
        document,
        changedRefs,
        selectionIntent: {
          scope: 'objects',
          entityRefs: [nodeRef(target.id)],
          activeRef: nodeRef(target.id),
        },
      };
    }
    if (action === 'print_enable')
      return enablePrintStack(document, request, context);
    if (action === 'print_assign') return assignPrintLayer(document, request);
    throw Error(`未知 Creation 基本动作：${action}`);
  };
}

export function createObjectPlacementIntent(args, displayed) {
  const request = clone(args || {});
  const view = clone(displayed);
  const object = view.creation?.objects?.find((item) => item.id === request.id);
  request.currentZMM = object?.zMM;
  return (document, context) => {
    if (context.epoch !== view.epoch || context.revision !== view.revision)
      throw Error('创作视图已失效，请等待当前工程求值');
    return setObjectPlacement(document, request);
  };
}
