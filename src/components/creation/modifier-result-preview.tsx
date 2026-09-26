import type { StageResult } from '@/lib/construction/types';
type Point = [number, number];
type GeometryValue = {
  regions?: {
    geometry: { type: string; coordinates: Point[][] | Point[][][] };
  }[];
  curves?: { edges: { cubic: Point[] }[] }[];
};

/** Read-only geometry. No hit targets, source snapping or author commands. */
export function ResultPreview({
  stage,
  label,
}: {
  stage: StageResult;
  label: string;
}) {
  const value = stage.value as GeometryValue | undefined;
  const paths: string[] = [];
  const points: Point[] = [];
  for (const region of value?.regions || []) {
    const polygons =
      region.geometry.type === 'Polygon'
        ? [region.geometry.coordinates as Point[][]]
        : (region.geometry.coordinates as Point[][][]);
    for (const polygon of polygons) {
      paths.push(
        polygon
          .map((ring) => {
            points.push(...ring);
            return (
              ring.map((p, i) => `${i ? 'L' : 'M'}${p[0]},${p[1]}`).join(' ') +
              ' Z'
            );
          })
          .join(' '),
      );
    }
  }
  for (const curve of value?.curves || [])
    for (const edge of curve.edges) {
      points.push(...edge.cubic);
      const [a, b, c, d] = edge.cubic;
      paths.push(
        `M${a.join(',')} C${b.join(',')} ${c.join(',')} ${d.join(',')}`,
      );
    }
  if (!points.length)
    return (
      <p className="modifier-hint">
        {label}：{stage.status === 'empty' ? '空结果' : '无可显示几何'}
      </p>
    );
  // Avoid argument spreading on large snapshots.
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const [x, y] of points) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  const pad = Math.max(maxX - minX, maxY - minY, 1) * 0.04;
  return (
    <figure style={{ margin: '8px 0' }}>
      <figcaption className="modifier-hint">{label}</figcaption>
      <svg
        aria-label={label}
        width="100%"
        height="120"
        viewBox={`${minX - pad} ${-maxY - pad} ${maxX - minX + 2 * pad} ${maxY - minY + 2 * pad}`}
      >
        <g
          transform="scale(1,-1)"
          fill={value?.regions ? 'currentColor' : 'none'}
          fillOpacity={0.25}
          stroke="currentColor"
          fillRule="evenodd"
        >
          {paths.map((d, index) => (
            <path
              key={index}
              d={d}
              vectorEffect="non-scaling-stroke"
              strokeWidth={1}
            />
          ))}
        </g>
      </svg>
    </figure>
  );
}
