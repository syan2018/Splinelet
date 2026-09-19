import type { Point } from '@/lib/project';

export type EndpointSnapFeedback = {
  kind: string;
  label: string;
  position: Point;
  raw: Point;
  direction?: Point;
  locked: boolean;
};

export default function EndpointSnapOverlay({
  feedback,
  scale,
  guides = [],
}: {
  feedback: EndpointSnapFeedback | null;
  scale: number;
  guides?: { point: Point; direction: Point }[];
}) {
  if (!feedback)
    return (
      <g pointerEvents="none">
        {guides.map((g, i) => (
          <line
            key={i}
            data-endpoint-guide
            x1={g.point.x - (g.direction.x * 2000) / scale}
            y1={g.point.y - (g.direction.y * 2000) / scale}
            x2={g.point.x + (g.direction.x * 2000) / scale}
            y2={g.point.y + (g.direction.y * 2000) / scale}
            stroke="#65d9ff"
            strokeWidth={1 / scale}
            strokeDasharray={`${4 / scale} ${6 / scale}`}
            opacity="0.3"
          />
        ))}
      </g>
    );
  const { position: p, direction: d, raw } = feedback;
  return (
    <g pointerEvents="none" data-endpoint-snap={feedback.kind}>
      {d && (
        <line
          x1={p.x - (d.x * 2000) / scale}
          y1={p.y - (d.y * 2000) / scale}
          x2={p.x + (d.x * 2000) / scale}
          y2={p.y + (d.y * 2000) / scale}
          stroke="#65d9ff"
          strokeWidth={1 / scale}
          strokeDasharray={`${5 / scale} ${4 / scale}`}
          opacity="0.75"
        />
      )}
      <line
        x1={raw.x}
        y1={raw.y}
        x2={p.x}
        y2={p.y}
        stroke="#65d9ff"
        strokeWidth={1 / scale}
        strokeDasharray={`${3 / scale} ${3 / scale}`}
      />
      <circle
        cx={p.x}
        cy={p.y}
        r={7 / scale}
        fill="none"
        stroke="#65d9ff"
        strokeWidth={2 / scale}
      />
      <text
        x={p.x + 13 / scale}
        y={p.y + 20 / scale}
        fontSize={12 / scale}
        fill="#99e9ff"
        paintOrder="stroke"
        stroke="#142229"
        strokeWidth={3 / scale}
      >
        {feedback.locked ? '保持' : '吸附'}：{feedback.label}
      </text>
    </g>
  );
}
