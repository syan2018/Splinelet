import { validateDocument } from '../document/schema.mjs';
import { resolveRelation } from './relations.mjs';

const finite = (value) => Number.isFinite(value);
const finiteVec2 = (value) =>
  Array.isArray(value) && value.length === 2 && value.every(finite);
const diagnostic = (kind, message, ref) => ({
  severity: 'error',
  kind,
  ...(ref && { ref }),
  message,
});
const blocked = (item, dependencies = []) => ({
  status: 'blocked',
  value: null,
  diagnostics: [item],
  dependencies: [...new Set(dependencies)],
});
const ready = (value, dependencies = []) => ({
  status: 'ready',
  value,
  diagnostics: [],
  dependencies: [...new Set(dependencies)],
});

function editableScalar(document, scalar, value) {
  if (!finite(value))
    return blocked(diagnostic('invalid-edit', '自由量必须是有限数'));
  if (finite(scalar)) return ready({ scalar: value, parameterId: null });
  if (scalar?.kind !== 'parameter' || typeof scalar.id !== 'string')
    return blocked(
      diagnostic('not-editable', '复合 Scalar 不能隐式改写共享 Parameter'),
      [],
    );
  const parameter = document?.parameters?.[scalar.id];
  if (!parameter)
    return blocked(
      diagnostic(
        'unresolved-reference',
        `Parameter 不存在：${scalar.id}`,
        scalar,
      ),
      [`parameter:${scalar.id}`],
    );
  return ready({ scalar, parameterId: scalar.id }, [`parameter:${scalar.id}`]);
}

/** Declares the small editable/free set; this module is not a general solver. */
export function describeRelationDof(document, relationId) {
  const relation = document?.relations?.[relationId];
  if (!relation)
    return blocked(
      diagnostic('unresolved-reference', `Relation 不存在：${relationId}`),
      [`relation:${relationId}`],
    );
  const scalar =
    relation.kind === 'point-on-axis'
      ? relation.distance
      : relation.kind === 'handle-continuity' && relation.mode === 'smooth'
        ? relation.length
        : null;
  if (scalar !== null)
    return ready(
      {
        relationId,
        editable: scalar?.kind === 'expression' ? [] : ['value'],
        derived: [relation.target.kind === 'vertex' ? 'position' : 'vector'],
      },
      [`relation:${relationId}`],
    );
  if (relation.kind === 'coincident')
    return ready({ relationId, editable: ['offset'], derived: ['position'] }, [
      `relation:${relationId}`,
    ]);
  return ready({ relationId, editable: [], derived: ['vector'] }, [
    `relation:${relationId}`,
  ]);
}

/**
 * Applies only declared scalar constants or direct Parameters. A composite AST
 * is reported as non-editable instead of guessing which shared input to change.
 */
export function planRelationEdit(document, { relationId, field, value } = {}) {
  const relation = document?.relations?.[relationId];
  const dependencies = [`relation:${relationId}`];
  if (!relation)
    return blocked(
      diagnostic('unresolved-reference', `Relation 不存在：${relationId}`),
      dependencies,
    );
  const next = structuredClone(document);
  const edited = next.relations[relationId];
  const applyScalar = (scalar, nextValue, assign) => {
    const editable = editableScalar(document, scalar, nextValue);
    if (editable.status !== 'ready') return editable;
    if (editable.value.parameterId)
      next.parameters[editable.value.parameterId].value = nextValue;
    else assign(editable.value.scalar);
    try {
      validateDocument(next);
      return ready(
        {
          document: next,
          changedRefs: [
            { kind: 'relation', id: relationId },
            ...(editable.value.parameterId
              ? [{ kind: 'parameter', id: editable.value.parameterId }]
              : []),
          ],
        },
        [...dependencies, ...editable.dependencies],
      );
    } catch (error) {
      return blocked(
        diagnostic(
          'invalid-edit',
          error instanceof Error ? error.message : 'Relation edit 无效',
        ),
        [...dependencies, ...editable.dependencies],
      );
    }
  };
  if (relation.kind === 'point-on-axis' && field === 'distance')
    return applyScalar(relation.distance, value, (scalar) => {
      edited.distance = scalar;
    });
  if (
    relation.kind === 'handle-continuity' &&
    relation.mode === 'smooth' &&
    field === 'length'
  )
    return applyScalar(relation.length, value, (scalar) => {
      edited.length = scalar;
    });
  if (relation.kind === 'coincident' && field === 'offset') {
    if (!finiteVec2(value))
      return blocked(
        diagnostic('invalid-edit', 'coincident offset 必须是有限 Vec2'),
        dependencies,
      );
    const left = editableScalar(document, relation.offset[0], value[0]);
    const right = editableScalar(document, relation.offset[1], value[1]);
    if (left.status !== 'ready') return left;
    if (right.status !== 'ready') return right;
    if (
      left.value.parameterId &&
      left.value.parameterId === right.value.parameterId &&
      value[0] !== value[1]
    )
      return blocked(
        diagnostic(
          'conflicting-edit',
          '两个偏移分量共享同一 Parameter，不能同时写入不同值',
        ),
        dependencies,
      );
    for (const [item, nextValue, index] of [
      [left, value[0], 0],
      [right, value[1], 1],
    ]) {
      if (item.value.parameterId)
        next.parameters[item.value.parameterId].value = nextValue;
      else edited.offset[index] = item.value.scalar;
    }
    try {
      validateDocument(next);
      return ready(
        {
          document: next,
          changedRefs: [
            { kind: 'relation', id: relationId },
            ...[left, right]
              .map((item) => item.value.parameterId)
              .filter(Boolean)
              .map((id) => ({ kind: 'parameter', id })),
          ],
        },
        [...dependencies, ...left.dependencies, ...right.dependencies],
      );
    } catch (error) {
      return blocked(
        diagnostic(
          'invalid-edit',
          error instanceof Error ? error.message : 'Relation edit 无效',
        ),
        dependencies,
      );
    }
  }
  return blocked(
    diagnostic('not-editable', '该 Relation 没有声明此自由量'),
    dependencies,
  );
}

/** Freezes one verified relation result at its target and removes the relation. */
export function releaseRelation(document, relationId, resolvedValue) {
  const relation = document?.relations?.[relationId];
  if (!relation) throw Error(`Relation 不存在：${relationId}`);
  const result =
    resolvedValue === undefined
      ? resolveRelation({
          document,
          sketch: document.sketches[relation.target.sketchId],
          target: relation.target,
          relationId,
        })
      : { status: 'ready', value: resolvedValue, dependencies: [] };
  if (result.status !== 'ready' || !finiteVec2(result.value))
    throw Error('Relation 不能解算为有限 Vec2，无法解除');
  const next = structuredClone(document);
  if (relation.target.kind === 'vertex') {
    const vertex =
      next.sketches[relation.target.sketchId]?.vertices?.[relation.target.id];
    if (
      !vertex ||
      vertex.position.kind !== 'relation' ||
      vertex.position.relationId !== relationId
    )
      throw Error('Relation target Vertex 不匹配');
    vertex.position = { kind: 'free', value: [...result.value] };
  } else {
    const edge =
      next.sketches[relation.target.sketchId]?.edges?.[relation.target.edgeId];
    const field = relation.target.end === 'start' ? 'startHandle' : 'endHandle';
    if (
      !edge ||
      edge[field].kind !== 'relation' ||
      edge[field].relationId !== relationId
    )
      throw Error('Relation target EdgeEnd 不匹配');
    edge[field] = { kind: 'free', vector: [...result.value] };
  }
  delete next.relations[relationId];
  validateDocument(next);
  return {
    document: next,
    changedRefs: [relation.target],
    removedRefs: [{ kind: 'relation', id: relationId }],
    dependencies: result.dependencies || [],
  };
}
