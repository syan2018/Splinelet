import { straightCubic } from './connect.mjs';
import {
  nodeModes,
  setContinuity,
  moveHandle as moveLegacyHandle,
} from './continuity.mjs';
import { deleteNodes } from './selection.mjs';

const HANDLE_MODES = new Set(['corner', 'smooth', 'symmetric']);

const requirePath = (project, pathId) => {
  const path = project?.paths?.find((item) => item.id === pathId);
  if (!path) throw Error('路径不存在');
  return path;
};

const nodeIndices = (path, indices) => {
  if (!Array.isArray(indices) || !indices.length) throw Error('请明确选择节点');
  const count = nodeModes(path).length;
  if (
    [...indices].some(
      (index) => !Number.isInteger(index) || index < 0 || index >= count,
    )
  )
    throw Error('节点索引越界');
  return [...new Set(indices)];
};

const requireTolerance = (tolerancePixels) => {
  if (!Number.isFinite(tolerancePixels) || tolerancePixels <= 0)
    throw Error('节点删除需要正有限拟合容差');
};

const requireMode = (mode) => {
  if (!HANDLE_MODES.has(mode)) throw Error('无效节点模式');
};

const requireHandle = (path, curveIndex, pointIndex, position) => {
  if (
    !Number.isInteger(curveIndex) ||
    curveIndex < 0 ||
    !path.curves[curveIndex] ||
    ![1, 2].includes(pointIndex)
  )
    throw Error('set_point 支持现有曲线的控制柄 1 或 2');
  if (!Number.isFinite(position?.x) || !Number.isFinite(position?.y))
    throw Error('控制柄坐标必须为有限像素坐标');
};

const validateModes = (path, indices, mode) => {
  requireMode(mode);
  // setContinuity owns the compatibility rules for endpoints and closed seams.
  // Run those checks on a disposable path so an invalid batch never starts a
  // legacy transaction.
  const probe = structuredClone(path);
  for (const index of indices) setContinuity(probe, index, mode);
};

/** Original Studio node actions operating on its cloned Project transaction. */
export function createLegacyNodeActions({ getProject, transact }) {
  if (typeof getProject !== 'function' || typeof transact !== 'function')
    throw Error('节点操作需要工程读取和事务接口');
  return Object.freeze({
    moveHandle(pathId, curveIndex, pointIndex, position) {
      requireHandle(
        requirePath(getProject(), pathId),
        curveIndex,
        pointIndex,
        position,
      );
      transact((project) =>
        moveLegacyHandle(
          requirePath(project, pathId),
          curveIndex,
          pointIndex,
          position,
        ),
      );
    },
    setModes(pathId, indices, mode) {
      const path = requirePath(getProject(), pathId);
      const selected = nodeIndices(path, indices);
      validateModes(path, selected, mode);
      transact((project) => {
        const target = requirePath(project, pathId);
        for (const index of selected) setContinuity(target, index, mode);
        delete target.fitError;
      });
    },
    straighten(pathId, curveIndex) {
      const path = requirePath(getProject(), pathId);
      if (
        !Number.isInteger(curveIndex) ||
        curveIndex < 0 ||
        curveIndex >= path.curves.length
      )
        throw Error('曲线段索引越界');
      transact((project) => {
        const target = requirePath(project, pathId);
        const curve = target.curves[curveIndex];
        target.curves[curveIndex] = straightCubic(curve[0], curve[3]);
        target.nodeModes = nodeModes(target);
        target.nodeModes[curveIndex] = 'corner';
        target.nodeModes[
          target.closed
            ? (curveIndex + 1) % target.curves.length
            : curveIndex + 1
        ] = 'corner';
        delete target.fitError;
      });
    },
    deleteNodes(pathId, indices, tolerancePixels) {
      const path = requirePath(getProject(), pathId);
      const selected = nodeIndices(path, indices);
      requireTolerance(tolerancePixels);
      let removed = false;
      transact((project) => {
        const index = project.paths.findIndex((item) => item.id === pathId);
        if (index < 0) throw Error('路径不存在');
        const next = deleteNodes(
          project.paths[index],
          selected,
          tolerancePixels,
        );
        if (next) project.paths[index] = next;
        else {
          project.paths.splice(index, 1);
          removed = true;
        }
      });
      return { removed };
    },
  });
}

const capturedPath = (runtime, project, pathId) => {
  const view = runtime.readSourceView(project);
  const path = view.source.paths.find((item) => item.id === pathId);
  if (!path) throw Error('路径不存在或当前无法显示');
  return { view, path };
};

const capturedIndices = (path, indices, identityKey) => {
  const identities = path.identity?.[identityKey];
  if (!Array.isArray(identities)) throw Error('路径身份已失效');
  if (!Array.isArray(indices) || !indices.length) throw Error('请明确选择节点');
  if (
    [...indices].some(
      (index) =>
        !Number.isInteger(index) || index < 0 || index >= identities.length,
    )
  )
    throw Error('节点索引越界');
  const selected = [...new Set(indices)];
  return selected.map((index) => {
    const identity = identities[index];
    if (typeof identity !== 'string') throw Error('路径身份已失效');
    return identity;
  });
};

/** V4 adapter translating visible indices into identities from one source view. */
export function createV4NodeActions({ runtime, project, onCommit }) {
  if (
    !runtime?.readSourceView ||
    !runtime?.commandSource ||
    !runtime?.commandPath
  )
    throw Error('节点操作需要 V4 源编辑运行时');
  if (typeof onCommit !== 'function') throw Error('节点操作需要工程提交回调');
  const commit = (plan) => {
    const nextProject = plan.commit();
    onCommit(nextProject);
    return nextProject;
  };
  return Object.freeze({
    moveHandle(pathId, curveIndex, pointIndex, position) {
      const { path } = capturedPath(runtime, project, pathId);
      requireHandle(path, curveIndex, pointIndex, position);
      const identityId = path.identity.handleIds[curveIndex]?.[pointIndex - 1];
      if (typeof identityId !== 'string') throw Error('控制柄身份已失效');
      commit(
        runtime.commandSource(
          {
            kind: 'move-handle',
            pathId,
            identityId,
            pixelPoint: position,
          },
          { project },
        ),
      );
    },
    setModes(pathId, indices, mode) {
      requireMode(mode);
      const { path } = capturedPath(runtime, project, pathId);
      const anchorIdentityIds = capturedIndices(path, indices, 'anchorIds');
      commit(
        runtime.commandSource(
          {
            kind: 'set-handle-modes',
            mode,
            items: anchorIdentityIds.map((identityId) => ({
              pathId,
              identityId,
            })),
          },
          { project },
        ),
      );
    },
    straighten(pathId, curveIndex) {
      const { path } = capturedPath(runtime, project, pathId);
      const [edgeIdentityId] = capturedIndices(path, [curveIndex], 'edgeIds');
      commit(
        runtime.commandPath(
          { kind: 'straighten-edge', pathId, edgeIdentityId },
          { project },
        ),
      );
    },
    deleteNodes(pathId, indices, tolerancePixels) {
      requireTolerance(tolerancePixels);
      const { path } = capturedPath(runtime, project, pathId);
      const anchorIdentityIds = capturedIndices(path, indices, 'anchorIds');
      const nextProject = commit(
        runtime.commandPath(
          {
            kind: 'delete-path-vertices',
            pathId,
            anchorIdentityIds,
            tolerancePixels,
          },
          { project },
        ),
      );
      return {
        removed: !runtime
          .readSourceView(nextProject)
          .source.paths.some((item) => item.id === pathId),
      };
    },
  });
}
