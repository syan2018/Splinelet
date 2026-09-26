/** Resolve independently registered pages against the current semantic target.
 * No field values or commands live in the registry. */
export function resolvePropertyContributions(contributions, target) {
  const ids = new Set();
  for (const contribution of contributions) {
    if (!contribution.id || ids.has(contribution.id))
      throw Error(`重复或缺失的属性贡献 ID：${contribution.id}`);
    ids.add(contribution.id);
  }
  return contributions
    .filter((entry) => entry.supports(target))
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
}

export function resolvePropertyPage(requested, contributions, globalPages) {
  if (requested === 'tool' || globalPages.includes(requested)) return requested;
  return (
    contributions.find((entry) => entry.id === requested)?.id ||
    contributions[0]?.id ||
    'tool'
  );
}

export function selectionPropertyTarget(selection, rows, ownerIds) {
  const selected = rows.filter((row) => selection.ids.includes(row.id));
  const groups =
    selection.kind === 'object'
      ? selected.filter((row) => row.kind === 'group').length
      : 0;
  return {
    kind:
      !selection.ids.length || (selection.kind === 'object' && !selected.length)
        ? 'none'
        : selection.kind === 'path'
          ? 'path'
          : selection.kind === 'cell'
            ? 'region'
            : groups
              ? groups === selected.length
                ? 'group'
                : 'mixed'
              : 'shape',
    count: selection.ids.length,
    ownerCount: rows.filter(
      (row) => row.kind === 'shape' && ownerIds.includes(row.id),
    ).length,
    groupCount: groups,
  };
}
