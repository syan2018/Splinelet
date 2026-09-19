import { resolveDatum } from './datums.mjs';
import { resolveScalar } from './parameters.mjs';
import {
  relationFrameTransform,
  transformPoint,
} from '../scene/transforms.mjs';

const unique = (values) => [...new Set(values)];
const refKey = (target) =>
  target.kind === 'vertex'
    ? `vertex:${target.sketchId}:${target.id}`
    : `edge-end:${target.sketchId}:${target.edgeId}:${target.end}`;
const diagnostic = (kind, message, ref) => ({
  severity: 'error',
  kind,
  ...(ref && { ref }),
  message,
});
const ready = (value, dependencies) => ({
  status: 'ready',
  value: [...value],
  diagnostics: [],
  dependencies: unique(dependencies),
});
const blocked = (item, dependencies = []) => ({
  status: 'blocked',
  value: null,
  diagnostics: [item],
  dependencies: unique(dependencies),
});
const mergeBlocked = (result, dependencies) => ({
  ...result,
  dependencies: unique([...dependencies, ...(result.dependencies || [])]),
});
const finiteVec2 = (value) =>
  Array.isArray(value) && value.length === 2 && value.every(Number.isFinite);
const toleranceFor = (document) =>
  document?.geometrySettings?.numericTolerance || 1e-9;
const sourceNodeDependencies = (frame, targetOwnerId, sourceOwnerId) =>
  frame?.space === 'world'
    ? [
        ...(targetOwnerId === null ? [] : [`node:${targetOwnerId}:world`]),
        ...(sourceOwnerId === null ? [] : [`node:${sourceOwnerId}:world`]),
      ]
    : [];

function sourcePoint(document, source, state) {
  if (source.kind === 'datum') {
    const datum = resolveDatum(document, source.id);
    if (datum.status !== 'ready') return datum;
    if (datum.value.kind !== 'point')
      return blocked(
        diagnostic(
          'invalid-reference',
          `Datum 不是 point：${source.id}`,
          source,
        ),
        datum.dependencies,
      );
    return {
      ...datum,
      value: datum.value.position,
      ownerNodeId: datum.value.ownerNodeId,
    };
  }
  if (source.kind !== 'vertex')
    return blocked(
      diagnostic('invalid-reference', 'coincident source 无效', source),
    );
  const vertex = document?.sketches?.[source.sketchId]?.vertices?.[source.id];
  const ownerNodeId = document?.sketches?.[source.sketchId]?.ownerNodeId;
  const dependencies = [`sketch:${source.sketchId}`];
  if (!vertex)
    return blocked(
      diagnostic(
        'unresolved-reference',
        `Source Vertex 不存在：${source.id}`,
        source,
      ),
      dependencies,
    );
  const point = resolveVertex(document, source.sketchId, source.id, state);
  if (point.status !== 'ready') return mergeBlocked(point, dependencies);
  return {
    ...point,
    ownerNodeId,
    dependencies: unique([...dependencies, ...point.dependencies]),
  };
}

function resolveVertex(document, sketchId, vertexId, state) {
  const sketch = document?.sketches?.[sketchId];
  const dependencies = [`sketch:${sketchId}`];
  const vertex = sketch?.vertices?.[vertexId];
  const target = { kind: 'vertex', sketchId, id: vertexId };
  if (!vertex)
    return blocked(
      diagnostic('unresolved-reference', `Vertex 不存在：${vertexId}`, target),
      dependencies,
    );
  if (vertex.position?.kind === 'free' && finiteVec2(vertex.position.value))
    return ready(vertex.position.value, dependencies);
  if (vertex.position?.kind !== 'relation')
    return blocked(
      diagnostic('invalid-reference', `Vertex 位置无效：${vertexId}`, target),
      dependencies,
    );
  return mergeBlocked(
    resolveWithState(
      { document, sketch, target, relationId: vertex.position.relationId },
      state,
    ),
    dependencies,
  );
}

function resolveHandle(document, ref, state) {
  const sketch = document?.sketches?.[ref.sketchId];
  const edge = sketch?.edges?.[ref.edgeId];
  const dependencies = [`sketch:${ref.sketchId}`];
  if (!edge)
    return blocked(
      diagnostic('unresolved-reference', `Edge 不存在：${ref.edgeId}`, ref),
      dependencies,
    );
  const handle = edge[ref.end === 'start' ? 'startHandle' : 'endHandle'];
  if (handle?.kind === 'free' && finiteVec2(handle.vector))
    return ready(handle.vector, dependencies);
  if (handle?.kind !== 'relation')
    return blocked(
      diagnostic('invalid-reference', 'EdgeEnd 柄无效', ref),
      dependencies,
    );
  return mergeBlocked(
    resolveWithState(
      { document, sketch, target: ref, relationId: handle.relationId },
      state,
    ),
    dependencies,
  );
}

const sharedVertex = (edge, end) =>
  end === 'start' ? edge.startVertexId : edge.endVertexId;
const otherVertex = (edge, end) =>
  end === 'start' ? edge.endVertexId : edge.startVertexId;

function mapSourcePoint(
  document,
  relation,
  sourceOwnerId,
  sourceValue,
  dependencies,
) {
  const targetSketch = document?.sketches?.[relation.target.sketchId];
  if (!targetSketch)
    return blocked(
      diagnostic(
        'unresolved-reference',
        `Target Sketch 不存在：${relation.target.sketchId}`,
        relation.target,
      ),
      dependencies,
    );
  const frameDependencies = sourceNodeDependencies(
    relation.frame,
    targetSketch.ownerNodeId,
    sourceOwnerId,
  );
  try {
    return ready(
      transformPoint(
        relationFrameTransform(
          document,
          targetSketch.ownerNodeId,
          sourceOwnerId,
          relation.frame,
        ),
        sourceValue,
      ),
      [...dependencies, ...frameDependencies],
    );
  } catch (error) {
    return blocked(
      diagnostic(
        'invalid-frame',
        error instanceof Error ? error.message : '关系框架无效',
      ),
      [...dependencies, ...frameDependencies],
    );
  }
}

function resolvePointOnAxis(document, relation, state, dependencies) {
  const axis = resolveDatum(document, relation.axisId);
  if (axis.status !== 'ready') return mergeBlocked(axis, dependencies);
  if (axis.value.kind !== 'axis')
    return blocked(
      diagnostic('invalid-reference', `Datum 不是 axis：${relation.axisId}`),
      [...dependencies, ...axis.dependencies],
    );
  const distance = resolveScalar(document, relation.distance);
  if (distance.status !== 'ready')
    return mergeBlocked(distance, [...dependencies, ...axis.dependencies]);
  const local = [
    axis.value.origin[0] + axis.value.direction[0] * distance.value,
    axis.value.origin[1] + axis.value.direction[1] * distance.value,
  ];
  return mapSourcePoint(document, relation, axis.value.ownerNodeId, local, [
    ...dependencies,
    ...axis.dependencies,
    ...distance.dependencies,
  ]);
}

function resolveCoincident(document, relation, state, dependencies) {
  const source = sourcePoint(document, relation.source, state);
  if (source.status !== 'ready') return mergeBlocked(source, dependencies);
  if (!Array.isArray(relation.offset) || relation.offset.length !== 2)
    return blocked(diagnostic('invalid-relation', 'coincident offset 无效'), [
      ...dependencies,
      ...source.dependencies,
    ]);
  const offsetX = resolveScalar(document, relation.offset[0]);
  if (offsetX.status !== 'ready')
    return mergeBlocked(offsetX, [...dependencies, ...source.dependencies]);
  const offsetY = resolveScalar(document, relation.offset[1]);
  if (offsetY.status !== 'ready')
    return mergeBlocked(offsetY, [
      ...dependencies,
      ...source.dependencies,
      ...offsetX.dependencies,
    ]);
  return mapSourcePoint(
    document,
    relation,
    source.ownerNodeId,
    [source.value[0] + offsetX.value, source.value[1] + offsetY.value],
    [
      ...dependencies,
      ...source.dependencies,
      ...offsetX.dependencies,
      ...offsetY.dependencies,
    ],
  );
}

function normalize(vector, tolerance) {
  const length = Math.hypot(vector[0], vector[1]);
  return length > tolerance ? [vector[0] / length, vector[1] / length] : null;
}

function resolveContinuity(document, relation, state, dependencies) {
  const targetEdge =
    document?.sketches?.[relation.target.sketchId]?.edges?.[
      relation.target.edgeId
    ];
  const sourceEdge =
    document?.sketches?.[relation.source.sketchId]?.edges?.[
      relation.source.edgeId
    ];
  if (!targetEdge || !sourceEdge)
    return blocked(
      diagnostic('unresolved-reference', 'handle-continuity Edge 不存在'),
      dependencies,
    );
  if (
    relation.target.sketchId !== relation.source.sketchId ||
    sharedVertex(targetEdge, relation.target.end) !==
      sharedVertex(sourceEdge, relation.source.end)
  )
    return blocked(
      diagnostic('invalid-relation', 'handle-continuity 必须共享同一顶点'),
      dependencies,
    );
  const tolerance = toleranceFor(document);
  if (relation.mode === 'symmetric') {
    const source = resolveHandle(document, relation.source, state);
    if (source.status !== 'ready') return mergeBlocked(source, dependencies);
    return ready(
      [-source.value[0], -source.value[1]],
      [...dependencies, ...source.dependencies],
    );
  }
  if (relation.mode === 'smooth') {
    const source = resolveHandle(document, relation.source, state);
    if (source.status !== 'ready') return mergeBlocked(source, dependencies);
    const direction = normalize(source.value, tolerance);
    if (!direction)
      return blocked(diagnostic('zero-direction', 'smooth source 柄长度为零'), [
        ...dependencies,
        ...source.dependencies,
      ]);
    const length = resolveScalar(document, relation.length);
    if (length.status !== 'ready')
      return mergeBlocked(length, [...dependencies, ...source.dependencies]);
    return ready(
      [-direction[0] * length.value, -direction[1] * length.value],
      [...dependencies, ...source.dependencies, ...length.dependencies],
    );
  }
  if (relation.mode !== 'auto')
    return blocked(
      diagnostic('invalid-relation', `未知连续性模式：${relation.mode}`),
      dependencies,
    );
  // auto intentionally never reads either handle: at shared V, source other S
  // and target other T define normalize(T-S) * |T-V| / 3. This avoids a
  // synthetic two-handle dependency cycle.
  const sketchId = relation.target.sketchId;
  const vertexV = sharedVertex(targetEdge, relation.target.end);
  const vertexS = otherVertex(sourceEdge, relation.source.end);
  const vertexT = otherVertex(targetEdge, relation.target.end);
  const v = resolveVertex(document, sketchId, vertexV, state);
  if (v.status !== 'ready') return mergeBlocked(v, dependencies);
  const s = resolveVertex(document, sketchId, vertexS, state);
  if (s.status !== 'ready')
    return mergeBlocked(s, [...dependencies, ...v.dependencies]);
  const t = resolveVertex(document, sketchId, vertexT, state);
  if (t.status !== 'ready')
    return mergeBlocked(t, [
      ...dependencies,
      ...v.dependencies,
      ...s.dependencies,
    ]);
  const tangent = normalize(
    [t.value[0] - s.value[0], t.value[1] - s.value[1]],
    tolerance,
  );
  const chord = Math.hypot(t.value[0] - v.value[0], t.value[1] - v.value[1]);
  if (!tangent || chord <= tolerance)
    return blocked(
      diagnostic('zero-direction', 'auto 连续性没有稳定的 S/T/V 方向'),
      [
        ...dependencies,
        ...v.dependencies,
        ...s.dependencies,
        ...t.dependencies,
      ],
    );
  return ready(
    [tangent[0] * (chord / 3), tangent[1] * (chord / 3)],
    [...dependencies, ...v.dependencies, ...s.dependencies, ...t.dependencies],
  );
}

function resolveWithState(input, state) {
  const { document, target, relationId } = input || {};
  const rootDependencies = [`relation:${relationId}`];
  const relation = document?.relations?.[relationId];
  if (!relation)
    return blocked(
      diagnostic('unresolved-reference', `Relation 不存在：${relationId}`, {
        kind: 'relation',
        id: relationId,
      }),
      rootDependencies,
    );
  if (!target || refKey(target) !== refKey(relation.target))
    return blocked(
      diagnostic(
        'invalid-target',
        `Relation target 不匹配：${relationId}`,
        target,
      ),
      rootDependencies,
    );
  if (state.stack.includes(relationId)) {
    const index = state.stack.indexOf(relationId);
    const path = [...state.stack.slice(index), relationId];
    return blocked(
      diagnostic('cycle', `Relation 依赖循环：${path.join(' → ')}`),
      path.map((id) => `relation:${id}`),
    );
  }
  state.stack.push(relationId);
  try {
    if (relation.kind === 'point-on-axis')
      return resolvePointOnAxis(document, relation, state, rootDependencies);
    if (relation.kind === 'coincident')
      return resolveCoincident(document, relation, state, rootDependencies);
    if (relation.kind === 'handle-continuity')
      return resolveContinuity(document, relation, state, rootDependencies);
    return blocked(
      diagnostic('invalid-relation', `未知 Relation 类型：${relation.kind}`),
      rootDependencies,
    );
  } finally {
    state.stack.pop();
  }
}

/**
 * `resolveSketch` injection entry point. Its ready value is always a Vec2 in
 * the target Sketch local frame; blocked results retain the full dependency
 * closure for T06 invalidation and diagnostics.
 */
export function resolveRelation(input) {
  return resolveWithState(input, { stack: [] });
}

export function relationDependencies(input) {
  return resolveRelation(input).dependencies;
}
