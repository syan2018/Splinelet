const stable = (value) => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stable(value[key])}`)
    .join(',')}}`;
};

export const outputIdentity = (ref) =>
  stable([
    ref.ownerNodeId,
    ref.operatorId,
    ref.port,
    ref.key,
    ref.instances,
    ref.lineage,
  ]);

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

export function resolveOutputReference(regions, reference) {
  const matches = regions.filter(
    (region) => outputIdentity(region.ref) === outputIdentity(reference),
  );
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
  const identities = new Set();
  const diagnostics = [];
  for (const reference of scope.refs) {
    const result = resolveOutputReference(regions, reference);
    if (result.status !== 'resolved')
      diagnostics.push({
        code: 'unresolved-scope',
        ref: reference,
        message: '所选区域无法唯一解析',
        candidates: result.candidates,
      });
    else identities.add(outputIdentity(result.region.ref));
  }
  if (diagnostics.length) return { status: 'blocked', diagnostics };
  return {
    status: 'ready',
    selected: regions.filter((region) =>
      identities.has(outputIdentity(region.ref)),
    ),
    untouched: regions.filter(
      (region) => !identities.has(outputIdentity(region.ref)),
    ),
  };
}

// Inheritance is a proposal, never a write to saved assignments. Exact refs win;
// a merge inherits only if every contributing assignment agrees on its value.
export function proposeAssignmentInheritance(regions, assignments) {
  const proposals = [],
    conflicts = [],
    unresolved = [];
  const used = new Set();
  for (const region of regions) {
    const exact = assignments.filter(
      (assignment) =>
        outputIdentity(assignment.target) === outputIdentity(region.ref),
    );
    const candidates = exact.length
      ? exact
      : assignments.filter(
          (assignment) =>
            assignment.target.ownerNodeId === region.ref.ownerNodeId &&
            stable(assignment.target.instances) ===
              stable(region.ref.instances) &&
            assignment.target.lineage.length &&
            assignment.target.lineage.every((token) =>
              region.ref.lineage.includes(token),
            ),
        );
    if (!candidates.length) continue;
    for (const candidate of candidates) used.add(candidate.id);
    if (
      new Set(candidates.map((candidate) => stable(candidate.value))).size > 1
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
