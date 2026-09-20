const record = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const id = (value) => typeof value === 'string' && value.trim().length > 0;
const index = (value) => Number.isInteger(value) && value >= 0;
const only = (value, keys) =>
  Object.keys(value).every((key) => keys.includes(key));

/** Syntax only: missing geometry is a repairable evaluation error, malformed
 * endpoint/instance fields are rejected before they enter the document. */
export function validateJoinParams(params) {
  if (
    !record(params) ||
    !only(params, ['connections']) ||
    !Array.isArray(params.connections)
  )
    return 'Join 需要 connections 数组';
  for (const [i, connection] of params.connections.entries()) {
    if (!record(connection) || !only(connection, ['a', 'b']))
      return `Join ${i + 1} 需要 a/b 端点`;
    for (const side of ['a', 'b']) {
      const endpoint = connection[side];
      const label = `Join ${i + 1}.${side}`;
      if (
        !record(endpoint) ||
        !only(endpoint, ['edgeEnd', 'instances', 'selector'])
      )
        return `${label} 端点无效`;
      const edge = endpoint.edgeEnd;
      if (
        !record(edge) ||
        !only(edge, ['kind', 'sketchId', 'edgeId', 'end']) ||
        edge.kind !== 'edge-end' ||
        !id(edge.sketchId) ||
        !id(edge.edgeId) ||
        !['start', 'end'].includes(edge.end)
      )
        return `${label}.edgeEnd 需要有效边引用和 start/end`;
      if (
        endpoint.instances !== undefined &&
        !Array.isArray(endpoint.instances)
      )
        return `${label}.instances 必须为数组`;
      const used = new Set();
      for (const instance of endpoint.instances || []) {
        if (
          !record(instance) ||
          !only(instance, ['operatorId', 'index']) ||
          !id(instance.operatorId) ||
          !index(instance.index) ||
          used.has(instance.operatorId)
        )
          return `${label}.instances 需要唯一算子和非负整数实例`;
        used.add(instance.operatorId);
      }
      const selector = endpoint.selector;
      if (
        selector !== undefined &&
        (!record(selector) ||
          !only(selector, ['operatorId', 'index', 'wrap']) ||
          !id(selector.operatorId) ||
          used.has(selector.operatorId) ||
          !(
            index(selector.index) ||
            (side === 'a' ? ['each'] : ['each', 'next', 'previous']).includes(
              selector.index,
            )
          ) ||
          (selector.wrap !== undefined && typeof selector.wrap !== 'boolean'))
      )
        return `${label}.selector 的算子、实例或 wrap 无效`;
    }
  }
  return true;
}
