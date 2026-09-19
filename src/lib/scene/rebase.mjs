import { validateDocument } from '../document/schema.mjs';
import { childrenOf } from './hierarchy.mjs';
import {
  identityTransform,
  inverseTransform,
  matrixPose,
  multiplyTransforms,
  poseMatrix,
  transformPoint,
  transformVector,
  worldMatrix,
} from './transforms.mjs';

const add = (a, b) =>
  typeof a === 'number' && typeof b === 'number'
    ? a + b
    : { kind: 'expression', op: 'add', args: [a, b] };
const scale = (a, b) =>
  a === 0
    ? 0
    : a === 1
      ? b
      : typeof b === 'number'
        ? a * b
        : { kind: 'expression', op: 'multiply', args: [a, b] };
export function transformScalarPoint(matrix, point, vector = false) {
  const [a, b, c, d, e, f] = matrix;
  const [x, y] = point;
  return [
    add(add(scale(a, x), scale(c, y)), vector ? 0 : e),
    add(add(scale(b, x), scale(d, y)), vector ? 0 : f),
  ];
}

function sourceOwner(document, relation) {
  if (relation.kind === 'point-on-axis')
    return document.datums[relation.axisId]?.ownerNodeId;
  if (relation.source.kind === 'datum')
    return document.datums[relation.source.id]?.ownerNodeId;
  return document.sketches[relation.source.sketchId]?.ownerNodeId;
}

// A change of coordinates preserves world geometry. It is intentionally separate
// from moving an object, which only changes its pose and moves its world result.
export function planNodeRebase(
  document,
  nodeId,
  newPose,
  { rebaseOperator } = {},
) {
  validateDocument(document);
  if (!Object.hasOwn(document.nodes, nodeId))
    throw Error('重设原点的节点不存在');
  const node = document.nodes[nodeId];
  const oldWorld = worldMatrix(document, nodeId);
  const newWorld = multiplyTransforms(
    worldMatrix(document, node.parentId),
    poseMatrix(newPose),
  );
  const change = multiplyTransforms(inverseTransform(newWorld), oldWorld);
  const undoChange = inverseTransform(change);
  const rotation = matrixPose(change).rotationRad;
  const next = structuredClone(document);
  const changed = [{ kind: 'node', id: nodeId }];
  next.nodes[nodeId].pose = structuredClone(newPose);
  for (const child of childrenOf(document, nodeId)) {
    next.nodes[child.id].pose = matrixPose(
      multiplyTransforms(change, poseMatrix(child.pose)),
    );
    changed.push({ kind: 'node', id: child.id });
  }
  for (const sketch of Object.values(next.sketches)) {
    if (sketch.ownerNodeId !== nodeId) continue;
    for (const vertex of Object.values(sketch.vertices))
      if (vertex.position.kind === 'free')
        vertex.position.value = transformPoint(change, vertex.position.value);
    for (const edge of Object.values(sketch.edges))
      for (const field of ['startHandle', 'endHandle'])
        if (edge[field].kind === 'free')
          edge[field].vector = transformVector(change, edge[field].vector);
    changed.push({ kind: 'sketch', id: sketch.id });
  }
  for (const datum of Object.values(next.datums)) {
    if (datum.ownerNodeId !== nodeId) continue;
    if (datum.kind === 'point')
      datum.position = transformScalarPoint(change, datum.position);
    else {
      datum.origin = transformScalarPoint(change, datum.origin);
      datum.angleRad = add(datum.angleRad, rotation);
    }
    changed.push({ kind: 'datum', id: datum.id });
  }
  for (const relation of Object.values(next.relations)) {
    if (relation.kind === 'handle-continuity') continue;
    const targetChanged =
      document.sketches[relation.target.sketchId]?.ownerNodeId === nodeId;
    const sourceChanged = sourceOwner(document, relation) === nodeId;
    if (!targetChanged && !sourceChanged) continue;
    // Offsets are source vectors, so they must follow its new coordinates too.
    if (sourceChanged && relation.kind === 'coincident')
      relation.offset = transformScalarPoint(change, relation.offset, true);
    const left = targetChanged ? change : identityTransform();
    const right =
      relation.frame.space === 'world'
        ? targetChanged
          ? undoChange
          : identityTransform()
        : sourceChanged
          ? undoChange
          : identityTransform();
    relation.frame.transform = multiplyTransforms(
      left,
      multiplyTransforms(relation.frame.transform, right),
    );
    changed.push({ kind: 'relation', id: relation.id });
  }
  for (const program of Object.values(next.programs)) {
    const targetChanged = program.ownerNodeId === nodeId;
    for (const [id, original] of Object.entries(
      document.programs[program.id].operators,
    )) {
      let operator = program.operators[id];
      if (targetChanged) {
        if (typeof rebaseOperator !== 'function')
          throw Error(`算子 ${id} 缺少安全坐标重表达访问器`);
        const updated = rebaseOperator(structuredClone(original), {
          transform: change.slice(),
          document: structuredClone(document),
          ownerNodeId: nodeId,
        });
        if (!updated || updated.id !== id || updated.type !== original.type)
          throw Error(`算子 ${id} 重表达访问器返回无效定义`);
        operator = program.operators[id] = structuredClone(updated);
      }
      // Port frames are engine-owned, not operator-specific parameters.
      operator.inputs = structuredClone(original.inputs);
      let touched = targetChanged;
      for (const inputs of Object.values(operator.inputs))
        for (const input of inputs) {
          if (input.kind !== 'port') continue;
          const sourceChanged = input.ownerNodeId === nodeId;
          if (!targetChanged && !sourceChanged) continue;
          const left = targetChanged ? change : identityTransform();
          const right =
            input.space === 'world-result'
              ? targetChanged
                ? undoChange
                : identityTransform()
              : sourceChanged
                ? undoChange
                : identityTransform();
          input.transform = multiplyTransforms(
            left,
            multiplyTransforms(input.transform, right),
          );
          touched = true;
        }
      if (touched)
        changed.push({
          kind: 'operator',
          id,
          ownerNodeId: program.ownerNodeId,
        });
    }
  }
  validateDocument(next);
  return { document: next, changedRefs: changed, transform: change };
}
