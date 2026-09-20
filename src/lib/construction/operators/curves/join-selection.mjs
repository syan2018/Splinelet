const edgeMatches = (edge, endpoint) =>
  edge.source?.sketchId === endpoint.sketchId &&
  edge.source?.id === endpoint.edgeId;
const instancesFor = (value, operator) =>
  [
    ...new Set(
      value
        .filter((edge) =>
          edge.instances?.some((item) => item.operatorId === operator),
        )
        .map(
          (edge) =>
            edge.instances.find((item) => item.operatorId === operator).index,
        ),
    ),
  ].sort((a, b) => a - b);
const matchesFixedInstances = (edge, fixed) =>
  (fixed || []).every((instance) =>
    edge.instances?.some(
      (item) =>
        item.operatorId === instance.operatorId &&
        item.index === instance.index,
    ),
  );
const selectEdge = (edges, endpoint, selector, iteration, fixed) => {
  const matching = edges.filter(
    (edge) => edgeMatches(edge, endpoint) && matchesFixedInstances(edge, fixed),
  );
  if (!selector) return matching.length === 1 ? matching[0] : undefined;
  const indexes = instancesFor(matching, selector.operatorId);
  const base = selector.index === 'each' ? iteration : selector.index;
  let index = base;
  if (selector.index === 'next' || selector.index === 'previous')
    index = iteration + (selector.index === 'next' ? 1 : -1);
  if (!Number.isInteger(index)) return undefined;
  if (selector.wrap && indexes.length)
    index = ((index % indexes.length) + indexes.length) % indexes.length;
  const matches = matching.filter((edge) =>
    edge.instances?.some(
      (item) => item.operatorId === selector.operatorId && item.index === index,
    ),
  );
  return matches.length === 1 ? matches[0] : undefined;
};
/** Resolve the exact same instance pairs for evaluation and the Join editor. */
export function resolveJoinPairs(edges, connection) {
  const { a: left, b: right } = connection;
  const iterations =
    left.selector?.index === 'each'
      ? instancesFor(
          edges.filter(
            (edge) =>
              edgeMatches(edge, left.edgeEnd) &&
              matchesFixedInstances(edge, left.instances),
          ),
          left.selector.operatorId,
        )
      : [left.selector?.index ?? 0];
  return iterations.map((iteration) => ({
    iteration,
    a: selectEdge(
      edges,
      left.edgeEnd,
      left.selector,
      iteration,
      left.instances,
    ),
    b: selectEdge(
      edges,
      right.edgeEnd,
      right.selector,
      iteration,
      right.instances,
    ),
  }));
}
