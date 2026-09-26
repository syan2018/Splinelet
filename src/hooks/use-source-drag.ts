'use client';
import {
  useEffect,
  useRef,
  useState,
  type PointerEvent,
  type KeyboardEvent,
} from 'react';
import { beginV4PointGesture } from '@/lib/source-editor/point-gesture.mjs';
import { beginV4PathGesture } from '@/lib/source-editor/path-gesture.mjs';
import { nodeSelection, selectedNode } from '@/lib/source-editor/node-edit.mjs';
import { snapEndpoint } from '@/lib/source-editor/endpoint-snap.mjs';
import type { StudioDisplayPath } from '@/lib/editor/studio-display-types';

type Point = { x: number; y: number };
type Selection = { curve: number; point: number } | null;
type SourceInput = Parameters<typeof beginV4PointGesture>[0];
type SourceRuntime = NonNullable<SourceInput['runtime']>;
type SourcePreview = Readonly<{
  identity: string;
  runtime: SourceRuntime;
  paths: readonly StudioDisplayPath[];
}>;
type Active = {
  gesture: Pick<
    ReturnType<typeof beginV4PointGesture>,
    'update' | 'commit' | 'cancel'
  >;
  pointerId: number;
  target: Element;
  client: Point;
  origin: Point;
  identity: string;
  runtime: SourceRuntime;
  moved: boolean;
  snapContext?: ReturnType<SourceInput['runtime']['readEndpointSnapContext']>;
  snapId?: string;
};

/** Original source-drag interactions with a V4 source-command backend. Camera,
 * path selection and snap feedback rendering remain caller responsibilities.
 */
export function useSourceDrag({
  runtime,
  project,
  pathId,
  sourceIdentity,
  nodes,
  disabled = false,
  isPanning = () => false,
  toPoint,
  getCaptureTarget,
  onSelectionChange,
  onError,
  onActiveChange,
  snapEnabled = false,
  scale = 1,
  onSnapFeedback = () => {},
}: Pick<SourceInput, 'project' | 'pathId'> & {
  runtime: SourceInput['runtime'] | null;
  sourceIdentity: string;
  nodes: number[];
  disabled?: boolean;
  isPanning?: () => boolean;
  toPoint: (event: PointerEvent) => Point | null;
  getCaptureTarget: () => HTMLElement | SVGElement | null;
  onSelectionChange: (nodes: number[], selection: Selection) => void;
  onError: (error: unknown) => void;
  onActiveChange: (active: boolean) => void;
  snapEnabled?: boolean;
  scale?: number;
  onSnapFeedback?: (feedback: ReturnType<typeof snapEndpoint>) => void;
}) {
  const active = useRef<Active | null>(null);
  const onActiveChangeRef = useRef(onActiveChange);
  const [sourcePreview, setSourcePreview] = useState<SourcePreview | null>(
    null,
  );
  useEffect(() => {
    onActiveChangeRef.current = onActiveChange;
  }, [onActiveChange]);
  useEffect(() => {
    const current = active.current;
    if (
      current &&
      (current.identity !== sourceIdentity || current.runtime !== runtime)
    ) {
      active.current = null;
      try {
        current.gesture.cancel();
      } catch {
        /* Replacing an editor can invalidate its display-only gesture first. */
      }
      if (current.target.hasPointerCapture(current.pointerId))
        current.target.releasePointerCapture(current.pointerId);
      onActiveChangeRef.current(false);
    }
  }, [runtime, sourceIdentity]);
  const finish = (commit: boolean) => {
    const current = active.current;
    if (!current) return;
    active.current = null;
    onSnapFeedback(null);
    try {
      if (commit && current.moved) {
        current.gesture.commit();
      } else current.gesture.cancel();
    } catch (error) {
      try {
        current.gesture.cancel();
      } catch {
        /* The runtime may already have invalidated this preview. */
      }
      onError(error);
    } finally {
      setSourcePreview(null);
      onActiveChange(false);
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
    snapContext?: Active['snapContext'],
  ) => {
    if (!runtime) throw Error('源编辑运行时不可用');
    active.current = {
      gesture,
      pointerId: event.pointerId,
      target,
      origin,
      client: { x: event.clientX, y: event.clientY },
      moved: false,
      identity: sourceIdentity,
      runtime,
      snapContext,
    };
    target.setPointerCapture(event.pointerId);
    onActiveChange(true);
  };
  return {
    onPathPointerDown(event: PointerEvent, pathIds: string[]) {
      if (!runtime) return false;
      if (active.current || disabled || isPanning() || event.button !== 0)
        return false;
      event.stopPropagation();
      event.preventDefault();
      const target = getCaptureTarget();
      const origin = toPoint(event);
      if (!target || !origin) return false;
      target.focus({ preventScroll: true });
      try {
        start(
          event,
          target,
          origin,
          beginV4PathGesture({ runtime, project, pathIds, displayOnly: true }),
        );
        return true;
      } catch (error) {
        finish(false);
        onError(error);
        return false;
      }
    },
    onPointPointerDown(event: PointerEvent, curve: number, point: number) {
      if (!runtime) return;
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
        const snapContext =
          snapEnabled && selected.length === 1
            ? runtime.readEndpointSnapContext(project, pathId, selected[0])
            : null;
        const gesture = beginV4PointGesture({
          runtime,
          project,
          pathId,
          curve,
          point,
          nodes: selected,
          displayOnly: true,
        });
        start(event, target, origin, gesture, snapContext);
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
        const snap =
          snapEnabled && !event.altKey && !event.shiftKey && current.snapContext
            ? snapEndpoint(
                current.snapContext,
                {
                  x: current.snapContext.origin.x + x,
                  y: current.snapContext.origin.y + y,
                },
                { scale, previousId: current.snapId },
              )
            : null;
        if (snap && current.snapContext) {
          x = snap.position.x - current.snapContext.origin.x;
          y = snap.position.y - current.snapContext.origin.y;
        }
        current.snapId = snap?.id;
        onSnapFeedback(snap);
        setSourcePreview({
          identity: current.identity,
          runtime: current.runtime,
          paths: (
            current.gesture.update({ x, y }) as {
              paths: readonly StudioDisplayPath[];
            }
          ).paths,
        });
      } catch (error) {
        finish(false);
        onError(error);
      }
    },
    onPointerUp(event: PointerEvent) {
      const current = active.current;
      if (event.button !== 0 || current?.pointerId !== event.pointerId) return;
      finish(true);
    },
    onPointerCancel(event: PointerEvent) {
      if (active.current?.pointerId === event.pointerId) finish(false);
    },
    onLostPointerCapture(event: PointerEvent) {
      if (active.current?.pointerId === event.pointerId) finish(false);
    },
    onKeyDown(
      event: Pick<KeyboardEvent, 'key' | 'preventDefault' | 'stopPropagation'>,
    ) {
      if (event.key === 'Escape' && active.current) {
        event.preventDefault();
        event.stopPropagation();
        finish(false);
      }
    },
    isActive: () => !!active.current,
    sourcePreview:
      sourcePreview?.identity === sourceIdentity &&
      sourcePreview.runtime === runtime
        ? sourcePreview
        : null,
    cancel: () => finish(false),
  };
}
