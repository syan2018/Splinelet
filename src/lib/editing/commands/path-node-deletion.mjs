import { validateDocument } from '../../document/schema.mjs';
import { resolveRelation } from '../../geometry/relations.mjs';
import { effectiveNodeState } from '../../scene/hierarchy.mjs';
import { removeNode } from '../../source-editor/node-edit.mjs';
import {
  basisIdForUse,
  basisPeriodForUse,
  concatenateBasisPieces,
  hasPathBasis,
  mergeBasisSpans,
  withBasisPieces,
} from '../../geometry/path-basis.mjs';

export const PATH_NODE_DELETION_ACTIONS = Object.freeze([
  'delete-path-vertices',
]);

const record = (value) =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const vec = (value) =>
  Array.isArray(value) && value.length === 2 && value.every(Number.isFinite);
const sameVec = (left, right) => left[0] === right[0] && left[1] === right[1];
const point = (value) => ({ x: value[0], y: value[1] });
const arrayPoint = (value) => [value.x, value.y];
const vector = (from, to) => [to[0] - from[0], to[1] - from[1]];
const ref = (kind, sketchId, id) => ({ kind, sketchId, id });
const edgeEndRef = (sketchId, edgeId, end) => ({
  kind: 'edge-end',
  sketchId,
  edgeId,
  end,
});

const validateUses = (uses, expectsBasis) => {
  if (
    !Array.isArray(uses) ||
    !uses.every(
      (use) =>
        record(use) &&
        [expectsBasis ? 3 : 2, expectsBasis ? 4 : 2].includes(
          Object.keys(use).length,
        ) &&
        typeof use.edgeId === 'string' &&
        typeof use.reversed === 'boolean' &&
        (!expectsBasis ||
          Array.isArray(use.basisPieces) ||
          (Array.isArray(use.basisSpan) &&
            use.basisSpan.length === 2 &&
            use.basisSpan.every(Number.isFinite))),
    )
  )
    throw Error('expectedEdges 必须是完整 Path.edges');
};
const sameUses = (left, right) =>
  left.length === right.length &&
  left.every(
    (use, index) =>
      use.edgeId === right[index].edgeId &&
      use.reversed === right[index].reversed &&
      (use.basisPieces !== undefined
        ? JSON.stringify(use.basisPieces) ===
          JSON.stringify(right[index].basisPieces)
        : use.basisSpan === undefined ||
          (use.basisSpan[0] === right[index].basisSpan?.[0] &&
            use.basisSpan[1] === right[index].basisSpan?.[1] &&
            use.basisId === right[index].basisId &&
            right[index].basisPieces === undefined)),
  );

const resolvePath = (document, pathRef) => {
  if (
    !record(pathRef) ||
    pathRef.kind !== 'path' ||
    typeof pathRef.sketchId !== 'string' ||
    typeof pathRef.id !== 'string' ||
    Object.keys(pathRef).some(
      (key) => !['kind', 'sketchId', 'id'].includes(key),
    )
  )
    throw Error('路径引用无效');
  const sketch = document.sketches[pathRef.sketchId];
  const path = sketch?.paths[pathRef.id];
  if (!path) throw Error('路径不存在');
  if (
    !document.nodes[sketch.ownerNodeId] ||
    effectiveNodeState(document, sketch.ownerNodeId).locked
  )
    throw Error('路径所属部件不存在或已锁定');
  return { sketch, path };
};

const resolveVertex = (document, sketch, vertexId) => {
  const vertex = sketch.vertices[vertexId];
  if (!vertex) throw Error(`Path 顶点不存在：${vertexId}`);
  if (vertex.position.kind === 'free') return vertex.position.value;
  const target = { kind: 'vertex', sketchId: sketch.id, id: vertexId };
  const result = resolveRelation({
    document,
    sketch,
    target,
    relationId: vertex.position.relationId,
  });
  if (result.status !== 'ready' || !vec(result.value))
    throw Error(`Path 顶点关系尚未解算：${vertexId}`);
  return result.value;
};

const resolveHandle = (document, sketch, edge, end) => {
  const value = edge[end === 'start' ? 'startHandle' : 'endHandle'];
  if (value.kind === 'free') return value.vector;
  const target = {
    kind: 'edge-end',
    sketchId: sketch.id,
    edgeId: edge.id,
    end,
  };
  const result = resolveRelation({
    document,
    sketch,
    target,
    relationId: value.relationId,
  });
  if (result.status !== 'ready' || !vec(result.value))
    throw Error(`Path Handle 关系尚未解算：${edge.id}:${end}`);
  return result.value;
};

const directedEntry = (document, sketch, use) => {
  const edge = sketch.edges[use.edgeId];
  if (!edge) throw Error(`Path 引用的 Edge 不存在：${use.edgeId}`);
  const start = resolveVertex(document, sketch, edge.startVertexId);
  const end = resolveVertex(document, sketch, edge.endVertexId);
  const startVector = resolveHandle(document, sketch, edge, 'start');
  const endVector = resolveHandle(document, sketch, edge, 'end');
  const cubic = [
    start,
    start.map((value, index) => value + startVector[index]),
    end.map((value, index) => value + endVector[index]),
    end,
  ];
  return {
    edgeId: edge.id,
    reversed: use.reversed,
    startId: use.reversed ? edge.endVertexId : edge.startVertexId,
    endId: use.reversed ? edge.startVertexId : edge.endVertexId,
    cubic: use.reversed ? cubic.reverse() : cubic,
    ...(use.basisSpan === undefined ? {} : { basisSpan: [...use.basisSpan] }),
    ...(use.basisId === undefined ? {} : { basisId: use.basisId }),
    ...(use.basisPieces === undefined
      ? {}
      : { basisPieces: structuredClone(use.basisPieces) }),
    isNew: false,
  };
};

const topology = (path, entries) => {
  if (!entries.length) {
    if (!path.startVertexId) return { nodeIds: [], closed: false };
    return { nodeIds: [path.startVertexId], closed: false };
  }
  for (let index = 1; index < entries.length; index++)
    if (entries[index - 1].endId !== entries[index].startId)
      throw Error('Path 拓扑不连续，不能删除节点');
  const closed = entries.at(-1).endId === entries[0].startId;
  const nodeIds = closed
    ? entries.map((entry) => entry.startId)
    : [entries[0].startId, ...entries.map((entry) => entry.endId)];
  if (new Set(nodeIds).size !== nodeIds.length)
    throw Error('Path 含重复 Vertex，删除语义不明确');
  return { nodeIds, closed };
};

const legacyDto = (path, entries, nodeIds, closed, modes, sketch) => ({
  id: path.id,
  name: path.name,
  visible: path.visible,
  start: point(
    entries.length
      ? entries[0].cubic[0]
      : sketch.vertices[nodeIds[0]].position.value,
  ),
  curves: entries.map((entry) => entry.cubic.map(point)),
  closed,
  ...(modes ? { nodeModes: [...modes] } : {}),
});

const mergedEntry = (document, path, left, right, sequence) => {
  const leftBasisId = basisIdForUse(path, left);
  const rightBasisId = basisIdForUse(path, right);
  const entry = {
    edgeId: `__new_edge_${sequence}`,
    reversed: false,
    startId: left.startId,
    endId: right.endId,
    cubic: null,
    isNew: true,
  };
  if (left.basisSpan === undefined && left.basisPieces === undefined)
    return entry;
  if (!left.basisPieces && !right.basisPieces && leftBasisId === rightBasisId)
    return {
      ...entry,
      basisSpan: mergeBasisSpans(
        left.basisSpan,
        right.basisSpan,
        basisPeriodForUse(path, left),
      ),
      ...(leftBasisId === path.id ? {} : { basisId: leftBasisId }),
    };
  return {
    ...entry,
    ...withBasisPieces(
      document,
      path,
      {},
      concatenateBasisPieces(path, left, right),
    ),
  };
};

const applyTopologyDeletion = (
  document,
  entries,
  nodeIds,
  closed,
  index,
  sequence,
  path,
) => {
  if (nodeIds.length === 1) return { entries: null, nodeIds: [] };
  if (nodeIds.length === 2)
    return {
      entries: [],
      nodeIds: [nodeIds[index === 0 ? 1 : 0]],
    };
  let next;
  if (closed && index === 0) {
    const left = entries.at(-1);
    const right = entries[0];
    next = [
      ...entries.slice(1, -1),
      mergedEntry(document, path, left, right, sequence),
    ];
  } else if (closed || (index > 0 && index < nodeIds.length - 1)) {
    const leftIndex = index - 1;
    const left = entries[leftIndex];
    const right = entries[index];
    next = [
      ...entries.slice(0, leftIndex),
      mergedEntry(document, path, left, right, sequence),
      ...entries.slice(index + 1),
    ];
  } else next = index === 0 ? entries.slice(1) : entries.slice(0, -1);
  return {
    entries: next,
    nodeIds: topology({ startVertexId: undefined }, next).nodeIds,
  };
};

const allIds = (document) => {
  const result = new Set();
  const visit = (value) => {
    if (Array.isArray(value)) return value.forEach(visit);
    if (!value || typeof value !== 'object') return;
    if (typeof value.id === 'string') result.add(value.id);
    Object.values(value).forEach(visit);
  };
  visit(document);
  return result;
};
const allocator = (document, idFactory) => {
  if (typeof idFactory !== 'function') throw Error('idFactory 必须是函数');
  const ids = allIds(document);
  return () => {
    const id = idFactory();
    if (typeof id !== 'string' || !id.trim() || ids.has(id))
      throw Error('idFactory 返回了无效或重复 ID');
    ids.add(id);
    return id;
  };
};

const storedVectors = (entry) => {
  const source = entry.reversed ? [...entry.cubic].reverse() : entry.cubic;
  return {
    start: vector(source[0], source[1]),
    end: vector(source[3], source[2]),
  };
};

const edgeUsedElsewhere = (sketch, path, edgeId) =>
  Object.values(sketch.paths).some(
    (candidate) =>
      candidate.id !== path.id &&
      candidate.edges.some((use) => use.edgeId === edgeId),
  );

const planDeletion = (document, action, idFactory) => {
  validateDocument(document);
  const { sketch, path } = resolvePath(document, action.pathRef);
  validateUses(action.expectedEdges, hasPathBasis(document));
  if (!sameUses(action.expectedEdges, path.edges))
    throw Error('Path 拓扑已变化，请重新选择节点');
  if (!Number.isFinite(action.toleranceMM) || action.toleranceMM <= 0)
    throw Error('toleranceMM 必须是正有限数');
  if (
    !Array.isArray(action.vertexIds) ||
    action.vertexIds.some((id) => typeof id !== 'string')
  )
    throw Error('vertexIds 必须是稳定 Vertex ID 数组');

  let entries = path.edges.map((use) => directedEntry(document, sketch, use));
  let state = topology(path, entries);
  const requested = [...new Set(action.vertexIds)];
  const originalIndex = new Map(
    state.nodeIds.map((vertexId, index) => [vertexId, index]),
  );
  for (const vertexId of requested) {
    if (!originalIndex.has(vertexId))
      throw Error(`Vertex 不属于 Path：${vertexId}`);
    if (sketch.vertices[vertexId].position.kind !== 'free')
      throw Error(`受 Relation 驱动的 Vertex 不能删除：${vertexId}`);
  }
  if (!requested.length) return { document, changedRefs: [], removedRefs: [] };

  let modes = path.handleModes
    ? state.nodeIds.map((vertexId) => path.handleModes[vertexId] || 'corner')
    : null;
  let deletedSequence = 0;
  for (const vertexId of requested.sort(
    (left, right) => originalIndex.get(right) - originalIndex.get(left),
  )) {
    const index = state.nodeIds.indexOf(vertexId);
    if (index < 0) throw Error(`Vertex 删除序列失效：${vertexId}`);
    const dto = legacyDto(
      path,
      entries,
      state.nodeIds,
      state.closed,
      modes,
      sketch,
    );
    const result = removeNode(dto, index, action.toleranceMM);
    const next = applyTopologyDeletion(
      document,
      entries,
      state.nodeIds,
      state.closed,
      index,
      ++deletedSequence,
      path,
    );
    if (!result.path) {
      entries = null;
      state = { nodeIds: [], closed: false };
      modes = null;
      continue;
    }
    entries = next.entries;
    state = {
      nodeIds: next.nodeIds,
      closed: result.path.closed,
    };
    modes = result.path.nodeModes || null;
    if (entries.length !== result.path.curves.length)
      throw Error('节点删除后的稳定拓扑与拟合结果不一致');
    entries.forEach((entry, entryIndex) => {
      entry.cubic = result.path.curves[entryIndex].map(arrayPoint);
    });
  }

  const survivingExisting = new Map(
    (entries || [])
      .filter((entry) => !entry.isNew)
      .map((entry) => [entry.edgeId, entry]),
  );
  const removedEdgeIds = new Set(
    path.edges
      .map((use) => use.edgeId)
      .filter((edgeId) => !survivingExisting.has(edgeId)),
  );
  const updates = new Map();
  for (const [edgeId, entry] of survivingExisting) {
    const edge = sketch.edges[edgeId];
    const desired = storedVectors(entry);
    const start = resolveHandle(document, sketch, edge, 'start');
    const end = resolveHandle(document, sketch, edge, 'end');
    if (sameVec(start, desired.start) && sameVec(end, desired.end)) continue;
    updates.set(edgeId, desired);
  }
  const affectedEdges = new Set([...removedEdgeIds, ...updates.keys()]);
  for (const edgeId of affectedEdges) {
    const edge = sketch.edges[edgeId];
    if (edgeUsedElsewhere(sketch, path, edgeId))
      throw Error(`受影响 Edge ${edgeId} 被其他 Path 共享`);
    if (edge.startHandle.kind !== 'free' || edge.endHandle.kind !== 'free')
      throw Error(`受影响 Edge ${edgeId} 含 Relation 驱动的 Handle`);
  }
  const deletedVertices = new Set(requested);
  for (const edge of Object.values(sketch.edges))
    if (
      !removedEdgeIds.has(edge.id) &&
      (deletedVertices.has(edge.startVertexId) ||
        deletedVertices.has(edge.endVertexId))
    )
      throw Error(`被删 Vertex 被其他 Edge 使用：${edge.id}`);
  for (const candidate of Object.values(sketch.paths))
    if (
      candidate.id !== path.id &&
      (deletedVertices.has(candidate.startVertexId) ||
        Object.keys(candidate.handleModes || {}).some((vertexId) =>
          deletedVertices.has(vertexId),
        ))
    )
      throw Error(`被删 Vertex 被其他 Path 使用：${candidate.id}`);

  const newIdMap = new Map();
  const newEntries = (entries || []).filter((entry) => entry.isNew);
  if (newEntries.length) {
    const allocate = allocator(document, idFactory);
    for (const entry of newEntries)
      if (!newIdMap.has(entry.edgeId)) newIdMap.set(entry.edgeId, allocate());
  }

  const next = structuredClone(document);
  const nextSketch = next.sketches[sketch.id];
  const removedRefs = [];
  for (const edgeId of removedEdgeIds) {
    delete nextSketch.edges[edgeId];
    removedRefs.push(ref('edge', sketch.id, edgeId));
  }
  for (const vertexId of deletedVertices) {
    delete nextSketch.vertices[vertexId];
    removedRefs.push(ref('vertex', sketch.id, vertexId));
  }
  for (const [edgeId, value] of updates) {
    nextSketch.edges[edgeId].startHandle.vector = [...value.start];
    nextSketch.edges[edgeId].endHandle.vector = [...value.end];
  }

  const changedRefs = [];
  if (!entries) {
    delete nextSketch.paths[path.id];
    removedRefs.unshift(ref('path', sketch.id, path.id));
  } else {
    const nextPath = nextSketch.paths[path.id];
    nextPath.edges = entries.map((entry) => ({
      edgeId: entry.isNew ? newIdMap.get(entry.edgeId) : entry.edgeId,
      reversed: entry.isNew ? false : entry.reversed,
      ...(entry.basisSpan === undefined
        ? {}
        : { basisSpan: [...entry.basisSpan] }),
      ...(entry.basisId === undefined ? {} : { basisId: entry.basisId }),
      ...(entry.basisPieces === undefined
        ? {}
        : { basisPieces: structuredClone(entry.basisPieces) }),
    }));
    if (!entries.length) nextPath.startVertexId = state.nodeIds[0];
    else delete nextPath.startVertexId;
    if (!state.closed) delete nextPath.basisPeriod;
    const nextModes = Object.fromEntries(
      state.nodeIds.flatMap((vertexId, index) =>
        modes?.[index] && modes[index] !== 'corner'
          ? [[vertexId, modes[index]]]
          : [],
      ),
    );
    if (Object.keys(nextModes).length) nextPath.handleModes = nextModes;
    else delete nextPath.handleModes;
    changedRefs.push(ref('path', sketch.id, path.id));
    for (const entry of entries) {
      if (!entry.isNew) continue;
      const edgeId = newIdMap.get(entry.edgeId);
      const vectors = storedVectors(entry);
      nextSketch.edges[edgeId] = {
        id: edgeId,
        startVertexId: entry.startId,
        endVertexId: entry.endId,
        startHandle: { kind: 'free', vector: vectors.start },
        endHandle: { kind: 'free', vector: vectors.end },
      };
      changedRefs.push(ref('edge', sketch.id, edgeId));
    }
  }
  for (const [edgeId] of updates)
    changedRefs.push(
      edgeEndRef(sketch.id, edgeId, 'start'),
      edgeEndRef(sketch.id, edgeId, 'end'),
    );
  changedRefs.push(...removedRefs);
  validateDocument(next);
  return { document: next, changedRefs, removedRefs };
};

/** Deletes stable Path vertices as one topology-guarded transaction. */
export function createPathNodeDeletionCommand(request) {
  const action = structuredClone(request);
  if (action?.kind !== 'delete-path-vertices')
    throw Error(`不支持的 Path 节点删除动作：${action?.kind}`);
  return (document, { idFactory } = {}) =>
    planDeletion(document, action, idFactory);
}
