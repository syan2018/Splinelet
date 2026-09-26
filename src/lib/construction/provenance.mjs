import {
  outputIdentity as identity,
  stableIdentityValue as stable,
  createOutputRefIndex,
} from './output-identity.mjs';

const requiredOutputRef = (ref) => {
  // This construction API has always required a reference; the presentation
  // adapter separately permits an absent one for diagnostic reads.
  if (ref === null || ref === undefined)
    throw TypeError('OutputRef is required');
  return ref;
};
export const outputIdentity = (ref) => identity(requiredOutputRef(ref));

const regionIndex = (regions) =>
  createOutputRefIndex(regions, (region) => requiredOutputRef(region.ref));

export function makeOutputRef(
  ownerNodeId,
  operatorId,
  port,
  key,
  lineage,
  instances = [],
) {
  return {
    kind: 'output',
    ownerNodeId,
    operatorId,
    port,
    key,
    lineage: [...new Set(lineage)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
    instances: structuredClone(instances),
  };
}

export function resolveOutputReference(
  regions,
  reference,
  index = regionIndex(regions),
) {
  if (regions.length) requiredOutputRef(reference);
  const matches = index.get(reference);
  if (matches.length === 1) return { status: 'resolved', region: matches[0] };
  return {
    status: matches.length ? 'ambiguous' : 'unresolved',
    candidates: matches.map((region) => region.ref),
  };
}

export function resolveRegionScope(regions, scope) {
  if (scope?.kind === 'all')
    return { status: 'ready', selected: regions, untouched: [] };
  if (scope?.kind !== 'selected' || !Array.isArray(scope.refs))
    throw Error('区域作用范围必须明确为 all 或 selected');
  const index = regionIndex(regions);
  const selected = new Set();
  const diagnostics = [];
  for (const reference of scope.refs) {
    const result = resolveOutputReference(regions, reference, index);
    if (result.status !== 'resolved')
      diagnostics.push({
        code: 'unresolved-scope',
        ref: reference,
        message: '所选区域无法唯一解析',
        candidates: result.candidates,
      });
    else selected.add(result.region);
  }
  if (diagnostics.length) return { status: 'blocked', diagnostics };
  return {
    status: 'ready',
    selected: regions.filter((region) => selected.has(region)),
    untouched: regions.filter((region) => !selected.has(region)),
  };
}

// Inheritance is a proposal, never a write to saved assignments. Exact refs win;
// a merge inherits only if every contributing assignment agrees on its value.
export function proposeAssignmentInheritance(regions, assignments) {
  const proposals = [],
    conflicts = [],
    unresolved = [];
  const used = new Set();
  const exactIndex = createOutputRefIndex(assignments, (item) => item.target);
  const groups = new Map();
  const values = new Map();
  assignments.forEach((assignment, order) => {
    const target = assignment.target;
    if (!target.lineage.length) return;
    if (!groups.has(target.ownerNodeId))
      groups.set(target.ownerNodeId, new Map());
    const owner = groups.get(target.ownerNodeId);
    const instances = stable(target.instances);
    if (!owner.has(instances)) owner.set(instances, new Map());
    const tokens = owner.get(instances);
    // A subset match must contain this token. Index one token to avoid duplicate
    // candidates; verify the complete lineage after querying the smaller bucket.
    const token = target.lineage[0];
    if (!tokens.has(token)) tokens.set(token, []);
    tokens.get(token).push({ assignment, order });
  });
  for (const region of regions) {
    const exact = exactIndex.get(region.ref);
    let candidates = exact;
    if (!exact.length) {
      const group = groups
        .get(region.ref.ownerNodeId)
        ?.get(stable(region.ref.instances));
      const tokens = new Set(region.ref.lineage);
      candidates = [...tokens]
        .flatMap((token) => group?.get(token) || [])
        .filter(({ assignment }) =>
          assignment.target.lineage.every((token) => tokens.has(token)),
        )
        .sort((a, b) => a.order - b.order)
        .map(({ assignment }) => assignment);
    }
    if (!candidates.length) continue;
    for (const candidate of candidates) used.add(candidate.id);
    if (
      new Set(
        candidates.map((candidate) => {
          if (!values.has(candidate))
            values.set(candidate, stable(candidate.value));
          return values.get(candidate);
        }),
      ).size > 1
    )
      conflicts.push({
        target: region.ref,
        assignmentIds: candidates.map((candidate) => candidate.id),
      });
    else
      proposals.push({
        target: region.ref,
        value: structuredClone(candidates[0].value),
        assignmentIds: candidates.map((candidate) => candidate.id),
      });
  }
  for (const assignment of assignments)
    if (!used.has(assignment.id)) unresolved.push(structuredClone(assignment));
  return { proposals, conflicts, unresolved };
}
