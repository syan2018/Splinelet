/** Display the complete result unless an explicitly selected owner requests a
 * different stage. Preview preferences never affect unselected objects. */
export function selectCurvePreviews(all, objectId, enabled, stageId) {
  const selected = new Map();
  for (const stage of all)
    if (stage.stageId === 'final') selected.set(stage.objectId, stage);
  for (const stage of all)
    if (stage.defaultPreview) selected.set(stage.objectId, stage);
  if (objectId) {
    if (!enabled) selected.delete(objectId);
    else {
      const chosen = all.find(
        (stage) => stage.objectId === objectId && stage.stageId === stageId,
      );
      if (chosen) selected.set(objectId, chosen);
    }
  }
  return [...selected.values()]
    .filter(
      (stage) =>
        !(
          stage.stageId === 'final' &&
          !stage.curves.length &&
          stage.diagnostic === '未发布曲线输出'
        ),
    )
    .map((stage) =>
      stage.objectId === objectId ? stage : { ...stage, junctions: [] },
    );
}
