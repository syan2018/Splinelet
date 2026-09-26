import GeoJSONWriter from 'jsts/org/locationtech/jts/io/GeoJSONWriter.js';
import {
  polygonParts,
  readGeometry,
  robustPolygonize,
} from '../../../region-engine.mjs';
import { makeOutputRef } from '../../provenance.mjs';

const writer = new GeoJSONWriter();
const gap = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const midpoint = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
const fail = (message) => {
  throw Error(message);
};

export function sampleCubic(cubic, toleranceMM, depth = 0) {
  const [a, b, c, d] = cubic;
  const length2 = (d[0] - a[0]) ** 2 + (d[1] - a[1]) ** 2;
  const distance = (p) => {
    const t = length2
      ? Math.max(
          0,
          Math.min(
            1,
            ((p[0] - a[0]) * (d[0] - a[0]) + (p[1] - a[1]) * (d[1] - a[1])) /
              length2,
          ),
        )
      : 0;
    return gap(p, [a[0] + t * (d[0] - a[0]), a[1] + t * (d[1] - a[1])]);
  };
  if (Math.max(distance(b), distance(c)) <= toleranceMM)
    return [a.slice(), d.slice()];
  if (depth >= 22) fail('曲线采样超过细分限额');
  const ab = midpoint(a, b),
    bc = midpoint(b, c),
    cd = midpoint(c, d);
  const left = midpoint(ab, bc),
    right = midpoint(bc, cd),
    center = midpoint(left, right);
  return [
    ...sampleCubic([a, ab, left, center], toleranceMM, depth + 1).slice(0, -1),
    ...sampleCubic([center, right, cd, d], toleranceMM, depth + 1),
  ];
}

export function closedCurveRings(
  curveSet,
  {
    curveToleranceMM = 0.015,
    joinToleranceMM = 0.001,
    includeSource = false,
  } = {},
) {
  if (
    !(curveToleranceMM > 0) ||
    !(joinToleranceMM > 0) ||
    !Number.isFinite(curveToleranceMM + joinToleranceMM)
  )
    fail('构面容差无效');
  const edges = curveSet.curves.flatMap((curve) => curve.edges);
  const edgeMap = new Map();
  const parent = new Map();
  const endpoint = (edge, end) => JSON.stringify([edge.key, end]);
  const root = (key) => {
    if (!parent.has(key)) parent.set(key, key);
    let current = key;
    while (parent.get(current) !== current) current = parent.get(current);
    return current;
  };
  const union = (a, b) => {
    parent.set(root(b), root(a));
  };
  const vertexKeys = new Map();
  for (const edge of edges) {
    if (edgeMap.has(edge.key)) fail('构面输入存在重复边实例');
    edgeMap.set(edge.key, edge);
    for (const end of ['start', 'end']) {
      const key = endpoint(edge, end),
        vertex = edge[`${end}Key`];
      root(key);
      if (vertexKeys.has(vertex)) union(key, vertexKeys.get(vertex));
      else vertexKeys.set(vertex, key);
    }
  }
  for (const junction of curveSet.junctions) {
    const ends = junction.endpoints.map((item) => {
      const edge = edgeMap.get(item.edgeKey);
      if (!edge || !['start', 'end'].includes(item.end))
        fail('Join 引用不存在的边端');
      return endpoint(edge, item.end);
    });
    for (const key of ends.slice(1)) union(ends[0], key);
  }
  const vertices = new Map();
  for (const edge of edges)
    for (const end of ['start', 'end']) {
      const key = root(endpoint(edge, end));
      if (!vertices.has(key)) vertices.set(key, []);
      vertices
        .get(key)
        .push({ edge, end, point: edge.cubic[end === 'start' ? 0 : 3] });
    }
  for (const ends of vertices.values()) {
    if (ends.length !== 2)
      fail(
        ends.length < 2
          ? '构面线条未闭合；需要显式连接端点'
          : '构面连接存在分叉',
      );
    if (gap(ends[0].point, ends[1].point) > joinToleranceMM)
      fail('连接端点超出几何容差');
  }
  const unused = new Set(edges.map((edge) => edge.key));
  const rings = [];
  while (unused.size) {
    let edge = edgeMap.get(unused.values().next().value),
      reverse = false;
    const first = root(endpoint(edge, 'start'));
    const coordinates = [],
      lineage = [],
      segments = [];
    while (true) {
      if (!unused.delete(edge.key)) fail('构面拓扑重复使用边');
      const cubic = reverse ? edge.cubic.slice().reverse() : edge.cubic;
      const from = root(endpoint(edge, reverse ? 'end' : 'start'));
      const to = root(endpoint(edge, reverse ? 'start' : 'end'));
      const sampled = sampleCubic(cubic, curveToleranceMM);
      sampled[0] = vertices.get(from)[0].point.slice();
      sampled[sampled.length - 1] = vertices.get(to)[0].point.slice();
      coordinates.push(...sampled.slice(0, -1));
      const token = JSON.stringify([
        edge.source.sketchId,
        edge.source.id,
        edge.instances,
      ]);
      lineage.push(token);
      segments.push({
        token,
        coordinates: sampled,
        ...(includeSource ? { edge, reverse } : {}),
      });
      if (to === first) {
        coordinates.push(coordinates[0].slice());
        break;
      }
      const candidate = vertices
        .get(to)
        .find((item) => item.edge.key !== edge.key);
      if (!candidate) fail('构面拓扑中断');
      edge = candidate.edge;
      reverse = candidate.end === 'end';
    }
    rings.push({
      coordinates,
      lineage: [...new Set(lineage)].sort(),
      segments,
    });
  }
  return rings;
}

function winding(point, ring) {
  let value = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const a = ring[i],
      b = ring[i + 1];
    const side =
      (b[0] - a[0]) * (point.y - a[1]) - (point.x - a[0]) * (b[1] - a[1]);
    if (a[1] <= point.y && b[1] > point.y && side > 0) value++;
    if (a[1] > point.y && b[1] <= point.y && side < 0) value--;
  }
  return value;
}

export function fillCurves(
  curveSet,
  {
    ownerNodeId = curveSet.frame.ownerNodeId,
    operatorId,
    rule = 'even-odd',
    geometrySettings,
  } = {},
) {
  const dependencies = [];
  try {
    if (!['even-odd', 'non-zero'].includes(rule)) fail('Fill 规则无效');
    if (typeof operatorId !== 'string' || !operatorId)
      fail('Fill 必须有算子身份');
    const rings = closedCurveRings(curveSet, geometrySettings);
    const lines = rings
      .filter((ring) => ring.coordinates.length >= 4)
      .map((ring) =>
        readGeometry({ type: 'LineString', coordinates: ring.coordinates }),
      );
    const faces = robustPolygonize(lines).filter((face) => {
      const point = face.getInteriorPoint().getCoordinate();
      const count = rings.reduce(
        (sum, ring) => sum + winding(point, ring.coordinates),
        0,
      );
      return rule === 'non-zero' ? count !== 0 : Math.abs(count) % 2 === 1;
    });
    let geometry = faces[0];
    for (const face of faces.slice(1)) geometry = geometry.union(face);
    const regions = [];
    const keys = new Set();
    for (const part of geometry ? polygonParts(geometry) : []) {
      const tolerance = geometrySettings?.numericTolerance || 1e-9;
      const boundary = part.getBoundary().buffer(tolerance * 4);
      const lineage = [
        ...new Set(
          rings
            .flatMap((ring) => ring.segments)
            .filter(
              (segment) =>
                readGeometry({
                  type: 'LineString',
                  coordinates: segment.coordinates,
                })
                  .intersection(boundary)
                  .getLength() >
                tolerance * 8,
            )
            .map((segment) => segment.token),
        ),
      ].sort();
      const key = JSON.stringify(['fill', lineage]);
      if (!lineage.length || keys.has(key))
        fail('构面输出来源无法唯一识别；需要明确拓扑契约');
      keys.add(key);
      const ref = makeOutputRef(
        ownerNodeId,
        operatorId,
        'regions',
        key,
        lineage,
      );
      regions.push({ ref, geometry: writer.write(part) });
    }
    return {
      domain: 'regions',
      status: regions.length ? 'ready' : 'empty',
      value: {
        frame: { kind: 'local', ownerNodeId },
        regions,
        provenance: regions.map((region) => ({
          ref: region.ref,
          sources: region.ref.lineage,
        })),
      },
      diagnostics: [],
      dependencies,
    };
  } catch (error) {
    return {
      domain: 'regions',
      status: 'blocked',
      value: null,
      diagnostics: [{ code: 'fill-blocked', message: error.message }],
      dependencies,
    };
  }
}
