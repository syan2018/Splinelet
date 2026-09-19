import GeoJSONWriter from 'jsts/org/locationtech/jts/io/GeoJSONWriter.js';
import {
  polygonParts,
  readGeometry,
  robustPolygonize,
  validateArea,
} from '../../../region-engine.mjs';
import { contourSignatures } from '../../../surface-lineage.mjs';
import {
  makeOutputRef,
  resolveRegionScope,
  outputIdentity,
} from '../../provenance.mjs';
import { fillCurves, sampleCubic } from './fill.mjs';

const writer = new GeoJSONWriter();
// Disconnected pieces of one semantic result retain that result's identity.
// RegionSet already permits MultiPolygon; only explicit partitioning creates
// separate output identities for independently editable regions.
const polygonalResult = (geometry) => {
  const parts = polygonParts(geometry);
  if (!parts.length) return null;
  if (parts.length === 1) return parts[0];
  return readGeometry({
    type: 'MultiPolygon',
    coordinates: parts.map((part) => writer.write(part).coordinates),
  });
};
const clone = (value) => structuredClone(value);
const text = (value) => JSON.stringify(value);
const result = (status, value, diagnostics = [], dependencies = []) => ({
  domain: 'regions',
  status,
  ...(value === undefined ? {} : { value }),
  diagnostics,
  dependencies,
});
const blocked = (code, message) =>
  result('blocked', undefined, [{ code, message }]);
const input = (inputs, name = 'input') => {
  const values = inputs?.[name] || [];
  return values.length === 1
    ? values[0]
    : blocked('input-count', `${name} 必须恰有一个输入`);
};
const regionSet = (ownerNodeId, regions, provenance = []) => ({
  frame: { kind: 'local', ownerNodeId },
  regions,
  provenance,
});
const compare = (a, b) => String(a).localeCompare(String(b));
const lineage = (regions) =>
  [...new Set(regions.flatMap((region) => region.ref.lineage))].sort(compare);
const output = (
  ownerNodeId,
  operatorId,
  key,
  lineageTokens,
  geometry,
  instances = [],
) => ({
  ref: makeOutputRef(
    ownerNodeId,
    operatorId,
    'regions',
    key,
    lineageTokens,
    instances,
  ),
  geometry: writer.write(geometry),
});
const stageRegions = (
  value,
  ownerNodeId,
  diagnostics = [],
  dependencies = [],
) => {
  const identities = value.regions.map((region) => outputIdentity(region.ref));
  if (new Set(identities).size !== identities.length)
    return blocked(
      'ambiguous-output',
      '分裂结果没有唯一的来源身份；请使用显式分区建立输出契约',
    );
  return result(
    value.regions.length ? 'ready' : 'empty',
    value,
    diagnostics,
    dependencies,
  );
};
const selected = (stage, scope) => {
  if (stage.status !== 'ready' && stage.status !== 'empty') return { stage };
  try {
    const scopeResult = resolveRegionScope(stage.value.regions, scope);
    if (scopeResult.status !== 'ready')
      return { stage: result('blocked', undefined, scopeResult.diagnostics) };
    return scopeResult;
  } catch (error) {
    return { stage: blocked('invalid-scope', error.message) };
  }
};
const cloneRegion = (
  region,
  ownerNodeId,
  operatorId,
  kind,
  instances = [],
) => ({
  ref: makeOutputRef(
    ownerNodeId,
    operatorId,
    'regions',
    text([kind, region.ref.key, instances]),
    region.ref.lineage,
    instances,
  ),
  geometry: clone(region.geometry),
});
const scalar = (value, context, name) => {
  if (Number.isFinite(value)) return value;
  const resolved = context?.resolveScalar?.({ value, label: name });
  const number = typeof resolved === 'number' ? resolved : resolved?.value;
  if (!Number.isFinite(number)) throw Error(`${name} 必须是有限 Scalar`);
  return number;
};
const transformGeo = (geometry, transform) => {
  const walk = (value) =>
    Array.isArray(value[0])
      ? value.map(walk)
      : [
          transform[0] * value[0] + transform[2] * value[1] + transform[4],
          transform[1] * value[0] + transform[3] * value[1] + transform[5],
        ];
  return { ...clone(geometry), coordinates: walk(geometry.coordinates) };
};
const rotate = (center, angle) => {
  const c = Math.cos(angle),
    s = Math.sin(angle),
    [x, y] = center;
  return [c, s, -s, c, x - c * x + s * y, y - s * x - c * y];
};
const curveTokens = (curve) =>
  curve.edges
    .map((edge) => text([edge.source.sketchId, edge.source.id, edge.instances]))
    .sort(compare);
const curves = (stage) => stage?.value?.curves || [];
const boundarySignature = (base, cutter, face) =>
  contourSignatures(
    [face],
    [
      {
        id: `base:${base.ref.key}`,
        geometry: readGeometry(base.geometry).getBoundary(),
      },
      ...curves(cutter).map((curve) => ({
        id: `cutter:${curveTokens(curve).join('|')}`,
        geometry: readGeometry({
          type: 'LineString',
          coordinates: curve.edges.flatMap((edge, index) =>
            sampleCubic(edge.cubic, 0.015).slice(index ? 1 : 0),
          ),
        }),
      })),
    ],
  )[0];
const gap = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const snapRing = (ring, point) => {
  let best;
  for (let index = 0; index < ring.length - 1; index++) {
    const a = ring[index],
      b = ring[index + 1],
      dx = b[0] - a[0],
      dy = b[1] - a[1],
      length = dx * dx + dy * dy;
    const t = length
      ? Math.max(
          0,
          Math.min(
            1,
            ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / length,
          ),
        )
      : 0;
    const hit = [a[0] + dx * t, a[1] + dy * t],
      gapMM = gap(point, hit);
    if (!best || gapMM < best.gapMM) best = { index, point: hit, gapMM };
  }
  return best;
};
const boundaryRoute = (ring, from, to) => {
  const route = [from.point];
  for (
    let index = (from.index + 1) % (ring.length - 1);
    ;
    index = (index + 1) % (ring.length - 1)
  ) {
    route.push(ring[index]);
    if (index === to.index) break;
  }
  route.push(to.point);
  return route;
};
const routeLength = (route) =>
  route
    .slice(1)
    .reduce((sum, point, index) => sum + gap(point, route[index]), 0);
const shortestBoundaryRoute = (ring, from, to) => {
  const forward = boundaryRoute(ring, from, to),
    backward = boundaryRoute(ring, to, from).reverse();
  return routeLength(forward) <= routeLength(backward) ? forward : backward;
};

export const regionReferenceOperator = {
  type: 'region-reference',
  inputPorts: { input: { domain: 'regions', min: 1, max: 1 } },
  outputPorts: { regions: { domain: 'regions' } },
  validateParams: (params) =>
    Object.keys(params || {}).length === 0 || 'region-reference 不接受 params',
  evaluate: ({ ownerNodeId, operator, inputs }) => {
    const source = input(inputs);
    if (source.status !== 'ready' && source.status !== 'empty')
      return { regions: source };
    const regions = source.value.regions.map((region) =>
      cloneRegion(region, ownerNodeId, operator.id, 'region-reference', [
        { operatorId: operator.id, index: 0 },
      ]),
    );
    return {
      regions: stageRegions(
        regionSet(ownerNodeId, regions, clone(source.value.provenance || [])),
        ownerNodeId,
        clone(source.diagnostics || []),
        source.dependencies,
      ),
    };
  },
  rebase: (operator) => clone(operator),
  copy: (operator) => clone(operator),
};

export const pathOperator = {
  type: 'path',
  inputPorts: { input: { domain: 'curves', min: 1, max: 1 } },
  outputPorts: { regions: { domain: 'regions' } },
  validateParams: (params) =>
    (['even-odd', 'non-zero'].includes(params?.rule || 'even-odd') &&
      (params?.closure === undefined || params.closure === 'straight') &&
      (params?.closure !== 'straight' ||
        (params.rule || 'even-odd') === 'even-odd') &&
      (params?.repair === undefined || typeof params.repair === 'boolean')) ||
    'Path rule、closure 或 repair 无效',
  evaluate: ({ document, ownerNodeId, operator, inputs }) => {
    const source = input(inputs);
    if (source.status !== 'ready' && source.status !== 'empty')
      return { regions: { ...source, domain: 'regions' } };
    if (operator.params.closure === 'straight') {
      try {
        if ((operator.params.rule || 'even-odd') !== 'even-odd')
          throw Error('直线封口当前需要 even-odd 边界规则');
        const curves = source.value.curves;
        if (!curves.length)
          return {
            regions: stageRegions(
              regionSet(ownerNodeId, []),
              ownerNodeId,
              clone(source.diagnostics || []),
              source.dependencies,
            ),
          };
        if (curves.length !== 1 || source.value.junctions?.length)
          throw Error('直线封口需要一条连续路径，不接受多路径或额外连接');
        const curve = curves[0];
        if (!curve.edges.length) throw Error('直线封口路径没有边');
        const tolerance = document.geometrySettings.joinToleranceMM ?? 0.001;
        const ring = [];
        for (const [index, edge] of curve.edges.entries()) {
          const previous = curve.edges[index - 1];
          if (
            previous &&
            (previous.endKey !== edge.startKey ||
              gap(previous.cubic[3], edge.cubic[0]) > tolerance)
          )
            throw Error('直线封口不能修补路径内部的断缝');
          ring.push(
            ...sampleCubic(
              edge.cubic,
              document.geometrySettings.curveToleranceMM,
            ).slice(index ? 1 : 0),
          );
        }
        const from = ring.at(-1).slice(),
          to = ring[0].slice();
        if (gap(from, to) > 0) ring.push(to.slice());
        const warnings = [];
        const geometry = validateArea(
          readGeometry({ type: 'Polygon', coordinates: [ring] }),
          operator.params.repair === true,
          warnings,
        );
        const tokens = curveTokens(curve);
        return {
          regions: stageRegions(
            regionSet(
              ownerNodeId,
              [
                output(
                  ownerNodeId,
                  operator.id,
                  text(['path', 'straight', curve.key]),
                  tokens,
                  geometry,
                ),
              ],
              [
                {
                  operatorId: operator.id,
                  kind: 'path',
                  closure: 'straight',
                  boundaryConnections: [{ kind: 'explicit-line', from, to }],
                },
              ],
            ),
            ownerNodeId,
            [
              ...clone(source.diagnostics || []),
              ...warnings.map((message) => ({
                severity: 'warning',
                code: 'repaired-self-intersection',
                message,
              })),
            ],
            source.dependencies,
          ),
        };
      } catch (error) {
        return { regions: blocked('path-closure-blocked', error.message) };
      }
    }
    return {
      regions: fillCurves(source.value, {
        ownerNodeId,
        operatorId: operator.id,
        rule: operator.params.rule || 'even-odd',
        geometrySettings: document.geometrySettings,
      }),
    };
  },
};

export const strokeOperator = {
  type: 'stroke',
  inputPorts: { input: { domain: 'curves', min: 1, max: 1 } },
  outputPorts: { regions: { domain: 'regions' } },
  validateParams: (params) =>
    (Number.isFinite(params?.widthMM) && params.widthMM > 0) ||
    'stroke 需要正 widthMM',
  evaluate: ({ document, ownerNodeId, operator, inputs }) => {
    const source = input(inputs);
    if (source.status !== 'ready' && source.status !== 'empty')
      return { regions: { ...source, domain: 'regions' } };
    try {
      const regions = curves(source).flatMap((curve) => {
        const points = curve.edges.flatMap((edge, index) =>
          sampleCubic(
            edge.cubic,
            document.geometrySettings.curveToleranceMM,
          ).slice(index ? 1 : 0),
        );
        if (points.length < 2) return [];
        const geometry = readGeometry({
          type: 'LineString',
          coordinates: points,
        }).buffer(operator.params.widthMM / 2, 12);
        const area = polygonalResult(geometry);
        return area
          ? [
              output(
                ownerNodeId,
                operator.id,
                text(['stroke', curve.key, curveTokens(curve)]),
                curveTokens(curve),
                area,
              ),
            ]
          : [];
      });
      return {
        regions: stageRegions(
          regionSet(ownerNodeId, regions),
          ownerNodeId,
          clone(source.diagnostics || []),
          source.dependencies,
        ),
      };
    } catch (error) {
      return { regions: blocked('stroke-blocked', error.message) };
    }
  },
};

export const betweenOperator = {
  type: 'between',
  inputPorts: {
    input: { domain: 'curves', min: 1, max: 1 },
    boundary: { domain: 'regions', min: 0, max: 1 },
  },
  outputPorts: { regions: { domain: 'regions' } },
  validateParams: (params) =>
    (Array.isArray(params?.curveKeys) &&
      params.curveKeys.length === 2 &&
      (params.repair === undefined || typeof params.repair === 'boolean')) ||
    'between 需要两个明确 curveKeys 和可选 boolean repair',
  evaluate: ({ document, ownerNodeId, operator, inputs }) => {
    const source = input(inputs);
    if (source.status !== 'ready' && source.status !== 'empty')
      return { regions: { ...source, domain: 'regions' } };
    const [aKey, bKey] = operator.params.curveKeys;
    const all = curves(source);
    const a = all.find((curve) => curve.key === aKey),
      b = all.find((curve) => curve.key === bKey);
    if (!a || !b || a === b)
      return {
        regions: blocked(
          'between-missing-curve',
          'between 引用的两条曲线必须存在且不同',
        ),
      };
    try {
      const sample = (curve) =>
        curve.edges.flatMap((edge, index) =>
          sampleCubic(
            edge.cubic,
            document.geometrySettings.curveToleranceMM,
          ).slice(index ? 1 : 0),
        );
      const left = sample(a),
        right = sample(b);
      const direct = Math.hypot(
        left.at(-1)[0] - right[0][0],
        left.at(-1)[1] - right[0][1],
      );
      const reverse = Math.hypot(
        left.at(-1)[0] - right.at(-1)[0],
        left.at(-1)[1] - right.at(-1)[1],
      );
      let ring = [
        ...left,
        ...(reverse < direct ? right.slice().reverse() : right),
        left[0],
      ];
      const connections = [];
      if (operator.params.boundaryRef) {
        const boundary = input(inputs, 'boundary');
        const found = selected(boundary, {
          kind: 'selected',
          refs: [operator.params.boundaryRef],
        });
        if (found.stage) return { regions: found.stage };
        const geometry = found.selected[0]?.geometry;
        if (geometry?.type !== 'Polygon' || geometry.coordinates.length !== 1)
          throw Error('between boundary 必须是单一无孔 Polygon Region');
        const ringBoundary = geometry.coordinates[0];
        const pairs = [
          [left.at(-1), ring[left.length]],
          [ring.at(-2), left[0]],
        ].map(([from, to]) => ({
          from,
          to,
          a: snapRing(ringBoundary, from),
          b: snapRing(ringBoundary, to),
        }));
        const joinMM = operator.params.boundaryJoinMM ?? 0;
        if (pairs.some((pair) => Math.max(pair.a.gapMM, pair.b.gapMM) > joinMM))
          throw Error('between 端点超过 boundaryJoinMM，拒绝隐式直线补边');
        const first = shortestBoundaryRoute(
            ringBoundary,
            pairs[0].a,
            pairs[0].b,
          ),
          second = shortestBoundaryRoute(ringBoundary, pairs[1].a, pairs[1].b);
        ring.splice(left.length, 0, ...first);
        ring.splice(ring.length - 1, 0, ...second);
        connections.push(
          ...pairs.map((pair, index) => ({
            kind: 'boundary-route',
            from: pair.from,
            to: pair.to,
            boundaryFrom: pair.a.point,
            boundaryTo: pair.b.point,
            gapMM: Math.max(pair.a.gapMM, pair.b.gapMM),
            coordinates: index ? second : first,
          })),
        );
      } else
        connections.push(
          { kind: 'explicit-line', from: left.at(-1), to: ring[left.length] },
          { kind: 'explicit-line', from: ring.at(-2), to: left[0] },
        );
      ring = ring.filter(
        (point, index) => !index || gap(point, ring[index - 1]) > 1e-9,
      );
      let part = readGeometry({ type: 'Polygon', coordinates: [ring] });
      const repairWarnings = [];
      if (!part.isValid() && operator.params.repair === true)
        part = validateArea(part, true, repairWarnings);
      if (!part.isValid() || part.isEmpty())
        throw Error('between 的显式端点边界不能形成有效区域');
      const tokens = [...curveTokens(a), ...curveTokens(b)].sort(compare);
      const region = output(
        ownerNodeId,
        operator.id,
        text(['between', a.key, b.key, tokens]),
        tokens,
        part,
      );
      return {
        regions: stageRegions(
          regionSet(
            ownerNodeId,
            [region],
            [
              {
                kind: 'explicit-boundary',
                curves: [a.key, b.key],
                connections,
              },
            ],
          ),
          ownerNodeId,
          [
            ...clone(source.diagnostics || []),
            ...repairWarnings.map((message) => ({
              severity: 'warning',
              code: 'repaired-self-intersection',
              message,
            })),
          ],
          source.dependencies,
        ),
      };
    } catch (error) {
      return { regions: blocked('between-blocked', error.message) };
    }
  },
};

const scopedRegionOperator = (type, operation) => ({
  type,
  inputPorts: { input: { domain: 'regions', min: 1, max: 1 } },
  outputPorts: { regions: { domain: 'regions' } },
  validateParams: (params) =>
    params?.scope?.kind === 'all' ||
    params?.scope?.kind === 'selected' ||
    `${type} 需要显式 scope`,
  evaluate: ({ ownerNodeId, operator, inputs, context }) => {
    const source = input(inputs);
    const scope = selected(source, operator.params.scope);
    if (scope.stage) return { regions: scope.stage };
    try {
      const next = scope.selected.flatMap((region) =>
        operation(region, { ownerNodeId, operator, context }),
      );
      return {
        regions: stageRegions(
          regionSet(ownerNodeId, [...scope.untouched, ...next]),
          ownerNodeId,
          clone(source.diagnostics || []),
          source.dependencies,
        ),
      };
    } catch (error) {
      return { regions: blocked(`${type}-blocked`, error.message) };
    }
  },
});

export const offsetOperator = scopedRegionOperator('offset', (region, args) => {
  const distanceMM = scalar(
    args.operator.params.distanceMM,
    args.context,
    'distanceMM',
  );
  const area = polygonalResult(
    readGeometry(region.geometry).buffer(distanceMM, 12),
  );
  return area
    ? [
        output(
          args.ownerNodeId,
          args.operator.id,
          text(['offset', region.ref.key]),
          region.ref.lineage,
          area,
          region.ref.instances,
        ),
      ]
    : [];
});

export const regionArrayOperator = scopedRegionOperator(
  'region-array',
  (region, args) => {
    const params = args.operator.params,
      count = scalar(params.count, args.context, 'count');
    if (!Number.isInteger(count) || count < 1)
      throw Error('count 必须是正整数');
    const center = [
        scalar(params.center?.[0], args.context, 'center[0]'),
        scalar(params.center?.[1], args.context, 'center[1]'),
      ],
      angle = scalar(params.angleRad, args.context, 'angleRad');
    return Array.from({ length: count }, (_, index) => ({
      ref: makeOutputRef(
        args.ownerNodeId,
        args.operator.id,
        'regions',
        text(['region-array', region.ref.key, index]),
        region.ref.lineage,
        [...region.ref.instances, { operatorId: args.operator.id, index }],
      ),
      geometry: transformGeo(region.geometry, rotate(center, angle * index)),
    }));
  },
);

export const booleanOperator = {
  type: 'boolean',
  inputPorts: {
    input: { domain: 'regions', min: 1, max: 1 },
    operand: { domain: 'regions', min: 1, max: 1 },
  },
  outputPorts: { regions: { domain: 'regions' } },
  validateParams: (params) =>
    (['union', 'difference', 'intersection'].includes(params?.operation) &&
      (params?.scope?.kind === 'all' || params?.scope?.kind === 'selected')) ||
    'boolean 需要 operation 和显式 scope',
  evaluate: ({ ownerNodeId, operator, inputs }) => {
    const base = input(inputs, 'input'),
      operand = input(inputs, 'operand');
    if (base.status !== 'ready' && base.status !== 'empty')
      return { regions: { ...base, domain: 'regions' } };
    if (operand.status !== 'ready' && operand.status !== 'empty')
      return { regions: { ...operand, domain: 'regions' } };
    const scope = selected(base, operator.params.scope);
    if (scope.stage) return { regions: scope.stage };
    try {
      const operandGeometry = operand.value.regions.reduce(
        (sum, region) =>
          sum
            ? sum.union(readGeometry(region.geometry))
            : readGeometry(region.geometry),
        null,
      );
      const regions = scope.selected.flatMap((region) => {
        const source = readGeometry(region.geometry);
        const geometry = operandGeometry
          ? source[operator.params.operation](operandGeometry)
          : operator.params.operation === 'intersection'
            ? null
            : source;
        const area = geometry && polygonalResult(geometry);
        const parents = [
          ...region.ref.lineage,
          ...lineage(operand.value.regions),
        ].sort(compare);
        return area
          ? [
              output(
                ownerNodeId,
                operator.id,
                text([
                  'boolean',
                  operator.params.operation,
                  region.ref.key,
                  lineage(operand.value.regions),
                ]),
                parents,
                area,
                region.ref.instances,
              ),
            ]
          : [];
      });
      const diagnostics =
        operator.params.operation === 'union' && scope.selected.length > 1
          ? [
              {
                code: 'candidate-conflict',
                message: '多面 merge 需要输出契约确认；未按面积排序合并身份',
              },
            ]
          : [];
      return {
        regions: stageRegions(
          regionSet(ownerNodeId, [...scope.untouched, ...regions]),
          ownerNodeId,
          diagnostics,
          [...base.dependencies, ...operand.dependencies],
        ),
      };
    } catch (error) {
      return { regions: blocked('boolean-blocked', error.message) };
    }
  },
};

export const partitionOperator = {
  type: 'partition',
  inputPorts: {
    input: { domain: 'regions', min: 1, max: 1 },
    cutter: { domain: 'curves', min: 1, max: 1 },
  },
  outputPorts: { regions: { domain: 'regions' } },
  validateParams: (params) =>
    params?.scope?.kind === 'all' ||
    params?.scope?.kind === 'selected' ||
    'partition 需要显式 scope',
  evaluate: ({ document, ownerNodeId, operator, inputs }) => {
    const source = input(inputs),
      cutter = input(inputs, 'cutter');
    if (source.status !== 'ready' && source.status !== 'empty')
      return { regions: { ...source, domain: 'regions' } };
    if (cutter.status !== 'ready' && cutter.status !== 'empty')
      return { regions: { ...cutter, domain: 'regions' } };
    const scope = selected(source, operator.params.scope);
    if (scope.stage) return { regions: scope.stage };
    try {
      const lines = curves(cutter).map((curve) =>
        readGeometry({
          type: 'LineString',
          coordinates: curve.edges.flatMap((edge, index) =>
            sampleCubic(
              edge.cubic,
              document.geometrySettings.curveToleranceMM,
            ).slice(index ? 1 : 0),
          ),
        }),
      );
      const regions = [...scope.untouched],
        members = [];
      for (const base of scope.selected) {
        const geometry = readGeometry(base.geometry);
        const faces = robustPolygonize([
          geometry.getBoundary(),
          ...lines,
        ]).filter((face) => geometry.covers(face.getInteriorPoint()));
        const signatures = faces.map((face) =>
          boundarySignature(base, cutter, face),
        );
        if (new Set(signatures).size !== signatures.length)
          throw Error('partition 候选轮廓签名重复，无法安全绑定区域身份');
        const next = faces.map((face, index) => {
          const key = text(['partition', base.ref.key, signatures[index]]);
          const lineageTokens = [...base.ref.lineage, signatures[index]].sort(
            compare,
          );
          members.push({
            port: 'regions',
            key,
            lineage: lineageTokens,
            topology: signatures[index],
          });
          return output(
            ownerNodeId,
            operator.id,
            key,
            lineageTokens,
            face,
            base.ref.instances,
          );
        });
        regions.push(...next);
      }
      if (
        operator.outputContract?.members &&
        text(operator.outputContract.members) !== text(members)
      )
        return {
          regions: {
            domain: 'regions',
            status: 'blocked',
            diagnostics: [
              {
                code: 'partition-contract-mismatch',
                message: '分区输出契约改变；保留上游区域',
              },
            ],
            dependencies: [...source.dependencies, ...cutter.dependencies],
          },
        };
      return {
        regions: stageRegions(
          regionSet(ownerNodeId, regions, [
            { kind: 'output-contract-proposal', members },
          ]),
          ownerNodeId,
          [
            {
              code: 'partition-contract-proposal',
              message: '首次分区返回来源轮廓候选，命令可绑定 outputContract',
            },
          ],
          [...source.dependencies, ...cutter.dependencies],
        ),
      };
    } catch (error) {
      return { regions: blocked('partition-blocked', error.message) };
    }
  },
};

/** Collect independent outputs without unioning their geometry or ownership. */
export const regionCollectOperator = {
  type: 'region-collect',
  inputPorts: { input: { domain: 'regions', min: 0 } },
  outputPorts: { regions: { domain: 'regions' } },
  validateParams: (params) =>
    Object.keys(params).length === 0 || 'region-collect 不接受几何参数',
  rebase: (operator) => clone(operator),
  copy: (operator) => clone(operator),
  evaluate: ({ ownerNodeId, inputs }) => {
    const stages = inputs.input || [];
    const invalid = stages.find(
      (stage) => !['ready', 'empty'].includes(stage.status),
    );
    if (invalid)
      return {
        regions: result(
          'blocked',
          undefined,
          clone(invalid.diagnostics || []),
          clone(invalid.dependencies || []),
        ),
      };
    const regions = stages.flatMap((stage) => stage.value?.regions || []);
    if (regions.some((region) => region.ref.ownerNodeId !== ownerNodeId))
      return {
        regions: blocked('foreign-owner', '请通过区域引用把来源映射到当前部件'),
      };
    const identities = regions.map((region) => outputIdentity(region.ref));
    if (new Set(identities).size !== identities.length)
      return {
        regions: blocked('duplicate-output', '集合输入重复发布了同一区域'),
      };
    return {
      regions: stageRegions(
        regionSet(ownerNodeId, clone(regions)),
        ownerNodeId,
        stages.flatMap((stage) => clone(stage.diagnostics || [])),
        stages.flatMap((stage) => stage.dependencies || []),
      ),
    };
  },
};

export const legacyRecipeCapabilities = Object.freeze({
  path: { operator: 'path', status: 'supported' },
  stroke: { operator: 'stroke', status: 'supported' },
  between: {
    operator: 'between',
    status: 'supported',
    note: '保留两条曲线的显式端点边界',
  },
  partition: {
    operator: 'partition',
    status: 'supported',
    note: '按定向来源边界轮廓签名提议/校验 outputContract',
  },
  boolean: { operator: 'boolean', status: 'supported' },
  offset: { operator: 'offset', status: 'supported' },
  radial_array: { operator: 'region-array', status: 'supported' },
});
export const regionOperatorSpecifications = [
  regionCollectOperator,
  regionReferenceOperator,
  pathOperator,
  strokeOperator,
  betweenOperator,
  partitionOperator,
  booleanOperator,
  offsetOperator,
  regionArrayOperator,
];
