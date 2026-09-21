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
import { snapEndpoint } from '@/lib/source-editor/endpoint-snap.mjs';

import { objectMovePreview } from '@/lib/source-editor/object-move-preview';
import {
  pointerObjectTransform,
  type ObjectTransformDelta,
} from '@/lib/source-editor/object-transform-preview';
import type { Project } from '@/lib/project';

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
  snapContext?: ReturnType<SourceInput['runtime']['readEndpointSnapContext']>;
  snapId?: string;
  object?: {
    mode: 'translate' | 'rotate' | 'scale';
    center: Point;
    nodeIds: string[];
    delta: ObjectTransformDelta;
    preview: ReturnType<typeof objectMovePreview>;
  };
};

/** Original source-drag interactions with a V4 source-command backend. Camera,
 * path selection and snap feedback rendering remain caller responsibilities.
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
  onActiveChange,
  onObjectCommit,
  transformMode = 'translate',
  snapEnabled = false,
  scale = 1,
  onSnapFeedback = () => {},
}: Pick<SourceInput, 'project' | 'pathId'> & {
  runtime: SourceInput['runtime'] | null;
  nodes: number[];
  disabled?: boolean;
  isPanning?: () => boolean;
  toPoint: (event: PointerEvent) => Point | null;
  getCaptureTarget: () => HTMLElement | SVGElement | null;
  onSelectionChange: (nodes: number[], selection: Selection) => void;
  onError: (error: unknown) => void;
  onActiveChange: (active: boolean) => void;
  onObjectCommit: (value: {
    project: Project;
    nodeIds: string[];
    delta: ObjectTransformDelta;
  }) => void;
  transformMode?: 'translate' | 'rotate' | 'scale';
  snapEnabled?: boolean;
  scale?: number;
  onSnapFeedback?: (feedback: ReturnType<typeof snapEndpoint>) => void;
}) {
  const active = useRef<Active | null>(null);
  const finish = (commit: boolean) => {
    const current = active.current;
    if (!current) return;
    active.current = null;
    onSnapFeedback(null);
    try {
      if (commit && current.moved) {
        if (current.object) current.gesture.update(current.object.delta);
        const result = current.gesture.commit();
        if (current.object)
          onObjectCommit({
            project: result as Project,
            nodeIds: current.object.nodeIds,
            delta: current.object.delta,
          });
      } else current.gesture.cancel();
    } catch (error) {
      try {
        current.gesture.cancel();
      } catch {
        /* The runtime may already have invalidated this preview. */
      }
      onError(error);
    } finally {
      current.object?.preview.clear();
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
      current.object?.preview.clear();
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
    object?: Active['object'],
  ) => {
    active.current = {
      gesture,
      pointerId: event.pointerId,
      target,
      origin,
      client: { x: event.clientX, y: event.clientY },
      moved: false,
      snapContext,
      object,
    };
    target.setPointerCapture(event.pointerId);
    onActiveChange(true);
  };
  return {
    onObjectPointerDown(
      event: PointerEvent,
      nodeIds: string[],
      pathIds: string[],
      center: Point,
    ) {
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
        start(
          event,
          target,
          origin,
          runtime.beginObjectGesture(project, nodeIds, {
            displayOnly: true,
            mode: transformMode,
            center,
          }),
          undefined,
          {
            nodeIds,
            mode: transformMode,
            center,
            delta: { x: 0, y: 0 },
            preview: objectMovePreview(target, nodeIds, pathIds),
          },
        );
      } catch (error) {
        finish(false);
        onError(error);
      }
    },
    onPathPointerDown(event: PointerEvent, pathIds: string[]) {
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
      if (current.object) {
        current.object.delta = pointerObjectTransform(
          current.object.mode,
          current.origin,
          point,
          current.object.center,
          event.shiftKey,
        );
        current.object.preview.update(current.object.delta);
        return;
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
        current.gesture.update({ x, y });
      } catch (error) {
        finish(false);
        onError(error);
      }
    },
    onPointerUp(event: PointerEvent) {
      const current = active.current;
      if (event.button !== 0 || current?.pointerId !== event.pointerId) return;
      if (current.object && current.moved) {
        const point = toPoint(event);
        if (point) {
          current.object.delta = pointerObjectTransform(
            current.object.mode,
            current.origin,
            point,
            current.object.center,
            event.shiftKey,
          );
        }
      }
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
    isObjectActive: () => !!active.current?.object,
    cancel: () => finish(false),
  };
}
