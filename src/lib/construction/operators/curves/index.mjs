import { resolveJoinPairs } from './join-selection.mjs';
import {
  assertTransform,
  identityTransform,
  inverseTransform,
  matrixPose,
  multiplyTransforms,
  transformPoint,
} from '../../../scene/transforms.mjs';
import { transformScalarPoint } from '../../../scene/rebase.mjs';
import { curveFilterOperator } from './filter.mjs';
import { validateJoinParams } from '../../../document/join-params.mjs';

const sort = (a, b) => String(a).localeCompare(String(b));
const clone = (value) => structuredClone(value);
const diag = (code, message) => ({ code, message });
const stage = (status, value, diagnostics = [], dependencies = []) => ({
  domain: 'curves',
  status,
  ...(value === undefined ? {} : { value }),
  diagnostics,
  dependencies: [...new Set(dependencies)].sort(sort),
});
const blocked = (code, message, dependencies = []) =>
  stage('blocked', undefined, [diag(code, message)], dependencies);
const curveSet = (
  ownerNodeId,
  curves = [],
  junctions = [],
  provenance = [],
) => ({
  frame: { kind: 'local', ownerNodeId },
  curves,
  junctions,
  provenance,
});
const stageInput = (inputs, name = 'input') => {
  const values = inputs?.[name] || [];
  if (values.length !== 1)
    return blocked('input-count', `${name} 必须恰有一个曲线输入`);
  return values[0];
};
const withInput = (
  input,
  ownerNodeId,
  transform = identityTransform(),
  instance,
) => {
  if (input.status !== 'ready' && input.status !== 'empty')
    return stage(
      input.status,
      input.value,
      clone(input.diagnostics || []),
      input.dependencies,
    );
  const source = input.value || curveSet(ownerNodeId);
  const edgeKeys = new Map();
  const mapEdge = (edge) => ({
    ...clone(edge),
    key: instance
      ? `${edge.key}@${instance.operatorId}:${instance.index}`
      : edge.key,
    startKey: instance
      ? `${edge.startKey}@${instance.operatorId}:${instance.index}`
      : edge.startKey,
    endKey: instance
      ? `${edge.endKey}@${instance.operatorId}:${instance.index}`
      : edge.endKey,
    cubic: edge.cubic.map((point) => transformPoint(transform, point)),
    transform: multiplyTransforms(
      transform,
      edge.transform || identityTransform(),
    ),
    ...(instance ? { instances: [...(edge.instances || []), instance] } : {}),
  });
  const mapCurve = (curve) => {
    const edges = curve.edges.map((edge) => {
      const next = mapEdge(edge);
      edgeKeys.set(edge.key, next.key);
      return next;
    });
    return {
      ...clone(curve),
      key: instance
        ? `${curve.key}@${instance.operatorId}:${instance.index}`
        : curve.key,
      edges,
    };
  };
  const value = curveSet(
    ownerNodeId,
    source.curves.map(mapCurve),
    (source.junctions || []).map((junction) => ({
      ...clone(junction),
      id: instance
        ? `${junction.id}@${instance.operatorId}:${instance.index}`
        : junction.id,
      endpoints: junction.endpoints.map((endpoint) => ({
        ...endpoint,
        edgeKey: edgeKeys.get(endpoint.edgeKey) || endpoint.edgeKey,
      })),
    })),
    clone(source.provenance || []),
  );
  return stage(
    value.curves.length ? 'ready' : 'empty',
    value,
    clone(input.diagnostics || []),
    input.dependencies,
  );
};

/** Resolves exactly the selected Sketch paths; an unrelated broken path stays out of Source. */
export function resolveSourceSketch({
  document,
  input,
  ownerNodeId,
  resolveSketch,
}) {
  if (input?.kind !== 'sketch' || typeof resolveSketch !== 'function')
    return blocked(
      'invalid-source-input',
      'Source 需要 Sketch InputRef 和 resolveSketch',
    );
  let resolved;
  try {
    resolved = resolveSketch({
      document,
      sketchId: input.sketchId,
      pathIds: input.pathIds,
      ownerNodeId,
    });
  } catch (error) {
    return blocked('source-resolve-error', error.message);
  }
  if (!resolved || resolved.domain !== 'curves')
    return blocked(
      'source-domain-mismatch',
      'resolveSketch 未返回曲线 StageResult',
    );
  if (resolved.status !== 'ready' && resolved.status !== 'empty')
    return resolved;
  const wanted = input.pathIds ? new Set(input.pathIds) : null;
  const curves = (resolved.value?.curves || []).filter(
    (curve) => !wanted || wanted.has(curve.pathRef?.id),
  );
  return stage(
    curves.length ? 'ready' : 'empty',
    curveSet(
      ownerNodeId,
      curves,
      [],
      [{ kind: 'source', sketchId: input.sketchId }],
    ),
    clone(resolved.diagnostics || []),
    resolved.dependencies || [],
  );
}
const scalar = (value, context, label) => {
  if (Number.isFinite(value)) return value;
  const resolver = context?.resolveScalar;
  if (typeof resolver !== 'function')
    throw Error(`${label} 需要 resolveScalar`);
  const resolved = resolver({ value, label });
  const number = typeof resolved === 'number' ? resolved : resolved?.value;
  if (!Number.isFinite(number)) throw Error(`${label} 未解析为有限数`);
  return number;
};
const point = (value, context, label) => {
  if (!Array.isArray(value) || value.length !== 2)
    throw Error(`${label} 必须是两个 Scalar`);
  return [
    scalar(value[0], context, `${label}[0]`),
    scalar(value[1], context, `${label}[1]`),
  ];
};
const translate = ([x, y]) => [1, 0, 0, 1, x, y];
const rotate = (angle) => [
  Math.cos(angle),
  Math.sin(angle),
  -Math.sin(angle),
  Math.cos(angle),
  0,
  0,
];
const mirrorMatrix = (center, angle) =>
  multiplyTransforms(
    translate(center),
    multiplyTransforms(
      rotate(angle),
      multiplyTransforms(
        [1, 0, 0, -1, 0, 0],
        multiplyTransforms(rotate(-angle), translate([-center[0], -center[1]])),
      ),
    ),
  );
const arrayMatrix = (center, angle) =>
  multiplyTransforms(
    translate(center),
    multiplyTransforms(rotate(angle), translate([-center[0], -center[1]])),
  );
const operatorId = (operator) => operator?.id || 'operator';
const assertCount = (value) => {
  if (!Number.isInteger(value) || value < 1 || value > 4096)
    throw Error('count 必须为 1 到 4096 的整数');
  return value;
};
const rebaseCenterAngle = (operator, args) => {
  const params = clone(operator.params || {});
  if (
    !Array.isArray(params.center) ||
    params.center.length !== 2 ||
    params.angleRad === undefined
  )
    throw Error(`${operator.type} 缺少 center 或 angleRad`);
  const pose = matrixPose(args.transform);
  const angle =
    operator.type === 'curve-array'
      ? params.angleRad
      : typeof params.angleRad === 'number'
        ? params.angleRad + pose.rotationRad
        : {
            kind: 'expression',
            op: 'add',
            args: [params.angleRad, pose.rotationRad],
          };
  return {
    ...clone(operator),
    params: {
      ...params,
      center: transformScalarPoint(args.transform, params.center),
      angleRad: angle,
    },
  };
};
const remap = (id, idMap) =>
  (idMap instanceof Map ? idMap.get(id) : idMap?.[id]) || id;
const remapScalar = (value, idMap) => {
  if (!value || typeof value !== 'object') return value;
  if (value.kind === 'parameter')
    return { ...value, id: remap(value.id, idMap) };
  if (value.kind === 'expression')
    return {
      ...value,
      args: value.args.map((item) => remapScalar(item, idMap)),
    };
  return clone(value);
};
const scalarDependencies = (value, result = new Set()) => {
  if (!value || typeof value !== 'object') return result;
  if (value.kind === 'parameter') result.add(`parameter:${value.id}`);
  else if (value.kind === 'expression')
    for (const item of value.args || []) scalarDependencies(item, result);
  return result;
};
const positionDependencies = (params) => {
  const center = Array.isArray(params?.center) ? params.center : [];
  return [
    ...new Set([
      ...center.flatMap((value) => [...scalarDependencies(value)]),
      ...scalarDependencies(params?.angleRad),
      ...scalarDependencies(params?.count),
    ]),
  ].sort(sort);
};
/** Field-aware hook for scene copy; it never text-replaces IDs. */
export function copyCurveOperator(operator, { idMap = {} } = {}) {
  const copied = clone(operator);
  const params = copied.params || {};
  if (['curve-mirror', 'curve-array'].includes(copied.type)) {
    if (Array.isArray(params.center))
      params.center = params.center.map((item) => remapScalar(item, idMap));
    if (params.angleRad !== undefined)
      params.angleRad = remapScalar(params.angleRad, idMap);
    if (params.count !== undefined)
      params.count = remapScalar(params.count, idMap);
  }
  if (copied.type === 'join')
    for (const connection of params.connections || [])
      for (const endpoint of [connection.a, connection.b]) {
        if (endpoint?.edgeEnd) {
          endpoint.edgeEnd.sketchId = remap(endpoint.edgeEnd.sketchId, idMap);
          endpoint.edgeEnd.edgeId = remap(endpoint.edgeEnd.edgeId, idMap);
        }
        if (endpoint?.selector?.operatorId)
          endpoint.selector.operatorId = remap(
            endpoint.selector.operatorId,
            idMap,
          );
        for (const instance of endpoint?.instances || [])
          instance.operatorId = remap(instance.operatorId, idMap);
      }
  return copied;
}

/** Combine published branches without introducing instances or losing Join topology. */
export const curveCollectOperator = {
  type: 'curve-collect',
  inputPorts: { input: { domain: 'curves', min: 0 } },
  outputPorts: { curves: { domain: 'curves' } },
  validateParams: (params) =>
    Object.keys(params || {}).length === 0 || 'curve-collect 不接受几何参数',
  rebase: (operator) => clone(operator),
  copy: copyCurveOperator,
  evaluate: ({ ownerNodeId, inputs }) => {
    const values = inputs.input || [];
    const dependencies = values.flatMap((value) => value.dependencies || []);
    if (values.some((value) => !['ready', 'empty'].includes(value.status)))
      return {
        curves: blocked(
          'collect-blocked',
          '汇总曲线存在不可用的输入',
          dependencies,
        ),
      };
    const curves = values.flatMap((value) => value.value?.curves || []);
    const junctions = values.flatMap((value) => value.value?.junctions || []);
    const keys = curves.flatMap((curve) => curve.edges.map((edge) => edge.key));
    if (
      new Set(keys).size !== keys.length ||
      new Set(curves.map((curve) => curve.key)).size !== curves.length ||
      new Set(junctions.map((junction) => junction.id)).size !==
        junctions.length
    )
      return {
        curves: blocked(
          'duplicate-source',
          '汇总输入重复包含曲线或接合身份',
          dependencies,
        ),
      };
    return {
      curves: stage(
        curves.length ? 'ready' : 'empty',
        curveSet(
          ownerNodeId,
          clone(curves),
          clone(junctions),
          values.flatMap((value) => clone(value.value?.provenance || [])),
        ),
        values.flatMap((value) => clone(value.diagnostics || [])),
        dependencies,
      ),
    };
  },
};

export const sourceOperator = {
  type: 'source',
  inputPorts: { paths: { domain: 'curves', min: 1 } },
  outputPorts: { curves: { domain: 'curves' } },
  validateParams: (params) =>
    Object.keys(params || {}).length === 0 || 'source 不接受 params',
  evaluate: ({ ownerNodeId, inputs, operator }) => {
    const values = inputs?.paths || [];
    if (
      values.some(
        (item) => item.status === 'blocked' || item.status === 'absent',
      )
    )
      return {
        curves: blocked('source-blocked', '选定 Source path 无法解算'),
      };
    const ready = values.filter((item) => item.status === 'ready');
    const diagnostics = values.flatMap((item) => item.diagnostics || []);
    const dependencies = values.flatMap((item) => item.dependencies || []);
    const curves = ready.flatMap((item) => item.value?.curves || []);
    return {
      curves: stage(
        curves.length ? 'ready' : 'empty',
        curveSet(
          ownerNodeId,
          values.flatMap((item, index) => {
            if (item.status !== 'ready') return [];
            return withInput(item, ownerNodeId, identityTransform(), {
              operatorId: operator.id,
              index,
            }).value.curves;
          }),
          [],
          [{ kind: 'source' }],
        ),
        diagnostics,
        dependencies,
      ),
    };
  },
  rebase: (operator) => clone(operator),
  copy: copyCurveOperator,
};

export const curveReferenceOperator = {
  type: 'curve-reference',
  bypass: { curves: 'input' },
  inputPorts: { input: { domain: 'curves', min: 1, max: 1 } },
  outputPorts: { curves: { domain: 'curves' } },
  validateParams: (params) =>
    Object.keys(params || {}).length === 0 || 'curve-reference 不接受 params',
  evaluate: ({ ownerNodeId, inputs }) => ({
    curves: withInput(stageInput(inputs), ownerNodeId, identityTransform(), {
      operatorId: 'curve-reference',
      index: 0,
    }),
  }),
  rebase: (operator) => clone(operator),
  copy: copyCurveOperator,
};

export const curveTransformOperator = {
  type: 'curve-transform',
  bypass: { curves: 'input' },
  inputPorts: { input: { domain: 'curves', min: 1, max: 1 } },
  outputPorts: { curves: { domain: 'curves' } },
  validateParams: (params) => {
    assertTransform(params?.transform);
  },
  evaluate: ({ ownerNodeId, inputs, operator }) => ({
    curves: withInput(
      stageInput(inputs),
      ownerNodeId,
      assertTransform(operator.params.transform),
    ),
  }),
  rebase: (operator, args) => {
    const matrix = assertTransform(operator.params?.transform);
    const g = assertTransform(args.transform);
    return {
      ...clone(operator),
      params: {
        ...clone(operator.params),
        transform: multiplyTransforms(
          g,
          multiplyTransforms(matrix, inverseTransform(g)),
        ),
      },
    };
  },
  copy: copyCurveOperator,
};

export const curveMirrorOperator = {
  type: 'curve-mirror',
  bypass: { curves: 'input' },
  inputPorts: { input: { domain: 'curves', min: 1, max: 1 } },
  outputPorts: { curves: { domain: 'curves' } },
  validateParams: (params) =>
    (Array.isArray(params?.center) &&
      params.center.length === 2 &&
      params.angleRad !== undefined) ||
    'mirror 需要 center 和 angleRad',
  dependencies: ({ operator }) => positionDependencies(operator.params),
  evaluate: ({ ownerNodeId, inputs, operator, context }) => {
    const input = stageInput(inputs);
    if (input.status !== 'ready' && input.status !== 'empty')
      return { curves: input };
    const matrix = mirrorMatrix(
      point(operator.params.center, context, 'center'),
      scalar(operator.params.angleRad, context, 'angleRad'),
    );
    const original = withInput(input, ownerNodeId, identityTransform(), {
      operatorId: operatorId(operator),
      index: 0,
    });
    const reflected = withInput(input, ownerNodeId, matrix, {
      operatorId: operatorId(operator),
      index: 1,
    });
    const value = curveSet(
      ownerNodeId,
      [...original.value.curves, ...reflected.value.curves],
      [...original.value.junctions, ...reflected.value.junctions],
      [{ kind: 'mirror', operatorId: operatorId(operator) }],
    );
    return {
      curves: stage(
        value.curves.length ? 'ready' : 'empty',
        value,
        [...original.diagnostics, ...reflected.diagnostics],
        [...original.dependencies, ...reflected.dependencies],
      ),
    };
  },
  rebase: rebaseCenterAngle,
  copy: copyCurveOperator,
};

export const curveArrayOperator = {
  type: 'curve-array',
  bypass: { curves: 'input' },
  inputPorts: { input: { domain: 'curves', min: 1, max: 1 } },
  outputPorts: { curves: { domain: 'curves' } },
  validateParams: (params) =>
    (Array.isArray(params?.center) &&
      params.center.length === 2 &&
      params.angleRad !== undefined &&
      params.count !== undefined) ||
    'array 需要 center、angleRad 和 count',
  dependencies: ({ operator }) => positionDependencies(operator.params),
  evaluate: ({ ownerNodeId, inputs, operator, context }) => {
    const input = stageInput(inputs);
    if (input.status !== 'ready' && input.status !== 'empty')
      return { curves: input };
    const center = point(operator.params.center, context, 'center');
    const angle = scalar(operator.params.angleRad, context, 'angleRad');
    const count = assertCount(scalar(operator.params.count, context, 'count'));
    const copies = [],
      junctions = [];
    for (let index = 0; index < count; index++) {
      const transformed = withInput(
        input,
        ownerNodeId,
        arrayMatrix(center, angle * index),
        { operatorId: operatorId(operator), index },
      );
      copies.push(...transformed.value.curves);
      junctions.push(...transformed.value.junctions);
    }
    const value = curveSet(ownerNodeId, copies, junctions, [
      { kind: 'array', operatorId: operatorId(operator), count },
    ]);
    return {
      curves: stage(
        copies.length ? 'ready' : 'empty',
        value,
        clone(input.diagnostics || []),
        input.dependencies,
      ),
    };
  },
  rebase: rebaseCenterAngle,
  copy: copyCurveOperator,
};

export const joinOperator = {
  type: 'join',
  bypass: { curves: 'input' },
  inputPorts: { input: { domain: 'curves', min: 1, max: 1 } },
  outputPorts: { curves: { domain: 'curves' } },
  validateParams: validateJoinParams,
  evaluate: ({ document, ownerNodeId, inputs, operator }) => {
    const input = stageInput(inputs);
    if (input.status !== 'ready' && input.status !== 'empty')
      return { curves: input };
    const source = withInput(input, ownerNodeId);
    const value = source.value;
    const edges = value.curves.flatMap((curve) => curve.edges);
    const junctions = [];
    const diagnostics = [...source.diagnostics];
    const tolerance = document.geometrySettings.joinToleranceMM;
    for (const [connectionIndex, connection] of (
      operator.params.connections || []
    ).entries()) {
      const left = connection?.a;
      const right = connection?.b;
      if (!left?.edgeEnd || !right?.edgeEnd) {
        diagnostics.push(
          diag('invalid-join', `Join ${connectionIndex} 缺少端点或实例选择器`),
        );
        continue;
      }
      for (const { a, b, iteration } of resolveJoinPairs(edges, connection)) {
        if (!a || !b) {
          diagnostics.push(
            diag('join-selector-empty', `Join ${connectionIndex} 未选择到实例`),
          );
          continue;
        }
        const pointA = a.cubic[left.edgeEnd.end === 'start' ? 0 : 3];
        const pointB = b.cubic[right.edgeEnd.end === 'start' ? 0 : 3];
        if (
          Math.hypot(pointA[0] - pointB[0], pointA[1] - pointB[1]) > tolerance
        ) {
          diagnostics.push(
            diag(
              'join-gap',
              `Join ${connectionIndex} 端点超过 joinToleranceMM`,
            ),
          );
          continue;
        }
        junctions.push({
          id: `${operatorId(operator)}:${connectionIndex}:${iteration}`,
          endpoints: [
            { edgeKey: a.key, end: left.edgeEnd.end },
            { edgeKey: b.key, end: right.edgeEnd.end },
          ],
        });
      }
    }
    value.junctions = [...(value.junctions || []), ...junctions];
    return {
      curves: stage(
        value.curves.length ? 'ready' : 'empty',
        value,
        diagnostics,
        source.dependencies,
      ),
    };
  },
  rebase: (operator) => clone(operator),
  copy: copyCurveOperator,
};

export const curveOperatorSpecifications = [
  sourceOperator,
  curveFilterOperator,
  curveCollectOperator,
  curveReferenceOperator,
  curveTransformOperator,
  curveMirrorOperator,
  curveArrayOperator,
  joinOperator,
];
