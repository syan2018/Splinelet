import { evaluateProgram } from '../construction/document-evaluation.mjs';
import { sameOutputRef } from '../relief/appearance.mjs';
import { effectiveNodeState } from '../scene/hierarchy.mjs';
import { createRegionPresentationCommand } from '../editing/commands/region-presentations.mjs';

const clone = (value) => structuredClone(value);
const output = (value) =>
  value?.kind === 'output' &&
  typeof value.ownerNodeId === 'string' &&
  typeof value.operatorId === 'string' &&
  typeof value.key === 'string';

const requireView = (view) => {
  if (!view || !Array.isArray(view.regions))
    throw Error('高级属性命令需要当前模型工作区视图');
  return view;
};

const requireRegion = (document, view, regionId) => {
  if (typeof regionId !== 'string' || !regionId) throw Error('需要稳定区域 ID');
  const region = requireView(view).regions.filter(
    (item) => item.id === regionId,
  );
  if (region.length !== 1 || !output(region[0].outputRef))
    throw Error('区域视图已失效');
  const target = region[0].outputRef;
  if (target.ownerNodeId !== region[0].objectId)
    throw Error('区域所有者不一致');
  const node = document.nodes[target.ownerNodeId];
  if (!node || node.kind !== 'shape') throw Error('区域所属部件不存在');
  const stage = evaluateProgram(document, node.id).regions;
  if (
    stage.status !== 'ready' ||
    !stage.value.regions.some((item) => sameOutputRef(item.ref, target))
  )
    throw Error('区域已失效，请重新求值');
  return { region: clone(region[0]), target: clone(target), node };
};

const requireExactKeys = (args, keys) => {
  if (!args || typeof args !== 'object' || Array.isArray(args))
    throw Error('属性参数必须是对象');
  if (Object.keys(args).some((key) => !keys.includes(key)))
    throw Error('属性参数包含不支持的字段');
};

const nextId = (table, idFactory) => {
  const id = idFactory();
  if (typeof id !== 'string' || !id || Object.hasOwn(table, id))
    throw Error('新属性 ID 无效或重复');
  return id;
};

const assertCapturedState = (context, view) => {
  if (view.epoch !== undefined && context.epoch !== view.epoch)
    throw Error('高级属性视图已过期');
  if (view.revision !== undefined && context.revision !== view.revision)
    throw Error('高级属性视图已过期');
  if (view.previewId !== undefined && view.previewId !== null)
    throw Error('预览中的工作区不能修改属性');
};

/**
 * Compiles a narrowly scoped ModelWorkspace property edit to DocumentV4.
 *
 * Supported actions:
 * - set-region-swatch { regionId, swatchId }: explicit appearance override;
 *   it never creates or enables a relief definition.
 * - set-owner-name / set-owner-visible { regionId, scope:'owner', value }:
 *   the explicit scope acknowledges that the Shape property affects every
 *   region produced by that owner.
 * - set-curve-tolerance { scope:'document', curveToleranceMM }.
 * - set-manufacturing-cleanup { scope:'document', cleanupRadiusMM }.
 * - set-model-options { scope:'document', curveToleranceMM?, cleanupRadiusMM? }.
 *
 * Region name/visibility use exact OutputRef presentation assignments.
 */
export function createModelPropertyCommand(action, args, capturedView) {
  const request = clone(args);
  const view = clone(requireView(capturedView));
  return (document, context) => {
    assertCapturedState(context, view);
    if (action === 'set-region-swatch') {
      requireExactKeys(request, ['regionId', 'swatchId']);
      const { target, node } = requireRegion(document, view, request.regionId);
      if (effectiveNodeState(document, node.id).locked)
        throw Error('部件已锁定');
      if (
        typeof request.swatchId !== 'string' ||
        !document.appearances.swatches[request.swatchId]
      )
        throw Error('需要现有色卡的显式 swatchId');
      const records = document.appearances.overrides;
      const matches = Object.values(records).filter((item) =>
        sameOutputRef(item.target, target),
      );
      if (matches.length > 1) throw Error('区域存在冲突颜色赋值');
      const id = matches[0]?.id || nextId(records, context.idFactory);
      records[id] = {
        id,
        target,
        value: { swatchId: request.swatchId },
      };
      return { document, changedRefs: [target] };
    }

    if (action === 'set-owner-name' || action === 'set-owner-visible') {
      requireExactKeys(request, ['regionId', 'scope', 'value']);
      if (request.scope !== 'owner')
        throw Error('部件属性必须明确 scope: owner；不能假装为区域属性');
      const { target, node } = requireRegion(document, view, request.regionId);
      if (action === 'set-owner-name') {
        if (typeof request.value !== 'string' || !request.value.trim())
          throw Error('部件名称不能为空');
        if (effectiveNodeState(document, node.id).locked)
          throw Error('部件已锁定');
        node.name = request.value.trim();
      } else {
        if (typeof request.value !== 'boolean')
          throw Error('visible 必须是布尔值');
        node.visible = request.value;
      }
      return {
        document,
        changedRefs: [{ kind: 'node', id: target.ownerNodeId }],
      };
    }

    if (action === 'set-curve-tolerance') {
      requireExactKeys(request, ['scope', 'curveToleranceMM']);
      if (request.scope !== 'document')
        throw Error('几何精度是全局文档设置，必须明确 scope: document');
      if (
        !(
          Number.isFinite(request.curveToleranceMM) &&
          request.curveToleranceMM > 0
        )
      )
        throw Error('curveToleranceMM 必须是正有限数');
      document.geometrySettings.curveToleranceMM = request.curveToleranceMM;
      return { document, changedRefs: [] };
    }

    if (action === 'set-manufacturing-cleanup') {
      requireExactKeys(request, ['scope', 'cleanupRadiusMM']);
      if (request.scope !== 'document')
        throw Error('制造清理是全局文档设置，必须明确 scope: document');
      if (
        !Number.isFinite(request.cleanupRadiusMM) ||
        request.cleanupRadiusMM < 0
      )
        throw Error('cleanupRadiusMM 必须是非负有限数');
      document.manufacturing.cleanupRadiusMM = request.cleanupRadiusMM;
      return { document, changedRefs: [] };
    }

    if (action === 'set-model-options') {
      requireExactKeys(request, [
        'scope',
        'curveToleranceMM',
        'cleanupRadiusMM',
      ]);
      if (request.scope !== 'document')
        throw Error('模型选项是全局文档设置，必须明确 scope: document');
      if (
        request.curveToleranceMM === undefined &&
        request.cleanupRadiusMM === undefined
      )
        throw Error('set-model-options 至少需要一个设置');
      if (
        request.curveToleranceMM !== undefined &&
        (!Number.isFinite(request.curveToleranceMM) ||
          request.curveToleranceMM <= 0)
      )
        throw Error('curveToleranceMM 必须是正有限数');
      if (
        request.cleanupRadiusMM !== undefined &&
        (!Number.isFinite(request.cleanupRadiusMM) ||
          request.cleanupRadiusMM < 0)
      )
        throw Error('cleanupRadiusMM 必须是非负有限数');
      if (request.curveToleranceMM !== undefined)
        document.geometrySettings.curveToleranceMM = request.curveToleranceMM;
      if (request.cleanupRadiusMM !== undefined)
        document.manufacturing.cleanupRadiusMM = request.cleanupRadiusMM;
      return { document, changedRefs: [] };
    }

    if (['set-region-name', 'set-region-visible'].includes(action)) {
      requireExactKeys(request, ['regionId', 'value']);
      const { target } = requireRegion(document, view, request.regionId);
      return createRegionPresentationCommand({
        kind: 'set-region-presentation',
        target,
        value: {
          [action === 'set-region-name' ? 'name' : 'visible']: request.value,
        },
      })(document, context);
    }
    throw Error(`不支持的高级属性动作：${action}`);
  };
}
