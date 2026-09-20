'use client';
import { useRef } from 'react';
export type V4CanvasAction =
  | { kind: 'move-nodes'; nodeIds: string[]; deltaMM: [number, number] }
  | {
      kind: 'set-vertex';
      sketchId: string;
      vertexId: string;
      value: [number, number];
    }
  | {
      kind: 'set-handle';
      sketchId: string;
      edgeId: string;
      end: 'start' | 'end';
      vector: [number, number];
    }
  | {
      kind: 'draw-path';
      points: [number, number][];
      ownerNodeId?: string;
      closed: boolean;
      cubics?: unknown;
    }
  | { kind: 'close-path'; sketchId: string; pathId: string }
  | { kind: 'select-candidate'; target: unknown };
export const screenToWorld = (
  clientX: number,
  clientY: number,
  rect: { left: number; top: number; width: number; height: number },
  viewBox: [number, number, number, number],
): [number, number] => [
  viewBox[0] + ((clientX - rect.left) * viewBox[2]) / rect.width,
  viewBox[1] +
    ((rect.height - (clientY - rect.top)) * viewBox[3]) / rect.height,
];
export function useV4CanvasGestures(p: {
  tool: string;
  nodeIds: string[];
  viewBox: [number, number, number, number];
  onAction: (a: V4CanvasAction) => void;
  onPreviewStart: () => void;
  onPreviewUpdate: (a: V4CanvasAction) => void;
  onPreviewCommit: () => void;
  onPreviewCancel: (r: 'escape' | 'blur' | 'lost-pointer' | 'cancel') => void;
  onPan?: (d: [number, number]) => void;
}) {
  const drag = useRef<{
    screen: [number, number];
    last: [number, number];
    scale: [number, number];
    pan: boolean;
    preview: boolean;
  } | null>(null);
  const space = useRef(false),
    suppressClick = useRef(false);
  const onPointerDown = (e: React.PointerEvent<HTMLElement>) => {
    if (!e.isPrimary || drag.current) return;
    const pan = e.button === 1 || e.button === 2 || space.current;
    suppressClick.current = pan;
    if (!pan && (e.button !== 0 || p.tool !== 'move' || !p.nodeIds.length))
      return;
    const rect = e.currentTarget.getBoundingClientRect();
    drag.current = {
      screen: [e.clientX, e.clientY],
      last: [e.clientX, e.clientY],
      scale: [p.viewBox[2] / rect.width, p.viewBox[3] / rect.height],
      pan,
      preview: false,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
    e.preventDefault();
  };
  const update = (e: React.PointerEvent<HTMLElement>) => {
    const active = drag.current;
    if (!active) return;
    const dx = e.clientX - active.screen[0],
      dy = e.clientY - active.screen[1];
    if (active.pan) {
      p.onPan?.([
        (e.clientX - active.last[0]) * active.scale[0],
        -(e.clientY - active.last[1]) * active.scale[1],
      ]);
      active.last = [e.clientX, e.clientY];
      return;
    }
    if (!active.preview && Math.hypot(dx, dy) < 4) return;
    suppressClick.current = true;
    if (!active.preview) {
      p.onPreviewStart();
      active.preview = true;
    }
    p.onPreviewUpdate({
      kind: 'move-nodes',
      nodeIds: p.nodeIds,
      deltaMM: [dx * active.scale[0], -dy * active.scale[1]],
    });
  };
  const onPointerUp = (e: React.PointerEvent<HTMLElement>) => {
    if (!drag.current) return;
    update(e);
    const active = drag.current;
    drag.current = null;
    if (active.preview) p.onPreviewCommit();
    if (e.currentTarget.hasPointerCapture(e.pointerId))
      e.currentTarget.releasePointerCapture(e.pointerId);
  };
  const cancel = (reason: 'escape' | 'blur' | 'lost-pointer' | 'cancel') => {
    const active = drag.current;
    drag.current = null;
    space.current = false;
    if (active?.preview) p.onPreviewCancel(reason);
  };
  return {
    onPointerDown,
    onPointerMove: update,
    onPointerUp,
    onLostPointerCapture: () => cancel('lost-pointer'),
    onPointerCancel: () => cancel('cancel'),
    cancel,
    setSpacePanning: (value: boolean) => (space.current = value),
    ignoreClick: () => suppressClick.current,
  };
}
