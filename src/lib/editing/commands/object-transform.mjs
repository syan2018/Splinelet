import { validateDocument } from '../../document/schema.mjs';
import {
  descendantsOf,
  effectiveNodeState,
  selectedRoots,
  transformNodes,
} from '../../scene/hierarchy.mjs';
import {
  inverseTransform,
  matrixPose,
  multiplyTransforms,
  worldMatrix,
} from '../../scene/transforms.mjs';

const clone = (value) => structuredClone(value);
const nodeRef = (id) => ({ kind: 'node', id });
const operatorRef = (ownerNodeId, id) => ({
  kind: 'operator',
  ownerNodeId,
  id,
});
const finitePoint = (value) =>
  Array.isArray(value) && value.length === 2 && value.every(Number.isFinite);
const scaleScalar = (value, factor) => {
  if (typeof value === 'number') return value * factor;
  if (
    value?.kind === 'expression' &&
    value.op === 'multiply' &&
    value.args?.length === 2 &&
    typeof value.args[0] === 'number'
  )
    return scaleScalar(value.args[1], value.args[0] * factor);
  return { kind: 'expression', op: 'multiply', args: [factor, clone(value)] };
};
const scalePoint = (value, factor) => {
  if (!Array.isArray(value) || value.length !== 2)
    throw Error('空间坐标必须包含两个 Scalar');
  return value.map((item) => scaleScalar(item, factor));
};
const localScaleConjugate = (matrix, factor) =>
  multiplyTransforms(
    [factor, 0, 0, factor, 0, 0],
    multiplyTransforms(matrix, [1 / factor, 0, 0, 1 / factor, 0, 0]),
  );
const relationSourceOwner = (document, relation) => {
  if (relation.kind === 'point-on-axis')
    return document.datums[relation.axisId]?.ownerNodeId;
  if (relation.source.kind === 'datum')
    return document.datums[relation.source.id]?.ownerNodeId;
  return document.sketches[relation.source.sketchId]?.ownerNodeId;
};

const permittedRequestKeys = new Set([
  'nodeIds',
  'mode',
  'deltaMM',
  'centerMM',
  'angleRad',
  'factor',
]);
// Keep this list explicit. A new evaluator operator is unsafe to scale until
// its spatial parameters have a corresponding branch in scaleOperator.
const knownOperatorTypes = new Set([
  'source',
  'curve-filter',
  'curve-collect',
  'curve-reference',
  'curve-transform',
  'curve-mirror',
  'curve-array',
  'join',
  'fill',
  'region-collect',
  'region-reference',
  'region-outline',
  'path',
  'stroke',
  'between',
  'partition',
  'boolean',
  'offset',
  'region-array',
]);

function validateRequest(request) {
  if (
    !request ||
    typeof request !== 'object' ||
    Array.isArray(request) ||
    Object.keys(request).some((key) => !permittedRequestKeys.has(key)) ||
    !Array.isArray(request.nodeIds) ||
    !request.nodeIds.length ||
    request.nodeIds.some((id) => typeof id !== 'string' || !id)
  )
    throw Error('对象变换请求无效');
  if (!['translate', 'rotate', 'scale'].includes(request.mode))
    throw Error('对象变换模式无效');
  const has = (key) => Object.hasOwn(request, key);
  if (
    (request.mode === 'translate' &&
      (!has('deltaMM') || !finitePoint(request.deltaMM))) ||
    (request.mode === 'rotate' &&
      (!has('centerMM') ||
        !finitePoint(request.centerMM) ||
        !Number.isFinite(request.angleRad))) ||
    (request.mode === 'scale' &&
      (!has('centerMM') ||
        !finitePoint(request.centerMM) ||
        !Number.isFinite(request.factor) ||
        request.factor <= 0))
  )
    throw Error('对象变换参数必须为有限值；缩放比例必须为正数');
  const unexpected =
    (request.mode !== 'translate' && has('deltaMM')) ||
    (request.mode !== 'rotate' && has('angleRad')) ||
    (request.mode === 'translate' && has('centerMM')) ||
    (request.mode !== 'scale' && has('factor'));
  if (unexpected) throw Error('对象变换包含不适用于当前模式的参数');
}

function affectedNodes(document, roots) {
  const ids = [];
  for (const root of roots) ids.push(root, ...descendantsOf(document, root));
  return [...new Set(ids)];
}

function requireWritable(document, ids) {
  for (const id of ids)
    if (effectiveNodeState(document, id).locked)
      throw Error(`对象或其父级已锁定：${id}`);
}

function requireKnownOperators(document, affected) {
  for (const program of Object.values(document.programs)) {
    if (!affected.has(program.ownerNodeId)) continue;
    for (const operator of Object.values(program.operators))
      if (!knownOperatorTypes.has(operator.type))
        throw Error(`无法安全缩放未知算子：${operator.type}`);
  }
}

function requireClosedSpatialReferences(document, affected) {
  for (const relation of Object.values(document.relations)) {
    const targetOwner =
      document.sketches[relation.target.sketchId]?.ownerNodeId;
    const sourceOwner = relationSourceOwner(document, relation);
    if (affected.has(targetOwner) !== affected.has(sourceOwner))
      throw Error(`关系 ${relation.id} 跨越对象选区，无法安全缩放`);
  }
  for (const program of Object.values(document.programs))
    for (const operator of Object.values(program.operators))
      for (const inputs of Object.values(operator.inputs))
        for (const input of inputs) {
          if (input.kind !== 'port') continue;
          if (
            affected.has(program.ownerNodeId) !==
            affected.has(input.ownerNodeId)
          )
            throw Error(`算子 ${operator.id} 的输入跨越对象选区，无法安全缩放`);
        }
}

function scaleOperator(operator, factor) {
  const next = clone(operator);
  const params = next.params;
  if (next.type === 'curve-transform')
    params.transform = localScaleConjugate(params.transform, factor);
  else if (['curve-mirror', 'curve-array', 'region-array'].includes(next.type))
    params.center = scalePoint(params.center, factor);
  else if (next.type === 'offset')
    params.distanceMM = scaleScalar(params.distanceMM, factor);
  else if (next.type === 'stroke') {
    if (!Number.isFinite(params.widthMM))
      throw Error('stroke.widthMM 必须是有限数');
    params.widthMM *= factor;
  } else if (next.type === 'between' && params.boundaryJoinMM !== undefined) {
    if (!Number.isFinite(params.boundaryJoinMM))
      throw Error('between.boundaryJoinMM 必须是有限数');
    params.boundaryJoinMM *= factor;
  } else if (next.type === 'partition' && params.endpointJoin) {
    if (!Number.isFinite(params.endpointJoin.toleranceMM))
      throw Error('partition.endpointJoin.toleranceMM 必须是有限数');
    params.endpointJoin.toleranceMM *= factor;
  }
  return next;
}

function scaleDocument(document, affectedIds, centerMM, factor) {
  const affected = new Set(affectedIds);
  requireKnownOperators(document, affected);
  requireClosedSpatialReferences(document, affected);
  const next = clone(document);
  const originalWorld = new Map();
  const originalCache = new Map();
  for (const id of affectedIds)
    originalWorld.set(id, worldMatrix(document, id, originalCache));
  const newWorld = new Map();
  const scaleWorldPoint = ([x, y]) => [
    centerMM[0] + (x - centerMM[0]) * factor,
    centerMM[1] + (y - centerMM[1]) * factor,
  ];
  for (const id of affectedIds) {
    const original = originalWorld.get(id);
    const [x, y] = scaleWorldPoint([original[4], original[5]]);
    const destination = [...original.slice(0, 4), x, y];
    const parentWorld = affected.has(document.nodes[id].parentId)
      ? newWorld.get(document.nodes[id].parentId)
      : worldMatrix(document, document.nodes[id].parentId);
    next.nodes[id].pose = matrixPose(
      multiplyTransforms(inverseTransform(parentWorld), destination),
    );
    newWorld.set(id, destination);
  }
  const changedRefs = affectedIds.map(nodeRef);
  for (const sketch of Object.values(next.sketches)) {
    if (!affected.has(sketch.ownerNodeId)) continue;
    for (const vertex of Object.values(sketch.vertices))
      if (vertex.position.kind === 'free')
        vertex.position.value = vertex.position.value.map(
          (value) => value * factor,
        );
    for (const edge of Object.values(sketch.edges))
      for (const field of ['startHandle', 'endHandle'])
        if (edge[field].kind === 'free')
          edge[field].vector = edge[field].vector.map(
            (value) => value * factor,
          );
    changedRefs.push({ kind: 'sketch', id: sketch.id });
  }
  for (const datum of Object.values(next.datums)) {
    if (!affected.has(datum.ownerNodeId)) continue;
    if (datum.kind === 'point')
      datum.position = scalePoint(datum.position, factor);
    else datum.origin = scalePoint(datum.origin, factor);
    changedRefs.push({ kind: 'datum', id: datum.id });
  }
  for (const relation of Object.values(next.relations)) {
    const original = document.relations[relation.id];
    const targetChanged = affected.has(
      document.sketches[original.target.sketchId]?.ownerNodeId,
    );
    if (!targetChanged) continue;
    if (relation.kind === 'handle-continuity') {
      if (relation.mode === 'smooth')
        relation.length = scaleScalar(relation.length, factor);
    } else {
      if (relation.kind === 'point-on-axis')
        relation.distance = scaleScalar(relation.distance, factor);
      else relation.offset = scalePoint(relation.offset, factor);
      relation.frame.transform = localScaleConjugate(
        relation.frame.transform,
        factor,
      );
    }
    changedRefs.push({ kind: 'relation', id: relation.id });
  }
  for (const program of Object.values(next.programs)) {
    const ownerChanged = affected.has(program.ownerNodeId);
    const originalProgram = document.programs[program.id];
    for (const [id, operator] of Object.entries(program.operators)) {
      const original = originalProgram.operators[id];
      let changed = false;
      if (ownerChanged) {
        program.operators[id] = scaleOperator(operator, factor);
        changed = true;
      }
      for (const inputs of Object.values(program.operators[id].inputs))
        for (const input of inputs)
          if (input.kind === 'port' && affected.has(input.ownerNodeId)) {
            input.transform = localScaleConjugate(input.transform, factor);
            changed = true;
          }
      if (changed)
        changedRefs.push(operatorRef(program.ownerNodeId, original.id));
    }
  }
  validateDocument(next);
  return { document: next, changedRefs };
}

/** Transform selected scene roots. Scaling keeps node poses rigid and expands
 * their local construction data, so it can remain compatible with the V4 pose
 * schema while preserving program/output identities. */
export function createObjectTransformCommand(request) {
  const action = clone(request);
  return (document) => {
    validateRequest(action);
    validateDocument(document);
    const roots = selectedRoots(document, action.nodeIds);
    const affectedIds = affectedNodes(document, roots);
    requireWritable(document, affectedIds);
    if (action.mode === 'translate')
      return {
        document: transformNodes(document, roots, [
          1,
          0,
          0,
          1,
          action.deltaMM[0],
          action.deltaMM[1],
        ]),
        changedRefs: roots.map(nodeRef),
      };
    if (action.mode === 'rotate') {
      const cosine = Math.cos(action.angleRad);
      const sine = Math.sin(action.angleRad);
      const [x, y] = action.centerMM;
      return {
        document: transformNodes(document, roots, [
          cosine,
          sine,
          -sine,
          cosine,
          x - cosine * x + sine * y,
          y - sine * x - cosine * y,
        ]),
        changedRefs: roots.map(nodeRef),
      };
    }
    if (action.factor === 1) return { document, changedRefs: [] };
    return scaleDocument(document, affectedIds, action.centerMM, action.factor);
  };
}
