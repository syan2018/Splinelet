import {
  buildDependencyGraph,
  componentId,
  dependencyFingerprint,
  topologicalComponents,
} from './dependencies.mjs';
import {
  inputFrameTransform,
  identityTransform,
  multiplyTransforms,
} from '../scene/transforms.mjs';
import { transformRegionBoundaries } from '../geometry/tagged-curves.mjs';

const clone = (value) => structuredClone(value);
const freeze = (value) => {
  if (value && typeof value === 'object') {
    // Cached stage DTOs are deeply frozen when stored. Re-walking their often
    // large geometry on every warm evaluation defeats structural sharing.
    if (Object.isFrozen(value)) return value;
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
  return value;
};
const result = (
  domain,
  status,
  value,
  diagnostics = [],
  dependencies = [],
) => ({
  domain,
  status,
  ...(value === undefined ? {} : { value }),
  diagnostics,
  dependencies,
});
const blocked = (domain, code, message, dependencies = []) =>
  result(domain, 'blocked', undefined, [{ code, message }], dependencies);
const absent = (domain, dependencies = []) =>
  result(domain, 'absent', undefined, [], dependencies);
const validStatus = new Set(['ready', 'empty', 'absent', 'blocked']);
const cacheGenerations = new WeakMap();
const nextCacheGeneration = (cache) => {
  const generation = (cacheGenerations.get(cache) || 0) + 1;
  cacheGenerations.set(cache, generation);
  return generation;
};

const transformPoint = ([a, b, c, d, e, f], [x, y]) => [
  a * x + c * y + e,
  b * x + d * y + f,
];
const transformCoordinates = (value, transform) => {
  if (
    Array.isArray(value) &&
    value.length >= 2 &&
    typeof value[0] === 'number' &&
    typeof value[1] === 'number'
  )
    return [...transformPoint(transform, value), ...value.slice(2)];
  return value.map((child) => transformCoordinates(child, transform));
};
const transformCurveSet = (value, transform, ownerNodeId) => ({
  ...clone(value),
  frame: { kind: 'local', ownerNodeId },
  curves: value.curves.map((curve) => ({
    ...clone(curve),
    edges: curve.edges.map((edge) => ({
      ...clone(edge),
      cubic: edge.cubic.map((point) => transformPoint(transform, point)),
      transform: multiplyTransforms(
        transform,
        edge.transform || identityTransform(),
      ),
    })),
  })),
});
const transformRegionSet = (value, transform, ownerNodeId) => ({
  ...clone(value),
  frame: { kind: 'local', ownerNodeId },
  regions: value.regions.map((region) => ({
    ...clone(region),
    geometry: {
      ...clone(region.geometry),
      coordinates: transformCoordinates(region.geometry.coordinates, transform),
    },
    ...(region.boundaries
      ? { boundaries: transformRegionBoundaries(region.boundaries, transform) }
      : {}),
  })),
});
const point = (value) =>
  Array.isArray(value) &&
  value.length >= 2 &&
  value.slice(0, 2).every(Number.isFinite);
const validDto = (domain, value) => {
  if (
    !value ||
    typeof value !== 'object' ||
    value.frame?.kind !== 'local' ||
    typeof value.frame.ownerNodeId !== 'string' ||
    !Array.isArray(value.provenance)
  )
    return false;
  if (domain === 'curves')
    return (
      Array.isArray(value.curves) &&
      Array.isArray(value.junctions) &&
      value.curves.every(
        (curve) =>
          Array.isArray(curve.edges) &&
          curve.edges.every(
            (edge) =>
              Array.isArray(edge.cubic) &&
              edge.cubic.length === 4 &&
              edge.cubic.every(point),
          ),
      )
    );
  return (
    Array.isArray(value.regions) &&
    value.regions.every(
      (region) =>
        ['Polygon', 'MultiPolygon'].includes(region.geometry?.type) &&
        Array.isArray(region.geometry.coordinates),
    )
  );
};
const identity = (transform) =>
  transform.length === 6 &&
  transform.every((value, index) => value === (index % 3 === 0 ? 1 : 0));
const mapInputStage = (
  stage,
  transform,
  ownerNodeId,
  shareImmutableInput = false,
) => {
  if (!['ready', 'empty'].includes(stage.status)) return clone(stage);
  if (!validDto(stage.domain, stage.value))
    return blocked(stage.domain, 'invalid-input-dto', '输入没有合法 DTO');
  // A cached built-in result is a deeply frozen local DTO. When it is already
  // in the consumer frame, it needs neither a coordinate projection nor a
  // defensive copy. Custom registries keep the cloning path below so their
  // evaluators retain the existing mutation isolation.
  if (
    shareImmutableInput &&
    Object.isFrozen(stage) &&
    stage.value.frame.ownerNodeId === ownerNodeId &&
    identity(transform)
  )
    return stage;
  return result(
    stage.domain,
    stage.status,
    stage.domain === 'curves'
      ? transformCurveSet(stage.value, transform, ownerNodeId)
      : transformRegionSet(stage.value, transform, ownerNodeId),
    clone(stage.diagnostics || []),
    clone(stage.dependencies || []),
  );
};

const outputPorts = (component) =>
  component.specification?.outputPorts || component.inferredPorts || {};
const outputFor = (component, port, domain) =>
  component?.ports?.[port] ||
  blocked(domain, 'missing-port', `端口 ${port} 未发布`);
const inputRefs = (operator, name) => operator.inputs?.[name] || [];
// Keep direct causes, not recursively embedded upstream failure trees.
const directDiagnostics = (stage) =>
  (stage?.diagnostics || []).map(
    ({ code, message, componentId, severity }) => ({
      code,
      message,
      ...(componentId && { componentId }),
      ...(severity && { severity }),
    }),
  );

function normalizeOutput(stage, port, definition, component) {
  if (!stage || typeof stage !== 'object' || !validStatus.has(stage.status))
    return blocked(
      definition.domain,
      'invalid-result',
      `${component.operator.type}.${port} 返回无效 StageResult`,
    );
  if (stage.domain !== definition.domain)
    return blocked(
      definition.domain,
      'domain-mismatch',
      `${component.operator.type}.${port} 返回了错误 domain`,
    );
  if (
    ['ready', 'empty'].includes(stage.status) &&
    (!validDto(stage.domain, stage.value) ||
      stage.value.frame.ownerNodeId !== component.ownerNodeId)
  )
    return blocked(
      definition.domain,
      'invalid-result-dto',
      `${component.operator.type}.${port} 返回了无效 DTO`,
    );
  return result(
    stage.domain,
    stage.status,
    ['ready', 'empty'].includes(stage.status) ? clone(stage.value) : undefined,
    clone(stage.diagnostics || []),
    [...new Set([...(stage.dependencies || []), ...component.dependencyKeys])],
  );
}

function bypass(component, inputs) {
  const outputs = {};
  for (const [output, definition] of Object.entries(outputPorts(component))) {
    const input = component.specification.bypass?.[output];
    const stages = input && inputs[input];
    if (!stages || stages.length !== 1)
      outputs[output] = blocked(
        definition.domain,
        'disabled-without-bypass',
        `停用 ${component.operator.type} 没有可用旁路`,
      );
    else {
      const source = stages[0];
      outputs[output] = result(
        definition.domain,
        source.status,
        source.value,
        clone(source.diagnostics),
        source.dependencies,
      );
    }
  }
  return outputs;
}

export function evaluateConstruction(document, options = {}) {
  document = freeze(clone(document));
  const registry = options.registry;
  if (!registry?.get)
    throw Error('evaluateConstruction 需要 operator registry');
  const graph = buildDependencyGraph(document, registry);
  const schedule = topologicalComponents(graph);
  const requestedDomains = options.requestedDomains
    ? new Set(options.requestedDomains)
    : null;
  const scheduled = (() => {
    if (!requestedDomains) return new Set(graph.components.keys());
    const selected = new Set();
    const pending = [];
    for (const component of graph.components.values())
      if (
        Object.values(outputPorts(component)).some((definition) =>
          requestedDomains.has(definition.domain),
        )
      ) {
        selected.add(component.id);
        pending.push(component.id);
      }
    while (pending.length) {
      const id = pending.pop();
      for (const upstream of graph.components.get(id).upstream)
        if (!selected.has(upstream)) {
          selected.add(upstream);
          pending.push(upstream);
        }
    }
    return selected;
  })();
  const order = schedule.order.filter((id) => scheduled.has(id));
  const cycles = schedule.cycles.filter((id) => scheduled.has(id));
  const downstream = schedule.downstream.filter((id) => scheduled.has(id));
  const components = {};
  const diagnostics = [];
  const cache = options.cache || new Map();
  // Built-in resolvers only read the validated document. Custom resolvers can
  // have time-varying results, so retain the conservative materialize-first
  // path unless the caller explicitly opts into early cache reuse.
  const cacheInputStages = options.cacheInputStages === true;
  const generations = new Map();
  for (const id of cache.keys())
    if (!graph.components.has(id)) cache.delete(id);
  const readPort = (ref) => {
    const sourceEntry = graph.byOperator.get(ref.operatorId);
    if (!sourceEntry || sourceEntry.ownerNodeId !== ref.ownerNodeId)
      return blocked(
        ref.domain,
        'invalid-port-owner',
        `PortRef ${ref.operatorId} 不属于 ${ref.ownerNodeId}`,
      );
    const definition = registry.get(sourceEntry.operator.type)?.outputPorts?.[
      ref.port
    ];
    if (definition && definition.domain !== ref.domain)
      return blocked(
        ref.domain,
        'invalid-port-domain',
        `PortRef ${ref.operatorId}.${ref.port} 的 domain 无效`,
      );
    const source = components[componentId(ref.operatorId)];
    return outputFor(source, ref.port, ref.domain);
  };
  const inputGenerationsFor = (component) =>
    Object.fromEntries(
      Object.keys(component.specification?.inputPorts || {}).map((name) => [
        name,
        inputRefs(component.operator, name).map((ref) =>
          ref.kind === 'port'
            ? (generations.get(componentId(ref.operatorId)) ?? null)
            : null,
        ),
      ]),
    );
  const restoreDependencyKeys = (component, cached) => {
    for (const key of cached?.dependencyKeys || []) {
      component.dependencyKeys.add(key);
      graph.dependencyEdges.get(component.id).add(key);
      graph.dependencyNodes.set(key, {
        id: key,
        kind: key.split(':')[0],
      });
    }
  };
  const evaluateComponent = (component) => {
    const ports = outputPorts(component);
    if (!component.specification) {
      components[component.id] = {
        id: component.id,
        ports: Object.fromEntries(
          Object.entries(ports).map(([port, definition]) => [
            port,
            blocked(
              definition.domain,
              'unknown-operator',
              `未知算子：${component.operator.type}`,
            ),
          ]),
        ),
      };
      diagnostics.push({
        code: 'unknown-operator',
        message: `未知算子：${component.operator.type}`,
        componentId: component.id,
      });
      return;
    }
    const cached = cache.get(component.id);
    restoreDependencyKeys(component, cached);
    const inputGenerations = inputGenerationsFor(component);
    const fingerprint = dependencyFingerprint(
      document,
      component,
      options.dependencyValues,
      inputGenerations,
    );
    if (
      cacheInputStages &&
      cached?.fingerprint === fingerprint &&
      cached.specification === component.specification &&
      Number.isInteger(cached.generation)
    ) {
      components[component.id] = cached.component;
      generations.set(component.id, cached.generation);
      return;
    }
    const inputs = {};
    let inputFailure = Object.keys(component.operator.inputs).some(
      (name) => !Object.hasOwn(component.specification.inputPorts, name),
    )
      ? '算子包含未声明的输入端口'
      : null;
    for (const [name, definition] of Object.entries(
      component.specification.inputPorts,
    )) {
      const refs = inputRefs(component.operator, name);
      if (
        (definition.min || 0) > refs.length ||
        (definition.max !== undefined && refs.length > definition.max)
      ) {
        inputFailure ||= `输入端口 ${name} 的基数无效`;
        inputs[name] = [];
        continue;
      }
      const resolveInput = (ref) => {
        if (ref.kind === 'port') {
          const stage = readPort(ref);
          if (stage.domain !== definition.domain)
            return blocked(
              definition.domain,
              'input-domain-mismatch',
              `${name} 收到错误 domain`,
            );
          try {
            return mapInputStage(
              stage,
              inputFrameTransform(document, component.ownerNodeId, ref),
              component.ownerNodeId,
              cacheInputStages,
            );
          } catch (error) {
            return blocked(
              definition.domain,
              'invalid-input-frame',
              error.message,
            );
          }
        }
        if (ref.kind === 'sketch' && options.resolveSketch) {
          const stage = options.resolveSketch({
            document,
            sketchId: ref.sketchId,
            pathIds: clone(ref.pathIds),
            ownerNodeId: component.ownerNodeId,
          });
          if (!stage || stage.domain !== definition.domain)
            return blocked(
              definition.domain,
              'source-domain-mismatch',
              `${name} Source domain 无效`,
            );
          return stage;
        }
        return blocked(
          definition.domain,
          'unsupported-input',
          `${name} 输入类型无效`,
        );
      };
      inputs[name] = refs.map((ref) => {
        try {
          return resolveInput(ref);
        } catch (error) {
          return blocked(
            definition.domain,
            'input-resolution-error',
            error.message,
          );
        }
      });
      if (
        inputs[name].some((stage) =>
          ['blocked', 'absent'].includes(stage.status),
        )
      )
        inputFailure ||= `输入端口 ${name} 不可用`;
    }
    for (const stages of Object.values(inputs))
      for (const stage of stages)
        for (const key of stage.dependencies || []) {
          component.dependencyKeys.add(key);
          graph.dependencyEdges.get(component.id).add(key);
          graph.dependencyNodes.set(key, {
            id: key,
            kind: key.split(':')[0],
          });
        }
    // A caller-provided resolver has no evaluator-owned generation. Retain the
    // prior value-sensitive cache guard for that conservative path, while the
    // built-in path uses lightweight upstream generations above.
    const inputStages = cacheInputStages
      ? undefined
      : Object.fromEntries(
          Object.entries(inputs).map(([name, stages]) => [
            name,
            stages.map((stage) => ({
              domain: stage.domain,
              status: stage.status,
              value: stage.value,
              dependencies: stage.dependencies,
            })),
          ]),
        );
    const materializedFingerprint = dependencyFingerprint(
      document,
      component,
      options.dependencyValues,
      inputGenerations,
      inputStages,
    );
    if (
      cached?.fingerprint === materializedFingerprint &&
      cached.specification === component.specification &&
      Number.isInteger(cached.generation)
    ) {
      components[component.id] = cached.component;
      generations.set(component.id, cached.generation);
      return;
    }
    let outputs;
    try {
      const validation =
        component.operator.enabled === false
          ? undefined
          : component.specification.validateParams?.(
              clone(component.operator.params),
            );
      const parameterFailure =
        validation === false || typeof validation === 'string'
          ? typeof validation === 'string'
            ? validation
            : '参数无效'
          : null;
      if (parameterFailure && !inputFailure)
        outputs = Object.fromEntries(
          Object.entries(ports).map(([port, definition]) => [
            port,
            blocked(definition.domain, 'invalid-params', parameterFailure, [
              ...component.dependencyKeys,
            ]),
          ]),
        );
      else if (inputFailure)
        outputs = Object.fromEntries(
          Object.entries(ports).map(([port, definition]) => [
            port,
            (() => {
              const stage = blocked(
                definition.domain,
                'blocked-input',
                inputFailure,
                [...component.dependencyKeys],
              );
              stage.diagnostics[0].componentId = component.id;
              stage.diagnostics[0].inputs = Object.entries(inputs).flatMap(
                ([name, values]) =>
                  values.flatMap((input, index) =>
                    ['blocked', 'absent'].includes(input.status)
                      ? [
                          {
                            port: name,
                            index,
                            reference: clone(
                              inputRefs(component.operator, name)[index],
                            ),
                            diagnostics: directDiagnostics(input),
                          },
                        ]
                      : [],
                  ),
              );
              if (document.version === 5) {
                const causes = Object.values(inputs)
                  .flat()
                  .flatMap((input) => input.diagnostics || [])
                  .filter((diagnostic) => diagnostic.code !== 'blocked-input');
                stage.diagnostics.push(
                  ...new Map(
                    causes.map((diagnostic) => [
                      JSON.stringify(diagnostic),
                      diagnostic,
                    ]),
                  ).values(),
                );
              }
              return stage;
            })(),
          ]),
        );
      else if (component.operator.enabled === false)
        outputs = bypass(component, inputs);
      else if (component.specification.evaluate)
        outputs = component.specification.evaluate({
          document,
          operator: clone(component.operator),
          ownerNodeId: component.ownerNodeId,
          inputs,
          context: Object.freeze({
            dependencyValues: options.dependencyValues || {},
            resolveSketch: options.resolveSketch,
            resolveScalar: options.resolveScalar,
            resolveDatum: options.resolveDatum,
            resolveRelation: options.resolveRelation,
          }),
        });
      else outputs = {};
    } catch (error) {
      outputs = Object.fromEntries(
        Object.entries(ports).map(([port, definition]) => [
          port,
          blocked(definition.domain, 'operator-error', error.message, [
            ...component.dependencyKeys,
          ]),
        ]),
      );
    }
    const generation = nextCacheGeneration(cache);
    const evaluated = {
      id: component.id,
      inputs: Object.entries(component.operator.inputs).flatMap(
        ([port, refs]) =>
          refs.map((reference, index) => ({
            port,
            index,
            reference: clone(reference),
            status: inputs[port]?.[index]?.status || 'blocked',
            diagnostics: inputs[port]?.[index]
              ? directDiagnostics(inputs[port][index])
              : [
                  {
                    code: 'invalid-input-cardinality',
                    message: `输入端口 ${port} 未声明或基数无效`,
                  },
                ],
          })),
      ),
      ports: Object.fromEntries(
        Object.entries(ports).map(([port, definition]) => [
          port,
          normalizeOutput(
            outputs?.[port] || absent(definition.domain),
            port,
            definition,
            component,
          ),
        ]),
      ),
    };
    components[component.id] = evaluated;
    const cachedComponent = freeze(clone(evaluated));
    cache.set(component.id, {
      fingerprint: materializedFingerprint,
      specification: component.specification,
      component: cachedComponent,
      dependencyKeys: [...component.dependencyKeys].sort((a, b) =>
        a.localeCompare(b),
      ),
      generation,
    });
    generations.set(component.id, generation);
  };

  for (const id of order) evaluateComponent(graph.components.get(id));
  for (const id of cycles) {
    const component = graph.components.get(id);
    components[id] = {
      id,
      ports: Object.fromEntries(
        Object.entries(outputPorts(component)).map(([port, definition]) => [
          port,
          blocked(
            definition.domain,
            'dependency-cycle',
            `依赖环：${cycles.join(' → ')}`,
            [...component.dependencyKeys],
          ),
        ]),
      ),
    };
    diagnostics.push({
      code: 'dependency-cycle',
      message: `依赖环：${cycles.join(' → ')}`,
      componentId: id,
    });
  }
  const pending = new Set(downstream);
  while (pending.size) {
    const ready = [...pending]
      .filter((id) =>
        [...graph.components.get(id).upstream].every(
          (source) => components[source],
        ),
      )
      .sort((a, b) => a.localeCompare(b));
    if (!ready.length) throw Error('依赖图无法在环诊断后完成调度');
    for (const id of ready) {
      pending.delete(id);
      evaluateComponent(graph.components.get(id));
    }
  }

  const published = {};
  for (const program of Object.values(document.programs))
    for (const [name, ref] of Object.entries(program.outputs))
      published[`${program.ownerNodeId}:${name}`] =
        options.requestedDomains &&
        !options.requestedDomains.includes(ref.domain)
          ? absent(ref.domain)
          : readPort(ref);
  return freeze({ components, published, diagnostics });
}
