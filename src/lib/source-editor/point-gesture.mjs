import { nodeSelection, pathNodes, selectedNode } from './node-edit.mjs';

/** Bridge for the original canvas's (curve, point) hit targets. The caller
 * owns pointer capture, drag threshold, axis constraint and snap feedback;
 * update receives the final pixel delta from the original pointer-down point.
 * Only the captured source identities are sent to the V4 preview session.
 * @param {{runtime: ReturnType<typeof import('../editor/creation-runtime.mjs').createV4CreationRuntime>, project: object, pathId: string, curve: number, point: number, nodes?: number[], displayOnly?: boolean}} input
 */
export function beginV4PointGesture({
  runtime,
  project,
  pathId,
  curve,
  point,
  nodes = [],
  displayOnly = false,
}) {
  const path = runtime
    .readSourceView(project)
    .source.paths.find((path) => path.id === pathId);
  if (!path || !path.visible || path.locked) throw Error('当前线条不可编辑');
  if (
    !Number.isInteger(curve) ||
    curve < 0 ||
    ![0, 1, 2, 3].includes(point) ||
    (path.curves.length
      ? curve >= path.curves.length
      : curve !== 0 || point !== 0)
  )
    throw Error('节点或控制柄命中已失效');
  const index = selectedNode(path, { curve, point });
  const positions = pathNodes(path);
  let items;
  let request;
  let selection;
  if (index !== null) {
    if (
      !Array.isArray(nodes) ||
      nodes.some(
        (node) =>
          !Number.isInteger(node) || node < 0 || node >= positions.length,
      )
    )
      throw Error('节点选区已失效');
    const indices = nodes.includes(index) ? [...new Set(nodes)] : [index];
    items = indices.map((node) => ({
      identityId: path.identity.anchorIds[node],
      origin: positions[node],
    }));
    selection = nodeSelection(path, index);
  } else {
    const identityId = path.identity.handleIds[curve]?.[point - 1];
    if (!identityId) throw Error('控制柄身份已失效');
    request = { kind: 'move-handle', pathId, identityId };
    selection = { curve, point };
  }
  const origin = index === null ? path.curves[curve][point] : positions[index];
  const gesture = displayOnly
    ? runtime.beginSourceDisplayGesture(project)
    : runtime.beginSourceGesture(project);
  return Object.freeze({
    kind: index === null ? 'handle' : 'nodes',
    selection: Object.freeze(selection),
    update(delta) {
      if (!Number.isFinite(delta?.x) || !Number.isFinite(delta?.y))
        throw Error('拖动位移必须是有限像素坐标');
      const position = (point) => ({
        x: point.x + delta.x,
        y: point.y + delta.y,
      });
      return gesture.update(
        items
          ? {
              kind: 'move-anchors',
              items: items.map(({ identityId, origin }) => ({
                identityId,
                pixelPoint: position(origin),
              })),
            }
          : { ...request, pixelPoint: position(origin) },
      );
    },
    commit: () => gesture.commit(),
    cancel: () => gesture.cancel(),
  });
}
