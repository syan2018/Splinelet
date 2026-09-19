import { effectiveNodeState } from '../scene/hierarchy.mjs';
import {
  inverseTransform,
  matrixPose,
  transformPoint,
  worldMatrix,
} from '../scene/transforms.mjs';

const REQUEST_KEYS = new Set([
  'objectId',
  'modifierId',
  'changes',
  'sourceFeatureId',
]);
const COMMON_FIELDS = new Set(['enabled', 'name']);
const UNSUPPORTED_FIELDS = new Set([
  'input',
  'targets',
  'joinMM',
  'add',
  'move',
  'remove',
]);
const TYPE_FIELDS = Object.freeze({
  'curve-mirror': new Set(['angleDeg', 'centerMM']),
  'curve-array': new Set(['count', 'angleDeg', 'centerMM']),
  'region-array': new Set(['count', 'angleDeg', 'centerMM']),
  offset: new Set(['distanceMM']),
  boolean: new Set(['operation']),
  partition: new Set(),
});
const BOOLEAN_OPERATIONS = new Set(['difference', 'intersection', 'union']);
const degreesToRadians = (value) => (value * Math.PI) / 180;
const record = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const exactKeys = (value, allowed, label) => {
  for (const key of Object.keys(value))
    if (!allowed.has(key)) throw Error(`${label} 包含未知字段：${key}`);
};

const text = (value, label) => {
  if (typeof value !== 'string' || !value.trim())
    throw Error(`${label} 必须是非空字符串`);
  return value;
};

const finite = (value, label) => {
  if (!Number.isFinite(value)) throw Error(`${label} 必须是有限数`);
  return value;
};

const bounded = (value, label, minimum, maximum) => {
  finite(value, label);
  if (value < minimum || value > maximum)
    throw Error(`${label} 必须在 ${minimum} 到 ${maximum} 之间`);
  return value;
};

const editableScalar = (value, label) => {
  if (value === undefined || Number.isFinite(value)) return;
  if (record(value))
    throw Error(
      `${label} 由 Parameter、Datum 或 expression 驱动，不能用普通数值控件覆盖`,
    );
  throw Error(`${label} 当前值不是可编辑的有限数`);
};

const editableCenter = (value) => {
  if (value === undefined) return;
  if (!Array.isArray(value) || value.length !== 2)
    throw Error('center 当前值无效');
  editableScalar(value[0], 'center[0]');
  editableScalar(value[1], 'center[1]');
};

const centerPoint = (value) => {
  if (!record(value)) throw Error('centerMM 必须包含 x、y');
  exactKeys(value, new Set(['x', 'y']), 'centerMM');
  return [
    bounded(value.x, 'centerMM.x', -10000, 10000),
    bounded(value.y, 'centerMM.y', -10000, 10000),
  ];
};

const ownedOperator = (document, objectId, modifierId) => {
  text(objectId, 'objectId');
  text(modifierId, 'modifierId');
  const owner = document.nodes?.[objectId];
  if (!owner) throw Error(`部件不存在：${objectId}`);
  if (owner.kind !== 'shape') throw Error('修改器所有者必须是 Shape');
  if (effectiveNodeState(document, objectId).locked)
    throw Error('修改器所有者已锁定');
  const program = document.programs?.[owner.programId];
  if (!program || program.ownerNodeId !== objectId)
    throw Error('Shape 的 Program 所有权无效');
  const operator = program.operators?.[modifierId];
  if (operator) return operator;
  if (
    Object.values(document.programs || {}).some(
      (candidate) => candidate.operators?.[modifierId],
    )
  )
    throw Error('修改器不属于指定 Shape');
  throw Error(`修改器不存在：${modifierId}`);
};

/**
 * Compiles one legacy Creation modifier_update payload to a V4 set-operator
 * action. The returned action is inert until dispatched by the caller.
 * sourceFeatureId is a legacy view routing hint; stable owner/operator IDs are
 * the authoritative V4 address.
 */
export function compileModifierUpdate(document, request) {
  if (document?.version !== 4) throw Error('修改器写入需要 V4 Document');
  if (!record(request)) throw Error('modifier_update request 必须是 object');
  exactKeys(request, REQUEST_KEYS, 'modifier_update request');
  if (request.sourceFeatureId !== undefined)
    text(request.sourceFeatureId, 'sourceFeatureId');
  if (!record(request.changes)) throw Error('changes 必须是 object');
  if (!Object.keys(request.changes).length)
    throw Error('changes 至少需要一个字段');

  const operator = ownedOperator(
    document,
    request.objectId,
    request.modifierId,
  );
  const typeFields = TYPE_FIELDS[operator.type] || new Set();
  for (const key of Object.keys(request.changes)) {
    if (UNSUPPORTED_FIELDS.has(key))
      throw Error(`modifier_update 尚不支持 ${key}`);
    if (!COMMON_FIELDS.has(key) && !typeFields.has(key))
      throw Error(`${operator.type} 不支持修改字段：${key}`);
  }

  const action = {
    kind: 'set-operator',
    ownerNodeId: request.objectId,
    operatorId: request.modifierId,
  };
  const changes = request.changes;
  if (Object.hasOwn(changes, 'enabled')) {
    if (typeof changes.enabled !== 'boolean')
      throw Error('enabled 必须是布尔值');
    action.enabled = changes.enabled;
  }
  if (Object.hasOwn(changes, 'name')) action.name = text(changes.name, 'name');

  const parameterFields = [...typeFields].filter((field) =>
    Object.hasOwn(changes, field),
  );
  if (!parameterFields.length) return action;
  if (!record(operator.params)) throw Error('修改器 params 无效');
  const params = structuredClone(operator.params);

  if (Object.hasOwn(changes, 'count')) {
    editableScalar(operator.params.count, 'count');
    if (!Number.isInteger(changes.count)) throw Error('count 必须是整数');
    params.count = bounded(changes.count, 'count', 1, 64);
  }
  if (Object.hasOwn(changes, 'angleDeg')) {
    editableScalar(operator.params.angleRad, 'angleRad');
    const angle = bounded(changes.angleDeg, 'angleDeg', -360, 360);
    const localAngle =
      operator.type === 'curve-mirror'
        ? degreesToRadians(angle) -
          matrixPose(worldMatrix(document, request.objectId)).rotationRad
        : degreesToRadians(angle);
    params.angleRad = localAngle;
  }
  if (Object.hasOwn(changes, 'centerMM')) {
    editableCenter(operator.params.center);
    params.center = transformPoint(
      inverseTransform(worldMatrix(document, request.objectId)),
      centerPoint(changes.centerMM),
    );
  }
  if (Object.hasOwn(changes, 'distanceMM')) {
    editableScalar(operator.params.distanceMM, 'distanceMM');
    params.distanceMM = bounded(changes.distanceMM, 'distanceMM', -20, 20);
  }
  if (Object.hasOwn(changes, 'operation')) {
    if (!BOOLEAN_OPERATIONS.has(changes.operation))
      throw Error('operation 必须是 difference、intersection 或 union');
    params.operation = changes.operation;
  }
  action.params = params;
  return action;
}
