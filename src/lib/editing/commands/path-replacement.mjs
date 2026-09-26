import { validateDocument } from '../../document/schema.mjs';
import { effectiveNodeState } from '../../scene/hierarchy.mjs';
import {
  inverseTransform,
  transformPoint,
  worldMatrix,
} from '../../scene/transforms.mjs';
import { createCommandIdAllocator } from '../command-ids.mjs';
import {
  basisPiecesForSourceInterval,
  basisPiecesForUse,
  hasPathBasis,
  withBasisPieces,
} from '../../geometry/path-basis.mjs';

export const PATH_REPLACEMENT_ACTIONS = Object.freeze([
  'replace-path-geometry',
]);
const vec = (v) =>
  Array.isArray(v) && v.length === 2 && v.every(Number.isFinite);
const near = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]) <= 1e-9;
const ref = (kind, sketchId, id) => ({ kind, sketchId, id });
const vector = (a, b) => [b[0] - a[0], b[1] - a[1]];
const interval = (value) =>
  Array.isArray(value) &&
  value.length === 2 &&
  value.every(Number.isFinite) &&
  value[0] >= 0 &&
  value[1] <= 1 &&
  value[0] !== value[1];
const sameJson = (left, right) =>
  JSON.stringify(left) === JSON.stringify(right);

const replacementPieces = (path, mapping, count) => {
  if (!Array.isArray(mapping) || mapping.length !== count)
    throw Error(
      'changed-topology replacement 需要逐 cubic 的 basisPieceMapping',
    );
  const coverage = path.edges.map(() => []);
  return mapping
    .map((items, outputIndex) => {
      if (!Array.isArray(items) || !items.length)
        throw Error(`basisPieceMapping[${outputIndex}] 不能为空`);
      let cursor = 0;
      const pieces = [];
      for (const item of items) {
        if (
          !item ||
          !Number.isInteger(item.sourceUseIndex) ||
          item.sourceUseIndex < 0 ||
          item.sourceUseIndex >= path.edges.length ||
          !interval(item.sourceT) ||
          !interval(item.t) ||
          item.t[0] !== cursor ||
          item.t[0] >= item.t[1]
        )
          throw Error(`basisPieceMapping[${outputIndex}] 无效`);
        cursor = item.t[1];
        coverage[item.sourceUseIndex].push([
          Math.min(...item.sourceT),
          Math.max(...item.sourceT),
        ]);
        for (const source of basisPiecesForSourceInterval(
          path,
          path.edges[item.sourceUseIndex],
          item.sourceT,
        ))
          pieces.push({
            t: [
              item.t[0] + (item.t[1] - item.t[0]) * source.t[0],
              item.t[0] + (item.t[1] - item.t[0]) * source.t[1],
            ],
            basisId: source.basisId,
            span: source.span,
          });
      }
      if (cursor !== 1)
        throw Error(`basisPieceMapping[${outputIndex}] 没有覆盖 cubic`);
      return pieces;
    })
    .map((pieces, outputIndex, all) => {
      if (outputIndex !== all.length - 1) return pieces;
      for (const intervals of coverage) {
        intervals.sort((left, right) => left[0] - right[0]);
        let cursor = 0;
        for (const value of intervals) {
          if (value[0] !== cursor || value[0] >= value[1])
            throw Error('basisPieceMapping 必须完整且不重叠地覆盖原 Path uses');
          cursor = value[1];
        }
        if (cursor !== 1)
          throw Error('basisPieceMapping 必须完整且不重叠地覆盖原 Path uses');
      }
      return pieces;
    });
};

/** Exact source replacement keeps the Path/owner/Program. Equal topology keeps
 * Vertex/Edge IDs (including reversed uses); changed topology gets fresh IDs.
 * Consumers of removed geometry remain explicit repairable references, as with
 * node deletion. Shared geometry and driven sources cannot be overwritten.
 */
export function createPathReplacementCommand(request) {
  const action = structuredClone(request);
  return (document, { idFactory = () => crypto.randomUUID() } = {}) => {
    validateDocument(document);
    if (
      action?.kind !== 'replace-path-geometry' ||
      Object.keys(action).some(
        (key) =>
          ![
            'kind',
            'pathRef',
            'expectedEdges',
            'cubics',
            'closed',
            'handleModes',
            'basisPieceMapping',
          ].includes(key),
      )
    )
      throw Error('路径替换动作无效');
    const target = action.pathRef;
    if (
      target?.kind !== 'path' ||
      typeof target.sketchId !== 'string' ||
      typeof target.id !== 'string' ||
      Object.keys(target).some(
        (key) => !['kind', 'sketchId', 'id'].includes(key),
      )
    )
      throw Error('路径引用无效');
    const source = document.sketches[target.sketchId],
      original = source?.paths[target.id];
    if (!original) throw Error('路径不存在');
    if (effectiveNodeState(document, source.ownerNodeId).locked)
      throw Error('部件已锁定');
    if (
      !Array.isArray(action.expectedEdges) ||
      action.expectedEdges.length !== original.edges.length ||
      action.expectedEdges.some(
        (use, i) =>
          !use ||
          ![
            hasPathBasis(document) ? 3 : 2,
            hasPathBasis(document) ? 4 : 2,
          ].includes(Object.keys(use).length) ||
          use.edgeId !== original.edges[i].edgeId ||
          use.reversed !== original.edges[i].reversed ||
          (hasPathBasis(document) &&
            (use.basisPieces
              ? !sameJson(use.basisPieces, original.edges[i].basisPieces)
              : !Array.isArray(use.basisSpan) ||
                use.basisSpan[0] !== original.edges[i].basisSpan?.[0] ||
                use.basisSpan[1] !== original.edges[i].basisSpan?.[1] ||
                use.basisId !== original.edges[i].basisId ||
                original.edges[i].basisPieces !== undefined)),
      )
    )
      throw Error('Path 拓扑已变化，请重新读取样条');
    if (
      typeof action.closed !== 'boolean' ||
      !Array.isArray(action.cubics) ||
      !action.cubics.length ||
      action.cubics.length > 1000 ||
      !action.cubics.every(
        (c) => Array.isArray(c) && c.length === 4 && c.every(vec),
      )
    )
      throw Error('替换需要有限的世界坐标 cubic 和明确的开闭状态');
    const cubics = action.cubics;
    if (
      cubics.some((c, i) => i > 0 && !near(cubics[i - 1][3], c[0])) ||
      (action.closed && !near(cubics.at(-1)[3], cubics[0][0]))
    )
      throw Error('样条端点不连续或闭合接缝不一致');
    const nodeCount = cubics.length + (action.closed ? 0 : 1);
    if (
      action.handleModes !== undefined &&
      (!Array.isArray(action.handleModes) ||
        action.handleModes.length !== nodeCount ||
        !action.handleModes.every((mode) =>
          ['corner', 'smooth', 'symmetric'].includes(mode),
        ))
    )
      throw Error('handleModes 必须逐节点对应');

    const entries = original.edges.map((use) => {
      const edge = source.edges[use.edgeId];
      if (!edge) throw Error('路径含失效的 Edge');
      return {
        ...use,
        start: use.reversed ? edge.endVertexId : edge.startVertexId,
        end: use.reversed ? edge.startVertexId : edge.endVertexId,
      };
    });
    if (entries.some((entry, i) => i && entries[i - 1].end !== entry.start))
      throw Error('路径拓扑不连续');
    const wasClosed =
      entries.length > 0 && entries.at(-1).end === entries[0].start;
    const nodeIds = entries.length
      ? [
          ...entries.map((entry) => entry.start),
          ...(wasClosed ? [] : [entries.at(-1).end]),
        ]
      : [original.startVertexId];
    if (
      new Set(nodeIds).size !== nodeIds.length ||
      new Set(entries.map((entry) => entry.edgeId)).size !== entries.length
    )
      throw Error('重复使用的拓扑需要先显式拆分');
    const sameTopology =
      entries.length === cubics.length && wasClosed === action.closed;
    const edgeIds = new Set(entries.map((entry) => entry.edgeId)),
      vertexIds = new Set(nodeIds);
    for (const id of vertexIds) {
      if (!source.vertices[id] || source.vertices[id].position.kind !== 'free')
        throw Error('受 Relation 驱动或失效的 Vertex 不能替换');
    }
    for (const edge of Object.values(source.edges)) {
      if (edgeIds.has(edge.id)) {
        if (edge.startHandle.kind !== 'free' || edge.endHandle.kind !== 'free')
          throw Error('受 Relation 驱动的 Handle 不能替换');
      } else if (
        vertexIds.has(edge.startVertexId) ||
        vertexIds.has(edge.endVertexId)
      )
        throw Error('路径 Vertex 被其他 Edge 共享');
    }
    for (const path of Object.values(source.paths)) {
      if (
        path.id !== original.id &&
        (vertexIds.has(path.startVertexId) ||
          path.edges.some((use) => edgeIds.has(use.edgeId)) ||
          Object.keys(path.handleModes || {}).some((id) => vertexIds.has(id)))
      )
        throw Error('路径几何被其他 Path 共享');
    }

    const next = structuredClone(document),
      sketch = next.sketches[source.id],
      path = sketch.paths[original.id];
    const allocate = createCommandIdAllocator(document, idFactory);
    const desiredIds = sameTopology
      ? nodeIds
      : Array.from({ length: nodeCount }, allocate);
    const local = inverseTransform(worldMatrix(document, source.ownerNodeId));
    const converted = cubics.map((c) => c.map((p) => transformPoint(local, p)));
    const positions = [
      ...converted.map((c) => c[0]),
      ...(action.closed ? [] : [converted.at(-1)[3]]),
    ];
    const removedRefs = [];
    const mappedPieces =
      hasPathBasis(document) && !sameTopology
        ? replacementPieces(original, action.basisPieceMapping, cubics.length)
        : null;
    if (!sameTopology) {
      for (const id of edgeIds) {
        delete sketch.edges[id];
        removedRefs.push(ref('edge', sketch.id, id));
      }
      for (const id of vertexIds) {
        delete sketch.vertices[id];
        removedRefs.push(ref('vertex', sketch.id, id));
      }
    }
    desiredIds.forEach((id, i) => {
      sketch.vertices[id] = {
        id,
        position: { kind: 'free', value: positions[i] },
      };
    });
    path.edges = converted.map((cubic, i) => {
      const use = sameTopology
        ? original.edges[i]
        : hasPathBasis(document)
          ? withBasisPieces(
              document,
              path,
              { edgeId: allocate(), reversed: false },
              mappedPieces[i],
            )
          : { edgeId: allocate(), reversed: false };
      const first = desiredIds[i],
        last = desiredIds[(i + 1) % desiredIds.length];
      const start = use.reversed ? last : first,
        end = use.reversed ? first : last;
      const c = use.reversed ? [...cubic].reverse() : cubic;
      sketch.edges[use.edgeId] = {
        id: use.edgeId,
        startVertexId: start,
        endVertexId: end,
        startHandle: {
          kind: 'free',
          vector: vector(sketch.vertices[start].position.value, c[1]),
        },
        endHandle: {
          kind: 'free',
          vector: vector(sketch.vertices[end].position.value, c[2]),
        },
      };
      return { ...use };
    });
    if (hasPathBasis(document)) {
      if (action.closed) {
        const outputBases = new Set(
          path.edges.flatMap((use) =>
            basisPiecesForUse(path, use).map((piece) => piece.basisId),
          ),
        );
        if (outputBases.size > 1 || path.edges.some((use) => use.basisPieces)) {
          delete path.basisPeriod;
        } else {
          const start = path.edges[0].basisSpan[0];
          const end = path.edges.at(-1).basisSpan[1];
          const period = Math.abs(end - start);
          if (!(period > 0)) throw Error('闭合 Path basisPeriod 无法确定');
          const [replacementBasisId] = outputBases;
          if (replacementBasisId === path.id) path.basisPeriod = period;
          else {
            path.basisCatalog = {
              ...path.basisCatalog,
              [replacementBasisId]: {
                ...path.basisCatalog?.[replacementBasisId],
                period,
              },
            };
            delete path.basisPeriod;
          }
        }
      } else delete path.basisPeriod;
    }
    delete path.startVertexId;
    if (action.handleModes !== undefined) {
      path.handleModes = Object.fromEntries(
        desiredIds.flatMap((id, i) =>
          action.handleModes[i] === 'corner'
            ? []
            : [[id, action.handleModes[i]]],
        ),
      );
    } else if (!sameTopology) delete path.handleModes;
    if (path.handleModes && !Object.keys(path.handleModes).length)
      delete path.handleModes;
    validateDocument(next);
    return {
      document: next,
      removedRefs,
      changedRefs: [
        target,
        ...desiredIds.map((id) => ref('vertex', sketch.id, id)),
        ...path.edges.map((use) => ref('edge', sketch.id, use.edgeId)),
        ...removedRefs,
      ],
    };
  };
}
