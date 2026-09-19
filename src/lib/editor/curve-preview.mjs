import { childrenOf, effectiveNodeState } from '../scene/hierarchy.mjs';
import { transformPoint, worldMatrix } from '../scene/transforms.mjs';
import { componentId } from '../construction/dependencies.mjs';

const freeze = (value) => {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
};
const shapes = (document, parentId = null) =>
  childrenOf(document, parentId).flatMap((node) =>
    node.kind === 'shape' ? [node] : shapes(document, node.id),
  );

// Operator IDs are arbitrary document strings; keep them out of the reserved
// 'final' UI key, and encode ports without separator ambiguities.
export const curvePreviewStageId = (operatorId, port = 'curves') =>
  `operator:${JSON.stringify([operatorId, port])}`;

// Same connectivity authority as Fill: vertex identity and explicit Join
// endpoints. Coincident points belonging to separate instances stay separate.
function topologyJunctions(value, toWorld) {
  const edges = value.curves.flatMap((curve) => curve.edges);
  const endpoints = new Map();
  const parents = new Map();
  const vertices = new Map();
  const keyOf = (edgeKey, end) => JSON.stringify([edgeKey, end]);
  const root = (key) => {
    let current = key;
    while (parents.get(current) !== current) current = parents.get(current);
    return current;
  };
  const union = (a, b) => parents.set(root(b), root(a));
  for (const edge of edges) {
    for (const end of ['start', 'end']) {
      const key = keyOf(edge.key, end);
      if (endpoints.has(key)) throw Error('曲线预览存在重复边实例');
      parents.set(key, key);
      endpoints.set(key, edge.cubic[end === 'start' ? 0 : 3]);
      const vertex = edge[`${end}Key`];
      if (typeof vertex !== 'string') throw Error('曲线预览缺少端点拓扑');
      if (vertices.has(vertex)) union(key, vertices.get(vertex));
      else vertices.set(vertex, key);
    }
  }
  for (const junction of value.junctions || []) {
    const keys = junction.endpoints.map(({ edgeKey, end }) => {
      const key = keyOf(edgeKey, end);
      if (!endpoints.has(key)) throw Error('曲线预览 Join 引用不存在的边端');
      return key;
    });
    for (const key of keys.slice(1)) union(keys[0], key);
  }
  const groups = new Map();
  for (const [key, point] of endpoints) {
    const id = root(key);
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id).push(point);
  }
  return [...groups.values()]
    .filter((points) => points.length !== 2)
    .map((points) => ({
      point: toWorld([
        points.reduce((sum, p) => sum + p[0], 0) / points.length,
        points.reduce((sum, p) => sum + p[1], 0) / points.length,
      ]),
      degree: points.length,
    }));
}

function preview(document, objectId, stageId, name, stage) {
  const result = { objectId, stageId, name, curves: [], junctions: [] };
  const diagnostics = (stage?.diagnostics || []).map(
    (item) => item.message || item.code || item.kind,
  );
  if (stage?.status === 'ready') {
    try {
      const value = stage.value;
      if (value?.frame?.kind !== 'local') throw Error('曲线预览缺少局部坐标系');
      const matrix = worldMatrix(document, value.frame.ownerNodeId);
      const toWorld = (point) => {
        const [x, y] = transformPoint(matrix, point);
        return { x, y };
      };
      const curves = value.curves.flatMap((curve) =>
        curve.edges.map((edge) => edge.cubic.map(toWorld)),
      );
      const junctions = topologyJunctions(value, toWorld);
      result.curves = curves;
      result.junctions = junctions;
    } catch (error) {
      diagnostics.push(error.message);
    }
  } else if (stage?.status !== 'empty' && !diagnostics.length) {
    diagnostics.push(
      stage?.status === 'blocked' ? '曲线求值受阻' : '未发布曲线输出',
    );
  }
  if (diagnostics.length)
    result.diagnostic = diagnostics.filter(Boolean).join('；');
  return result;
}

/** Read-only original canvas DTO, in world millimetres/Y-up. Final means the
 * explicit curves publication, never the last evaluated port or Fill input. */
export function projectCurvePreviews(document, snapshot) {
  const planar = snapshot?.planar || snapshot;
  if (!planar?.components || !planar?.published)
    throw Error('曲线预览需要完整当前 planar snapshot');
  const result = [];
  for (const node of shapes(document)) {
    if (!effectiveNodeState(document, node.id).visible) continue;
    const program = document.programs[node.programId];
    const stages = Object.values(program?.operators || {}).flatMap((operator) =>
      Object.entries(planar.components[componentId(operator.id)]?.ports || {})
        .filter(([, stage]) => stage.domain === 'curves')
        .map(([port, stage]) => ({ operator, port, stage })),
    );
    if (!stages.some(({ operator }) => operator.type !== 'source')) continue;
    for (const { operator, port, stage } of stages) {
      if (operator.type === 'source') continue;
      result.push(
        preview(
          document,
          node.id,
          curvePreviewStageId(operator.id, port),
          operator.name || operator.type,
          stage,
        ),
      );
    }
    result.push(
      preview(
        document,
        node.id,
        'final',
        '最终曲线',
        planar.published[`${node.id}:curves`],
      ),
    );
  }
  return freeze(result);
}
