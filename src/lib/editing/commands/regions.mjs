import { evaluateProgram } from '../../construction/document-evaluation.mjs';
import {
  outputIdentity,
  proposeAssignmentInheritance,
} from '../../construction/provenance.mjs';
import { effectiveNodeState } from '../../scene/hierarchy.mjs';
import { createCommandIdAllocator } from '../command-ids.mjs';

const clone = (value) => structuredClone(value);
const identity = () => [1, 0, 0, 1, 0, 0];
const portInput = (ref) => ({
  ...clone(ref),
  space: 'local-result',
  transform: identity(),
});
const publishedPort = (ownerNodeId, operatorId, domain) => ({
  kind: 'port',
  ownerNodeId,
  operatorId,
  port: domain,
  domain,
});
const operator = (id, type, name, inputs, params) => ({
  id,
  type,
  name,
  enabled: true,
  inputs,
  params,
});
const selected = (targets) => ({ kind: 'selected', refs: clone(targets) });

const requireCurrentTargets = (document, targets) => {
  if (!Array.isArray(targets)) throw Error('区域目标必须是 OutputRef 数组');
  if (!targets.length) return null;
  if (targets.some((target) => target?.kind !== 'output'))
    throw Error('区域目标必须是 OutputRef');
  const ownerNodeId = targets[0].ownerNodeId;
  if (targets.some((target) => target.ownerNodeId !== ownerNodeId))
    throw Error('一次区域操作只能修改同一部件');
  const node = document.nodes[ownerNodeId];
  if (!node || node.kind !== 'shape') throw Error('区域所属部件不存在');
  if (effectiveNodeState(document, ownerNodeId).locked)
    throw Error('区域所属部件已锁定');
  const identities = targets.map(outputIdentity);
  if (new Set(identities).size !== identities.length)
    throw Error('区域目标不能重复');
  const stage = evaluateProgram(document, ownerNodeId).regions;
  if (stage.status !== 'ready') throw Error('当前部件没有可编辑区域');
  const current = new Map(
    stage.value.regions.map((region) => [outputIdentity(region.ref), region]),
  );
  if (identities.some((key) => !current.has(key)))
    throw Error('区域已失效，请重新选择当前区域');
  const program = document.programs[node.programId];
  if (!program?.outputs.regions) throw Error('当前部件没有已发布区域');
  return { ownerNodeId, program };
};

const requireCutter = (document, ownerNodeId, cutter) => {
  if (cutter?.kind === 'sketch') {
    const sketch = document.sketches[cutter.sketchId];
    if (!sketch || sketch.ownerNodeId !== ownerNodeId)
      throw Error('Sketch cutter 必须属于被编辑部件');
    if (
      cutter.pathIds !== undefined &&
      (!Array.isArray(cutter.pathIds) ||
        cutter.pathIds.some((id) => !Object.hasOwn(sketch.paths, id)))
    )
      throw Error('Sketch cutter 包含不存在的 pathId');
    return clone(cutter);
  }
  if (
    cutter?.kind !== 'port' ||
    cutter.domain !== 'curves' ||
    !['local-result', 'world-result'].includes(cutter.space) ||
    !Array.isArray(cutter.transform) ||
    cutter.transform.length !== 6 ||
    !cutter.transform.every(Number.isFinite)
  )
    throw Error('曲线 PortRef cutter 必须包含显式 frame');
  return clone(cutter);
};

const descendantsForAssignments = (regions, assignments, label) => {
  if (!assignments.length) return new Map();
  const proposal = proposeAssignmentInheritance(regions, assignments);
  if (proposal.conflicts.length)
    throw Error(`${label} 继承存在冲突，未修改文档`);
  if (proposal.unresolved.length)
    throw Error(`${label} 无法映射到新区域，未修改文档`);
  const descendants = new Map(assignments.map((item) => [item.id, []]));
  for (const item of proposal.proposals) {
    if (item.assignmentIds.length !== 1)
      throw Error(`${label} 继承无法唯一确定来源，未修改文档`);
    descendants.get(item.assignmentIds[0])?.push(item.target);
  }
  if ([...descendants.values()].some((refs) => !refs.length))
    throw Error(`${label} 无法映射到新区域，未修改文档`);
  return descendants;
};

const migrateRecordAssignments = (
  records,
  selectedIds,
  regions,
  allocateId,
  label,
  proposalValue,
) => {
  const touched = Object.values(records).filter(
    (item) =>
      item.target?.kind === 'output' &&
      selectedIds.has(outputIdentity(item.target)),
  );
  const proposed = touched.map((item) => ({
    id: item.id,
    target: item.target,
    value: proposalValue(item),
  }));
  const descendants = descendantsForAssignments(regions, proposed, label);
  for (const assignment of touched) {
    delete records[assignment.id];
    descendants.get(assignment.id).forEach((target, index) => {
      const id = index ? allocateId() : assignment.id;
      records[id] = { ...clone(assignment), id, target: clone(target) };
    });
  }
};

const migrateExcluded = (excluded, targets, regions) => {
  const selectedIds = new Set(targets.map(outputIdentity));
  const touched = excluded
    .map((target, index) => ({ target, index }))
    .filter(
      (item) =>
        item.target?.kind === 'output' &&
        selectedIds.has(outputIdentity(item.target)),
    );
  if (!touched.length) return excluded;
  const assignments = touched.map((item) => ({
    id: `excluded:${item.index}`,
    target: item.target,
    value: { excluded: true },
  }));
  const descendants = descendantsForAssignments(
    regions,
    assignments,
    '制造排除项',
  );
  return excluded.flatMap((target, index) => {
    const refs = descendants.get(`excluded:${index}`);
    return refs ? refs.map(clone) : [target];
  });
};

const migrateAssignments = (document, targets, regions, allocateId) => {
  const selectedIds = new Set(targets.map(outputIdentity));
  migrateRecordAssignments(
    document.appearances.overrides,
    selectedIds,
    regions,
    allocateId,
    '外观赋值',
    (item) => item.value,
  );
  migrateRecordAssignments(
    document.reliefDefinitions.overrides,
    selectedIds,
    regions,
    allocateId,
    '浮雕赋值',
    (item) => item.value,
  );
  migrateRecordAssignments(
    document.manufacturing.assignments,
    selectedIds,
    regions,
    allocateId,
    '制造 Part 赋值',
    (item) => ({ partId: item.partId }),
  );
  document.manufacturing.excluded = migrateExcluded(
    document.manufacturing.excluded,
    targets,
    regions,
  );
};

const requireReadyResult = (
  document,
  ownerNodeId,
  message,
  allowEmpty = false,
) => {
  const stage = evaluateProgram(document, ownerNodeId).regions;
  if (stage.status !== 'ready' && !(allowEmpty && stage.status === 'empty')) {
    const detail = stage.diagnostics?.map((item) => item.message).join('；');
    throw Error(`${message}${detail ? `：${detail}` : ''}`);
  }
  return stage;
};

/** Builds and validates a synchronous T12 region-authoring transaction. */
export function createRegionCommand(action) {
  const request = clone(action);
  return (document, { idFactory }) => {
    if (!['partition-regions', 'cut-hole'].includes(request?.kind))
      throw Error(`不支持的区域动作：${request?.kind}`);
    if (!Array.isArray(request.targets))
      throw Error('区域目标必须是 OutputRef 数组');
    if (!request.targets.length) return { document, changedRefs: [] };

    const targets = clone(request.targets);
    const current = requireCurrentTargets(document, targets);
    const cutter = requireCutter(document, current.ownerNodeId, request.cutter);
    const allocateId = createCommandIdAllocator(document, idFactory);
    const oldOutput = portInput(current.program.outputs.regions);
    let cutterInput = cutter;

    if (cutter.kind === 'sketch') {
      const sourceId = allocateId();
      current.program.operators[sourceId] = operator(
        sourceId,
        'source',
        '区域切割线',
        { paths: [cutter] },
        {},
      );
      cutterInput = portInput(
        publishedPort(current.ownerNodeId, sourceId, 'curves'),
      );
    }

    let resultOperator;
    if (request.kind === 'partition-regions') {
      const partitionId = allocateId();
      resultOperator = operator(
        partitionId,
        'partition',
        '分区',
        { input: [oldOutput], cutter: [cutterInput] },
        { scope: selected(targets) },
      );
      current.program.operators[partitionId] = resultOperator;
      current.program.outputs.regions = publishedPort(
        current.ownerNodeId,
        partitionId,
        'regions',
      );
      const proposalStage = requireReadyResult(
        document,
        current.ownerNodeId,
        '分区无法生成有效区域',
      );
      const proposals = proposalStage.value.provenance.filter(
        (item) => item.kind === 'output-contract-proposal',
      );
      if (proposals.length !== 1 || !Array.isArray(proposals[0].members))
        throw Error('分区没有唯一的 outputContract 候选');
      resultOperator.outputContract = {
        version: 1,
        members: clone(proposals[0].members),
      };
    } else {
      const fillId = allocateId();
      current.program.operators[fillId] = operator(
        fillId,
        'fill',
        '孔轮廓',
        { input: [cutterInput] },
        { rule: 'even-odd' },
      );
      const booleanId = allocateId();
      resultOperator = operator(
        booleanId,
        'boolean',
        '挖孔',
        {
          input: [oldOutput],
          operand: [
            portInput(publishedPort(current.ownerNodeId, fillId, 'regions')),
          ],
        },
        { operation: 'difference', scope: selected(targets) },
      );
      current.program.operators[booleanId] = resultOperator;
      current.program.outputs.regions = publishedPort(
        current.ownerNodeId,
        booleanId,
        'regions',
      );
    }

    const finalStage = requireReadyResult(
      document,
      current.ownerNodeId,
      '区域操作无法生成有效结果',
      request.kind === 'cut-hole',
    );
    const selectedIds = new Set(targets.map(outputIdentity));
    const untouched = finalStage.value.regions.filter((region) =>
      selectedIds.has(outputIdentity(region.ref)),
    );
    if (untouched.length)
      throw Error('区域操作仍发布了被替换的旧目标，拒绝提交');
    if (finalStage.status === 'empty') {
      // A deliberate full cut removes these contributions, not the Shape or
      // its source. The transaction history retains every removed assignment.
      for (const records of [
        document.appearances.overrides,
        document.reliefDefinitions.overrides,
        document.manufacturing.assignments,
      ])
        for (const [id, assignment] of Object.entries(records))
          if (selectedIds.has(outputIdentity(assignment.target)))
            delete records[id];
      document.manufacturing.excluded = document.manufacturing.excluded.filter(
        (ref) => !selectedIds.has(outputIdentity(ref)),
      );
    } else
      migrateAssignments(
        document,
        targets,
        finalStage.value.regions,
        allocateId,
      );
    const changedRefs = finalStage.value.regions
      .map((region) => region.ref)
      .filter(
        (ref) =>
          ref.operatorId === resultOperator.id ||
          selectedIds.has(outputIdentity(ref)),
      );
    return { document, changedRefs: clone(changedRefs) };
  };
}
