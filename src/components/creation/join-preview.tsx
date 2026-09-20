'use client';
import { resolveJoinPairs } from '@/lib/construction/operators/curves/join-selection.mjs';
import type { JoinConnection, JoinEndpointOption } from '@/lib/modifier-types';

const path = (points: number[][]) =>
  `M ${points[0].join(',')} C ${points[1].join(',')} ${points[2].join(',')} ${points[3].join(',')}`;
/** Local evaluated curves only; this diagram never writes geometry or stores
 * a second selection. A/B colors match the endpoint controls below. */
export default function JoinPreview({
  options,
  connection,
}: {
  options: JoinEndpointOption[];
  connection?: JoinConnection;
}) {
  const edges = options
    .filter((option) => option.endpoint.edgeEnd.end === 'start')
    .map((option) => ({
      cubic: option.cubic,
      source: {
        sketchId: option.endpoint.edgeEnd.sketchId,
        id: option.endpoint.edgeEnd.edgeId,
      },
      instances: [
        ...(option.endpoint.instances || []),
        ...(option.endpoint.selector ? [option.endpoint.selector] : []),
      ],
    }));
  const pairs = connection
    ? (resolveJoinPairs(edges, connection) as {
        a?: { cubic: number[][] };
        b?: { cubic: number[][] };
      }[])
    : [];
  const curves = [
    ...new Map(
      options.map((option) => [JSON.stringify(option.cubic), option.cubic]),
    ).values(),
  ];
  const points = curves.flat();
  if (!points.length) return null;
  const minX = Math.min(...points.map((point) => point[0]));
  const minY = Math.min(...points.map((point) => point[1]));
  const width = Math.max(...points.map((point) => point[0])) - minX;
  const height = Math.max(...points.map((point) => point[1])) - minY;
  const size = Math.max(width, height, 1);
  const pad = size * 0.1;
  return (
    <svg
      aria-label="连接端点预览"
      width="100%"
      height="140"
      viewBox={`${minX - pad} ${minY - pad} ${width + 2 * pad} ${height + 2 * pad}`}
    >
      <title>
        当前修改器输入；A 为金色，B 为青色。重复选择高亮全部匹配实例。
      </title>
      <g transform={`translate(0 ${2 * minY + height}) scale(1 -1)`}>
        {curves.map((cubic, index) => (
          <path
            key={index}
            d={path(cubic)}
            fill="none"
            stroke="currentColor"
            opacity="0.3"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {connection &&
          (['a', 'b'] as const).flatMap((side) =>
            pairs.flatMap((pair, index) => {
              const edge = pair[side];
              if (!edge) return [];
              const point =
                edge.cubic[connection[side].edgeEnd.end === 'start' ? 0 : 3];
              const color = side === 'a' ? '#e8ba65' : '#65d8ef';
              return (
                <g key={`${side}-${index}`} data-join-highlight={side}>
                  <path
                    d={path(edge.cubic)}
                    fill="none"
                    stroke={color}
                    strokeWidth="2"
                    vectorEffect="non-scaling-stroke"
                  />
                  <circle
                    cx={point[0]}
                    cy={point[1]}
                    r={size * (side === 'a' ? 0.025 : 0.015)}
                    fill={color}
                  />
                </g>
              );
            }),
          )}
      </g>
    </svg>
  );
}
