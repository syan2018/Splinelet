import { resolveRelation } from '../geometry/relations.mjs';
import { effectiveNodeState } from '../scene/hierarchy.mjs';
import {
  inverseTransform,
  transformPoint,
  worldMatrix,
} from '../scene/transforms.mjs';

const COLORS = [
  '#b8ef62',
  '#66d9ef',
  '#ffa872',
  '#e1a0ff',
  '#ff798f',
  '#ffdb72',
];

const cloneRef = (ref) => structuredClone(ref);
const coordinates = (value, label) =>
  Array.isArray(value)
    ? vector(value, label)
    : value && Number.isFinite(value.x) && Number.isFinite(value.y)
      ? [value.x, value.y]
      : (() => {
          throw Error(`${label} 未解算为有限二维坐标`);
        })();
const vector = (value, label) => {
  if (
    !Array.isArray(value) ||
    value.length !== 2 ||
    !value.every(Number.isFinite)
  )
    throw Error(`${label} 未解算为有限二维坐标`);
  return value;
};
const add = (left, right) => [left[0] + right[0], left[1] + right[1]];
const point = ([x, y]) => ({ x, y });
const equalRef = (left, right) =>
  left.kind === right.kind &&
  left.id === right.id &&
  left.sketchId === right.sketchId &&
  left.edgeId === right.edgeId &&
  left.end === right.end;

const freeze = (value, seen = new Set()) => {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) freeze(child, seen);
  return Object.freeze(value);
};

const finitePositive = (value) => Number.isFinite(value) && value > 0;

/**
 * The legacy source canvas uses top-left pixel coordinates. V4 Sketch geometry
 * uses y-up millimetres around the frame centre. The caller must supply the
 * complete compatibility frame; no document or image heuristic is used.
 */
export function createSourceViewFrame(frame) {
  if (
    !frame ||
    !finitePositive(frame.width) ||
    !finitePositive(frame.height) ||
    !finitePositive(frame.widthMM)
  )
    throw Error('source view frame 需要正有限 width、height 和 widthMM');
  const pixelsPerMM = frame.width / frame.widthMM;
  const worldToPixel = [
    pixelsPerMM,
    0,
    0,
    -pixelsPerMM,
    frame.width / 2,
    frame.height / 2,
  ];
  return freeze({
    width: frame.width,
    height: frame.height,
    widthMM: frame.widthMM,
    worldToPixel,
    pixelToWorld: inverseTransform(worldToPixel),
  });
}

export const sourcePathId = (sketchId, pathId) =>
  `source-path:${sketchId.length}:${sketchId}:${pathId.length}:${pathId}`;

const identityPart = (value) => `${value.length}:${value}`;

/** Stable across path ordering, use reversal, and edits to unrelated entities. */
export function sourceIdentityId(ref) {
  if (ref?.kind === 'path') return sourcePathId(ref.sketchId, ref.id);
  if (ref?.kind === 'vertex' || ref?.kind === 'edge')
    return `source-${ref.kind}:${identityPart(ref.sketchId)}:${identityPart(ref.id)}`;
  if (ref?.kind === 'edge-end')
    return `source-edge-end:${identityPart(ref.sketchId)}:${identityPart(ref.edgeId)}:${ref.end}`;
  throw Error(
    'source view identity 需要 PathRef、VertexRef、EdgeRef 或 EdgeEndRef',
  );
}

const resolvedRelation = (document, sketch, target, relationId, label) => {
  const result = resolveRelation({ document, sketch, target, relationId });
  if (result?.status !== 'ready') {
    const detail = (result?.diagnostics || [])
      .map((diagnostic) => diagnostic.message)
      .filter(Boolean)
      .join('；');
    throw Error(`${label} 无法解算${detail ? `：${detail}` : ''}`);
  }
  return vector(result.value, label);
};

const vertexValue = (document, sketch, vertexId) => {
  const vertex = sketch.vertices[vertexId];
  if (!vertex) throw Error(`Sketch ${sketch.id} 缺少 Vertex ${vertexId}`);
  return vertex.position.kind === 'free'
    ? vector(vertex.position.value, `Vertex ${vertexId}`)
    : resolvedRelation(
        document,
        sketch,
        { kind: 'vertex', sketchId: sketch.id, id: vertexId },
        vertex.position.relationId,
        `Vertex ${vertexId}`,
      );
};

const handleValue = (document, sketch, edge, end) => {
  const handle = end === 'start' ? edge.startHandle : edge.endHandle;
  return handle.kind === 'free'
    ? vector(handle.vector, `Edge ${edge.id} ${end} handle`)
    : resolvedRelation(
        document,
        sketch,
        { kind: 'edge-end', sketchId: sketch.id, edgeId: edge.id, end },
        handle.relationId,
        `Edge ${edge.id} ${end} handle`,
      );
};

const sourceCubic = (document, sketch, edge) => {
  const start = vertexValue(document, sketch, edge.startVertexId);
  const end = vertexValue(document, sketch, edge.endVertexId);
  return [
    start,
    add(start, handleValue(document, sketch, edge, 'start')),
    add(end, handleValue(document, sketch, edge, 'end')),
    end,
  ];
};

const pathColor = (id) => {
  let hash = 2166136261;
  for (let index = 0; index < id.length; index++) {
    hash ^= id.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return COLORS[(hash >>> 0) % COLORS.length];
};

const setIdentity = (tables, kind, id, ref) => {
  const previous = tables.byId[id];
  if (previous && !equalRef(previous, ref))
    throw Error(`source view identity 冲突：${id}`);
  const value = previous || cloneRef(ref);
  tables[kind][id] = value;
  tables.byId[id] = value;
};

const identityTables = () => ({
  byId: {},
  paths: {},
  anchors: {},
  edges: {},
  handles: {},
});

const mergeIdentities = (target, source) => {
  for (const kind of ['paths', 'anchors', 'edges', 'handles'])
    for (const [id, ref] of Object.entries(source[kind]))
      setIdentity(target, kind, id, ref);
};

const relationMode = (document, handle) => {
  if (handle.kind !== 'relation') return null;
  const relation = document.relations[handle.relationId];
  if (relation?.kind !== 'handle-continuity') return null;
  return relation.mode === 'symmetric' ? 'symmetric' : 'smooth';
};

const mergeMode = (current, candidate) => {
  if (!candidate || candidate === 'corner') return current;
  if (current === 'symmetric' || candidate === 'symmetric') return 'symmetric';
  return 'smooth';
};

const projectPath = (document, sketch, pathValue, sourceFrame, identities) => {
  const id = sourcePathId(sketch.id, pathValue.id);
  const ownerMatrix = worldMatrix(document, sketch.ownerNodeId);
  const projectPoint = (local) =>
    point(
      transformPoint(
        sourceFrame.worldToPixel,
        transformPoint(ownerMatrix, local),
      ),
    );
  const curves = [];
  const orientedVertices = [];
  const edgeIds = [];
  const handleIds = [];
  const nodeModes = Array.from(
    { length: pathValue.edges.length + 1 },
    () => 'corner',
  );
  let previousEnd;
  for (const [index, use] of pathValue.edges.entries()) {
    const edge = sketch.edges[use.edgeId];
    if (!edge)
      throw Error(
        `Path ${sketch.id}/${pathValue.id} 引用缺失 Edge ${use.edgeId}`,
      );
    const startVertexId = use.reversed ? edge.endVertexId : edge.startVertexId;
    const endVertexId = use.reversed ? edge.startVertexId : edge.endVertexId;
    if (previousEnd !== undefined && previousEnd !== startVertexId)
      throw Error(
        `Path ${sketch.id}/${pathValue.id} 的 Edge ${index} 与前一段不连续`,
      );
    previousEnd = endVertexId;
    if (!index) orientedVertices.push(startVertexId);
    orientedVertices.push(endVertexId);

    const canonical = sourceCubic(document, sketch, edge);
    const oriented = use.reversed ? canonical.slice().reverse() : canonical;
    curves.push(oriented.map(projectPoint));

    const edgeRef = {
      kind: 'edge',
      sketchId: sketch.id,
      id: edge.id,
    };
    const edgeIdentity = sourceIdentityId(edgeRef);
    edgeIds.push(edgeIdentity);
    setIdentity(identities, 'edges', edgeIdentity, edgeRef);

    const startEnd = use.reversed ? 'end' : 'start';
    const endEnd = use.reversed ? 'start' : 'end';
    const startHandleRef = {
      kind: 'edge-end',
      sketchId: sketch.id,
      edgeId: edge.id,
      end: startEnd,
    };
    const endHandleRef = {
      kind: 'edge-end',
      sketchId: sketch.id,
      edgeId: edge.id,
      end: endEnd,
    };
    const startHandleIdentity = sourceIdentityId(startHandleRef);
    const endHandleIdentity = sourceIdentityId(endHandleRef);
    handleIds.push([startHandleIdentity, endHandleIdentity]);
    setIdentity(identities, 'handles', startHandleIdentity, startHandleRef);
    setIdentity(identities, 'handles', endHandleIdentity, endHandleRef);
    nodeModes[index] = mergeMode(
      nodeModes[index],
      relationMode(
        document,
        startEnd === 'start' ? edge.startHandle : edge.endHandle,
      ),
    );
    nodeModes[index + 1] = mergeMode(
      nodeModes[index + 1],
      relationMode(
        document,
        endEnd === 'start' ? edge.startHandle : edge.endHandle,
      ),
    );
  }

  const closed = previousEnd === orientedVertices[0];
  if (closed) nodeModes[0] = mergeMode(nodeModes[0], nodeModes.pop());
  const anchorVertexIds = closed
    ? orientedVertices.slice(0, -1)
    : orientedVertices;
  anchorVertexIds.forEach((vertexId, index) => {
    nodeModes[index] = mergeMode(
      nodeModes[index],
      pathValue.handleModes?.[vertexId],
    );
  });
  const anchors = closed
    ? curves.map((cubic) => cubic[0])
    : [curves[0][0], ...curves.map((cubic) => cubic[3])];
  const anchorIds = anchorVertexIds.map((vertexId) => {
    const anchorRef = {
      kind: 'vertex',
      sketchId: sketch.id,
      id: vertexId,
    };
    const anchorIdentity = sourceIdentityId(anchorRef);
    setIdentity(identities, 'anchors', anchorIdentity, anchorRef);
    return anchorIdentity;
  });
  const state = effectiveNodeState(document, sketch.ownerNodeId);
  const parentNodeId = document.nodes[sketch.ownerNodeId]?.parentId ?? null;
  return {
    id,
    sketchId: sketch.id,
    ownerNodeId: sketch.ownerNodeId,
    ownerRef: { kind: 'node', id: sketch.ownerNodeId },
    parentNodeId,
    parentRef:
      parentNodeId === null ? null : { kind: 'node', id: parentNodeId },
    name: pathValue.name,
    color: pathColor(id),
    curves,
    start: curves[0][0],
    closed,
    visible: pathValue.visible && state.visible,
    locked: state.locked,
    quality: 1,
    anchors,
    nodeModes,
    identity: { pathId: id, anchorIds, edgeIds, handleIds },
  };
};

/**
 * Projects raw V4 Sketch paths for the existing Bezier viewer. This is a
 * read-only DTO plus source identity index, never a reverse conversion into a
 * mutable legacy Project.
 */
export function projectSourceView(document, frame) {
  const sourceFrame = createSourceViewFrame(frame);
  const identities = identityTables();
  const paths = [];
  const diagnostics = [];
  const unavailablePaths = [];
  for (const sketch of Object.values(document.sketches).sort((left, right) =>
    left.id.localeCompare(right.id),
  ))
    for (const pathValue of Object.values(sketch.paths).sort((left, right) =>
      left.id.localeCompare(right.id),
    )) {
      const ref = {
        kind: 'path',
        sketchId: sketch.id,
        id: pathValue.id,
      };
      const id = sourceIdentityId(ref);
      setIdentity(identities, 'paths', id, ref);
      const parentNodeId = document.nodes[sketch.ownerNodeId]?.parentId ?? null;
      const unavailable = (reason) => ({
        id,
        ref: cloneRef(ref),
        ownerNodeId: sketch.ownerNodeId,
        ownerRef: { kind: 'node', id: sketch.ownerNodeId },
        parentNodeId,
        parentRef:
          parentNodeId === null ? null : { kind: 'node', id: parentNodeId },
        name: pathValue.name,
        reason,
      });
      if (!pathValue.edges.length) {
        unavailablePaths.push(unavailable('empty'));
        continue;
      }
      const localIdentities = identityTables();
      try {
        paths.push(
          projectPath(
            document,
            sketch,
            pathValue,
            sourceFrame,
            localIdentities,
          ),
        );
        mergeIdentities(identities, localIdentities);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        diagnostics.push({
          severity: 'error',
          kind: 'source-path-unavailable',
          ref: cloneRef(ref),
          ownerNodeId: sketch.ownerNodeId,
          message,
        });
        unavailablePaths.push(unavailable('projection-error'));
      }
    }
  return freeze({
    frame: sourceFrame,
    paths,
    identities,
    diagnostics,
    unavailablePaths,
  });
}

export function sourceViewToPixel(sourceFrame, worldPoint) {
  return point(
    transformPoint(
      createSourceViewFrame(sourceFrame).worldToPixel,
      coordinates(worldPoint, 'world point'),
    ),
  );
}

export function sourceViewToWorld(sourceFrame, pixelPoint) {
  return transformPoint(
    createSourceViewFrame(sourceFrame).pixelToWorld,
    coordinates(pixelPoint, 'pixel point'),
  );
}
