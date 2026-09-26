import {
  definitionRef,
  selectorKey,
} from '../construction/region-definitions.mjs';
import { outputIdentity } from '../construction/output-identity.mjs';

const clone = (value) => structuredClone(value);
const sameValue = (left, right) => selectorKey(left) === selectorKey(right);
const sameRef = (left, right) =>
  left?.kind === 'output' &&
  right?.kind === 'output' &&
  outputIdentity(left) === outputIdentity(right);
const stageFor = (planar, operatorId) =>
  planar?.components?.[`operator:${operatorId}`]?.ports?.regions || {
    domain: 'regions',
    status: 'absent',
    diagnostics: [],
    dependencies: [],
  };
const sourceLabels = (selector) => {
  if (selector?.kind !== 'cell') return [];
  const rings = [selector.outer, ...(selector.holes || [])];
  return [
    ...new Set(
      rings.flatMap((ring) =>
        ring.flatMap((run) =>
          run.sources.map(({ use }) => `${use.kind}:${use.role}`),
        ),
      ),
    ),
  ].sort((left, right) => left.localeCompare(right));
};
const candidateLabel = (candidate, ordinal) => {
  const selector = candidate.selector;
  if (selector?.kind === 'result')
    return `结果 ${selector.role} · 当前候选 ${ordinal}`;
  const sources = sourceLabels(selector);
  return `${sources.join('、') || '边界单元'} · 当前候选 ${ordinal}`;
};
const candidateContextMatches = (candidate, context) =>
  candidate?.ref?.kind === 'output' &&
  candidate.ref.ownerNodeId === context.ownerNodeId &&
  candidate.ref.operatorId === context.operatorId &&
  candidate.ref.port === context.port &&
  sameValue(candidate.ref.instances, context.instances);

/**
 * Read-only repair data. Candidate ordinals and labels are presentation only;
 * no geometry or ordinal becomes persisted selection authority.
 */
export function projectRegionSelectionRepairView(
  document,
  planar,
  ownerNodeId,
  operatorId,
) {
  const stage = stageFor(planar, operatorId);
  const definitions = Object.values(document?.regionDefinitions || {}).filter(
    (definition) =>
      definition.context.ownerNodeId === ownerNodeId &&
      definition.context.operatorId === operatorId &&
      definition.context.port === 'regions',
  );
  const candidates = (stage.value?.regions || []).filter(
    (candidate) =>
      candidate?.selector &&
      candidateContextMatches(candidate, {
        ownerNodeId,
        operatorId,
        port: 'regions',
        instances: candidate.ref.instances,
      }),
  );
  const occupiedBy = (candidate, definition) =>
    definitions.find(
      (other) =>
        other.id !== definition.id &&
        sameValue(other.context.instances, candidate.ref.instances) &&
        (sameRef(candidate.ref, definitionRef(other)) ||
          sameValue(other.selector, candidate.selector)),
    )?.id || null;
  return {
    ownerNodeId,
    operatorId,
    geometryStage: clone(stage),
    definitions: definitions.map((definition) => {
      const current = candidates.filter((candidate) =>
        sameRef(candidate.ref, definitionRef(definition)),
      );
      return {
        definitionId: definition.id,
        context: clone(definition.context),
        status:
          stage.status === 'blocked'
            ? 'blocked'
            : current.length === 1
              ? 'resolved'
              : current.length > 1
                ? 'ambiguous'
                : 'missing',
        currentRef: current.length === 1 ? clone(current[0].ref) : null,
        candidates: candidates
          .filter((candidate) =>
            sameValue(candidate.ref.instances, definition.context.instances),
          )
          .map((candidate, index) => ({
            ref: clone(candidate.ref),
            selector: clone(candidate.selector),
            label: candidateLabel(candidate, index + 1),
            occupiedByDefinitionId: occupiedBy(candidate, definition),
          })),
      };
    }),
  };
}
