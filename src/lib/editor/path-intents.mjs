import { createAuthoringCommand } from '../editing/commands/authoring.mjs';
import { sourceViewToWorld } from './source-view.mjs';

/** Original path controls submit intent against a captured readonly view. */
export function createPathIntent(request, displayed) {
  const action = structuredClone(request),
    view = structuredClone(displayed);
  if (!['set-paths', 'extend-path', 'close-path'].includes(action?.kind))
    throw Error('路径动作尚未适配');
  if (
    typeof view?.epoch !== 'string' ||
    !Number.isInteger(view.revision) ||
    !view.source ||
    view.previewId != null
  )
    throw Error('路径操作需要已提交的源视图');
  const resolve = (id) => {
    const path = view.source.paths.find((item) => item.id === id);
    const ref = path && view.source.identities.byId[path.identity.pathId];
    if (ref?.kind !== 'path') throw Error('路径选区已失效');
    return ref;
  };
  let command;
  if (action.kind === 'set-paths') {
    if (!Array.isArray(action.pathIds)) throw Error('路径选区必须是数组');
    command = {
      kind: action.kind,
      pathRefs: action.pathIds.map(resolve),
      value: action.value,
    };
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
