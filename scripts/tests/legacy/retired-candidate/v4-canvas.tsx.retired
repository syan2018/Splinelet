'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DocumentV4, EntityRef } from '@/lib/document/types';
import { resolveRelation } from '@/lib/geometry/relations.mjs';
import { effectiveNodeState } from '@/lib/scene/hierarchy.mjs';
import {
  inverseTransform,
  transformPoint,
  worldMatrix,
} from '@/lib/scene/transforms.mjs';
import {
  screenToWorld,
  useV4CanvasGestures,
  type V4CanvasAction,
} from '@/hooks/use-v4-canvas-gestures';
import { deriveHandleOverlay, type ProjectedCurve } from './derived-handles';

type Point = [number, number];
type Bounds = [number, number, number, number];
type Candidate = {
  ref: unknown;
  color?: string | null;
  painted?: boolean;
  geometry: { type: string; coordinates: unknown };
};
type Curve = ProjectedCurve & {
  pathRef?: EntityRef;
};
type Projection = {
  canvas: {
    candidates: Candidate[];
    curves: Curve[];
    bounds?: { curves?: Bounds | null; regions?: Bounds | null };
  };
};
type Selection = { activeRef?: EntityRef | null };
type PathRef = { kind: 'path'; sketchId: string; id: string };
type PenNode = { point: Point; incoming: Point; outgoing: Point };
type EditableVertex = {
  sketchId: string;
  vertexId: string;
  point: Point;
  editable: boolean;
  relationId?: string;
};
type EditableHandle = {
  sketchId: string;
  edgeId: string;
  end: 'start' | 'end';
  anchor: Point;
  anchorWorld: Point;
  point: Point;
  editable: boolean;
  relationId?: string;
};
type SourceCurve = {
  key: string;
  pathRef: PathRef;
  edges: { cubic: Point[] }[];
};
type SourceOverlay = {
  curves: SourceCurve[];
  vertices: EditableVertex[];
  handles: EditableHandle[];
  inverseBySketch: Map<string, number[]>;
  locked: boolean;
};
export type V4ReferenceImage = {
  id: string;
  url: string;
  pixelWidth: number;
  pixelHeight: number;
  pixelToWorld: number[];
  opacity: number;
  visible: boolean;
};

export type V4CanvasProps = {
  document: DocumentV4;
  projection: Projection;
  selection: unknown;
  tool: 'select' | 'move' | 'anchor' | 'pen';
  nodeIds: string[];
  ownerNodeId?: string;
  referenceImages?: V4ReferenceImage[];
  onAction(action: V4CanvasAction): void;
  onPreviewStart(): void;
  onPreviewUpdate(action: V4CanvasAction): void;
  onPreviewCommit(): void;
  onPreviewCancel(reason: 'escape' | 'blur' | 'lost-pointer' | 'cancel'): void;
  /** Receives one stable entity/output ref, or null for a blank-canvas pick. */
  onSelectionChange?(value: unknown): void;
};

const VIEWBOX_INITIAL: Bounds = [-100, -100, 200, 200];
const DRAG_THRESHOLD_PX = 4;
const CLOSE_TOLERANCE_PX = 10;
const FIT_PADDING_PX = 40;
const MIN_VIEW_SIZE = 1e-3;
const MAX_VIEW_SIZE = 1e7;

const add = (left: Point, right: Point): Point => [
  left[0] + right[0],
  left[1] + right[1],
];
const subtract = (left: Point, right: Point): Point => [
  left[0] - right[0],
  left[1] - right[1],
];
const negate = (value: Point): Point => [-value[0], -value[1]];
const asPoint = (value: unknown): Point | null =>
  Array.isArray(value) &&
  value.length === 2 &&
  value.every((component) => Number.isFinite(component))
    ? ([value[0], value[1]] as Point)
    : null;
const activeRef = (selection: unknown) =>
  selection && typeof selection === 'object' && 'activeRef' in selection
    ? ((selection as Selection).activeRef ?? null)
    : null;
const sameRef = (left: unknown, right: unknown) =>
  JSON.stringify(left) === JSON.stringify(right);

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

const penCubics = (nodes: PenNode[], closed: boolean): Point[][] => {
  const count = closed ? nodes.length : Math.max(0, nodes.length - 1);
  return Array.from({ length: count }, (_, index) => {
    const next = nodes[(index + 1) % nodes.length];
    return [
      nodes[index].point,
      nodes[index].outgoing,
      next.incoming,
      next.point,
    ];
  });
};

const mergeBounds = (values: (Bounds | null | undefined)[]) => {
  const present = values.filter((value): value is Bounds => Boolean(value));
  if (!present.length) return null;
  return present.reduce<Bounds>(
    (result, value) => [
      Math.min(result[0], value[0]),
      Math.min(result[1], value[1]),
      Math.max(result[2], value[2]),
      Math.max(result[3], value[3]),
    ],
    [Infinity, Infinity, -Infinity, -Infinity],
  );
};

const fitViewBox = (
  bounds: Bounds,
  size: { width: number; height: number },
): Bounds => {
  const dataWidth = Math.max(bounds[2] - bounds[0], MIN_VIEW_SIZE);
  const dataHeight = Math.max(bounds[3] - bounds[1], MIN_VIEW_SIZE);
  const usableWidth = Math.max(1, size.width - FIT_PADDING_PX * 2);
  const usableHeight = Math.max(1, size.height - FIT_PADDING_PX * 2);
  const scale = Math.max(
    dataWidth / usableWidth,
    dataHeight / usableHeight,
    1e-6,
  );
  const width = Math.min(
    MAX_VIEW_SIZE,
    Math.max(MIN_VIEW_SIZE, scale * size.width),
  );
  const height = Math.min(
    MAX_VIEW_SIZE,
    Math.max(MIN_VIEW_SIZE, scale * size.height),
  );
  const centerX = (bounds[0] + bounds[2]) / 2;
  const centerY = (bounds[1] + bounds[3]) / 2;
  return [centerX - width / 2, centerY - height / 2, width, height];
};

const relationPoint = (
  document: DocumentV4,
  sketch: DocumentV4['sketches'][string],
  target: EntityRef,
  relationId: string,
) => {
  const result = resolveRelation({ document, sketch, target, relationId });
  return result?.status === 'ready' ? asPoint(result.value) : null;
};

const sourceOverlay = (
  document: DocumentV4,
  ownerNodeId: string | undefined,
): SourceOverlay => {
  const result: SourceOverlay = {
    curves: [],
    vertices: [],
    handles: [],
    inverseBySketch: new Map(),
    locked: ownerNodeId
      ? effectiveNodeState(document, ownerNodeId).locked
      : false,
  };
  if (!ownerNodeId) return result;
  const matrix = worldMatrix(document, ownerNodeId);
  const inverse = inverseTransform(matrix);
  for (const sketch of Object.values(document.sketches)) {
    if (sketch.ownerNodeId !== ownerNodeId) continue;
    result.inverseBySketch.set(sketch.id, inverse);
    const vertices = new Map<string, Point>();
    for (const vertex of Object.values(sketch.vertices)) {
      const target = {
        kind: 'vertex' as const,
        sketchId: sketch.id,
        id: vertex.id,
      };
      const local =
        vertex.position.kind === 'free'
          ? asPoint(vertex.position.value)
          : relationPoint(document, sketch, target, vertex.position.relationId);
      if (!local) continue;
      vertices.set(vertex.id, local);
      result.vertices.push({
        sketchId: sketch.id,
        vertexId: vertex.id,
        point: transformPoint(matrix, local) as Point,
        editable: !result.locked && vertex.position.kind === 'free',
        relationId:
          vertex.position.kind === 'relation'
            ? vertex.position.relationId
            : undefined,
      });
    }
    const cubics = new Map<string, Point[]>();
    for (const edge of Object.values(sketch.edges)) {
      const start = vertices.get(edge.startVertexId);
      const end = vertices.get(edge.endVertexId);
      if (!start || !end) continue;
      const startTarget = {
        kind: 'edge-end' as const,
        sketchId: sketch.id,
        edgeId: edge.id,
        end: 'start' as const,
      };
      const endTarget = { ...startTarget, end: 'end' as const };
      const startVector =
        edge.startHandle.kind === 'free'
          ? asPoint(edge.startHandle.vector)
          : relationPoint(
              document,
              sketch,
              startTarget,
              edge.startHandle.relationId,
            );
      const endVector =
        edge.endHandle.kind === 'free'
          ? asPoint(edge.endHandle.vector)
          : relationPoint(
              document,
              sketch,
              endTarget,
              edge.endHandle.relationId,
            );
      if (!startVector || !endVector) continue;
      const localCubic = [
        start,
        add(start, startVector),
        add(end, endVector),
        end,
      ];
      cubics.set(
        edge.id,
        localCubic.map((point) => transformPoint(matrix, point) as Point),
      );
      result.handles.push(
        {
          sketchId: sketch.id,
          edgeId: edge.id,
          end: 'start',
          anchor: start,
          anchorWorld: transformPoint(matrix, start) as Point,
          point: transformPoint(matrix, localCubic[1]) as Point,
          editable: !result.locked && edge.startHandle.kind === 'free',
          relationId:
            edge.startHandle.kind === 'relation'
              ? edge.startHandle.relationId
              : undefined,
        },
        {
          sketchId: sketch.id,
          edgeId: edge.id,
          end: 'end',
          anchor: end,
          anchorWorld: transformPoint(matrix, end) as Point,
          point: transformPoint(matrix, localCubic[2]) as Point,
          editable: !result.locked && edge.endHandle.kind === 'free',
          relationId:
            edge.endHandle.kind === 'relation'
              ? edge.endHandle.relationId
              : undefined,
        },
      );
    }
    for (const path of Object.values(sketch.paths)) {
      if (!path.visible) continue;
      const edges = path.edges.flatMap((use) => {
        const cubic = cubics.get(use.edgeId);
        return cubic
          ? [{ cubic: use.reversed ? cubic.slice().reverse() : cubic }]
          : [];
      });
      if (edges.length)
        result.curves.push({
          key: `${sketch.id}:${path.id}`,
          pathRef: { kind: 'path', sketchId: sketch.id, id: path.id },
          edges,
        });
    }
  }
  return result;
};

type DirectDrag =
  | {
      kind: 'vertex';
      pointerId: number;
      screen: Point;
      preview: boolean;
      sketchId: string;
      vertexId: string;
      inverse: number[];
    }
  | {
      kind: 'handle';
      pointerId: number;
      screen: Point;
      preview: boolean;
      sketchId: string;
      edgeId: string;
      end: 'start' | 'end';
      anchor: Point;
      inverse: number[];
    };

type PenDrag = { pointerId: number; screen: Point; anchor: Point };

export function V4Canvas(props: V4CanvasProps) {
  const host = useRef<HTMLButtonElement>(null);
  const [size, setSize] = useState({ width: 1, height: 1 });
  const [viewBox, setViewBox] = useState<Bounds>(VIEWBOX_INITIAL);
  const [penNodes, setPenNodes] = useState<PenNode[]>([]);
  const penNodesRef = useRef<PenNode[]>([]);
  const [penDraft, setPenDraft] = useState<PenNode | null>(null);
  const [feedback, setFeedback] = useState('');
  const [showDerivedHandles, setShowDerivedHandles] = useState(false);
  const directDrag = useRef<DirectDrag | null>(null);
  const penDrag = useRef<PenDrag | null>(null);
  const suppressClick = useRef(false);
  const spacePanning = useRef(false);
  const overlay = useMemo(
    () => sourceOverlay(props.document, props.ownerNodeId),
    [props.document, props.ownerNodeId],
  );
  const derivedOverlay = useMemo(
    () =>
      deriveHandleOverlay(
        props.document,
        props.projection.canvas.curves,
        props.ownerNodeId,
      ),
    [props.document, props.ownerNodeId, props.projection.canvas.curves],
  );
  const selection = activeRef(props.selection);
  const unitPerPixel = Math.max(
    viewBox[2] / size.width,
    viewBox[3] / size.height,
  );

  const replacePenNodes = useCallback((next: PenNode[]) => {
    penNodesRef.current = next;
    setPenNodes(next);
  }, []);

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const observer = new ResizeObserver(() => {
      const { width, height } = element.getBoundingClientRect();
      if (!width || !height) return;
      setSize({ width, height });
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

  const finishPen = useCallback(
    (closed: boolean) => {
      const nodes = penNodesRef.current;
      if (nodes.length < (closed ? 3 : 2)) return;
      props.onAction({
        kind: 'draw-path',
        points: nodes.map((node) => node.point),
        cubics: penCubics(nodes, closed),
        ownerNodeId: props.ownerNodeId,
        closed,
      });
      replacePenNodes([]);
      setPenDraft(null);
      setFeedback('');
    },
    [props, replacePenNodes],
  );

  const gestures = useV4CanvasGestures({
    ...props,
    viewBox,
    onPan: (delta) =>
      setViewBox((value) => [
        value[0] - delta[0],
        value[1] - delta[1],
        value[2],
        value[3],
      ]),
  });

  const cancelDirect = useCallback(
    (reason: 'escape' | 'blur' | 'lost-pointer' | 'cancel') => {
      const active = directDrag.current;
      directDrag.current = null;
      if (active?.preview) props.onPreviewCancel(reason);
    },
    [props],
  );

  const clearPen = useCallback(() => {
    penDrag.current = null;
    replacePenNodes([]);
    setPenDraft(null);
  }, [replacePenNodes]);

  useEffect(() => {
    const cancel = () => {
      spacePanning.current = false;
      clearPen();
      cancelDirect('blur');
      gestures.cancel('blur');
    };
    window.addEventListener('blur', cancel);
    return () => window.removeEventListener('blur', cancel);
  }, [cancelDirect, clearPen, gestures]);

  const updateDirect = (event: React.PointerEvent<HTMLButtonElement>) => {
    const active = directDrag.current;
    if (!active || active.pointerId !== event.pointerId) return false;
    const distance = Math.hypot(
      event.clientX - active.screen[0],
      event.clientY - active.screen[1],
    );
    if (!active.preview && distance < DRAG_THRESHOLD_PX) return true;
    if (!active.preview) {
      props.onPreviewStart();
      active.preview = true;
      suppressClick.current = true;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    const world = screenToWorld(event.clientX, event.clientY, rect, viewBox);
    const local = transformPoint(active.inverse, world) as Point;
    props.onPreviewUpdate(
      active.kind === 'vertex'
        ? {
            kind: 'set-vertex',
            sketchId: active.sketchId,
            vertexId: active.vertexId,
            value: local,
          }
        : {
            kind: 'set-handle',
            sketchId: active.sketchId,
            edgeId: active.edgeId,
            end: active.end,
            vector: subtract(local, active.anchor),
          },
    );
    return true;
  };

  const startDirect = (
    event: React.PointerEvent<HTMLButtonElement>,
    target: HTMLElement,
  ) => {
    const derivedKey = target.dataset.derivedHandle;
    if (derivedKey) {
      const handle = derivedOverlay.byKey.get(derivedKey);
      if (!handle) return false;
      suppressClick.current = true;
      if (handle.sketchId && handle.edgeId && handle.end)
        props.onSelectionChange?.({
          kind: 'edge-end',
          sketchId: handle.sketchId,
          edgeId: handle.edgeId,
          end: handle.end,
        });
      if (
        !handle.editable ||
        !handle.sketchId ||
        !handle.edgeId ||
        !handle.end ||
        !handle.anchor ||
        !handle.inverse
      ) {
        setFeedback(handle.reason || '当前派生控制柄无法安全映射到源线条。');
        return true;
      }
      directDrag.current = {
        kind: 'handle',
        pointerId: event.pointerId,
        screen: [event.clientX, event.clientY],
        preview: false,
        sketchId: handle.sketchId,
        edgeId: handle.edgeId,
        end: handle.end,
        anchor: handle.anchor,
        inverse: handle.inverse,
      };
      setFeedback('');
      event.currentTarget.setPointerCapture(event.pointerId);
      event.preventDefault();
      return true;
    }
    const kind = target.dataset.editKind;
    const sketchId = target.dataset.sketchId;
    if ((kind !== 'vertex' && kind !== 'handle') || !sketchId) return false;
    const inverse = overlay.inverseBySketch.get(sketchId);
    if (!inverse) return false;
    const editable = target.dataset.editable === 'true';
    suppressClick.current = true;
    if (kind === 'vertex') {
      const vertexId = target.dataset.vertexId;
      if (!vertexId) return false;
      props.onSelectionChange?.({ kind: 'vertex', sketchId, id: vertexId });
      if (!editable) {
        setFeedback(
          overlay.locked
            ? '部件已锁定，锚点为只读。'
            : '这个锚点由关系驱动，请编辑关系参数。',
        );
        return true;
      }
      directDrag.current = {
        kind,
        pointerId: event.pointerId,
        screen: [event.clientX, event.clientY],
        preview: false,
        sketchId,
        vertexId,
        inverse,
      };
    } else {
      const edgeId = target.dataset.edgeId;
      const end = target.dataset.end;
      const anchorX = Number(target.dataset.anchorX);
      const anchorY = Number(target.dataset.anchorY);
      if (
        !edgeId ||
        (end !== 'start' && end !== 'end') ||
        !Number.isFinite(anchorX) ||
        !Number.isFinite(anchorY)
      )
        return false;
      props.onSelectionChange?.({
        kind: 'edge-end',
        sketchId,
        edgeId,
        end,
      });
      if (!editable) {
        setFeedback(
          overlay.locked
            ? '部件已锁定，控制柄为只读。'
            : '这个控制柄由关系驱动，请编辑关系参数。',
        );
        return true;
      }
      directDrag.current = {
        kind,
        pointerId: event.pointerId,
        screen: [event.clientX, event.clientY],
        preview: false,
        sketchId,
        edgeId,
        end,
        anchor: [anchorX, anchorY],
        inverse,
      };
    }
    setFeedback('');
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
    return true;
  };

  const startPen = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (!event.isPrimary || event.button !== 0 || props.tool !== 'pen')
      return false;
    const rect = event.currentTarget.getBoundingClientRect();
    const point = screenToWorld(event.clientX, event.clientY, rect, viewBox);
    const first = penNodesRef.current[0]?.point;
    if (first && penNodesRef.current.length >= 3) {
      const firstScreen: Point = [
        rect.left + ((first[0] - viewBox[0]) * rect.width) / viewBox[2],
        rect.top +
          rect.height -
          ((first[1] - viewBox[1]) * rect.height) / viewBox[3],
      ];
      if (
        Math.hypot(
          event.clientX - firstScreen[0],
          event.clientY - firstScreen[1],
        ) <= CLOSE_TOLERANCE_PX
      ) {
        suppressClick.current = true;
        finishPen(true);
        event.preventDefault();
        return true;
      }
    }
    penDrag.current = {
      pointerId: event.pointerId,
      screen: [event.clientX, event.clientY],
      anchor: point,
    };
    setPenDraft({ point, incoming: point, outgoing: point });
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
    return true;
  };

  const updatePen = (event: React.PointerEvent<HTMLButtonElement>) => {
    const active = penDrag.current;
    if (!active || active.pointerId !== event.pointerId) return false;
    const rect = event.currentTarget.getBoundingClientRect();
    const pointer = screenToWorld(event.clientX, event.clientY, rect, viewBox);
    const vector = subtract(pointer, active.anchor);
    setPenDraft({
      point: active.anchor,
      incoming: add(active.anchor, negate(vector)),
      outgoing: pointer,
    });
    if (
      Math.hypot(
        event.clientX - active.screen[0],
        event.clientY - active.screen[1],
      ) >= DRAG_THRESHOLD_PX
    )
      suppressClick.current = true;
    return true;
  };

  const onPointerDown = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (!event.isPrimary) return;
    // preventDefault may suppress the click that normally consumes this flag.
    // A new primary pointer gesture must never inherit suppression from an
    // earlier pen close, drag, or pan.
    suppressClick.current = false;
    event.currentTarget.focus({ preventScroll: true });
    const element = event.target as HTMLElement;
    if (element.closest('[data-derived-toggle]')) return;
    if (event.button === 1 || event.button === 2 || spacePanning.current) {
      suppressClick.current = true;
      gestures.onPointerDown(event);
      return;
    }
    if (
      props.tool === 'anchor' &&
      event.button === 0 &&
      startDirect(event, element)
    )
      return;
    if (startPen(event)) return;
    if (event.button === 0 && props.tool === 'move' && props.nodeIds.length)
      suppressClick.current = true;
    gestures.onPointerDown(event);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (updateDirect(event) || updatePen(event)) return;
    gestures.onPointerMove(event);
  };

  const onPointerUp = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (directDrag.current?.pointerId === event.pointerId) {
      updateDirect(event);
      const active = directDrag.current;
      directDrag.current = null;
      if (active.preview) props.onPreviewCommit();
      if (event.currentTarget.hasPointerCapture(event.pointerId))
        event.currentTarget.releasePointerCapture(event.pointerId);
      return;
    }
    if (penDrag.current?.pointerId === event.pointerId) {
      const active = penDrag.current;
      const rect = event.currentTarget.getBoundingClientRect();
      const pointer = screenToWorld(
        event.clientX,
        event.clientY,
        rect,
        viewBox,
      );
      const vector = subtract(pointer, active.anchor);
      replacePenNodes([
        ...penNodesRef.current,
        {
          point: active.anchor,
          incoming: add(active.anchor, negate(vector)),
          outgoing: pointer,
        },
      ]);
      penDrag.current = null;
      setPenDraft(null);
      suppressClick.current = true;
      if (event.currentTarget.hasPointerCapture(event.pointerId))
        event.currentTarget.releasePointerCapture(event.pointerId);
      return;
    }
    gestures.onPointerUp(event);
  };

  const onClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    if (props.tool === 'pen') return;
    const target = event.target as HTMLElement;
    if (target.closest('[data-derived-toggle]')) {
      setShowDerivedHandles((value) => {
        setFeedback(
          value
            ? '已隐藏重复结果控制柄。'
            : '已显示重复结果控制柄；拖动会修改源 Sketch。',
        );
        return !value;
      });
      return;
    }
    const source = target.closest<SVGElement>('[data-source-path]');
    if (source) {
      const sketchId = source.dataset.sketchId;
      const pathId = source.dataset.pathId;
      if (sketchId && pathId)
        props.onSelectionChange?.({ kind: 'path', sketchId, id: pathId });
      return;
    }
    const curve = target.closest<SVGElement>('[data-curve]');
    if (curve) {
      const value = props.projection.canvas.curves[Number(curve.dataset.curve)];
      props.onSelectionChange?.(
        value.pathRef ||
          (value.ownerNodeId ? { kind: 'node', id: value.ownerNodeId } : null),
      );
      return;
    }
    const candidate = target.closest<SVGElement>('[data-candidate]');
    if (candidate) {
      const value =
        props.projection.canvas.candidates[Number(candidate.dataset.candidate)]
          ?.ref;
      if (value) {
        props.onAction({ kind: 'select-candidate', target: value });
        props.onSelectionChange?.(value);
      }
      return;
    }
    props.onSelectionChange?.(null);
    setFeedback('');
  };

  const fit = () => {
    const bounds = mergeBounds([
      props.projection.canvas.bounds?.curves,
      props.projection.canvas.bounds?.regions,
    ]);
    if (bounds) setViewBox(fitViewBox(bounds, size));
  };

  const shownPenNodes = penDraft ? [...penNodes, penDraft] : penNodes;
  const shownPenCubics = penCubics(shownPenNodes, false);
  const pointRadius = 4.5 * unitPerPixel;
  const handleRadius = 3.5 * unitPerPixel;

  return (
    <button
      type="button"
      ref={host}
      aria-label="建模画布"
      aria-keyshortcuts="D F"
      aria-describedby={feedback ? 'v4-canvas-feedback' : undefined}
      style={{
        width: '100%',
        height: '100%',
        minHeight: 0,
        display: 'block',
        position: 'relative',
        overflow: 'hidden',
        padding: 0,
        border: 0,
        touchAction: 'none',
        cursor:
          props.tool === 'pen'
            ? 'crosshair'
            : props.tool === 'move'
              ? 'move'
              : 'default',
        background: '#171b24',
      }}
      onClick={onClick}
      onBlur={() => {
        spacePanning.current = false;
        clearPen();
        cancelDirect('blur');
        gestures.cancel('blur');
      }}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (event.key === 'Escape') {
          spacePanning.current = false;
          clearPen();
          cancelDirect('escape');
          gestures.cancel('escape');
          setFeedback('');
        } else if (event.key === 'Enter' && props.tool === 'pen') {
          event.preventDefault();
          finishPen(false);
        } else if (event.key.toLowerCase() === 'f') {
          event.preventDefault();
          fit();
        } else if (event.key.toLowerCase() === 'd' && props.tool === 'anchor') {
          event.preventDefault();
          setShowDerivedHandles((value) => {
            setFeedback(
              value
                ? '已隐藏重复结果控制柄。'
                : '已显示重复结果控制柄；拖动会修改源 Sketch。',
            );
            return !value;
          });
        } else if (event.key === ' ') {
          event.preventDefault();
          spacePanning.current = true;
          gestures.setSpacePanning(true);
        }
      }}
      onKeyUp={(event) => {
        if (event.key === ' ') {
          spacePanning.current = false;
          gestures.setSpacePanning(false);
        }
      }}
      onWheel={(event) => {
        event.preventDefault();
        const rect = event.currentTarget.getBoundingClientRect();
        const focus = screenToWorld(
          event.clientX,
          event.clientY,
          rect,
          viewBox,
        );
        const factor = Math.exp(
          Math.max(-1, Math.min(1, event.deltaY * 0.0015)),
        );
        setViewBox((value) => {
          const width = Math.min(
            MAX_VIEW_SIZE,
            Math.max(MIN_VIEW_SIZE, value[2] * factor),
          );
          const actualFactor = width / value[2];
          const height = value[3] * actualFactor;
          return [
            focus[0] - (focus[0] - value[0]) * actualFactor,
            focus[1] - (focus[1] - value[1]) * actualFactor,
            width,
            height,
          ];
        });
      }}
      onContextMenu={(event) => event.preventDefault()}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onLostPointerCapture={(event) => {
        if (directDrag.current?.pointerId === event.pointerId) {
          cancelDirect('lost-pointer');
          return;
        }
        if (penDrag.current?.pointerId === event.pointerId) {
          penDrag.current = null;
          setPenDraft(null);
          return;
        }
        gestures.onLostPointerCapture();
      }}
      onPointerCancel={(event) => {
        if (directDrag.current?.pointerId === event.pointerId) {
          cancelDirect('cancel');
          return;
        }
        if (penDrag.current?.pointerId === event.pointerId) {
          penDrag.current = null;
          setPenDraft(null);
          return;
        }
        gestures.onPointerCancel();
      }}
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
          {props.referenceImages?.map((reference) =>
            reference.visible &&
            reference.url &&
            Number.isFinite(reference.pixelWidth) &&
            reference.pixelWidth > 0 &&
            Number.isFinite(reference.pixelHeight) &&
            reference.pixelHeight > 0 &&
            Array.isArray(reference.pixelToWorld) &&
            reference.pixelToWorld.length === 6 &&
            reference.pixelToWorld.every(Number.isFinite) &&
            Number.isFinite(reference.opacity) ? (
              <image
                key={reference.id}
                data-reference-image={reference.id}
                href={reference.url}
                width={reference.pixelWidth}
                height={reference.pixelHeight}
                transform={`matrix(${reference.pixelToWorld.join(' ')})`}
                opacity={reference.opacity}
                pointerEvents="none"
              />
            ) : null,
          )}
          {props.projection.canvas.candidates.map((candidate, index) => (
            <path
              key={`r${index}`}
              data-candidate={index}
              d={regionPath(candidate.geometry)}
              fill={
                candidate.painted
                  ? candidate.color || '#808080'
                  : 'rgba(80,160,255,.18)'
              }
              fillRule="evenodd"
              stroke="#4d9fff"
              vectorEffect="non-scaling-stroke"
            />
          ))}
          {props.projection.canvas.curves.map((curve, index) => (
            <g key={curve.key || `c${index}`}>
              <path
                data-curve={index}
                d={cubicPath(curve.edges)}
                fill="none"
                stroke="transparent"
                strokeWidth={12}
                vectorEffect="non-scaling-stroke"
              />
              <path
                d={cubicPath(curve.edges)}
                fill="none"
                stroke="#eee"
                strokeWidth={1.5}
                pointerEvents="none"
                vectorEffect="non-scaling-stroke"
              />
            </g>
          ))}
          {props.tool === 'anchor' &&
            overlay.curves.map((curve) => (
              <g key={curve.key}>
                <path
                  data-source-path
                  data-sketch-id={curve.pathRef.sketchId}
                  data-path-id={curve.pathRef.id}
                  d={cubicPath(curve.edges)}
                  fill="none"
                  stroke="transparent"
                  strokeWidth={14}
                  vectorEffect="non-scaling-stroke"
                />
                <path
                  d={cubicPath(curve.edges)}
                  fill="none"
                  stroke={
                    sameRef(selection, curve.pathRef) ? '#ffd166' : '#73d2de'
                  }
                  strokeWidth={2}
                  pointerEvents="none"
                  vectorEffect="non-scaling-stroke"
                />
              </g>
            ))}
          {props.tool === 'anchor' &&
            showDerivedHandles &&
            derivedOverlay.handles.map((handle) => {
              const collapsed =
                Math.hypot(
                  handle.point[0] - handle.anchorWorld[0],
                  handle.point[1] - handle.anchorWorld[1],
                ) < 1e-9;
              const shownPoint: Point = collapsed
                ? [
                    handle.point[0] +
                      (handle.end === 'start' ? 12 : -12) * unitPerPixel,
                    handle.point[1],
                  ]
                : handle.point;
              return (
                <g
                  key={`derived:${handle.key}`}
                  data-derived-instance={JSON.stringify(handle.instances)}
                >
                  <line
                    x1={handle.anchorWorld[0]}
                    y1={handle.anchorWorld[1]}
                    x2={shownPoint[0]}
                    y2={shownPoint[1]}
                    stroke={handle.editable ? '#ff9f43' : '#c08ad6'}
                    strokeDasharray="4 3"
                    pointerEvents="none"
                    vectorEffect="non-scaling-stroke"
                  />
                  <circle
                    data-derived-handle={handle.key}
                    data-derived-instances={JSON.stringify(handle.instances)}
                    data-editable={String(handle.editable)}
                    data-sketch-id={handle.sketchId}
                    data-edge-id={handle.edgeId}
                    data-end={handle.end}
                    cx={shownPoint[0]}
                    cy={shownPoint[1]}
                    r={handleRadius * 1.15}
                    fill={handle.editable ? '#2b1b12' : '#5b356b'}
                    stroke={handle.editable ? '#ffb86b' : '#e0a7f5'}
                    strokeWidth={1.8}
                    vectorEffect="non-scaling-stroke"
                    style={{ cursor: handle.editable ? 'grab' : 'not-allowed' }}
                  >
                    <title>
                      {handle.editable
                        ? '拖动重复结果控制柄（修改源 Sketch）'
                        : `只读：${handle.reason || '无法安全映射到源线条。'}`}
                    </title>
                  </circle>
                </g>
              );
            })}
          {props.tool === 'anchor' &&
            overlay.handles.map((handle) => {
              const ref = {
                kind: 'edge-end' as const,
                sketchId: handle.sketchId,
                edgeId: handle.edgeId,
                end: handle.end,
              };
              const collapsed =
                Math.hypot(
                  handle.point[0] - handle.anchorWorld[0],
                  handle.point[1] - handle.anchorWorld[1],
                ) < 1e-9;
              const shownPoint: Point = collapsed
                ? [
                    handle.point[0] +
                      (handle.end === 'start' ? 12 : -12) * unitPerPixel,
                    handle.point[1],
                  ]
                : handle.point;
              return (
                <g key={`${handle.sketchId}:${handle.edgeId}:${handle.end}`}>
                  <line
                    x1={handle.anchorWorld[0]}
                    y1={handle.anchorWorld[1]}
                    x2={shownPoint[0]}
                    y2={shownPoint[1]}
                    stroke={handle.editable ? '#8b9db7' : '#c08ad6'}
                    strokeDasharray={handle.editable ? undefined : '3 3'}
                    pointerEvents="none"
                    vectorEffect="non-scaling-stroke"
                  />
                  <circle
                    data-edit-kind="handle"
                    data-editable={String(handle.editable)}
                    data-sketch-id={handle.sketchId}
                    data-edge-id={handle.edgeId}
                    data-end={handle.end}
                    data-anchor-x={handle.anchor[0]}
                    data-anchor-y={handle.anchor[1]}
                    cx={shownPoint[0]}
                    cy={shownPoint[1]}
                    r={handleRadius}
                    fill={
                      sameRef(selection, ref)
                        ? '#ffd166'
                        : handle.editable
                          ? '#171b24'
                          : '#5b356b'
                    }
                    stroke={handle.editable ? '#a9c2e8' : '#e0a7f5'}
                    strokeWidth={1.5}
                    vectorEffect="non-scaling-stroke"
                    style={{ cursor: handle.editable ? 'grab' : 'not-allowed' }}
                  >
                    <title>
                      {handle.editable
                        ? '拖动控制柄'
                        : `关系驱动的只读控制柄${handle.relationId ? `（${handle.relationId}）` : ''}`}
                    </title>
                  </circle>
                </g>
              );
            })}
          {props.tool === 'anchor' &&
            overlay.vertices.map((vertex) => {
              const ref = {
                kind: 'vertex' as const,
                sketchId: vertex.sketchId,
                id: vertex.vertexId,
              };
              return (
                <circle
                  key={`${vertex.sketchId}:${vertex.vertexId}`}
                  data-edit-kind="vertex"
                  data-editable={String(vertex.editable)}
                  data-sketch-id={vertex.sketchId}
                  data-vertex-id={vertex.vertexId}
                  cx={vertex.point[0]}
                  cy={vertex.point[1]}
                  r={pointRadius}
                  fill={
                    sameRef(selection, ref)
                      ? '#ffd166'
                      : vertex.editable
                        ? '#f5f7fa'
                        : '#5b356b'
                  }
                  stroke={vertex.editable ? '#172033' : '#e0a7f5'}
                  strokeWidth={1.5}
                  vectorEffect="non-scaling-stroke"
                  style={{ cursor: vertex.editable ? 'grab' : 'not-allowed' }}
                >
                  <title>
                    {vertex.editable
                      ? '拖动锚点'
                      : `关系驱动的只读锚点${vertex.relationId ? `（${vertex.relationId}）` : ''}`}
                  </title>
                </circle>
              );
            })}
          {shownPenCubics.length > 0 && (
            <path
              d={cubicPath(shownPenCubics.map((cubic) => ({ cubic })))}
              fill="none"
              stroke="#fff"
              strokeWidth={1.5}
              pointerEvents="none"
              vectorEffect="non-scaling-stroke"
            />
          )}
          {shownPenNodes.map((node, index) => (
            <g key={`pen-${index}`} pointerEvents="none">
              <line
                x1={node.incoming[0]}
                y1={node.incoming[1]}
                x2={node.outgoing[0]}
                y2={node.outgoing[1]}
                stroke="#8b9db7"
                vectorEffect="non-scaling-stroke"
              />
              <circle
                cx={node.point[0]}
                cy={node.point[1]}
                r={index === 0 ? pointRadius * 1.25 : pointRadius}
                fill={index === 0 ? '#ffd166' : '#fff'}
                stroke="#172033"
                vectorEffect="non-scaling-stroke"
              />
            </g>
          ))}
        </g>
      </svg>
      {props.tool === 'anchor' && (
        <span
          data-derived-toggle
          aria-hidden="true"
          style={{
            position: 'absolute',
            top: 12,
            right: 12,
            padding: '6px 9px',
            border: '1px solid rgba(255, 184, 107, .72)',
            borderRadius: 4,
            color: showDerivedHandles ? '#171b24' : '#ffcb91',
            background: showDerivedHandles
              ? 'rgba(255, 184, 107, .92)'
              : 'rgba(31, 27, 25, .9)',
            cursor: 'pointer',
            userSelect: 'none',
          }}
        >
          重复结果控制柄：{showDerivedHandles ? '开' : '关'}（D）
        </span>
      )}
      {feedback && (
        <output
          id="v4-canvas-feedback"
          style={{
            position: 'absolute',
            left: 12,
            bottom: 12,
            padding: '6px 9px',
            borderRadius: 4,
            color: '#f3d9ff',
            background: 'rgba(45, 28, 55, .92)',
            pointerEvents: 'none',
          }}
        >
          {feedback}
        </output>
      )}
    </button>
  );
}
