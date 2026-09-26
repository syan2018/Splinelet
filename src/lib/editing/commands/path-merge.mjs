import { validateDocument } from '../../document/schema.mjs';
import { effectiveNodeState } from '../../scene/hierarchy.mjs';
import {
  basisIdForUse,
  basisPiecesForUse,
  hasPathBasis,
  reverseBasisPieces,
} from '../../geometry/path-basis.mjs';

export const PATH_MERGE_ACTIONS = Object.freeze(['merge-paths']);

const record = (value) =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const pathRef = (sketchId, id) => ({ kind: 'path', sketchId, id });
const edgeRef = (sketchId, id) => ({ kind: 'edge', sketchId, id });
const vertexRef = (sketchId, id) => ({ kind: 'vertex', sketchId, id });
const programRef = (id) => ({ kind: 'program', id });

const validatePathRef = (ref, label) => {
  if (
    !record(ref) ||
    ref.kind !== 'path' ||
    typeof ref.sketchId !== 'string' ||
    typeof ref.id !== 'string' ||
    Object.keys(ref).some((key) => !['kind', 'sketchId', 'id'].includes(key))
  )
    throw Error(`${label} 路径引用无效`);
};

const resolvePath = (document, ref, label) => {
  validatePathRef(ref, label);
  const sketch = document.sketches[ref.sketchId];
  if (!sketch) throw Error(`${label} 路径来源不存在`);
  const path = sketch.paths[ref.id];
  if (!path) throw Error(`${label} 路径不存在`);
  if (
    !document.nodes[sketch.ownerNodeId] ||
    effectiveNodeState(document, sketch.ownerNodeId).locked
  )
    throw Error(`${label} 路径所属部件不存在或已锁定`);
  return { sketch, path };
};

const directedVertices = (edge, use) =>
  use.reversed
    ? [edge.endVertexId, edge.startVertexId]
    : [edge.startVertexId, edge.endVertexId];

const traceOpenFreePath = (sketch, path, label) => {
  if (!Array.isArray(path.edges) || !path.edges.length)
    throw Error(`${label} 必须是至少含一条 Edge 的开放路径`);
  const edgeIds = new Set();
  const vertexIds = new Set();
  let firstVertexId;
  let previousVertexId;
  for (const [index, use] of path.edges.entries()) {
    if (
      !record(use) ||
      typeof use.edgeId !== 'string' ||
      typeof use.reversed !== 'boolean'
    )
      throw Error(`${label} Path.edges 无效`);
    if (edgeIds.has(use.edgeId))
      throw Error(`${label} 重复使用 Edge ${use.edgeId}，不能安全合并`);
    edgeIds.add(use.edgeId);
    const edge = sketch.edges[use.edgeId];
    if (!edge) throw Error(`${label} 引用的 Edge 不存在：${use.edgeId}`);
    if (edge.startHandle.kind !== 'free' || edge.endHandle.kind !== 'free')
      throw Error(`${label} Edge ${edge.id} 含 Relation 驱动的 Handle`);
    const [startVertexId, endVertexId] = directedVertices(edge, use);
    const start = sketch.vertices[startVertexId];
    const end = sketch.vertices[endVertexId];
    if (!start || !end)
      throw Error(`${label} Edge ${edge.id} 引用的 Vertex 不存在`);
    if (start.position.kind !== 'free' || end.position.kind !== 'free')
      throw Error(`${label} 含 Relation 驱动的 Vertex`);
    if (index === 0) firstVertexId = startVertexId;
    else if (previousVertexId !== startVertexId)
      throw Error(`${label} 内部拓扑不连续`);
    previousVertexId = endVertexId;
    vertexIds.add(startVertexId);
    vertexIds.add(endVertexId);
  }
  if (firstVertexId === previousVertexId)
    throw Error(`${label} 已闭合，不能合并`);
  return {
    firstVertexId,
    lastVertexId: previousVertexId,
    edgeIds,
    vertexIds,
  };
};

const requireUnsharedEdges = (sketch, firstPath, secondPath, edgeIds) => {
  for (const path of Object.values(sketch.paths)) {
    if (path.id === firstPath.id || path.id === secondPath.id) continue;
    const shared = path.edges.find((use) => edgeIds.has(use.edgeId));
    if (shared)
      throw Error(
        `Edge ${shared.edgeId} 被其他 Path ${path.id} 共享，不能合并`,
      );
  }
  for (const use of firstPath.edges)
    if (secondPath.edges.some((other) => other.edgeId === use.edgeId))
      throw Error(`两条路径共享 Edge ${use.edgeId}，不能合并`);
};

const reversedUses = (path, uses) =>
  uses.toReversed().map((use) => ({
    ...use,
    reversed: !use.reversed,
    ...(Array.isArray(use.basisSpan)
      ? { basisSpan: [use.basisSpan[1], use.basisSpan[0]] }
      : {}),
    ...(use.basisPieces ? { basisPieces: reverseBasisPieces(path, use) } : {}),
  }));

const relationTouchesVertex = (document, sketch, vertexId) => {
  const direct = (ref) =>
    ref?.kind === 'vertex' && ref.sketchId === sketch.id && ref.id === vertexId;
  const edgeEnd = (ref) => {
    if (ref?.kind !== 'edge-end' || ref.sketchId !== sketch.id) return false;
    const edge = sketch.edges[ref.edgeId];
    return (
      edge &&
      edge[ref.end === 'start' ? 'startVertexId' : 'endVertexId'] === vertexId
    );
  };
  return Object.values(document.relations).find((relation) =>
    [relation.target, relation.source].some(
      (ref) => direct(ref) || edgeEnd(ref),
    ),
  );
};

const requireWeldableVertex = (
  document,
  sketch,
  firstPath,
  secondPath,
  secondUses,
  vertexId,
) => {
  const seamUse = secondUses[0];
  const seamEdge = sketch.edges[seamUse.edgeId];
  const seamField = seamUse.reversed ? 'endVertexId' : 'startVertexId';
  for (const edge of Object.values(sketch.edges)) {
    for (const field of ['startVertexId', 'endVertexId'])
      if (
        edge[field] === vertexId &&
        !(edge.id === seamEdge.id && field === seamField)
      )
        throw Error(`接缝 Vertex ${vertexId} 被其他 Edge ${edge.id} 使用`);
  }
  for (const path of Object.values(sketch.paths)) {
    if (path.id === secondPath.id) continue;
    if (
      path.startVertexId === vertexId ||
      Object.hasOwn(path.handleModes || {}, vertexId)
    )
      throw Error(`接缝 Vertex ${vertexId} 被其他 Path ${path.id} 使用`);
    for (const use of path.edges) {
      const edge = sketch.edges[use.edgeId];
      if (
        edge &&
        (edge.startVertexId === vertexId || edge.endVertexId === vertexId)
      )
        throw Error(`接缝 Vertex ${vertexId} 被其他 Path ${path.id} 使用`);
    }
  }
  if (firstPath.handleModes?.[vertexId])
    throw Error(`接缝 Vertex ${vertexId} 被第一条 Path 使用`);
  const relation = relationTouchesVertex(document, sketch, vertexId);
  if (relation)
    throw Error(`接缝 Vertex ${vertexId} 被 Relation ${relation.id} 使用`);
  return { seamEdge, seamField };
};

const samePoint = (left, right) => left[0] === right[0] && left[1] === right[1];
const subtract = (left, right) => [left[0] - right[0], left[1] - right[1]];
const straightHandles = (start, end) => {
  const delta = subtract(end, start);
  const first = start.map((item, axis) => item + delta[axis] / 3);
  const second = start.map((item, axis) => item + (2 * delta[axis]) / 3);
  return [subtract(first, start), subtract(second, end)];
};

const idExists = (value, candidate, seen = new Set()) => {
  if (!value || typeof value !== 'object' || seen.has(value)) return false;
  seen.add(value);
  if (value.id === candidate) return true;
  return Object.values(value).some((child) => idExists(child, candidate, seen));
};

const nextUniqueId = (document, idFactory) => {
  if (typeof idFactory !== 'function') throw Error('合并路径需要 idFactory');
  const id = idFactory();
  if (typeof id !== 'string' || !id || idExists(document, id))
    throw Error('idFactory 必须返回未占用的非空字符串 ID');
  return id;
};

const sameBasisMetadata = (left, right) => left?.period === right?.period;
const mergePathBasisCatalog = (catalog, path, uses) => {
  for (const use of uses) {
    for (const { basisId } of basisPiecesForUse(path, use)) {
      const metadata =
        path.basisCatalog?.[basisId] ||
        (basisId === path.id && path.basisPeriod !== undefined
          ? { period: path.basisPeriod }
          : {});
      if (catalog[basisId] && !sameBasisMetadata(catalog[basisId], metadata))
        throw Error(`logical basis ${basisId} 的周期定义冲突，不能合并`);
      catalog[basisId] = structuredClone(metadata);
    }
  }
  return catalog;
};
const explicitBasisUses = (path, uses) =>
  uses.map((use) => ({
    ...use,
    ...(use.basisPieces
      ? { basisPieces: structuredClone(use.basisPieces) }
      : {
          basisSpan: [...use.basisSpan],
          basisId: basisIdForUse(path, use),
        }),
  }));

const clearMode = (modes, vertexId) => {
  delete modes[vertexId];
};

const updateSourceMemberships = (
  document,
  sketch,
  firstPathId,
  secondPathId,
) => {
  const changedPrograms = [];
  for (const program of Object.values(document.programs)) {
    if (program.ownerNodeId !== sketch.ownerNodeId) continue;
    let programChanged = false;
    for (const operator of Object.values(program.operators)) {
      if (operator.type !== 'source') continue;
      const inputs = operator.inputs.paths || [];
      const local = inputs.filter(
        (input) => input.kind === 'sketch' && input.sketchId === sketch.id,
      );
      const consumesFirst = local.some(
        (input) => !input.pathIds || input.pathIds.includes(firstPathId),
      );
      const consumesSecond = local.some(
        (input) => !input.pathIds || input.pathIds.includes(secondPathId),
      );
      if (!consumesFirst || !consumesSecond) continue;
      operator.inputs.paths = inputs.flatMap((input) => {
        if (
          input.kind !== 'sketch' ||
          input.sketchId !== sketch.id ||
          !input.pathIds?.includes(secondPathId)
        )
          return [input];
        const pathIds = input.pathIds.filter((id) => id !== secondPathId);
        programChanged = true;
        return pathIds.length ? [{ ...input, pathIds }] : [];
      });
    }
    if (programChanged) changedPrograms.push(programRef(program.id));
  }
  return changedPrograms;
};

const validateAction = (action) => {
  if (!record(action) || action.kind !== 'merge-paths')
    throw Error('不支持的路径合并动作');
  const keys = [
    'kind',
    'firstPathRef',
    'firstEnd',
    'secondPathRef',
    'secondEnd',
  ];
  if (Object.keys(action).some((key) => !keys.includes(key)))
    throw Error('merge-paths 含未声明字段');
  if (!['start', 'end'].includes(action.firstEnd))
    throw Error('firstEnd 必须为 start 或 end');
  if (!['start', 'end'].includes(action.secondEnd))
    throw Error('secondEnd 必须为 start 或 end');
};

/** Merge two open free Paths in one Sketch without rewriting existing cubics. */
export function createPathMergeCommand(request) {
  const action = structuredClone(request);
  return (document, { idFactory } = {}) => {
    validateAction(action);
    validateDocument(document);
    const first = resolvePath(document, action.firstPathRef, '第一条');
    const second = resolvePath(document, action.secondPathRef, '第二条');
    if (
      first.path.id === second.path.id &&
      first.sketch.id === second.sketch.id
    )
      throw Error('请选择两条不同的路径');
    if (first.sketch.ownerNodeId !== second.sketch.ownerNodeId)
      throw Error('跨 owner 合并尚未支持；请先转移源路径');
    if (first.sketch.id !== second.sketch.id)
      throw Error('跨 Sketch 合并尚未支持；请先转移源路径');
    const sketch = first.sketch;
    const firstTrace = traceOpenFreePath(sketch, first.path, '第一条路径');
    const secondTrace = traceOpenFreePath(sketch, second.path, '第二条路径');
    requireUnsharedEdges(
      sketch,
      first.path,
      second.path,
      new Set([...firstTrace.edgeIds, ...secondTrace.edgeIds]),
    );

    const v5 = hasPathBasis(document);
    let firstUses =
      action.firstEnd === 'start'
        ? reversedUses(first.path, first.path.edges)
        : structuredClone(first.path.edges);
    let secondUses =
      action.secondEnd === 'end'
        ? reversedUses(second.path, second.path.edges)
        : structuredClone(second.path.edges);
    if (v5) {
      firstUses = explicitBasisUses(first.path, firstUses);
      secondUses = explicitBasisUses(second.path, secondUses);
    }
    const firstTailUse = firstUses.at(-1);
    const firstTailEdge = sketch.edges[firstTailUse.edgeId];
    const firstVertexId = directedVertices(firstTailEdge, firstTailUse)[1];
    const secondHeadUse = secondUses[0];
    const secondHeadEdge = sketch.edges[secondHeadUse.edgeId];
    const secondVertexId = directedVertices(secondHeadEdge, secondHeadUse)[0];
    const firstPosition = sketch.vertices[firstVertexId].position.value;
    const secondPosition = sketch.vertices[secondVertexId].position.value;
    const welded = samePoint(firstPosition, secondPosition);
    const changedRefs = [pathRef(sketch.id, first.path.id)];
    const removedRefs = [pathRef(sketch.id, second.path.id)];
    let bridgeUse = [];
    let bridgeBasisId;

    if (welded && firstVertexId !== secondVertexId) {
      const { seamEdge, seamField } = requireWeldableVertex(
        document,
        sketch,
        first.path,
        second.path,
        secondUses,
        secondVertexId,
      );
      seamEdge[seamField] = firstVertexId;
      delete sketch.vertices[secondVertexId];
      changedRefs.push(edgeRef(sketch.id, seamEdge.id));
      removedRefs.push(vertexRef(sketch.id, secondVertexId));
    } else if (!welded) {
      const edgeId = nextUniqueId(document, idFactory);
      const [startVector, endVector] = straightHandles(
        firstPosition,
        secondPosition,
      );
      sketch.edges[edgeId] = {
        id: edgeId,
        startVertexId: firstVertexId,
        endVertexId: secondVertexId,
        startHandle: { kind: 'free', vector: startVector },
        endHandle: { kind: 'free', vector: endVector },
      };
      if (v5) bridgeBasisId = nextUniqueId(document, idFactory);
      bridgeUse = v5
        ? [
            {
              edgeId,
              reversed: false,
              basisId: bridgeBasisId,
              basisSpan: [0, 1],
            },
          ]
        : [{ edgeId, reversed: false }];
      changedRefs.push(edgeRef(sketch.id, edgeId));
    }

    const modes = {
      ...first.path.handleModes,
      ...second.path.handleModes,
    };
    clearMode(modes, firstVertexId);
    clearMode(modes, secondVertexId);
    first.path.edges = [...firstUses, ...bridgeUse, ...secondUses];
    if (v5) {
      const basisCatalog = mergePathBasisCatalog({}, first.path, firstUses);
      mergePathBasisCatalog(basisCatalog, second.path, secondUses);
      if (bridgeBasisId) basisCatalog[bridgeBasisId] = {};
      first.path.basisCatalog = basisCatalog;
      if (
        new Set(
          first.path.edges.flatMap((use) =>
            basisPiecesForUse(first.path, use).map((piece) => piece.basisId),
          ),
        ).size !== 1
      )
        delete first.path.basisPeriod;
    }
    first.path.name = `${first.path.name} + ${second.path.name}`;
    if (Object.keys(modes).length) first.path.handleModes = modes;
    else delete first.path.handleModes;
    delete first.path.startVertexId;
    delete sketch.paths[second.path.id];

    changedRefs.push(
      ...updateSourceMemberships(
        document,
        sketch,
        first.path.id,
        second.path.id,
      ),
    );
    validateDocument(document);
    return { document, changedRefs, removedRefs };
  };
}
