import type { DocumentV4, Edge, EntityRef } from '@/lib/document/types';
import { resolveRelation } from '@/lib/geometry/relations.mjs';
import { effectiveNodeState } from '@/lib/scene/hierarchy.mjs';
import { inverseTransform, transformPoint } from '@/lib/scene/transforms.mjs';

export type CanvasPoint = [number, number];

export type ProjectedCurve = {
  key?: string;
  ownerNodeId?: string;
  edges: ProjectedEdge[];
};

type ProjectedEdge = {
  key?: string;
  cubic: CanvasPoint[];
  source?: unknown;
  instances?: unknown;
  transform?: unknown;
};

export type DerivedHandle = {
  key: string;
  sketchId?: string;
  edgeId?: string;
  end?: 'start' | 'end';
  anchor?: CanvasPoint;
  anchorWorld: CanvasPoint;
  point: CanvasPoint;
  inverse?: number[];
  editable: boolean;
  reason?: string;
  instances: { operatorId: string; index: number }[];
};

export type DerivedHandleOverlay = {
  handles: DerivedHandle[];
  byKey: Map<string, DerivedHandle>;
};

const asPoint = (value: unknown): CanvasPoint | null =>
  Array.isArray(value) &&
  value.length === 2 &&
  value.every((component) => Number.isFinite(component))
    ? ([value[0], value[1]] as CanvasPoint)
    : null;

const asTransform = (value: unknown): number[] | null =>
  Array.isArray(value) &&
  value.length === 6 &&
  value.every((component) => Number.isFinite(component))
    ? value
    : null;

const add = (left: CanvasPoint, right: CanvasPoint): CanvasPoint => [
  left[0] + right[0],
  left[1] + right[1],
];

const near = (left: CanvasPoint, right: CanvasPoint) => {
  const scale = Math.max(
    1,
    Math.abs(left[0]),
    Math.abs(left[1]),
    Math.abs(right[0]),
    Math.abs(right[1]),
  );
  return Math.hypot(left[0] - right[0], left[1] - right[1]) <= 1e-7 * scale;
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

const vertexPoint = (
  document: DocumentV4,
  sketch: DocumentV4['sketches'][string],
  vertexId: string,
) => {
  const vertex = sketch.vertices[vertexId];
  if (!vertex) return null;
  return vertex.position.kind === 'free'
    ? asPoint(vertex.position.value)
    : relationPoint(
        document,
        sketch,
        { kind: 'vertex', sketchId: sketch.id, id: vertexId },
        vertex.position.relationId,
      );
};

const handleVector = (
  document: DocumentV4,
  sketch: DocumentV4['sketches'][string],
  edge: Edge,
  end: 'start' | 'end',
) => {
  const handle = end === 'start' ? edge.startHandle : edge.endHandle;
  return handle.kind === 'free'
    ? asPoint(handle.vector)
    : relationPoint(
        document,
        sketch,
        { kind: 'edge-end', sketchId: sketch.id, edgeId: edge.id, end },
        handle.relationId,
      );
};

const instanceChain = (value: unknown) => {
  if (!Array.isArray(value) || value.length < 2) return null;
  const instances = value.filter(
    (item): item is { operatorId: string; index: number } =>
      Boolean(
        item &&
        typeof item === 'object' &&
        'operatorId' in item &&
        typeof item.operatorId === 'string' &&
        item.operatorId &&
        'index' in item &&
        Number.isSafeInteger(item.index),
      ),
  );
  return instances.length === value.length ? instances : null;
};

const readonlyPair = (
  result: DerivedHandle[],
  key: string,
  cubic: CanvasPoint[],
  instances: { operatorId: string; index: number }[],
  reason: string,
  source?: { sketchId: string; edgeId: string },
) => {
  for (const [end, anchorIndex, handleIndex] of [
    ['start', 0, 1],
    ['end', 3, 2],
  ] as const)
    result.push({
      key: `${key}:${end}`,
      ...(source
        ? { sketchId: source.sketchId, edgeId: source.edgeId, end }
        : {}),
      anchorWorld: cubic[anchorIndex],
      point: cubic[handleIndex],
      editable: false,
      reason,
      instances,
    });
};

const instanceMatchesKey = (
  curveKey: unknown,
  edgeKey: unknown,
  instances: { operatorId: string; index: number }[],
) => {
  const suffix = instances
    .map((instance) => `@${instance.operatorId}:${instance.index}`)
    .join('');
  return (
    typeof curveKey === 'string' &&
    curveKey.endsWith(suffix) &&
    typeof edgeKey === 'string' &&
    edgeKey.endsWith(suffix)
  );
};

/**
 * Converts a published derived edge into source-backed controls. Every writable
 * control is proven against the projected cubic and its exact instance chain;
 * failures remain visible but read-only with a concrete reason.
 */
export function deriveHandleOverlay(
  document: DocumentV4,
  curves: ProjectedCurve[],
  ownerNodeId: string | undefined,
): DerivedHandleOverlay {
  const handles: DerivedHandle[] = [];
  curves.forEach((curve, curveIndex) => {
    if (!ownerNodeId || curve.ownerNodeId !== ownerNodeId) return;
    curve.edges.forEach((projected, edgeIndex) => {
      const cubic = projected.cubic.map(asPoint);
      const instances = instanceChain(projected.instances);
      if (!instances || cubic.length !== 4 || cubic.some((point) => !point))
        return;
      const points = cubic as CanvasPoint[];
      const key = `${curveIndex}:${edgeIndex}:${instances
        .map((item) => `${item.operatorId}:${item.index}`)
        .join('/')}`;
      const source = projected.source;
      if (
        !source ||
        typeof source !== 'object' ||
        !('kind' in source) ||
        source.kind !== 'edge' ||
        !('sketchId' in source) ||
        typeof source.sketchId !== 'string' ||
        !('id' in source) ||
        typeof source.id !== 'string'
      ) {
        readonlyPair(
          handles,
          key,
          points,
          instances,
          '派生边缺少明确的源 EdgeRef。',
        );
        return;
      }
      const sourceId = { sketchId: source.sketchId, edgeId: source.id };
      const sketch = document.sketches[source.sketchId];
      const edge = sketch?.edges[source.id];
      if (!sketch || !edge) {
        readonlyPair(
          handles,
          key,
          points,
          instances,
          '派生边引用的源控制柄已经不存在。',
          sourceId,
        );
        return;
      }
      if (!instanceMatchesKey(curve.key, projected.key, instances)) {
        readonlyPair(
          handles,
          key,
          points,
          instances,
          '实例链与当前发布曲线不一致。',
          sourceId,
        );
        return;
      }
      const transform = asTransform(projected.transform);
      let inverse: number[] | undefined;
      try {
        if (transform) inverse = inverseTransform(transform);
      } catch {
        inverse = undefined;
      }
      if (!transform || !inverse) {
        readonlyPair(
          handles,
          key,
          points,
          instances,
          transform ? '当前实例的变换不可逆。' : '当前实例缺少显式有限变换。',
          sourceId,
        );
        return;
      }
      const start = vertexPoint(document, sketch, edge.startVertexId);
      const end = vertexPoint(document, sketch, edge.endVertexId);
      const startVector = handleVector(document, sketch, edge, 'start');
      const endVector = handleVector(document, sketch, edge, 'end');
      if (!start || !end || !startVector || !endVector) {
        readonlyPair(
          handles,
          key,
          points,
          instances,
          '源锚点或控制柄关系尚未成功解算。',
          sourceId,
        );
        return;
      }
      const expected = [
        start,
        add(start, startVector),
        add(end, endVector),
        end,
      ].map((point) => transformPoint(transform, point) as CanvasPoint);
      const forward = expected.every((point, index) =>
        near(point, points[index]),
      );
      const reversed = expected.every((point, index) =>
        near(point, points[3 - index]),
      );
      if (!forward && !reversed) {
        readonlyPair(
          handles,
          key,
          points,
          instances,
          '源边、实例变换与当前发布曲线不一致。',
          sourceId,
        );
        return;
      }
      const locked = effectiveNodeState(document, sketch.ownerNodeId).locked;
      for (const [projectedEnd, anchorIndex, handleIndex] of [
        ['start', 0, 1],
        ['end', 3, 2],
      ] as const) {
        const endName = forward
          ? projectedEnd
          : projectedEnd === 'start'
            ? 'end'
            : 'start';
        const vertexId =
          endName === 'start' ? edge.startVertexId : edge.endVertexId;
        const vertex = sketch.vertices[vertexId];
        const handle = endName === 'start' ? edge.startHandle : edge.endHandle;
        const anchor = endName === 'start' ? start : end;
        const reason = locked
          ? '源部件已锁定。'
          : vertex.position.kind !== 'free'
            ? `源锚点由关系 ${vertex.position.relationId} 驱动。`
            : handle.kind !== 'free'
              ? `源控制柄由关系 ${handle.relationId} 驱动。`
              : undefined;
        handles.push({
          key: `${key}:${projectedEnd}`,
          sketchId: sketch.id,
          edgeId: edge.id,
          end: endName,
          anchor,
          anchorWorld: points[anchorIndex],
          point: points[handleIndex],
          inverse,
          editable: reason === undefined,
          reason,
          instances,
        });
      }
    });
  });
  return {
    handles,
    byKey: new Map(handles.map((handle) => [handle.key, handle])),
  };
}
