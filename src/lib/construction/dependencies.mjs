import { worldMatrix } from '../scene/transforms.mjs';

const clone = (value) => structuredClone(value);
const sortText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

export function stableFingerprint(value, seen = new Map()) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (seen.has(value)) return `@${seen.get(value)}`;
  seen.set(value, seen.size);
  if (Array.isArray(value))
    return `[${value.map((item) => stableFingerprint(item, seen)).join(',')}]`;
  return `{${Object.keys(value)
    .sort(sortText)
    .map(
      (key) => `${JSON.stringify(key)}:${stableFingerprint(value[key], seen)}`,
    )
    .join(',')}}`;
}

export const componentId = (operatorId) => `operator:${operatorId}`;
export const outputDependency = (operatorId, port) =>
  `operator:${operatorId}:${port}`;

const values = (value) =>
  value instanceof Map ? (key) => value.get(key) : (key) => value?.[key];
const operatorIndex = (document) => {
  const index = new Map();
  for (const program of Object.values(document.programs))
    for (const operator of Object.values(program.operators))
      index.set(operator.id, { operator, ownerNodeId: program.ownerNodeId });
  return index;
};

export function dependencyValue(document, key, supplied = {}) {
  const suppliedValue = values(supplied)(key);
  if (suppliedValue !== undefined) return suppliedValue;
  if (key === 'settings:geometry') return document.geometrySettings;
  const separator = key.indexOf(':');
  const kind = key.slice(0, separator),
    id = key.slice(separator + 1);
  if (kind === 'node' && id.endsWith(':world'))
    return worldMatrix(document, id.slice(0, -6));
  if (kind === 'sketch') return document.sketches[id];
  if (kind === 'datum') return document.datums[id];
  if (kind === 'parameter') return document.parameters[id];
  if (kind === 'relation') return document.relations[id];
  if (kind === 'operator') {
    const operators = Object.values(document.programs).flatMap((program) =>
      Object.values(program.operators),
    );
    // IDs may contain colons. Match the longest actual entity ID, not split(':').
    return operators
      .filter(
        (operator) => id === operator.id || id.startsWith(`${operator.id}:`),
      )
      .sort((a, b) => b.id.length - a.id.length)[0];
  }
  return undefined;
}

export function buildDependencyGraph(document, registry) {
  const byOperator = operatorIndex(document);
  const inferredPorts = new Map();
  const rememberPort = (ref) => {
    if (ref?.kind !== 'port') return;
    const ports = inferredPorts.get(ref.operatorId) || {};
    ports[ref.port] ||= { domain: ref.domain };
    inferredPorts.set(ref.operatorId, ports);
  };
  for (const program of Object.values(document.programs)) {
    for (const ref of Object.values(program.outputs)) rememberPort(ref);
    for (const operator of Object.values(program.operators))
      for (const refs of Object.values(operator.inputs || {}))
        for (const ref of refs || []) rememberPort(ref);
  }
  const components = new Map();
  const dependencyNodes = new Map();
  const dependencyEdges = new Map();
  for (const [operatorId, entry] of byOperator) {
    const specification = registry.get(entry.operator.type);
    const upstream = new Set();
    const dependencyKeys = new Set();
    for (const refs of Object.values(entry.operator.inputs || {}))
      for (const ref of refs || []) {
        if (ref.kind === 'port') {
          if (byOperator.has(ref.operatorId))
            upstream.add(componentId(ref.operatorId));
          dependencyKeys.add(outputDependency(ref.operatorId, ref.port));
          if (ref.space === 'world-result') {
            dependencyKeys.add(`node:${entry.ownerNodeId}:world`);
            const source = byOperator.get(ref.operatorId);
            if (source) dependencyKeys.add(`node:${source.ownerNodeId}:world`);
          }
        } else if (ref.kind === 'sketch')
          dependencyKeys.add(`sketch:${ref.sketchId}`);
      }
    if (specification?.dependencies)
      for (const key of specification.dependencies({
        document,
        operator: clone(entry.operator),
        ownerNodeId: entry.ownerNodeId,
      }) || [])
        dependencyKeys.add(key);
    const id = componentId(operatorId);
    components.set(id, {
      id,
      operatorId,
      operator: entry.operator,
      ownerNodeId: entry.ownerNodeId,
      specification,
      inferredPorts: inferredPorts.get(operatorId) || {},
      upstream,
      dependencyKeys,
    });
    dependencyEdges.set(id, dependencyKeys);
    for (const key of dependencyKeys) {
      const [kind] = key.split(':');
      dependencyNodes.set(key, { id: key, kind });
    }
  }
  const dependents = new Map(
    [...components.keys()].map((id) => [id, new Set()]),
  );
  for (const component of components.values())
    for (const source of component.upstream)
      if (dependents.has(source)) dependents.get(source).add(component.id);
  return {
    components,
    dependents,
    byOperator,
    dependencyNodes,
    dependencyEdges,
  };
}

export function topologicalComponents(graph) {
  const incoming = new Map(
    [...graph.components.values()].map((component) => [
      component.id,
      new Set([...component.upstream].filter((id) => graph.components.has(id))),
    ]),
  );
  const queue = [...incoming.entries()]
    .filter(([, sources]) => !sources.size)
    .map(([id]) => id)
    .sort(sortText);
  const order = [];
  while (queue.length) {
    const id = queue.shift();
    order.push(id);
    for (const target of graph.dependents.get(id) || []) {
      const sources = incoming.get(target);
      sources.delete(id);
      if (!sources.size) queue.push(target);
    }
    queue.sort(sortText);
  }
  const remaining = new Set(
    [...incoming].filter(([, sources]) => sources.size).map(([id]) => id),
  );
  const index = new Map();
  const low = new Map();
  const stack = [];
  const onStack = new Set();
  const cycles = new Set();
  let nextIndex = 0;
  const visit = (id) => {
    index.set(id, nextIndex);
    low.set(id, nextIndex++);
    stack.push(id);
    onStack.add(id);
    for (const source of graph.components.get(id).upstream) {
      if (!remaining.has(source)) continue;
      if (!index.has(source)) {
        visit(source);
        low.set(id, Math.min(low.get(id), low.get(source)));
      } else if (onStack.has(source))
        low.set(id, Math.min(low.get(id), index.get(source)));
    }
    if (low.get(id) !== index.get(id)) return;
    const group = [];
    while (true) {
      const member = stack.pop();
      onStack.delete(member);
      group.push(member);
      if (member === id) break;
    }
    if (group.length > 1 || graph.components.get(id).upstream.has(id))
      group.forEach((member) => cycles.add(member));
  };
  for (const id of [...remaining].sort(sortText)) if (!index.has(id)) visit(id);
  return {
    order,
    cycles: [...cycles].sort(sortText),
    downstream: [...remaining].filter((id) => !cycles.has(id)).sort(sortText),
  };
}

export function dependencyFingerprint(
  document,
  component,
  supplied,
  inputStages = {},
) {
  const stageKeys = Object.values(inputStages)
    .flat()
    .flatMap((stage) => stage.dependencies || []);
  const dependencies = [...new Set([...component.dependencyKeys, ...stageKeys])]
    .sort(sortText)
    .map((key) => [key, dependencyValue(document, key, supplied)]);
  return stableFingerprint({
    operator: component.operator,
    dependencies,
    inputStages,
  });
}
