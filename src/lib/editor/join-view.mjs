/** Stable edge ends in the evaluated input, with identifiable source spans. */
export function projectJoinEndpoints(document, stage) {
  if (stage?.status !== 'ready') return [];
  const result = [];
  const operators = new Map(
    Object.values(document.programs).flatMap((program) =>
      Object.values(program.operators).map((operator) => [
        operator.id,
        operator,
      ]),
    ),
  );
  for (const curve of stage.value.curves)
    for (const edge of curve.edges) {
      if (!edge.source?.sketchId || !edge.source?.id) continue;
      const sketch = document.sketches[edge.source.sketchId];
      const path = Object.values(sketch?.paths || {}).find((path) =>
        path.edges.some((use) => use.edgeId === edge.source.id),
      );
      const span =
        (path?.edges.findIndex((use) => use.edgeId === edge.source.id) ?? -1) +
        1;
      const instanceLabel = (edge.instances || [])
        .map((instance) => {
          const operator = operators.get(instance.operatorId);
          return `${operator?.name || instance.operatorId} ${instance.index + 1}`;
        })
        .join(' / ');
      for (const end of ['start', 'end']) {
        const instances = structuredClone(edge.instances || []);
        const instance = instances.pop();
        const endpoint = {
          edgeEnd: {
            kind: 'edge-end',
            sketchId: edge.source.sketchId,
            edgeId: edge.source.id,
            end,
          },
          instances,
          ...(instance && { selector: { ...instance } }),
        };
        result.push({
          endpoint,
          cubic: structuredClone(edge.cubic),
          label: `${path?.name || edge.source.id} · 第 ${span || 1} 段${end === 'start' ? '起端' : '末端'}${instanceLabel ? ' · ' + instanceLabel : ''}（${edge.source.id}）`,
        });
      }
    }
  return result;
}
