import { createAuthoringCommand } from '../editing/commands/authoring.mjs';
import { resolveThicknessMM } from '../manufacturing/dimensions.mjs';

/** Advanced relief edits target evaluated regions, never a mutated legacy Model.
 * Only explicitly changed fields become overrides; object defaults remain live.
 */
export function createModelIntent(action, args, displayed) {
  const request = structuredClone(args);
  const view = structuredClone(displayed);
  if (action !== 'relief') throw Error(`高级建模动作尚未适配：${action}`);
  if (
    !view ||
    typeof view.epoch !== 'string' ||
    !Number.isInteger(view.revision) ||
    view.previewId !== null
  )
    throw Error('高级建模命令需要已提交版本的区域视图');
  if (
    !request ||
    Object.keys(request).some(
      (key) => !['regionIds', 'changes'].includes(key),
    ) ||
    !Array.isArray(request.regionIds) ||
    !request.regionIds.length ||
    request.regionIds.some((id) => typeof id !== 'string') ||
    !request.changes ||
    typeof request.changes !== 'object' ||
    Array.isArray(request.changes) ||
    !Object.keys(request.changes).length ||
    Object.keys(request.changes).some(
      (key) => !['enabled', 'thickness', 'mode', 'placement'].includes(key),
    )
  )
    throw Error('请指定区域和明确的体块属性变更');
  const regions = new Map(view.regions.map((region) => [region.id, region]));
  if (regions.size !== view.regions.length) throw Error('区域视图身份冲突');
  const targets = [...new Set(request.regionIds)].map((id) => {
    const region = regions.get(id);
    if (
      !region ||
      region.outputRef?.kind !== 'output' ||
      region.outputRef.ownerNodeId !== region.objectId
    )
      throw Error('区域选区已失效');
    return region.outputRef;
  });
  return (initialDocument, context) => {
    if (context.epoch !== view.epoch || context.revision !== view.revision)
      throw Error('高级建模视图已失效，请重新求值');
    if (request.changes.thickness !== undefined)
      resolveThicknessMM(
        request.changes.thickness,
        initialDocument.manufacturing.layerHeightMM,
      );
    let document = initialDocument;
    const changedRefs = [];
    for (const target of targets) {
      const result = createAuthoringCommand({
        kind: 'set-relief',
        target,
        value: request.changes,
      })(document, context);
      document = result.document;
      changedRefs.push(...result.changedRefs);
    }
    return { document, changedRefs };
  };
}
