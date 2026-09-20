/**
 * Projects a tree selection into the scene-group actions that can safely use
 * authoring's root-node semantics.  The original selected node list remains
 * visible to callers so a nested group is never silently omitted from UI
 * counts.
 *
 * @param {{ id: string, kind: 'group'|'shape', ancestors?: string[] }[]} rows
 * @param {string[]} selectedIds
 */
export function sceneGroupSelection(rows, selectedIds) {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const selected = [...new Set(selectedIds)]
    .map((id) => byId.get(id))
    .filter(Boolean);
  const groups = selected.filter((row) => row.kind === 'group');
  const shapes = selected.filter((row) => row.kind === 'shape');
  const groupIds = new Set(groups.map((row) => row.id));
  const rootGroups = groups.filter(
    (row) => !(row.ancestors || []).some((ancestor) => groupIds.has(ancestor)),
  );
  return {
    selected,
    groups,
    shapes,
    rootGroups,
    singleGroup:
      selected.length === 1 && groups.length === 1 ? groups[0] : null,
  };
}
