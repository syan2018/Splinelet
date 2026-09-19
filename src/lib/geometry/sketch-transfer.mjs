import { validateDocument } from '../document/schema.mjs';
import {
  assertTransform,
  transformPoint,
  transformVector,
} from '../scene/transforms.mjs';

const compare = (left, right) => left.localeCompare(right);
const ref = (kind, sketchId, id) => ({ kind, sketchId, id });
const edgeEndRef = (sketchId, edgeId, end) => ({
  kind: 'edge-end',
  sketchId,
  edgeId,
  end,
});
const stable = (value) => JSON.stringify(value);
const same = (left, right) => stable(left) === stable(right);

const sourceClosure = (document, sourceSketchId, selectedPathIds) => {
  const source = document.sketches[sourceSketchId];
  const paths = new Set(selectedPathIds);
  const edges = new Set();
  const vertices = new Set();
  const relations = new Set();
  let changed = true;
  while (changed) {
    changed = false;
    for (const pathId of paths) {
      const path = source.paths[pathId];
      if (!path) throw Error(`转移闭包包含不存在的 Path: ${pathId}`);
      for (const use of path.edges) {
        const edge = source.edges[use.edgeId];
        if (!edge)
          throw Error(
            `转移闭包中的 Path ${pathId} 引用了不存在的 Edge: ${use.edgeId}`,
          );
        if (!edges.has(edge.id)) changed = true;
        edges.add(edge.id);
        if (
          !vertices.has(edge.startVertexId) ||
          !vertices.has(edge.endVertexId)
        )
          changed = true;
        vertices.add(edge.startVertexId);
        vertices.add(edge.endVertexId);
      }
    }
    // An edge owns both endpoint references even when no Path currently uses
    // it. Moving either vertex without this expansion would leave that edge in
    // the source Sketch with a dangling endpoint.
    for (const edge of Object.values(source.edges)) {
      if (!vertices.has(edge.startVertexId) && !vertices.has(edge.endVertexId))
        continue;
      if (!edges.has(edge.id)) changed = true;
      edges.add(edge.id);
    }
    for (const [pathId, path] of Object.entries(source.paths)) {
      if (!path.edges.some((use) => edges.has(use.edgeId)) || paths.has(pathId))
        continue;
      paths.add(pathId);
      changed = true;
    }
    for (const relation of Object.values(document.relations)) {
      const targetInside =
        relation.target.kind === 'vertex'
          ? relation.target.sketchId === sourceSketchId &&
            vertices.has(relation.target.id)
          : relation.target.sketchId === sourceSketchId &&
            edges.has(relation.target.edgeId);
      const continuityTouches =
        relation.kind === 'handle-continuity' &&
        relation.target.sketchId === sourceSketchId &&
        (edges.has(relation.target.edgeId) ||
          edges.has(relation.source.edgeId));
      if (!targetInside && !continuityTouches) continue;
      if (!relations.has(relation.id)) changed = true;
      relations.add(relation.id);
      if (relation.kind === 'handle-continuity') {
        for (const edgeId of [relation.target.edgeId, relation.source.edgeId]) {
          const edge = source.edges[edgeId];
          if (!edge) continue;
          if (!edges.has(edge.id)) changed = true;
          edges.add(edge.id);
          if (
            !vertices.has(edge.startVertexId) ||
            !vertices.has(edge.endVertexId)
          )
            changed = true;
          vertices.add(edge.startVertexId);
          vertices.add(edge.endVertexId);
        }
      }
      if (
        relation.kind === 'coincident' &&
        relation.source.kind === 'vertex' &&
        relation.source.sketchId === sourceSketchId
      ) {
        if (!vertices.has(relation.source.id)) changed = true;
        vertices.add(relation.source.id);
      }
    }
  }
  return {
    pathIds: [...paths].sort(compare),
    edgeIds: [...edges].sort(compare),
    vertexIds: [...vertices].sort(compare),
    relationIds: [...relations].sort(compare),
  };
};

const externalImpacts = (document, sourceSketchId, closure) => {
  const paths = new Set(closure.pathIds);
  const edges = new Set(closure.edgeIds);
  const vertices = new Set(closure.vertexIds);
  const relations = new Set(closure.relationIds);
  const impacts = [];
  const movedVertex = (item) =>
    item?.kind === 'vertex' &&
    item.sketchId === sourceSketchId &&
    vertices.has(item.id);
  const movedEdgeEnd = (item) =>
    item?.kind === 'edge-end' &&
    item.sketchId === sourceSketchId &&
    edges.has(item.edgeId);
  for (const relation of Object.values(document.relations)) {
    const targetMoved =
      movedVertex(relation.target) || movedEdgeEnd(relation.target);
    const sourceMoved =
      (relation.kind === 'coincident' && movedVertex(relation.source)) ||
      (relation.kind === 'handle-continuity' && movedEdgeEnd(relation.source));
    if (!targetMoved && !sourceMoved) continue;
    if (!relations.has(relation.id))
      impacts.push({
        kind: 'reverse-relation',
        relationId: relation.id,
        ref: relation.target,
      });
    else if (relation.kind === 'point-on-axis')
      impacts.push({
        kind: 'datum-relation-frame',
        relationId: relation.id,
        ref: { kind: 'datum', id: relation.axisId },
      });
    else if (relation.kind === 'coincident' && relation.source.kind === 'datum')
      impacts.push({
        kind: 'datum-relation-frame',
        relationId: relation.id,
        ref: relation.source,
      });
    else if (relation.kind === 'coincident' && !movedVertex(relation.source))
      impacts.push({
        kind: 'external-relation-frame',
        relationId: relation.id,
        ref: relation.source,
      });
  }
  for (const program of Object.values(document.programs))
    for (const operator of Object.values(program.operators))
      for (const [port, inputs] of Object.entries(operator.inputs))
        for (const input of inputs) {
          if (input.kind !== 'sketch' || input.sketchId !== sourceSketchId)
            continue;
          if (
            !input.pathIds ||
            input.pathIds.some((pathId) => paths.has(pathId))
          )
            impacts.push({
              kind: 'program-input',
              programId: program.id,
              operatorId: operator.id,
              port,
              ref: input,
            });
        }
  for (const collection of Object.values(document.collections))
    for (const member of collection.members) {
      const affected =
        (member.kind === 'path' &&
          member.sketchId === sourceSketchId &&
          paths.has(member.id)) ||
        (member.kind === 'edge' &&
          member.sketchId === sourceSketchId &&
          edges.has(member.id)) ||
        (member.kind === 'vertex' &&
          member.sketchId === sourceSketchId &&
          vertices.has(member.id)) ||
        (member.kind === 'edge-end' &&
          member.sketchId === sourceSketchId &&
          edges.has(member.edgeId));
      if (affected)
        impacts.push({
          kind: 'collection',
          collectionId: collection.id,
          ref: member,
        });
    }
  return impacts;
};

/**
 * Plans a source ownership move. IDs are preserved: only their containing
 * Sketch and coordinate frame change. Copying is a scene-level operation.
 */
export function planSketchTransfer(
  document,
  { sourceSketchId, targetSketchId, pathIds, transform = [1, 0, 0, 1, 0, 0] },
) {
  validateDocument(document);
  const source = document.sketches[sourceSketchId];
  const target = document.sketches[targetSketchId];
  if (!source || !target || sourceSketchId === targetSketchId)
    throw Error('源和目标必须是不同的现有 Sketch');
  if (
    !Array.isArray(pathIds) ||
    !pathIds.length ||
    pathIds.some((pathId) => !source.paths[pathId])
  )
    throw Error('pathIds 必须是源 Sketch 中的非空 Path 集合');
  assertTransform(transform);
  const closure = sourceClosure(document, sourceSketchId, pathIds);
  return {
    mode: 'move',
    sourceSketchId,
    targetSketchId,
    requestedPathIds: [...pathIds].sort(compare),
    transform: [...transform],
    closure,
    externalReferences: externalImpacts(document, sourceSketchId, closure),
    changedRefs: closure.pathIds.map((pathId) =>
      ref('path', sourceSketchId, pathId),
    ),
    removedRefs: [],
  };
}

const movedRef = (value, sourceSketchId, targetSketchId, closure) => {
  if (
    value.kind === 'vertex' &&
    value.sketchId === sourceSketchId &&
    closure.vertexIds.includes(value.id)
  )
    return { ...value, sketchId: targetSketchId };
  if (
    value.kind === 'edge' &&
    value.sketchId === sourceSketchId &&
    closure.edgeIds.includes(value.id)
  )
    return { ...value, sketchId: targetSketchId };
  if (
    value.kind === 'path' &&
    value.sketchId === sourceSketchId &&
    closure.pathIds.includes(value.id)
  )
    return { ...value, sketchId: targetSketchId };
  if (
    value.kind === 'edge-end' &&
    value.sketchId === sourceSketchId &&
    closure.edgeIds.includes(value.edgeId)
  )
    return { ...value, sketchId: targetSketchId };
  return value;
};

/** Commits only an unchanged, impact-free plan; it never trusts caller edits. */
export function applySketchTransfer(document, plan) {
  if (!plan || plan.mode !== 'move')
    throw Error('只支持明确的 Sketch ownership move plan');
  const current = planSketchTransfer(document, {
    sourceSketchId: plan.sourceSketchId,
    targetSketchId: plan.targetSketchId,
    pathIds: plan.requestedPathIds,
    transform: plan.transform,
  });
  if (
    !same(current.closure, plan.closure) ||
    !same(current.externalReferences, plan.externalReferences)
  )
    throw Error('Sketch transfer plan 已过期或被篡改；请重新生成影响计划');
  const unsupportedReferences = current.externalReferences.filter(
    (impact) => impact.kind !== 'collection',
  );
  if (unsupportedReferences.length)
    throw Error('源转移需要先处理 externalReferences 的引用影响');
  const next = structuredClone(document);
  const source = next.sketches[current.sourceSketchId];
  const target = next.sketches[current.targetSketchId];
  const matrix = assertTransform(current.transform);
  for (const vertexId of current.closure.vertexIds) {
    const vertex = source.vertices[vertexId];
    if (!vertex || vertex.position.kind !== 'free')
      throw Error('转移关系 Vertex 需要 T05 的显式重表达');
    target.vertices[vertexId] = {
      ...vertex,
      position: {
        kind: 'free',
        value: transformPoint(matrix, vertex.position.value),
      },
    };
    delete source.vertices[vertexId];
  }
  for (const edgeId of current.closure.edgeIds) {
    const edge = source.edges[edgeId];
    if (!edge) throw Error(`转移闭包中的 Edge 不存在：${edgeId}`);
    const moveHandle = (handle) => {
      if (handle.kind === 'free')
        return {
          kind: 'free',
          vector: transformVector(matrix, handle.vector),
        };
      const relation = next.relations[handle.relationId];
      if (
        relation?.kind !== 'handle-continuity' ||
        !current.closure.relationIds.includes(relation.id)
      )
        throw Error(
          `转移关系 Handle 不能安全重表达：relation:${handle.relationId}`,
        );
      return { ...handle };
    };
    target.edges[edgeId] = {
      ...edge,
      startHandle: moveHandle(edge.startHandle),
      endHandle: moveHandle(edge.endHandle),
    };
    delete source.edges[edgeId];
  }
  for (const pathId of current.closure.pathIds) {
    target.paths[pathId] = source.paths[pathId];
    delete source.paths[pathId];
  }
  for (const relationId of current.closure.relationIds) {
    const relation = next.relations[relationId];
    if (!relation) continue;
    relation.target = movedRef(
      relation.target,
      current.sourceSketchId,
      current.targetSketchId,
      current.closure,
    );
    if (relation.kind === 'coincident' || relation.kind === 'handle-continuity')
      relation.source = movedRef(
        relation.source,
        current.sourceSketchId,
        current.targetSketchId,
        current.closure,
      );
  }
  for (const collection of Object.values(next.collections))
    collection.members = collection.members.map((member) =>
      movedRef(
        member,
        current.sourceSketchId,
        current.targetSketchId,
        current.closure,
      ),
    );
  validateDocument(next);
  return {
    document: next,
    changedRefs: current.closure.pathIds.map((pathId) =>
      ref('path', current.targetSketchId, pathId),
    ),
    removedRefs: current.closure.pathIds.map((pathId) =>
      ref('path', current.sourceSketchId, pathId),
    ),
  };
}

export { edgeEndRef };
