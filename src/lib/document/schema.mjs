const topLevelKeys = [
  'version',
  'id',
  'units',
  'nodes',
  'sketches',
  'datums',
  'parameters',
  'relations',
  'programs',
  'geometrySettings',
  'appearances',
  'reliefDefinitions',
  'manufacturing',
  'assets',
  'references',
  'collections',
];
const unsafeKeys = new Set(['__proto__', 'constructor', 'prototype']);
const scalarOps = new Set([
  'add',
  'subtract',
  'multiply',
  'divide',
  'negate',
  'sin',
  'cos',
]);
const domains = new Set(['curves', 'regions']);

const fail = (message) => {
  throw Error(`V4 文档无效：${message}`);
};
const isRecord = (value) =>
  typeof value === 'object' &&
  value !== null &&
  !Array.isArray(value) &&
  (Object.getPrototypeOf(value) === Object.prototype ||
    Object.getPrototypeOf(value) === null);
const finite = (value) => typeof value === 'number' && Number.isFinite(value);
const id = (value, label = 'ID') => {
  if (typeof value !== 'string' || !value.trim() || unsafeKeys.has(value))
    fail(`${label} 无效`);
  return value;
};
const text = (value, label) => {
  if (typeof value !== 'string') fail(`${label} 必须是字符串`);
  return value;
};
const bool = (value, label) => {
  if (typeof value !== 'boolean') fail(`${label} 必须是布尔值`);
  return value;
};
const exactKeys = (value, keys, label, optional = []) => {
  if (!isRecord(value)) fail(`${label} 必须是对象`);
  const allowed = new Set([...keys, ...optional]);
  for (const key of Object.keys(value)) {
    if (unsafeKeys.has(key) || !allowed.has(key))
      fail(`${label} 含未声明字段 ${key}`);
  }
  for (const key of keys)
    if (!Object.hasOwn(value, key)) fail(`${label} 缺少字段 ${key}`);
  return value;
};
const table = (value, label) => {
  if (!isRecord(value)) fail(`${label} 必须是实体表`);
  for (const key of Object.keys(value)) {
    if (unsafeKeys.has(key) || !key) fail(`${label} 键无效`);
  }
  return value;
};
const vec2 = (value, label) => {
  if (!Array.isArray(value) || value.length !== 2 || !value.every(finite))
    fail(`${label} 必须是有限 Vec2`);
  return value;
};
const affine = (value, label) => {
  if (!Array.isArray(value) || value.length !== 6 || !value.every(finite))
    fail(`${label} 必须是有限 Affine2D`);
  return value;
};
const rigidAffine = (value, label) => {
  const [a, b, c, d] = affine(value, label);
  const epsilon = 1e-8;
  if (
    Math.abs(a * a + b * b - 1) > epsilon ||
    Math.abs(c * c + d * d - 1) > epsilon ||
    Math.abs(a * c + b * d) > epsilon ||
    Math.abs(a * d - b * c - 1) > epsilon
  )
    fail(`${label} 必须是 XY 刚性变换`);
  return value;
};
const json = (value, label, depth = 0, stack = new WeakSet()) => {
  if (depth > 64) fail(`${label} 嵌套过深`);
  if (value === null || typeof value === 'string' || typeof value === 'boolean')
    return value;
  if (finite(value)) return value;
  if (Array.isArray(value)) {
    if (stack.has(value)) fail(`${label} 不能包含循环`);
    stack.add(value);
    for (const item of value) json(item, label, depth + 1, stack);
    stack.delete(value);
    return value;
  }
  if (!isRecord(value)) fail(`${label} 不是 JSON`);
  if (stack.has(value)) fail(`${label} 不能包含循环`);
  stack.add(value);
  for (const [key, item] of Object.entries(value)) {
    if (unsafeKeys.has(key)) fail(`${label} 含危险键`);
    json(item, label, depth + 1, stack);
  }
  stack.delete(value);
  return value;
};
const recordId = (key, value, label, seen) => {
  id(key, `${label} 表键`);
  if (!isRecord(value) || value.id !== key)
    fail(`${label} 的表键与记录 ID 不一致`);
  if (seen.has(key)) fail(`重复 ID ${key}`);
  seen.add(key);
};

const validateNodeRef = (value, label) => {
  exactKeys(value, ['kind', 'id'], label);
  if (value.kind !== 'node') fail(`${label} 类型无效`);
  id(value.id, `${label}.id`);
};
const validateVertexRef = (value, label) => {
  exactKeys(value, ['kind', 'sketchId', 'id'], label);
  if (value.kind !== 'vertex') fail(`${label} 类型无效`);
  id(value.sketchId, `${label}.sketchId`);
  id(value.id, `${label}.id`);
};
const validateEdgeEndRef = (value, label) => {
  exactKeys(value, ['kind', 'sketchId', 'edgeId', 'end'], label);
  if (value.kind !== 'edge-end' || !['start', 'end'].includes(value.end))
    fail(`${label} 类型无效`);
  id(value.sketchId, `${label}.sketchId`);
  id(value.edgeId, `${label}.edgeId`);
};
const validateOutputRef = (value, label) => {
  exactKeys(
    value,
    [
      'kind',
      'ownerNodeId',
      'operatorId',
      'port',
      'key',
      'lineage',
      'instances',
    ],
    label,
  );
  if (value.kind !== 'output') fail(`${label} 类型无效`);
  id(value.ownerNodeId, `${label}.ownerNodeId`);
  id(value.operatorId, `${label}.operatorId`);
  text(value.port, `${label}.port`);
  text(value.key, `${label}.key`);
  if (
    !Array.isArray(value.lineage) ||
    !value.lineage.every((item) => typeof item === 'string')
  )
    fail(`${label}.lineage 无效`);
  if (!Array.isArray(value.instances)) fail(`${label}.instances 无效`);
  for (const instance of value.instances) {
    exactKeys(instance, ['operatorId', 'index'], `${label}.instances[]`);
    id(instance.operatorId, `${label}.instances[].operatorId`);
    if (!Number.isInteger(instance.index) || instance.index < 0)
      fail(`${label}.instances[].index 无效`);
  }
};
const validateTargetRef = (value, label) => {
  if (!isRecord(value)) fail(`${label} 无效`);
  if (value.kind === 'node') return validateNodeRef(value, label);
  if (value.kind === 'output') return validateOutputRef(value, label);
  fail(`${label} 必须是 NodeRef 或 OutputRef`);
};
const validateEntityRef = (value, label) => {
  if (!isRecord(value)) fail(`${label} 无效`);
  if (value.kind === 'output') return validateOutputRef(value, label);
  if (
    ['node', 'datum', 'parameter', 'relation', 'program'].includes(value.kind)
  ) {
    exactKeys(value, ['kind', 'id'], label);
    return id(value.id, `${label}.id`);
  }
  if (['path', 'vertex', 'edge'].includes(value.kind)) {
    exactKeys(value, ['kind', 'sketchId', 'id'], label);
    id(value.sketchId, `${label}.sketchId`);
    return id(value.id, `${label}.id`);
  }
  if (value.kind === 'edge-end') return validateEdgeEndRef(value, label);
  fail(`${label} 类型无效`);
};
const validateScalar = (value, label, depth = 0, state = { nodes: 0 }) => {
  state.nodes++;
  if (depth > 32 || state.nodes > 512) fail(`${label} 表达式过深或过大`);
  if (finite(value)) return;
  if (!isRecord(value)) fail(`${label} 无效`);
  if (value.kind === 'parameter') {
    exactKeys(value, ['kind', 'id'], label);
    id(value.id, `${label}.id`);
    return;
  }
  exactKeys(value, ['kind', 'op', 'args'], label);
  if (
    value.kind !== 'expression' ||
    !scalarOps.has(value.op) ||
    !Array.isArray(value.args)
  )
    fail(`${label} 无效`);
  const unary =
    value.op === 'negate' || value.op === 'sin' || value.op === 'cos';
  if (value.args.length !== (unary ? 1 : 2)) fail(`${label} 参数数量无效`);
  for (const arg of value.args) validateScalar(arg, label, depth + 1, state);
};
const validateHandle = (value, label) => {
  if (!isRecord(value)) fail(`${label} 无效`);
  if (value.kind === 'free') {
    exactKeys(value, ['kind', 'vector'], label);
    return vec2(value.vector, `${label}.vector`);
  }
  exactKeys(value, ['kind', 'relationId'], label);
  if (value.kind !== 'relation') fail(`${label} 无效`);
  id(value.relationId, `${label}.relationId`);
};
const validateRelationFrame = (value, label) => {
  exactKeys(value, ['space', 'transform'], label);
  if (!['owner-local', 'world'].includes(value.space))
    fail(`${label}.space 无效`);
  rigidAffine(value.transform, `${label}.transform`);
};
const validatePortRef = (value, label, optional = []) => {
  exactKeys(
    value,
    ['kind', 'ownerNodeId', 'operatorId', 'port', 'domain'],
    label,
    optional,
  );
  if (value.kind !== 'port' || !domains.has(value.domain))
    fail(`${label} 类型无效`);
  id(value.ownerNodeId, `${label}.ownerNodeId`);
  id(value.operatorId, `${label}.operatorId`);
  text(value.port, `${label}.port`);
};
const validateInputRef = (value, label) => {
  if (!isRecord(value)) fail(`${label} 无效`);
  if (value.kind === 'sketch') {
    exactKeys(value, ['kind', 'sketchId'], label, ['pathIds']);
    id(value.sketchId, `${label}.sketchId`);
    if (
      value.pathIds !== undefined &&
      (!Array.isArray(value.pathIds) ||
        !value.pathIds.every((item) => typeof item === 'string'))
    )
      fail(`${label}.pathIds 无效`);
    return;
  }
  exactKeys(
    value,
    [
      'kind',
      'ownerNodeId',
      'operatorId',
      'port',
      'domain',
      'space',
      'transform',
    ],
    label,
  );
  validatePortRef(value, label, ['space', 'transform']);
  if (!['local-result', 'world-result'].includes(value.space))
    fail(`${label}.space 无效`);
  affine(value.transform, `${label}.transform`);
};

const validateNode = (key, node, seen) => {
  recordId(key, node, 'Node', seen);
  exactKeys(
    node,
    ['id', 'name', 'parentId', 'order', 'pose', 'visible', 'locked', 'kind'],
    'Node',
    ['programId'],
  );
  text(node.name, 'Node.name');
  if (node.parentId !== null) id(node.parentId, 'Node.parentId');
  if (!finite(node.order)) fail('Node.order 无效');
  exactKeys(node.pose, ['translationMM', 'rotationRad'], 'Node.pose');
  vec2(node.pose.translationMM, 'Node.pose.translationMM');
  if (!finite(node.pose.rotationRad)) fail('Node.pose.rotationRad 无效');
  bool(node.visible, 'Node.visible');
  bool(node.locked, 'Node.locked');
  if (node.kind === 'shape') id(node.programId, 'Shape.programId');
  else if (node.kind !== 'group' || Object.hasOwn(node, 'programId'))
    fail('Node.kind 无效');
};
const validateSketch = (key, sketch, seen) => {
  recordId(key, sketch, 'Sketch', seen);
  exactKeys(
    sketch,
    ['id', 'ownerNodeId', 'vertices', 'edges', 'paths'],
    'Sketch',
  );
  id(sketch.ownerNodeId, 'Sketch.ownerNodeId');
  for (const [vertexId, vertex] of Object.entries(
    table(sketch.vertices, 'Sketch.vertices'),
  )) {
    recordId(vertexId, vertex, 'Vertex', seen);
    if (!isRecord(vertex.position)) fail('Vertex.position 无效');
    if (vertex.position.kind === 'free') {
      exactKeys(vertex.position, ['kind', 'value'], 'Vertex.position');
      vec2(vertex.position.value, 'Vertex.position.value');
    } else {
      exactKeys(vertex.position, ['kind', 'relationId'], 'Vertex.position');
      if (vertex.position.kind !== 'relation') fail('Vertex.position 无效');
      id(vertex.position.relationId, 'Vertex.position.relationId');
    }
  }
  for (const [edgeId, edge] of Object.entries(
    table(sketch.edges, 'Sketch.edges'),
  )) {
    recordId(edgeId, edge, 'Edge', seen);
    exactKeys(
      edge,
      ['id', 'startVertexId', 'endVertexId', 'startHandle', 'endHandle'],
      'Edge',
    );
    id(edge.startVertexId, 'Edge.startVertexId');
    id(edge.endVertexId, 'Edge.endVertexId');
    validateHandle(edge.startHandle, 'Edge.startHandle');
    validateHandle(edge.endHandle, 'Edge.endHandle');
  }
  for (const [pathId, path] of Object.entries(
    table(sketch.paths, 'Sketch.paths'),
  )) {
    recordId(pathId, path, 'Path', seen);
    exactKeys(path, ['id', 'name', 'edges', 'visible'], 'Path', [
      'handleModes',
    ]);
    text(path.name, 'Path.name');
    if (!Array.isArray(path.edges)) fail('Path.edges 无效');
    for (const use of path.edges) {
      exactKeys(use, ['edgeId', 'reversed'], 'Path.edges[]');
      id(use.edgeId, 'Path.edges[].edgeId');
      bool(use.reversed, 'Path.edges[].reversed');
    }
    bool(path.visible, 'Path.visible');
    if (path.handleModes !== undefined) {
      const modes = table(path.handleModes, 'Path.handleModes');
      for (const [vertexId, mode] of Object.entries(modes)) {
        id(vertexId, 'Path.handleModes VertexId');
        if (!['corner', 'smooth', 'symmetric'].includes(mode))
          fail('Path.handleModes 模式无效');
      }
    }
  }
};
const validateDatum = (key, datum, seen) => {
  recordId(key, datum, 'Datum', seen);
  if (!isRecord(datum)) fail('Datum 无效');
  if (datum.kind === 'point') {
    exactKeys(
      datum,
      ['id', 'name', 'ownerNodeId', 'kind', 'position'],
      'Datum',
    );
    if (!Array.isArray(datum.position) || datum.position.length !== 2)
      fail('Datum.position 无效');
    datum.position.forEach((item) => validateScalar(item, 'Datum.position'));
  } else {
    exactKeys(
      datum,
      ['id', 'name', 'ownerNodeId', 'kind', 'origin', 'angleRad'],
      'Datum',
    );
    if (
      datum.kind !== 'axis' ||
      !Array.isArray(datum.origin) ||
      datum.origin.length !== 2
    )
      fail('Datum 无效');
    datum.origin.forEach((item) => validateScalar(item, 'Datum.origin'));
    validateScalar(datum.angleRad, 'Datum.angleRad');
  }
  text(datum.name, 'Datum.name');
  if (datum.ownerNodeId !== null) id(datum.ownerNodeId, 'Datum.ownerNodeId');
};
const validateParameter = (key, parameter, seen) => {
  recordId(key, parameter, 'Parameter', seen);
  exactKeys(
    parameter,
    ['id', 'name', 'ownerNodeId', 'unit', 'value'],
    'Parameter',
  );
  text(parameter.name, 'Parameter.name');
  if (parameter.ownerNodeId !== null)
    id(parameter.ownerNodeId, 'Parameter.ownerNodeId');
  if (
    !['mm', 'rad', 'count', 'unitless'].includes(parameter.unit) ||
    !finite(parameter.value)
  )
    fail('Parameter 无效');
};
const validateRelation = (key, relation, seen) => {
  recordId(key, relation, 'Relation', seen);
  if (!isRecord(relation)) fail('Relation 无效');
  if (relation.kind === 'point-on-axis') {
    exactKeys(
      relation,
      ['id', 'kind', 'target', 'axisId', 'distance', 'frame'],
      'Relation',
    );
    validateVertexRef(relation.target, 'Relation.target');
    id(relation.axisId, 'Relation.axisId');
    validateScalar(relation.distance, 'Relation.distance');
    validateRelationFrame(relation.frame, 'Relation.frame');
    return;
  }
  if (relation.kind === 'coincident') {
    exactKeys(
      relation,
      ['id', 'kind', 'target', 'source', 'offset', 'frame'],
      'Relation',
    );
    validateVertexRef(relation.target, 'Relation.target');
    if (!isRecord(relation.source)) fail('Relation.source 无效');
    if (relation.source.kind === 'vertex')
      validateVertexRef(relation.source, 'Relation.source');
    else {
      exactKeys(relation.source, ['kind', 'id'], 'Relation.source');
      if (relation.source.kind !== 'datum') fail('Relation.source 无效');
      id(relation.source.id, 'Relation.source.id');
    }
    if (!Array.isArray(relation.offset) || relation.offset.length !== 2)
      fail('Relation.offset 无效');
    relation.offset.forEach((item) => validateScalar(item, 'Relation.offset'));
    validateRelationFrame(relation.frame, 'Relation.frame');
    return;
  }
  if (relation.kind !== 'handle-continuity') fail('Relation.kind 无效');
  exactKeys(relation, ['id', 'kind', 'target', 'source', 'mode'], 'Relation', [
    'length',
  ]);
  validateEdgeEndRef(relation.target, 'Relation.target');
  validateEdgeEndRef(relation.source, 'Relation.source');
  if (!['smooth', 'symmetric', 'auto'].includes(relation.mode))
    fail('Relation.mode 无效');
  if (relation.mode === 'smooth') {
    if (!Object.hasOwn(relation, 'length')) fail('smooth 关系缺少 length');
    validateScalar(relation.length, 'Relation.length');
  } else if (Object.hasOwn(relation, 'length'))
    fail('Relation.length 仅 smooth 可用');
};
const validateOperator = (key, operator, seen) => {
  recordId(key, operator, 'Operator', seen);
  exactKeys(
    operator,
    ['id', 'type', 'name', 'enabled', 'inputs', 'params'],
    'Operator',
    ['outputContract'],
  );
  text(operator.type, 'Operator.type');
  text(operator.name, 'Operator.name');
  bool(operator.enabled, 'Operator.enabled');
  for (const [port, inputs] of Object.entries(
    table(operator.inputs, 'Operator.inputs'),
  )) {
    text(port, 'Operator.inputs key');
    if (!Array.isArray(inputs)) fail('Operator.inputs 端口必须是数组');
    inputs.forEach((input) => validateInputRef(input, 'Operator.inputs[]'));
  }
  json(operator.params, 'Operator.params');
  if (operator.outputContract !== undefined) {
    exactKeys(
      operator.outputContract,
      ['version', 'members'],
      'Operator.outputContract',
    );
    if (
      operator.outputContract.version !== 1 ||
      !Array.isArray(operator.outputContract.members)
    )
      fail('Operator.outputContract 无效');
    const members = new Set();
    for (const member of operator.outputContract.members) {
      exactKeys(
        member,
        ['port', 'key', 'lineage'],
        'Operator.outputContract.members[]',
        ['topology'],
      );
      text(member.port, 'Operator.outputContract.members[].port');
      text(member.key, 'Operator.outputContract.members[].key');
      if (
        !Array.isArray(member.lineage) ||
        !member.lineage.every((item) => typeof item === 'string')
      )
        fail('Operator.outputContract.members[].lineage 无效');
      if (member.topology !== undefined)
        text(member.topology, 'Operator.outputContract.members[].topology');
      const memberKey = `${member.port}\u0000${member.key}`;
      if (members.has(memberKey)) fail('Operator.outputContract 成员重复');
      members.add(memberKey);
    }
  }
};
const validateProgram = (key, program, seen) => {
  recordId(key, program, 'Program', seen);
  exactKeys(program, ['id', 'ownerNodeId', 'operators', 'outputs'], 'Program');
  id(program.ownerNodeId, 'Program.ownerNodeId');
  for (const [operatorId, operator] of Object.entries(
    table(program.operators, 'Program.operators'),
  ))
    validateOperator(operatorId, operator, seen);
  table(program.outputs, 'Program.outputs');
  for (const [name, port] of Object.entries(program.outputs)) {
    if (!['curves', 'regions'].includes(name)) fail('Program 输出名无效');
    validatePortRef(port, 'Program.outputs');
    if (port.domain !== name) fail('Program 输出域不匹配');
    if (port.ownerNodeId !== program.ownerNodeId)
      fail('Program.outputs 必须发布自身 owner 的端口');
  }
};
const validateReliefValue = (value, label, partial = false) => {
  if (!isRecord(value)) fail(`${label} 无效`);
  const keys = ['enabled', 'thickness', 'mode', 'placement'];
  if (!partial) exactKeys(value, keys, label);
  else
    for (const key of Object.keys(value))
      if (!keys.includes(key)) fail(`${label} 含未声明字段 ${key}`);
  if (value.enabled !== undefined) bool(value.enabled, `${label}.enabled`);
  if (value.thickness !== undefined) {
    if (!isRecord(value.thickness)) fail(`${label}.thickness 无效`);
    if (value.thickness.kind === 'mm') {
      exactKeys(value.thickness, ['kind', 'value'], `${label}.thickness`);
      if (!finite(value.thickness.value)) fail(`${label}.thickness.value 无效`);
    } else {
      exactKeys(value.thickness, ['kind', 'count'], `${label}.thickness`);
      if (
        value.thickness.kind !== 'layers' ||
        !Number.isInteger(value.thickness.count) ||
        value.thickness.count <= 0
      )
        fail(`${label}.thickness.count 无效`);
    }
  }
  if (
    value.mode !== undefined &&
    !['add', 'cut', 'through'].includes(value.mode)
  )
    fail(`${label}.mode 无效`);
  if (value.placement !== undefined) {
    if (!isRecord(value.placement)) fail(`${label}.placement 无效`);
    if (value.placement.kind === 'free') {
      exactKeys(value.placement, ['kind', 'zMM'], `${label}.placement`);
      if (!finite(value.placement.zMM)) fail(`${label}.placement.zMM 无效`);
    } else if (value.placement.kind === 'attached') {
      exactKeys(
        value.placement,
        ['kind', 'target', 'offsetMM'],
        `${label}.placement`,
      );
      validateTargetRef(value.placement.target, `${label}.placement.target`);
      if (!finite(value.placement.offsetMM))
        fail(`${label}.placement.offsetMM 无效`);
    } else {
      exactKeys(
        value.placement,
        ['kind', 'layerId', 'offsetMM'],
        `${label}.placement`,
      );
      if (value.placement.kind !== 'layer') fail(`${label}.placement 无效`);
      id(value.placement.layerId, `${label}.placement.layerId`);
      if (!finite(value.placement.offsetMM))
        fail(`${label}.placement.offsetMM 无效`);
    }
  }
};
const validateAppearance = (value, seen) => {
  exactKeys(value, ['swatches', 'defaults', 'overrides'], 'appearances');
  for (const [swatchId, swatch] of Object.entries(
    table(value.swatches, 'appearances.swatches'),
  )) {
    recordId(swatchId, swatch, 'Swatch', seen);
    exactKeys(swatch, ['id', 'name', 'color'], 'Swatch');
    text(swatch.name, 'Swatch.name');
    if (!/^#[0-9a-f]{6}$/i.test(swatch.color)) fail('Swatch.color 无效');
  }
  for (const [shapeId, item] of Object.entries(
    table(value.defaults, 'appearances.defaults'),
  )) {
    id(shapeId, 'appearances.defaults key');
    exactKeys(item, ['swatchId'], 'appearances.defaults');
    id(item.swatchId, 'appearances.defaults.swatchId');
  }
  for (const [assignmentId, assignment] of Object.entries(
    table(value.overrides, 'appearances.overrides'),
  )) {
    recordId(assignmentId, assignment, 'AppearanceAssignment', seen);
    exactKeys(assignment, ['id', 'target', 'value'], 'AppearanceAssignment');
    validateOutputRef(assignment.target, 'AppearanceAssignment.target');
    exactKeys(assignment.value, ['swatchId'], 'AppearanceAssignment.value');
    id(assignment.value.swatchId, 'AppearanceAssignment.value.swatchId');
  }
};
const validateRelief = (value, seen) => {
  exactKeys(value, ['defaults', 'overrides'], 'reliefDefinitions');
  for (const [shapeId, definition] of Object.entries(
    table(value.defaults, 'reliefDefinitions.defaults'),
  )) {
    id(shapeId, 'reliefDefinitions.defaults key');
    validateReliefValue(definition, 'reliefDefinitions.defaults');
  }
  for (const [overrideId, override] of Object.entries(
    table(value.overrides, 'reliefDefinitions.overrides'),
  )) {
    recordId(overrideId, override, 'ReliefAssignment', seen);
    exactKeys(override, ['id', 'target', 'value'], 'ReliefAssignment');
    validateOutputRef(override.target, 'ReliefAssignment.target');
    validateReliefValue(override.value, 'ReliefAssignment.value', true);
  }
};
const validateManufacturing = (value, seen) => {
  exactKeys(
    value,
    [
      'layerHeightMM',
      'layers',
      'layerOrder',
      'parts',
      'defaultPartId',
      'assignments',
      'excluded',
      'slicerTemplate',
    ],
    'manufacturing',
  );
  if (!finite(value.layerHeightMM) || value.layerHeightMM <= 0)
    fail('manufacturing.layerHeightMM 无效');
  for (const [layerId, layer] of Object.entries(
    table(value.layers, 'manufacturing.layers'),
  )) {
    recordId(layerId, layer, 'Layer', seen);
    exactKeys(layer, ['id', 'name'], 'Layer');
    text(layer.name, 'Layer.name');
  }
  if (
    !Array.isArray(value.layerOrder) ||
    !value.layerOrder.every((item) => typeof item === 'string') ||
    new Set(value.layerOrder).size !== value.layerOrder.length
  )
    fail('manufacturing.layerOrder 无效');
  for (const [partId, part] of Object.entries(
    table(value.parts, 'manufacturing.parts'),
  )) {
    recordId(partId, part, 'Part', seen);
    exactKeys(part, ['id', 'name'], 'Part');
    text(part.name, 'Part.name');
  }
  id(value.defaultPartId, 'manufacturing.defaultPartId');
  for (const [assignmentId, assignment] of Object.entries(
    table(value.assignments, 'manufacturing.assignments'),
  )) {
    recordId(assignmentId, assignment, 'ManufacturingAssignment', seen);
    exactKeys(
      assignment,
      ['id', 'target', 'partId'],
      'ManufacturingAssignment',
    );
    validateTargetRef(assignment.target, 'ManufacturingAssignment.target');
    id(assignment.partId, 'ManufacturingAssignment.partId');
  }
  if (!Array.isArray(value.excluded)) fail('manufacturing.excluded 无效');
  value.excluded.forEach((target) =>
    validateTargetRef(target, 'manufacturing.excluded[]'),
  );
  if (value.slicerTemplate !== null)
    json(value.slicerTemplate, 'manufacturing.slicerTemplate');
};
const validateAsset = (key, asset, seen) => {
  recordId(key, asset, 'Asset', seen);
  exactKeys(asset, ['id', 'path', 'mediaType', 'size', 'sha256'], 'Asset');
  text(asset.path, 'Asset.path');
  text(asset.mediaType, 'Asset.mediaType');
  if (!Number.isSafeInteger(asset.size) || asset.size < 0)
    fail('Asset.size 无效');
  if (!/^[a-f0-9]{64}$/.test(asset.sha256)) fail('Asset.sha256 无效');
};
const validateReference = (key, reference, seen) => {
  recordId(key, reference, 'Reference', seen);
  exactKeys(
    reference,
    [
      'id',
      'assetId',
      'name',
      'pixelWidth',
      'pixelHeight',
      'pixelToWorld',
      'visible',
      'locked',
      'opacity',
    ],
    'Reference',
  );
  id(reference.assetId, 'Reference.assetId');
  text(reference.name, 'Reference.name');
  if (
    !Number.isInteger(reference.pixelWidth) ||
    reference.pixelWidth <= 0 ||
    !Number.isInteger(reference.pixelHeight) ||
    reference.pixelHeight <= 0
  )
    fail('Reference 尺寸无效');
  affine(reference.pixelToWorld, 'Reference.pixelToWorld');
  bool(reference.visible, 'Reference.visible');
  bool(reference.locked, 'Reference.locked');
  if (
    !finite(reference.opacity) ||
    reference.opacity < 0 ||
    reference.opacity > 1
  )
    fail('Reference.opacity 无效');
};
const validateCollection = (key, collection, seen) => {
  recordId(key, collection, 'Collection', seen);
  exactKeys(collection, ['id', 'name', 'members', 'origin'], 'Collection');
  text(collection.name, 'Collection.name');
  if (!Array.isArray(collection.members)) fail('Collection.members 无效');
  collection.members.forEach((member) =>
    validateEntityRef(member, 'Collection.members[]'),
  );
  if (!['legacy', 'user'].includes(collection.origin))
    fail('Collection.origin 无效');
};

const nodeIsShape = (document, nodeId) =>
  document.nodes[nodeId]?.kind === 'shape';
const softReference = (diagnostics, kind, ref, message) =>
  diagnostics.push({ severity: 'error', kind, ref, message });
const findSketch = (document, sketchId, entityId, tableName) =>
  document.sketches[sketchId]?.[tableName]?.[entityId];
const inspectOutputRef = (document, ref, label, diagnostics) => {
  const node = document.nodes[ref.ownerNodeId];
  if (!node)
    return softReference(
      diagnostics,
      'unresolved-reference',
      ref,
      `${label} 的 ownerNodeId 不存在`,
    );
  if (node.kind !== 'shape')
    return softReference(
      diagnostics,
      'invalid-reference',
      ref,
      `${label} 的 owner 必须是 Shape`,
    );
  const program = document.programs[node.programId];
  const operator = program?.operators[ref.operatorId];
  if (!operator)
    return softReference(
      diagnostics,
      'unresolved-reference',
      ref,
      `${label} 的 operator 不存在`,
    );
  const member = operator.outputContract?.members.find(
    (item) => item.port === ref.port && item.key === ref.key,
  );
  if (operator.outputContract && !member)
    softReference(
      diagnostics,
      'unresolved-reference',
      ref,
      `${label} 不在 outputContract 中`,
    );
};
const assertExistingNodeIsShape = (document, ref, label) => {
  if (
    ref.kind === 'node' &&
    document.nodes[ref.id] &&
    document.nodes[ref.id].kind !== 'shape'
  )
    fail(`${label} 只能引用 Shape`);
  if (
    ref.kind === 'port' &&
    document.nodes[ref.ownerNodeId] &&
    document.nodes[ref.ownerNodeId].kind !== 'shape'
  )
    fail(`${label} 的 PortRef owner 必须是 Shape`);
  if (
    ref.kind === 'output' &&
    document.nodes[ref.ownerNodeId] &&
    document.nodes[ref.ownerNodeId].kind !== 'shape'
  )
    fail(`${label} 的 OutputRef owner 必须是 Shape`);
};
const assertExistingRelationTarget = (document, relation, targetKeys) => {
  const target = relation.target;
  if (target.kind === 'vertex') {
    const vertex = findSketch(document, target.sketchId, target.id, 'vertices');
    if (
      vertex &&
      (vertex.position.kind !== 'relation' ||
        vertex.position.relationId !== relation.id)
    )
      fail('Relation.target 与 Vertex.relationId 不一致');
  } else {
    const edge = findSketch(document, target.sketchId, target.edgeId, 'edges');
    const handle = edge?.[target.end === 'start' ? 'startHandle' : 'endHandle'];
    if (
      handle &&
      (handle.kind !== 'relation' || handle.relationId !== relation.id)
    )
      fail('Relation.target 与 Handle.relationId 不一致');
  }
  const signature =
    target.kind === 'vertex'
      ? `vertex:${target.sketchId}:${target.id}`
      : `edge-end:${target.sketchId}:${target.edgeId}:${target.end}`;
  if (targetKeys.has(signature)) fail('同一目标不能有第二个 Relation');
  targetKeys.add(signature);
};
const assertExistingRelations = (document) => {
  const targetKeys = new Set();
  for (const relation of Object.values(document.relations)) {
    assertExistingRelationTarget(document, relation, targetKeys);
    if (relation.kind === 'point-on-axis') {
      const datum = document.datums[relation.axisId];
      if (datum && datum.kind !== 'axis')
        fail('point-on-axis.axisId 必须引用 axis Datum');
    }
    if (relation.kind === 'coincident' && relation.source.kind === 'datum') {
      const datum = document.datums[relation.source.id];
      if (datum && datum.kind !== 'point')
        fail('coincident.source 必须引用 point Datum');
    }
    if (relation.kind === 'handle-continuity') {
      const targetEdge = findSketch(
        document,
        relation.target.sketchId,
        relation.target.edgeId,
        'edges',
      );
      const sourceEdge = findSketch(
        document,
        relation.source.sketchId,
        relation.source.edgeId,
        'edges',
      );
      if (targetEdge && sourceEdge) {
        if (relation.target.sketchId !== relation.source.sketchId)
          fail('handle-continuity 必须在同一 Sketch');
        const targetVertex =
          targetEdge[
            relation.target.end === 'start' ? 'startVertexId' : 'endVertexId'
          ];
        const sourceVertex =
          sourceEdge[
            relation.source.end === 'start' ? 'startVertexId' : 'endVertexId'
          ];
        if (targetVertex !== sourceVertex)
          fail('handle-continuity 必须共享被约束端点');
      }
    }
  }
};
const assertStrongOwnership = (document) => {
  for (const node of Object.values(document.nodes)) {
    if (node.parentId !== null) {
      const parent = document.nodes[node.parentId];
      if (!parent) fail('Node.parentId 必须存在');
      if (parent.kind !== 'group') fail('Node.parentId 必须引用 Group');
    }
    if (node.kind === 'shape') {
      const program = document.programs[node.programId];
      if (!program) fail('Shape.programId 必须存在');
      if (program.ownerNodeId !== node.id)
        fail('Shape 与 Program owner 不一致');
    }
  }
  for (const program of Object.values(document.programs)) {
    const owner = document.nodes[program.ownerNodeId];
    if (!owner || owner.kind !== 'shape' || owner.programId !== program.id)
      fail('Program.ownerNodeId 必须与 Shape.programId 一一对应');
  }
  for (const sketch of Object.values(document.sketches)) {
    if (!nodeIsShape(document, sketch.ownerNodeId))
      fail('Sketch.ownerNodeId 必须是存在的 Shape');
  }
  for (const datum of Object.values(document.datums))
    if (datum.ownerNodeId !== null && !document.nodes[datum.ownerNodeId])
      fail('Datum.ownerNodeId 必须存在');
  for (const parameter of Object.values(document.parameters))
    if (
      parameter.ownerNodeId !== null &&
      !document.nodes[parameter.ownerNodeId]
    )
      fail('Parameter.ownerNodeId 必须存在');
  const finished = new Set();
  for (const nodeId of Object.keys(document.nodes)) {
    if (finished.has(nodeId)) continue;
    const seen = new Set();
    let current = nodeId;
    while (current !== null) {
      if (seen.has(current)) fail('Node.parentId 不能形成环');
      if (finished.has(current)) break;
      seen.add(current);
      current = document.nodes[current].parentId;
    }
    for (const visited of seen) finished.add(visited);
  }
};
const assertExistingReferenceTypes = (document) => {
  for (const program of Object.values(document.programs)) {
    for (const operator of Object.values(program.operators))
      for (const inputs of Object.values(operator.inputs))
        for (const input of inputs) {
          if (
            input.kind === 'sketch' &&
            document.sketches[input.sketchId] &&
            document.sketches[input.sketchId].ownerNodeId !==
              program.ownerNodeId
          )
            fail('Sketch InputRef 只能引用 Program 所有者的 Sketch');
          if (input.kind === 'port')
            assertExistingNodeIsShape(document, input, 'PortRef');
        }
  }
  for (const assignment of Object.values(document.manufacturing.assignments))
    assertExistingNodeIsShape(
      document,
      assignment.target,
      'ManufacturingAssignment.target',
    );
  document.manufacturing.excluded.forEach((target) =>
    assertExistingNodeIsShape(document, target, 'manufacturing.excluded'),
  );
  for (const shapeId of Object.keys(document.appearances.defaults)) {
    if (document.nodes[shapeId] && document.nodes[shapeId].kind !== 'shape')
      fail('appearances.defaults 键只能是 Shape');
  }
  for (const shapeId of Object.keys(document.reliefDefinitions.defaults)) {
    if (document.nodes[shapeId] && document.nodes[shapeId].kind !== 'shape')
      fail('reliefDefinitions.defaults 键只能是 Shape');
    const placement = document.reliefDefinitions.defaults[shapeId].placement;
    if (placement.kind === 'attached')
      assertExistingNodeIsShape(
        document,
        placement.target,
        'reliefDefinitions.defaults.placement.target',
      );
  }
  for (const override of Object.values(document.reliefDefinitions.overrides)) {
    assertExistingNodeIsShape(
      document,
      override.target,
      'ReliefAssignment.target',
    );
    if (override.value.placement?.kind === 'attached')
      assertExistingNodeIsShape(
        document,
        override.value.placement.target,
        'ReliefAssignment.value.placement.target',
      );
  }
  assertExistingRelations(document);
};

export function createDocument(options = {}) {
  const makeId =
    options.idFactory ||
    (() =>
      globalThis.crypto?.randomUUID?.() ||
      `v4-${Math.random().toString(36).slice(2)}`);
  if (typeof makeId !== 'function') fail('idFactory 必须是函数');
  const documentId = options.id || makeId();
  const defaultPartId = makeId();
  const document = {
    version: 4,
    id: documentId,
    units: 'mm',
    nodes: {},
    sketches: {},
    datums: {},
    parameters: {},
    relations: {},
    programs: {},
    geometrySettings: {
      curveToleranceMM: 0.015,
      joinToleranceMM: 0.001,
      numericTolerance: 1e-9,
    },
    appearances: { swatches: {}, defaults: {}, overrides: {} },
    reliefDefinitions: { defaults: {}, overrides: {} },
    manufacturing: {
      layerHeightMM: 0.2,
      layers: {},
      layerOrder: [],
      parts: { [defaultPartId]: { id: defaultPartId, name: '默认零件' } },
      defaultPartId,
      assignments: {},
      excluded: [],
      slicerTemplate: null,
    },
    assets: {},
    references: {},
    collections: {},
  };
  return validateDocument(document);
}

export function validateDocument(value) {
  json(value, 'DocumentV4');
  exactKeys(value, topLevelKeys, 'DocumentV4');
  if (value.version !== 4 || value.units !== 'mm')
    fail('DocumentV4 版本或单位无效');
  const seen = new Set();
  id(value.id, 'DocumentV4.id');
  seen.add(value.id);
  for (const [nodeId, node] of Object.entries(table(value.nodes, 'nodes')))
    validateNode(nodeId, node, seen);
  for (const [sketchId, sketch] of Object.entries(
    table(value.sketches, 'sketches'),
  ))
    validateSketch(sketchId, sketch, seen);
  for (const [datumId, datum] of Object.entries(table(value.datums, 'datums')))
    validateDatum(datumId, datum, seen);
  for (const [parameterId, parameter] of Object.entries(
    table(value.parameters, 'parameters'),
  ))
    validateParameter(parameterId, parameter, seen);
  for (const [relationId, relation] of Object.entries(
    table(value.relations, 'relations'),
  ))
    validateRelation(relationId, relation, seen);
  for (const [programId, program] of Object.entries(
    table(value.programs, 'programs'),
  ))
    validateProgram(programId, program, seen);
  exactKeys(
    value.geometrySettings,
    ['curveToleranceMM', 'joinToleranceMM', 'numericTolerance'],
    'geometrySettings',
  );
  for (const setting of Object.values(value.geometrySettings))
    if (!finite(setting) || setting <= 0) fail('geometrySettings 无效');
  validateAppearance(value.appearances, seen);
  validateRelief(value.reliefDefinitions, seen);
  validateManufacturing(value.manufacturing, seen);
  for (const [assetId, asset] of Object.entries(table(value.assets, 'assets')))
    validateAsset(assetId, asset, seen);
  for (const [referenceId, reference] of Object.entries(
    table(value.references, 'references'),
  ))
    validateReference(referenceId, reference, seen);
  for (const [collectionId, collection] of Object.entries(
    table(value.collections, 'collections'),
  ))
    validateCollection(collectionId, collection, seen);

  assertStrongOwnership(value);
  assertExistingReferenceTypes(value);
  return value;
}

export function inspectDocumentReferences(document) {
  validateDocument(document);
  const diagnostics = [];
  const existsNode = (nodeId, label, ref) => {
    if (!document.nodes[nodeId])
      softReference(
        diagnostics,
        'unresolved-reference',
        ref,
        `${label} 不存在`,
      );
  };
  for (const node of Object.values(document.nodes)) {
    if (node.parentId !== null && !document.nodes[node.parentId])
      existsNode(node.parentId, 'parentId', { kind: 'node', id: node.id });
  }
  for (const sketch of Object.values(document.sketches)) {
    existsNode(sketch.ownerNodeId, 'Sketch.ownerNodeId', {
      kind: 'program',
      id: sketch.id,
    });
    for (const vertex of Object.values(sketch.vertices))
      if (
        vertex.position.kind === 'relation' &&
        !document.relations[vertex.position.relationId]
      )
        softReference(
          diagnostics,
          'unresolved-reference',
          { kind: 'vertex', sketchId: sketch.id, id: vertex.id },
          'Vertex relationId 不存在',
        );
    for (const edge of Object.values(sketch.edges)) {
      for (const vertexId of [edge.startVertexId, edge.endVertexId])
        if (!sketch.vertices[vertexId])
          softReference(
            diagnostics,
            'unresolved-reference',
            { kind: 'edge', sketchId: sketch.id, id: edge.id },
            'Edge 顶点不存在',
          );
      for (const handle of [edge.startHandle, edge.endHandle])
        if (
          handle.kind === 'relation' &&
          !document.relations[handle.relationId]
        )
          softReference(
            diagnostics,
            'unresolved-reference',
            { kind: 'edge', sketchId: sketch.id, id: edge.id },
            'Handle relationId 不存在',
          );
    }
    for (const path of Object.values(sketch.paths)) {
      for (const use of path.edges)
        if (!sketch.edges[use.edgeId])
          softReference(
            diagnostics,
            'unresolved-reference',
            { kind: 'path', sketchId: sketch.id, id: path.id },
            'Path edgeId 不存在',
          );
      const pathVertexIds = new Set(
        path.edges.flatMap((use) => {
          const edge = sketch.edges[use.edgeId];
          return edge ? [edge.startVertexId, edge.endVertexId] : [];
        }),
      );
      for (const vertexId of Object.keys(path.handleModes || {})) {
        const pathRef = { kind: 'path', sketchId: sketch.id, id: path.id };
        if (!sketch.vertices[vertexId])
          softReference(
            diagnostics,
            'unresolved-reference',
            pathRef,
            `Path handleModes Vertex 不存在：${vertexId}`,
          );
        else if (!pathVertexIds.has(vertexId))
          softReference(
            diagnostics,
            'invalid-reference',
            pathRef,
            `Path handleModes Vertex 不属于路径：${vertexId}`,
          );
      }
    }
  }
  for (const datum of Object.values(document.datums))
    if (datum.ownerNodeId !== null && !document.nodes[datum.ownerNodeId])
      existsNode(datum.ownerNodeId, 'Datum.ownerNodeId', {
        kind: 'datum',
        id: datum.id,
      });
  for (const parameter of Object.values(document.parameters))
    if (
      parameter.ownerNodeId !== null &&
      !document.nodes[parameter.ownerNodeId]
    )
      existsNode(parameter.ownerNodeId, 'Parameter.ownerNodeId', {
        kind: 'parameter',
        id: parameter.id,
      });
  for (const relation of Object.values(document.relations)) {
    if (relation.kind === 'point-on-axis' && !document.datums[relation.axisId])
      softReference(
        diagnostics,
        'unresolved-reference',
        { kind: 'relation', id: relation.id },
        'Relation.axisId 不存在',
      );
    if (
      relation.kind === 'coincident' &&
      relation.source.kind === 'datum' &&
      !document.datums[relation.source.id]
    )
      softReference(
        diagnostics,
        'unresolved-reference',
        { kind: 'relation', id: relation.id },
        'Relation.source datum 不存在',
      );
  }
  for (const program of Object.values(document.programs)) {
    existsNode(program.ownerNodeId, 'Program.ownerNodeId', {
      kind: 'program',
      id: program.id,
    });
    for (const operator of Object.values(program.operators))
      for (const inputs of Object.values(operator.inputs))
        for (const input of inputs) {
          if (input.kind === 'sketch') {
            const sketch = document.sketches[input.sketchId];
            if (!sketch)
              softReference(
                diagnostics,
                'unresolved-reference',
                input,
                'Sketch InputRef 不存在',
              );
            else
              for (const pathId of input.pathIds || [])
                if (!sketch.paths[pathId])
                  softReference(
                    diagnostics,
                    'unresolved-reference',
                    input,
                    'Sketch InputRef pathId 不存在',
                  );
          } else inspectOutputRef(document, input, 'PortRef', diagnostics);
        }
  }
  const inspectTarget = (target, label) => {
    if (target.kind === 'node') {
      const node = document.nodes[target.id];
      if (!node)
        softReference(
          diagnostics,
          'unresolved-reference',
          target,
          `${label} Node 不存在`,
        );
      else if (node.kind !== 'shape')
        softReference(
          diagnostics,
          'invalid-reference',
          target,
          `${label} Node 必须是 Shape`,
        );
    } else inspectOutputRef(document, target, label, diagnostics);
  };
  for (const [shapeId, item] of Object.entries(document.appearances.defaults)) {
    if (!nodeIsShape(document, shapeId))
      softReference(
        diagnostics,
        'unresolved-reference',
        { kind: 'node', id: shapeId },
        'appearance default Shape 不存在',
      );
    if (!document.appearances.swatches[item.swatchId])
      softReference(
        diagnostics,
        'unresolved-reference',
        { kind: 'node', id: shapeId },
        'appearance default swatch 不存在',
      );
  }
  for (const assignment of Object.values(document.appearances.overrides)) {
    inspectOutputRef(
      document,
      assignment.target,
      'appearance override',
      diagnostics,
    );
    if (!document.appearances.swatches[assignment.value.swatchId])
      softReference(
        diagnostics,
        'unresolved-reference',
        assignment.target,
        'appearance override swatch 不存在',
      );
  }
  for (const shapeId of Object.keys(document.reliefDefinitions.defaults))
    if (!nodeIsShape(document, shapeId))
      softReference(
        diagnostics,
        'unresolved-reference',
        { kind: 'node', id: shapeId },
        'relief default Shape 不存在',
      );
  for (const override of Object.values(document.reliefDefinitions.overrides))
    inspectOutputRef(document, override.target, 'relief override', diagnostics);
  for (const layerId of document.manufacturing.layerOrder)
    if (!document.manufacturing.layers[layerId])
      softReference(
        diagnostics,
        'unresolved-reference',
        { kind: 'node', id: layerId },
        'layerOrder layer 不存在',
      );
  if (!document.manufacturing.parts[document.manufacturing.defaultPartId])
    softReference(
      diagnostics,
      'unresolved-reference',
      { kind: 'node', id: document.manufacturing.defaultPartId },
      'defaultPartId 不存在',
    );
  for (const assignment of Object.values(document.manufacturing.assignments)) {
    inspectTarget(assignment.target, 'manufacturing assignment');
    if (!document.manufacturing.parts[assignment.partId])
      softReference(
        diagnostics,
        'unresolved-reference',
        assignment.target,
        'manufacturing part 不存在',
      );
  }
  document.manufacturing.excluded.forEach((target) =>
    inspectTarget(target, 'manufacturing excluded'),
  );
  for (const reference of Object.values(document.references))
    if (!document.assets[reference.assetId])
      softReference(
        diagnostics,
        'unresolved-reference',
        { kind: 'node', id: reference.id },
        'Reference asset 不存在',
      );
  for (const collection of Object.values(document.collections))
    for (const member of collection.members) {
      if (member.kind === 'node' && !document.nodes[member.id])
        softReference(
          diagnostics,
          'unresolved-reference',
          member,
          'Collection Node 不存在',
        );
      if (member.kind === 'datum' && !document.datums[member.id])
        softReference(
          diagnostics,
          'unresolved-reference',
          member,
          'Collection Datum 不存在',
        );
      if (member.kind === 'parameter' && !document.parameters[member.id])
        softReference(
          diagnostics,
          'unresolved-reference',
          member,
          'Collection Parameter 不存在',
        );
      if (member.kind === 'relation' && !document.relations[member.id])
        softReference(
          diagnostics,
          'unresolved-reference',
          member,
          'Collection Relation 不存在',
        );
      if (member.kind === 'program' && !document.programs[member.id])
        softReference(
          diagnostics,
          'unresolved-reference',
          member,
          'Collection Program 不存在',
        );
      if (
        member.kind === 'path' &&
        !findSketch(document, member.sketchId, member.id, 'paths')
      )
        softReference(
          diagnostics,
          'unresolved-reference',
          member,
          'Collection Path 不存在',
        );
      if (
        member.kind === 'vertex' &&
        !findSketch(document, member.sketchId, member.id, 'vertices')
      )
        softReference(
          diagnostics,
          'unresolved-reference',
          member,
          'Collection Vertex 不存在',
        );
      if (
        member.kind === 'edge' &&
        !findSketch(document, member.sketchId, member.id, 'edges')
      )
        softReference(
          diagnostics,
          'unresolved-reference',
          member,
          'Collection Edge 不存在',
        );
      if (
        member.kind === 'edge-end' &&
        !findSketch(document, member.sketchId, member.edgeId, 'edges')
      )
        softReference(
          diagnostics,
          'unresolved-reference',
          member,
          'Collection EdgeEnd 不存在',
        );
      if (member.kind === 'output')
        inspectOutputRef(document, member, 'Collection OutputRef', diagnostics);
    }
  return diagnostics;
}
