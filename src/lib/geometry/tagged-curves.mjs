import { deCasteljau } from './sketch-edit.mjs';

const distance = (point, from, to) => {
  const dx = to[0] - from[0],
    dy = to[1] - from[1];
  const length = dx * dx + dy * dy;
  const t = length
    ? Math.max(
        0,
        Math.min(
          1,
          ((point[0] - from[0]) * dx + (point[1] - from[1]) * dy) / length,
        ),
      )
    : 0;
  return Math.hypot(point[0] - from[0] - t * dx, point[1] - from[1] - t * dy);
};

export function sampleTaggedCubic(
  cubic,
  toleranceMM,
  source,
  sourceParameter,
  depth = 0,
) {
  if (!Number.isFinite(toleranceMM) || toleranceMM <= 0)
    throw Error('曲线采样容差无效');
  if (
    Math.max(
      distance(cubic[1], cubic[0], cubic[3]),
      distance(cubic[2], cubic[0], cubic[3]),
    ) <= toleranceMM
  )
    return [
      {
        coordinates: [cubic[0].slice(), cubic[3].slice()],
        source,
        sourceParameter: sourceParameter.slice(),
      },
    ];
  if (depth >= 22) throw Error('曲线采样超过细分限额');
  const split = deCasteljau(cubic, 0.5);
  const middle = (sourceParameter[0] + sourceParameter[1]) / 2;
  return [
    ...sampleTaggedCubic(
      split.first,
      toleranceMM,
      source,
      [sourceParameter[0], middle],
      depth + 1,
    ),
    ...sampleTaggedCubic(
      split.second,
      toleranceMM,
      source,
      [middle, sourceParameter[1]],
      depth + 1,
    ),
  ];
}

export function taggedCurveSource(edge, { operatorId, role }) {
  if (!edge.logicalSource || !edge.basisSpan)
    throw Error('源路径缺少逻辑参数基准');
  const [a, b, c, d] = edge.transform;
  const parity = Math.sign(a * d - b * c);
  if (!parity) throw Error('不可逆的曲线实例变换');
  return {
    kind: 'curve-use',
    operatorId,
    role,
    ...edge.logicalSource,
    instances: edge.instances,
    parity,
    ...(edge.basisPeriod ? { basisPeriod: edge.basisPeriod } : {}),
    ...(edge.generatedAttachment && {
      kind: 'generated-join',
      operatorId: edge.generatedAttachment.operatorId,
      role: 'endpoint-join',
      endpoint: edge.basisSpan[edge.generatedAttachment.endpoint ? 0 : 1],
    }),
  };
}

export function sampleTaggedCurves(
  curveSet,
  { operatorId, role, toleranceMM },
) {
  return curveSet.curves.flatMap((curve) =>
    curve.edges.flatMap((edge) =>
      sampleTaggedCubic(
        edge.cubic,
        toleranceMM,
        taggedCurveSource(edge, { operatorId, role }),
        edge.basisSpan,
      ),
    ),
  );
}

/** A RegionSet carries directed provenance on every boundary edge. */
export function boundarySegments(region) {
  if (!region.boundaries) throw Error('区域没有可追溯边界');
  return region.boundaries.flatMap((boundary) =>
    [boundary.outer, ...boundary.holes].flatMap((ring) =>
      ring.flatMap((edge) =>
        edge.sources.map((item) => ({
          coordinates: edge.coordinates,
          source: item.source,
          sourceParameter: item.sourceParameter,
        })),
      ),
    ),
  );
}

export function transformRegionBoundaries(boundaries, transform, instance) {
  if (!boundaries) return undefined;
  const [a, b, c, d, e, f] = transform;
  const parity = Math.sign(a * d - b * c);
  if (!parity) throw Error('不可逆的区域实例变换');
  const point = ([x, y]) => [a * x + c * y + e, b * x + d * y + f];
  const ring = (edges) =>
    edges.map((edge) => ({
      ...edge,
      coordinates: edge.coordinates.map(point),
      sources: edge.sources.map((item) => ({
        ...item,
        source: {
          ...item.source,
          parity: (item.source.parity || 1) * parity,
          ...(instance
            ? { instances: [...(item.source.instances || []), instance] }
            : {}),
        },
      })),
    }));
  return boundaries.map((boundary) => ({
    outer: ring(boundary.outer),
    holes: boundary.holes.map(ring),
  }));
}
