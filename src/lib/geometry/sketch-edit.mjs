import { validateDocument } from '../document/schema.mjs';
import {
  assertTransform,
  transformPoint,
  transformVector,
} from '../scene/transforms.mjs';
import { reversePathUses } from './sketch.mjs';

const finiteVec2 = (value) =>
  Array.isArray(value) && value.length === 2 && value.every(Number.isFinite);
const ref = (kind, sketchId, id) => ({ kind, sketchId, id });
const edgeEndRef = (sketchId, edgeId, end) => ({
  kind: 'edge-end',
  sketchId,
  edgeId,
  end,
});
const clone = (document) => structuredClone(document);
const idFactory = (options) =>
  options.idFactory ||
  (() =>
    globalThis.crypto?.randomUUID?.() ||
    `sketch-${Math.random().toString(36).slice(2)}`);
const collectIds = (document) => {
  const ids = new Set();
  const visit = (value) => {
    if (Array.isArray(value)) return value.forEach(visit);
    if (!value || typeof value !== 'object') return;
    if (typeof value.id === 'string') ids.add(value.id);
    Object.values(value).forEach(visit);
  };
  visit(document);
  return ids;
};
const newId = (factory, ids, label) => {
  const value = factory();
  if (typeof value !== 'string' || !value || ids.has(value))
    throw Error(`${label} ID 无效或重复`);
  ids.add(value);
  return value;
};
const requireSketch = (document, sketchId) => {
  const sketch = document.sketches?.[sketchId];
  if (!sketch) throw Error('Sketch 不存在');
  return sketch;
};
const requireFreeVertex = (sketch, vertexId) => {
  const vertex = sketch.vertices[vertexId];
  if (!vertex) throw Error('Vertex 不存在');
  if (vertex.position.kind !== 'free')
    throw Error('受 Relation 驱动的 Vertex 必须由关系命令编辑');
  return vertex;
};
const requireFreeHandle = (sketch, edgeId, end) => {
  const edge = sketch.edges[edgeId];
  if (!edge || !['start', 'end'].includes(end)) throw Error('EdgeEnd 不存在');
  const key = end === 'start' ? 'startHandle' : 'endHandle';
  if (edge[key].kind !== 'free')
    throw Error('受 Relation 驱动的 Handle 必须由关系命令编辑');
  return { edge, key };
};
const changed = (sketchId, refs, removed = []) => ({
  changedRefs: refs,
  removedRefs: removed,
});
const deCasteljau = (cubic, t) => {
  const mix = (left, right) => [
    left[0] + (right[0] - left[0]) * t,
    left[1] + (right[1] - left[1]) * t,
  ];
  const [p0, p1, p2, p3] = cubic;
  const p01 = mix(p0, p1),
    p12 = mix(p1, p2),
    p23 = mix(p2, p3);
  const p012 = mix(p01, p12),
    p123 = mix(p12, p23),
    point = mix(p012, p123);
  return {
    first: [p0, p01, p012, point],
    second: [point, p123, p23, p3],
    point,
  };
};
const vector = (from, to) => [to[0] - from[0], to[1] - from[1]];
const freeCubic = (sketch, edge) => {
  const start = requireFreeVertex(sketch, edge.startVertexId).position.value;
  const end = requireFreeVertex(sketch, edge.endVertexId).position.value;
  if (edge.startHandle.kind !== 'free' || edge.endHandle.kind !== 'free')
    throw Error('拆边需要自由柄；关系柄由 T05 的显式命令处理');
  return [
    start,
    [
      start[0] + edge.startHandle.vector[0],
      start[1] + edge.startHandle.vector[1],
    ],
    [end[0] + edge.endHandle.vector[0], end[1] + edge.endHandle.vector[1]],
    end,
  ];
};

/** Applies one immutable V4 source edit and reports stable changed/removed refs. */
export function editSketch(document, edit, options = {}) {
  if (!edit || typeof edit !== 'object' || typeof edit.kind !== 'string')
    throw Error('Sketch edit 无效');
  validateDocument(document);
  const next = clone(document);
  const sketch = requireSketch(next, edit.sketchId);
  const ids = collectIds(next);
  const factory = idFactory(options);
  let result;
  if (edit.kind === 'set-vertex') {
    if (!finiteVec2(edit.value)) throw Error('Vertex 位置必须是有限 Vec2');
    requireFreeVertex(sketch, edit.vertexId).position.value = [...edit.value];
    result = changed(sketch.id, [ref('vertex', sketch.id, edit.vertexId)]);
  } else if (edit.kind === 'set-handle') {
    if (!finiteVec2(edit.vector)) throw Error('Handle 向量必须是有限 Vec2');
    const { edge, key } = requireFreeHandle(sketch, edit.edgeId, edit.end);
    edge[key].vector = [...edit.vector];
    result = changed(sketch.id, [edgeEndRef(sketch.id, edge.id, edit.end)]);
  } else if (edit.kind === 'transform') {
    const matrix = assertTransform(edit.matrix);
    const selected = new Set(edit.vertexIds || Object.keys(sketch.vertices));
    if (![...selected].every((vertexId) => sketch.vertices[vertexId]))
      throw Error('transform 包含不存在的 Vertex');
    for (const vertexId of selected)
      requireFreeVertex(sketch, vertexId).position.value = transformPoint(
        matrix,
        sketch.vertices[vertexId].position.value,
      );
    const edgeRefs = [];
    for (const edge of Object.values(sketch.edges)) {
      for (const end of ['start', 'end']) {
        const vertexId =
          end === 'start' ? edge.startVertexId : edge.endVertexId;
        if (!selected.has(vertexId)) continue;
        const { key } = requireFreeHandle(sketch, edge.id, end);
        edge[key].vector = transformVector(matrix, edge[key].vector);
        edgeRefs.push(edgeEndRef(sketch.id, edge.id, end));
      }
    }
    result = changed(sketch.id, [
      ...[...selected].map((vertexId) => ref('vertex', sketch.id, vertexId)),
      ...edgeRefs,
    ]);
  } else if (edit.kind === 'split-edge') {
    const edge = sketch.edges[edit.edgeId];
    const t = edit.t;
    if (!edge || !Number.isFinite(t) || t <= 0 || t >= 1)
      throw Error('split-edge 需要存在 Edge 和 0<t<1');
    const split = deCasteljau(freeCubic(sketch, edge), t);
    const vertexId = edit.vertexId || newId(factory, ids, '新 Vertex');
    const secondEdgeId = edit.secondEdgeId || newId(factory, ids, '新 Edge');
    if (sketch.vertices[vertexId] || sketch.edges[secondEdgeId])
      throw Error('split-edge ID 已存在');
    sketch.vertices[vertexId] = {
      id: vertexId,
      position: { kind: 'free', value: split.point },
    };
    const oldEnd = edge.endVertexId;
    edge.endVertexId = vertexId;
    edge.startHandle = {
      kind: 'free',
      vector: vector(split.first[0], split.first[1]),
    };
    edge.endHandle = {
      kind: 'free',
      vector: vector(split.first[3], split.first[2]),
    };
    sketch.edges[secondEdgeId] = {
      id: secondEdgeId,
      startVertexId: vertexId,
      endVertexId: oldEnd,
      startHandle: {
        kind: 'free',
        vector: vector(split.second[0], split.second[1]),
      },
      endHandle: {
        kind: 'free',
        vector: vector(split.second[3], split.second[2]),
      },
    };
    const changedPaths = [];
    for (const path of Object.values(sketch.paths)) {
      const uses = [];
      for (const use of path.edges) {
        if (use.edgeId !== edge.id) uses.push(use);
        else if (use.reversed)
          uses.push(
            { edgeId: secondEdgeId, reversed: true },
            { edgeId: edge.id, reversed: true },
          );
        else
          uses.push(
            { edgeId: edge.id, reversed: false },
            { edgeId: secondEdgeId, reversed: false },
          );
      }
      path.edges = uses;
      if (uses.some((use) => use.edgeId === secondEdgeId))
        changedPaths.push(ref('path', sketch.id, path.id));
    }
    result = changed(sketch.id, [
      ref('vertex', sketch.id, vertexId),
      ref('edge', sketch.id, edge.id),
      ref('edge', sketch.id, secondEdgeId),
      ...changedPaths,
    ]);
  } else if (edit.kind === 'reverse-path') {
    const path = sketch.paths[edit.pathId];
    if (!path) throw Error('Path 不存在');
    sketch.paths[path.id] = reversePathUses(path);
    result = changed(sketch.id, [ref('path', sketch.id, path.id)]);
  } else if (edit.kind === 'remove-edge') {
    const edge = sketch.edges[edit.edgeId];
    if (!edge) throw Error('Edge 不存在');
    if (edit.updatePaths)
      for (const path of Object.values(sketch.paths))
        path.edges = path.edges.filter((use) => use.edgeId !== edge.id);
    delete sketch.edges[edge.id];
    result = changed(sketch.id, [], [ref('edge', sketch.id, edge.id)]);
  } else if (edit.kind === 'add-vertex') {
    const vertexId = edit.vertexId || newId(factory, ids, '新 Vertex');
    if (sketch.vertices[vertexId] || !finiteVec2(edit.value))
      throw Error('add-vertex 无效');
    sketch.vertices[vertexId] = {
      id: vertexId,
      position: { kind: 'free', value: [...edit.value] },
    };
    result = changed(sketch.id, [ref('vertex', sketch.id, vertexId)]);
  } else if (edit.kind === 'add-edge') {
    const edgeId = edit.edgeId || newId(factory, ids, '新 Edge');
    if (
      sketch.edges[edgeId] ||
      !sketch.vertices[edit.startVertexId] ||
      !sketch.vertices[edit.endVertexId] ||
      !finiteVec2(edit.startVector) ||
      !finiteVec2(edit.endVector)
    )
      throw Error('add-edge 无效');
    sketch.edges[edgeId] = {
      id: edgeId,
      startVertexId: edit.startVertexId,
      endVertexId: edit.endVertexId,
      startHandle: { kind: 'free', vector: [...edit.startVector] },
      endHandle: { kind: 'free', vector: [...edit.endVector] },
    };
    result = changed(sketch.id, [ref('edge', sketch.id, edgeId)]);
  } else if (edit.kind === 'add-path') {
    const pathId = edit.pathId || newId(factory, ids, '新 Path');
    if (
      sketch.paths[pathId] ||
      typeof edit.name !== 'string' ||
      !Array.isArray(edit.edges) ||
      !edit.edges.every(
        (use) => sketch.edges[use.edgeId] && typeof use.reversed === 'boolean',
      )
    )
      throw Error('add-path 无效');
    sketch.paths[pathId] = {
      id: pathId,
      name: edit.name,
      edges: structuredClone(edit.edges),
      visible: edit.visible ?? true,
    };
    result = changed(sketch.id, [ref('path', sketch.id, pathId)]);
  } else throw Error(`不支持的 Sketch edit：${edit.kind}`);
  validateDocument(next);
  return { document: next, ...result };
}

export { deCasteljau };
