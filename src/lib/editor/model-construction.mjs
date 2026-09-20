import { evaluateProgram } from '../construction/document-evaluation.mjs';
import { makeOutputRef } from '../construction/provenance.mjs';
import { outputIdentity, sameOutputRef } from '../relief/appearance.mjs';
import { resolveReliefDefinition } from '../relief/resolve.mjs';
import { partForRelief } from '../manufacturing/parts.mjs';
import { childrenOf, effectiveNodeState } from '../scene/hierarchy.mjs';
import { createCommandIdAllocator } from '../editing/command-ids.mjs';
import { createRegionPresentationCommand } from '../editing/commands/region-presentations.mjs';
import { createRegionContribution } from './model-contributions.mjs';

const clone = (value) => structuredClone(value);
const identity = () => [1, 0, 0, 1, 0, 0];
const port = (ownerNodeId, operatorId, domain) => ({
  kind: 'port',
  ownerNodeId,
  operatorId,
  port: domain,
  domain,
});
const input = (value) => ({
  ...clone(value),
  space: 'local-result',
  transform: identity(),
});
const operator = (id, type, name, inputs, params) => ({
  id,
  type,
  name,
  enabled: true,
  inputs,
  params,
});
const isPathRef = (value) =>
  value?.kind === 'path' &&
  typeof value.sketchId === 'string' &&
  typeof value.id === 'string';
const isOutputRef = (value) =>
  value?.kind === 'output' &&
  typeof value.ownerNodeId === 'string' &&
  typeof value.operatorId === 'string' &&
  typeof value.key === 'string';

const indexed = (table, key) =>
  table instanceof Map ? table.get(key) : table?.[key];

const pathRef = (draft, refs, index = 0) => {
  const direct =
    draft.pathRefs?.[index] ||
    (index ? undefined : draft.pathRef) ||
    (index ? undefined : draft.pathRefs?.[index]);
  const legacy = draft.pathIds?.[index] || (index ? undefined : draft.pathId);
  const result = direct || (legacy ? indexed(refs.paths, legacy) : undefined);
  if (!isPathRef(result)) throw Error(`第 ${index + 1} 条来源路径已失效`);
  return clone(result);
};

const regionRef = (draft, refs, name) => {
  const direct = draft[`${name}Ref`];
  const legacy = draft[name] || draft[`${name}Id`];
  const result = direct || (legacy ? indexed(refs.regions, legacy) : undefined);
  if (!isOutputRef(result)) throw Error(`${name} 区域已失效`);
  return clone(result);
};

const writableShape = (document, ownerNodeId) => {
  const node = document.nodes[ownerNodeId];
  if (!node || node.kind !== 'shape') throw Error('来源必须属于现有部件');
  if (effectiveNodeState(document, ownerNodeId).locked)
    throw Error('部件已锁定');
  const program = document.programs[node.programId];
  if (!program) throw Error('部件缺少构造程序');
  return { node, program };
};

const requirePath = (document, ref) => {
  const sketch = document.sketches[ref.sketchId];
  const path = sketch?.paths[ref.id];
  if (!path) throw Error('来源路径不存在');
  writableShape(document, sketch.ownerNodeId);
  return { sketch, path, ownerNodeId: sketch.ownerNodeId };
};

const closed = (sketch, path) => {
  const first = path.edges[0];
  const last = path.edges.at(-1);
  return Boolean(
    first &&
    last &&
    sketch.edges[first.edgeId][
      first.reversed ? 'endVertexId' : 'startVertexId'
    ] ===
      sketch.edges[last.edgeId][
        last.reversed ? 'startVertexId' : 'endVertexId'
      ],
  );
};

const currentRegions = (document, ref) => {
  const { program } = writableShape(document, ref.ownerNodeId);
  if (!program.outputs.regions) throw Error('区域所属部件没有已发布区域');
  const stage = evaluateProgram(document, ref.ownerNodeId).regions;
  if (stage.status !== 'ready') throw Error('区域当前不可求值');
  const region = stage.value.regions.find((item) =>
    sameOutputRef(item.ref, ref),
  );
  if (!region) throw Error('区域已失效');
  return { program, stage, region };
};

const outputSnapshot = (document, owners) =>
  new Set(
    owners.flatMap((ownerNodeId) => {
      const stage = evaluateProgram(document, ownerNodeId).regions;
      return stage.status === 'ready'
        ? stage.value.regions.map((item) => outputIdentity(item.ref))
        : [];
    }),
  );

const candidates = (document, ownerNodeId, before) => {
  const stage = evaluateProgram(document, ownerNodeId).regions;
  if (stage.status !== 'ready')
    throw Error(
      `构造无法求值：${stage.diagnostics.map((item) => item.message).join('；')}`,
    );
  const result = stage.value.regions.filter(
    (item) => !before.has(outputIdentity(item.ref)),
  );
  if (!result.length) throw Error('构造没有产生新的区域');
  return result.map((item) => ({
    outputRef: clone(item.ref),
    geometry: clone(item.geometry),
    diagnostics: clone(stage.diagnostics || []),
  }));
};

const readyRegions = (document, ownerNodeId, label = '区域') => {
  const stage = evaluateProgram(document, ownerNodeId).regions;
  if (stage.status !== 'ready') throw Error(`${label}当前不可求值`);
  return stage.value.regions;
};

const exactRegion = (document, ref, label = '区域') => {
  if (!isOutputRef(ref)) throw Error(`${label}必须是 OutputRef`);
  const region = readyRegions(document, ref.ownerNodeId, label).find((item) =>
    sameOutputRef(item.ref, ref),
  );
  if (!region) throw Error(`${label}已失效`);
  return region;
};

const referenceSource = (ref) => {
  try {
    const key = JSON.parse(ref.key);
    return key?.[0] === 'region-reference' && typeof key[1] === 'string'
      ? { key: key[1], lineage: ref.lineage }
      : null;
  } catch {
    return null;
  }
};

const sameLineage = (left, right) =>
  JSON.stringify(left) === JSON.stringify(right);

const selectedOutput = (document, ownerNodeId, refs, context) => {
  const { program } = writableShape(document, ownerNodeId);
  const before = readyRegions(document, ownerNodeId);
  const byIdentity = new Map(
    before.map((region) => [outputIdentity(region.ref), region]),
  );
  const selected = [
    ...new Map(refs.map((ref) => [outputIdentity(ref), ref])).values(),
  ];
  if (selected.some((ref) => !byIdentity.has(outputIdentity(ref))))
    throw Error('候选区域已失效，不能修改发布输出');
  const allocate = createCommandIdAllocator(document, context.idFactory);
  let selectorId;
  if (selected.length) {
    selectorId = allocate();
    program.operators[selectorId] = operator(
      selectorId,
      'region-reference',
      '保留所选区域',
      { input: [input(program.outputs.regions)] },
      { scope: { kind: 'selected', refs: clone(selected) } },
    );
  } else {
    selectorId = allocate();
    program.operators[selectorId] = operator(
      selectorId,
      'region-collect',
      '清空区域输出',
      { input: [] },
      {},
    );
  }
  program.outputs.regions = port(ownerNodeId, selectorId, 'regions');
  const after = evaluateProgram(document, ownerNodeId).regions;
  if (selected.length && after.status !== 'ready')
    throw Error('所选区域无法求值，未修改引用');
  if (!selected.length && after.status !== 'empty')
    throw Error('清空区域输出失败');
  const mapped = new Map();
  if (selected.length)
    for (const source of selected) {
      const matches = after.value.regions.filter((region) => {
        const origin = referenceSource(region.ref);
        return (
          origin?.key === source.key &&
          sameLineage(origin.lineage, source.lineage)
        );
      });
      if (matches.length !== 1) throw Error('所选区域引用无法唯一映射到新输出');
      mapped.set(outputIdentity(source), [clone(matches[0].ref)]);
    }
  return {
    before: before.map((region) => clone(region.ref)),
    after:
      after.status === 'ready'
        ? after.value.regions.map((region) => clone(region.ref))
        : [],
    mapped,
  };
};

const assignmentTables = (document) => [
  ['外观赋值', document.appearances.overrides],
  ['浮雕赋值', document.reliefDefinitions.overrides],
  ['制造 Part 赋值', document.manufacturing.assignments],
  ...(document.regionPresentations
    ? [['区域展示赋值', document.regionPresentations.overrides]]
    : []),
];

const lostReferences = (document, tracked, mapped, discarded) => {
  const lost = [];
  for (const [label, records] of assignmentTables(document))
    for (const record of Object.values(records))
      if (
        record.target?.kind === 'output' &&
        tracked.has(outputIdentity(record.target)) &&
        !mapped.has(outputIdentity(record.target)) &&
        !discarded.has(outputIdentity(record.target))
      )
        lost.push(label);
  for (const target of document.manufacturing.excluded)
    if (
      target?.kind === 'output' &&
      tracked.has(outputIdentity(target)) &&
      !mapped.has(outputIdentity(target)) &&
      !discarded.has(outputIdentity(target))
    )
      lost.push('制造排除项');
  return [...new Set(lost)];
};

const outputReferenceConsumers = (document, refs) => {
  const targets = new Set(refs.map(outputIdentity));
  const assignments = Object.fromEntries(
    assignmentTables(document).map(([label, records]) => [
      label,
      Object.values(records)
        .filter(
          (record) =>
            record.target?.kind === 'output' &&
            targets.has(outputIdentity(record.target)),
        )
        .map((record) => record.id),
    ]),
  );
  const excluded = document.manufacturing.excluded
    .map((target, index) => ({ target, index }))
    .filter(
      ({ target }) =>
        target?.kind === 'output' && targets.has(outputIdentity(target)),
    )
    .map(({ index }) => index);
  const programScopes = [];
  for (const program of Object.values(document.programs))
    for (const operator of Object.values(program.operators))
      (operator.params?.scope?.refs || []).forEach((ref, index) => {
        if (ref?.kind === 'output' && targets.has(outputIdentity(ref)))
          programScopes.push({
            ownerNodeId: program.ownerNodeId,
            operatorId: operator.id,
            index,
            target: clone(ref),
          });
      });
  const reliefPlacements = [];
  for (const [id, record] of Object.entries(
    document.reliefDefinitions.defaults,
  )) {
    const target = record.placement?.target;
    if (target?.kind === 'output' && targets.has(outputIdentity(target)))
      reliefPlacements.push({ table: 'defaults', id, target: clone(target) });
  }
  for (const [id, record] of Object.entries(
    document.reliefDefinitions.overrides,
  )) {
    const target = record.value.placement?.target;
    if (target?.kind === 'output' && targets.has(outputIdentity(target)))
      reliefPlacements.push({ table: 'overrides', id, target: clone(target) });
  }
  return { assignments, excluded, programScopes, reliefPlacements };
};

/** Read-only dependency manifest for a destructive region operation. */
export function inspectModelRegionDeletion(document, targets) {
  if (!Array.isArray(targets) || !targets.length)
    throw Error('请指定要检查的区域');
  const refs = targets.map((ref) => clone(ref));
  refs.forEach((ref) => exactRegion(document, ref, '待删除区域'));
  return clone({ targets: refs, ...outputReferenceConsumers(document, refs) });
}

const sameConsumerOutput = (left, right) =>
  left.operatorId === right.operatorId &&
  left.port === right.port &&
  sameLineage(left.lineage, right.lineage) &&
  JSON.stringify(left.instances) === JSON.stringify(right.instances);

const migrateOutputConsumers = (
  document,
  tracked,
  mapped,
  discarded,
  preserveConsumerOwners = new Set(),
) => {
  const before = new Map();
  const affectedOwners = new Set();
  const resolve = (target) => {
    const key = outputIdentity(target);
    if (!tracked.has(key)) return null;
    const replacements = mapped.get(key);
    if (replacements?.length === 1) return replacements[0];
    if (replacements?.length > 1)
      throw Error('一个区域引用映射到多个输出，不能自动重绑消费者');
    if (discarded.has(key)) throw Error('仍有作者态消费者引用被丢弃的候选区域');
    throw Error('仍有作者态消费者引用将删除的区域');
  };
  for (const program of Object.values(document.programs))
    if (preserveConsumerOwners.has(program.ownerNodeId)) continue;
    else
      for (const operator of Object.values(program.operators)) {
        const refs = operator.params?.scope?.refs;
        if (!Array.isArray(refs)) continue;
        const sourceOwners = new Set();
        refs.forEach((ref, index) => {
          if (program.ownerNodeId === ref?.ownerNodeId) return;
          const replacement = ref?.kind === 'output' ? resolve(ref) : null;
          if (replacement) {
            if (!before.has(program.ownerNodeId))
              before.set(
                program.ownerNodeId,
                readyRegions(document, program.ownerNodeId).map((region) =>
                  clone(region.ref),
                ),
              );
            affectedOwners.add(program.ownerNodeId);
            sourceOwners.add(ref.ownerNodeId);
            refs[index] = clone(replacement);
          }
        });
        if (!sourceOwners.size) continue;
        for (const inputs of Object.values(operator.inputs || {})) {
          if (!Array.isArray(inputs)) continue;
          inputs.forEach((entry, index) => {
            if (
              entry?.kind !== 'port' ||
              entry.domain !== 'regions' ||
              !sourceOwners.has(entry.ownerNodeId)
            )
              return;
            const source = writableShape(document, entry.ownerNodeId).program;
            if (!source.outputs.regions)
              throw Error('外部区域消费者的来源不再发布 regions');
            inputs[index] = {
              ...clone(source.outputs.regions),
              space: entry.space,
              transform: clone(entry.transform),
            };
          });
        }
      }
  for (const record of Object.values(document.reliefDefinitions.defaults)) {
    const target = record.placement?.target;
    const replacement = target?.kind === 'output' ? resolve(target) : null;
    if (replacement) record.placement.target = clone(replacement);
  }
  for (const record of Object.values(document.reliefDefinitions.overrides)) {
    const target = record.value.placement?.target;
    const replacement = target?.kind === 'output' ? resolve(target) : null;
    if (replacement) record.value.placement.target = clone(replacement);
  }
  return [...affectedOwners].map((ownerNodeId) => {
    const previous = before.get(ownerNodeId) || [];
    const next = readyRegions(document, ownerNodeId).map((region) =>
      clone(region.ref),
    );
    const nextByPrevious = new Map();
    for (const oldRef of previous) {
      const matches = next.filter((newRef) =>
        sameConsumerOutput(oldRef, newRef),
      );
      if (matches.length !== 1)
        throw Error('外部区域消费者输出无法唯一重绑，未修改作者态');
      nextByPrevious.set(outputIdentity(oldRef), [matches[0]]);
    }
    return { previous, mapped: nextByPrevious };
  });
};

const migrateOutputReferences = (
  document,
  {
    trackedRefs,
    mapped,
    discardAssignments = false,
    discardedRefs = [],
    preserveConsumerOwners = [],
  },
  context,
  visited = new Set(),
) => {
  const tracked = new Set(trackedRefs.map(outputIdentity));
  const signature = [...tracked]
    .sort((left, right) => left.localeCompare(right))
    .join('\u0000');
  if (visited.has(signature)) return;
  visited.add(signature);
  const discarded = new Set(discardedRefs.map(outputIdentity));
  const lost = lostReferences(document, tracked, mapped, discarded);
  if (lost.length && !discardAssignments)
    throw Error(`${lost.join('、')}会失去目标；请先重绑或明确丢弃赋值`);
  const downstream = migrateOutputConsumers(
    document,
    tracked,
    mapped,
    discarded,
    new Set(preserveConsumerOwners),
  );
  const allocate = createCommandIdAllocator(document, context.idFactory);
  for (const [, records] of assignmentTables(document)) {
    const next = {};
    for (const record of Object.values(records)) {
      const replacements =
        record.target?.kind === 'output'
          ? mapped.get(outputIdentity(record.target))
          : null;
      if (replacements) {
        replacements.forEach((target, index) => {
          const id = index ? allocate() : record.id;
          next[id] = { ...clone(record), id, target: clone(target) };
        });
      } else if (
        record.target?.kind === 'output' &&
        tracked.has(outputIdentity(record.target))
      ) {
        if (
          !discardAssignments &&
          !discarded.has(outputIdentity(record.target))
        )
          throw Error('区域赋值无法迁移，未修改文档');
      } else next[record.id] = clone(record);
    }
    Object.keys(records).forEach((id) => delete records[id]);
    Object.assign(records, next);
  }
  document.manufacturing.excluded = document.manufacturing.excluded.flatMap(
    (target) => {
      const replacements =
        target?.kind === 'output' ? mapped.get(outputIdentity(target)) : null;
      if (replacements) return replacements.map(clone);
      if (target?.kind === 'output' && tracked.has(outputIdentity(target))) {
        if (!discardAssignments && !discarded.has(outputIdentity(target)))
          throw Error('制造排除项无法迁移，未修改文档');
        return [];
      }
      return [clone(target)];
    },
  );
  for (const change of downstream)
    migrateOutputReferences(
      document,
      {
        trackedRefs: change.previous,
        mapped: change.mapped,
        preserveConsumerOwners,
      },
      context,
      visited,
    );
};

const appendRegionOperator = (
  document,
  ownerNodeId,
  type,
  paths,
  params,
  allocate,
) => {
  const { program } = writableShape(document, ownerNodeId);
  const sourceId = allocate();
  const regionId = allocate();
  program.operators[sourceId] = operator(
    sourceId,
    'source',
    '高级面来源',
    {
      paths: paths.map((ref) => ({
        kind: 'sketch',
        sketchId: ref.sketchId,
        pathIds: [ref.id],
      })),
    },
    {},
  );
  program.operators[regionId] = operator(
    regionId,
    type,
    type === 'fill' ? '轮廓构面' : type === 'stroke' ? '线条加宽' : '两线围面',
    { input: [input(port(ownerNodeId, sourceId, 'curves'))] },
    typeof params === 'function' ? params(sourceId) : params,
  );
  const previous = program.outputs.regions;
  if (previous) {
    const collectId = allocate();
    program.operators[collectId] = operator(
      collectId,
      'region-collect',
      '汇总区域',
      {
        input: [input(previous), input(port(ownerNodeId, regionId, 'regions'))],
      },
      {},
    );
    program.outputs.regions = port(ownerNodeId, collectId, 'regions');
  } else program.outputs.regions = port(ownerNodeId, regionId, 'regions');
  return { sourceId, regionId };
};

const applyPathLike = (document, draft, refs, context) => {
  const first = pathRef(draft, refs);
  const source = requirePath(document, first);
  const kind = draft.kind;
  const paths = kind === 'between' ? [first, pathRef(draft, refs, 1)] : [first];
  if (
    paths.some(
      (item) => requirePath(document, item).ownerNodeId !== source.ownerNodeId,
    )
  )
    throw Error('一个构造只能使用同一部件的来源路径');
  if (kind === 'path' && !closed(source.sketch, source.path) && !draft.close)
    throw Error('开放路径请先闭合，或明确请求直线封口');
  if (kind === 'path')
    appendRegionOperator(
      document,
      source.ownerNodeId,
      closed(source.sketch, source.path) ? 'fill' : 'path',
      paths,
      closed(source.sketch, source.path)
        ? { rule: 'even-odd' }
        : {
            rule: 'even-odd',
            closure: 'straight',
            repair: draft.repair === true,
          },
      createCommandIdAllocator(document, context.idFactory),
    );
  else if (kind === 'stroke') {
    if (!(Number.isFinite(draft.widthMM) && draft.widthMM > 0))
      throw Error('线条加宽需要正 widthMM');
    appendRegionOperator(
      document,
      source.ownerNodeId,
      'stroke',
      paths,
      { widthMM: draft.widthMM },
      createCommandIdAllocator(document, context.idFactory),
    );
  } else if (kind === 'between') {
    appendRegionOperator(
      document,
      source.ownerNodeId,
      'between',
      paths,
      (sourceId) => ({
        curveKeys: paths.map(
          (item, index) => `${item.id}@${sourceId}:${index}`,
        ),
        repair: draft.repair === true,
      }),
      createCommandIdAllocator(document, context.idFactory),
    );
  } else throw Error(`不支持的路径构面类型：${kind}`);
  return source.ownerNodeId;
};

const referenceOutput = (ownerNodeId, operatorId, source) => {
  const instances = [{ operatorId, index: 0 }];
  return makeOutputRef(
    ownerNodeId,
    operatorId,
    'regions',
    JSON.stringify(['region-reference', source.key, instances]),
    source.lineage,
    instances,
  );
};

const applyBoolean = (document, draft, refs, context) => {
  const base = regionRef(draft, refs, 'base');
  const operand = regionRef(draft, refs, 'operand');
  const operation = draft.kind;
  if (!['union', 'difference', 'intersection'].includes(operation))
    throw Error(`不支持的布尔类型：${operation}`);
  const baseState = currentRegions(document, base);
  const operandState = currentRegions(document, operand);
  const allocate = createCommandIdAllocator(document, context.idFactory);
  const nodeId = allocate();
  const programId = allocate();
  const baseReferenceId = allocate();
  const operandReferenceId = allocate();
  const booleanId = allocate();
  const baseReference = referenceOutput(nodeId, baseReferenceId, base);
  document.nodes[nodeId] = {
    id: nodeId,
    kind: 'shape',
    programId,
    name:
      draft.name ||
      (operation === 'union'
        ? '并集构面'
        : operation === 'difference'
          ? '差集构面'
          : '交集构面'),
    parentId: null,
    order: childrenOf(document, null).length,
    pose: { translationMM: [0, 0], rotationRad: 0 },
    visible: true,
    locked: false,
  };
  document.programs[programId] = {
    id: programId,
    ownerNodeId: nodeId,
    operators: {
      [baseReferenceId]: operator(
        baseReferenceId,
        'region-reference',
        '布尔来源 A',
        {
          input: [
            {
              ...clone(baseState.program.outputs.regions),
              space: 'world-result',
              transform: identity(),
            },
          ],
        },
        { scope: { kind: 'selected', refs: [base] } },
      ),
      [operandReferenceId]: operator(
        operandReferenceId,
        'region-reference',
        '布尔来源 B',
        {
          input: [
            {
              ...clone(operandState.program.outputs.regions),
              space: 'world-result',
              transform: identity(),
            },
          ],
        },
        { scope: { kind: 'selected', refs: [operand] } },
      ),
      [booleanId]: operator(
        booleanId,
        'boolean',
        operation === 'union'
          ? '并集'
          : operation === 'difference'
            ? '相减'
            : '交集',
        {
          input: [input(port(nodeId, baseReferenceId, 'regions'))],
          operand: [
            {
              ...input(port(nodeId, operandReferenceId, 'regions')),
              space: 'local-result',
            },
          ],
        },
        { operation, scope: { kind: 'selected', refs: [baseReference] } },
      ),
    },
    outputs: { regions: port(nodeId, booleanId, 'regions') },
  };
  return nodeId;
};

/** Add narrowly-scoped Source branches to each cutter's owning Shape. They are
 * deliberately unpublished: the derived partition consumes their world-result
 * Curve ports while neither source Sketch nor its owner's published regions are
 * rewritten.
 */
const selectedCutterPorts = (document, cutters, allocate) => {
  const groups = new Map();
  const identities = new Set();
  for (const cutter of cutters) {
    const { ownerNodeId } = requirePath(document, cutter);
    const key = `${cutter.sketchId}:${cutter.id}`;
    if (identities.has(key)) throw Error('分区切分路径不能重复');
    identities.add(key);
    const group = groups.get(ownerNodeId) || new Map();
    const paths = group.get(cutter.sketchId) || [];
    paths.push(cutter.id);
    group.set(cutter.sketchId, paths);
    groups.set(ownerNodeId, group);
  }
  return [...groups].map(([ownerNodeId, sketches]) => {
    const { program } = writableShape(document, ownerNodeId);
    const sourceId = allocate();
    program.operators[sourceId] = operator(
      sourceId,
      'source',
      '分区切割线来源',
      {
        paths: [...sketches].map(([sketchId, pathIds]) => ({
          kind: 'sketch',
          sketchId,
          pathIds,
        })),
      },
      {},
    );
    return {
      ...port(ownerNodeId, sourceId, 'curves'),
      space: 'world-result',
      transform: identity(),
    };
  });
};

/** The original advanced split created a derived face. Keep its base published
 * so it can still be used as a bottom plate or receive later authoring state.
 */
const applySplit = (document, draft, refs, context) => {
  const base = regionRef(draft, refs, 'base');
  const cutters = draft.pathRefs?.length
    ? draft.pathRefs.map(clone)
    : (draft.pathIds || []).map((_, index) => pathRef(draft, refs, index));
  if (!cutters.length) throw Error('分区需要至少一条切分路径');
  if (
    draft.joinMM !== undefined &&
    !(Number.isFinite(draft.joinMM) && draft.joinMM >= 0)
  )
    throw Error('分区接边距离必须是非负有限毫米数');
  const baseState = currentRegions(document, base);
  const allocate = createCommandIdAllocator(document, context.idFactory);
  const nodeId = allocate();
  const programId = allocate();
  const baseReferenceId = allocate();
  const cutterPorts = selectedCutterPorts(document, cutters, allocate);
  const collectId = cutterPorts.length > 1 ? allocate() : null;
  const partitionId = allocate();
  const baseReference = referenceOutput(nodeId, baseReferenceId, base);
  document.nodes[nodeId] = {
    id: nodeId,
    kind: 'shape',
    programId,
    name: draft.name || '分区构面',
    parentId: null,
    order: childrenOf(document, null).length,
    pose: { translationMM: [0, 0], rotationRad: 0 },
    visible: true,
    locked: false,
  };
  const operators = {
    [baseReferenceId]: operator(
      baseReferenceId,
      'region-reference',
      '分区底面',
      {
        input: [
          {
            ...clone(baseState.program.outputs.regions),
            space: 'world-result',
            transform: identity(),
          },
        ],
      },
      { scope: { kind: 'selected', refs: [base] } },
    ),
  };
  if (collectId)
    operators[collectId] = operator(
      collectId,
      'curve-collect',
      '汇总分区切割线',
      { input: cutterPorts },
      {},
    );
  operators[partitionId] = operator(
    partitionId,
    'partition',
    '样条分区',
    {
      input: [input(port(nodeId, baseReferenceId, 'regions'))],
      cutter: [
        collectId
          ? input(port(nodeId, collectId, 'curves'))
          : clone(cutterPorts[0]),
      ],
    },
    {
      scope: { kind: 'selected', refs: [baseReference] },
      ...(draft.joinMM === undefined
        ? {}
        : {
            endpointJoin: {
              toleranceMM: draft.joinMM,
              disabled: [],
              cohorts: cutters.map((cutter) => [cutter.id]),
            },
          }),
    },
  );
  document.programs[programId] = {
    id: programId,
    ownerNodeId: nodeId,
    operators,
    outputs: { regions: port(nodeId, partitionId, 'regions') },
  };
  return nodeId;
};

const apply = (document, draft, refs, context) => {
  if (!draft || typeof draft !== 'object') throw Error('构造草案必须是对象');
  if (['path', 'stroke', 'between'].includes(draft.kind))
    return applyPathLike(document, draft, refs, context);
  if (draft.kind === 'split') return applySplit(document, draft, refs, context);
  if (['union', 'difference', 'intersection'].includes(draft.kind))
    return applyBoolean(document, draft, refs, context);
  throw Error(`该旧面板构造尚不能安全映射到 Program：${draft.kind}`);
};

/**
 * Compile an original ModelWorkspace draft into a pure DocumentV4 transaction.
 * `refs.paths` and `refs.regions` map its projected legacy IDs to stable PathRef
 * and OutputRef identities. No legacy recipe or sampled preview geometry enters
 * the resulting document.
 */
export function createModelConstructionCommand(draft, refs = {}) {
  const request = clone(draft);
  const identities = clone(refs);
  return (document, context) => {
    const before = outputSnapshot(
      document,
      Object.keys(document.nodes).filter(
        (id) => document.nodes[id].kind === 'shape',
      ),
    );
    const ownerNodeId = apply(document, request, identities, context);
    const created = candidates(document, ownerNodeId, before);
    return {
      document,
      changedRefs: created.map((item) => item.outputRef),
      selectionIntent: {
        scope: 'regions',
        entityRefs: created.map((item) => item.outputRef),
        activeRef: created[0]?.outputRef,
      },
    };
  };
}

const outputRegionsByOwner = (document) =>
  new Map(
    Object.keys(document.nodes)
      .filter((id) => document.nodes[id].kind === 'shape')
      .flatMap((ownerNodeId) => {
        const stage = evaluateProgram(document, ownerNodeId).regions;
        return stage.status === 'ready'
          ? [
              [
                ownerNodeId,
                stage.value.regions.map((region) => clone(region.ref)),
              ],
            ]
          : [];
      }),
  );

const selectedCandidateIndices = (items, indices) => {
  if (!Array.isArray(indices) || !indices.length)
    throw Error('请至少保留一个候选区域');
  const selected = [...new Set(indices)];
  if (
    selected.some(
      (index) => !Number.isInteger(index) || index < 0 || index >= items.length,
    )
  )
    throw Error('候选区域选择已失效');
  return selected;
};

const resolveOutputRef = (value, refs, label) => {
  const ref = typeof value === 'string' ? indexed(refs.regions, value) : value;
  if (!isOutputRef(ref)) throw Error(`${label}必须是当前 OutputRef`);
  return clone(ref);
};

const commandResult = (document, refs) => ({
  document,
  changedRefs: clone(refs),
  selectionIntent: {
    scope: 'regions',
    entityRefs: clone(refs),
    activeRef: refs[0] ? clone(refs[0]) : undefined,
  },
});

const namedCommandResult = (document, refs, name, context) => {
  if (name === undefined) return commandResult(document, refs);
  if (typeof name !== 'string' || !name.trim()) throw Error('区域名称不能为空');
  if (refs.length !== 1) throw Error('区域名称只能用于唯一的提交输出');
  createRegionPresentationCommand({
    kind: 'set-region-presentation',
    target: refs[0],
    value: { name: name.trim() },
  })(document, context);
  return commandResult(document, refs);
};

/**
 * Finalize a preview without compiling its draft again. `prepared.document`
 * already owns the preview's Program/operator IDs; this function only adds an
 * explicit publishing selector and migrates exact OutputRef authoring state.
 */
export function finalizePreparedModelConstruction(
  prepared,
  request = {},
  context,
) {
  if (!prepared?.document || !Array.isArray(prepared.changedRefs))
    throw Error('构造预览缺少规范文档或候选输出');
  const document = clone(prepared.document);
  const candidates = clone(prepared.candidateRefs || prepared.changedRefs);
  if (!candidates.length || candidates.some((ref) => !isOutputRef(ref)))
    throw Error('构造预览候选输出无效');
  const ownerNodeId = prepared.ownerNodeId || candidates[0].ownerNodeId;
  if (candidates.some((ref) => ref.ownerNodeId !== ownerNodeId))
    throw Error('构造预览不能跨部件提交候选区域');
  candidates.forEach((ref) => exactRegion(document, ref, '构造候选'));
  const before = clone(prepared.beforeRefs);
  if (!Array.isArray(before) || before.some((ref) => !isOutputRef(ref)))
    throw Error('构造预览缺少提交前的 OutputRef 快照');
  const rebindable = clone(prepared.rebindableRefs || before);
  if (!Array.isArray(rebindable) || rebindable.some((ref) => !isOutputRef(ref)))
    throw Error('构造预览缺少可重绑的 OutputRef 快照');
  const indices = selectedCandidateIndices(
    candidates,
    request.indices || candidates.map((_, index) => index),
  );
  const selected = indices.map((index) => candidates[index]);
  const replaceTarget =
    request.replaceTarget === undefined
      ? null
      : resolveOutputRef(request.replaceTarget, {}, '待重绑区域');
  if (replaceTarget) {
    exactRegion(document, replaceTarget, '待重绑区域');
    if (!rebindable.some((ref) => sameOutputRef(ref, replaceTarget)))
      throw Error('待重绑区域不属于此构造预览');
    if (selected.length !== 1) throw Error('重新绑定必须精确选择一个候选区域');
  }
  if (!replaceTarget && selected.length === candidates.length)
    return namedCommandResult(document, selected, request.name, context);
  const initialIds = new Set(before.map(outputIdentity));
  const retained = readyRegions(document, ownerNodeId)
    .map((region) => region.ref)
    .filter(
      (ref) =>
        !sameOutputRef(ref, replaceTarget) &&
        (initialIds.has(outputIdentity(ref)) ||
          selected.some((candidate) => sameOutputRef(candidate, ref))),
    );
  const selector = selectedOutput(document, ownerNodeId, retained, context);
  const committed = selected.flatMap(
    (ref) => selector.mapped.get(outputIdentity(ref)) || [],
  );
  if (committed.length !== selected.length)
    throw Error('候选区域无法映射到提交输出');
  if (replaceTarget)
    selector.mapped.set(outputIdentity(replaceTarget), committed);
  migrateOutputReferences(
    document,
    {
      trackedRefs: [
        ...before,
        ...candidates,
        ...(replaceTarget ? [replaceTarget] : []),
      ],
      mapped: selector.mapped,
      preserveConsumerOwners: replaceTarget ? [ownerNodeId] : [],
      discardedRefs: candidates.filter(
        (ref) => !selected.some((candidate) => sameOutputRef(candidate, ref)),
      ),
    },
    context,
  );
  return namedCommandResult(document, committed, request.name, context);
}

/**
 * Compile a construction while publishing only explicitly selected candidates.
 * The selection is expressed through a RegionReference operator, so no sampled
 * geometry becomes a new source of truth. Existing assignment targets are
 * migrated to their new OutputRef identities; a vanished target is an error.
 */
export function createModelConstructionSubsetCommand(
  draft,
  refs = {},
  candidateIndices,
  options = {},
) {
  const request = clone(draft);
  const identities = clone(refs);
  const requestedIndices = clone(candidateIndices);
  const requestedOptions = clone(options);
  return (document, context) => {
    const byOwner = outputRegionsByOwner(document);
    const before = outputSnapshot(
      document,
      Object.keys(document.nodes).filter(
        (id) => document.nodes[id].kind === 'shape',
      ),
    );
    const ownerNodeId = apply(document, request, identities, context);
    const created = candidates(document, ownerNodeId, before);
    return finalizePreparedModelConstruction(
      {
        document,
        changedRefs: created.map((item) => item.outputRef),
        candidateRefs: created.map((item) => item.outputRef),
        ownerNodeId,
        beforeRefs: byOwner.get(ownerNodeId) || [],
        rebindableRefs: [...byOwner.values()].flat(),
      },
      { indices: requestedIndices, name: requestedOptions.name },
      context,
    );
  };
}

/** Replace one published advanced region with one selected construction output.
 * The old region's authored assignments migrate only to that new output.
 */
export function createModelConstructionRebindCommand(
  draft,
  refs = {},
  target,
  candidateIndices,
  options = {},
) {
  const request = clone(draft);
  const identities = clone(refs);
  const oldTarget = resolveOutputRef(target, identities, '待重绑区域');
  const requestedIndices = clone(candidateIndices);
  const requestedOptions = clone(options);
  return (document, context) => {
    exactRegion(document, oldTarget, '待重绑区域');
    const byOwner = outputRegionsByOwner(document);
    const before = outputSnapshot(
      document,
      Object.keys(document.nodes).filter(
        (id) => document.nodes[id].kind === 'shape',
      ),
    );
    const ownerNodeId = apply(document, request, identities, context);
    const initial = byOwner.get(ownerNodeId) || [];
    const rebindable = [...byOwner.values()].flat();
    if (!rebindable.some((ref) => sameOutputRef(ref, oldTarget)))
      throw Error('待重绑区域已失效');
    const created = candidates(document, ownerNodeId, before);
    return finalizePreparedModelConstruction(
      {
        document,
        changedRefs: created.map((item) => item.outputRef),
        candidateRefs: created.map((item) => item.outputRef),
        ownerNodeId,
        beforeRefs: initial,
        rebindableRefs: rebindable,
      },
      {
        indices: requestedIndices,
        replaceTarget: oldTarget,
        name: requestedOptions.name,
      },
      context,
    );
  };
}

/** Remove published regions while retaining the originating Sketch and Program.
 * Referenced assignments are rejected unless the caller explicitly discards them.
 */
export function createModelRegionDeletionCommand(targets, options = {}) {
  const requested = clone(targets);
  const discardAssignments = options?.discardAssignments === true;
  return (document, context) => {
    if (!Array.isArray(requested) || !requested.length)
      throw Error('请指定要删除的区域');
    const refs = requested.map((ref) => clone(ref));
    refs.forEach((ref) => exactRegion(document, ref, '待删除区域'));
    const ownerNodeId = refs[0].ownerNodeId;
    if (refs.some((ref) => ref.ownerNodeId !== ownerNodeId))
      throw Error('一次删除只能处理同一部件的区域');
    const before = readyRegions(document, ownerNodeId).map((region) =>
      clone(region.ref),
    );
    const deleted = new Set(refs.map(outputIdentity));
    const selector = selectedOutput(
      document,
      ownerNodeId,
      before.filter((ref) => !deleted.has(outputIdentity(ref))),
      context,
    );
    migrateOutputReferences(
      document,
      {
        trackedRefs: before,
        mapped: selector.mapped,
        discardAssignments,
      },
      context,
    );
    return commandResult(document, selector.after);
  };
}

const rebindFirstRelief = (document, oldTarget, nextSource, context) => {
  const assignments = Object.values(
    document.reliefDefinitions.overrides,
  ).filter((record) => sameOutputRef(record.target, oldTarget));
  if (assignments.length > 1)
    throw Error('普通区域存在冲突的体块作者态，无法重绑');
  const original = assignments[0];
  const resolved = resolveReliefDefinition(
    document,
    oldTarget.ownerNodeId,
    oldTarget,
  );
  if (resolved.status !== 'ready' || !resolved.value.enabled)
    throw Error('普通区域重绑需要已启用的体块作者态');
  const value = clone(resolved.value);
  const partId = partForRelief(document, { ref: oldTarget });
  const contribution = createRegionContribution(
    document,
    nextSource,
    value,
    { partId },
    context,
  );
  const replacement = contribution.target;
  const nextRelief = Object.values(
    contribution.document.reliefDefinitions.overrides,
  ).filter((record) => sameOutputRef(record.target, replacement));
  if (nextRelief.length !== 1) throw Error('新独立体块缺少唯一的浮雕作者态');
  nextRelief[0].value = {
    ...value,
    ...(value.placement?.kind === 'attached' &&
    value.placement.target?.kind === 'output' &&
    sameOutputRef(value.placement.target, oldTarget)
      ? {
          placement: { ...value.placement, target: clone(replacement) },
        }
      : {}),
  };
  if (original?.name !== undefined) nextRelief[0].name = original.name;
  delete nextRelief[0].suppressed;
  const originalId =
    original?.id || createCommandIdAllocator(document, context.idFactory)();
  document.reliefDefinitions.overrides[originalId] = {
    ...original,
    id: originalId,
    target: clone(oldTarget),
    value: { ...clone(original?.value), enabled: false },
    suppressed: true,
  };
  return commandResult(document, [replacement]);
};

/** Retarget one independently-authored relief consumer without changing any
 * assignment on the old source Shape. Its consumer OutputRef keeps all of its
 * own relief, appearance, manufacturing and presentation authoring state.
 */
export function createModelReliefRebindCommand(oldRef, newRef) {
  const oldTarget = clone(oldRef);
  const nextSource = clone(newRef);
  return (document, context) => {
    exactRegion(document, oldTarget, '体块');
    exactRegion(document, nextSource, '新来源区域');
    const { program } = writableShape(document, oldTarget.ownerNodeId);
    const operatorId = program.outputs.regions?.operatorId;
    const consumer = program.operators[operatorId];
    if (
      !consumer ||
      consumer.type !== 'region-reference' ||
      !consumer.enabled ||
      consumer.inputs.input?.length !== 1 ||
      consumer.params?.scope?.kind !== 'selected' ||
      consumer.params.scope.refs?.length !== 1
    )
      return rebindFirstRelief(document, oldTarget, nextSource, context);
    if (oldTarget.ownerNodeId === nextSource.ownerNodeId)
      throw Error('独立体块不能引用自身的区域输出');
    const sourceProgram = writableShape(
      document,
      nextSource.ownerNodeId,
    ).program;
    if (!sourceProgram.outputs.regions) throw Error('新来源部件没有已发布区域');
    consumer.inputs.input = [
      {
        ...clone(sourceProgram.outputs.regions),
        space: 'world-result',
        transform: identity(),
      },
    ];
    consumer.params = {
      scope: { kind: 'selected', refs: [clone(nextSource)] },
    };
    const output = readyRegions(
      document,
      oldTarget.ownerNodeId,
      '重绑后的体块',
    );
    if (output.length !== 1) throw Error('重绑后的独立体块必须产生唯一区域');
    const replacement = clone(output[0].ref);
    migrateOutputReferences(
      document,
      {
        trackedRefs: [oldTarget],
        mapped: new Map([[outputIdentity(oldTarget), [replacement]]]),
      },
      context,
    );
    return commandResult(document, [replacement]);
  };
}

/** Evaluate the exact transaction against a clone for an asynchronous UI preview. */
export function previewModelConstruction(
  document,
  draft,
  refs = {},
  options = {},
) {
  const beforeByOwner = outputRegionsByOwner(document);
  const preview = clone(document);
  const idFactory = options.idFactory || (() => crypto.randomUUID());
  const command = createModelConstructionCommand(draft, refs);
  const result = command(preview, { idFactory, ...options });
  const ownerNodeId = result.changedRefs[0]?.ownerNodeId;
  const stages = new Map(
    [...new Set(result.changedRefs.map((ref) => ref.ownerNodeId))].map(
      (ownerNodeId) => [
        ownerNodeId,
        evaluateProgram(preview, ownerNodeId).regions,
      ],
    ),
  );
  const created = result.changedRefs.map((ref) => {
    const stage = stages.get(ref.ownerNodeId);
    return stage.value.regions.find((region) => sameOutputRef(region.ref, ref));
  });
  const diagnostics = [...stages.values()].flatMap(
    (stage) => stage.diagnostics || [],
  );
  return {
    document: preview,
    candidates: created.map((region) => ({
      outputRef: clone(region.ref),
      geometry: clone(region.geometry),
    })),
    changedRefs: clone(result.changedRefs),
    candidateRefs: clone(result.changedRefs),
    // These come directly from the prepared Program evaluation. The UI may
    // project them, but must not reconstruct endpoint joins from geometry.
    diagnostics: clone(diagnostics),
    ownerNodeId,
    beforeRefs: clone(beforeByOwner.get(ownerNodeId) || []),
    rebindableRefs: clone([...beforeByOwner.values()].flat()),
    command,
  };
}
