import { validateDocument } from '../../document/schema.mjs';
import {
  definitionRef,
  selectorKey,
} from '../../construction/region-definitions.mjs';
import { outputIdentity } from '../../construction/output-identity.mjs';
import { effectiveNodeState } from '../../scene/hierarchy.mjs';

const clone = (value) => structuredClone(value);
const sameValue = (left, right) => selectorKey(left) === selectorKey(right);
const sameContext = (left, right) =>
  !!left &&
  !!right &&
  left.ownerNodeId === right.ownerNodeId &&
  left.operatorId === right.operatorId &&
  left.port === right.port &&
  sameValue(left.instances, right.instances);
const sameRef = (left, right) =>
  left?.kind === 'output' &&
  right?.kind === 'output' &&
  outputIdentity(left) === outputIdentity(right);
const componentStage = (planar, context) => {
  const stage =
    planar?.components?.[`operator:${context.operatorId}`]?.ports?.[
      context.port
    ];
  if (
    stage?.domain !== 'regions' ||
    !Array.isArray(stage.value?.regions) ||
    !['ready', 'empty'].includes(stage.status)
  )
    throw Error('当前区域求值不可用于重新选择');
  return stage;
};
const candidateContextMatches = (candidate, context) =>
  candidate?.ref?.kind === 'output' &&
  candidate.ref.ownerNodeId === context.ownerNodeId &&
  candidate.ref.operatorId === context.operatorId &&
  candidate.ref.port === context.port &&
  sameValue(candidate.ref.instances, context.instances);

/**
 * Rebind one persisted V5 RegionDefinition to one exact candidate emitted by
 * the current planar stage. The request deliberately cannot carry geometry or
 * a selector: those are read from the trusted evaluation supplied by the
 * caller's synchronous prepare/confirm flow.
 */
export function createRebindRegionSelectionCommand(request, { planar } = {}) {
  const change = clone(request);
  const evaluation = clone(planar);
  return (document) => {
    if (
      !change ||
      typeof change !== 'object' ||
      Array.isArray(change) ||
      Object.keys(change).some(
        (key) =>
          !['definitionId', 'candidateRef', 'expectedContext'].includes(key),
      )
    )
      throw Error('区域重新选择请求不能携带 selector、geometry 或未知字段');
    if (document.version !== 5 || !document.regionDefinitions)
      throw Error('区域重新选择仅支持 V5 Document');
    if (!change?.definitionId || change.candidateRef?.kind !== 'output')
      throw Error('区域重新选择需要 definitionId 和当前 candidateRef');
    const definition = document.regionDefinitions[change.definitionId];
    if (!definition) throw Error('区域定义不存在');
    if (
      change.expectedContext !== undefined &&
      !sameContext(change.expectedContext, definition.context)
    )
      throw Error('区域重新选择的生产者上下文已变化');
    const node = document.nodes[definition.context.ownerNodeId];
    if (node?.kind !== 'shape') throw Error('区域定义所属部件不存在');
    if (effectiveNodeState(document, node.id).locked)
      throw Error('区域所属部件已锁定');
    const stage = componentStage(evaluation, definition.context);
    const candidates = stage.value.regions.filter((candidate) =>
      candidateContextMatches(candidate, definition.context),
    );
    const selected = candidates.filter((candidate) =>
      sameRef(candidate.ref, change.candidateRef),
    );
    if (selected.length !== 1 || !selected[0].selector)
      throw Error('所选区域不是当前生产者的唯一候选');
    const occupied = Object.values(document.regionDefinitions).find(
      (other) =>
        other.id !== definition.id &&
        sameContext(other.context, definition.context) &&
        (sameRef(selected[0].ref, definitionRef(other)) ||
          sameValue(other.selector, selected[0].selector)),
    );
    if (occupied)
      throw Error('所选区域已被另一个区域定义占用，未合并或覆盖属性');

    // Validate first so a malformed worker value cannot partially alter the
    // caller's document even outside the normal transaction wrapper.
    const next = clone(document);
    next.regionDefinitions[definition.id].selector = clone(
      selected[0].selector,
    );
    validateDocument(next);
    definition.selector = clone(selected[0].selector);
    return {
      document,
      changedRefs: [clone(definitionRef(definition))],
    };
  };
}
