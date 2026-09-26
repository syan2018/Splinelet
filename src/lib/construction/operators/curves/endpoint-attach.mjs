import { sampleTaggedCurves } from '../../../geometry/tagged-curves.mjs';
import {
  connectPartitionCutters,
  validatePartitionEndpointJoin,
} from '../regions/partition-connect.mjs';
import { readGeometry } from '../../../region-engine.mjs';

const clone = (value) => structuredClone(value);
const stage = (status, value, diagnostics = [], dependencies = []) => ({
  domain: 'curves',
  status,
  ...(value ? { value } : {}),
  diagnostics,
  dependencies,
});
const attachment = (edge, connection, operatorId) => {
  const direction = Math.sign(edge.basisSpan[1] - edge.basisSpan[0]);
  const endpoint = edge.basisSpan[connection.endpoint ? 1 : 0];
  const before = connection.endpoint === 0;
  return {
    ...clone(edge),
    key: `${edge.key}:endpoint-attach:${operatorId}:${connection.endpoint}`,
    startKey: `${edge.startKey}:endpoint-attach:${operatorId}:${connection.endpoint}:start`,
    endKey: `${edge.endKey}:endpoint-attach:${operatorId}:${connection.endpoint}:end`,
    cubic: before
      ? [
          connection.extended,
          connection.extended,
          connection.from,
          connection.from,
        ]
      : [
          connection.from,
          connection.from,
          connection.extended,
          connection.extended,
        ],
    basisSpan: before
      ? [endpoint - direction, endpoint]
      : [endpoint, endpoint + direction],
    generatedAttachment: { operatorId, endpoint: connection.endpoint },
  };
};

export const curveEndpointAttachOperator = {
  type: 'curve-endpoint-attach',
  inputPorts: {
    input: { domain: 'curves', min: 1, max: 1 },
    boundary: { domain: 'regions', min: 1, max: 1 },
  },
  outputPorts: { curves: { domain: 'curves' } },
  bypass: { curves: 'input' },
  validateParams: (params) =>
    Object.keys(params || {}).length === 1 &&
    Object.hasOwn(params, 'endpointJoin')
      ? validatePartitionEndpointJoin(params.endpointJoin)
      : '接边修改器只接受 endpointJoin',
  dependencies: () => ['settings:geometry'],
  rebase: (operator) => clone(operator),
  copy: (operator) => clone(operator),
  evaluate: ({ document, operator, inputs }) => {
    const input = inputs.input?.[0];
    const boundary = inputs.boundary?.[0];
    if (!input || !boundary)
      return {
        curves: stage('blocked', null, [
          {
            code: 'input-count',
            message: 'endpoint attach 需要 input 和 boundary',
          },
        ]),
      };
    if (!['ready', 'empty'].includes(input.status))
      return { curves: clone(input) };
    if (input.status === 'empty') return { curves: clone(input) };
    if (boundary.status !== 'ready')
      return {
        curves: stage(
          boundary.status === 'empty' ? 'blocked' : boundary.status,
          null,
          clone(boundary.diagnostics || []),
          clone(boundary.dependencies || []),
        ),
      };
    const policy = operator.params?.endpointJoin;
    const valid = validatePartitionEndpointJoin(policy);
    if (valid !== true) throw Error(valid);
    if (!policy || policy.toleranceMM === 0) return { curves: clone(input) };
    const byCurve = input.value.curves.map((curve) => ({
      id: curve.pathRef?.id || curve.key,
      curve,
      segments: sampleTaggedCurves(
        { ...input.value, curves: [curve] },
        {
          operatorId: operator.id,
          role: 'cutter',
          toleranceMM: document.geometrySettings.curveToleranceMM,
        },
      ),
    }));
    const connected = connectPartitionCutters({
      baseGeometries: boundary.value.regions.map((region) =>
        readGeometry(region.geometry),
      ),
      cutters: byCurve.map((item) => ({
        ...item,
        coordinates: item.segments.length
          ? [
              item.segments[0].coordinates[0],
              ...item.segments.map((segment) => segment.coordinates[1]),
            ]
          : [],
      })),
      endpointJoin: policy,
    });
    const value = clone(input.value);
    for (const connection of connected.connections) {
      const curve = value.curves.find(
        (item) => (item.pathRef?.id || item.key) === connection.pathId,
      );
      const original = connection.endpoint
        ? curve.edges.at(-1)
        : curve.edges[0];
      const generated = attachment(original, connection, operator.id);
      curve.edges = connection.endpoint
        ? [...curve.edges, generated]
        : [generated, ...curve.edges];
    }
    return {
      curves: stage(
        value.curves.length ? 'ready' : 'empty',
        value,
        connected.diagnostics,
        [
          ...(input.dependencies || []),
          ...(boundary.dependencies || []),
          'settings:geometry',
        ],
      ),
    };
  },
};
