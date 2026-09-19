import { regionSources } from './creation-schema.mjs';

// The source paths projected for dragging are dependencies, not property targets.
export function creationEditTargets(selection) {
  if (!selection.ids.length) throw Error('请先选中一个区域或部件');
  if (selection.kind === 'cell') return { cellKeys: [...selection.ids] };
  if (selection.kind === 'object') return { objectIds: [...selection.ids] };
  throw Error('当前选中的是线条，请先选择它围成的区域');
}

export function regionLabel(cell, scene) {
  if (cell.name) return cell.name;
  const owner = scene.creation.objects.find((o) => o.id === cell.objectId);
  const index = scene.cells
    .filter((c) => c.objectId === cell.objectId)
    .findIndex((c) => c.key === cell.key);
  return `${owner?.name || '区域'} · 区域 ${index + 1}`;
}

export function regionsForPaths(project, scene, ids) {
  if (!scene) return [];
  const closed = new Set(
    project.paths
      .filter((p) => p.closed && ids.includes(p.id))
      .map((p) => p.id),
  );
  return scene.cells.filter((cell) => {
    const owner = scene.creation.objects.find((o) => o.id === cell.objectId);
    const owned = owner?.pathIds.filter((id) => closed.has(id)) || [];
    const boundaries =
      cell.featureId || cell.regionId
        ? regionSources(project.model, cell.regionId)
        : cell.boundaryPathIds || [];
    return owned.some((id) => boundaries.includes(id));
  });
}

export function pathsForRegions(project, scene, ids) {
  return [
    ...new Set(
      (scene?.cells || [])
        .filter((cell) => ids.includes(cell.key))
        .flatMap((cell) => {
          const owner = scene.creation.objects.find(
            (o) => o.id === cell.objectId,
          );
          const sources = cell.regionId
            ? regionSources(project.model, cell.regionId)
            : cell.boundaryPathIds?.length
              ? cell.boundaryPathIds
              : cell.sourceIds || [];
          return sources.filter((id) => owner?.pathIds.includes(id));
        }),
    ),
  ];
}
