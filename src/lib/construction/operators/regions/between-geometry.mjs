import GeoJSONWriter from 'jsts/org/locationtech/jts/io/GeoJSONWriter.js';
import { readGeometry, validateArea } from '../../../region-engine.mjs';
import { sampleCubic } from './fill.mjs';

const writer = new GeoJSONWriter();
const gap = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const snapRing = (ring, point) => {
  let best;
  for (let index = 0; index < ring.length - 1; index++) {
    const a = ring[index];
    const b = ring[index + 1];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const length = dx * dx + dy * dy;
    const t = length
      ? Math.max(
          0,
          Math.min(
            1,
            ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / length,
          ),
        )
      : 0;
    const hit = [a[0] + dx * t, a[1] + dy * t];
    const gapMM = gap(point, hit);
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
  const forward = boundaryRoute(ring, from, to);
  const backward = boundaryRoute(ring, to, from).reverse();
  return routeLength(forward) <= routeLength(backward) ? forward : backward;
};
const sample = (curve, toleranceMM) =>
  curve.edges.flatMap((edge, index) =>
    sampleCubic(edge.cubic, toleranceMM).slice(index ? 1 : 0),
  );

/**
 * Derives between geometry without construction identities or document writes.
 * `boundaryGeometry`, when present, must be a single-ring GeoJSON Polygon.
 */
export function betweenGeometry({
  curves,
  params,
  boundaryGeometry,
  geometrySettings,
}) {
  const [aKey, bKey] = params?.curveKeys || [];
  const a = curves?.find((curve) => curve.key === aKey);
  const b = curves?.find((curve) => curve.key === bKey);
  if (!a || !b || a === b) throw Error('between 引用的两条曲线必须存在且不同');
  const left = sample(a, geometrySettings?.curveToleranceMM);
  const right = sample(b, geometrySettings?.curveToleranceMM);
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
  if (boundaryGeometry !== undefined) {
    if (
      boundaryGeometry?.type !== 'Polygon' ||
      boundaryGeometry.coordinates.length !== 1
    )
      throw Error('between boundary 必须是单一无孔 Polygon Region');
    const ringBoundary = boundaryGeometry.coordinates[0];
    const pairs = [
      [left.at(-1), ring[left.length]],
      [ring.at(-2), left[0]],
    ].map(([from, to]) => ({
      from,
      to,
      a: snapRing(ringBoundary, from),
      b: snapRing(ringBoundary, to),
    }));
    const joinMM = params.boundaryJoinMM ?? 0;
    if (pairs.some((pair) => Math.max(pair.a.gapMM, pair.b.gapMM) > joinMM))
      throw Error('between 端点超过 boundaryJoinMM，拒绝隐式直线补边');
    const first = shortestBoundaryRoute(ringBoundary, pairs[0].a, pairs[0].b);
    const second = shortestBoundaryRoute(ringBoundary, pairs[1].a, pairs[1].b);
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
  const warnings = [];
  if (!part.isValid() && params.repair === true)
    part = validateArea(part, true, warnings);
  if (!part.isValid() || part.isEmpty())
    throw Error('between 的显式端点边界不能形成有效区域');
  return {
    geometry: writer.write(part),
    connections,
    curves: [a, b],
    warnings,
  };
}
