import { validateDocument } from '../../document/schema.mjs';
import {
  applySketchTransfer,
  planSketchTransfer,
} from '../../geometry/sketch-transfer.mjs';
import { effectiveNodeState } from '../../scene/hierarchy.mjs';
import {
  identityTransform,
  inverseTransform,
  multiplyTransforms,
  worldMatrix,
} from '../../scene/transforms.mjs';

export const SOURCE_TRANSFER_ACTION = 'transfer-source';

const clone = (value) => structuredClone(value);
const compare = (left, right) => left.localeCompare(right);
const stable = (value) => JSON.stringify(value);
const uniqueByKey = (values) => [
  ...new Map(values.map((value) => [value.key, value])).values(),
];

const requireAction = (action) => {
  if (!action || action.kind !== SOURCE_TRANSFER_ACTION)
    throw Error(`源转移 action.kind 必须是 ${SOURCE_TRANSFER_ACTION}`);
  if (action.keepWorld !== true)
    throw Error('源转移必须显式指定 keepWorld: true');
  if (
    typeof action.sourceSketchId !== 'string' ||
    typeof action.targetSketchId !== 'string'
  )
    throw Error('源转移必须指定 sourceSketchId 与 targetSketchId');
  if (
    !Array.isArray(action.pathIds) ||
    !action.pathIds.length ||
    action.pathIds.some((id) => typeof id !== 'string')
  )
    throw Error('源转移必须指定非空 pathIds');
  return {
    kind: SOURCE_TRANSFER_ACTION,
    sourceSketchId: action.sourceSketchId,
    targetSketchId: action.targetSketchId,
    pathIds: [...new Set(action.pathIds)].sort(compare),
    keepWorld: true,
  };
};

const transferMatrix = (document, source, target) =>
  multiplyTransforms(
    inverseTransform(worldMatrix(document, target.ownerNodeId)),
    worldMatrix(document, source.ownerNodeId),
  );

const programMigrations = (document, source, closure) => {
  const moved = new Set(closure.pathIds);
  const allSourcePaths = Object.keys(source.paths).sort(compare);
  const migrations = [];
  const blockers = [];
  for (const program of Object.values(document.programs))
    for (const operator of Object.values(program.operators))
      for (const [port, inputs] of Object.entries(operator.inputs))
        inputs.forEach((input, index) => {
          if (input.kind !== 'sketch' || input.sketchId !== source.id) return;
          const selected = input.pathIds || allSourcePaths;
          const movedPaths = selected.filter((pathId) => moved.has(pathId));
          if (!movedPaths.length) return;
          const remainingPaths = selected.filter(
            (pathId) => !moved.has(pathId),
          );
          const key = `program:${program.id}/operator:${operator.id}/${port}[${index}]`;
          if (operator.type !== 'source' || port !== 'paths') {
            blockers.push({
              kind: 'program-input',
              key,
              message: '只有 Source.paths 输入能自动迁移',
            });
            return;
          }
          if (remainingPaths.length) {
            blockers.push({
              kind: 'mixed-source-input',
              key,
              message: `同一输入混合待转移与保留路径：${remainingPaths.join(', ')}`,
            });
            return;
          }
          migrations.push({
            key,
            programId: program.id,
            operatorId: operator.id,
            port,
            index,
            pathIds: [...movedPaths],
          });
        });
  return { migrations, blockers };
};

/**
 * Returns the exact closure, coordinate transform, consumer rewrites and named
 * blockers before the command mutates a document.
 */
export function inspectSourceTransfer(document, action) {
  validateDocument(document);
  const request = requireAction(action);
  const source = document.sketches[request.sourceSketchId];
  const target = document.sketches[request.targetSketchId];
  if (!source || !target || source.id === target.id)
    throw Error('源和目标必须是不同的现有 Sketch');
  const transform = transferMatrix(document, source, target);
  const plan = planSketchTransfer(document, {
    sourceSketchId: source.id,
    targetSketchId: target.id,
    pathIds: request.pathIds,
    transform,
  });
  const { migrations, blockers: programBlockers } = programMigrations(
    document,
    source,
    plan.closure,
  );
  const blockers = [...programBlockers];
  // Re-expressing a source changes its provenance. Existing authored bindings
  // require a separate explicit rebinding plan, even when coordinates match.
  const affected = new Set(migrations.map((item) => item.operatorId));
  const operators = Object.values(document.programs).flatMap((program) =>
    Object.values(program.operators),
  );
  let expanded = true;
  while (expanded) {
    expanded = false;
    for (const operator of operators) {
      if (affected.has(operator.id)) continue;
      if (
        Object.values(operator.inputs)
          .flat()
          .some(
            (input) => input.kind === 'port' && affected.has(input.operatorId),
          )
      ) {
        affected.add(operator.id);
        expanded = true;
      }
    }
  }
  const protectedRefs = [
    ...Object.values(document.appearances.overrides),
    ...Object.values(document.reliefDefinitions.overrides),
    ...Object.values(document.manufacturing.assignments),
    ...document.manufacturing.excluded.map((target, index) => ({
      id: `exclusion-${index}`,
      target,
    })),
  ];
  for (const assignment of protectedRefs)
    if (
      assignment.target.kind === 'output' &&
      affected.has(assignment.target.operatorId)
    )
      blockers.push({
        kind: 'output-binding',
        key: `assignment:${assignment.id}`,
        message: '此输出已有颜色、厚度或制造绑定，需要明确的输出重绑定计划',
      });
  const inspectRefs = (value, operatorId) => {
    if (!value || typeof value !== 'object') return;
    if (value.kind === 'output' && affected.has(value.operatorId))
      blockers.push({
        kind: 'output-scope',
        key: `operator:${operatorId}`,
        message: '下游任务已选择此来源的区域输出，不能隐式改写',
      });
    Object.values(value).forEach((child) => inspectRefs(child, operatorId));
  };
  for (const operator of operators) {
    inspectRefs(operator.params, operator.id);
    if (affected.has(operator.id) && operator.outputContract)
      blockers.push({
        kind: 'output-contract',
        key: `contract:${operator.id}`,
        message: '此来源参与已绑定的分区输出契约，需要明确重绑定',
      });
  }
  for (const relationId of plan.closure.relationIds) {
    const relation = document.relations[relationId];
    if (relation?.kind !== 'handle-continuity')
      blockers.push({
        kind: 'relation',
        key: `relation:${relationId}`,
        message: `${relation?.kind || 'missing'} 关系尚无安全源转移重表达`,
      });
  }
  for (const impact of plan.externalReferences) {
    if (impact.kind === 'program-input' || impact.kind === 'collection')
      continue;
    blockers.push({
      kind: impact.kind,
      key:
        impact.relationId !== undefined
          ? `relation:${impact.relationId}`
          : `${impact.kind}:${stable(impact.ref)}`,
      message: `${impact.kind} 不能在源转移中隐式改写`,
    });
  }
  for (const [nodeId, label] of [
    [source.ownerNodeId, 'source-owner'],
    [target.ownerNodeId, 'target-owner'],
  ])
    if (effectiveNodeState(document, nodeId).locked)
      blockers.push({
        kind: 'locked-owner',
        key: `node:${nodeId}`,
        message: `${label} 已锁定`,
      });
  const dependencies = [
    `sketch:${source.id}`,
    `sketch:${target.id}`,
    `node:${source.ownerNodeId}:world`,
    `node:${target.ownerNodeId}:world`,
    ...plan.closure.relationIds.map((id) => `relation:${id}`),
    ...migrations.map((item) => `operator:${item.operatorId}`),
    ...plan.externalReferences
      .filter((impact) => impact.kind === 'collection')
      .map((impact) => `collection:${impact.collectionId}`),
  ];
  const namedBlockers = uniqueByKey(blockers).sort((left, right) =>
    compare(left.key, right.key),
  );
  return {
    kind: 'source-transfer-inspection',
    status: namedBlockers.length ? 'blocked' : 'ready',
    request,
    transform,
    closure: clone(plan.closure),
    impacts: clone(plan.externalReferences),
    migrations: clone(migrations),
    dependencies: [...new Set(dependencies)].sort(compare),
    blockers: namedBlockers,
  };
}

const allIds = (document) => {
  const result = new Set([document.id]);
  for (const table of [
    document.nodes,
    document.sketches,
    document.datums,
    document.parameters,
    document.relations,
    document.programs,
    document.appearances.swatches,
    document.appearances.overrides,
    document.reliefDefinitions.overrides,
    document.manufacturing.layers,
    document.manufacturing.parts,
    document.manufacturing.assignments,
    document.assets,
    document.references,
    document.collections,
  ])
    Object.keys(table).forEach((id) => result.add(id));
  for (const sketch of Object.values(document.sketches))
    for (const table of [sketch.vertices, sketch.edges, sketch.paths])
      Object.keys(table).forEach((id) => result.add(id));
  for (const program of Object.values(document.programs))
    Object.keys(program.operators).forEach((id) => result.add(id));
  return result;
};

const allocator = (document, idFactory) => {
  if (typeof idFactory !== 'function') throw Error('源转移需要 idFactory');
  const used = allIds(document);
  return () => {
    for (let attempt = 0; attempt < 1000; attempt++) {
      const id = idFactory();
      if (typeof id === 'string' && id && !used.has(id)) {
        used.add(id);
        return id;
      }
    }
    throw Error('源转移无法分配唯一 Operator ID');
  };
};

const removeMigratedInputs = (document, migrations) => {
  const grouped = new Map();
  for (const migration of migrations) {
    const key = `${migration.programId}\u0000${migration.operatorId}\u0000${migration.port}`;
    const values = grouped.get(key) || [];
    values.push(migration);
    grouped.set(key, values);
  }
  for (const values of grouped.values()) {
    const first = values[0];
    const inputs =
      document.programs[first.programId].operators[first.operatorId].inputs[
        first.port
      ];
    for (const migration of values.slice().sort((a, b) => b.index - a.index))
      inputs.splice(migration.index, 1);
  }
};

const insertMigratedInputs = (document, inspection, allocate) => {
  const source = document.sketches[inspection.request.sourceSketchId];
  const target = document.sketches[inspection.request.targetSketchId];
  const sameOwner = source.ownerNodeId === target.ownerNodeId;
  const targetNode = document.nodes[target.ownerNodeId];
  const targetProgram = document.programs[targetNode.programId];
  const createdRefs = [];
  const grouped = new Map();
  for (const migration of inspection.migrations) {
    const key = `${migration.programId}\u0000${migration.operatorId}\u0000${migration.port}`;
    const values = grouped.get(key) || [];
    values.push(migration);
    grouped.set(key, values);
  }
  for (const values of grouped.values()) {
    const first = values[0];
    const inputs =
      document.programs[first.programId].operators[first.operatorId].inputs[
        first.port
      ];
    for (const migration of values.slice().sort((a, b) => a.index - b.index)) {
      let input;
      if (sameOwner)
        input = {
          kind: 'sketch',
          sketchId: target.id,
          pathIds: [...migration.pathIds],
        };
      else {
        const operatorId = allocate();
        targetProgram.operators[operatorId] = {
          id: operatorId,
          type: 'source',
          name: '转移的线条来源',
          enabled: true,
          inputs: {
            paths: [
              {
                kind: 'sketch',
                sketchId: target.id,
                pathIds: [...migration.pathIds],
              },
            ],
          },
          params: {},
        };
        createdRefs.push({
          kind: 'operator',
          ownerNodeId: target.ownerNodeId,
          id: operatorId,
        });
        input = {
          kind: 'port',
          ownerNodeId: target.ownerNodeId,
          operatorId,
          port: 'curves',
          domain: 'curves',
          space: 'world-result',
          transform: identityTransform(),
        };
      }
      inputs.splice(migration.index, 0, input);
    }
  }
  return createdRefs;
};

export function createSourceTransferCommand(action) {
  const request = clone(action);
  return (document, { idFactory } = {}) => {
    const inspection = inspectSourceTransfer(document, request);
    if (inspection.status !== 'ready')
      throw Error(
        `源转移无法安全保留依赖：${inspection.blockers
          .map((item) => `${item.key}（${item.message}）`)
          .join('；')}`,
      );
    const next = clone(document);
    removeMigratedInputs(next, inspection.migrations);
    const plan = planSketchTransfer(next, {
      sourceSketchId: inspection.request.sourceSketchId,
      targetSketchId: inspection.request.targetSketchId,
      pathIds: inspection.request.pathIds,
      transform: inspection.transform,
    });
    const transferred = applySketchTransfer(next, plan);
    const allocate = allocator(transferred.document, idFactory);
    const createdRefs = insertMigratedInputs(
      transferred.document,
      inspection,
      allocate,
    );
    validateDocument(transferred.document);
    const selected = inspection.request.pathIds.map((id) => ({
      kind: 'path',
      sketchId: inspection.request.targetSketchId,
      id,
    }));
    return {
      document: transferred.document,
      changedRefs: [
        ...transferred.changedRefs,
        ...inspection.migrations.map((item) => ({
          kind: 'operator',
          ownerNodeId:
            transferred.document.programs[item.programId].ownerNodeId,
          id: item.operatorId,
        })),
        ...createdRefs,
      ],
      removedRefs: transferred.removedRefs,
      selectionIntent: {
        scope: 'paths',
        entityRefs: selected,
        activeRef: selected[0] || null,
      },
    };
  };
}
