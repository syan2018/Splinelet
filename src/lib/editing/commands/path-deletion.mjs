import {
  validateDocument,
  inspectDocumentReferences,
} from '../../document/schema.mjs';
import { effectiveNodeState } from '../../scene/hierarchy.mjs';

export const PATH_DELETION_ACTIONS = Object.freeze(['delete-paths']);
const ref = (kind, sketchId, id) => ({ kind, sketchId, id });
const key = (value) =>
  JSON.stringify([value.kind, value.sketchId, value.id ?? value.edgeId]);
const referencesRemoved = (value, removed) => {
  if (!value || typeof value !== 'object') return false;
  const entity = value.kind === 'edge-end' ? { ...value, kind: 'edge' } : value;
  if (removed.has(key(entity))) return true;
  return Object.values(value).some((child) =>
    referencesRemoved(child, removed),
  );
};

/** A deletion plan preserves consumer definitions as repairable references.
 * Only topology exclusively used by the selected Paths is removed.
 */
export function planPathDeletion(document, pathRefs) {
  validateDocument(document);
  if (!Array.isArray(pathRefs)) throw Error('删除路径需要明确的路径选区');
  const selected = new Map();
  for (const target of pathRefs) {
    if (
      target?.kind !== 'path' ||
      typeof target.sketchId !== 'string' ||
      typeof target.id !== 'string'
    )
      throw Error('删除路径引用无效');
    const sketch = document.sketches[target.sketchId];
    if (!sketch?.paths[target.id]) throw Error('删除路径不存在');
    if (effectiveNodeState(document, sketch.ownerNodeId).locked)
      throw Error('部件已锁定');
    selected.set(key(target), ref('path', sketch.id, target.id));
  }
  const next = structuredClone(document),
    removedRefs = [];
  const sketches = new Set([...selected.values()].map((item) => item.sketchId));
  for (const sketchId of sketches) {
    const sketch = next.sketches[sketchId];
    const edges = new Set(),
      vertices = new Set();
    for (const target of selected.values()) {
      if (target.sketchId !== sketchId) continue;
      const path = sketch.paths[target.id];
      for (const use of path.edges) edges.add(use.edgeId);
      if (path.startVertexId) vertices.add(path.startVertexId);
      delete sketch.paths[path.id];
      removedRefs.push(target);
    }
    const keptEdges = new Set(
      Object.values(sketch.paths).flatMap((path) =>
        path.edges.map((use) => use.edgeId),
      ),
    );
    for (const edgeId of edges) {
      const edge = sketch.edges[edgeId];
      if (!edge || keptEdges.has(edgeId)) continue;
      vertices.add(edge.startVertexId);
      vertices.add(edge.endVertexId);
      delete sketch.edges[edgeId];
      removedRefs.push(ref('edge', sketchId, edgeId));
    }
    const keptVertices = new Set([
      ...Object.values(sketch.edges).flatMap((edge) => [
        edge.startVertexId,
        edge.endVertexId,
      ]),
      ...Object.values(sketch.paths)
        .map((path) => path.startVertexId)
        .filter(Boolean),
    ]);
    for (const vertexId of vertices) {
      if (!sketch.vertices[vertexId] || keptVertices.has(vertexId)) continue;
      delete sketch.vertices[vertexId];
      removedRefs.push(ref('vertex', sketchId, vertexId));
    }
  }
  validateDocument(next);
  const prior = new Set(
    inspectDocumentReferences(document).map((item) => JSON.stringify(item)),
  );
  const impacts = inspectDocumentReferences(next).filter(
    (item) => !prior.has(JSON.stringify(item)),
  );
  const removed = new Set(removedRefs.map(key));
  const affectedOperators = new Map();
  let expanded = true;
  while (expanded) {
    expanded = false;
    for (const program of Object.values(document.programs))
      for (const operator of Object.values(program.operators)) {
        if (affectedOperators.has(operator.id)) continue;
        const affected =
          Object.values(operator.inputs)
            .flat()
            .some((input) =>
              input.kind === 'port'
                ? affectedOperators.has(input.operatorId)
                : input.kind === 'sketch' &&
                  [...selected.values()].some(
                    (target) =>
                      target.sketchId === input.sketchId &&
                      (!input.pathIds || input.pathIds.includes(target.id)),
                  ),
            ) || referencesRemoved(operator.params, removed);
        if (affected) {
          affectedOperators.set(operator.id, {
            ownerNodeId: program.ownerNodeId,
            programId: program.id,
            operatorId: operator.id,
          });
          expanded = true;
        }
      }
  }
  for (const relation of Object.values(next.relations)) {
    for (const [slot, target] of [
      ['target', relation.target],
      ['source', relation.source],
    ]) {
      if (!target) continue;
      const entity =
        target.kind === 'edge-end' ? { ...target, kind: 'edge' } : target;
      if (removed.has(key(entity)))
        impacts.push({
          kind: 'unresolved-reference',
          ref: { kind: 'relation', id: relation.id },
          message: `Relation.${slot} 的源实体已删除`,
        });
    }
  }
  return {
    document: next,
    removedRefs,
    impacts,
    affectedOperators: [...affectedOperators.values()],
  };
}

export function createPathDeletionCommand(request) {
  const action = structuredClone(request);
  if (action?.kind !== 'delete-paths') throw Error('不支持的路径删除动作');
  return (document) => {
    const plan = planPathDeletion(document, action.pathRefs);
    return { ...plan, changedRefs: plan.removedRefs };
  };
}
