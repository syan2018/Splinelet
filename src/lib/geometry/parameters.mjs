const DEFAULT_LIMITS = Object.freeze({ maxDepth: 32, maxNodes: 512 });
const binaryOps = new Set(['add', 'subtract', 'multiply', 'divide']);
const unaryOps = new Set(['negate', 'sin', 'cos']);

const unique = (values) => [...new Set(values)];
const diagnostic = (kind, message, ref) => ({
  severity: 'error',
  kind,
  ...(ref && { ref }),
  message,
});
const ready = (value, dependencies) => ({
  status: 'ready',
  value,
  diagnostics: [],
  dependencies: unique(dependencies),
});
const blocked = (item, dependencies = []) => ({
  status: 'blocked',
  value: null,
  diagnostics: [item],
  dependencies: unique(dependencies),
});

function scalarResult(value, state, scalar, depth) {
  state.nodes++;
  if (state.nodes > state.limits.maxNodes || depth > state.limits.maxDepth)
    return blocked(
      diagnostic('limit', 'Scalar 表达式超过允许的深度或节点数'),
      state.dependencies,
    );
  if (Number.isFinite(value)) return ready(value, state.dependencies);
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return blocked(
      diagnostic('invalid-scalar', 'Scalar 必须是有限数或白名单表达式'),
      state.dependencies,
    );
  if (state.values.has(value))
    return blocked(
      diagnostic('cycle', 'Scalar 表达式存在对象循环'),
      state.dependencies,
    );
  state.values.add(value);
  try {
    if (value.kind === 'parameter') {
      if (Object.keys(value).length !== 2 || typeof value.id !== 'string')
        return blocked(
          diagnostic('invalid-scalar', 'Parameter Scalar 无效'),
          state.dependencies,
        );
      const key = `parameter:${value.id}`;
      state.dependencies.push(key);
      const parameter = state.document?.parameters?.[value.id];
      if (!parameter)
        return blocked(
          diagnostic('unresolved-reference', `Parameter 不存在：${value.id}`, {
            kind: 'parameter',
            id: value.id,
          }),
          state.dependencies,
        );
      if (!Number.isFinite(parameter.value))
        return blocked(
          diagnostic('invalid-scalar', `Parameter 值不是有限数：${value.id}`),
          state.dependencies,
        );
      return ready(parameter.value, state.dependencies);
    }
    if (
      value.kind !== 'expression' ||
      Object.keys(value).length !== 3 ||
      typeof value.op !== 'string' ||
      !Array.isArray(value.args) ||
      (!binaryOps.has(value.op) && !unaryOps.has(value.op))
    )
      return blocked(
        diagnostic('invalid-scalar', 'Scalar 表达式不在白名单内'),
        state.dependencies,
      );
    const expected = unaryOps.has(value.op) ? 1 : 2;
    if (value.args.length !== expected)
      return blocked(
        diagnostic(
          'invalid-scalar',
          `Scalar ${value.op} 需要 ${expected} 个参数`,
        ),
        state.dependencies,
      );
    const args = [];
    for (const argument of value.args) {
      const resolved = scalarResult(argument, state, argument, depth + 1);
      if (resolved.status !== 'ready') return resolved;
      args.push(resolved.value);
    }
    let result;
    if (value.op === 'add') result = args[0] + args[1];
    if (value.op === 'subtract') result = args[0] - args[1];
    if (value.op === 'multiply') result = args[0] * args[1];
    if (value.op === 'divide') {
      if (args[1] === 0)
        return blocked(
          diagnostic('divide-by-zero', 'Scalar 除数为零'),
          state.dependencies,
        );
      result = args[0] / args[1];
    }
    if (value.op === 'negate') result = -args[0];
    if (value.op === 'sin') result = Math.sin(args[0]);
    if (value.op === 'cos') result = Math.cos(args[0]);
    if (!Number.isFinite(result))
      return blocked(
        diagnostic('invalid-scalar', 'Scalar 计算结果不是有限数'),
        state.dependencies,
      );
    return ready(result, state.dependencies);
  } finally {
    state.values.delete(value);
  }
}

/**
 * Evaluates only the persisted Scalar whitelist. It deliberately accepts no
 * executable expression syntax and returns a blocked StageResult for malformed,
 * unresolved, cyclic, or non-finite input.
 */
export function resolveScalar(document, scalar, options = {}) {
  const limits = {
    ...DEFAULT_LIMITS,
    ...options.limits,
  };
  if (
    !Number.isSafeInteger(limits.maxDepth) ||
    !Number.isSafeInteger(limits.maxNodes) ||
    limits.maxDepth < 0 ||
    limits.maxNodes < 1
  )
    return blocked(diagnostic('invalid-limit', 'Scalar limits 无效'));
  const state = {
    document,
    limits,
    nodes: 0,
    values: new WeakSet(),
    dependencies: [],
  };
  return scalarResult(scalar, state, scalar, 0);
}

export const scalarDependencies = (document, scalar, options) =>
  resolveScalar(document, scalar, options).dependencies;
