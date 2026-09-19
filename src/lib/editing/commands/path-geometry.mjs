import { resolveRelation } from '../../geometry/relations.mjs';
import { effectiveNodeState } from '../../scene/hierarchy.mjs';
import {
  inverseTransform,
  transformPoint,
  transformVector,
  worldMatrix,
} from '../../scene/transforms.mjs';

export const PATH_GEOMETRY_ACTIONS = Object.freeze([
  'refit-path',
  'straighten-edge',
]);

const record = (value) =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const vec = (value) =>
  Array.isArray(value) && value.length === 2 && value.every(Number.isFinite);
// Pixel/world roundtrips may differ by floating-point rounding; endpoints
// remain the existing Vertex values and are never overwritten by this input.
const samePoint = (left, right) =>
  Math.hypot(left[0] - right[0], left[1] - right[1]) <= 1e-9;
const sameVector = (left, right) => samePoint(left, right);
const vector = (from, to) => [to[0] - from[0], to[1] - from[1]];
const pathRef = (sketchId, id) => ({ kind: 'path', sketchId, id });
const edgeEndRef = (sketchId, edgeId, end) => ({
  kind: 'edge-end',
  sketchId,
  edgeId,
  end,
});

const resolvePath = (document, ref) => {
  if (
    !record(ref) ||
    ref.kind !== 'path' ||
    typeof ref.sketchId !== 'string' ||
    typeof ref.id !== 'string' ||
    Object.keys(ref).some((key) => !['kind', 'sketchId', 'id'].includes(key))
  )
    throw Error('路径引用无效');
  const sketch = document.sketches[ref.sketchId];
  if (!sketch) throw Error('路径来源不存在');
  const path = sketch.paths[ref.id];
  if (!path) throw Error('路径不存在');
  if (
    !document.nodes[sketch.ownerNodeId] ||
    effectiveNodeState(document, sketch.ownerNodeId).locked
  )
    throw Error('路径所属部件不存在或已锁定');
  return { sketch, path };
};

const validateUses = (uses, label) => {
  if (
    !Array.isArray(uses) ||
    !uses.every(
      (use) =>
        record(use) &&
        Object.keys(use).length === 2 &&
        typeof use.edgeId === 'string' &&
        typeof use.reversed === 'boolean',
    )
  )
    throw Error(`${label} 必须是完整 Path.edges`);
};

const sameUses = (left, right) =>
  left.length === right.length &&
  left.every(
    (use, index) =>
      use.edgeId === right[index].edgeId &&
      use.reversed === right[index].reversed,
  );

const requireUnsharedEdge = (sketch, selectedPath, edgeId) => {
  const owner = Object.values(sketch.paths).find(
    (path) =>
      path.id !== selectedPath.id &&
      path.edges.some((use) => use.edgeId === edgeId),
  );
  if (owner)
    throw Error(`Edge ${edgeId} 被其他 Path ${owner.id} 共享，不能改写几何`);
};

const requireFreeHandles = (edge) => {
  if (edge.startHandle.kind !== 'free' || edge.endHandle.kind !== 'free')
    throw Error(`Edge ${edge.id} 含受 Relation 驱动的 Handle，不能改写`);
};

const vertexPosition = (document, sketch, vertexId) => {
  const vertex = sketch.vertices[vertexId];
  if (!vertex) throw Error(`路径端点 Vertex 不存在：${vertexId}`);
  if (vertex.position.kind === 'free') return vertex.position.value;
  const target = { kind: 'vertex', sketchId: sketch.id, id: vertexId };
  const result = resolveRelation({
    document,
    sketch,
    target,
    relationId: vertex.position.relationId,
  });
  if (result.status !== 'ready' || !vec(result.value))
    throw Error(`路径端点 Vertex 关系尚未解算：${vertexId}`);
  return result.value;
};

const clearMode = (path, vertexId) => {
  if (!path.handleModes) return;
  delete path.handleModes[vertexId];
  if (!Object.keys(path.handleModes).length) delete path.handleModes;
};

const refitPath = (document, action) => {
  const { sketch, path } = resolvePath(document, action.pathRef);
  validateUses(action.expectedEdges, 'expectedEdges');
  if (!sameUses(action.expectedEdges, path.edges))
    throw Error('Path 拓扑已变化，请重新拟合');
  if (
    !Array.isArray(action.cubics) ||
    action.cubics.length !== path.edges.length ||
    !action.cubics.every(
      (cubic) => Array.isArray(cubic) && cubic.length === 4 && cubic.every(vec),
    )
  )
    throw Error('cubics 必须与当前 Path.edges 一一对应且使用有限世界坐标');

  const ownerWorld = worldMatrix(document, sketch.ownerNodeId);
  const worldToLocal = inverseTransform(ownerWorld);
  const updates = new Map();
  for (let index = 0; index < path.edges.length; index++) {
    const use = path.edges[index];
    const edge = sketch.edges[use.edgeId];
    if (!edge) throw Error(`Path 引用的 Edge 不存在：${use.edgeId}`);
    requireUnsharedEdge(sketch, path, edge.id);
    requireFreeHandles(edge);

    const sourceStart = vertexPosition(document, sketch, edge.startVertexId);
    const sourceEnd = vertexPosition(document, sketch, edge.endVertexId);
    const directedStart = use.reversed ? sourceEnd : sourceStart;
    const directedEnd = use.reversed ? sourceStart : sourceEnd;
    const cubic = action.cubics[index];
    if (
      !samePoint(cubic[0], transformPoint(ownerWorld, directedStart)) ||
      !samePoint(cubic[3], transformPoint(ownerWorld, directedEnd))
    )
      throw Error(`第 ${index + 1} 段 cubic 端点与现有 Vertex 不精确匹配`);

    const sourceCubic = use.reversed
      ? [cubic[3], cubic[2], cubic[1], cubic[0]]
      : cubic;
    const update = {
      start: transformVector(
        worldToLocal,
        vector(sourceCubic[0], sourceCubic[1]),
      ),
      end: transformVector(
        worldToLocal,
        vector(sourceCubic[3], sourceCubic[2]),
      ),
    };
    const previous = updates.get(edge.id);
    if (
      previous &&
      (!sameVector(previous.start, update.start) ||
        !sameVector(previous.end, update.end))
    )
      throw Error(`Path 多次使用 Edge ${edge.id}，拟合控制柄互相冲突`);
    updates.set(edge.id, update);
  }

  for (const [edgeId, update] of updates) {
    const edge = sketch.edges[edgeId];
    edge.startHandle.vector = update.start;
    edge.endHandle.vector = update.end;
  }
  delete path.handleModes;
  return {
    document,
    changedRefs: [
      pathRef(sketch.id, path.id),
      ...[...updates.keys()].flatMap((edgeId) => [
        edgeEndRef(sketch.id, edgeId, 'start'),
        edgeEndRef(sketch.id, edgeId, 'end'),
      ]),
    ],
  };
};

const straightenEdge = (document, action) => {
  const { sketch, path } = resolvePath(document, action.pathRef);
  if (typeof action.edgeId !== 'string')
    throw Error('straighten-edge 需要 edgeId');
  if (!path.edges.some((use) => use.edgeId === action.edgeId))
    throw Error('Edge 不属于所选 Path');
  const edge = sketch.edges[action.edgeId];
  if (!edge) throw Error('Edge 不存在');
  requireUnsharedEdge(sketch, path, edge.id);
  requireFreeHandles(edge);

  // Match the original straightCubic command, including its handle positions
  // and linear parameterization (not just the same visible straight contour).
  const start = vertexPosition(document, sketch, edge.startVertexId);
  const end = vertexPosition(document, sketch, edge.endVertexId);
  edge.startHandle.vector = vector(start, end).map((n) => n / 3);
  edge.endHandle.vector = vector(end, start).map((n) => n / 3);
  clearMode(path, edge.startVertexId);
  clearMode(path, edge.endVertexId);
  return {
    document,
    changedRefs: [
      pathRef(sketch.id, path.id),
      edgeEndRef(sketch.id, edge.id, 'start'),
      edgeEndRef(sketch.id, edge.id, 'end'),
    ],
  };
};

/** Atomically refits existing Path handles or straightens one existing Edge. */
export function createPathGeometryCommand(request) {
  const action = structuredClone(request);
  return (document) => {
    if (action?.kind === 'refit-path') return refitPath(document, action);
    if (action?.kind === 'straighten-edge')
      return straightenEdge(document, action);
    throw Error(`不支持的路径几何动作：${action?.kind}`);
  };
}
