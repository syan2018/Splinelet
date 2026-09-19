'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  screenToWorld,
  useV4CanvasGestures,
  type V4CanvasAction,
} from '@/hooks/use-v4-canvas-gestures';

type Point = [number, number];
type Candidate = {
  ref: unknown;
  color?: string | null;
  painted?: boolean;
  geometry: { type: string; coordinates: unknown };
};
type Curve = { edges: { cubic: Point[] }[] };
export type V4CanvasProps = {
  document: unknown;
  projection: { canvas: { candidates: Candidate[]; curves: Curve[] } };
  selection: unknown;
  tool: 'select' | 'move' | 'anchor' | 'pen';
  nodeIds: string[];
  ownerNodeId?: string;
  onAction(action: V4CanvasAction): void;
  onPreviewStart(): void;
  onPreviewUpdate(action: V4CanvasAction): void;
  onPreviewCommit(): void;
  onPreviewCancel(reason: 'escape' | 'blur' | 'lost-pointer' | 'cancel'): void;
  onSelectionChange?(value: unknown): void;
};
const ring = (points: unknown) =>
  Array.isArray(points) && points.length
    ? `M ${(points as Point[]).map(([x, y]) => `${x} ${y}`).join(' L ')} Z`
    : '';
/** Keeps each Polygon ring and MultiPolygon member independent, preserving holes under even-odd fill. */
export const regionPath = (geometry: Candidate['geometry']) =>
  geometry.type === 'Polygon'
    ? (geometry.coordinates as unknown[]).map(ring).join(' ')
    : geometry.type === 'MultiPolygon'
      ? (geometry.coordinates as unknown[][])
          .flatMap((polygon) => polygon.map(ring))
          .join(' ')
      : '';
export const cubicPath = (edges: Curve['edges']) =>
  edges
    .map(({ cubic }) =>
      cubic.length === 4
        ? `M ${cubic[0][0]} ${cubic[0][1]} C ${cubic[1][0]} ${cubic[1][1]}, ${cubic[2][0]} ${cubic[2][1]}, ${cubic[3][0]} ${cubic[3][1]}`
        : '',
    )
    .join(' ');
export function V4Canvas(props: V4CanvasProps) {
  const host = useRef<HTMLButtonElement>(null);
  const [viewBox, setViewBox] = useState<[number, number, number, number]>([
    -100, -100, 200, 200,
  ]);
  const [points, setPoints] = useState<Point[]>([]);
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const observer = new ResizeObserver(() => {
      const { width, height } = element.getBoundingClientRect();
      if (!width || !height) return;
      setViewBox((value) => {
        const nextHeight = (value[2] * height) / width;
        return Math.abs(nextHeight - value[3]) < 1e-6
          ? value
          : [
              value[0],
              value[1] + (value[3] - nextHeight) / 2,
              value[2],
              nextHeight,
            ];
      });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const finish = useCallback(
    (closed: boolean) => {
      if (points.length < (closed ? 3 : 2)) return;
      props.onAction({
        kind: 'draw-path',
        points,
        ownerNodeId: props.ownerNodeId,
        closed,
      });
      setPoints([]);
    },
    [points, props],
  );
  const gestures = useV4CanvasGestures({
    ...props,
    viewBox,
    onPan: (d) => setViewBox((v) => [v[0] - d[0], v[1] - d[1], v[2], v[3]]),
  });
  const click = (event: React.MouseEvent<HTMLButtonElement>) => {
    if (gestures.ignoreClick()) return;
    const candidate = (event.target as HTMLElement).closest<SVGPathElement>(
      '[data-candidate]',
    );
    if (candidate && props.tool !== 'pen') {
      props.onAction({
        kind: 'select-candidate',
        target:
          props.projection.canvas.candidates[
            Number(candidate.dataset.candidate)
          ].ref,
      });
      return;
    }
    if (props.tool !== 'pen') return;
    const rect = event.currentTarget.getBoundingClientRect(),
      next = screenToWorld(event.clientX, event.clientY, rect, viewBox);
    if (
      points.length >= 3 &&
      Math.hypot(next[0] - points[0][0], next[1] - points[0][1]) < 2
    ) {
      finish(true);
      return;
    }
    setPoints((value) => [...value, next]);
  };
  useEffect(() => {
    const cancel = () => {
      setPoints([]);
      gestures.cancel('blur');
    };
    window.addEventListener('blur', cancel);
    return () => window.removeEventListener('blur', cancel);
  }, [gestures]);
  return (
    <button
      type="button"
      ref={host}
      aria-label="建模画布"
      style={{
        width: '100%',
        height: '100%',
        minHeight: 0,
        display: 'block',
        padding: 0,
        border: 0,
        touchAction: 'none',
        background: '#171b24',
      }}
      onClick={click}
      onBlur={() => {
        setPoints([]);
        gestures.cancel('blur');
      }}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === 'Escape') {
          setPoints([]);
          gestures.cancel('escape');
        }
        if (e.key === 'Enter') {
          e.preventDefault();
          finish(false);
        }
        if (e.key === ' ') {
          e.preventDefault();
          gestures.setSpacePanning(true);
        }
      }}
      onKeyUp={(e) => {
        if (e.key === ' ') gestures.setSpacePanning(false);
      }}
      onContextMenu={(e) => e.preventDefault()}
      onPointerDown={gestures.onPointerDown}
      onPointerMove={gestures.onPointerMove}
      onPointerUp={gestures.onPointerUp}
      onLostPointerCapture={gestures.onLostPointerCapture}
      onPointerCancel={gestures.onPointerCancel}
    >
      <svg
        aria-hidden="true"
        style={{ width: '100%', height: '100%', display: 'block' }}
        preserveAspectRatio="none"
        viewBox={[
          viewBox[0],
          -viewBox[1] - viewBox[3],
          viewBox[2],
          viewBox[3],
        ].join(' ')}
      >
        <g transform="scale(1 -1)">
          {props.projection.canvas.curves.map((curve, i) => (
            <path
              key={`c${i}`}
              d={cubicPath(curve.edges)}
              fill="none"
              stroke="#eee"
            />
          ))}
          {props.projection.canvas.candidates.map((candidate, i) => (
            <path
              key={`r${i}`}
              data-candidate={i}
              d={regionPath(candidate.geometry)}
              fill={
                candidate.painted
                  ? candidate.color || '#808080'
                  : 'rgba(80,160,255,.18)'
              }
              fillRule="evenodd"
              stroke="#4d9fff"
            />
          ))}
          {points.length > 1 && (
            <polyline
              points={points.map(([x, y]) => `${x},${y}`).join(' ')}
              fill="none"
              stroke="#fff"
            />
          )}
        </g>
      </svg>
    </button>
  );
}
