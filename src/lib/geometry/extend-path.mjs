import {
  inverseTransform,
  transformPoint,
  worldMatrix,
} from '../scene/transforms.mjs';
import { resolveRelation } from './relations.mjs';
import {
  basisIdForUse,
  basisPiecesForUse,
  hasPathBasis,
  pathHasCompositeBasis,
  withBasisPieces,
} from './path-basis.mjs';

const vec = (value) =>
  Array.isArray(value) && value.length === 2 && value.every(Number.isFinite);
const ref = (kind, sketchId, id) => ({ kind, sketchId, id });
const position = (document, sketch, vertexId) => {
  const vertex = sketch.vertices[vertexId];
  if (!vertex) throw Error('路径端点不存在');
  if (vertex.position.kind === 'free') return vertex.position.value;
  const result = resolveRelation({
    document,
    sketch,
    target: ref('vertex', sketch.id, vertexId),
    relationId: vertex.position.relationId,
  });
  if (result.status !== 'ready' || !vec(result.value))
    throw Error('路径端点关系尚未解算');
  return result.value;
};
const matches = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]) <= 1e-9;

/** Add one exact fitted cubic, directed outwards from the chosen endpoint.
 * Existing edges, handles and vertex identities are never reversed or refitted.
 * The caller supplies a transaction draft and enforces owner permissions.
 */
export function extendPath(document, action, { idFactory }) {
  const sketch = document.sketches[action.sketchId];
  const path = sketch?.paths[action.pathId];
  const end = action.end ?? 'end';
  if (
    !path ||
    (!path.edges.length && !path.startVertexId) ||
    !['start', 'end'].includes(end)
  )
    throw Error('请选择开放路径的头或尾');
  if (!path.edges.length && action.close) throw Error('至少先绘制一段曲线');
  let first = path.edges.length ? undefined : path.startVertexId;
  let last = first;
  for (const use of path.edges) {
    const edge = sketch.edges[use.edgeId];
    if (!edge) throw Error('路径引用的曲线段不存在');
    const from = use.reversed ? edge.endVertexId : edge.startVertexId;
    const to = use.reversed ? edge.startVertexId : edge.endVertexId;
    if (last !== undefined && last !== from) throw Error('路径内部拓扑不连续');
    first ??= from;
    last = to;
  }
  if (path.edges.length && first === last) throw Error('闭合路径不能续画');
  const fromId = end === 'start' ? first : last;
  const toId = end === 'start' ? last : first;
  const from = position(document, sketch, fromId);
  const to = action.close ? position(document, sketch, toId) : null;
  let cubic;
  if (action.cubic !== undefined) {
    if (
      !Array.isArray(action.cubic) ||
      action.cubic.length !== 4 ||
      !action.cubic.every(vec)
    )
      throw Error('续画需要一段有限世界坐标 cubic');
    const matrix = inverseTransform(worldMatrix(document, sketch.ownerNodeId));
    cubic = action.cubic.map((point) => transformPoint(matrix, point));
    if (!matches(cubic[0], from) || (to && !matches(cubic[3], to)))
      throw Error('拟合结果端点与当前路径不一致');
  } else if (to) cubic = [from, from, to, to].map((point) => [...point]);
  else throw Error('续画必须提供拟合 cubic');
  const nextId = action.close ? toId : idFactory();
  if (!action.close)
    sketch.vertices[nextId] = {
      id: nextId,
      position: { kind: 'free', value: [...cubic[3]] },
    };
  let startId = fromId,
    endId = nextId;
  if (end === 'start') {
    cubic.reverse();
    [startId, endId] = [endId, startId];
  }
  const edgeId = idFactory();
  sketch.edges[edgeId] = {
    id: edgeId,
    startVertexId: startId,
    endVertexId: endId,
    startHandle: {
      kind: 'free',
      vector: cubic[1].map((n, i) => n - cubic[0][i]),
    },
    endHandle: {
      kind: 'free',
      vector: cubic[2].map((n, i) => n - cubic[3][i]),
    },
  };
  const basis = hasPathBasis(document);
  const adjacentUse = end === 'start' ? path.edges[0] : path.edges.at(-1);
  const adjacentPieces =
    basis && adjacentUse ? basisPiecesForUse(path, adjacentUse) : [];
  const adjacentPiece =
    end === 'start' ? adjacentPieces[0] : adjacentPieces.at(-1);
  const adjacentSpan = adjacentPiece?.span;
  const direction = adjacentSpan
    ? Math.sign(adjacentSpan[1] - adjacentSpan[0]) || 1
    : 1;
  const adjacentBasisId =
    adjacentPiece?.basisId ||
    (adjacentUse ? basisIdForUse(path, adjacentUse) : path.id);
  const compositeClose = basis && action.close && pathHasCompositeBasis(path);
  const bridgeBasisId = compositeClose ? idFactory() : null;
  if (
    bridgeBasisId !== null &&
    (typeof bridgeBasisId !== 'string' || !bridgeBasisId)
  )
    throw Error('复合闭合需要有效 bridge basis ID');
  const rawUse = { edgeId, reversed: false };
  const use = basis
    ? withBasisPieces(
        document,
        path,
        rawUse,
        compositeClose
          ? [{ t: [0, 1], basisId: bridgeBasisId, span: [0, 1] }]
          : [
              {
                t: [0, 1],
                basisId: adjacentBasisId,
                span: path.edges.length
                  ? end === 'start' && !action.close
                    ? [adjacentSpan[0] - direction, adjacentSpan[0]]
                    : [adjacentSpan[1], adjacentSpan[1] + direction]
                  : [0, 1],
              },
            ],
      )
    : rawUse;
  if (end === 'start' && !action.close) path.edges.unshift(use);
  else path.edges.push(use);
  if (basis && action.close) {
    if (compositeClose) {
      path.basisCatalog = {
        ...path.basisCatalog,
        [bridgeBasisId]: {},
      };
      delete path.basisPeriod;
      delete path.startVertexId;
      return {
        document,
        changedRefs: [
          ref('path', sketch.id, path.id),
          ref('edge', sketch.id, edgeId),
        ],
      };
    }
    const closingEnd = use.basisSpan[1];
    const closingStart = path.edges[0].basisSpan[0];
    const period = Math.abs(closingEnd - closingStart);
    if (!(period > 0)) throw Error('闭合 Path basisPeriod 无法确定');
    if (adjacentBasisId === path.id) path.basisPeriod = period;
    else {
      path.basisCatalog = {
        ...path.basisCatalog,
        [adjacentBasisId]: {
          ...path.basisCatalog?.[adjacentBasisId],
          period,
        },
      };
      delete path.basisPeriod;
    }
  }
  delete path.startVertexId;
  return {
    document,
    changedRefs: [
      ref('path', sketch.id, path.id),
      ref('edge', sketch.id, edgeId),
      ...(!action.close ? [ref('vertex', sketch.id, nextId)] : []),
    ],
  };
}
