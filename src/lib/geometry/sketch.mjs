import { identityTransform, transformPoint } from '../scene/transforms.mjs';
import {
  basisPiecesForUse,
  basisPeriodForUse,
  hasPathBasis,
  reverseBasisPieces,
} from './path-basis.mjs';

const blocked = (ownerNodeId, diagnostics, dependencies = []) => ({
  domain: 'curves',
  status: 'blocked',
  value: null,
  diagnostics,
  dependencies,
  frame: { kind: 'local', ownerNodeId },
});
const finiteVec2 = (value) =>
  Array.isArray(value) &&
  value.length === 2 &&
  value.every((component) => Number.isFinite(component));
const add = (left, right) => [left[0] + right[0], left[1] + right[1]];
const edgeRef = (sketchId, id) => ({ kind: 'edge', sketchId, id });
const pathRef = (sketchId, id) => ({ kind: 'path', sketchId, id });

const splitCubic = (cubic, t) => {
  const mix = (left, right) => [
    left[0] + (right[0] - left[0]) * t,
    left[1] + (right[1] - left[1]) * t,
  ];
  const [p0, p1, p2, p3] = cubic;
  const p01 = mix(p0, p1),
    p12 = mix(p1, p2),
    p23 = mix(p2, p3);
  const p012 = mix(p01, p12),
    p123 = mix(p12, p23),
    point = mix(p012, p123);
  return { first: [p0, p01, p012, point], second: [point, p123, p23, p3] };
};

const splitCubicByPieces = (cubic, pieces) => {
  let previous = 0,
    remaining = cubic;
  return pieces.map((piece, index) => {
    const last = index === pieces.length - 1;
    const relative = last ? 1 : (piece.t[1] - previous) / (1 - previous);
    if (last) return remaining;
    const split = splitCubic(remaining, relative);
    remaining = split.second;
    previous = piece.t[1];
    return split.first;
  });
};

const relationValue = (
  document,
  sketch,
  target,
  relationId,
  context,
  diagnostics,
  dependencies,
) => {
  if (typeof context.resolveRelation !== 'function') {
    diagnostics.push({
      severity: 'error',
      kind: 'unavailable',
      ref: target,
      message: `关系 ${relationId} 需要 resolver`,
    });
    return null;
  }
  const result = context.resolveRelation({
    document,
    sketch,
    target,
    relationId,
  });
  if (!result || result.status !== 'ready' || !finiteVec2(result.value)) {
    diagnostics.push(
      ...(result?.diagnostics || [
        {
          severity: 'error',
          kind: 'blocked',
          ref: target,
          message: `关系 ${relationId} 无法解算`,
        },
      ]),
    );
    return null;
  }
  dependencies.push(...(result.dependencies || []));
  return result.value;
};

function resolveVertex(
  document,
  sketch,
  vertexId,
  context,
  diagnostics,
  dependencies,
) {
  const vertex = sketch.vertices[vertexId];
  const target = { kind: 'vertex', sketchId: sketch.id, id: vertexId };
  if (!vertex) {
    diagnostics.push({
      severity: 'error',
      kind: 'unresolved-reference',
      ref: target,
      message: 'Edge 顶点不存在',
    });
    return null;
  }
  if (vertex.position.kind === 'free') return vertex.position.value;
  return relationValue(
    document,
    sketch,
    target,
    vertex.position.relationId,
    context,
    diagnostics,
    dependencies,
  );
}

function resolveHandle(
  document,
  sketch,
  edge,
  end,
  anchor,
  context,
  diagnostics,
  dependencies,
) {
  const handle = edge[end === 'start' ? 'startHandle' : 'endHandle'];
  const target = {
    kind: 'edge-end',
    sketchId: sketch.id,
    edgeId: edge.id,
    end,
  };
  const vector =
    handle.kind === 'free'
      ? handle.vector
      : relationValue(
          document,
          sketch,
          target,
          handle.relationId,
          context,
          diagnostics,
          dependencies,
        );
  return vector && add(anchor, vector);
}

/**
 * Resolves a Sketch to local exact cubic DTOs. `context.resolveRelation` is the
 * explicit T05 injection point and must return a ready StageResult<Vec2>.
 */
export function resolveSketch(document, sketchId, context = {}) {
  const sketch = document?.sketches?.[sketchId];
  if (!sketch)
    return blocked(
      '',
      [
        {
          severity: 'error',
          kind: 'unresolved-reference',
          ref: { kind: 'program', id: sketchId },
          message: 'Sketch 不存在',
        },
      ],
      [`sketch:${sketchId}`],
    );
  const diagnostics = [];
  const dependencies = [`sketch:${sketchId}`];
  const curves = [];
  for (const path of Object.values(sketch.paths)) {
    const uses = path.edges;
    if (!uses.length && path.startVertexId)
      resolveVertex(
        document,
        sketch,
        path.startVertexId,
        context,
        diagnostics,
        dependencies,
      );
    const resolved = [];
    let resolvedUses = 0;
    const occurrences = new Map();
    let firstVertexId = null;
    let previousEndId = null;
    for (let index = 0; index < uses.length; index++) {
      const use = uses[index];
      const edge = sketch.edges[use.edgeId];
      if (!edge) {
        diagnostics.push({
          severity: 'error',
          kind: 'unresolved-reference',
          ref: pathRef(sketch.id, path.id),
          message: `Path 使用的 Edge 不存在：${use.edgeId}`,
        });
        continue;
      }
      const startId = use.reversed ? edge.endVertexId : edge.startVertexId;
      const endId = use.reversed ? edge.startVertexId : edge.endVertexId;
      if (index === 0) firstVertexId = startId;
      else if (previousEndId !== startId)
        diagnostics.push({
          severity: 'warning',
          kind: 'open-junction',
          ref: pathRef(sketch.id, path.id),
          message: 'Path 相邻 Edge 未共享顶点，不自动焊接',
        });
      previousEndId = endId;
      const sourceStart = resolveVertex(
        document,
        sketch,
        edge.startVertexId,
        context,
        diagnostics,
        dependencies,
      );
      const sourceEnd = resolveVertex(
        document,
        sketch,
        edge.endVertexId,
        context,
        diagnostics,
        dependencies,
      );
      if (!sourceStart || !sourceEnd) continue;
      const startHandle = resolveHandle(
        document,
        sketch,
        edge,
        'start',
        sourceStart,
        context,
        diagnostics,
        dependencies,
      );
      const endHandle = resolveHandle(
        document,
        sketch,
        edge,
        'end',
        sourceEnd,
        context,
        diagnostics,
        dependencies,
      );
      if (!startHandle || !endHandle) continue;
      const cubic = [sourceStart, startHandle, endHandle, sourceEnd];
      const occurrence = occurrences.get(edge.id) || 0;
      occurrences.set(edge.id, occurrence + 1);
      const directed = use.reversed ? [...cubic].reverse() : cubic;
      const pieces = hasPathBasis(document)
        ? basisPiecesForUse(path, use)
        : null;
      const cubics = pieces ? splitCubicByPieces(directed, pieces) : [directed];
      for (const [pieceIndex, piece] of (pieces || [null]).entries()) {
        const internalKey = `basis-piece:${path.id}:${edge.id}:${occurrence}:${pieceIndex}`;
        const basisPeriod = piece
          ? basisPeriodForUse(path, { basisId: piece.basisId })
          : undefined;
        resolved.push({
          key: `${path.id}:${edge.id}:${occurrence}${piece ? `:piece:${pieceIndex}` : ''}`,
          cubic: cubics[pieceIndex],
          startKey: pieceIndex
            ? `basis-piece:${path.id}:${edge.id}:${occurrence}:${pieceIndex - 1}`
            : use.reversed
              ? edge.endVertexId
              : edge.startVertexId,
          endKey:
            pieceIndex === cubics.length - 1
              ? use.reversed
                ? edge.startVertexId
                : edge.endVertexId
              : internalKey,
          source: edgeRef(sketch.id, edge.id),
          ...(piece
            ? {
                logicalSource: { sketchId: sketch.id, pathId: piece.basisId },
                basisSpan: [...piece.span],
                ...(basisPeriod === undefined ? {} : { basisPeriod }),
              }
            : {}),
          instances: [],
          transform: identityTransform(),
        });
      }
      resolvedUses++;
    }
    if (uses.length && previousEndId !== firstVertexId)
      diagnostics.push({
        severity: 'info',
        kind: 'open-path',
        ref: pathRef(sketch.id, path.id),
        message: 'Path 未闭合',
      });
    if (resolvedUses !== uses.length) continue;
    if (resolved.length)
      curves.push({
        key: path.id,
        pathRef: pathRef(sketch.id, path.id),
        edges: resolved,
        closed: previousEndId === firstVertexId,
        junctions: [],
      });
  }
  if (diagnostics.some((diagnostic) => diagnostic.severity === 'error'))
    return blocked(sketch.ownerNodeId, diagnostics, [...new Set(dependencies)]);
  const value = {
    frame: { kind: 'local', ownerNodeId: sketch.ownerNodeId },
    curves,
    junctions: [],
    provenance: [],
  };
  return {
    domain: 'curves',
    status: curves.length ? 'ready' : 'empty',
    value,
    diagnostics,
    dependencies: [...new Set(dependencies)],
  };
}

export function reversePathUses(path) {
  return {
    ...path,
    edges: path.edges
      .slice()
      .reverse()
      .map((use) => ({
        ...use,
        reversed: !use.reversed,
        ...(Array.isArray(use.basisSpan)
          ? { basisSpan: [use.basisSpan[1], use.basisSpan[0]] }
          : {}),
        ...(use.basisPieces
          ? { basisPieces: reverseBasisPieces(path, use) }
          : {}),
      })),
  };
}

export function cubicForEdge(sketch, edgeId, context = {}) {
  const edge = sketch?.edges?.[edgeId];
  if (!edge) throw Error('Edge 不存在');
  const document = { sketches: { [sketch.id]: sketch } };
  const diagnostics = [];
  const dependencies = [];
  const start = resolveVertex(
    document,
    sketch,
    edge.startVertexId,
    context,
    diagnostics,
    dependencies,
  );
  const end = resolveVertex(
    document,
    sketch,
    edge.endVertexId,
    context,
    diagnostics,
    dependencies,
  );
  const startHandle =
    start &&
    resolveHandle(
      document,
      sketch,
      edge,
      'start',
      start,
      context,
      diagnostics,
      dependencies,
    );
  const endHandle =
    end &&
    resolveHandle(
      document,
      sketch,
      edge,
      'end',
      end,
      context,
      diagnostics,
      dependencies,
    );
  if (!start || !end || !startHandle || !endHandle)
    throw Error('Edge 无法解算');
  return [start, startHandle, endHandle, end];
}

export function transformCubic(matrix, cubic) {
  return cubic.map((point) => transformPoint(matrix, point));
}
