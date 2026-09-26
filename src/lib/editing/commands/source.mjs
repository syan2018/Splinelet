import { editSketch } from '../../geometry/sketch-edit.mjs';
import { planRelationEdit, releaseRelation } from '../../geometry/edit-dof.mjs';
import { resolveRelation } from '../../geometry/relations.mjs';
import { effectiveNodeState } from '../../scene/hierarchy.mjs';
import { validateDocument } from '../../document/schema.mjs';

export const SOURCE_ACTIONS = Object.freeze([
  'set-vertex',
  'set-handle',
  'move-path-handle',
  'set-path-handle-mode',
  'split-edge',
  'remove-edge',
  'reverse-path',
  'add-vertex',
  'add-edge',
  'add-path',
  'set-continuity',
  'create-relation',
  'edit-relation',
  'release-relation',
  'create-parameter',
  'set-parameter',
  'create-datum',
  'set-datum',
]);
function writable(document, ownerNodeId) {
  if (
    ownerNodeId !== null &&
    (!document.nodes[ownerNodeId] ||
      effectiveNodeState(document, ownerNodeId).locked)
  )
    throw Error('部件不存在或已锁定');
}
function targetSlot(document, target) {
  const sketch = document.sketches[target?.sketchId];
  if (!sketch) throw Error('线条来源不存在');
  writable(document, sketch.ownerNodeId);
  if (target.kind === 'vertex') {
    const vertex = sketch.vertices[target.id];
    if (!vertex) throw Error('节点不存在');
    return [vertex, 'position'];
  }
  const edge = sketch.edges[target.edgeId];
  if (
    target.kind !== 'edge-end' ||
    !edge ||
    !['start', 'end'].includes(target.end)
  )
    throw Error('控制柄不存在');
  return [edge, target.end === 'start' ? 'startHandle' : 'endHandle'];
}

/** Private draft for one point/handle gesture. It never aliases a Sketch that
 * can be edited: sketch-edit takes ownership lazily through its WeakSet. */
export function createSourceCommandBatch(
  document,
  { sourceDelta = false } = {},
) {
  return {
    document: { ...document, sketches: { ...document.sketches } },
    sourceDelta,
    ownedSketches: new WeakSet(),
    finish() {
      if (!sourceDelta) validateDocument(this.document);
      return this.document;
    },
  };
}

/** Source commands edit declared inputs; relation results never become a second writable model. */
export function createSourceCommand(request) {
  const action = structuredClone(request);
  return (document, { idFactory, sourceDelta = false, sourceBatch } = {}) => {
    if (sourceBatch && sourceBatch.document !== document)
      throw Error('源批处理与当前草稿不一致');
    // sourceBatch owns only lazily cloned Sketch records. Reject every command
    // that could write a shared top-level table before reaching its handler.
    if (
      sourceBatch &&
      !['set-vertex', 'set-handle', 'move-path-handle'].includes(action.kind)
    )
      throw Error('源批处理只接受点或控制柄移动');
    if (
      sourceDelta &&
      !['set-vertex', 'set-handle', 'move-path-handle'].includes(action.kind)
    )
      throw Error('源预览只接受点或控制柄移动');
    if (['create-parameter', 'create-datum'].includes(action.kind)) {
      const table =
        action.kind === 'create-parameter' ? 'parameters' : 'datums';
      const value = structuredClone(action.value);
      writable(document, value?.ownerNodeId);
      const id = idFactory();
      document[table][id] = { ...value, id };
      validateDocument(document);
      return {
        document,
        changedRefs: [
          { kind: table === 'parameters' ? 'parameter' : 'datum', id },
        ],
      };
    }
    if (['set-parameter', 'set-datum'].includes(action.kind)) {
      const parameter = action.kind === 'set-parameter';
      const table = parameter ? 'parameters' : 'datums';
      const value = document[table][action.id];
      if (!value) throw Error('共享输入不存在');
      writable(document, value.ownerNodeId);
      if (parameter) value.value = action.value;
      else {
        const fields =
          value.kind === 'point' ? ['position'] : ['origin', 'angleRad'];
        for (const field of fields)
          if (Object.hasOwn(action.value || {}, field))
            value[field] = structuredClone(action.value[field]);
      }
      validateDocument(document);
      return {
        document,
        changedRefs: [
          { kind: parameter ? 'parameter' : 'datum', id: action.id },
        ],
      };
    }
    if (['edit-relation', 'release-relation'].includes(action.kind)) {
      const relation = document.relations[action.relationId];
      if (!relation) throw Error('关系不存在');
      targetSlot(document, relation.target);
      if (action.kind === 'release-relation')
        return releaseRelation(document, relation.id);
      const plan = planRelationEdit(document, action);
      if (plan.status !== 'ready')
        throw Error(plan.diagnostics.map((item) => item.message).join('；'));
      return plan.value;
    }
    if (action.kind === 'set-continuity' || action.kind === 'create-relation') {
      const target =
        action.kind === 'set-continuity'
          ? action.target
          : action.relation?.target;
      let [entity, field] = targetSlot(document, target);
      if (entity[field].kind === 'relation') {
        document = releaseRelation(document, entity[field].relationId).document;
        [entity, field] = targetSlot(document, target);
      }
      if (action.kind === 'set-continuity' && action.mode === 'corner')
        return { document, changedRefs: [target] };
      const id = idFactory();
      const relation =
        action.kind === 'set-continuity'
          ? {
              id,
              kind: 'handle-continuity',
              target,
              source: action.source,
              mode: action.mode,
              ...(action.mode === 'smooth' ? { length: action.length } : {}),
            }
          : { ...structuredClone(action.relation), id };
      document.relations[id] = relation;
      entity[field] = { kind: 'relation', relationId: id };
      validateDocument(document);
      const resolved = resolveRelation({
        document,
        sketch: document.sketches[target.sketchId],
        target,
        relationId: id,
      });
      if (resolved.status !== 'ready')
        throw Error(
          resolved.diagnostics.map((item) => item.message).join('；'),
        );
      return { document, changedRefs: [target, { kind: 'relation', id }] };
    }
    const sketch = document.sketches[action.sketchId];
    if (!sketch) throw Error('线条来源不存在');
    writable(document, sketch.ownerNodeId);
    return editSketch(document, action, {
      idFactory,
      sourceDelta,
      sourceBatch,
    });
  };
}
