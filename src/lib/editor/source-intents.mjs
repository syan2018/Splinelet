import { createSourceCommand } from '../editing/commands/source.mjs';
import {
  inverseTransform,
  transformPoint,
  worldMatrix,
} from '../scene/transforms.mjs';
import { sourceViewToWorld } from './source-view.mjs';
import { resolveRelation } from '../geometry/relations.mjs';

/** Source gestures resolve stable identities in their captured view, never array indices. */
export function createSourceIntent(request, displayed) {
  const action = structuredClone(request);
  const view = structuredClone(displayed);
  if (!['move-anchor', 'move-handle', 'split-span'].includes(action?.kind))
    throw Error('源编辑动作尚未适配');
  if (
    typeof view?.epoch !== 'string' ||
    !Number.isInteger(view.revision) ||
    !view.source
  )
    throw Error('源编辑需要携带当前会话身份的视图');
  if (view.previewId != null) throw Error('源手势必须从已提交视图开始');
  const target = view.source.identities?.byId[action.identityId];
  const kind = {
    'move-anchor': 'vertex',
    'move-handle': 'edge-end',
    'split-span': 'edge',
  }[action.kind];
  if (!target || target.kind !== kind) throw Error('源选区身份已失效');
  return (document, context) => {
    if (context.epoch !== view.epoch || context.revision !== view.revision)
      throw Error('源视图已失效，请重新选择');
    const sketch = document.sketches[target.sketchId];
    if (!sketch) throw Error('线条来源不存在');
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
    const local = transformPoint(
      inverseTransform(worldMatrix(document, sketch.ownerNodeId)),
      sourceViewToWorld(view.source.frame, action.pixelPoint),
    );
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
      kind: 'set-handle',
      sketchId: sketch.id,
      edgeId: edge.id,
      end: target.end,
      vector: [local[0] - anchor[0], local[1] - anchor[1]],
    })(document, context);
  };
}
