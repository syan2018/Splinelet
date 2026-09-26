import {
  buildTaggedArrangement,
  extractTaggedBoundary,
} from '../../../geometry/tagged-arrangement.mjs';
import {
  sampleTaggedCurves,
  sampleTaggedCubic,
  taggedCurveSource,
  boundarySegments,
  transformRegionBoundaries,
} from '../../../geometry/tagged-curves.mjs';
import {
  readGeometry,
  polygonParts,
  MIN_REGION_AREA_MM2,
} from '../../../region-engine.mjs';
import { closedCurveRings } from './fill.mjs';
import { betweenGeometry } from './between-geometry.mjs';
import { connectPartitionCutters } from './partition-connect.mjs';
import { resolveRegionDefinitions } from '../../region-definitions.mjs';
import { resolveRegionScope } from '../../provenance.mjs';
import { outputIdentity } from '../../output-identity.mjs';
import GeoJSONWriter from 'jsts/org/locationtech/jts/io/GeoJSONWriter.js';

const writer = new GeoJSONWriter();
const clone = (value) => structuredClone(value);
const pointEqual = (a, b) => a[0] === b[0] && a[1] === b[1];
const stage = (ownerNodeId, regions, dependencies = [], diagnostics = []) => ({
  domain: 'regions',
  status: regions.length ? 'ready' : 'empty',
  value: { frame: { kind: 'local', ownerNodeId }, regions, provenance: [] },
  dependencies,
  diagnostics,
});
const candidate = (geometry, boundaries, selector = null, parents = []) => ({
  geometry,
  boundaries,
  selector: selector || { kind: 'cell' },
  parents,
});
const scoped = (input, scope) => {
  const result = resolveRegionScope(
    input.value.regions,
    scope || { kind: 'all' },
  );
  if (result.status !== 'ready')
    throw Error(result.diagnostics.map((item) => item.message).join('；'));
  return result;
};
const sample = (curves, operator, settings, role = 'input') =>
  sampleTaggedCurves(curves, {
    operatorId: operator.id,
    role,
    toleranceMM: settings.curveToleranceMM,
  });
const arrange = (segments, settings) =>
  buildTaggedArrangement({
    segments,
    precisionScale: 1 / settings.numericTolerance,
  });
const taggedGenerated = (coordinates, source, direction = 1) =>
  coordinates.slice(1).map((point, index) => ({
    coordinates: [coordinates[index], point],
    source,
    sourceParameter: [direction * index, direction * (index + 1)],
  }));
const pointOf = (geometry) => readGeometry(geometry).getInteriorPoint();

function unionCandidates(arrangement, selectedIds) {
  const boundary = extractTaggedBoundary(arrangement, selectedIds);
  if (boundary.diagnostics.length) throw Error('构面边界不满足流形条件');
  const parts = boundary.exterior.map((ring) => ({
    shell: readGeometry({ type: 'Polygon', coordinates: [ring.coordinates] }),
    coordinates: [ring.coordinates],
    boundary: { outer: ring.edges, holes: [] },
  }));
  for (const hole of boundary.holes) {
    const interior = pointOf({
      type: 'Polygon',
      coordinates: [hole.coordinates],
    });
    const parent = parts
      .filter((part) => part.shell.covers(interior))
      .sort((a, b) => a.shell.getArea() - b.shell.getArea())[0];
    if (!parent) throw Error('孔洞没有外边界');
    parent.coordinates.push(hole.coordinates);
    parent.boundary.holes.push(hole.edges);
  }
  return parts.map((part) => {
    const geometry = { type: 'Polygon', coordinates: part.coordinates };
    if (!readGeometry(geometry).isValid()) throw Error('构造得到无效区域');
    return candidate(geometry, [part.boundary]);
  });
}

/** Union an explicitly selected set, retaining its source boundary provenance. */
export function unionSelectedRegions(regions, settings) {
  const graph = arrange(regions.flatMap(boundarySegments), settings);
  const geometries = regions.map((region) => readGeometry(region.geometry));
  const parts = unionCandidates(
    graph,
    graph.faces
      .filter((face) =>
        geometries.some((geometry) => geometry.covers(pointOf(face.geometry))),
      )
      .map((face) => face.id),
  );
  return parts.length
    ? candidate(
        combineGeometry(parts),
        parts.flatMap((part) => part.boundaries),
        { kind: 'result', role: 'selection' },
      )
    : null;
}

const winding = (point, ring) => {
  let count = 0;
  for (let i = 1; i < ring.length; i++) {
    const a = ring[i - 1],
      b = ring[i];
    const cross =
      (b[0] - a[0]) * (point.y - a[1]) - (point.x - a[0]) * (b[1] - a[1]);
    if (a[1] <= point.y && b[1] > point.y && cross > 0) count++;
    if (a[1] > point.y && b[1] <= point.y && cross < 0) count--;
  }
  return count;
};
const sampleCoordinates = (segments) =>
  segments.length
    ? [
        segments[0].coordinates[0],
        ...segments.map((segment) => segment.coordinates[1]),
      ]
    : [];

function fill(args) {
  const { document, operator, inputs } = args;
  const curves = inputs.input[0].value,
    settings = document.geometrySettings;
  let rings, segments;
  if (operator.params.closure === 'straight') {
    if (curves.curves.length !== 1 || curves.junctions.length)
      throw Error('直线封口需要一条连续路径');
    segments = sample(curves, operator, settings);
    if (!segments.length) return [];
    const curve = curves.curves[0],
      coordinates = sampleCoordinates(segments);
    if (!pointEqual(coordinates[0], coordinates.at(-1))) {
      segments.push({
        coordinates: [coordinates.at(-1), coordinates[0]],
        source: {
          ...taggedCurveSource(curve.edges[0], {
            operatorId: operator.id,
            role: 'closure',
          }),
          kind: 'generated-closure',
        },
        sourceParameter: [
          Math.sign(curve.edges[0].basisSpan[1] - curve.edges[0].basisSpan[0]),
          0,
        ],
      });
      coordinates.push(coordinates[0]);
    }
    rings = [coordinates];
  } else {
    const closed = closedCurveRings(curves, {
      ...settings,
      includeSource: true,
    });
    rings = closed.map((ring) => ring.coordinates);
    segments = closed.flatMap((ring) =>
      ring.segments.flatMap(({ edge, reverse, coordinates }) => {
        const items = sampleTaggedCubic(
          reverse ? edge.cubic.slice().reverse() : edge.cubic,
          settings.curveToleranceMM,
          taggedCurveSource(edge, { operatorId: operator.id, role: 'input' }),
          reverse ? edge.basisSpan.slice().reverse() : edge.basisSpan,
        );
        if (items.length) {
          items[0].coordinates[0] = coordinates[0];
          items.at(-1).coordinates[1] = coordinates.at(-1);
        }
        return items;
      }),
    );
  }
  const graph = arrange(segments, settings);
  const inside = graph.faces.filter((face) => {
    const point = pointOf(face.geometry).getCoordinate();
    const count = rings.reduce((sum, ring) => sum + winding(point, ring), 0);
    return operator.params.rule === 'non-zero'
      ? count !== 0
      : Math.abs(count) % 2 === 1;
  });
  const results = unionCandidates(
    graph,
    inside.map((face) => face.id),
  );
  if (operator.params.closure !== 'straight') return results;
  // A declared straight-closure result can contain several polygon components.
  return results.length
    ? [
        candidate(
          combineGeometry(results),
          results.flatMap((region) => region.boundaries),
          { kind: 'result', role: 'closed-path' },
        ),
      ]
    : [];
}

const combineGeometry = (regions) =>
  regions.length === 1
    ? clone(regions[0].geometry)
    : {
        type: 'MultiPolygon',
        coordinates: regions.flatMap((region) =>
          region.geometry.type === 'Polygon'
            ? [region.geometry.coordinates]
            : region.geometry.coordinates,
        ),
      };

function partition(args) {
  const { document, operator, inputs } = args;
  const source = inputs.input[0],
    cutters = inputs.cutter[0];
  if (
    operator.params.emptyInput === 'passthrough' &&
    cutters.status === 'empty'
  )
    return { passthrough: source.value.regions };
  const scope = scoped(source, operator.params.scope);
  const byCurve = cutters.value.curves.map((curve) => ({
    id: curve.pathRef?.id || curve.key,
    curve,
    segments: sample(
      { ...cutters.value, curves: [curve] },
      operator,
      document.geometrySettings,
      'cutter',
    ),
  }));
  const connected = scope.selected.length
    ? connectPartitionCutters({
        baseGeometries: scope.selected.map((region) =>
          readGeometry(region.geometry),
        ),
        cutters: byCurve.map((item) => ({
          ...item,
          coordinates: sampleCoordinates(item.segments),
        })),
        endpointJoin: operator.params.endpointJoin,
      })
    : { connections: [], diagnostics: [] };
  const segments = byCurve.flatMap((item) => item.segments);
  for (const connection of connected.connections) {
    const sourceCurve = byCurve.find(
      (item) => item.id === connection.pathId,
    ).curve;
    const edge = connection.endpoint
      ? sourceCurve.edges.at(-1)
      : sourceCurve.edges[0];
    const direction = Math.sign(edge.basisSpan[1] - edge.basisSpan[0]);
    const endpoint = edge.basisSpan[connection.endpoint ? 1 : 0];
    segments.push({
      coordinates: connection.endpoint
        ? [connection.from, connection.extended]
        : [connection.extended, connection.from],
      source: {
        ...taggedCurveSource(edge, {
          operatorId: operator.id,
          role: 'endpoint-join',
        }),
        kind: 'generated-join',
        endpoint,
      },
      sourceParameter: connection.endpoint
        ? [endpoint, endpoint + direction]
        : [endpoint - direction, endpoint],
    });
  }
  const regions = scope.selected.flatMap((base) => {
    const geometry = readGeometry(base.geometry);
    const graph = arrange(
      [...boundarySegments(base), ...segments],
      document.geometrySettings,
    );
    return graph.faces
      .filter((face) => geometry.covers(pointOf(face.geometry)))
      .map((face) =>
        candidate(face.geometry, [face.boundary], null, [base.ref]),
      );
  });
  return {
    regions,
    passthrough: scope.untouched,
    diagnostics: connected.diagnostics,
  };
}

function boolean(args) {
  const { document, operator, inputs } = args;
  const source = inputs.input[0],
    operand = inputs.operand[0];
  if (
    operator.params.emptyInput === 'passthrough' &&
    operand.status === 'empty'
  )
    return { passthrough: source.value.regions };
  const scope = scoped(source, operator.params.scope);
  const operands = operand.value.regions.map((region) =>
    readGeometry(region.geometry),
  );
  const segments = operand.value.regions.flatMap(boundarySegments);
  const regions = scope.selected.flatMap((base) => {
    const geometry = readGeometry(base.geometry);
    const graph = arrange(
      [...boundarySegments(base), ...segments],
      document.geometrySettings,
    );
    const selected = graph.faces.filter((face) => {
      const point = pointOf(face.geometry),
        a = geometry.covers(point),
        b = operands.some((area) => area.covers(point));
      return operator.params.operation === 'union'
        ? a || b
        : operator.params.operation === 'intersection'
          ? a && b
          : a && !b;
    });
    const parts = unionCandidates(
      graph,
      selected.map((face) => face.id),
    ).filter(
      (part) =>
        !operands.length ||
        readGeometry(part.geometry).getArea() >= MIN_REGION_AREA_MM2,
    );
    return parts.length
      ? [
          candidate(
            combineGeometry(parts),
            parts.flatMap((part) => part.boundaries),
            { kind: 'result', role: 'boolean', parent: base.ref },
            [base.ref],
          ),
        ]
      : [];
  });
  return { regions, passthrough: scope.untouched };
}

function generatedCandidate(geometry, source, selector, parents = []) {
  const parts = polygonParts(geometry).filter((part) => part.getArea() > 0);
  if (!parts.length) return null;
  const boundaries = parts.map((part) => {
    const rings = writer.write(part).coordinates.map((ring) =>
      taggedGenerated(ring, source).map((segment) => ({
        coordinates: segment.coordinates,
        sources: [{ source, sourceParameter: segment.sourceParameter }],
      })),
    );
    return { outer: rings[0], holes: rings.slice(1) };
  });
  return candidate(
    parts.length === 1
      ? writer.write(parts[0])
      : {
          type: 'MultiPolygon',
          coordinates: parts.map((part) => writer.write(part).coordinates),
        },
    boundaries,
    selector,
    parents,
  );
}

function stroke({ document, operator, inputs }) {
  return inputs.input[0].value.curves.flatMap((curve) => {
    const segments = sample(
      { curves: [curve] },
      operator,
      document.geometrySettings,
    );
    if (!segments.length) return [];
    const geometry = readGeometry({
      type: 'LineString',
      coordinates: sampleCoordinates(segments),
    }).buffer(operator.params.widthMM / 2, 12);
    const source = {
      ...taggedCurveSource(curve.edges[0], {
        operatorId: operator.id,
        role: 'stroke-boundary',
      }),
      kind: 'generated-stroke',
    };
    const next = generatedCandidate(geometry, source, {
      kind: 'result',
      role: 'stroke',
      path: curve.pathRef,
      instances: curve.edges[0].instances,
    });
    return next ? [next] : [];
  });
}

function offset({ operator, inputs, context }) {
  const scope = scoped(inputs.input[0], operator.params.scope);
  const resolved = context.resolveScalar({ value: operator.params.distanceMM });
  const distance = typeof resolved === 'number' ? resolved : resolved?.value;
  if (!Number.isFinite(distance)) throw Error('offset 距离无效');
  return {
    passthrough: scope.untouched,
    regions: scope.selected.flatMap((base) => {
      const source = {
        kind: 'generated-offset',
        operatorId: operator.id,
        role: 'offset-boundary',
        parent: base.ref,
        parity: 1,
      };
      const next = generatedCandidate(
        readGeometry(base.geometry).buffer(distance, 12),
        source,
        { kind: 'result', role: 'offset', parent: base.ref },
        [base.ref],
      );
      return next ? [next] : [];
    }),
  };
}

function between({ document, operator, inputs }) {
  const boundary = operator.params.boundaryRef
    ? scoped(inputs.boundary[0], {
        kind: 'selected',
        refs: [operator.params.boundaryRef],
      }).selected[0]
    : null;
  const result = betweenGeometry({
    curves: inputs.input[0].value.curves,
    params: operator.params,
    boundaryGeometry: boundary?.geometry,
    geometrySettings: document.geometrySettings,
  });
  const segments = sample(
    { curves: result.curves },
    operator,
    document.geometrySettings,
  );
  if (boundary) segments.push(...boundarySegments(boundary));
  const endpoints = result.curves.flatMap((curve) => [
    { edge: curve.edges[0], end: 0 },
    { edge: curve.edges.at(-1), end: 1 },
  ]);
  const endpoint = (point) =>
    endpoints
      .filter(({ edge, end }) => pointEqual(point, edge.cubic[end ? 3 : 0]))
      .map(({ edge, end }) => ({
        path: edge.logicalSource,
        parameter: edge.basisSpan[end],
        instances: edge.instances,
      }))
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  for (const connection of result.connections) {
    const source = {
      kind: 'generated-between-join',
      operatorId: operator.id,
      role: 'connection',
      ends: [endpoint(connection.from), endpoint(connection.to)].sort((a, b) =>
        JSON.stringify(a).localeCompare(JSON.stringify(b)),
      ),
      parity: 1,
    };
    const lines =
      connection.kind === 'explicit-line'
        ? [[connection.from, connection.to]]
        : [
            [connection.from, connection.boundaryFrom],
            [connection.boundaryTo, connection.to],
          ];
    for (const line of lines)
      if (!pointEqual(line[0], line[1]))
        segments.push(...taggedGenerated(line, source));
  }
  const geometry = readGeometry(result.geometry),
    graph = arrange(segments, document.geometrySettings);
  const selected = graph.faces.filter((face) =>
    geometry.covers(pointOf(face.geometry)),
  );
  const parts = unionCandidates(
    graph,
    selected.map((face) => face.id),
  );
  if (!parts.length) throw Error('between 的明确边界没有围成区域');
  return [
    candidate(
      combineGeometry(parts),
      parts.flatMap((part) => part.boundaries),
      { kind: 'result', role: 'between' },
    ),
  ];
}

const scalar = (value, context) => {
  const resolved = Number.isFinite(value)
    ? value
    : context.resolveScalar({ value });
  const number = typeof resolved === 'number' ? resolved : resolved?.value;
  if (!Number.isFinite(number)) throw Error('构造参数不是有限数');
  return number;
};
const transformGeometry = (geometry, transform) => {
  const walk = (points) =>
    Array.isArray(points[0])
      ? points.map(walk)
      : [
          transform[0] * points[0] + transform[2] * points[1] + transform[4],
          transform[1] * points[0] + transform[3] * points[1] + transform[5],
        ];
  return { ...geometry, coordinates: walk(geometry.coordinates) };
};
function reference({ operator, inputs }) {
  const scope = scoped(inputs.input[0], operator.params.scope);
  const instance = { operatorId: operator.id, index: 0 };
  return scope.selected.map((base) => ({
    ...candidate(
      clone(base.geometry),
      transformRegionBoundaries(base.boundaries, [1, 0, 0, 1, 0, 0], instance),
      { kind: 'result', role: 'reference', parent: base.ref },
      [base.ref],
    ),
    instances: [...base.ref.instances, instance],
  }));
}
function array({ operator, inputs, context }) {
  const scope = scoped(inputs.input[0], operator.params.scope),
    params = operator.params;
  const count = scalar(params.count, context);
  if (!Number.isInteger(count) || count < 1)
    throw Error('阵列数量必须是正整数');
  const [x, y] = params.center.map((value) => scalar(value, context));
  const angle = scalar(params.angleRad, context);
  return {
    passthrough: scope.untouched,
    regions: scope.selected.flatMap((base) =>
      Array.from({ length: count }, (_, index) => {
        const c = Math.cos(angle * index),
          s = Math.sin(angle * index);
        const transform = [c, s, -s, c, x - c * x + s * y, y - s * x - c * y];
        const instance = { operatorId: operator.id, index };
        return {
          ...candidate(
            transformGeometry(base.geometry, transform),
            transformRegionBoundaries(base.boundaries, transform, instance),
            { kind: 'result', role: 'array', parent: base.ref, index },
            [base.ref],
          ),
          instances: [...base.ref.instances, instance],
        };
      }),
    ),
  };
}
function outline({ document, inputs }) {
  const regions = inputs.input[0].value.regions;
  if (!regions.length) return [];
  const graph = arrange(
    regions.flatMap(boundarySegments),
    document.geometrySettings,
  );
  const geometries = regions.map((region) => readGeometry(region.geometry));
  const selected = graph.faces.filter((face) =>
    geometries.some((geometry) => geometry.covers(pointOf(face.geometry))),
  );
  const parts = unionCandidates(
    graph,
    selected.map((face) => face.id),
  );
  const noHoles = parts.map((part) =>
    candidate(
      { type: 'Polygon', coordinates: [part.geometry.coordinates[0]] },
      [{ outer: part.boundaries[0].outer, holes: [] }],
    ),
  );
  // Removing holes may cover a separately filled island. Union shells once.
  const shellGraph = arrange(
    noHoles.flatMap(boundarySegments),
    document.geometrySettings,
  );
  const shells = noHoles.map((region) => readGeometry(region.geometry));
  const merged = unionCandidates(
    shellGraph,
    shellGraph.faces
      .filter((face) =>
        shells.some((shell) => shell.covers(pointOf(face.geometry))),
      )
      .map((face) => face.id),
  );
  return merged.length
    ? [
        candidate(
          combineGeometry(merged),
          merged.flatMap((part) => part.boundaries),
          { kind: 'result', role: 'outline' },
        ),
      ]
    : [];
}

const implementations = {
  fill,
  path: fill,
  partition,
  boolean,
  stroke,
  offset,
  between,
  'region-reference': reference,
  'region-array': array,
  'region-outline': outline,
};

/** V5 registry entry points never execute V4 naming or output contracts. */
export function declarativeRegionSpecification(specification) {
  return {
    ...specification,
    evaluate(args) {
      const { document, ownerNodeId, operator, inputs } = args;
      const dependencies = [
        ...new Set(
          Object.values(inputs)
            .flat()
            .flatMap((input) => input.dependencies || []),
        ),
      ];
      if (operator.type === 'region-collect') {
        const regions = (inputs.input || []).flatMap(
          (input) => input.value.regions,
        );
        if (operator.params.disjointSelections) {
          const claims = new Set();
          for (const region of regions)
            for (const claim of region.selectionClaims || []) {
              if (claims.has(claim))
                return {
                  regions: {
                    domain: 'regions',
                    status: 'blocked',
                    dependencies,
                    diagnostics: [
                      {
                        code: 'selection-groups-overlap',
                        severity: 'error',
                        message:
                          '不同属性组选择了同一个输入区域；请明确调整选择或合并属性组',
                      },
                    ],
                  },
                };
              claims.add(claim);
            }
        }
        if (regions.some((region) => region.ref.ownerNodeId !== ownerNodeId))
          return {
            regions: {
              domain: 'regions',
              status: 'blocked',
              diagnostics: [
                {
                  code: 'foreign-owner',
                  message: '请通过区域引用把来源映射到当前部件',
                },
              ],
              dependencies,
            },
          };
        if (
          new Set(regions.map((region) => outputIdentity(region.ref))).size !==
          regions.length
        )
          return {
            regions: {
              domain: 'regions',
              status: 'blocked',
              diagnostics: [
                {
                  code: 'duplicate-output',
                  message: '集合输入重复发布了同一区域',
                },
              ],
              dependencies,
            },
          };
        return {
          regions: stage(
            ownerNodeId,
            regions,
            dependencies,
            Object.values(inputs)
              .flat()
              .flatMap((input) => input.diagnostics || []),
          ),
        };
      }
      try {
        const implementation = implementations[operator.type];
        if (!implementation)
          throw Error(`声明式构造尚未实现：${operator.type}`);
        const evaluated = implementation(args);
        const normalized = Array.isArray(evaluated)
          ? { regions: evaluated }
          : evaluated;
        const result = resolveRegionDefinitions(
          document,
          ownerNodeId,
          operator.id,
          normalized.regions || [],
          {
            dependencies,
            diagnostics: [
              ...Object.values(inputs)
                .flat()
                .flatMap((input) => input.diagnostics || []),
              ...(normalized.diagnostics || []),
            ],
          },
        );
        result.value.regions.unshift(...(normalized.passthrough || []));
        result.status = result.value.regions.length ? 'ready' : 'empty';
        return { regions: result };
      } catch (error) {
        return {
          regions: {
            domain: 'regions',
            status: 'blocked',
            dependencies,
            diagnostics: [
              {
                code: 'region-construction-invalid',
                message: error.message,
                operatorId: operator.id,
              },
            ],
          },
        };
      }
    },
  };
}
