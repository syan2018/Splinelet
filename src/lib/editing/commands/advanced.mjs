import {
  defaultConstructionRegistry,
  evaluateProgram,
} from '../../construction/document-evaluation.mjs';
import {
  outputIdentity,
  proposeAssignmentInheritance,
} from '../../construction/provenance.mjs';
import { sameOutputRef } from '../../relief/appearance.mjs';
import {
  childrenOf,
  effectiveNodeState,
  reparentNodes,
  transformNodes,
} from '../../scene/hierarchy.mjs';
import {
  copyNodes,
  ownedEntities,
  planNodeDeletion,
} from '../../scene/ownership.mjs';
import { planNodeRebase } from '../../scene/rebase.mjs';
import { identityTransform } from '../../scene/transforms.mjs';
import {
  isCanonicalRegionOutputKey,
  remapCanonicalRegionOutputReference,
  remapPartitionOperator,
} from '../../construction/operators/regions/partition-identity.mjs';

const clone = (value) => structuredClone(value);

export const ADVANCED_ACTIONS = Object.freeze({
  repeatCurves: 'repeat-curves',
  mirrorCurves: 'mirror-curves',
  connectBoundaries: 'connect-boundaries',
  fillCurves: 'fill-curves',
  repeatPattern: 'repeat-pattern',
  referenceSource: 'reference-source',
  cutReferenceRegions: 'cut-reference-regions',
  setOperator: 'set-operator',
  rotateNodes: 'rotate-nodes',
  reparentNodes: 'reparent-nodes',
  rebaseNode: 'rebase-node',
  deleteNodes: 'delete-nodes',
  copyNodes: 'copy-nodes',
  setManufacturingPart: 'set-manufacturing-part',
  setManufacturingExcluded: 'set-manufacturing-excluded',
  setManufacturingLayer: 'set-manufacturing-layer',
});
const nodeRef = (id) => ({ kind: 'node', id });
const vec = (value) =>
  Array.isArray(value) && value.length === 2 && value.every(Number.isFinite);
const portIdentity = (ref) =>
  JSON.stringify([
    ref?.kind,
    ref?.ownerNodeId,
    ref?.operatorId,
    ref?.port,
    ref?.domain,
  ]);
const inputPort = (
  ref,
  space = 'local-result',
  transform = identityTransform(),
) => ({
  ...clone(ref),
  space,
  transform: clone(transform),
});
const outputPort = (ownerNodeId, operatorId, domain) => ({
  kind: 'port',
  ownerNodeId,
  operatorId,
  port: domain,
  domain,
});
const operator = (id, type, name, input, params) => ({
  id,
  type,
  name,
  enabled: true,
  inputs: { input: [input] },
  params: clone(params),
});

const collectIds = (value, result = new Set(), seen = new Set()) => {
  if (!value || typeof value !== 'object' || seen.has(value)) return result;
  seen.add(value);
  if (typeof value.id === 'string') result.add(value.id);
  for (const child of Object.values(value)) collectIds(child, result, seen);
  return result;
};
const allocator = (document, idFactory) => {
  if (typeof idFactory !== 'function') throw Error('idFactory 必须是函数');
  const ids = collectIds(document);
  return () => {
    const id = idFactory();
    if (typeof id !== 'string' || !id.trim() || ids.has(id))
      throw Error('idFactory 返回了无效或重复 ID');
    ids.add(id);
    return id;
  };
};

const writable = (document, id) => {
  if (!document.nodes[id]) throw Error(`场景节点不存在：${id}`);
  if (effectiveNodeState(document, id).locked) throw Error('场景节点已锁定');
  return document.nodes[id];
};
const writableNodes = (document, nodeIds, includeDescendants = false) => {
  if (!Array.isArray(nodeIds)) throw Error('nodeIds 必须是数组');
  const ids = includeDescendants
    ? [...ownedEntities(document, nodeIds).nodes]
    : [...new Set(nodeIds)];
  ids.forEach((id) => writable(document, id));
};
const shapeProgram = (document, ownerNodeId) => {
  const node = writable(document, ownerNodeId);
  if (node.kind !== 'shape') throw Error('构造命令只能修改 Shape');
  return document.programs[node.programId];
};
const currentPort = (document, ownerNodeId, domain) => {
  const program = shapeProgram(document, ownerNodeId);
  const port = program.outputs[domain];
  if (!port) throw Error(`Shape 没有已发布 ${domain} 输出`);
  const stage = evaluateProgram(document, ownerNodeId)[domain];
  if (!['ready', 'empty'].includes(stage.status))
    throw Error(`当前 ${domain} 输出不可用`);
  return { program, port };
};

const appendCurveOperator = (document, request, type, params, allocate) => {
  const { program, port } = currentPort(
    document,
    request.ownerNodeId,
    'curves',
  );
  const id = allocate();
  program.operators[id] = operator(
    id,
    type,
    request.name || type,
    inputPort(port),
    params,
  );
  program.outputs.curves = outputPort(request.ownerNodeId, id, 'curves');
  const evaluated = evaluateProgram(document, request.ownerNodeId);
  const stage = evaluated.curves;
  if (!['ready', 'empty'].includes(stage.status))
    throw Error(
      `${type} 无法生成曲线：${stage.diagnostics
        .map((item) => item.message)
        .join('；')}`,
    );
  if (
    type === 'join' &&
    stage.diagnostics.some((item) =>
      ['invalid-join', 'join-selector-empty', 'join-gap'].includes(item.code),
    )
  )
    throw Error(
      `连接边界失败：${stage.diagnostics.map((item) => item.message).join('；')}`,
    );
  return { document, changedRefs: [nodeRef(request.ownerNodeId)] };
};

const outputAssignmentsForOwner = (document, ownerNodeId) =>
  [
    ...Object.values(document.appearances.overrides),
    ...Object.values(document.reliefDefinitions.overrides),
    ...Object.values(document.manufacturing.assignments),
    ...document.manufacturing.excluded.map((target) => ({ target })),
  ].filter(
    (item) =>
      item.target?.kind === 'output' && item.target.ownerNodeId === ownerNodeId,
  );
const assertRegionPublishSafe = (document, ownerNodeId) => {
  const program = document.programs[document.nodes[ownerNodeId].programId];
  if (!program.outputs.regions) return;
  const assignments = outputAssignmentsForOwner(document, ownerNodeId);
  if (!assignments.length) return;
  const stage = evaluateProgram(document, ownerNodeId).regions;
  if (!['ready', 'empty'].includes(stage.status))
    throw Error('当前区域不可求值且存在输出赋值，拒绝替换发布端口');
  const live = new Set(
    (stage.value?.regions || []).map((region) => outputIdentity(region.ref)),
  );
  if (assignments.some((item) => live.has(outputIdentity(item.target))))
    throw Error('当前已发布区域存在赋值；Fill 不能默默丢弃这些引用');
};
const appendFill = (document, ownerNodeId, name, allocate) => {
  const { program, port } = currentPort(document, ownerNodeId, 'curves');
  assertRegionPublishSafe(document, ownerNodeId);
  const id = allocate();
  program.operators[id] = operator(
    id,
    'fill',
    name || 'Fill',
    inputPort(port),
    { rule: 'even-odd' },
  );
  program.outputs.regions = outputPort(ownerNodeId, id, 'regions');
  // Fill's ready, empty and blocked states are all persistent repair states.
  evaluateProgram(document, ownerNodeId);
  return { document, changedRefs: [nodeRef(ownerNodeId)] };
};

const repeatPattern = (document, request, allocate) => {
  const { program, port } = currentPort(
    document,
    request.ownerNodeId,
    'curves',
  );
  assertRegionPublishSafe(document, request.ownerNodeId);
  let previous = inputPort(port);
  let mirrorId = null;
  if (request.mirror !== undefined && request.mirror !== false) {
    if (
      !request.mirror ||
      typeof request.mirror !== 'object' ||
      !Number.isFinite(request.mirror.angleRad)
    )
      throw Error('repeat-pattern mirror 必须明确提供 angleRad');
    mirrorId = allocate();
    program.operators[mirrorId] = operator(
      mirrorId,
      'curve-mirror',
      '镜像',
      previous,
      { center: request.center, angleRad: request.mirror.angleRad },
    );
    previous = inputPort(outputPort(request.ownerNodeId, mirrorId, 'curves'));
  }
  const arrayId = allocate();
  program.operators[arrayId] = operator(
    arrayId,
    'curve-array',
    '重复',
    previous,
    {
      center: request.center,
      angleRad: request.angleRad,
      count: request.count,
    },
  );
  const joinId = allocate();
  if (!Array.isArray(request.connections))
    throw Error('repeat-pattern connections 必须是数组');
  const connections = request.connections.map((connection) => ({
    a: patternEndpoint(connection?.a, arrayId, mirrorId),
    b: patternEndpoint(connection?.b, arrayId, mirrorId),
  }));
  program.operators[joinId] = operator(
    joinId,
    'join',
    '连接边界',
    inputPort(outputPort(request.ownerNodeId, arrayId, 'curves')),
    { connections },
  );
  const fillId = allocate();
  program.operators[fillId] = operator(
    fillId,
    'fill',
    '填充图案',
    inputPort(outputPort(request.ownerNodeId, joinId, 'curves')),
    { rule: 'even-odd' },
  );
  program.outputs.curves = outputPort(request.ownerNodeId, joinId, 'curves');
  program.outputs.regions = outputPort(request.ownerNodeId, fillId, 'regions');
  const evaluated = evaluateProgram(document, request.ownerNodeId);
  if (!['ready', 'empty'].includes(evaluated.curves.status))
    throw Error(
      `repeat-pattern 曲线链失败：${evaluated.curves.diagnostics
        .map((item) => item.message)
        .join('；')}`,
    );
  if (
    evaluated.curves.diagnostics.some((item) =>
      ['invalid-join', 'join-selector-empty', 'join-gap'].includes(item.code),
    )
  )
    throw Error(
      `repeat-pattern 连接失败：${evaluated.curves.diagnostics
        .map((item) => item.message)
        .join('；')}`,
    );
  return { document, changedRefs: [nodeRef(request.ownerNodeId)] };
};

const patternEndpoint = (endpoint, arrayId, mirrorId) => {
  if (
    !endpoint?.edgeEnd ||
    (!['each', 'next', 'previous'].includes(endpoint.index) &&
      !Number.isInteger(endpoint.index))
  )
    throw Error('repeat-pattern endpoint 需要 edgeEnd 和明确 index');
  if (endpoint.mirrorIndex !== undefined && mirrorId === null)
    throw Error('没有 mirror 时不能指定 mirrorIndex');
  if (
    endpoint.mirrorIndex !== undefined &&
    (!Number.isInteger(endpoint.mirrorIndex) ||
      ![0, 1].includes(endpoint.mirrorIndex))
  )
    throw Error('mirrorIndex 必须是 0 或 1');
  return {
    edgeEnd: clone(endpoint.edgeEnd),
    selector: {
      operatorId: arrayId,
      index: endpoint.index,
      wrap: endpoint.wrap ?? true,
    },
    ...(endpoint.mirrorIndex === undefined
      ? {}
      : {
          instances: [{ operatorId: mirrorId, index: endpoint.mirrorIndex }],
        }),
  };
};

const createReferenceShape = (document, request, allocate) => {
  const sourceNode = document.nodes[request.source?.ownerNodeId];
  if (!sourceNode || sourceNode.kind !== 'shape')
    throw Error('reference-source 需要现有 Shape 的发布端口');
  if (!['curves', 'regions'].includes(request.source.domain))
    throw Error('reference-source domain 必须是 curves 或 regions');
  const sourceProgram = document.programs[sourceNode.programId];
  const published = sourceProgram.outputs[request.source.domain];
  if (!published || portIdentity(published) !== portIdentity(request.source))
    throw Error('reference-source 必须引用当前已发布端口');
  const sourceStage = evaluateProgram(document, sourceNode.id)[
    request.source.domain
  ];
  if (!['ready', 'empty'].includes(sourceStage.status))
    throw Error('reference-source 来源当前不可用');
  if (!['local-result', 'world-result'].includes(request.space))
    throw Error('reference-source 需要明确 local-result 或 world-result');
  const transform = request.transform ?? identityTransform();
  if (
    !Array.isArray(transform) ||
    transform.length !== 6 ||
    !transform.every(Number.isFinite)
  )
    throw Error('reference-source transform 必须是 Affine2D');
  const parentId = request.parentId ?? null;
  if (parentId !== null) {
    const parent = writable(document, parentId);
    if (parent.kind !== 'group')
      throw Error('reference-source 父级必须是 Group');
  }
  const shapeId = allocate();
  const programId = allocate();
  const operatorId = allocate();
  document.nodes[shapeId] = {
    id: shapeId,
    kind: 'shape',
    programId,
    name: request.name || '引用部件',
    parentId,
    order: childrenOf(document, parentId).length,
    pose: clone(request.pose || { translationMM: [0, 0], rotationRad: 0 }),
    visible: true,
    locked: false,
  };
  const domain = request.source.domain;
  const type = domain === 'curves' ? 'curve-reference' : 'region-reference';
  document.programs[programId] = {
    id: programId,
    ownerNodeId: shapeId,
    operators: {
      [operatorId]: operator(
        operatorId,
        type,
        request.name || type,
        inputPort(request.source, request.space, transform),
        {},
      ),
    },
    outputs: { [domain]: outputPort(shapeId, operatorId, domain) },
  };
  const stage = evaluateProgram(document, shapeId)[domain];
  if (!['ready', 'empty'].includes(stage.status))
    throw Error(
      `reference-source 无法求值：${stage.diagnostics.map((item) => item.message).join('；')}`,
    );
  return {
    document,
    changedRefs: [nodeRef(shapeId)],
    selectionIntent: {
      scope: 'objects',
      entityRefs: [nodeRef(shapeId)],
      activeRef: nodeRef(shapeId),
    },
  };
};

const mapId = (id, idMap) => idMap[id] || id;
const remapRawString = (value, idMap) => {
  let result = value;
  for (const [before, after] of Object.entries(idMap))
    result = result.replaceAll(JSON.stringify(before), JSON.stringify(after));
  return result;
};
const remapEncoded = (value, idMap) => {
  if (typeof value !== 'string') return value;
  if (idMap[value]) return idMap[value];
  if (!['[', '{'].includes(value[0])) return remapRawString(value, idMap);
  try {
    return JSON.stringify(remapStructured(JSON.parse(value), idMap));
  } catch {
    return remapRawString(value, idMap);
  }
};
function remapStructured(value, idMap) {
  if (typeof value === 'string') return remapEncoded(value, idMap);
  if (Array.isArray(value))
    return value.map((item) => remapStructured(item, idMap));
  if (!value || typeof value !== 'object') return value;
  if (value.kind === 'output') return remapOutputReference(value, idMap);
  const result = {};
  for (const [key, child] of Object.entries(value))
    result[key] =
      ['id', 'ownerNodeId', 'operatorId', 'sketchId', 'edgeId'].includes(key) &&
      typeof child === 'string'
        ? mapId(child, idMap)
        : remapStructured(child, idMap);
  return result;
}
function remapOutputReference(ref, idMap) {
  return isCanonicalRegionOutputKey(ref.key)
    ? remapCanonicalRegionOutputReference(ref, idMap)
    : {
        ...clone(ref),
        ownerNodeId: mapId(ref.ownerNodeId, idMap),
        operatorId: mapId(ref.operatorId, idMap),
        key: remapEncoded(ref.key, idMap),
        lineage: ref.lineage.map((token) => remapEncoded(token, idMap)),
        instances: ref.instances.map((instance) => ({
          ...instance,
          operatorId: mapId(instance.operatorId, idMap),
        })),
      };
}
const copyOperator = (value, { idMap }) => {
  const specification = defaultConstructionRegistry.get(value.type);
  if (!specification) throw Error(`未知算子不可复制：${value.type}`);
  if (specification.copy) return specification.copy(value, { idMap });
  const copied = clone(value);
  copied.params = remapStructured(copied.params, idMap);
  if (value.type === 'partition') return remapPartitionOperator(copied, idMap);
  if (copied.outputContract)
    copied.outputContract.members = copied.outputContract.members.map(
      (member) => ({
        ...member,
        key: remapEncoded(member.key, idMap),
        lineage: member.lineage.map((token) => remapEncoded(token, idMap)),
        ...(member.topology
          ? { topology: remapEncoded(member.topology, idMap) }
          : {}),
      }),
    );
  return copied;
};

const currentTarget = (document, target) => {
  if (target?.kind === 'node') {
    const node = writable(document, target.id);
    if (node.kind !== 'shape') throw Error('制造目标 Node 必须是 Shape');
    return;
  }
  if (target?.kind !== 'output') throw Error('制造目标必须是 TargetRef');
  writable(document, target.ownerNodeId);
  const stage = evaluateProgram(document, target.ownerNodeId).regions;
  if (
    stage.status !== 'ready' ||
    !stage.value.regions.some((region) => sameOutputRef(region.ref, target))
  )
    throw Error('制造目标区域已失效，请重新选择');
};
const sameTarget = (left, right) =>
  left.kind === 'node'
    ? right.kind === 'node' && left.id === right.id
    : right.kind === 'output' && outputIdentity(left) === outputIdentity(right);
const matchingAssignments = (records, target) =>
  Object.values(records).filter((item) => sameTarget(item.target, target));

const currentRegionTargets = (document, targets) => {
  if (!Array.isArray(targets)) throw Error('targets 必须是 OutputRef 数组');
  if (!targets.length) return null;
  if (targets.some((target) => target?.kind !== 'output'))
    throw Error('cut-reference-regions targets 必须是 OutputRef');
  const ownerNodeId = targets[0].ownerNodeId;
  if (targets.some((target) => target.ownerNodeId !== ownerNodeId))
    throw Error('cut-reference-regions targets 必须属于同一 Shape');
  const program = shapeProgram(document, ownerNodeId);
  if (!program.outputs.regions) throw Error('目标 Shape 没有已发布 regions');
  const identities = targets.map(outputIdentity);
  if (new Set(identities).size !== identities.length)
    throw Error('cut-reference-regions targets 不能重复');
  const stage = evaluateProgram(document, ownerNodeId).regions;
  if (stage.status !== 'ready') throw Error('目标 Shape 当前没有可切割区域');
  const current = new Set(
    stage.value.regions.map((region) => outputIdentity(region.ref)),
  );
  if (identities.some((identity) => !current.has(identity)))
    throw Error('cut-reference-regions target 已失效');
  return { ownerNodeId, program };
};
const currentPublishedRegionPort = (document, source) => {
  const node = document.nodes[source?.ownerNodeId];
  if (!node || node.kind !== 'shape' || source.kind !== 'port')
    throw Error('sourceRegionPort 必须来自现有 Shape');
  const program = document.programs[node.programId];
  if (
    source.domain !== 'regions' ||
    !program.outputs.regions ||
    portIdentity(source) !== portIdentity(program.outputs.regions)
  )
    throw Error('sourceRegionPort 必须是当前已发布 regions 端口');
  const stage = evaluateProgram(document, node.id).regions;
  if (!['ready', 'empty'].includes(stage.status))
    throw Error('sourceRegionPort 当前不可用');
};
const inheritedTargets = (
  regions,
  assignments,
  label,
  { allowMissing = false } = {},
) => {
  if (!assignments.length) return new Map();
  const proposal = proposeAssignmentInheritance(regions, assignments);
  if (proposal.conflicts.length) throw Error(`${label} 继承冲突，拒绝引用切割`);
  if (proposal.unresolved.length && !allowMissing)
    throw Error(`${label} 没有唯一后代，拒绝引用切割`);
  const byAssignment = new Map(assignments.map((item) => [item.id, []]));
  for (const item of proposal.proposals) {
    if (item.assignmentIds.length !== 1)
      throw Error(`${label} 无法唯一确定来源，拒绝引用切割`);
    byAssignment.get(item.assignmentIds[0]).push(item.target);
  }
  if (!allowMissing && [...byAssignment.values()].some((refs) => !refs.length))
    throw Error(`${label} 没有唯一后代，拒绝引用切割`);
  return byAssignment;
};
const migrateCutRecords = (
  records,
  selectedIds,
  regions,
  allocate,
  label,
  value,
) => {
  const touched = Object.values(records).filter(
    (item) =>
      item.target?.kind === 'output' &&
      selectedIds.has(outputIdentity(item.target)),
  );
  const proposals = touched.map((item) => ({
    id: item.id,
    target: item.target,
    value: value(item),
  }));
  const descendants = inheritedTargets(regions, proposals, label, {
    allowMissing: true,
  });
  for (const item of touched) {
    delete records[item.id];
    descendants.get(item.id).forEach((target, index) => {
      const id = index ? allocate() : item.id;
      records[id] = { ...clone(item), id, target: clone(target) };
    });
  }
};
const migrateReferenceCutAssignments = (
  document,
  targets,
  regions,
  allocate,
) => {
  const selectedIds = new Set(targets.map(outputIdentity));
  migrateCutRecords(
    document.appearances.overrides,
    selectedIds,
    regions,
    allocate,
    '外观赋值',
    (item) => item.value,
  );
  migrateCutRecords(
    document.reliefDefinitions.overrides,
    selectedIds,
    regions,
    allocate,
    '浮雕赋值',
    (item) => item.value,
  );
  migrateCutRecords(
    document.manufacturing.assignments,
    selectedIds,
    regions,
    allocate,
    '制造 Part 赋值',
    (item) => ({ partId: item.partId }),
  );
  const touchedExcluded = document.manufacturing.excluded
    .map((target, index) => ({ target, index }))
    .filter(
      (item) =>
        item.target.kind === 'output' &&
        selectedIds.has(outputIdentity(item.target)),
    );
  const excludedProposals = touchedExcluded.map((item) => ({
    id: `excluded:${item.index}`,
    target: item.target,
    value: { excluded: true },
  }));
  const excludedDescendants = inheritedTargets(
    regions,
    excludedProposals,
    '制造排除项',
    { allowMissing: true },
  );
  document.manufacturing.excluded = document.manufacturing.excluded.flatMap(
    (target, index) => {
      const refs = excludedDescendants.get(`excluded:${index}`);
      return refs ? refs.map(clone) : [target];
    },
  );
};
const cutReferenceRegions = (document, request, allocate) => {
  if (!Array.isArray(request.targets))
    throw Error('cut-reference-regions targets 必须是数组');
  if (!request.targets.length) return { document, changedRefs: [] };
  const targets = clone(request.targets);
  const target = currentRegionTargets(document, targets);
  currentPublishedRegionPort(document, request.sourceRegionPort);
  if (!['local-result', 'world-result'].includes(request.space))
    throw Error('cut-reference-regions 需要明确引用空间');
  const transform = request.transform ?? identityTransform();
  if (
    !Array.isArray(transform) ||
    transform.length !== 6 ||
    !transform.every(Number.isFinite)
  )
    throw Error('cut-reference-regions transform 必须是 Affine2D');
  const id = allocate();
  target.program.operators[id] = {
    id,
    type: 'boolean',
    name: request.name || '引用区域切割',
    enabled: true,
    inputs: {
      input: [inputPort(target.program.outputs.regions)],
      operand: [inputPort(request.sourceRegionPort, request.space, transform)],
    },
    params: {
      operation: 'difference',
      scope: { kind: 'selected', refs: clone(targets) },
    },
  };
  target.program.outputs.regions = outputPort(
    target.ownerNodeId,
    id,
    'regions',
  );
  const stage = evaluateProgram(document, target.ownerNodeId).regions;
  if (!['ready', 'empty'].includes(stage.status))
    throw Error(
      `引用区域切割失败：${stage.diagnostics
        .map((item) => item.message)
        .join('；')}`,
    );
  migrateReferenceCutAssignments(
    document,
    targets,
    stage.value.regions,
    allocate,
  );
  return {
    document,
    changedRefs: stage.value.regions
      .filter((region) => region.ref.operatorId === id)
      .map((region) => clone(region.ref)),
  };
};

const setManufacturingPart = (document, request, allocate) => {
  currentTarget(document, request.target);
  if (
    request.partId !== null &&
    !Object.hasOwn(document.manufacturing.parts, request.partId)
  )
    throw Error('制造 Part 不存在');
  const matches = matchingAssignments(
    document.manufacturing.assignments,
    request.target,
  );
  if (matches.length > 1) throw Error('制造目标存在冲突 Part 赋值');
  if (request.partId === null) {
    if (matches[0]) delete document.manufacturing.assignments[matches[0].id];
  } else {
    const id = matches[0]?.id || allocate();
    document.manufacturing.assignments[id] = {
      id,
      target: clone(request.target),
      partId: request.partId,
    };
  }
  return { document, changedRefs: [clone(request.target)] };
};
const setManufacturingExcluded = (document, request) => {
  currentTarget(document, request.target);
  if (typeof request.excluded !== 'boolean')
    throw Error('excluded 必须是布尔值');
  const matches = document.manufacturing.excluded.filter((target) =>
    sameTarget(target, request.target),
  );
  if (matches.length > 1) throw Error('制造目标存在重复排除项');
  document.manufacturing.excluded = document.manufacturing.excluded.filter(
    (target) => !sameTarget(target, request.target),
  );
  if (request.excluded)
    document.manufacturing.excluded.push(clone(request.target));
  return { document, changedRefs: [clone(request.target)] };
};
const setManufacturingLayer = (document, request, allocate) => {
  if (request.target?.kind !== 'output')
    throw Error('逐区域制造层需要 OutputRef target');
  currentTarget(document, request.target);
  if (!Object.hasOwn(document.manufacturing.layers, request.layerId))
    throw Error('制造 Layer 不存在');
  if (!Number.isFinite(request.offsetMM ?? 0))
    throw Error('offsetMM 必须是有限数');
  const matches = Object.values(document.reliefDefinitions.overrides).filter(
    (item) => sameOutputRef(item.target, request.target),
  );
  if (matches.length > 1) throw Error('制造目标存在冲突 Relief 赋值');
  const id = matches[0]?.id || allocate();
  document.reliefDefinitions.overrides[id] = {
    id,
    target: clone(request.target),
    value: {
      ...clone(matches[0]?.value || {}),
      placement: {
        kind: 'layer',
        layerId: request.layerId,
        offsetMM: request.offsetMM ?? 0,
      },
    },
  };
  return { document, changedRefs: [clone(request.target)] };
};

/**
 * Advanced action contract:
 * - repeat-curves { ownerNodeId, center, angleRad, count, name? }
 * - mirror-curves { ownerNodeId, center, angleRad, name? }
 * - connect-boundaries { ownerNodeId, connections, name? }
 * - fill-curves { ownerNodeId, name? }
 * - repeat-pattern { ownerNodeId, center, angleRad, count, connections,
 *     mirror?:false|{angleRad} }; each connection endpoint is
 *     { edgeEnd, index:number|'each'|'next'|'previous', wrap?, mirrorIndex? }.
 *     Generated mirror/array operator IDs are deliberately not accepted.
 * - reference-source { source:PortRef, space, transform?, name?, parentId?, pose? }
 * - cut-reference-regions { targets, sourceRegionPort, space, transform?, name? }
 * - set-operator { ownerNodeId, operatorId, name?, enabled?, params? }
 * - rotate-nodes { nodeIds, angleRad, centerMM }
 * - reparent-nodes { nodeIds, parentId, keepWorld?, index? }
 * - rebase-node { nodeId, pose }
 * - delete-nodes { nodeIds }
 * - copy-nodes { nodeIds }
 * - set-manufacturing-part { target, partId:string|null }
 * - set-manufacturing-excluded { target, excluded }
 * - set-manufacturing-layer { target:OutputRef, layerId, offsetMM? }
 */
export function createAdvancedCommand(action) {
  const request = clone(action);
  return (document, { idFactory }) => {
    const allocate = allocator(document, idFactory);
    if (request?.kind === ADVANCED_ACTIONS.repeatCurves)
      return appendCurveOperator(
        document,
        request,
        'curve-array',
        {
          center: request.center,
          angleRad: request.angleRad,
          count: request.count,
        },
        allocate,
      );
    if (request?.kind === ADVANCED_ACTIONS.mirrorCurves)
      return appendCurveOperator(
        document,
        request,
        'curve-mirror',
        { center: request.center, angleRad: request.angleRad },
        allocate,
      );
    if (request?.kind === ADVANCED_ACTIONS.connectBoundaries)
      return appendCurveOperator(
        document,
        request,
        'join',
        { connections: request.connections },
        allocate,
      );
    if (request?.kind === ADVANCED_ACTIONS.fillCurves)
      return appendFill(document, request.ownerNodeId, request.name, allocate);
    if (request?.kind === ADVANCED_ACTIONS.repeatPattern)
      return repeatPattern(document, request, allocate);
    if (request?.kind === ADVANCED_ACTIONS.referenceSource)
      return createReferenceShape(document, request, allocate);
    if (request?.kind === ADVANCED_ACTIONS.cutReferenceRegions)
      return cutReferenceRegions(document, request, allocate);
    if (request?.kind === ADVANCED_ACTIONS.setOperator) {
      const program = shapeProgram(document, request.ownerNodeId);
      const current = program.operators[request.operatorId];
      if (!current) throw Error('算子不存在或不属于指定 Shape');
      if (current.authoring) throw Error('请先完成或继续绘制这条线');
      if (
        request.enabled === undefined &&
        request.params === undefined &&
        request.name === undefined
      )
        throw Error('set-operator 需要 name、enabled 或 params');
      if (
        request.name !== undefined &&
        (typeof request.name !== 'string' || !request.name.trim())
      )
        throw Error('算子名称不能为空');
      if (request.enabled !== undefined && typeof request.enabled !== 'boolean')
        throw Error('enabled 必须是布尔值');
      if (
        request.params !== undefined &&
        (!request.params ||
          typeof request.params !== 'object' ||
          Array.isArray(request.params))
      )
        throw Error('params 必须是 JSON object');
      if (request.enabled !== undefined) current.enabled = request.enabled;
      if (request.name !== undefined) current.name = request.name;
      if (request.params !== undefined) current.params = clone(request.params);
      return { document, changedRefs: [nodeRef(request.ownerNodeId)] };
    }
    if (request?.kind === ADVANCED_ACTIONS.rotateNodes) {
      writableNodes(document, request.nodeIds);
      if (!vec(request.centerMM) || !Number.isFinite(request.angleRad))
        throw Error('rotate-nodes 需要有限 centerMM 和 angleRad');
      const [x, y] = request.centerMM;
      const cosine = Math.cos(request.angleRad);
      const sine = Math.sin(request.angleRad);
      const matrix = [
        cosine,
        sine,
        -sine,
        cosine,
        x - cosine * x + sine * y,
        y - sine * x - cosine * y,
      ];
      return {
        document: transformNodes(document, request.nodeIds, matrix),
        changedRefs: [...new Set(request.nodeIds)].map(nodeRef),
      };
    }
    if (request?.kind === ADVANCED_ACTIONS.reparentNodes) {
      writableNodes(document, request.nodeIds);
      if (request.parentId !== null) writable(document, request.parentId);
      return {
        document: reparentNodes(document, request.nodeIds, request.parentId, {
          keepWorld: request.keepWorld ?? true,
          ...(request.index === undefined ? {} : { index: request.index }),
        }),
        changedRefs: [...new Set(request.nodeIds)].map(nodeRef),
      };
    }
    if (request?.kind === ADVANCED_ACTIONS.rebaseNode) {
      writable(document, request.nodeId);
      return planNodeRebase(document, request.nodeId, request.pose, {
        rebaseOperator: (value, context) => {
          const specification = defaultConstructionRegistry.get(value.type);
          if (!specification?.rebase)
            throw Error(`算子 ${value.id} 缺少安全坐标重表达访问器`);
          return specification.rebase(value, context);
        },
      });
    }
    if (request?.kind === ADVANCED_ACTIONS.deleteNodes) {
      writableNodes(document, request.nodeIds, true);
      const result = planNodeDeletion(document, request.nodeIds);
      return {
        document: result.document,
        changedRefs: request.nodeIds.map(nodeRef),
      };
    }
    if (request?.kind === ADVANCED_ACTIONS.copyNodes) {
      writableNodes(document, request.nodeIds, true);
      const result = copyNodes(document, request.nodeIds, {
        idFactory: allocate,
        copyOperator,
        remapOutputReference,
      });
      return {
        document: result.document,
        changedRefs: result.roots.map(nodeRef),
        selectionIntent: {
          scope: 'objects',
          entityRefs: result.roots.map(nodeRef),
          activeRef: result.roots[0] ? nodeRef(result.roots[0]) : undefined,
        },
      };
    }
    if (request?.kind === ADVANCED_ACTIONS.setManufacturingPart)
      return setManufacturingPart(document, request, allocate);
    if (request?.kind === ADVANCED_ACTIONS.setManufacturingExcluded)
      return setManufacturingExcluded(document, request);
    if (request?.kind === ADVANCED_ACTIONS.setManufacturingLayer)
      return setManufacturingLayer(document, request, allocate);
    throw Error(`不支持的高级动作：${request?.kind}`);
  };
}
