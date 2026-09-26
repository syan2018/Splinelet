'use client';
import { useEffect, useRef } from 'react';
import type { Affine2D, Reference } from '@/lib/document/types';
import {
  inverseTransform,
  multiplyTransforms,
  transformPoint,
} from '@/lib/scene/transforms.mjs';

type Props = {
  reference: Reference;
  worldToPixel: number[];
  scale: number;
  pan?: boolean;
  onPreview: (matrix: Affine2D | null) => void;
  onCommit: (matrix: Affine2D) => void;
};

/** Local gesture preview; commit once on release. Cancel never enters history. */
export default function ReferenceHandles({
  reference,
  worldToPixel,
  scale,
  pan = false,
  onPreview,
  onCommit,
}: Props) {
  const group = useRef<SVGGElement>(null);
  const gesture = useRef<{
    pointerId: number;
    start: number[];
    center: number[];
    matrix: Affine2D;
    mode: 'move' | 'scale' | 'rotate';
    draft: Affine2D;
  } | null>(null);
  const cancel = () => {
    gesture.current = null;
    onPreview(null);
  };
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && gesture.current) {
        event.preventDefault();
        event.stopImmediatePropagation();
        cancel();
      }
    };
    window.addEventListener('keydown', key, true);
    window.addEventListener('blur', cancel);
    return () => {
      window.removeEventListener('keydown', key, true);
      window.removeEventListener('blur', cancel);
    };
  });
  const point = (event: React.PointerEvent) => {
    const screen = group.current?.getScreenCTM();
    if (!screen) return [0, 0];
    const p = new DOMPoint(event.clientX, event.clientY).matrixTransform(
      screen.inverse(),
    );
    return transformPoint(inverseTransform(worldToPixel), [p.x, p.y]);
  };
  const begin = (
    event: React.PointerEvent,
    mode: 'move' | 'scale' | 'rotate',
  ) => {
    if (event.button !== 0 || pan) return;
    event.preventDefault();
    event.stopPropagation();
    group.current?.setPointerCapture(event.pointerId);
    gesture.current = {
      pointerId: event.pointerId,
      mode,
      start: point(event),
      center: transformPoint(reference.pixelToWorld, [
        reference.pixelWidth / 2,
        reference.pixelHeight / 2,
      ]),
      matrix: [...reference.pixelToWorld],
      draft: [...reference.pixelToWorld],
    };
  };
  const matrix = multiplyTransforms(worldToPixel, reference.pixelToWorld);
  const corners = [
    [0, 0],
    [reference.pixelWidth, 0],
    [reference.pixelWidth, reference.pixelHeight],
    [0, reference.pixelHeight],
  ].map((p) => transformPoint(matrix, p));
  const middle = [
    (corners[0][0] + corners[1][0]) / 2,
    (corners[0][1] + corners[1][1]) / 2,
  ];
  const centerPixel = transformPoint(matrix, [
    reference.pixelWidth / 2,
    reference.pixelHeight / 2,
  ]);
  const distance =
    Math.hypot(middle[0] - centerPixel[0], middle[1] - centerPixel[1]) || 1;
  const rotate = middle.map(
    (n, i) => n + (((n - centerPixel[i]) / distance) * 26) / scale,
  );
  return (
    <g
      ref={group}
      data-reference-handles={reference.id}
      onPointerMove={(event) => {
        const g = gesture.current;
        if (!g || g.pointerId !== event.pointerId) return;
        event.stopPropagation();
        const p = point(event),
          [cx, cy] = g.center;
        let change: number[];
        if (g.mode === 'move')
          change = [1, 0, 0, 1, p[0] - g.start[0], p[1] - g.start[1]];
        else {
          const ratio =
            g.mode === 'scale'
              ? Math.max(
                  0.02,
                  Math.min(
                    50,
                    Math.hypot(p[0] - cx, p[1] - cy) /
                      Math.max(
                        1e-9,
                        Math.hypot(g.start[0] - cx, g.start[1] - cy),
                      ),
                  ),
                )
              : 1;
          let angle =
            g.mode === 'rotate'
              ? Math.atan2(p[1] - cy, p[0] - cx) -
                Math.atan2(g.start[1] - cy, g.start[0] - cx)
              : 0;
          if (event.shiftKey)
            angle = (Math.round(angle / (Math.PI / 12)) * Math.PI) / 12;
          const c = Math.cos(angle) * ratio,
            s = Math.sin(angle) * ratio;
          change = [c, s, -s, c, cx - c * cx + s * cy, cy - s * cx - c * cy];
        }
        g.draft = multiplyTransforms(change, g.matrix) as Affine2D;
        onPreview(g.draft);
      }}
      onPointerUp={(event) => {
        const g = gesture.current;
        if (!g || g.pointerId !== event.pointerId) return;
        event.stopPropagation();
        gesture.current = null;
        onPreview(null);
        onCommit(g.draft);
        group.current?.releasePointerCapture(event.pointerId);
      }}
      onPointerCancel={cancel}
      onLostPointerCapture={() => {
        if (gesture.current) cancel();
      }}
    >
      <polygon
        points={corners.map((p) => p.join(',')).join(' ')}
        fill="transparent"
        stroke="#b8ef62"
        strokeWidth={1.5 / scale}
        style={{ cursor: 'move' }}
        onPointerDown={(e) => begin(e, 'move')}
      />
      {corners.map(([x, y], index) => (
        <rect
          key={index}
          aria-label="缩放参考图"
          x={x - 5 / scale}
          y={y - 5 / scale}
          width={10 / scale}
          height={10 / scale}
          fill="#b8ef62"
          stroke="#172126"
          strokeWidth={1 / scale}
          style={{ cursor: 'nwse-resize' }}
          onPointerDown={(e) => begin(e, 'scale')}
        />
      ))}
      <line
        x1={middle[0]}
        y1={middle[1]}
        x2={rotate[0]}
        y2={rotate[1]}
        stroke="#b8ef62"
        strokeWidth={1 / scale}
        pointerEvents="none"
      />
      <circle
        aria-label="旋转参考图"
        cx={rotate[0]}
        cy={rotate[1]}
        r={6 / scale}
        fill="#b8ef62"
        stroke="#172126"
        strokeWidth={1 / scale}
        style={{ cursor: 'grab' }}
        onPointerDown={(e) => begin(e, 'rotate')}
      />
    </g>
  );
}
