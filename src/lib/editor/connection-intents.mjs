import { effectiveNodeState } from '../scene/hierarchy.mjs';
import { sourcePathId } from './source-view.mjs';
import { worldMatrix, transformPoint } from '../scene/transforms.mjs';

const clone = (value) => structuredClone(value);

function cutterPaths(document, refs, visited = new Set()) {
  return refs.flatMap((ref) => {
    if (ref.kind === 'sketch') {
      const sketch = document.sketches[ref.sketchId];
      if (!sketch) throw Error('分区线来源已失效');
      return (ref.pathIds || Object.keys(sketch.paths)).map((id) => ({
        kind: 'path',
        sketchId: sketch.id,
        id,
      }));
    }
    if (ref.kind !== 'port') return [];
    const key = `${ref.ownerNodeId}:${ref.operatorId}`;
    if (visited.has(key)) return [];
    visited.add(key);
    const program =
      document.programs[document.nodes[ref.ownerNodeId]?.programId];
    const operator = program?.operators[ref.operatorId];
    if (!operator) throw Error('分区线构造来源已失效');
    return cutterPaths(
      document,
      Object.values(operator.inputs).flat(),
      visited,
    );
  });
}

/** Adjust derived partition endpoint repair, never source vertices. */
export function createConnectionIntent(action, args, displayed) {
  const request = clone(args);
  const view = clone(displayed);
  if (!['join', 'connection'].includes(action)) throw Error('未知补边动作');
  const keys =
    action === 'join'
      ? ['objectId', 'joinMM']
      : ['objectId', 'pathId', 'endpoint', 'disabled', 'operatorId'];
  if (!request || Object.keys(request).some((key) => !keys.includes(key)))
    throw Error('补边参数无效');
  return (document, context) => {
    if (context.epoch !== view.epoch || context.revision !== view.revision)
      throw Error('补边视图已过期');
    const node = document.nodes[request.objectId];
    if (node?.kind !== 'shape' || effectiveNodeState(document, node.id).locked)
      throw Error('部件不存在或已锁定');
    const program = document.programs[node.programId];
    const partitions = Object.values(program.operators).filter(
      (op) => op.type === 'partition',
    );
    if (!partitions.length) throw Error('当前部件没有分区补边步骤');
    if (
      action === 'join' &&
      (!Number.isFinite(request.joinMM) ||
        request.joinMM < 0 ||
        request.joinMM > 5)
    )
      throw Error('补边距离必须在 0–5 mm 之间');
    if (
      action === 'connection' &&
      (![0, 1].includes(request.endpoint) ||
        typeof request.disabled !== 'boolean')
    )
      throw Error('补边端点或启用状态无效');
    let changed = false;
    for (const op of partitions) {
      if (
        action === 'connection' &&
        request.operatorId !== undefined &&
        op.id !== request.operatorId
      )
        continue;
      if (op.authoring) throw Error('请先完成当前分区线绘制');
      const paths = cutterPaths(document, op.inputs.cutter || []);
      const path =
        action === 'connection'
          ? paths.find(
              (item) => sourcePathId(item.sketchId, item.id) === request.pathId,
            )
          : null;
      if (action === 'connection' && !path) continue;
      const policy = clone(
        op.params.endpointJoin || {
          toleranceMM: 0.15,
          disabled: [],
          cohorts: [[...new Set(paths.map((item) => item.id))]],
        },
      );
      if (action === 'join') policy.toleranceMM = request.joinMM;
      else {
        policy.disabled = (policy.disabled || []).filter(
          (item) =>
            item.pathId !== path.id || item.endpoint !== request.endpoint,
        );
        if (request.disabled)
          policy.disabled.push({ pathId: path.id, endpoint: request.endpoint });
      }
      op.params = { ...op.params, endpointJoin: policy };
      changed = true;
    }
    if (!changed) throw Error('补边线条不属于当前分区步骤');
    return { document, changedRefs: [{ kind: 'node', id: node.id }] };
  };
}

/** Connection overlays use current operator diagnostics in world millimetres. */
export function projectPartitionConnections(document, snapshot) {
  const connections = [],
    diagnostics = [];
  for (const node of Object.values(document.nodes)) {
    if (node.kind !== 'shape') continue;
    const program = document.programs[node.programId];
    for (const operator of Object.values(program.operators)) {
      if (operator.type !== 'partition') continue;
      const stage =
        snapshot?.planar?.components?.[`operator:${operator.id}`]?.ports
          ?.regions;
      let paths;
      try {
        paths = cutterPaths(document, operator.inputs.cutter || []);
      } catch {
        continue;
      }
      for (const item of stage?.diagnostics || []) {
        if (!item.code?.startsWith('partition-endpoint-')) continue;
        const matches = paths.filter((path) => path.id === item.pathId);
        const path = matches[0];
        if (
          !path ||
          matches.some((candidate) => candidate.sketchId !== path.sketchId)
        )
          continue;
        const value = {
          ...clone(item),
          objectId: node.id,
          operatorId: operator.id,
          pathId: sourcePathId(path.sketchId, path.id),
          status:
            item.code === 'partition-endpoint-connected'
              ? 'connected'
              : item.code === 'partition-endpoint-disabled'
                ? 'disabled'
                : 'unconnected',
          from: transformPoint(worldMatrix(document, node.id), item.from),
          to: transformPoint(worldMatrix(document, node.id), item.to),
        };
        diagnostics.push(value);
        if (value.status === 'connected') connections.push(value);
      }
    }
  }
  return { connections, diagnostics };
}
