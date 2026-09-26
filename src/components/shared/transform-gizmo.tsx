'use client';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { createPortal, flushSync } from 'react-dom';
import Moveable, { type OnEvent, type OnScaleStart } from 'react-moveable';
import {
  framePoint,
  objectTransformDelta,
  transformFrame,
} from '@/lib/source-editor/object-transform-frame.mjs';
import type { ObjectTransformDelta } from '@/lib/source-editor/object-transform-preview';
import './transform-gizmo.css';

export type TransformMode = 'translate' | 'rotate' | 'scale';
export type TransformFrame = {
  width: number;
  height: number;
  matrix: number[];
};
export type TransformTransaction = {
  update: (delta: ObjectTransformDelta) => void;
  commit: (delta: ObjectTransformDelta) => void;
  cancel: () => void;
};
export type TransformGizmoApi = {
  dragStart: (event: MouseEvent) => void;
  cancel: () => void;
  isDragging: () => boolean;
};

function targetStyle(frame: TransformFrame) {
  const [a, b, c, d, x, y] = frame.matrix;
  const ox = frame.width / 2,
    oy = frame.height / 2;
  return {
    transform: `matrix(${[a, b, c, d, x + a * ox + c * oy - ox, y + b * ox + d * oy - oy].join(',')})`,
    transformOrigin: `${ox}px ${oy}px`,
  };
}

/** Moveable owns hit targets, pointer tracking and transforms. This adapter only
 * translates its events into document-space transactions; it owns no history. */
export default function TransformGizmo({
  frame,
  stage,
  layer,
  scale,
  camera,
  mode,
  disabled,
  panning,
  identity,
  mmPerPixel,
  onBegin,
  onApi,
  onActiveChange,
  onError,
  onCanvasPointerDown,
}: {
  frame: TransformFrame;
  stage: HTMLElement;
  layer: SVGGElement;
  scale: number;
  camera: unknown;
  mode: TransformMode;
  disabled: boolean;
  panning: boolean;
  identity: unknown;
  mmPerPixel: number;
  onBegin: (
    mode: TransformMode,
    center: { x: number; y: number },
  ) => TransformTransaction;
  onApi: (api: TransformGizmoApi | null) => void;
  onActiveChange: (active: boolean) => void;
  onError: (error: unknown) => void;
  onCanvasPointerDown: (event: React.PointerEvent) => void;
}) {
  const moveable = useRef<Moveable>(null);
  const [target, setTarget] = useState<SVGRectElement | null>(null);
  const targetRef = useRef<SVGRectElement | null>(null);
  const attachTarget = useCallback((element: SVGRectElement | null) => {
    targetRef.current = element;
    setTarget(element);
  }, []);
  const [readout, setReadout] = useState('');
  const [selectThrough, setSelectThrough] = useState(false);
  const latest = useRef({ frame, disabled, onBegin, onActiveChange, onError });
  useLayoutEffect(() => {
    latest.current = { frame, disabled, onBegin, onActiveChange, onError };
  });
  const active = useRef<{
    mode: TransformMode;
    frame: TransformFrame;
    center: { x: number; y: number };
    transaction: TransformTransaction;
    delta: ObjectTransformDelta;
    moved: boolean;
  } | null>(null);
  const renderFrame = useCallback((next: TransformFrame) => {
    const style = targetStyle(next);
    targetRef.current?.style.setProperty('transform', style.transform);
    targetRef.current?.style.setProperty(
      'transform-origin',
      style.transformOrigin,
    );
  }, []);
  const end = useCallback(
    (commit: boolean) => {
      const current = active.current;
      if (!current) return;
      active.current = null;
      try {
        if (commit && current.moved) current.transaction.commit(current.delta);
        else {
          current.transaction.cancel();
          renderFrame(current.frame);
        }
      } catch (error) {
        current.transaction.cancel();
        renderFrame(current.frame);
        latest.current.onError(error);
      } finally {
        latest.current.onActiveChange(false);
        setReadout('');
        requestAnimationFrame(() => moveable.current?.updateRect());
      }
    },
    [renderFrame],
  );
  const cancel = useCallback(() => {
    moveable.current?.stopDrag();
    end(false);
  }, [end]);
  useLayoutEffect(() => {
    if (!active.current) renderFrame(frame);
    moveable.current?.updateRect();
  }, [frame, scale, camera, target, renderFrame]);
  useEffect(() => {
    const api: TransformGizmoApi = {
      dragStart: (event) => {
        // Source picking uses PointerEvents. Preventing that event suppresses
        // compatibility mouse moves, which Moveable's mouse gesture needs.
        const mouse = new MouseEvent('mousedown', event);
        Object.defineProperty(mouse, 'target', { value: event.target });
        moveable.current?.dragStart(mouse);
      },
      cancel,
      isDragging: () => !!active.current,
    };
    onApi(api);
    const key = (event: KeyboardEvent) => {
      setSelectThrough(event.shiftKey || event.ctrlKey || event.metaKey);
      if (!active.current || event.key !== 'Escape') return;
      event.preventDefault();
      event.stopImmediatePropagation();
      cancel();
    };
    const pointerCancel = () => {
      setSelectThrough(false);
      cancel();
    };
    window.addEventListener('keydown', key, true);
    window.addEventListener('keyup', key, true);
    window.addEventListener('blur', pointerCancel);
    window.addEventListener('pointercancel', pointerCancel);
    window.addEventListener('lostpointercapture', pointerCancel);
    const resize = new ResizeObserver(() => moveable.current?.updateRect());
    resize.observe(stage);
    return () => {
      resize.disconnect();
      cancel();
      onApi(null);
      window.removeEventListener('keydown', key, true);
      window.removeEventListener('keyup', key, true);
      window.removeEventListener('blur', pointerCancel);
      window.removeEventListener('pointercancel', pointerCancel);
      window.removeEventListener('lostpointercapture', pointerCancel);
    };
  }, [target, onApi, cancel, stage]);
  useEffect(() => {
    cancel();
  }, [identity, cancel]);
  const begin = (
    event: OnEvent,
    nextMode: TransformMode,
    direction = [0, 0],
  ) => {
    if (active.current) return false;
    const input = event.inputEvent as MouseEvent;
    if (latest.current.disabled || input?.button > 0) {
      event.stopDrag();
      return false;
    }
    const base = latest.current.frame;
    const center = framePoint(base, direction);
    try {
      const transaction = latest.current.onBegin(nextMode, center);
      stage.focus({ preventScroll: true });
      active.current = {
        mode: nextMode,
        frame: base,
        center,
        transaction,
        delta: { x: 0, y: 0 },
        moved: false,
      };
      latest.current.onActiveChange(true);
      return true;
    } catch (error) {
      event.stopDrag();
      latest.current.onError(error);
      return false;
    }
  };
  const update = (value: number | number[]) => {
    const current = active.current;
    if (!current) return;
    const delta = objectTransformDelta(
      current.mode,
      current.center,
      value,
    ) as ObjectTransformDelta;
    current.delta = delta;
    current.moved =
      Math.abs(delta.x) + Math.abs(delta.y) > 1e-6 ||
      Math.abs(delta.angleRad || 0) > 1e-8 ||
      Math.abs((delta.factor ?? 1) - 1) > 1e-8;
    try {
      renderFrame(transformFrame(current.frame, delta));
      current.transaction.update(delta);
      const n = (value: number) => Number(value.toFixed(2));
      setReadout(
        current.mode === 'translate'
          ? `X ${n(delta.x * mmPerPixel)} mm · Y ${n(-delta.y * mmPerPixel)} mm`
          : current.mode === 'rotate'
            ? `${n(-(value as number))}°`
            : `${n((value as number) * 100)}% · ${n(frame.width * mmPerPixel * (value as number))} × ${n(frame.height * mmPerPixel * (value as number))} mm`,
      );
    } catch (error) {
      cancel();
      latest.current.onError(error);
    }
  };
  const startScale = (event: OnScaleStart) => {
    const direction = event.inputEvent.altKey
      ? [0, 0]
      : event.direction.map((n: number) => -n);
    if (!begin(event, 'scale', direction)) return false;
    event.setFixedDirection(direction);
    event.set([1, 1]);
    event.setMinScaleSize([frame.width * 0.01, frame.height * 0.01]);
    event.setMaxScaleSize([frame.width * 100, frame.height * 100]);
  };
  return (
    <>
      {createPortal(
        <rect
          ref={attachTarget}
          data-transform-target="objects"
          width={frame.width}
          height={frame.height}
          style={targetStyle(frame)}
          fill="none"
          pointerEvents="none"
        />,
        layer,
      )}
      {createPortal(
        <div
          className="transform-gizmo"
          data-mode={mode}
          data-select-through={selectThrough || undefined}
          data-disabled={disabled || undefined}
          onPointerDown={(event) => {
            if (event.button !== 0 || panning) onCanvasPointerDown(event);
            else event.stopPropagation();
          }}
        >
          <Moveable
            ref={moveable}
            target={target}
            container={stage}
            rootContainer={stage}
            flushSync={flushSync}
            draggable
            scalable
            rotatable
            keepRatio
            dragArea
            origin={true}
            renderDirections={['nw', 'ne', 'sw', 'se']}
            rotationPosition="top"
            throttleDrag={0}
            throttleRotate={0}
            throttleScale={0}
            preventClickDefault
            preventClickEventOnDrag
            checkInput
            onDragStart={(event) => begin(event, 'translate')}
            onDrag={(event) => {
              if (active.current?.mode !== 'translate') return;
              let [x, y] = event.beforeDist;
              if (!active.current.moved && Math.hypot(x, y) * scale < 4) return;
              if (event.inputEvent.shiftKey) {
                if (Math.abs(x) > Math.abs(y)) y = 0;
                else x = 0;
              }
              update([x, y]);
            }}
            onDragEnd={() => {
              if (active.current?.mode === 'translate') end(true);
            }}
            onRotateStart={(event) => {
              if (!begin(event, 'rotate')) return false;
              event.set(0);
              event.setFixedDirection([0, 0]);
            }}
            onBeforeRotate={(event) => {
              if (event.inputEvent.shiftKey)
                event.setRotation(Math.round(event.rotation / 15) * 15);
            }}
            onRotate={(event) => update(event.beforeDist)}
            onRotateEnd={() => end(true)}
            onScaleStart={startScale}
            onBeforeScale={(event) => {
              if (event.inputEvent.shiftKey) {
                const factor = Math.max(
                  0.1,
                  Math.round(event.scale[0] * 10) / 10,
                );
                event.setScale([factor, factor]);
              }
            }}
            onScale={(event) => update(event.scale[0])}
            onScaleEnd={() => end(true)}
          />
          <output
            className="transform-gizmo-readout"
            aria-label="实时变换"
            aria-live="off"
          >
            {readout ||
              `${Number((frame.width * mmPerPixel * Math.hypot(frame.matrix[0], frame.matrix[1])).toFixed(2))} × ${Number((frame.height * mmPerPixel * Math.hypot(frame.matrix[0], frame.matrix[1])).toFixed(2))} mm`}
          </output>
        </div>,
        stage,
      )}
    </>
  );
}
