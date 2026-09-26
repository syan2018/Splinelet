import { proposeAssignmentInheritance } from '../construction/provenance.mjs';
import { sameOutputRef } from './appearance.mjs';
import { createOutputRefIndex } from '../construction/output-identity.mjs';

const clone = (value) => structuredClone(value);

export function assignmentsForTarget(assignments, target) {
  return (assignments || []).filter((assignment) =>
    sameOutputRef(assignment.target, target),
  );
}

export function unresolvedAssignments(regions, assignments) {
  const index = createOutputRefIndex(regions, (region) => region.ref);
  return (assignments || []).filter(
    (assignment) => !index.has(assignment.target),
  );
}

/**
 * Split/merge inheritance stays a proposal. It never mutates assignments and
 * callers must still decide whether to persist a proposal through a command.
 */
export function proposeOutputAssignmentInheritance(regions, assignments) {
  return proposeAssignmentInheritance(regions, assignments);
}

/**
 * T13 can turn this explicit plan into one transaction. The resolver itself
 * never enables a candidate region as an incidental consequence of a color.
 */
export function firstPaintPlan({ target, swatchId }) {
  return {
    appearance: { target: clone(target), value: { swatchId } },
    relief: {
      target: clone(target),
      value: {
        enabled: true,
        thickness: { kind: 'mm', value: 1 },
        mode: 'add',
        placement: { kind: 'free', zMM: 0 },
      },
    },
  };
}
