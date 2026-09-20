import {
  defaultConstructionRegistry,
  evaluateProgram,
} from '../../construction/document-evaluation.mjs';
import { outputIdentity } from '../../construction/provenance.mjs';
import { effectiveNodeState } from '../../scene/hierarchy.mjs';

const clone = (value) => structuredClone(value);
const identity = () => [1, 0, 0, 1, 0, 0];
const port = (ownerNodeId, operatorId, domain) => ({
  kind: 'port',
  ownerNodeId,
  operatorId,
  port: domain,
  domain,
});
const samePort = (left, right) =>
  left?.kind === 'port' &&
  right?.kind === 'port' &&
  left.ownerNodeId === right.ownerNodeId &&
  left.operatorId === right.operatorId &&
  left.port === right.port &&
  left.domain === right.domain;
const retarget = (reference, ownerNodeId, operatorId, domain) => ({
  space: 'local-result',
  transform: identity(),
  ...clone(reference),
  ...port(ownerNodeId, operatorId, domain),
});
const input = (operator, domain) => {
  const refs = operator?.inputs?.input;
  return refs?.length === 1 &&
    refs[0].kind === 'port' &&
    refs[0].domain === domain
    ? refs[0]
    : null;
};
const consumers = (program, value) =>
  Object.values(program.operators).flatMap((operator) =>
    Object.entries(operator.inputs || {}).flatMap(([name, references]) =>
      references.flatMap((reference, index) =>
        samePort(reference, value)
          ? [{ operator, name, index, reference }]
          : [],
      ),
    ),
  );
const outputRefs = (document, ownerNodeId) =>
  [
    ...Object.values(document.appearances.overrides),
    ...Object.values(document.reliefDefinitions.overrides),
    ...Object.values(document.manufacturing.assignments),
    ...Object.values(document.regionPresentations?.overrides || {}),
    ...document.manufacturing.excluded.map((target) => ({ target })),
  ]
    .filter(
      (item) =>
        item.target?.kind === 'output' &&
        item.target.ownerNodeId === ownerNodeId,
    )
    .map((item) => item.target);

const ownerProgram = (document, ownerNodeId) => {
  const owner = document.nodes[ownerNodeId];
  const program = document.programs[owner?.programId];
  if (!owner || owner.kind !== 'shape' || !program)
    return { error: '修改器不属于当前部件' };
  if (effectiveNodeState(document, ownerNodeId).locked)
    return { error: '部件已锁定' };
  return { owner, program };
};

const sameDomain = (operator) => {
  const specification = defaultConstructionRegistry.get(operator?.type);
  const inputDefinition = specification?.inputPorts?.input;
  if (
    !inputDefinition ||
    inputDefinition.min !== 1 ||
    inputDefinition.max !== 1
  )
    return null;
  const outputs = Object.entries(specification.outputPorts || {}).filter(
    ([, definition]) => definition.domain === inputDefinition.domain,
  );
  if (outputs.length !== 1) return null;
  const [outputName] = outputs[0];
  return outputName === inputDefinition.domain ? inputDefinition.domain : null;
};

const editable = (operator) => {
  if (!operator)
    return { enabled: false, reason: '已经位于此部件的同域链起点' };
  if (operator.authoring)
    return { enabled: false, reason: '请先完成或继续绘制这条线' };
  if (operator.params?.scope?.kind === 'selected')
    return {
      enabled: false,
      reason: '此步骤使用精确区域作用范围，不能安全重接',
    };
  const domain = sameDomain(operator);
  if (!domain || !input(operator, domain))
    return {
      enabled: false,
      reason: '此步骤不是可旁路的单输入同域链',
    };
  return { enabled: true, reason: null, domain };
};

const traceTail = (program, ownerNodeId, operator, domain) => {
  const seen = new Set();
  let current = operator,
    currentDomain = domain,
    crossedFill = false;
  while (current) {
    if (seen.has(current.id))
      return { enabled: false, reason: 'Program 链形成循环' };
    seen.add(current.id);
    if (current.params?.scope?.kind === 'selected')
      return {
        enabled: false,
        reason: '下游含精确区域作用范围，不能安全重接',
      };
    const out = port(ownerNodeId, current.id, currentDomain);
    const next = consumers(program, out);
    if (next.length > 1)
      return { enabled: false, reason: 'Program 存在分叉，不能隐式重接' };
    if (!next.length) {
      if (!samePort(program.outputs[currentDomain], out))
        return {
          enabled: false,
          reason: '步骤未处于唯一已发布链',
        };
      return { enabled: true, reason: null };
    }
    const link = next[0];
    if (link.name !== 'input' || link.index !== 0)
      return {
        enabled: false,
        reason: 'Program 存在跨端口下游，不能隐式重接',
      };
    const nextDomain = sameDomain(link.operator);
    if (nextDomain === currentDomain) {
      current = link.operator;
      continue;
    }
    if (
      !crossedFill &&
      currentDomain === 'curves' &&
      link.operator.type === 'fill' &&
      input(link.operator, 'curves')
    ) {
      crossedFill = true;
      current = link.operator;
      currentDomain = 'regions';
      continue;
    }
    return { enabled: false, reason: 'Program 存在跨域下游，不能隐式重接' };
  }
  return { enabled: false, reason: 'Program 链无有效输出' };
};

const structureAnalysis = (document, ownerNodeId, operatorId) => {
  const owned = ownerProgram(document, ownerNodeId);
  if (owned.error) return { enabled: false, reason: owned.error };
  const operator = owned.program.operators[operatorId];
  if (!operator) return { enabled: false, reason: '修改器不属于当前部件' };
  const state = editable(operator);
  if (!state.enabled) return state;
  const tail = traceTail(owned.program, ownerNodeId, operator, state.domain);
  if (!tail.enabled) return tail;
  return {
    enabled: true,
    reason: null,
    owner: owned.owner,
    program: owned.program,
    operator,
    domain: state.domain,
  };
};

export function linearProgramCapability(
  document,
  ownerNodeId,
  operatorId,
  action,
  direction,
) {
  const analysis = structureAnalysis(document, ownerNodeId, operatorId);
  if (!analysis.enabled) return analysis;
  if (action === 'remove') return { enabled: true, reason: null };
  if (action !== 'move' || ![1, -1].includes(direction))
    return { enabled: false, reason: '修改器移动方向无效' };
  const current = analysis.operator;
  let adjacent;
  if (direction === 1) {
    const next = consumers(
      analysis.program,
      port(ownerNodeId, current.id, analysis.domain),
    );
    if (next.length !== 1 || next[0].name !== 'input')
      return { enabled: false, reason: '已经位于此同域链末端' };
    adjacent = next[0].operator;
  } else {
    const prior = input(current, analysis.domain);
    if (prior.ownerNodeId !== ownerNodeId)
      return { enabled: false, reason: '不能跨部件调整构造步骤顺序' };
    adjacent = analysis.program.operators[prior.operatorId];
  }
  const adjacentState = editable(adjacent);
  if (!adjacentState.enabled || adjacentState.domain !== analysis.domain)
    return {
      enabled: false,
      reason: adjacentState.reason || '不能跨越 Fill 或其他域边界调整顺序',
    };
  const first = direction === 1 ? current : adjacent;
  const firstConsumers = consumers(
    analysis.program,
    port(ownerNodeId, first.id, analysis.domain),
  );
  if (
    firstConsumers.length !== 1 ||
    firstConsumers[0].operator.id !==
      (direction === 1 ? adjacent.id : current.id) ||
    firstConsumers[0].name !== 'input'
  )
    return { enabled: false, reason: '相邻步骤不是唯一线性同域链' };
  return { enabled: true, reason: null };
}

export const programModifierCapabilities = (
  document,
  ownerNodeId,
  operatorId,
) => ({
  moveUp: linearProgramCapability(
    document,
    ownerNodeId,
    operatorId,
    'move',
    -1,
  ),
  moveDown: linearProgramCapability(
    document,
    ownerNodeId,
    operatorId,
    'move',
    1,
  ),
  remove: linearProgramCapability(document, ownerNodeId, operatorId, 'remove'),
});

const ancestorOperators = (program, reference, result = new Set()) => {
  if (reference?.kind !== 'port') return result;
  const operator = program.operators[reference.operatorId];
  if (!operator || result.has(operator.id)) return result;
  result.add(operator.id);
  for (const references of Object.values(operator.inputs || {}))
    for (const item of references) ancestorOperators(program, item, result);
  return result;
};

const analyzeCurveInsertion = (document, ownerNodeId) => {
  const owned = ownerProgram(document, ownerNodeId);
  if (owned.error) return { enabled: false, reason: owned.error };
  const { program } = owned;
  let insertion,
    fill = null;
  if (program.outputs.regions) {
    const ancestors = ancestorOperators(program, program.outputs.regions);
    const fills = [...ancestors]
      .map((id) => program.operators[id])
      .filter((operator) => operator.type === 'fill');
    if (fills.length !== 1)
      return {
        enabled: false,
        reason: '已发布区域没有唯一 Fill，无法确定曲线插入点',
      };
    fill = fills[0];
    insertion = input(fill, 'curves');
    if (!insertion) return { enabled: false, reason: 'Fill 没有唯一曲线输入' };
    const uses = consumers(program, insertion);
    if (
      uses.length !== 1 ||
      uses[0].operator.id !== fill.id ||
      uses[0].name !== 'input'
    )
      return { enabled: false, reason: 'Fill 曲线来源存在分叉' };
  } else {
    insertion = program.outputs.curves;
    if (!insertion) return { enabled: false, reason: '部件没有已发布曲线输出' };
    if (consumers(program, insertion).length)
      return { enabled: false, reason: '已发布曲线存在下游分叉' };
  }
  const seen = new Set();
  let reference = insertion;
  while (reference?.kind === 'port') {
    const operator = program.operators[reference.operatorId];
    if (!operator || seen.has(operator.id))
      return { enabled: false, reason: '曲线链缺失或形成循环' };
    seen.add(operator.id);
    if (operator.authoring)
      return { enabled: false, reason: '请先完成或继续绘制这条线' };
    if (operator.type === 'source') break;
    const domain = sameDomain(operator);
    if (domain !== 'curves')
      return { enabled: false, reason: '曲线链包含跨域或多输入步骤' };
    const prior = input(operator, 'curves');
    if (!prior) return { enabled: false, reason: '曲线链不是唯一线性输入' };
    const uses = consumers(program, prior);
    if (
      uses.length !== 1 ||
      uses[0].operator.id !== operator.id ||
      uses[0].name !== 'input'
    )
      return { enabled: false, reason: '曲线链存在分叉' };
    reference = prior;
  }
  const stage = evaluateProgram(document, ownerNodeId);
  const published = fill ? stage.regions : stage.curves;
  if (!['ready', 'empty'].includes(published.status))
    return { enabled: false, reason: '当前已发布构造结果不可用' };
  return {
    enabled: true,
    reason: null,
    owner: owned.owner,
    program,
    insertion,
    fill,
  };
};

export const curveModifierAddCapability = (document, ownerNodeId) => {
  const analysis = analyzeCurveInsertion(document, ownerNodeId);
  return { enabled: analysis.enabled, reason: analysis.reason };
};

const validateAssignedOutputs = (document, ownerNodeId, assigned) => {
  if (!assigned.length) return;
  const stage = evaluateProgram(document, ownerNodeId).regions;
  if (stage.status !== 'ready')
    throw Error('构造调整会使已有区域作者态 OutputRef 失效，已拒绝修改');
  const live = new Set(
    stage.value.regions.map((region) => outputIdentity(region.ref)),
  );
  if (assigned.some((reference) => !live.has(outputIdentity(reference))))
    throw Error('构造调整会使已有区域作者态 OutputRef 失效，已拒绝修改');
};

const assertPublishedReady = (document, ownerNodeId) => {
  const program = document.programs[document.nodes[ownerNodeId].programId];
  const evaluated = evaluateProgram(document, ownerNodeId);
  for (const domain of ['curves', 'regions'])
    if (
      program.outputs[domain] &&
      !['ready', 'empty'].includes(evaluated[domain].status)
    )
      throw Error(
        `构造调整后的 ${domain} 输出不可用：${evaluated[domain].diagnostics
          .map((item) => item.message)
          .join('；')}`,
      );
};

const swapAdjacent = (program, ownerNodeId, first, second, domain) => {
  const prior = input(first, domain);
  const secondInput = input(second, domain);
  const secondOut = port(ownerNodeId, second.id, domain);
  const firstOut = port(ownerNodeId, first.id, domain);
  const after = consumers(program, secondOut);
  if (after.length > 1) throw Error('Program 存在分叉，不能调整顺序');
  second.inputs.input[0] = clone(prior);
  first.inputs.input[0] = retarget(secondInput, ownerNodeId, second.id, domain);
  if (after.length) {
    const link = after[0];
    link.operator.inputs[link.name][link.index] = retarget(
      link.reference,
      ownerNodeId,
      first.id,
      domain,
    );
  }
  if (samePort(program.outputs[domain], secondOut))
    program.outputs[domain] = firstOut;
};

export function createProgramModifierCommand(request) {
  const action = clone(request);
  return (document, { idFactory } = {}) => {
    const kind = action?.kind;
    if (
      ![
        'add-program-modifier',
        'remove-program-modifier',
        'move-program-modifier',
      ].includes(kind)
    )
      throw Error('未知 Program 修改器命令');
    const assigned = outputRefs(document, action.ownerNodeId);
    if (kind === 'add-program-modifier') {
      if (typeof idFactory !== 'function') throw Error('缺少修改器 ID 生成器');
      if (!['curve-mirror', 'curve-array'].includes(action.type))
        throw Error('只支持添加曲线镜像或曲线阵列');
      const analysis = analyzeCurveInsertion(document, action.ownerNodeId);
      if (!analysis.enabled) throw Error(analysis.reason);
      const id = idFactory();
      if (
        typeof id !== 'string' ||
        !id.trim() ||
        Object.hasOwn(analysis.program.operators, id)
      )
        throw Error('新修改器 ID 无效或重复');
      const targetInput = analysis.fill
        ? analysis.fill.inputs.input[0]
        : analysis.insertion;
      analysis.program.operators[id] = {
        id,
        type: action.type,
        name: action.name || action.type,
        enabled: true,
        inputs: {
          input: [
            retarget(
              targetInput,
              targetInput.ownerNodeId,
              targetInput.operatorId,
              'curves',
            ),
          ],
        },
        params: clone(action.params),
      };
      const output = retarget(targetInput, action.ownerNodeId, id, 'curves');
      if (analysis.fill) analysis.fill.inputs.input[0] = output;
      if (samePort(analysis.program.outputs.curves, analysis.insertion))
        analysis.program.outputs.curves = port(
          action.ownerNodeId,
          id,
          'curves',
        );
    } else {
      const capability = linearProgramCapability(
        document,
        action.ownerNodeId,
        action.operatorId,
        kind === 'move-program-modifier' ? 'move' : 'remove',
        action.direction,
      );
      if (!capability.enabled) throw Error(capability.reason);
      const analysis = structureAnalysis(
        document,
        action.ownerNodeId,
        action.operatorId,
      );
      const { owner, program, operator: current, domain } = analysis;
      if (kind === 'remove-program-modifier') {
        const prior = input(current, domain);
        const out = port(owner.id, current.id, domain);
        const next = consumers(program, out);
        if (next.length) {
          const link = next[0];
          link.operator.inputs[link.name][link.index] = clone(prior);
        }
        if (samePort(program.outputs[domain], out))
          program.outputs[domain] = port(
            prior.ownerNodeId,
            prior.operatorId,
            prior.domain,
          );
        delete program.operators[current.id];
      } else {
        const adjacent =
          action.direction === 1
            ? consumers(program, port(owner.id, current.id, domain))[0].operator
            : program.operators[input(current, domain).operatorId];
        swapAdjacent(
          program,
          owner.id,
          action.direction === 1 ? current : adjacent,
          action.direction === 1 ? adjacent : current,
          domain,
        );
      }
    }
    assertPublishedReady(document, action.ownerNodeId);
    validateAssignedOutputs(document, action.ownerNodeId, assigned);
    return {
      document,
      changedRefs: [{ kind: 'node', id: action.ownerNodeId }],
    };
  };
}
