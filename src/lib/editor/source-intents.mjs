import {
  createSourceCommand,
  createSourceCommandBatch,
} from '../editing/commands/source.mjs';
import {
  inverseTransform,
  transformPoint,
  worldMatrix,
} from '../scene/transforms.mjs';
import { sourceViewToWorld } from './source-view.mjs';
import { resolveRelation } from '../geometry/relations.mjs';

const intentKinds = new Set([
  'move-anchor',
  'move-anchors',
  'move-handle',
  'split-span',
  'set-handle-mode',
  'set-handle-modes',
]);
const targetKind = (kind) =>
  ({
    'move-anchor': 'vertex',
    'move-anchors': 'vertex',
    'move-handle': 'edge-end',
    'split-span': 'edge',
    'set-handle-mode': 'vertex',
    'set-handle-modes': 'vertex',
  })[kind];
const refKey = (ref) =>
  JSON.stringify(
    ref.kind === 'edge-end'
      ? [ref.kind, ref.sketchId, ref.edgeId, ref.end]
      : [ref.kind, ref.sketchId, ref.id],
  );
const samePoint = (left, right) => left?.x === right?.x && left?.y === right?.y;
const targetFromView = (view, identityId, kind) => {
  const target = view.source.identities?.byId[identityId];
  if (!target || target.kind !== targetKind(kind))
    throw Error('源选区身份已失效');
  return target;
};
const uniqueChangedRefs = (refs) => [
  ...new Map(refs.map((ref) => [JSON.stringify(ref), ref])).values(),
];

/** Source gestures resolve stable identities in their captured view, never array indices. */
export function createSourceIntent(request, displayed) {
  const action = structuredClone(request);
  const view = Object.isFrozen(displayed)
    ? displayed
    : structuredClone(displayed);
  if (!intentKinds.has(action?.kind)) throw Error('源编辑动作尚未适配');
  if (
    typeof view?.epoch !== 'string' ||
    !Number.isInteger(view.revision) ||
    !view.source
  )
    throw Error('源编辑需要携带当前会话身份的视图');
  if (view.previewId != null) throw Error('源手势必须从已提交视图开始');
  let batchItems;
  if (action.kind === 'move-anchors' || action.kind === 'set-handle-modes') {
    if (!Array.isArray(action.items) || !action.items.length)
      throw Error('批量源编辑需要非空 items');
    const byTarget = new Map();
    for (const item of action.items) {
      const target = targetFromView(view, item?.identityId, action.kind);
      const key =
        action.kind === 'set-handle-modes'
          ? JSON.stringify([item?.pathId ?? '', refKey(target)])
          : refKey(target);
      const previous = byTarget.get(key);
      if (
        previous &&
        action.kind === 'move-anchors' &&
        !samePoint(previous.item.pixelPoint, item?.pixelPoint)
      )
        throw Error('同一源目标包含冲突位置');
      if (!previous) byTarget.set(key, { item, target });
    }
    batchItems = [...byTarget.values()];
  }
  const target = batchItems
    ? null
    : targetFromView(view, action.identityId, action.kind);
  return (document, context) => {
    if (context.epoch !== view.epoch || context.revision !== view.revision)
      throw Error('源视图已失效，请重新选择');
    const requireSketch = (itemTarget) => {
      const sketch = document.sketches[itemTarget.sketchId];
      if (!sketch) throw Error('线条来源不存在');
      return sketch;
    };
    const selectedPath = (item, itemTarget, sketch, kind) => {
      const paths = view.source.paths.filter(
        (path) =>
          (!item.pathId || path.id === item.pathId) &&
          (kind === 'set-handle-mode' || kind === 'set-handle-modes'
            ? path.identity.anchorIds
            : path.identity.handleIds.flat()
          ).includes(item.identityId),
      );
      if (paths.length !== 1) throw Error('请明确选择控制柄所属路径');
      const ref = view.source.identities.byId[paths[0].identity.pathId];
      if (ref?.sketchId !== sketch.id || !sketch.paths[ref.id])
        throw Error('路径来源已失效');
      return ref.id;
    };
    const localPoint = (itemTarget, pixelPoint) => {
      const sketch = requireSketch(itemTarget);
      return transformPoint(
        inverseTransform(worldMatrix(document, sketch.ownerNodeId)),
        sourceViewToWorld(view.source.frame, pixelPoint),
      );
    };
    const runBatch = (commands, { pointBatch = false } = {}) => {
      const batch = pointBatch
        ? createSourceCommandBatch(document, {
            sourceDelta: context.sourceDelta === true,
          })
        : null;
      let current = batch?.document || document;
      const changedRefs = [];
      for (const command of commands) {
        const result = createSourceCommand(command)(current, {
          ...context,
          ...(batch ? { sourceBatch: batch } : {}),
        });
        current = result.document;
        changedRefs.push(...(result.changedRefs || []));
      }
      if (batch) current = batch.finish();
      return {
        document: current,
        changedRefs: uniqueChangedRefs(changedRefs),
      };
    };
    if (action.kind === 'move-anchors')
      return runBatch(
        batchItems.map(({ item, target: itemTarget }) => ({
          kind: 'set-vertex',
          sketchId: itemTarget.sketchId,
          vertexId: itemTarget.id,
          value: localPoint(itemTarget, item.pixelPoint),
        })),
        { pointBatch: true },
      );
    if (action.kind === 'set-handle-modes')
      return runBatch(
        batchItems.map(({ item, target: itemTarget }) => {
          const sketch = requireSketch(itemTarget);
          return {
            kind: 'set-path-handle-mode',
            sketchId: sketch.id,
            pathId: selectedPath(item, itemTarget, sketch, action.kind),
            vertexId: itemTarget.id,
            mode: action.mode,
          };
        }),
      );
    const sketch = requireSketch(target);
    if (action.kind === 'set-handle-mode')
      return createSourceCommand({
        kind: 'set-path-handle-mode',
        sketchId: sketch.id,
        pathId: selectedPath(action, target, sketch, action.kind),
        vertexId: target.id,
        mode: action.mode,
      })(document, context);
    if (action.kind === 'split-span') {
      const path = view.source.paths.find((item) => item.id === action.pathId);
      const index = path?.identity.edgeIds.indexOf(action.identityId) ?? -1;
      if (index < 0) throw Error('曲线段不属于当前路径');
      const ref = view.source.identities.byId[path.identity.pathId];
      const uses = sketch.paths[ref?.id]?.edges.filter(
        (use) => use.edgeId === target.id,
      );
      if (uses?.length !== 1) throw Error('曲线段使用位置不唯一');
      return createSourceCommand({
        kind: 'split-edge',
        sketchId: sketch.id,
        edgeId: target.id,
        t: uses[0].reversed ? 1 - action.t : action.t,
      })(document, context);
    }
    const local = localPoint(target, action.pixelPoint);
    if (action.kind === 'move-anchor')
      return createSourceCommand({
        kind: 'set-vertex',
        sketchId: sketch.id,
        vertexId: target.id,
        value: local,
      })(document, context);
    const edge = sketch.edges[target.edgeId];
    if (!edge) throw Error('控制柄来源不存在');
    const vertexId =
      target.end === 'start' ? edge.startVertexId : edge.endVertexId;
    const position = sketch.vertices[vertexId]?.position;
    let anchor = position?.value;
    if (position?.kind === 'relation') {
      const resolved = resolveRelation({
        document,
        sketch,
        target: { kind: 'vertex', sketchId: sketch.id, id: vertexId },
        relationId: position.relationId,
      });
      if (resolved.status !== 'ready') throw Error('控制柄的端点关系尚未解算');
      anchor = resolved.value;
      if (!Array.isArray(anchor)) anchor = [anchor.x, anchor.y];
    }
    if (!anchor) throw Error('控制柄端点不存在');
    return createSourceCommand({
      kind: 'move-path-handle',
      sketchId: sketch.id,
      pathId: selectedPath(action, target, sketch, action.kind),
      edgeId: edge.id,
      end: target.end,
      vector: [local[0] - anchor[0], local[1] - anchor[1]],
    })(document, context);
  };
}
