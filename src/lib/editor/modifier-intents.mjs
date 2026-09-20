import { effectiveNodeState } from '../scene/hierarchy.mjs';
import {
  inverseTransform,
  matrixPose,
  transformPoint,
  worldMatrix,
} from '../scene/transforms.mjs';
import { curveModifierAddCapability } from '../editing/commands/program-modifiers.mjs';

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
  join: new Set(['connections']),
  fill: new Set(['rule']),
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
  if (operator.authoring?.phase === 'drawing')
    throw Error('请先完成或继续绘制这条线');
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
  if (Object.hasOwn(changes, 'connections')) {
    if (!Array.isArray(changes.connections)) throw Error('接合对应必须是数组');
    params.connections = structuredClone(changes.connections);
  }
  if (Object.hasOwn(changes, 'rule')) {
    if (!['even-odd', 'non-zero'].includes(changes.rule))
      throw Error('构面规则无效');
    params.rule = changes.rule;
  }

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

/** Insert in the unique published curve chain, immediately before Fill. */
export function compileModifierAdd(document, request) {
  if (document?.version !== 4) throw Error('修改器写入需要 V4 Document');
  if (!record(request)) throw Error('modifier_add request 必须是 object');
  if (!['curve_mirror', 'curve_array', 'join', 'fill'].includes(request.type))
    throw Error(`modifier_add 尚不支持类型：${request.type}`);
  exactKeys(
    request,
    new Set([
      'objectId',
      'type',
      'name',
      'targets',
      'angleDeg',
      'centerMM',
      'connections',
      'rule',
      ...(request.type === 'curve_array' ? ['count'] : []),
    ]),
    'modifier_add request',
  );
  text(request.objectId, 'objectId');
  const owner = document.nodes?.[request.objectId];
  if (!owner) throw Error(`部件不存在：${request.objectId}`);
  if (owner.kind !== 'shape') throw Error('修改器所有者必须是 Shape');
  if (effectiveNodeState(document, owner.id).locked)
    throw Error('修改器所有者已锁定');
  const program = document.programs?.[owner.programId];
  if (!program || program.ownerNodeId !== owner.id)
    throw Error('Shape 的 Program 所有权无效');
  const capability = curveModifierAddCapability(document, owner.id);
  if (!capability.enabled) throw Error(capability.reason);
  if (request.type === 'join' || request.type === 'fill') {
    if (request.type === 'join' && !Array.isArray(request.connections))
      throw Error('接合需要明确的端点实例对应');
    return {
      kind: 'add-program-modifier',
      ownerNodeId: owner.id,
      type: request.type,
      name: request.name || (request.type === 'join' ? '连接边界' : '闭合构面'),
      params:
        request.type === 'join'
          ? { connections: structuredClone(request.connections) }
          : { rule: request.rule || 'even-odd' },
    };
  }
  if (!record(request.targets) || request.targets.kind !== 'all')
    throw Error('曲线修改器 targets 必须是 all');
  exactKeys(request.targets, new Set(['kind']), 'targets');
  const mirror = request.type === 'curve_mirror';
  const pose = worldMatrix(document, owner.id);
  const angle = bounded(
    request.angleDeg === undefined ? 90 : request.angleDeg,
    'angleDeg',
    -360,
    360,
  );
  const action = {
    kind: 'add-program-modifier',
    ownerNodeId: owner.id,
    type: mirror ? 'curve-mirror' : 'curve-array',
    name:
      request.name === undefined
        ? mirror
          ? '曲线镜像'
          : '曲线阵列'
        : text(request.name, 'name'),
    params: {
      center: transformPoint(
        inverseTransform(pose),
        centerPoint(
          request.centerMM === undefined ? { x: 0, y: 0 } : request.centerMM,
        ),
      ),
      angleRad:
        degreesToRadians(angle) - (mirror ? matrixPose(pose).rotationRad : 0),
    },
  };
  if (!mirror) {
    const count = request.count === undefined ? 4 : request.count;
    if (!Number.isInteger(count)) throw Error('count 必须是整数');
    action.params.count = bounded(count, 'count', 1, 64);
  }
  return action;
}

export function compileModifierStructure(document, request) {
  if (
    !record(request) ||
    !['modifier_move', 'modifier_remove'].includes(request.action)
  )
    throw Error('修改器结构动作无效');
  exactKeys(
    request,
    new Set([
      'action',
      'objectId',
      'modifierId',
      'direction',
      'sourceFeatureId',
    ]),
    '修改器结构动作',
  );
  const operator = ownedOperator(
    document,
    request.objectId,
    request.modifierId,
  );
  if (operator.authoring) throw Error('请先完成绘制');
  if (request.action === 'modifier_remove')
    return {
      kind: 'remove-program-modifier',
      ownerNodeId: request.objectId,
      operatorId: request.modifierId,
    };
  if (![1, -1].includes(request.direction)) throw Error('修改器移动方向无效');
  return {
    kind: 'move-program-modifier',
    ownerNodeId: request.objectId,
    operatorId: request.modifierId,
    direction: request.direction,
  };
}
