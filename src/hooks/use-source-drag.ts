'use client';
import {
  useEffect,
  useRef,
  type PointerEvent,
  type KeyboardEvent,
} from 'react';
import { beginV4PointGesture } from '@/lib/source-editor/point-gesture.mjs';
import { beginV4PathGesture } from '@/lib/source-editor/path-gesture.mjs';
import { nodeSelection, selectedNode } from '@/lib/source-editor/node-edit.mjs';

type Point = { x: number; y: number };
type Selection = { curve: number; point: number } | null;
type SourceInput = Parameters<typeof beginV4PointGesture>[0];
type Active = {
  gesture: Pick<
    ReturnType<typeof beginV4PointGesture>,
    'update' | 'commit' | 'cancel'
  >;
  pointerId: number;
  target: Element;
  client: Point;
  origin: Point;
  moved: boolean;
};

/** Original source-drag interactions with a V4 source-command backend. Camera,
 * path selection and endpoint snapping remain explicit caller responsibilities.
 */
export function useSourceDrag({
  runtime,
  project,
  pathId,
  nodes,
  disabled = false,
  isPanning = () => false,
  toPoint,
  getCaptureTarget,
  onSelectionChange,
  onError,
}: Pick<SourceInput, 'runtime' | 'project' | 'pathId'> & {
  nodes: number[];
  disabled?: boolean;
  isPanning?: () => boolean;
  toPoint: (event: PointerEvent) => Point | null;
  getCaptureTarget: () => HTMLElement | SVGElement | null;
  onSelectionChange: (nodes: number[], selection: Selection) => void;
  onError: (error: unknown) => void;
}) {
  const active = useRef<Active | null>(null);
  const finish = (commit: boolean) => {
    const current = active.current;
    if (!current) return;
    active.current = null;
    try {
      if (commit && current.moved) current.gesture.commit();
      else current.gesture.cancel();
    } catch (error) {
      onError(error);
    } finally {
      if (current.target.hasPointerCapture(current.pointerId))
        current.target.releasePointerCapture(current.pointerId);
    }
  };
  useEffect(
    () => () => {
      const current = active.current;
      active.current = null;
      if (!current) return;
      try {
        current.gesture.cancel();
      } catch {
        /* Replacement already invalidates the gesture. */
      }
      if (current.target.hasPointerCapture(current.pointerId))
        current.target.releasePointerCapture(current.pointerId);
    },
    [],
  );
  const start = (
    event: PointerEvent,
    target: HTMLElement | SVGElement,
    origin: Point,
    gesture: Active['gesture'],
  ) => {
    active.current = {
      gesture,
      pointerId: event.pointerId,
      target,
      origin,
      client: { x: event.clientX, y: event.clientY },
      moved: false,
    };
    target.setPointerCapture(event.pointerId);
  };
  return {
    onPathPointerDown(event: PointerEvent, pathIds: string[]) {
      if (active.current || disabled || isPanning() || event.button !== 0)
        return;
      event.stopPropagation();
      event.preventDefault();
      const target = getCaptureTarget();
      const origin = toPoint(event);
      if (!target || !origin) return;
      target.focus({ preventScroll: true });
      try {
        start(
          event,
          target,
          origin,
          beginV4PathGesture({ runtime, project, pathIds }),
        );
      } catch (error) {
        finish(false);
        onError(error);
      }
    },
    onPointPointerDown(event: PointerEvent, curve: number, point: number) {
      if (active.current || disabled || isPanning() || event.button !== 0)
        return;
      event.stopPropagation();
      event.preventDefault();
      const target = getCaptureTarget();
      const origin = toPoint(event);
      if (!target || !origin) return;
      target.focus({ preventScroll: true });
      try {
        const path = runtime
          .readSourceView(project)
          .source.paths.find((path: { id: string }) => path.id === pathId);
        if (!path || !path.visible || path.locked)
          throw Error('当前线条不可编辑');
        const index = selectedNode(path, { curve, point });
        let selected: number[] = [];
        if (index !== null) {
          const modified = event.shiftKey || event.ctrlKey || event.metaKey;
          selected = modified
            ? nodes.includes(index)
              ? nodes.filter((node) => node !== index)
              : [...nodes, index]
            : nodes.includes(index)
              ? nodes
              : [index];
          onSelectionChange(
            selected,
            selected.length
              ? nodeSelection(
                  path,
                  selected.includes(index) ? index : selected.at(-1),
                )
              : null,
          );
          if (modified) return;
        } else onSelectionChange([], { curve, point });
        const gesture = beginV4PointGesture({
          runtime,
          project,
          pathId,
          curve,
          point,
          nodes: selected,
        });
        start(event, target, origin, gesture);
      } catch (error) {
        finish(false);
        onError(error);
      }
    },
    onPointerMove(event: PointerEvent) {
      const current = active.current;
      if (!current || current.pointerId !== event.pointerId) return;
      if (!(event.buttons & 1)) {
        finish(false);
        return;
      }
      const point = toPoint(event);
      if (!point) return;
      if (
        !current.moved &&
        Math.hypot(
          event.clientX - current.client.x,
          event.clientY - current.client.y,
        ) < 4
      )
        return;
      current.moved = true;
      let x = point.x - current.origin.x,
        y = point.y - current.origin.y;
      if (event.shiftKey) {
        if (Math.abs(x) > Math.abs(y)) y = 0;
        else x = 0;
      }
      try {
        current.gesture.update({ x, y });
      } catch (error) {
        finish(false);
        onError(error);
      }
    },
    onPointerUp(event: PointerEvent) {
      if (event.button === 0 && active.current?.pointerId === event.pointerId)
        finish(true);
    },
    onPointerCancel(event: PointerEvent) {
      if (active.current?.pointerId === event.pointerId) finish(false);
    },
    onLostPointerCapture(event: PointerEvent) {
      if (active.current?.pointerId === event.pointerId) finish(false);
    },
    onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && active.current) {
        event.preventDefault();
        event.stopPropagation();
        finish(false);
      }
    },
    cancel: () => finish(false),
  };
}
