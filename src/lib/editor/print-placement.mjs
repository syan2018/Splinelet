/**
 * A display-facing summary of one or more authored relief placements.
 * `unassigned` means a known free or attached placement: it has a Z rule but
 * does not belong to a manufacturing layer. `unavailable` means the view has
 * no placement from which it can make that distinction.
 */
export const printPlacementFor = (placement) =>
  placement?.kind === 'layer' && typeof placement.layerId === 'string'
    ? { kind: 'layer', layerId: placement.layerId }
    : placement
      ? { kind: 'unassigned' }
      : { kind: 'unavailable' };

export function aggregatePrintPlacements(placements, layerOrder = []) {
  const expanded = placements.flatMap((item) =>
    item?.kind === 'mixed'
      ? [
          ...(item.layerIds || []).map((layerId) => ({
            kind: 'layer',
            layerId,
          })),
          ...(item.includesUnassigned ? [{ kind: 'unassigned' }] : []),
        ]
      : [item],
  );
  if (
    !expanded.length ||
    expanded.some((item) => !item || item.kind === 'unavailable')
  )
    return { kind: 'unavailable' };
  const layerIds = [
    ...new Set(
      expanded
        .filter((item) => item.kind === 'layer')
        .map((item) => item.layerId),
    ),
  ].sort((left, right) => {
    const leftIndex = layerOrder.indexOf(left);
    const rightIndex = layerOrder.indexOf(right);
    return (
      (leftIndex < 0 ? Infinity : leftIndex) -
        (rightIndex < 0 ? Infinity : rightIndex) || left.localeCompare(right)
    );
  });
  const includesUnassigned = expanded.some(
    (item) => item.kind === 'unassigned',
  );
  if (layerIds.length === 1 && !includesUnassigned)
    return { kind: 'layer', layerId: layerIds[0] };
  if (!layerIds.length && includesUnassigned) return { kind: 'unassigned' };
  return { kind: 'mixed', layerIds, includesUnassigned };
}
