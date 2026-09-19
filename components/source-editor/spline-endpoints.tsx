'use client';
import type { TracePath } from '@/lib/project';

export default function SplineEndpoints({
  path,
  scale,
  drawing,
  end,
  disabled,
  onResume,
  onClose,
  isPanning,
}: {
  path: TracePath;
  scale: number;
  drawing: boolean;
  end: 'start' | 'end';
  disabled: boolean;
  onResume: (end: 'start' | 'end') => void;
  onClose: (e: React.PointerEvent) => void;
  isPanning: () => boolean;
}) {
  if (path.closed) return null;
  const ends: ('start' | 'end')[] = path.curves.length
    ? ['start', 'end']
    : [end];
  return (
    <g className="spline-endpoints">
      {ends.map((side) => {
        const p =
          side === 'start' ? path.start : path.curves.at(-1)?.[3] || path.start;
        const active = drawing && side === end;
        const closing = drawing && !active && !!path.curves.length;
        const label = !path.curves.length
          ? '起点'
          : side === 'start'
            ? '头'
            : '尾';
        const action = active
          ? `正在从${label}端点续画`
          : closing
            ? `闭合到${label}端点`
            : `从${label}端点续画`;
        return (
          <g
            key={side}
            role="button"
            aria-label={action}
            aria-disabled={disabled || active}
            data-trace-endpoint={side}
            transform={`translate(${p.x},${p.y}) scale(${1 / scale})`}
            style={{ cursor: disabled || active ? 'default' : 'crosshair' }}
            onPointerDown={(e) => {
              if (e.button !== 0 || isPanning()) return;
              e.stopPropagation();
              e.preventDefault();
              if (disabled || active) return;
              if (closing) onClose(e);
              else onResume(side);
            }}
          >
            <title>{action}</title>
            <rect
              x="-13"
              y="-25"
              width={26 + (label.length + (closing ? 5 : active ? 6 : 5)) * 12}
              height="38"
              fill="transparent"
            />
            <circle r="13" fill="transparent" />
            <circle
              r="7"
              fill={active ? '#c4ef77' : '#192e2a'}
              stroke="#c4ef77"
              strokeWidth="1.8"
              pointerEvents="none"
            />
            {active && (
              <circle
                r="10"
                fill="none"
                stroke="#c4ef7788"
                pointerEvents="none"
              />
            )}
            <text
              x="13"
              y="-10"
              fill="#e5ffc5"
              stroke="#162321"
              strokeWidth="4"
              paintOrder="stroke"
              fontSize="12"
              pointerEvents="none"
            >
              {label}
              {closing ? ' · 闭合' : active ? ' · 续画中' : ' · 续画'}
            </text>
          </g>
        );
      })}
    </g>
  );
}
