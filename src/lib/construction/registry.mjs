const domain = (value, path) => {
  if (!['curves', 'regions'].includes(value))
    throw Error(`${path} 必须是 curves 或 regions`);
  return value;
};
const ports = (value, kind, type) => {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw Error(`${type}.${kind} 必须是端口表`);
  const result = {};
  for (const [name, definition] of Object.entries(value)) {
    if (!name || !definition || typeof definition !== 'object')
      throw Error(`${type}.${kind} 包含无效端口`);
    result[name] = {
      domain: domain(definition.domain, `${type}.${kind}.${name}.domain`),
      ...(kind === 'inputPorts' && definition.min !== undefined
        ? { min: definition.min }
        : {}),
      ...(kind === 'inputPorts' && definition.max !== undefined
        ? { max: definition.max }
        : {}),
    };
    for (const cardinality of ['min', 'max'])
      if (
        result[name][cardinality] !== undefined &&
        (!Number.isInteger(result[name][cardinality]) ||
          result[name][cardinality] < 0)
      )
        throw Error(`${type}.${kind}.${name}.${cardinality} 必须是非负整数`);
  }
  return result;
};

export function createOperatorRegistry(specifications) {
  const entries = Array.isArray(specifications)
    ? specifications
    : Object.values(specifications || {});
  const byType = new Map();
  for (const specification of entries) {
    if (
      !specification ||
      typeof specification.type !== 'string' ||
      !specification.type
    )
      throw Error('算子规格必须有 type');
    if (byType.has(specification.type))
      throw Error(`重复算子类型：${specification.type}`);
    const inputPorts = ports(
      specification.inputPorts || {},
      'inputPorts',
      specification.type,
    );
    const outputPorts = ports(
      specification.outputPorts || {},
      'outputPorts',
      specification.type,
    );
    if (!Object.keys(outputPorts).length)
      throw Error(`${specification.type} 必须发布至少一个输出端口`);
    if (specification.bypass !== undefined) {
      for (const [output, input] of Object.entries(specification.bypass)) {
        if (!outputPorts[output] || !inputPorts[input])
          throw Error(`${specification.type}.bypass 引用未知端口`);
        if (outputPorts[output].domain !== inputPorts[input].domain)
          throw Error(`${specification.type}.bypass 必须保持同一 domain`);
      }
    }
    for (const hook of [
      'validateParams',
      'dependencies',
      'evaluate',
      'rebase',
      'copy',
    ])
      if (
        specification[hook] !== undefined &&
        typeof specification[hook] !== 'function'
      )
        throw Error(`${specification.type}.${hook} 必须是函数`);
    byType.set(
      specification.type,
      Object.freeze({
        ...specification,
        inputPorts: Object.freeze(inputPorts),
        outputPorts: Object.freeze(outputPorts),
        bypass:
          specification.bypass && Object.freeze({ ...specification.bypass }),
      }),
    );
  }
  return Object.freeze({
    get: (type) => byType.get(type),
    has: (type) => byType.has(type),
    types: () => [...byType.keys()],
  });
}
