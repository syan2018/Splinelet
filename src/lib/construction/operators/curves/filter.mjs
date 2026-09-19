const clone = (value) => structuredClone(value);
const key = (ref) => JSON.stringify([ref.sketchId, ref.id]);
const validRef = (ref) =>
  ref?.kind === 'path' &&
  typeof ref.sketchId === 'string' &&
  ref.sketchId.length > 0 &&
  typeof ref.id === 'string' &&
  ref.id.length > 0 &&
  Object.keys(ref).every((field) => ['kind', 'sketchId', 'id'].includes(field));

/** Select participation in one construction input without editing Source or
 * changing curve/edge identities. Exclusions remain explicit graph references. */
export const curveFilterOperator = {
  type: 'curve-filter',
  inputPorts: { input: { domain: 'curves', min: 1, max: 1 } },
  outputPorts: { curves: { domain: 'curves' } },
  bypass: { curves: 'input' },
  validateParams: (params) =>
    (params &&
      Object.keys(params).length === 1 &&
      Array.isArray(params.excludedPaths) &&
      params.excludedPaths.every(validRef) &&
      new Set(params.excludedPaths.map(key)).size ===
        params.excludedPaths.length) ||
    'curve-filter 需要不重复的 excludedPaths PathRef 数组',
  dependencies: ({ operator }) => [
    ...new Set(
      (Array.isArray(operator.params?.excludedPaths)
        ? operator.params.excludedPaths
        : []
      )
        .filter(validRef)
        .map((ref) => `sketch:${ref.sketchId}`),
    ),
  ],
  rebase: (operator) => clone(operator),
  copy: (operator, { idMap = {} } = {}) => {
    const remap = (id) =>
      (idMap instanceof Map ? idMap.get(id) : idMap[id]) || id;
    const copied = clone(operator);
    copied.params.excludedPaths = copied.params.excludedPaths.map((ref) => ({
      ...ref,
      sketchId: remap(ref.sketchId),
      id: remap(ref.id),
    }));
    return copied;
  },
  evaluate: ({ inputs, operator }) => {
    const input = inputs.input[0];
    if (!['ready', 'empty'].includes(input.status))
      return { curves: clone(input) };
    const excluded = new Set(operator.params.excludedPaths.map(key));
    const available = new Set(
      input.value.curves
        .filter((curve) => curve.pathRef)
        .map((curve) => key(curve.pathRef)),
    );
    if ([...excluded].some((id) => !available.has(id)))
      return {
        curves: {
          domain: 'curves',
          status: 'blocked',
          diagnostics: [
            {
              code: 'filter-path-missing',
              message: '参与关系引用的源线条已不在当前输入中，请修复引用',
            },
          ],
          dependencies: clone(input.dependencies || []),
        },
      };
    const value = clone(input.value);
    value.curves = value.curves.filter(
      (curve) => !curve.pathRef || !excluded.has(key(curve.pathRef)),
    );
    const edges = new Set(
      value.curves.flatMap((curve) => curve.edges.map((edge) => edge.key)),
    );
    value.junctions = (value.junctions || [])
      .map((junction) => ({
        ...junction,
        endpoints: junction.endpoints.filter((endpoint) =>
          edges.has(endpoint.edgeKey),
        ),
      }))
      .filter((junction) => junction.endpoints.length > 1);
    return {
      curves: {
        ...clone(input),
        status: value.curves.length ? 'ready' : 'empty',
        value,
      },
    };
  },
};
