import { createAuthoringCommand } from '../editing/commands/authoring.mjs';
import { sourceViewToWorld } from './source-view.mjs';

/** Original path controls submit intent against a captured readonly view. */
export function createPathIntent(request, displayed) {
  const action = structuredClone(request),
    view = structuredClone(displayed);
  if (
    ![
      'set-paths',
      'delete-paths',
      'start-path',
      'extend-path',
      'close-path',
      'finish-path',
      'refit-path',
      'straighten-edge',
      'delete-path-vertices',
      'merge-paths',
      'create-path-collection',
      'rename-collection',
      'delete-collection',
      'reorder-source-paths',
    ].includes(action?.kind)
  )
    throw Error('路径动作尚未适配');
  if (
    typeof view?.epoch !== 'string' ||
    !Number.isInteger(view.revision) ||
    !view.source ||
    view.previewId != null
  )
    throw Error('路径操作需要已提交的源视图');
  const resolve = (id) => {
    const ref = view.source.identities.byId[id];
    if (ref?.kind !== 'path') throw Error('路径选区已失效');
    return ref;
  };
  const expectedEdges = (path) =>
    path.identity.edgeIds.map((id, index) => ({
      edgeId: view.source.identities.byId[id].id,
      reversed:
        view.source.identities.byId[path.identity.handleIds[index][0]].end ===
        'end',
    }));
  let command;
  if (action.kind === 'start-path') {
    command = {
      kind: action.kind,
      point: sourceViewToWorld(view.source.frame, action.pixelPoint),
      ...(action.ownerNodeId !== undefined
        ? { ownerNodeId: action.ownerNodeId }
        : {}),
      ...(action.name !== undefined ? { name: action.name } : {}),
      ...(action.role !== undefined
        ? { role: action.role, targets: action.targets }
        : {}),
    };
  } else if (action.kind === 'set-paths' || action.kind === 'delete-paths') {
    if (!Array.isArray(action.pathIds)) throw Error('路径选区必须是数组');
    command = {
      kind: action.kind,
      pathRefs: action.pathIds.map(resolve),
      value: action.value,
    };
  } else if (
    action.kind === 'create-path-collection' ||
    action.kind === 'reorder-source-paths'
  ) {
    if (!Array.isArray(action.pathIds)) throw Error('路径选区必须是数组');
    command = {
      kind: action.kind,
      pathRefs: action.pathIds.map(resolve),
      ...(action.kind === 'create-path-collection'
        ? { name: action.name }
        : {}),
    };
  } else if (
    action.kind === 'rename-collection' ||
    action.kind === 'delete-collection'
  ) {
    if (
      !view.source.collections.some((item) => item.id === action.collectionId)
    )
      throw Error('整理分组已失效');
    command = {
      kind: action.kind,
      collectionId: action.collectionId,
      ...(action.kind === 'rename-collection' ? { name: action.name } : {}),
    };
  } else if (action.kind === 'merge-paths') {
    command = {
      kind: action.kind,
      firstPathRef: resolve(action.firstPathId),
      secondPathRef: resolve(action.secondPathId),
      firstEnd: action.firstEnd,
      secondEnd: action.secondEnd,
    };
  } else if (
    action.kind === 'refit-path' ||
    action.kind === 'straighten-edge' ||
    action.kind === 'delete-path-vertices'
  ) {
    const pathRef = resolve(action.pathId);
    const path = view.source.paths.find((item) => item.id === action.pathId);
    if (!path) throw Error('路径来源当前无法显示，请先修复');
    if (action.kind === 'delete-path-vertices') {
      if (
        !Array.isArray(action.anchorIdentityIds) ||
        !action.anchorIdentityIds.length
      )
        throw Error('请明确选择待删除节点');
      if (
        !Number.isFinite(action.tolerancePixels) ||
        action.tolerancePixels <= 0
      )
        throw Error('节点删除需要正有限拟合容差');
      command = {
        kind: action.kind,
        pathRef,
        vertexIds: action.anchorIdentityIds.map((id) => {
          const ref = view.source.identities.byId[id];
          if (
            !path.identity.anchorIds.includes(id) ||
            ref?.kind !== 'vertex' ||
            ref.sketchId !== pathRef.sketchId
          )
            throw Error('节点不属于所选路径');
          return ref.id;
        }),
        expectedEdges: expectedEdges(path),
        toleranceMM:
          (action.tolerancePixels * view.source.frame.widthMM) /
          view.source.frame.width,
      };
    } else if (action.kind === 'straighten-edge') {
      if (!path.identity.edgeIds.includes(action.edgeIdentityId))
        throw Error('曲线段不属于所选路径');
      const edge = view.source.identities.byId[action.edgeIdentityId];
      command = { kind: action.kind, pathRef, edgeId: edge.id };
    } else {
      if (!Array.isArray(action.pixelCubics))
        throw Error('重拟合需要逐段 cubic');
      command = {
        kind: action.kind,
        pathRef,
        expectedEdges: expectedEdges(path),
        cubics: action.pixelCubics.map((cubic) => {
          if (!Array.isArray(cubic) || cubic.length !== 4)
            throw Error('重拟合每段必须是 cubic');
          return cubic.map((point) =>
            sourceViewToWorld(view.source.frame, point),
          );
        }),
      };
    }
  } else {
    const ref = resolve(action.pathId);
    command = {
      kind: action.kind,
      sketchId: ref.sketchId,
      pathId: ref.id,
      end: action.end,
    };
    if (action.pixelCubic !== undefined) {
      if (!Array.isArray(action.pixelCubic) || action.pixelCubic.length !== 4)
        throw Error('拟合结果必须是一段 cubic');
      command.cubic = action.pixelCubic.map((point) =>
        sourceViewToWorld(view.source.frame, point),
      );
    }
  }
  const execute = createAuthoringCommand(command);
  return (document, context) => {
    if (context.epoch !== view.epoch || context.revision !== view.revision)
      throw Error('路径视图已失效，请重新执行操作');
    return execute(document, context);
  };
}
