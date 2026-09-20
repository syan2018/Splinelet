/** Stable endpoints offered by the current input, including instance identity. */
export function projectJoinEndpoints(document, stage) {
  if (stage?.status !== 'ready') return [];
  const result = [];
  for (const curve of stage.value.curves)
    for (const edge of curve.edges) {
      if (!edge.source?.sketchId || !edge.source?.id) continue;
      const sketch = document.sketches[edge.source.sketchId];
      const path = Object.values(sketch?.paths || {}).find((path) =>
        path.edges.some((use) => use.edgeId === edge.source.id),
      );
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
          label: `${path?.name || edge.source.id} · ${end === 'start' ? '起点' : '终点'}${edge.instances?.length ? ' · 实例 ' + edge.instances.map((item) => item.index + 1).join('/') : ''}`,
        });
      }
    }
  return result;
}
