/** Branches describe this evaluation only. A blocked aggregate deliberately has
 * no value: manufacturing/export callers cannot accidentally consume a subset. */
export function aggregateReliefBranches(domain, branches) {
  const diagnostics = branches.flatMap((branch) =>
    (branch.diagnostics || []).map((item) => ({
      ...item,
      ...(branch.ownerNodeId &&
        !item.ref && {
          ref: {
            kind: 'node',
            id: branch.ownerNodeId,
            ownerNodeId: branch.ownerNodeId,
          },
        }),
    })),
  );
  const dependencies = [
    ...new Set(branches.flatMap((x) => x.dependencies || [])),
  ];
  const blocked = branches.some((branch) => branch.status === 'blocked');
  const reliefs = branches.flatMap((branch) => branch.value?.reliefs || []);
  const absent =
    branches.length > 0 && branches.every((x) => x.status === 'absent');
  return {
    domain,
    status: blocked
      ? 'blocked'
      : reliefs.length
        ? 'ready'
        : absent
          ? 'absent'
          : 'empty',
    ...(!blocked &&
      !absent && {
        value: {
          reliefs,
          provenance: branches.flatMap((x) => x.value?.provenance || []),
          ...(domain === 'relief' && {
            assignmentProposals: {
              appearance: branches.flatMap(
                (x) => x.value?.assignmentProposals?.appearance || [],
              ),
              relief: branches.flatMap(
                (x) => x.value?.assignmentProposals?.relief || [],
              ),
            },
          }),
        },
      }),
    branches,
    diagnostics,
    dependencies,
  };
}

/** Intended for preview and dependency solving, never complete-body export. */
export const readyReliefMembers = (stage) =>
  stage?.status === 'ready'
    ? stage.value.reliefs
    : stage?.branches
      ? stage.branches.flatMap((branch) =>
          branch.status === 'ready' ? branch.value.reliefs : [],
        )
      : [];
