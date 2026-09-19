import { pathNodes } from './node-edit.mjs';

/** Translate selected raw paths in the captured display frame. Owner poses,
 * paint and manufacturing inputs are deliberately separate editing operations.
 * @param {{runtime: ReturnType<typeof import('../editor/creation-runtime.mjs').createV4CreationRuntime>, project: object, pathIds: string[]}} input
 */
export function beginV4PathGesture({ runtime, project, pathIds }) {
  if (!Array.isArray(pathIds) || !pathIds.length)
    throw Error('移动线条需要非空选区');
  const source = runtime.readSourceView(project).source;
  const items = new Map();
  for (const id of new Set(pathIds)) {
    const path = source.paths.find((path) => path.id === id);
    if (!path || !path.visible || path.locked) throw Error('当前线条不可编辑');
    const positions = pathNodes(path);
    positions.forEach((origin, index) => {
      const identityId = path.identity.anchorIds[index];
      if (!identityId) throw Error('线条节点身份已失效');
      if (!items.has(identityId)) items.set(identityId, { identityId, origin });
    });
  }
  if (!items.size) throw Error('线条没有可移动的源节点');
  const gesture = runtime.beginSourceGesture(project);
  return Object.freeze({
    update(delta) {
      if (!Number.isFinite(delta?.x) || !Number.isFinite(delta?.y))
        throw Error('拖动位移必须是有限像素坐标');
      return gesture.update({
        kind: 'move-anchors',
        items: [...items.values()].map(({ identityId, origin }) => ({
          identityId,
          pixelPoint: { x: origin.x + delta.x, y: origin.y + delta.y },
        })),
      });
    },
    commit: () => gesture.commit(),
    cancel: () => gesture.cancel(),
  });
}
